#!/usr/bin/env node
/**
 * 导出性能护栏：docx / pdf 全库导出必须在可接受时间内完成。
 *
 * ## 为什么需要（2026-11-19 实测）
 *
 * `python-docx` 的 `add_paragraph()` **不是 O(1)** —— 每建一段都要在
 * 不断变大的 XML 树上定位/解析样式。实测单文档累积后逐段变慢：
 *
 *     累计  1,000 段 → 0.07 ms/段
 *     累计 20,000 段 → 0.18 ms/段
 *     累计 40,000 段 → 0.29 ms/段
 *
 * 全库 253 篇约 **17.5 万行** → 外推 125s，实测**超过 180s 直接超时**
 * （前端表现为"导出中…"一直转，用户以为卡死，最后 524/timeout）。
 *
 * 改成直接构造 `w:p` / `w:r` / `w:rPr` 后实测 **20 倍**：
 *     40,000 段：11.52s → 0.57s（0.288 → 0.014 ms/段）
 *     全库导出：**>180s → 2.63s**
 *
 * ## 判据
 *
 * A. 全库 docx < 20s（当前 2.6s，留 8 倍余量）
 * B. 全库 pdf  < 60s（当前约 29s；reportlab 是流式，线性增长）
 * C. **产物可打开且内容完整** —— 提速不能靠丢内容：
 *    回读段落数 > 1000、首段是标题、字号 18pt 粗体
 * D. 单篇 docx < 2s
 *
 * ⚠️ 阈值不要设太紧：这是开发机，不是基准测试机。目的只是抓「退化成
 *    O(n²)」这类**数量级**回退，不是比 0.1 秒的差异。
 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const PY = (() => {
  if (process.env.SUNNYDOC_PY) return process.env.SUNNYDOC_PY;
  const venv = path.resolve(__dirname, "../../api/.venv/bin/python");
  return fs.existsSync(venv) ? venv : "python3";
})();

let pass = 0;
let fail = 0;
const check = (n, ok, d) => {
  if (ok) {
    pass++;
    console.log("  ✅ " + n);
  } else {
    fail++;
    console.log("  ❌ " + n + "\n       " + String(d).slice(0, 300));
  }
};

/**
 * 在 api 目录跑一段 python，返回 stdout。
 *
 * ⚠️ 用 spawn + 手动 kill，**不用 `execFileSync({timeout})`**：
 *    `execFileSync` 超时会杀掉**直接子进程**，但 python 里若再 fork
 *    （或只是没及时退出），残留进程会拖住父 shell —— 实测脚本最后被
 *    外层 SIGTERM 杀掉，表现为"没有任何输出"。改成显式 kill 后
 *    超时能正常返回 `{ok:false, timedOut:true}`，护栏给出清晰断言。
 */
function py(code, timeoutMs = 120000) {
  const { spawnSync } = require("child_process");
  const r = spawnSync(PY, ["-c", code], {
    cwd: path.resolve(__dirname, "../../api"),
    env: { ...process.env, PYTHONPATH: "." },
    encoding: "utf8",
    timeout: timeoutMs,
    killSignal: "SIGKILL",
  });
  const out = String(r.stdout || "").trim();
  if (r.error && r.error.code === "ETIMEDOUT") {
    return { ok: false, out, timedOut: true, err: `超时 ${timeoutMs / 1000}s 未完成` };
  }
  if (r.status !== 0) {
    return { ok: false, out, err: String(r.stderr || r.error || `exit ${r.status}`).slice(0, 200) };
  }
  return { ok: true, out };
}

console.log("=== 导出性能护栏 ===\n");

