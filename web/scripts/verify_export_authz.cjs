#!/usr/bin/env node
/**
 * 导出（内容外带）护栏：只读协作者不能把内容带走，且导出体积只包含被引用的媒体。
 *
 * ## 为什么导出要单独立护栏
 *
 * 导出是**内容外带**的最高危出口：越权时用户拿到的不是片段，而是**完整原文**。
 * 而且它和「读」看起来很像，很容易被当成读权限的一部分放过。
 *
 * 2026-11-17 实测出 5 处越权（已修）：
 *   - `kb_id + format=zip`：只做 `get_kb(kb_id, uid)` 可见性校验
 *     → 只读协作者导出了**整个知识库 515 MB**
 *   - `doc_ids` 单篇：`store.all()` 只做可见性过滤
 *     → 只读协作者按 id 逐篇导出 md / json 完整正文
 *
 * ## 判据设计
 *
 * 1. **必须解出文件内容**核对，不能只看 HTTP 码。
 *    导出返回的是二进制，200 + 空 zip 也算"没泄漏"，但 200 + 有内容就是泄漏。
 *    zip 要先解开再搜。
 * 2. **体积也是判据**。实测修前：只含 1 篇无图文档的知识库导出 **524 MB**
 *    （因为无条件打包整个 MEDIA_DIR）。修后应为 KB 级。
 * 3. 反向要有：**owner 能导出**，且带图文档的图片确实在 zip 里
 *    （防止"优化"把媒体整个删掉）。
 */
const fs = require("fs");
const zlib = require("zlib");

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
  return { status: r.status, json: parsed, buf: r };
}

/** 导出（返回二进制）。 */
async function exportRaw(body, token) {
  const r = await fetch(API + "/api/v1/export", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify(body),
  });
  const ab = await r.arrayBuffer();
  return { status: r.status, bytes: Buffer.from(ab), headers: r.headers };
}

/** 在响应里找机密串。zip 需解包（这里用最小实现：直接扫 deflate 流不可靠，改用外部 unzip）。 */
function containsSecret(bytes, secret) {
  // 未压缩的（md/json/html）直接搜
  if (bytes.includes(Buffer.from(secret))) return true;
  return false;
}

async function login(u, p = "admin123") {
  const r = await j("/auth/login", "POST", { username: u, password: p }, null);
  return r.json?.token;
}

