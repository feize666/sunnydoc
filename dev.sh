#!/bin/bash
# ============================================================
# sunnydoc 本地开发一键启动
# 用法：./dev.sh          # 启动前后端（若已在跑会提示）
#       ./dev.sh stop     # 停止前后端
#       ./dev.sh status   # 查看状态
# ============================================================
# 为什么需要这个脚本（都是实测踩出来的，别改坏）：
#
# 1. NODE_OPTIONS 必须清空
#    在 WorkBuddy 沙箱里，每个 node 进程会被注入 node-language-shim.cjs（挂钩 fs 操作），
#    与沙箱策略叠加会产生 CODEBUDDY_BROKER_DENY / EPERM。
#    用 `env -u NODE_OPTIONS` 清空（deploy.sh 里也是这么干的）。
#    普通终端里这一项无害，只是让脚本在两种环境下都能跑。
#
# 2. 前端必须加 --webpack
#    next dev 默认 Turbopack，要在 .next/dev/cache 里做原子重命名，
#    在沙箱环境下报 `EPERM: operation not permitted, rename ...` 而启动失败。
#    webpack 模式不做那套持久化缓存重命名，稳定可用。
#
# 3. 127.0.0.1 访问需要 allowedDevOrigins
#    Next.js 16 默认只信任 localhost；用 127.0.0.1 会被判跨域，
#    /_next/hmr 握手失败 → React 不水合 → 页面卡在「加载中…」。
#    已在 web/next.config.ts 配好，此处不重复处理。
#
# 登录凭据：
#   不进仓库。如需在启动后打印账号提示，本地建一个 dev.local.sh（已被 .gitignore 忽略）：
#     DEV_LOGIN_HINT="your_user / your_password"
#   没有该文件时脚本照常工作，只是不打印登录提示。
# ============================================================
set -e

LOCAL_DIR="$(cd "$(dirname "$0")" && pwd)"
API_PORT=8000
WEB_PORT=3001
LOG_DIR="$LOCAL_DIR/.workbuddy/logs"

is_up() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

# 真机探活：端口监听 ≠ 服务可用。
# 历史上出现过「lsof 显示在监听、进程也在，但页面白屏/接口 500」的情况
# （改代码未重启后端、`.next` 被 `npm run build` 覆盖等）。
# 因此 status 在端口之外**再要一个 HTTP 200**，两者都过才算「运行中」。
# ⚠️ 必须带 --noproxy '*'：本机有 HTTP_PROXY，不加会走代理并返回**伪造的 200/502**。
http_ok() {
  # WAIT_ATTEMPTS=1 时只探一次（status 用）；start/restart 可多试几次等它起来
  local url="$1" attempts="${2:-1}" code=""
  local i
  for i in $(seq 1 "$attempts"); do
    code=$(curl -s --noproxy '*' -o /dev/null -w '%{http_code}' --max-time 5 "$url" 2>/dev/null || true)
    [ "$code" = "200" ] && return 0
    [ "$i" -lt "$attempts" ] && sleep 2
  done
  return 1
}

status() {
  echo "--- sunnydoc 本地服务 ---"
  for spec in "后端:$API_PORT:http://127.0.0.1:$API_PORT/api/v1/health" \
              "前端:$WEB_PORT:http://localhost:$WEB_PORT/"; do
    local name="${spec%%:*}"
    local rest="${spec#*:}"
    local port="${rest%%:*}"
    local url="${rest#*:}"
    if ! is_up "$port"; then
      echo "$name :$port  ⛔ 未运行"
    elif http_ok "$url" 1; then
      echo "$name :$port  ✅ 运行中"
    else
      # 端口在、但探活失败 —— 这比「未运行」更值得警惕：进程活着却不可用
      echo "$name :$port  ⚠️  端口在监听但探活失败（$url 未返回 200）"
    fi
  done
  echo "  提示：前端构建（npm run build）会重写 web/.next，"
  echo "        与 dev server 共用该目录 —— 构建后若页面异常，跑 ./dev.sh restart 即可。"
}

start() {
  mkdir -p "$LOG_DIR"

  if is_up $API_PORT; then
    echo "==> 后端 :$API_PORT 已在运行，跳过"
  else
    echo "==> 启动后端 :$API_PORT ..."
    # nohup + disown：既忽略 SIGHUP，也从当前 shell 的任务表摘除，
    # 这样关掉终端不会连带杀掉服务。macOS 无 setsid，用这个组合代替。
    (cd "$LOCAL_DIR/api" && nohup env -u NODE_OPTIONS \
      .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port $API_PORT \
      >"$LOG_DIR/api.log" 2>&1 & disown) 2>/dev/null || true
  fi

  if is_up $WEB_PORT; then
    echo "==> 前端 :$WEB_PORT 已在运行，跳过"
  else
    echo "==> 启动前端 :$WEB_PORT ..."
    (cd "$LOCAL_DIR/web" && nohup env -u NODE_OPTIONS \
      npm run dev -- --webpack \
      >"$LOG_DIR/web.log" 2>&1 & disown) 2>/dev/null || true
  fi

  echo "==> 等待就绪 ..."
  for i in $(seq 1 40); do
    if is_up $API_PORT && is_up $WEB_PORT; then break; fi
    sleep 1
  done

  echo
  status
  echo
  echo "访问：http://127.0.0.1:$WEB_PORT"
  echo "日志：$LOG_DIR/{api,web}.log"
  # 登录凭据不进仓库：若有本地覆盖文件（已被 .gitignore 忽略）则打印其中提示。
  # 用 if 而非 `[ -n ] && echo` —— 后者在无该文件时返回 1，会被外层 set -e 判定为失败。
  if [ -f "$LOCAL_DIR/dev.local.sh" ]; then
    # shellcheck disable=SC1091
    . "$LOCAL_DIR/dev.local.sh"
    if [ -n "${DEV_LOGIN_HINT:-}" ]; then
      echo "登录：$DEV_LOGIN_HINT"
    fi
  fi
}

stop() {
  echo "==> 停止前端 ..."
  pkill -f "next dev -p $WEB_PORT" 2>/dev/null || true
  echo "==> 停止后端 ..."
  pkill -f "uvicorn app.main:app" 2>/dev/null || true
  sleep 1
  status
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  restart) stop; sleep 1; start ;;
  status) status ;;
  *) echo "用法：./dev.sh [start|stop|restart|status]"; exit 1 ;;
esac