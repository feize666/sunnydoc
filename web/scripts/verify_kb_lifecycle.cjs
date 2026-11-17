#!/usr/bin/env node
/**
 * 知识库生命周期与「旁路」护栏：删掉知识库后，里面的内容不能还有别的入口。
 *
 * ## 为什么需要
 *
 * 一个文档的「入口」不止 `/documents/{id}` 一个。实测存在或曾经存在的旁路：
 *
 * - **收藏列表**：用户收藏过 → 「我的收藏」里还列着，点进去能不能读？
 * - **版本历史**：版本按 `doc_id` 挂在文档下，文档不可见时列表必须为空
 * - **搜索结果**：搜索走的是另一条 SQL 路径，可能没带上权限过滤
 * - **回收站**：知识库软删后，文档是被一起软删，还是留在了活跃列表？
 *
 * 这几条单独看都「有鉴权」，但**它们各自实现一遍权限**，
 * 只要有一处漏了过滤，内容就泄漏了 —— 所以必须逐条实测。
 *
 * ## 判据
 *
 * A. 知识库软删 → 详情 / 列表 / 收藏 / 版本 全部无泄漏
 * B. 回收站恢复 → 权限自动恢复（不能「删一次就永久坏掉」）
 * C. 彻底删除知识库 → 下辖文档与共享级联清理，不留残骸
 *
 * ⚠️ 收藏这条尤其要注意：`favorites` 是独立表，按 `user_id` 存。
 *    它的列表接口如果不 join 文档可见性，就会变成一个长期存在的后门。
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
    console.log("  ❌ " + n + "\n       " + String(d).slice(0, 300));
  }
};
const denied = (st) => st === 403 || st === 404;

async function j(path, method = "GET", body, token = TOKEN) {
  const h = { "Content-Type": "application/json" };
  if (token) h.Authorization = "Bearer " + token;
  const r = await fetch(API + "/api/v1" + path, {
    method,
    headers: h,
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
  const uname = `${tag}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const r = await j("/users", "POST", { username: uname, password: "Test1234!", role: "user" });
  if (r.status !== 200) throw new Error(`建用户失败 ${r.status}`);
  return { uname, uid: (r.json.user || r.json).id, tok: await login(uname, "Test1234!") };
}

(async () => {
  if (!TOKEN) {
    console.log("❌ 缺少 admin token");
    process.exit(1);
  }
  console.log("=== 知识库生命周期与旁路护栏 ===\n");

  console.log("【准备】reader + 知识库 + 文档 + 收藏 + 历史版本");
  const reader = await mkUser("life-r");
  const kb = await j("/kbs", "POST", { name: `LIFE-KB-${Date.now().toString(36)}`, description: "生命周期" });
  const KB = kb.json.id || kb.json.kb?.id;
  const doc = await j("/documents", "POST", {
    title: "LIFE-机密文档",
    content: "生命周期机密内容AAA",
    type: "doc",
    kb_id: KB,
  });
  const DID = doc.json.id;
  await j(`/kbs/${KB}/shares`, "POST", { username: reader.uname, permission: "read" });
  // 制造旁路素材：收藏 + 历史版本
  await j(`/documents/${DID}/favorite`, "POST", {}, reader.tok);
  await j(`/documents/${DID}`, "PUT", { content: "生命周期机密内容BBB" });

  try {
    const pre = await j(`/documents/${DID}`, "GET", null, reader.tok);
    const preFav = await j("/favorites", "GET", null, reader.tok);
    check("前置：reader 能读", pre.status === 200, pre.status);
    check(
      "前置：收藏列表里有它（旁路素材已就位）",
      (preFav.json.documents || []).some((x) => x.id === DID),
      "收藏未生效，本条用例无意义",
    );

    // ---------- A. 知识库软删 → 所有入口立即失效 ----------
    console.log("\n【A】知识库软删 → 详情 / 列表 / 收藏 / 版本 全部无泄漏");
    const del = await j(`/kbs/${KB}`, "DELETE");
    check("知识库软删成功", del.status === 200, del.status);

    const a1 = await j(`/documents/${DID}`, "GET", null, reader.tok);
    check(`详情被拒（${a1.status}）`, denied(a1.status), `仍可读: ${a1.status}`);

    const a2 = await j("/documents?limit=1000", "GET", null, reader.tok);
    check("文档列表无泄漏", !(a2.json.documents || []).some((x) => x.id === DID), "仍在列表");

    const a3 = await j("/favorites", "GET", null, reader.tok);
    check(
      "收藏列表无泄漏（favorites 是独立表，最容易漏）",
      !(a3.json.documents || []).some((x) => x.id === DID),
      "收藏成了长期后门",
    );

    // 版本只有「列出某文档的版本」一个端点，无按 version_id 单取的端点
    const a4 = await j(`/documents/${DID}/versions`, "GET", null, reader.tok);
    const versN = (a4.json.versions || []).length;
    check(`版本列表无泄漏（${a4.status}，${versN} 条）`, denied(a4.status) || versN === 0, `泄漏 ${versN} 条`);

    // ---------- B. 恢复后权限自动回来 ----------
    console.log("\n【B】回收站恢复 → 权限自动恢复");
    const rs = await j(`/trash/kb/${KB}/restore`, "POST", null);
    check("恢复知识库成功", rs.status === 200, rs.status);
    const b1 = await j(`/documents/${DID}`, "GET", null, reader.tok);
    check(`恢复后 reader 又能读（${b1.status}）`, b1.status === 200, "删一次就永久坏掉");

    // ---------- C. 彻底删除 → 级联清理 ----------
    console.log("\n【C】彻底删除知识库 → 文档与共享级联清理");
    await j(`/kbs/${KB}`, "DELETE");
    const pg = await j(`/trash/kb/${KB}`, "DELETE");
    check("彻底删除知识库成功", pg.status === 200, pg.status);

    const c1 = await j(`/documents/${DID}`, "GET", null, TOKEN);
    check(`连 admin 也取不到该文档（${c1.status}）`, denied(c1.status), `仍存在: ${c1.status}`);

    const c2 = await j("/trash?limit=100", "GET", null, TOKEN);
    check(
      "文档未遗留在回收站",
      !(c2.json.documents || []).some((x) => x.id === DID),
      "文档还躺在回收站里（用户看不到但也没真删）",
    );
  } finally {
    await j(`/documents/${DID}`, "DELETE").catch(() => {});
    await j(`/trash/document/${DID}`, "DELETE").catch(() => {});
    await j(`/kbs/${KB}`, "DELETE").catch(() => {});
    await j(`/trash/kb/${KB}`, "DELETE").catch(() => {});
    await j(`/users/${reader.uid}`, "DELETE").catch(() => {});
    console.log("\n  夹具已清理");
  }

  console.log(`\n通过 ${pass} / 失败 ${fail}`);
  console.log(fail === 0 ? "✅ 全部通过" : "❌ 存在失败项");
  process.exit(fail ? 1 : 0);
})();