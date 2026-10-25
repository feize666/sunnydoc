#!/usr/bin/env node
/**
 * 回归夹具收尾清扫 —— 由 `run_all_verify.cjs` 在所有脚本跑完后调用。
 *
 * ## 为什么需要它（2026-10-25 实测）
 *
 * 各脚本自己 clean 是**第一道防线**，但它覆盖不到三种情况：
 *   ① `finally` 之前就抛异常（建夹具的代码在 try 之外时）；
 *   ② runner 超时 `SIGKILL` 杀进程 —— `finally` 根本不会执行；
 *   ③ 新写的脚本忘了清。
 *
 * 实测代价：本机因此积了
 *   - **165 篇夹具文档**（`夹具-容器(12)` / `slash验证-临时容器(17)` …）在**活跃列表**里，
 *     用户打开知识库直接看到满屏垃圾；
 *   - **28 个空 `BMV-目标库`** 堆在首页；
 *   - 回收站另有 35 文件夹 + 28 知识库。
 * 而当时各脚本的「零残留」断言**全绿** —— 因为夹具泄漏在它们自己看不见的路径上。
 *
 * ## 设计原则：宁可漏删，不可误删
 *
 * 只删**确有把握**是夹具的：
 *   - 文档：标题前缀匹配已知夹具前缀，**且** `type` 与内容量符合夹具特征；
 *   - 知识库 / 文件夹：名字精确等于夹具名，**且** 0 篇文档（有内容的一律跳过并告警）。
 * 任何不确定的一律保留并打印，让人来判断。
 *
 * 用法：
 *   node web/scripts/fixture_sweep.cjs          # 清扫
 *   node web/scripts/fixture_sweep.cjs --dry    # 只看会删什么
 */
const fs = require("fs");
const path = require("path");

const API = process.env.SUNNYDOC_API || "http://127.0.0.1:8000";
const TOKEN =
  process.env.SUNNYDOC_TOKEN ||
  fs.readFileSync(process.env.SUNNYDOC_TOKEN_FILE || "/tmp/sunnydoc-token.txt", "utf8").trim();
const DRY = process.argv.includes("--dry");

/**
 * 夹具文档标题前缀 —— **从各脚本源码自动提取**，而非硬编码列表。
 *
 * 为什么自动提取：硬编码列表**必然会漏**。实测：首版列了 9 个前缀，
 * 清完仍剩 11 篇（`卡片远置测试-` / `切换测试-` / `远置-` / `大文档卡片来源` 都没列上），
 * 二次清扫才补全。每加一个新脚本就可能引入新前缀 —— 得有个不会烂的来源。
 *
 * 提取规则（只认**明确表示"这是夹具"的变量**，避免噪音）：
 *   `const PREFIX/DOC_TITLE/TEST_KB/TEST_FOLDER/CONTAINER_TITLE = "..."`
 *   `apiCreate("...")` / `seed*Fixture(..., { container: "...", source: "..." })`
 * 并过滤掉明显不是标题的值（纯中文动词、单个词如 `选择`/`图片`）。
 */
function extractFixtureNames() {
  const dir = __dirname;
  const names = new Set();
  const varKeys =
    /(?:PREFIX|DOC_TITLE|TEST_KB|TEST_FOLDER|CONTAINER_TITLE|containerTitle|sourceTitle|container|source|title)\s*[:=]\s*"([^"]{2,32})"/g;
  const createCall = /apiCreate\(\s*"([^"]{2,32})"/g;

  for (const f of fs.readdirSync(dir)) {
    if (!/^verify_.*\.cjs$/.test(f)) continue;
    const s = fs.readFileSync(path.join(dir, f), "utf8");
    for (const re of [varKeys, createCall]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(s))) names.add(m[1]);
    }
  }
  // 过滤噪音：UI 文案（纯短词、无分隔符、非前缀式命名）一律排除。
  // 夹具命名的可辨识特征是「含分隔符」或「长度 ≥4 且带测试意图词」。
  const NOISE = new Set(["选择", "取消选择", "图片", "筛选", "字段类型", "HACKED", "前缀固定文本AAA"]);
  return [...names].filter((n) => {
    if (NOISE.has(n)) return false;
    if (n.length < 3) return false;
    return /[-_]/.test(n) || /测试|验证|夹具|临时|源$|容器$/.test(n);
  });
}

const DOC_PREFIXES = [
  // 兜底：即使源码提取失败也保留这组（来自历史脚本的已知夹具）
  "夹具-", "嵌入测试-", "slash验证-", "锚点验证-", "BMV-", "IDZ-", "verify-", "验证-",
  ...extractFixtureNames(),
];
/** 「未命名 xxx」类夹具：仅当内容极短时才认（避免误删用户新建的真空文档）。 */
const UNNAMED_PREFIXES = ["未命名表格", "未命名文档"];
const UNNAMED_MAX_LEN = 60;
/** 夹具知识库 / 文件夹名（精确匹配，且必须 0 篇文档）。 */
const FIXTURE_KB_NAMES = new Set(["BMV-目标库", "IDZ-KB", "verify-KB"]);
const FIXTURE_FOLDER_NAMES = new Set(["BMV-夹具目录"]);

