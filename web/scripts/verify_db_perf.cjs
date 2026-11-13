#!/usr/bin/env node
/**
 * 数据库性能护栏：索引是否齐备 + 分片加载默认值是否安全。
 *
 * ## 为什么需要它（2026-11-12 实测发现）
 *
 * ① **索引缺失**：`chunks` 表 40,242 行**只有主键索引**，按 doc_id 取分片是全表扫；
 *    `documents` 只有 `folder_id` 索引，而全站查询几乎都按 `user_id`/`kb_id`/`deleted_at`。
 *    已补 6 个索引（取分片 6.43ms → 2.62ms）。
 *
 * ② **默认值陷阱，量级惊人**：`store.all()` / `db.all_documents()` 的
 *    `with_chunks` 默认是 `True`，实测：
 *
 *        with_chunks=True  →  5,643 ms   （拉 40,242 个向量进内存）
 *        with_chunks=False →     91 ms   （只要元数据）
 *
 *    **62 倍差距**。而生产链路里**没有任何一处**需要分片（检索走 `db.search_chunks`
 *    在 SQL 层做向量比较）。默认 True 是个等着被踩的陷阱：新代码忘记传参，
 *    列表页就卡 5.6 秒。已把默认值改为 False。
 *
 * ③ **单篇详情的同一陷阱**：`store.get()` / `db.get_document()` 也默认加载分片。
 *    这是**全站最高频**的操作（每打开一篇文档一次），而详情接口一个分片都用不到 ——
 *    实测最大文档（3156 分片）**394ms vs 4.5ms，88 倍**。
 *    并发 20 下 p50 从 250ms 降到 8ms、RPS 71 → 1847。
 *    唯一真正需要旧向量的是 `store.update()` 改正文时的增量复用，已改为按需 `db.load_chunks()`。
 *
 * ## 判据（四条）
 *
 * A. 关键索引存在（按实际查询的 WHERE 设计，不是凭感觉加）
 * B. 默认值安全（不传 with_chunks 时**不含** chunks —— 防止有人改回去）
 * C. 语义等价（传 False 与不传结果一致，且都含全部文档 —— 防止"优化成漏数据"）
 * D. 单篇详情默认不加载分片，但**显式 True 仍能取到**（防止把功能删掉）
 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

let pass = 0;
let fail = 0;
const check = (n, ok, d) => {
  if (ok) {
    pass++;
    console.log("  ✅ " + n);
  } else {
    fail++;
    console.log("  ❌ " + n + "\n       " + String(d).slice(0, 260));
  }
};

const PY = (() => {
  if (process.env.SUNNYDOC_PY) return process.env.SUNNYDOC_PY;
  const venv = path.resolve(__dirname, "../../api/.venv/bin/python");
  return fs.existsSync(venv) ? venv : "python3";
})();

function py(code, timeoutMs = 60000) {
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

// 与 /tmp/add_indexes.py + add_vector_index.py 保持同一份清单
const REQUIRED_INDEXES = [
  "idx_chunks_doc_seg",
  "idx_chunks_vector_hnsw", // 向量召回：208ms → 30~37ms（top-10 与全量重合 9/10）
  "idx_documents_user_kb",
  "idx_documents_kb",
  "idx_documents_deleted",
  "idx_doc_versions_doc",
  "idx_folders_kb",
];

(async () => {
  console.log("=== 数据库性能护栏 ===\n");

  // ---------- A. 索引齐备 ----------
  console.log("【A】关键索引齐备（按实际查询 WHERE 设计）");
  const a = py(`
import psycopg
url = None
for line in open(".env"):
    if line.startswith("DATABASE_URL="):
        url = line.split("=", 1)[1].strip()
url = url.replace("postgresql+psycopg://", "postgresql://")
want = ${JSON.stringify(REQUIRED_INDEXES)}
with psycopg.connect(url, connect_timeout=5) as c:
    with c.cursor() as cur:
        cur.execute("SELECT indexname FROM pg_indexes WHERE schemaname='public'")
        have = {r[0] for r in cur.fetchall()}
print(",".join(sorted(set(want) - have)))
`);
  check(
    `7 个必需索引全部存在`,
    a.ok && a.out === "",
    a.ok ? `缺失: ${a.out}` : a.err,
  );

  // ---------- B. 默认值安全 ----------
  console.log("\n【B】分片加载默认值必须是 False（防 62 倍性能倒退）");
  const b = py(`
import app.services.store as st
import app.services.db as db
import inspect
sig = inspect.signature(st.DocStore.all)
d1 = sig.parameters["with_chunks"].default
sig2 = inspect.signature(db.all_documents)
d2 = sig2.parameters["with_chunks"].default
print(f"{d1},{d2}")
`);
  const [d1, d2] = (b.out || ",").split(",");
  check(`store.all 默认 with_chunks=${d1}`, b.ok && d1 === "False", b.out || b.err);
  check(`db.all_documents 默认 with_chunks=${d2}`, b.ok && d2 === "False", b.out || b.err);

  // ---------- C. 语义等价（不能优化成漏数据）----------
  console.log("\n【C】默认调用与显式 False 语义一致，且不漏文档");
  const c = py(`
import time
import app.services.store as st
import app.services.db as db
uid = None
with db._connect() as c0:
    with c0.cursor() as cur:
        cur.execute("SELECT user_id FROM documents WHERE deleted_at IS NULL AND user_id IS NOT NULL LIMIT 1")
        r = cur.fetchone()
        uid = r[0] if r else None
if not uid:
    print("SKIP,no-user")
else:
    t0 = time.perf_counter()
    default_docs = st.store.all(user_id=uid)          # 不传 with_chunks
    t_default = (time.perf_counter() - t0) * 1000
    t0 = time.perf_counter()
    false_docs = st.store.all(user_id=uid, with_chunks=False)
    t_false = (time.perf_counter() - t0) * 1000
    n_default = len(default_docs)
    n_false = len(false_docs)
    has_chunks = any(d.get("chunks") is not None for d in default_docs)
    print(f"{n_default},{n_false},{int(has_chunks)},{t_default:.0f},{t_false:.0f}")
`);
  if (!c.ok || c.out.startsWith("SKIP")) {
    console.log("  ⏭️ 跳过（无可用用户数据）");
  } else {
    const [n1, n2, hasChunks, t1, t2] = c.out.split(",");
    check(`默认调用不含 chunks（防 62 倍开销）`, hasChunks === "0", `has_chunks=${hasChunks}`);
    check(`默认与显式 False 文档数一致（${n1} 篇）`, n1 === n2, `default=${n1} false=${n2}`);
    check(`默认调用耗时在合理区间（${t1}ms，基准 <1000ms）`, Number(t1) < 1000, `${t1}ms`);
  }

  // ---------- D. 单篇详情不得加载分片 ----------
  // 这是**最高频**的操作（每打开一篇文档一次）。实测最大文档 3156 个分片：
  //   带 chunks 394ms vs 不带 4.5ms（88 倍），而详情接口一个分片都用不到。
  console.log("\n【D】单篇详情默认不加载分片（最高频路径，88 倍差距）");
  const d = py(`
import time
import app.services.store as st
import app.services.db as db
import inspect

sig = inspect.signature(st.DocStore.get)
sd = sig.parameters["with_chunks"].default
sig2 = inspect.signature(db.get_document)
sd2 = sig2.parameters["with_chunks"].default

with db._connect() as c0:
    with c0.cursor() as cur:
        cur.execute("""
            SELECT d.id FROM documents d
            WHERE d.deleted_at IS NULL
            ORDER BY (SELECT count(*) FROM chunks ch WHERE ch.doc_id=d.id) DESC LIMIT 1
        """)
        r = cur.fetchone()
did = r[0] if r else None

if not did:
    print(f"{sd},{sd2},SKIP")
else:
    t0 = time.perf_counter(); doc = st.store.get(did); t_plain = (time.perf_counter()-t0)*1000
    n_plain = len(doc.get("chunks") or [])
    t0 = time.perf_counter(); full = st.store.get(did, with_chunks=True); t_full = (time.perf_counter()-t0)*1000
    n_full = len(full.get("chunks") or [])
    print(f"{sd},{sd2},OK,{t_plain:.1f},{t_full:.1f},{n_plain},{n_full}")
`);
  const dp = (d.out || "").split(",");
  check(`store.get 默认 with_chunks=${dp[0]}`, d.ok && dp[0] === "False", d.out || d.err);
  check(`db.get_document 默认 with_chunks=${dp[1]}`, d.ok && dp[1] === "False", d.out || d.err);
  if (dp[2] === "OK") {
    const [, , , tPlain, tFull, nPlain, nFull] = dp;
    // ⚠️ 这一条**必须走真实调用链**（store.get），不能只看签名默认值：
    //    注入「db.get_document 默认改回 True」时，store.get 会显式传 False 把它覆盖掉，
    //    签名检查能抓到、但「调用结果不含分片」仍显示 ✅ —— 只看签名会漏掉真实链路的退化。
    check(`store.get 真实调用不含分片（实测 ${tPlain}ms / ${nPlain} 个）`, nPlain === "0", `chunks=${nPlain}`);
    // 显式 True 必须仍能取到分片 —— 否则「优化」就把功能删了（改正文的增量向量化依赖它）
    check(`显式 with_chunks=True 仍能取到分片（${nFull} 个）`, Number(nFull) > 0, `chunks=${nFull}`);
    check(
      `默认比全量加载快 ≥5 倍（${tPlain}ms vs ${tFull}ms）`,
      Number(tFull) / Math.max(Number(tPlain), 0.01) >= 5,
      `${tPlain}ms vs ${tFull}ms`,
    );
  }

  console.log(`\n通过 ${pass} / 失败 ${fail}`);
  console.log(fail === 0 ? "✅ 全部通过" : "❌ 存在失败项");
  process.exit(fail ? 1 : 0);
})();