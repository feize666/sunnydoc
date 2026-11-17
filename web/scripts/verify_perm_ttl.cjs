#!/usr/bin/env node
/**
 * 权限时效性护栏：共享撤销 / 降级 / 知识库删除之后，旧权限必须**立即失效**。
 *
 * ## 为什么单独立一个脚本
 *
 * `verify_kb_permission.cjs` 验的是「权限判定本身对不对」；
 * 本脚本验的是「**状态变了之后**判定还对不对」。两者是不同类的缺陷：
 *
 * - 单次鉴权错误 → 一开始就能被发现
 * - 时效性错误 → 第一次全对，**授权变更后才漏**，很容易长期无人发现
 *
 * 载体通常是缓存 / token / 已打开的连接。本项目的权限判定每次都查库，
 * 所以理论上不会漏 —— 但**理论上不会 ≠ 实测过**，必须钉住。
 *
 * ## 覆盖
 *
 * A. 撤销 read 共享 → 详情 / 列表 / 搜索 / 知识库列表 / 知识库详情 全部立即失效
 * B. write 降级为 read → 写动词全部被拒，但**读仍可用**
 * C. 越权尝试后内容确实没变（只看 4xx 不够）
 *
 * ⚠️ 拒绝码可能是 403 也可能是 404：
 *    `_require_doc_write` 明确返回 403；而 `store.update` 拿不到写权限时返回 None
 *    → 路由转 404（404 更不泄露「文档存在」，是可接受的实现选择）。
 *    判据写成 `st===403 || st===404`，**不要死磕某一个**。
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
  if (r.status !== 200) throw new Error(`建用户失败 ${r.status} ${JSON.stringify(r.json).slice(0, 100)}`);
  const uid = (r.json.user || r.json).id;
  const tok = await login(uname, "Test1234!");
  return { uname, uid, tok };
}

(async () => {
  if (!TOKEN) {
    console.log("❌ 缺少 admin token");
    process.exit(1);
  }
  console.log("=== 权限时效性护栏 ===\n");

  console.log("【准备】reader(只读) + writer(可写) + 知识库 + 文档");
  const reader = await mkUser("ttl-r");
  const writer = await mkUser("ttl-w");
  const kb = await j("/kbs", "POST", { name: `TTL-KB-${Date.now().toString(36)}`, description: "时效性" });
  const KB = kb.json.id || kb.json.kb?.id;
  const doc = await j("/documents", "POST", {
    title: "TTL-靶子文档",
    content: "机密内容",
    type: "doc",
    kb_id: KB,
  });
  const DID = doc.json.id;
  await j(`/kbs/${KB}/shares`, "POST", { username: reader.uname, permission: "read" });
  await j(`/kbs/${KB}/shares`, "POST", { username: writer.uname, permission: "write" });

  try {
    // 前置
    const pre1 = await j(`/documents/${DID}`, "GET", null, reader.tok);
    const pre2 = await j(`/documents/${DID}`, "PUT", { content: "writer 改一次" }, writer.tok);
    check("前置：reader 能读", pre1.status === 200, pre1.status);
    check("前置：writer 能写", pre2.status === 200, pre2.status);

    // ---------- A. 撤销 read → 立即失效 ----------
    console.log("\n【A】撤销 read 共享 → 所有读路径立即失效");
    const rm = await j(`/kbs/${KB}/shares/${reader.uid}`, "DELETE");
    check("撤销共享成功", rm.status === 200, rm.status);

    const a1 = await j(`/documents/${DID}`, "GET", null, reader.tok);
    check(`详情被拒（${a1.status}）`, denied(a1.status), `仍可读: ${a1.status}`);

    const a2 = await j("/documents?limit=1000", "GET", null, reader.tok);
    check(
      "文档列表里不再出现",
      !(a2.json.documents || []).some((x) => x.id === DID),
      "文档仍出现在列表",
    );

    const a3 = await j("/search?q=" + encodeURIComponent("机密内容") + "&limit=50", "GET", null, reader.tok);
    check(
      "搜索结果不再泄漏",
      !(a3.json.results || []).some((x) => x.doc_id === DID),
      "搜索仍能命中",
    );

    const a4 = await j("/kbs", "GET", null, reader.tok);
    check("知识库列表里不再出现", !(a4.json.kbs || []).some((x) => x.id === KB), "知识库仍可见");

    const a5 = await j(`/kbs/${KB}`, "GET", null, reader.tok);
    check(`知识库详情被拒（${a5.status}）`, denied(a5.status), `仍可读: ${a5.status}`);

    // ---------- B. 降级 write→read → 立即不能写，但能读 ----------
    console.log("\n【B】write 降级为 read → 写动词全拒，读仍可用");
    const dg = await j(`/kbs/${KB}/shares`, "POST", { username: writer.uname, permission: "read" });
    check("降级成功", dg.status === 200, dg.status);

    const bCases = [
      ["写正文", "PUT", `/documents/${DID}`, { content: "降级后还想写" }],
      ["改标签", "PUT", `/documents/${DID}/tags`, { tags: ["x"] }],
      ["置顶", "POST", `/documents/${DID}/pin`, {}],
      ["复制", "POST", `/documents/${DID}/duplicate`, {}],
    ];
    for (const [name, method, path, body] of bCases) {
      const r = await j(path, method, body, writer.tok);
      check(`降级后${name}被拒（${r.status}）`, denied(r.status), `仍能操作: ${r.status}`);
    }
    const bRead = await j(`/documents/${DID}`, "GET", null, writer.tok);
    check(`降级后仍可读（${bRead.status}）`, bRead.status === 200, "降级把人变成完全不可见，过严");

    // ---------- C. 内容确实没被改动 ----------
    console.log("\n【C】降级后的写尝试没有改动数据");
    const cur = await j(`/documents/${DID}`);
    check("正文仍是降级前的内容", cur.json.text === "writer 改一次", `实际=${JSON.stringify(cur.json.text)}`);
    check("标签未被加", !(cur.json.tags || []).length, `tags=${JSON.stringify(cur.json.tags)}`);
    check("未被置顶", !cur.json.pinned, `pinned=${cur.json.pinned}`);
  } finally {
    await j(`/documents/${DID}`, "DELETE").catch(() => {});
    await j(`/trash/document/${DID}`, "DELETE").catch(() => {});
    await j(`/kbs/${KB}`, "DELETE").catch(() => {});
    await j(`/trash/kb/${KB}`, "DELETE").catch(() => {});
    for (const u of [reader, writer]) await j(`/users/${u.uid}`, "DELETE").catch(() => {});
    console.log("\n  夹具已清理");
  }

  console.log(`\n通过 ${pass} / 失败 ${fail}`);
  console.log(fail === 0 ? "✅ 全部通过" : "❌ 存在失败项");
  process.exit(fail ? 1 : 0);
})();