#!/usr/bin/env node
/**
 * 知识库共享的读写边界护栏（27 项）。
 *
 * ## 为什么需要（2026-11-17 实测出 4 处越权）
 *
 * 权限体系里最常见的混淆是：**「能看见」被当成「能修改」**。
 * 很多端点原来写的是
 *
 *     if store.get(doc_id, user["id"]) is None: raise 404
 *
 * 那是**可见性**校验 —— 被共享为 `read` 的协作者看得见，于是校验通过：
 *
 *     改标签      → 200，标签真被改了
 *     置顶/取消   → 200，真被置顶了
 *     复制        → 200，**拿走全文副本到自己名下**（绕过只读）
 *     生成摘要    → 200，写回 summary 字段（还白烧 AI 额度）
 *
 * 已统一改为 `_require_doc_write()`（"写动词一律走写权限校验"）。
 *
 * ## 判据设计的三条原则
 *
 * 1. **不能只看 HTTP 码**：有些端点越权时返回 200 + 空结果（静默吞掉）。
 *    必须**回库核对数据是否真的没变** —— 本脚本末尾那组"数据未被改动"就是干这个的。
 * 2. **区分「容错语义」与「越权」**：`batch-delete` 是多选场景，设计成
 *    「逐个校验、跳过无权限项、返回 skipped 原因」而不是整批 403。
 *    用 HTTP 码判会误判成越权 ⇒ 判据要看 `count===0 && skipped 有原因`。
 * 3. **区分「改文档」与「改自己的关联」**：收藏存的是 `favorites`（按 user_id），
 *    不改文档本身 ⇒ 只读者能收藏共享给他的文档是**合理**的，不该判成越权。
 *
 * ## 角色
 *
 *   owner    —— 知识库属主（用 admin token，管理员视为 owner）
 *   reader   —— 被共享为 read
 *   writer   —— 被共享为 write
 *   outsider —— 完全无关的第三方
 *
 * ⚠️ 本脚本会建 3 个临时用户 + 1 个知识库 + 1 篇文档，结束时全部清理
 *   （删用户会级联清理其数据；知识库/文档要走「软删 + purge」两条）。
 */
const fs = require("fs");

const API = process.env.SUNNYDOC_API || "http://127.0.0.1:8000";
const TOKEN =
  process.env.SUNNYDOC_TOKEN ||
  fs.readFileSync(process.env.SUNNYDOC_TOKEN_FILE || "/tmp/sunnydoc-token.txt", "utf8").trim();

let pass = 0;
let fail = 0;
const check = (n, ok, d) => {
  if (ok) {
    pass++;
    console.log("  ✅ " + n);
  } else {
    fail++;
    console.log("  ❌ " + n + "\n       " + String(d).slice(0, 280));
  }
};

async function j(path, method = "GET", body, token = TOKEN) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  const r = await fetch(API + "/api/v1" + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  let parsed;
  try {
    parsed = JSON.parse(t);
  } catch {
    parsed = { raw: t.slice(0, 200) };
  }
  return { status: r.status, json: parsed };
}

async function login(u, p = "admin123") {
  const r = await j("/auth/login", "POST", { username: u, password: p }, null);
  return r.json?.token;
}

async function mkUser(tag) {
  const uname = `${tag}-${Math.random().toString(36).slice(2, 8)}`;
  const r = await j("/users", "POST", { username: uname, password: "Test1234!", role: "user" });
  if (r.status !== 200) throw new Error(`建用户 ${uname} 失败: ${r.status} ${JSON.stringify(r.json).slice(0, 120)}`);
  const uid = (r.json.user || r.json).id;
  const tok = await login(uname, "Test1234!");
  return { uname, uid, tok };
}

