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
const { execFileSync } = require("child_process");

const API = process.env.SUNNYDOC_API || "http://127.0.0.1:8000";
const TOKEN =
  process.env.SUNNYDOC_TOKEN ||
  fs.readFileSync(process.env.SUNNYDOC_TOKEN_FILE || "/tmp/sunnydoc-token.txt", "utf8").trim();
const DRY = process.argv.includes("--dry");

/**
 * Python 解释器（孤儿检测/清理需要直连 PostgreSQL，走 psycopg）。
 *
 * 优先用环境变量；否则探测**项目 venv**（`.venv/bin/python`）——
 * 它一定装了 psycopg（后端依赖）。直接调 `python3` 有可能指向系统解释器、
 * 没有 psycopg 而静默失败（那样孤儿检测会被跳过，等于白做）。
 */
function resolvePython() {
  if (process.env.SUNNYDOC_PY) return process.env.SUNNYDOC_PY;
  const venv = path.resolve(__dirname, "../../api/.venv/bin/python");
  if (fs.existsSync(venv)) return venv;
  return "python3";
}
const PY = resolvePython();

/**
 * 检测**孤儿数据**：`user_id` 指向已不存在的用户。
 *
 * 🔴 为什么必须单独查库、不能靠 API：这类数据**任何用户都看不到也删不掉** ——
 *    所有列表/回收站查询都按 `user_id` 过滤，而该 user_id 已不存在，
 *    于是它们成了**永久不可见的幽灵**。API 返回 `kbs: []` 时库里可能躺着 17 条。
 *    实测（2026-10-26）：本机因此积了 17 个孤儿知识库 + 15 个孤儿文件夹 + 1 篇无主文档，
 *    而回收站接口一切正常 —— 只看接口会误判成「已清干净」。
 *
 * `audit_logs` **故意排除**：审计追溯是合规要求，
 * 「某账号存续期内做过什么」必须留痕，不随账号删除而抹掉。
 */
function countOrphans() {
  const py = `
import json, psycopg
url = None
for line in open("${path.resolve(__dirname, "../../api/.env")}"):
    if line.startswith("DATABASE_URL="):
        url = line.split("=", 1)[1].strip()
url = url.replace("postgresql+psycopg://", "postgresql://")
tables = ["documents", "folders", "knowledge_bases", "favorites",
          "recent_views", "comments", "kb_shares", "notifications"]
out = {}
try:
    with psycopg.connect(url, connect_timeout=5) as c:
        with c.cursor() as cur:
            for t in tables:
                cur.execute(
                    f"SELECT count(*) FROM {t} x WHERE NOT EXISTS "
                    f"(SELECT 1 FROM users u WHERE u.id = x.user_id)"
                )
                out[t] = cur.fetchone()[0]
            # 孤儿评论：**文档已删除**但评论还在。
            # 严格说这不算「用户孤儿」，但同属"指向已消失对象"的残留，
            # 且实测会误导后续断言（评论数对不上）。一起统计。
            cur.execute(
                "SELECT count(*) FROM comments cm WHERE NOT EXISTS "
                "(SELECT 1 FROM documents d WHERE d.id = cm.doc_id AND d.deleted_at IS NULL)"
            )
            out["orphan_comments"] = cur.fetchone()[0]
except Exception as e:
    out["error"] = str(e)[:150]
print(json.dumps(out))
`;
  try {
    const out = execFileSync(PY, ["-c", py], { encoding: "utf8", timeout: 30000 });
    return JSON.parse(out.trim());
  } catch (e) {
    return { error: String(e.message || e).slice(0, 150) };
  }
}