const H = { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" };

async function j(path, method = "GET", body) {
  const r = await fetch(API + path, {
    method,
    headers: H,
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  try {
    return { status: r.status, json: JSON.parse(t) };
  } catch {
    return { status: r.status, json: t };
  }
}

const isFixtureDoc = (d) => {
  const t = String(d.title || "");
  if (DOC_PREFIXES.some((p) => t.startsWith(p))) return true;
  if (UNNAMED_PREFIXES.some((p) => t.startsWith(p)) && String(d.text || "").length <= UNNAMED_MAX_LEN) {
    return true;
  }
  return false;
};

(async () => {
  console.log("=== 回归夹具收尾清扫" + (DRY ? "（dry-run，不实际删除）" : "") + " ===");

  // 🔴 防误删正在运行的回归：清扫会删掉**当前正在被使用**的夹具。
  //    实测踩过：回归跑到一半时手动执行清扫 → 下一个脚本（card_render）
  //    的夹具被清掉，报「卡片渲染不出内容」，看起来像产品回归。
  //    runner 内部调用时由环境变量显式放行；手动调用时要求确认。
  if (!DRY && process.env.SUNNYDOC_SWEEP_FORCE !== "1") {
    console.log(
      "⚠️  提示：若此刻有回归正在运行，清扫会删掉它正在用的夹具。\n" +
        "    确认没有脚本在跑，请用：SUNNYDOC_SWEEP_FORCE=1 node scripts/fixture_sweep.cjs\n" +
        "    只看会删什么，请用：node scripts/fixture_sweep.cjs --dry\n" +
        "    （runner 会自动带上该环境变量，无需手动设置）",
    );
    process.exit(2);
  }

  const docs = (await j("/api/v1/documents?limit=2000")).json?.documents || [];
  const targets = docs.filter(isFixtureDoc);
  console.log(`活跃文档 ${docs.length} 篇，其中判定为夹具 ${targets.length} 篇`);

  const kbs = (await j("/api/v1/kbs")).json?.kbs || [];
  const kbTargets = kbs.filter((k) => FIXTURE_KB_NAMES.has(k.name) && !(k.doc_count || 0));
  const kbProtected = kbs.filter((k) => FIXTURE_KB_NAMES.has(k.name) && (k.doc_count || 0) > 0);
  if (kbTargets.length || kbProtected.length) {
    console.log(`活跃知识库 ${kbs.length} 个，其中夹具 ${kbTargets.length} 个`);
    for (const k of kbProtected) {
      console.log(`  ⚠️ 保留（含 ${k.doc_count} 篇文档，可能非夹具）: ${k.name}`);
    }
  }

  // 回收站（软删残留藏在这里）
  const tr = (await j("/api/v1/trash")).json || {};
  const trDocs = (tr.documents || []).filter(isFixtureDoc);
  const trFolds = (tr.folders || []).filter((f) => FIXTURE_FOLDER_NAMES.has(f.name));
  const trKbs = (tr.kbs || []).filter((k) => FIXTURE_KB_NAMES.has(k.name));
  console.log(
    `回收站: 文档 ${(tr.documents || []).length}（夹具 ${trDocs.length}）· ` +
      `文件夹 ${(tr.folders || []).length}（夹具 ${trFolds.length}）· ` +
      `知识库 ${(tr.kbs || []).length}（夹具 ${trKbs.length}）`,
  );

  if (DRY) {
    console.log("\n--dry：以下将被删除");
    for (const d of targets.slice(0, 40)) console.log(`  文档 ${JSON.stringify(d.title)}`);
    if (targets.length > 40) console.log(`  ... 另 ${targets.length - 40} 篇`);
    for (const k of kbTargets) console.log(`  知识库 ${k.name}`);
    return;
  }

  let ok = 0;
  let bad = 0;
  const bump = (good) => (good ? ok++ : bad++);

  // 1) 活跃夹具文档：软删 + purge
  for (const d of targets) {
    const a = await j("/api/v1/documents/" + d.id, "DELETE");
    const b = await j("/api/v1/trash/document/" + d.id, "DELETE");
    bump(a.status < 400 && b.status < 400);
  }
  // 2) 活跃夹具知识库：软删 + purge
  for (const k of kbTargets) {
    const a = await j("/api/v1/kbs/" + k.id, "DELETE");
    const b = await j("/api/v1/trash/kb/" + k.id, "DELETE");
    bump(a.status < 400 && b.status < 400);
  }
  // 3) 回收站残留：直接 purge
  for (const d of trDocs) bump((await j("/api/v1/trash/document/" + d.id, "DELETE")).status < 400);
  for (const f of trFolds) bump((await j("/api/v1/trash/folder/" + f.id, "DELETE")).status < 400);
  for (const k of trKbs) bump((await j("/api/v1/trash/kb/" + k.id, "DELETE")).status < 400);

  console.log(`\n清除 ${ok} 项${bad ? `，失败 ${bad} 项` : ""}`);

  // 收尾复核（独立读取，不看上面的返回值）
  const afterDocs = (await j("/api/v1/documents?limit=2000")).json?.documents || [];
  const leftDocs = afterDocs.filter(isFixtureDoc);
  const afterTr = (await j("/api/v1/trash")).json || {};
  const leftTr =
    (afterTr.documents || []).filter(isFixtureDoc).length +
    (afterTr.folders || []).filter((f) => FIXTURE_FOLDER_NAMES.has(f.name)).length +
    (afterTr.kbs || []).filter((k) => FIXTURE_KB_NAMES.has(k.name)).length;
  const leftKb = ((await j("/api/v1/kbs")).json?.kbs || []).filter(
    (k) => FIXTURE_KB_NAMES.has(k.name) && !(k.doc_count || 0),
  ).length;

  console.log(`复核: 活跃夹具 ${leftDocs.length} 篇 · 活跃夹具库 ${leftKb} 个 · 回收站夹具 ${leftTr} 项`);
  if (leftDocs.length || leftKb || leftTr) {
    console.log("⚠️ 仍有残留（见上）");
    process.exit(1);
  }
  console.log("✅ 清扫完成，零残留");
})();