(async () => {
  if (!TOKEN) {
    console.log("❌ 缺少 admin token");
    process.exit(1);
  }
  console.log("=== 知识库共享读写边界护栏 ===\n");

  console.log("【准备】创建 reader / writer / outsider");
  const reader = await mkUser("perm-read");
  const writer = await mkUser("perm-write");
  const outsider = await mkUser("perm-out");

  const kbRes = await j("/kbs", "POST", {
    name: `PERM-KB-${Date.now().toString(36)}`,
    description: "权限矩阵测试",
  });
  const KB = kbRes.json?.id || kbRes.json?.kb?.id;
  const docRes = await j("/documents", "POST", {
    title: "PERM-靶子文档",
    content: "原始内容",
    type: "doc",
    kb_id: KB,
  });
  const DID = docRes.json?.id;
  console.log(`       KB=${KB.slice(0, 8)}  DOC=${String(DID).slice(0, 8)}\n`);

  try {
    const s1 = await j(`/kbs/${KB}/shares`, "POST", { username: reader.uname, permission: "read" });
    const s2 = await j(`/kbs/${KB}/shares`, "POST", { username: writer.uname, permission: "write" });
    check("共享 reader(read) 成功", s1.status === 200, s1.status);
    check("共享 writer(write) 成功", s2.status === 200, s2.status);

    // ---------- A. 只读者：所有改文档的写动词都必须被拒 ----------
    console.log("\n【A】只读协作者改文档一律被拒");
    const cases = [
      ["改正文", "PUT", `/documents/${DID}`, { content: "reader 篡改" }],
      ["改标题", "PUT", `/documents/${DID}`, { title: "reader 改标题" }],
      ["重命名", "PUT", `/documents/${DID}/rename`, { title: "reader 重命名" }],
      ["改标签", "PUT", `/documents/${DID}/tags`, { tags: ["hacked"] }],
      ["置顶", "POST", `/documents/${DID}/pin`, {}],
      ["取消置顶", "POST", `/documents/${DID}/unpin`, {}],
      ["删文档", "DELETE", `/documents/${DID}`, null],
      ["批量移", "POST", "/documents/batch-move", { doc_ids: [DID], kb_id: KB }],
      ["复制", "POST", `/documents/${DID}/duplicate`, {}],
      ["回滚版本", "POST", `/documents/${DID}/rollback/999`, {}],
    ];
    for (const [name, method, path, body] of cases) {
      const r = await j(path, method, body, reader.tok);
      check(`reader ${name} 被拒（${r.status}）`, r.status !== 200, `越权成功: ${JSON.stringify(r.json).slice(0, 160)}`);
    }

    // 容错语义：不能看 HTTP 码，要看 count=0 且 skipped 有原因
    const bd = await j("/documents/batch-delete", "POST", { doc_ids: [DID] }, reader.tok);
    check(
      `reader 批量删：一条都没删（count=${bd.json?.count}）`,
      bd.status === 200 && bd.json?.count === 0 && (bd.json?.skipped || []).length > 0,
      JSON.stringify(bd.json).slice(0, 200),
    );

    // 自有数据：收藏是用户的收藏夹，不改文档，只读者可以做
    const fav = await j(`/documents/${DID}/favorite`, "POST", {}, reader.tok);
    check("reader 可收藏（只影响自己的收藏夹）", fav.status === 200, `实际 ${fav.status}`);

    // ---------- B. 越权尝试后数据必须没变 ----------
    console.log("\n【B】越权尝试后数据零改动（只看 4xx 不够）");
    const cur = await j(`/documents/${DID}`);
    check("正文未被篡改", cur.json?.text === "原始内容", `实际=${JSON.stringify(cur.json?.text)}`);
    check("标题未被改", cur.json?.title === "PERM-靶子文档", `实际=${JSON.stringify(cur.json?.title)}`);
    check("标签未被改", !(cur.json?.tags || []).length, `实际=${JSON.stringify(cur.json?.tags)}`);
    check("未被置顶", !cur.json?.pinned, `pinned=${cur.json?.pinned}`);

    // ---------- C. 可写协作者：能改内容，不能管共享 ----------
    console.log("\n【C】可写协作者能改内容，但不能管理共享/知识库");
    const w1 = await j(`/documents/${DID}`, "PUT", { content: "writer 合法修改" }, writer.tok);
    check("writer 改正文成功", w1.status === 200, w1.status);
    const after = await j(`/documents/${DID}`);
    check("writer 的修改已生效", after.json?.text === "writer 合法修改", `实际=${JSON.stringify(after.json?.text)}`);

    const w2 = await j(`/kbs/${KB}/shares`, "POST", { username: outsider.uname, permission: "read" }, writer.tok);
    check("writer 不能加共享（需 owner）", w2.status === 403 || w2.status === 404, `实际 ${w2.status}`);
    const w3 = await j(`/kbs/${KB}/shares/${reader.uid}`, "DELETE", null, writer.tok);
    check("writer 不能删共享（需 owner）", w3.status === 403 || w3.status === 404, `实际 ${w3.status}`);
    const w4 = await j(`/kbs/${KB}`, "PUT", { name: "writer 改名" }, writer.tok);
    check("writer 不能改知识库名", w4.status === 403 || w4.status === 404, `实际 ${w4.status}`);
    const w5 = await j(`/kbs/${KB}`, "DELETE", null, writer.tok);
    check("writer 不能删知识库", w5.status === 403 || w5.status === 404, `实际 ${w5.status}`);

    // ---------- D. 第三方完全不可见 ----------
    console.log("\n【D】无关第三方完全看不到");
    const o1 = await j(`/documents/${DID}`, "GET", null, outsider.tok);
    check("outsider 读文档被拒", o1.status === 403 || o1.status === 404, `实际 ${o1.status}`);
    const o2 = await j(`/kbs/${KB}`, "GET", null, outsider.tok);
    check("outsider 读知识库被拒", o2.status === 403 || o2.status === 404, `实际 ${o2.status}`);
    const o3 = await j("/documents?limit=1000", "GET", null, outsider.tok);
    const ids = (o3.json?.documents || []).map((x) => x.id);
    check("outsider 列表里看不到该文档", !ids.includes(DID), "文档泄漏到列表");
  } finally {
    // 清理：收藏 → 文档（软删+purge）→ 知识库（软删+purge）→ 用户（级联）
    await j(`/documents/${DID}/favorite`, "DELETE", null, reader.tok).catch(() => {});
    await j(`/documents/${DID}`, "DELETE").catch(() => {});
    await j(`/trash/document/${DID}`, "DELETE").catch(() => {});
    await j(`/kbs/${KB}`, "DELETE").catch(() => {});
    await j(`/trash/kb/${KB}`, "DELETE").catch(() => {});
    for (const u of [reader, writer, outsider]) {
      await j(`/users/${u.uid}`, "DELETE").catch(() => {});
    }
    console.log("\n  夹具已清理");
  }

  console.log(`\n通过 ${pass} / 失败 ${fail}`);
  console.log(fail === 0 ? "✅ 全部通过" : "❌ 存在失败项");
  process.exit(fail ? 1 : 0);
})();