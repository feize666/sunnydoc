#!/bin/bash
# ============================================================
# sunnydoc 一键部署 + 推送脚本
# 用法：./deploy.sh "commit 信息"
# 流程：本机构建前端 → 打包源码 scp 服务器 → 服务器 git commit/push + 重启后端
# ============================================================
set -e

SERVER="root@180.184.86.246"
DEPLOY_DIR="/var/www/sunnydoc"
LOCAL_DIR="$(cd "$(dirname "$0")" && pwd)"
MSG="${1:-chore: 更新 sunnydoc}"

cd "$LOCAL_DIR"

echo "==> [1/4] 构建前端静态产物..."
# NEXT_PUBLIC_API_BASE 置空 → api.ts 走相对路径 /api/v1，由 nginx 反代到后端
# （.env.local 里写的是本地开发用的 http://localhost:8000，绝不能被带进生产构建）
(cd web && env -u NODE_OPTIONS NEXT_PUBLIC_API_BASE= npm run build)

echo "==> [2/4] 打包源码并上传服务器..."
tar --exclude='web/node_modules' --exclude='web/.next' --exclude='api/.venv' \
    --exclude='api/data' --exclude='api/__pycache__' --exclude='.workbuddy' \
    --exclude='api/.env' --exclude='web/.env.local' --exclude='.git' \
    -czf /tmp/sunnydoc_src.tgz README.md .gitignore deploy.sh web/ api/
scp -o StrictHostKeyChecking=no -q /tmp/sunnydoc_src.tgz "$SERVER:/tmp/"

echo "==> [3/4] 服务器解压 + 更新部署产物 + 重启后端 + git 推送..."
ssh -o StrictHostKeyChecking=no "$SERVER" "cd $DEPLOY_DIR && \
  tar -xzf /tmp/sunnydoc_src.tgz -C $DEPLOY_DIR 2>/dev/null; \
  find . -name '._*' -delete; \
  rm -rf mvp-ui/* 2>/dev/null || true; \
  cp -r web/out/* mvp-ui/ 2>/dev/null || true; \
  systemctl restart sunnydoc-api; \
  git add -A && \
  git -c user.name='Feize' -c user.email='fei2210ze@163.com' commit -m \"$MSG\" && \
  GIT_SSH_COMMAND='ssh -o StrictHostKeyChecking=no' git push origin main"

echo "==> [4/4] 完成。访问：http://180.184.86.246:85"