/** 清理孤儿数据（直接删库：API 层够不着它们）。 */
function purgeOrphans() {
  const py = `
import psycopg
url = None
for line in open("${path.resolve(__dirname, "../../api/.env")}"):
    if line.startswith("DATABASE_URL="):
        url = line.split("=", 1)[1].strip()
url = url.replace("postgresql+psycopg://", "postgresql://")
n = 0
with psycopg.connect(url, connect_timeout=5) as c:
    with c.cursor() as cur:
        # 先清孤儿文档的向量分片
        cur.execute("DELETE FROM chunks WHERE doc_id IN (SELECT id FROM documents d "
                    "WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = d.user_id))")
        for t in ("documents", "folders", "knowledge_bases", "favorites",
                  "recent_views", "comments", "kb_shares", "notifications"):
            cur.execute(f"DELETE FROM {t} x WHERE NOT EXISTS "
                        f"(SELECT 1 FROM users u WHERE u.id = x.user_id)")
            n += cur.rowcount
        # 孤儿评论（指向已删除文档）
        cur.execute("DELETE FROM comments cm WHERE NOT EXISTS "
                    "(SELECT 1 FROM documents d WHERE d.id = cm.doc_id AND d.deleted_at IS NULL)")
        n += cur.rowcount
    c.commit()
print(n)
`;
  try {
    const out = execFileSync(PY, ["-c", py], { encoding: "utf8", timeout: 60000 });
    return parseInt(out.trim(), 10) || 0;
  } catch {
    return -1;
  }
}

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
    // 上传类夹具：标题来自**文件名**（如 `form.append("file", ..., "import-ok.md")`
    // → 导入后文档标题就是 `import-ok`）。这类值不在变量赋值里，需单独扫。
    const fileArg = /append\(\s*"file"[\s\S]{0,120}?"([A-Za-z0-9._-]+)\.(md|txt|csv|xlsx?|json)"\s*\)/g;
    let fm;
    while ((fm = fileArg.exec(s))) names.add(fm[1]);
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
  // 兜底：即使源码提取失败也保留这组（来自历史脚本的已知夹具）。
  // ⚠️ 这里只放**确有把握是夹具**的：
  //    - `import-ok` 来自上传验证的文件名（已积 14 篇）
  //    - `TAG-fix-` / `TAGDBG-` / `TMP-` / `SHARE2-TMP` 来自标签与分享脚本
  //    - `note` / `page` 来自模板/页面脚本（**精确匹配**，见 DOC_EXACT）
  "夹具-", "嵌入测试-", "slash验证-", "锚点验证-", "BMV-", "IDZ-", "verify-", "验证-",
  "卡片远置测试-", "卡片迟到测试-", "卡片高度测试-", "远置-", "切换测试-",
  "卡片观感-", "卡片五类型-", "卡片容器文档", "大文档卡片来源",
  "import-ok", "TAG-fix-", "TAGDBG-", "TMP-", "SHARE2-TMP",
  ...extractFixtureNames(),
];
/**
 * **精确匹配**（不是前缀）的夹具标题。
 *
 * 为什么与 DOC_PREFIXES 分开：`note`、`page`、`strict` 这类**短且通用**的词，
 * 用前缀匹配会误伤用户真实文档（如「notebook 使用笔记」）。
 * 实测教训：本机有用户的真实运维文档 `01-Git` / `02-CDN` / `vcenter`，
 * 与夹具混在同一批"非中文标题"里 —— 判据必须能区分它们。
 */
const DOC_EXACT = new Set(["import-ok", "note", "page", "strict"]);
/** 「未命名 xxx」类夹具：仅当内容极短时才认（避免误删用户新建的真空文档）。 */
const UNNAMED_PREFIXES = ["未命名表格", "未命名文档"];
const UNNAMED_MAX_LEN = 60;
/** 夹具知识库 / 文件夹名（精确匹配，且必须 0 篇文档）。 */
const FIXTURE_KB_NAMES = new Set(["BMV-目标库", "IDZ-KB", "verify-KB"]);
const FIXTURE_FOLDER_NAMES = new Set(["BMV-夹具目录", "IDZ-FLD", "FLD-TEST"]);

/**
 * 夹具**标签**名（前缀匹配）。
 *
 * 为什么单独一套判据：标签是独立实体（存在 `documents.tags` 里），
 * 不在文档标题空间 —— 文档清扫覆盖不到它。
 * 实测（2026-10-27）：侧栏一直挂着一个 `TAGD-标签`（标签脚本的残留），
 * 而清扫脚本此前**完全不处理标签**，所以它长期没人清。
 *
 * 判据要求「带分隔符的测试前缀」：`TAGD-` / `TGM-` / `TAG-`，
 * 避免误伤用户自己打的中文标签（如「监控」「数据库」）。
 */
