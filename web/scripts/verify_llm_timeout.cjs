#!/usr/bin/env node
/**
 * LLM 超时配置护栏 —— 防止「分阶段超时当总时长用」这类回归。
 *
 * ## 为什么需要它（2026-11-10 实测缺陷）
 *
 * 并发问 4 个问题时，其中一个
 * 「nginx 做负载均衡有哪些调度算法？」卡了 **1352 秒（22.5 分钟）**，其余 5~8 秒。
 *
 * 根因是 `timeout=60.0` 的语义被误解：
 *
 *     httpx.Timeout(60.0)  →  connect=60, read=60, write=60, pool=60
 *
 * 这是**分阶段**超时。`read=60` 是「**每次**从 socket 读的间隔上限」，
 * 不是整条请求的总时长 —— 服务端慢速吐字 / 网关半死不断连时，
 * 请求可以远超 60 秒。所以必须有**总时长**兜底。
 *
 * ## 判据（三层，缺一不可）
 *
 * A. **常量语义正确**：`LLM_TIMEOUT` 必须是 httpx.Timeout 且各阶段都有界
 *    （曾出现只给一个浮点，等于四阶段各 60s，无总上限）
 * B. **总时长兜底真实生效**：对一个「接受连接但永不响应」的服务器发请求，
 *    必须在 deadline + 余量内抛 LLMError（而不是一直挂着）
 * C. **正常路径不受影响**：真实问答仍能正常返回（不是把所有请求都掐断）
 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const API = process.env.SUNNYDOC_API || "http://127.0.0.1:8000";
const TOKEN =
  process.env.SUNNYDOC_TOKEN ||
  fs.readFileSync(process.env.SUNNYDOC_TOKEN_FILE || "/tmp/sunnydoc-token.txt", "utf8").trim();

const PY = (() => {
  if (process.env.SUNNYDOC_PY) return process.env.SUNNYDOC_PY;
  const venv = path.resolve(__dirname, "../../api/.venv/bin/python");
  return fs.existsSync(venv) ? venv : "python3";
})();

let pass = 0;
let fail = 0;
const check = (name, ok, detail) => {
  if (ok) {
    pass++;
    console.log("  ✅ " + name);
  } else {
    fail++;
    console.log("  ❌ " + name + "\n       " + String(detail).slice(0, 300));
  }
};

/** 在 api 目录下跑一段 Python（要 import app.services.llm）。 */
function py(code, timeoutMs = 90000) {
  try {
    const out = execFileSync(PY, ["-c", code], {
      cwd: path.resolve(__dirname, "../../api"),
      env: { ...process.env, PYTHONPATH: "." },
      encoding: "utf8",
      timeout: timeoutMs,
    });
    return { ok: true, out: out.trim() };
  } catch (e) {
    return { ok: false, out: String(e.stdout || "").trim(), err: String(e.message || e).slice(0, 200) };
  }
}

(async () => {
  console.log("=== LLM 超时配置护栏 ===\n");

  // ---------- A. 常量语义 ----------
  console.log("【A】超时常量的阶段都有界（不能是裸浮点）");
  const a = py(`
import app.services.llm as m
import httpx
for name in ("LLM_TIMEOUT", "LLM_STREAM_TIMEOUT"):
    t = getattr(m, name)
    assert isinstance(t, httpx.Timeout), f"{name} 不是 httpx.Timeout: {type(t)}"
    for stage in ("connect", "read", "write", "pool"):
        v = getattr(t, stage)
        assert v is not None and v > 0, f"{name}.{stage} 无界: {v}"
d = m.LLM_TOTAL_DEADLINE
assert isinstance(d, (int, float)) and 0 < d <= 180, f"deadline 不合理: {d}"
print(f"OK read={m.LLM_TIMEOUT.read} stream_read={m.LLM_STREAM_TIMEOUT.read} deadline={d}")
`);
  check("三个超时常量定义正确且各阶段有界", a.ok && a.out.startsWith("OK"), a.out || a.err);

  // ---------- B. 总时长兜底真实生效 ----------
  console.log("\n【B】黑洞服务器下 deadline 必须生效（把 deadline 调到 6s 便于验证）");
  const b = py(`
import os, socket, threading, time
import app.services.llm as m

srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
srv.bind(("127.0.0.1", 0)); srv.listen(5)
port = srv.getsockname()[1]
held = []
def serve():
    while True:
        try: held.append(srv.accept()[0])   # 持有连接，永不回包
        except OSError: return
threading.Thread(target=serve, daemon=True).start()

m.LLM_TOTAL_DEADLINE = 6.0
m.LLM_TIMEOUT = m.httpx.Timeout(connect=3.0, read=60.0, write=3.0, pool=3.0)

t0 = time.time()
try:
    m._post_with_deadline(f"http://127.0.0.1:{port}/v1/chat", {}, {})
    msg = "NOHANG"
except m.LLMError as e:
    el = time.time() - t0
    # 允许 +3s 余量（线程调度/解析）
    msg = f"{'OK' if el <= 9.0 else 'SLOW'} {el:.2f}"
except Exception as e:
    msg = f"WRONG {type(e).__name__}"
# ⚠️ 先把结果 flush 出去，再硬退出：
#    被放弃的那个 httpx 线程还挂在 read=60 上，正常退出会等它（实测踩过）。
#    但 os._exit 不刷新 stdout 缓冲 —— 不 flush 会拿到空输出。
print(msg, flush=True)
os._exit(0)
`, 40_000);
  const bParts = b.out.split(/\s+/);
  check(
    `黑洞服务器下 ≤9s 抛 LLMError（实际 ${bParts[1] || "?"}s）`,
    b.ok && bParts[0] === "OK",
    b.out || b.err,
  );

  // ---------- C. 正常路径不受影响 ----------
  console.log("\n【C】真实问答仍能正常返回（不是把请求全掐断）");
  const r = await fetch(`${API}/api/v1/chat`, {
    method: "POST",
    headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ query: "K8S 集群怎么部署高可用？", enable_web: false }),
  }).catch((e) => ({ ok: false, status: 0, _err: String(e.message) }));
  if (!r.ok) {
    check("真实问答返回 200", false, `status=${r.status} ${r._err || ""}`);
  } else {
    const d = await r.json();
    const ans = d.answer || "";
    check(`真实问答返回 200 且答案非空（${ans.length} 字）`, ans.length > 50, ans.slice(0, 120));
    check(`引用条数合理（${(d.citations || []).length} 条）`, (d.citations || []).length > 0, JSON.stringify(d.citations).slice(0, 150));
  }

  console.log(`\n通过 ${pass} / 失败 ${fail}`);
  console.log(fail === 0 ? "✅ 全部通过" : "❌ 存在失败项");
  process.exit(fail ? 1 : 0);
})();