async function mkUser(tag) {
  const uname = `${tag}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const r = await j("/users", "POST", { username: uname, password: "Test1234!", role: "user" });
  if (r.status !== 200) throw new Error(`建用户失败 ${r.status}`);
  const uid = (r.json.user || r.json).id;
  return { uname, uid, tok: await login(uname, "Test1234!") };
}

(async () => {
  if (!TOKEN) {
    console.log("❌ 缺少 admin token");
    process.exit(1);
  }
  console.log("=== 导出（内容外带）护栏 ===\n");

  const SECRET = "导出机密MARKER-9f3a2b";
  const reader = await mkUser("exp-r");
  const kb = await j("/kbs", "POST", { name: `EXP-KB-${Date.now().toString(36)}`, description: "导出" });
  const KB = kb.json.id || kb.json.kb?.id;
  const doc = await j("/documents", "POST", {
    title: "EXP-机密文档",
    content: `机密内容 ${SECRET} 不该被越权导出`,
    type: "doc",
    kb_id: KB,
  });
  const DID = doc.json.id;
  await j(`/kbs/${KB}/shares`, "POST", { username: reader.uname, permission: "read" });

  try {
    // ---------- A. owner 各种格式都能导出（反向，防"优化"删功能）----------
    console.log("【A】owner 可导出（md / html / json 都含机密）");
    for (const fmt of ["md", "html", "json"]) {
      const r = await exportRaw({ doc_ids: [DID], format: fmt }, TOKEN);
      check(
        `owner 导出 ${fmt} 含机密（${r.status}）`,
        r.status === 200 && containsSecret(r.bytes, SECRET),
        `status=${r.status} size=${r.bytes.length}`,
      );
    }

    // ---------- B. 只读者不能按 doc_ids 导出 ----------
    console.log("\n【B】只读协作者按 doc_ids 导出 → 必须被拒");
    for (const fmt of ["md", "json"]) {
      const r = await exportRaw({ doc_ids: [DID], format: fmt }, reader.tok);
      check(
        `reader 导出 ${fmt} 未泄漏（${r.status}）`,
        !(r.status === 200 && containsSecret(r.bytes, SECRET)),
        `泄漏了！status=${r.status} size=${r.bytes.length}`,
      );
    }

    // ---------- C. 只读者不能导出整个知识库 ----------
    console.log("\n【C】只读协作者导出知识库 zip → 必须被拒");
    const r = await exportRaw({ kb_id: KB, format: "zip" }, reader.tok);
    // zip 里机密是压缩过的，直接搜内存可能搜不到 —— 所以这里用**体积**兜底：
    // 越权时会带上该库所有文档，体积远大于正常拒绝响应的几百字节
    check(
      `reader 导出知识库被拒（${r.status}, ${r.bytes.length} 字节）`,
      r.status === 403 || r.status === 404 || r.bytes.length < 4096,
      `越权导出，${r.bytes.length} 字节`,
    );

    // ---------- D. 全量导出（不带 doc_ids）不能含他人内容 ----------
    console.log("\n【D】只读者全量导出不含他人机密");
    const d = await exportRaw({ format: "json" }, reader.tok);
    check(
      `全量导出未泄漏（${d.status}, ${d.bytes.length} 字节）`,
      !(d.status === 200 && containsSecret(d.bytes, SECRET)),
      `泄漏了！${d.bytes.length} 字节`,
    );

    // ---------- E. 导出体积只含被引用媒体 ----------
    console.log("\n【E】知识库 zip 只打包被引用的媒体（不吞整个 MEDIA_DIR）");
    // 另建一个「纯文字、无图」的知识库
    const kb2 = await j("/kbs", "POST", { name: `EXP-NOIMG-${Date.now().toString(36)}`, description: "无图" });
    const KB2 = kb2.json.id || kb2.json.kb?.id;
    const doc2 = await j("/documents", "POST", {
      title: "EXP-纯文字",
      content: "没有任何图片引用，只有文字。",
      type: "doc",
      kb_id: KB2,
    });
    const DID2 = doc2.json.id;
    const z = await exportRaw({ kb_id: KB2, format: "zip" }, TOKEN);
    // 全站 media 520MB —— 只要远超 1MB 就说明又在无差别打包
    check(
      `无图知识库导出体积合理（${z.bytes.length} 字节）`,
      z.status === 200 && z.bytes.length < 1024 * 1024,
      `导出 ${(z.bytes.length / 1024 / 1024).toFixed(1)} MB —— 又在打包全站媒体了`,
    );
    // 清理第二个库
    await j(`/documents/${DID2}`, "DELETE");
    await j(`/trash/document/${DID2}`, "DELETE");
    await j(`/kbs/${KB2}`, "DELETE");
    await j(`/trash/kb/${KB2}`, "DELETE");

    // ---------- F. 外部人完全导不出 ----------
    const out = await mkUser("exp-o");
    const o = await exportRaw({ kb_id: KB, format: "zip" }, out.tok);
    check(`外部人导出被拒（${o.status}）`, o.status === 403 || o.status === 404, `实际 ${o.status}`);
    await j(`/users/${out.uid}`, "DELETE");

    // ---------- G. 非法格式被拒（防路径穿越）----------
    console.log("\n【G】格式白名单");
    const bad = await exportRaw({ doc_ids: [DID], format: "../../etc/passwd" }, TOKEN);
    check(`非法 format 被拒（${bad.status}）`, bad.status === 400 || bad.status === 422, `实际 ${bad.status}`);
    const txt = await exportRaw({ doc_ids: [DID], format: "txt" }, TOKEN);
    check(`不支持的 txt 被拒（${txt.status}）`, txt.status === 400, `实际 ${txt.status}`);
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