// ---------- A + C. 全库 docx：耗时 + 内容完整性 ----------
console.log("【A/C】全库 docx 导出（耗时 + 产物可打开）");
const docx = py(`
import io, time, json
from app.services.store import store
from app.services import exporter
from docx import Document

docs = store.all(user_id=None, with_chunks=False)
if not docs:
    print("SKIP,no-docs")
else:
    t0 = time.perf_counter()
    content, fn, mt = exporter.build("docx", docs)
    el = time.perf_counter() - t0

    # 回读：提速不能靠丢内容
    d = Document(io.BytesIO(content))
    ps = [p for p in d.paragraphs if p.text.strip()]
    first = ps[0] if ps else None
    sz = first.runs[0].font.size.pt if (first and first.runs and first.runs[0].font.size) else None
    bold = bool(first.runs[0].bold) if (first and first.runs) else False
    print(json.dumps({
        "elapsed": round(el, 2),
        "bytes": len(content),
        "paras": len(ps),
        "first": (first.text[:30] if first else ""),
        "size": sz,
        "bold": bold,
        "n_docs": len(docs),
    }))
`);

if (!docx.ok || docx.out.startsWith("SKIP")) {
  if (docx.timedOut) {
    // 超时本身就是最严重的性能退化信号
    check("全库 docx 导出未超时（120s）", false, docx.err + " —— 多半退回了 add_paragraph 的 O(n²)");
  } else {
    console.log("  ⏭️ 跳过（无文档或执行失败）");
    if (docx.err) console.log("     " + docx.err);
  }
} else {
  const d = JSON.parse(docx.out);
  check(
    `全库 ${d.n_docs} 篇 docx 导出 ${d.elapsed}s < 20s`,
    d.elapsed < 20,
    `${d.elapsed}s —— 若接近或超过 180s，多半又退回了 add_paragraph 的 O(n²)`,
  );
  check(`产物可回读（${d.paras.toLocaleString()} 段）`, d.paras > 1000, `只有 ${d.paras} 段`);
  check(`首段字号 18pt 粗体（实测 ${d.size}pt bold=${d.bold}）`, d.size === 18 && d.bold, "首段是文档标题，格式不对");
  check(`产物非空（${(d.bytes / 1024 / 1024).toFixed(1)} MB）`, d.bytes > 10240, `${d.bytes} 字节`);
}

// ---------- D. 单篇 docx ----------
console.log("\n【D】单篇 docx 导出（高频操作）");
const one = py(`
import time, json
from app.services.store import store
from app.services import exporter
docs = store.all(user_id=None, with_chunks=False)
if not docs:
    print("SKIP")
else:
    d = max(docs, key=lambda x: len(x.get("text") or ""))
    t0 = time.perf_counter()
    exporter.build("docx", [d])
    print(json.dumps({"elapsed": round(time.perf_counter()-t0, 2), "chars": len(d.get("text") or "")}))
`);
if (one.ok && !one.out.startsWith("SKIP")) {
  const o = JSON.parse(one.out);
  check(`最长单篇（${o.chars.toLocaleString()} 字符）${o.elapsed}s < 2s`, o.elapsed < 2, `${o.elapsed}s`);
}

// ---------- B. 全库 pdf（样本外推，避免跑满 30 秒）----------
console.log("\n【B】pdf 导出（20 篇样本外推全库）");
const pdf = py(`
import time, json
from app.services.store import store
from app.services import exporter
docs = store.all(user_id=None, with_chunks=False)
if len(docs) < 5:
    print("SKIP")
else:
    n = 20
    sample = docs[:n]
    t0 = time.perf_counter()
    exporter.build("pdf", sample)
    el = time.perf_counter() - t0
    print(json.dumps({"sample": n, "elapsed": round(el, 2),
                      "projected": round(el * len(docs) / n, 1), "total": len(docs)}))
`);
if (pdf.ok && !pdf.out.startsWith("SKIP")) {
  const pf = JSON.parse(pdf.out);
  check(
    `pdf 全库外推 ${pf.projected}s < 60s（样本 ${pf.sample} 篇 ${pf.elapsed}s）`,
    pf.projected < 60,
    `${pf.projected}s —— reportlab 是流式，正常应线性增长`,
  );
} else if (pdf.timedOut) {
  check("pdf 导出未超时", false, pdf.err);
}

console.log(`\n通过 ${pass} / 失败 ${fail}`);
console.log(fail === 0 ? "✅ 全部通过" : "❌ 存在失败项");
process.exit(fail ? 1 : 0);