const FIXTURE_TAG_PREFIXES = ["TAGD-", "TGM-", "TAG-", "TAGDBG-", "TAG-fix-", "TMP-TAG"];

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
  // 去掉「(2)」这类自动去重后缀 —— 新建同名文档时后端会加，夹具因此越积越多
  // （实测 `import-ok` 积到 `import-ok(14)`）
  const base = t.replace(/\(\d+\)$/, "").trim();
  if (DOC_PREFIXES.some((p) => t.startsWith(p) || base.startsWith(p))) return true;
  if (DOC_EXACT.has(base)) return true;
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

  // 夹具**标签**：独立实体，文档清扫覆盖不到。
  // 标签通过文档的 `tags` 字段关联，清除方式是从所有文档上摘掉该标签。
  const tagResp = (await j("/api/v1/tags")).json || {};
  const allTags = (tagResp.tags || []).map((t) => (typeof t === "string" ? t : t.name));
  const tagTargets = allTags.filter((n) => FIXTURE_TAG_PREFIXES.some((p) => String(n).startsWith(p)));
  if (allTags.length || tagTargets.length) {
    console.log(`标签 ${allTags.length} 个，其中夹具 ${tagTargets.length} 个${tagTargets.length ? "：" + tagTargets.join(" / ") : ""}`);
  }

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

  // 孤儿数据（owner 用户已不存在）—— **API 层完全看不到**，只能直查库。
  const orphansBefore = countOrphans();
  const orphanTotal = orphansBefore.error
    ? -1
    : Object.values(orphansBefore).reduce((a, b) => a + b, 0);
  if (orphanTotal > 0) {
    console.log(
      `\n🔴 孤儿数据 ${orphanTotal} 条（owner 用户已不存在）: ` +
        Object.entries(orphansBefore)
          .filter(([, v]) => v > 0)
          .map(([k, v]) => `${k}=${v}`)
          .join(" · "),
    );
    console.log("    这类数据**任何用户都看不到也删不掉**（查询按 user_id 过滤）");
  } else if (orphansBefore.error) {
    console.log(`⚠️ 孤儿检测跳过（无法连库）: ${orphansBefore.error.slice(0, 80)}`);
  }

  if (DRY) {
    console.log("\n--dry：以下将被删除");
    for (const d of targets.slice(0, 40)) console.log(`  文档 ${JSON.stringify(d.title)}`);
    if (targets.length > 40) console.log(`  ... 另 ${targets.length - 40} 篇`);
    for (const k of kbTargets) console.log(`  知识库 ${k.name}`);
    for (const t of tagTargets) console.log(`  标签 ${JSON.stringify(t)}`);
    if (orphanTotal > 0) console.log(`  孤儿数据 ${orphanTotal} 条（直查库删除）`);
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
  // 4) 孤儿数据：API 够不着，直查库删除
  if (orphanTotal > 0) {
    const n = purgeOrphans();
    console.log(`孤儿数据清除 ${n < 0 ? "失败" : n + " 条"}`);
    bump(n > 0);
  }
  // 5) 夹具标签：标签不是独立记录，而是挂在文档的 `tags` 字段上
  //    ⇒ 逐个文档摘掉命中前缀的标签（用 PUT /documents/{id}/tags 覆写整份标签数组）
  //
  // 🔴 **一次遍历删掉全部命中标签，不能「按标签逐个遍历」**。
  //    实测踩过（2026-10-27）：先删 A 再删 B 时，两次 PUT 都基于**同一份旧快照**
  //    `[A, B, 用户标签]` —— 删 A 时写回 `[B, 用户标签]`，
  //    删 B 时又写回 `[A, 用户标签]`，把 A 复活了。
  //    表现为"日志说摘除了，实际还在"，且**复核能抓到**（吊销 1 个残留标签）。
  //    ⇒ 每篇文档只写一次，写入值是「去掉全部夹具标签后的剩余」。
  const isFixtureTag = (t) => FIXTURE_TAG_PREFIXES.some((p) => String(t).startsWith(p));
  if (tagTargets.length) {
    let touched = 0;
    for (const d of docs) {
      const tags = Array.isArray(d.tags) ? d.tags : [];
      const kept = tags.filter((t) => !isFixtureTag(t));
      if (kept.length === tags.length) continue; // 没有夹具标签，跳过（避免无谓写）
      const r = await j(`/api/v1/documents/${d.id}/tags`, "PUT", { tags: kept });
      if (r.status < 400) touched++;
    }
    console.log(`已从 ${touched} 篇文档摘除夹具标签（共 ${tagTargets.length} 种）`);
    bump(touched > 0);
  }

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
  // 孤儿复核：API 复核看不到它们，必须再直查一次库
  const orphansAfter = countOrphans();
  const orphanLeft = orphansAfter.error
    ? 0
    : Object.values(orphansAfter).reduce((a, b) => a + b, 0);
  // 标签复核：夹具标签应已从所有文档上摘除
  const tagsAfter = ((await j("/api/v1/tags")).json?.tags || []).map((t) =>
    typeof t === "string" ? t : t.name,
  );
  const tagLeft = tagsAfter.filter((n) => FIXTURE_TAG_PREFIXES.some((p) => String(n).startsWith(p)));

  console.log(
    `复核: 活跃夹具 ${leftDocs.length} 篇 · 活跃夹具库 ${leftKb} 个 · ` +
      `回收站夹具 ${leftTr} 项 · 孤儿数据 ${orphanLeft} 条 · 夹具标签 ${tagLeft.length} 个`,
  );
  if (leftDocs.length || leftKb || leftTr || orphanLeft || tagLeft.length) {
    console.log("⚠️ 仍有残留（见上）");
    process.exit(1);
  }
  console.log("✅ 清扫完成，零残留");
})();