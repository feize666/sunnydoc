#!/usr/bin/env node
/**
 * 真机/接口验证「跨用户越权（IDOR）防护」—— 纯 HTTP，不依赖浏览器。
 *
 * 为什么需要它：全量回归 30+ 个脚本里，**没有任何一条覆盖 `/pin` 与 `/unpin`**
 * （`grep -rn "/pin|/unpin" web/scripts/` → 0 命中）。这正是缺陷长期存活的原因：
 * 「同一资源的多个动词，鉴权容易只写一个」——`POST /documents/{id}/pin` 有归属
 * 校验，`POST /{id}/unpin` 没有，而没人测它。
 *
 * 本轮实测到的真实漏洞（已修，本脚本用于防复发）：
 *   - `POST /documents/{id}/unpin`：store.set_pinned 只按 id 改字段、不接收 user_id，
 *     未先校验归属 → 任何登录用户可凭 id 取消**他人**文档的置顶
 *     （实测 u2 → u1 的文档 unpin 返回 200，u1 回读 pinned 变为 false）。
 *   - `POST /folders/{id}/pin` 与 `/unpin`：同一缺陷，且**两个动词都没有**校验。
 *
 * 设计要点（为什么这么写）：
 *  - **必须两个用户对照**：只用一个用户测不出越权 —— 自己改自己的当然成功。
 *  - **必须有「前提断言」**：先确认属主置顶成功（pinned === true），
 *    否则「攻击后仍为 true」可能只是因为**根本没置顶成功**，判据失去区分度。
 *  - **用独立管理员账号创建/删除测试用户**，结束后清理（含知识库与文件夹）。
 *
 * 用法：
 *   NODE_PATH=<托管 node_modules> node web/scripts/verify_authz_idor.cjs
 */
const fs = require("fs");

const TOKEN =
  process.env.SUNNYDOC_TOKEN ||
  fs.readFileSync(process.env.SUNNYDOC_TOKEN_FILE || "/tmp/sunnydoc-token.txt", "utf8").trim();
const API = process.env.SUNNYDOC_API || "http://127.0.0.1:8000";
/** 夹具前缀 —— 便于事后辨认与清理 */
const PREFIX = "IDZ-";

let fail = 0;
const check = (n, c, d = "") => {
  if (c) console.log("  ✅ " + n);
  else {
    fail++;
    console.log("  ❌ " + n + "  " + String(d).slice(0, 220));
  }
};

const req = async (path, method = "GET", body, token) => {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  const r = await fetch(API + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 可能是空/非 JSON */
  }
  return { status: r.status, json, text };
};

const login = async (username, password) => {
  const r = await req("/api/v1/auth/login", "POST", { username, password });
  return r.json && r.json.token;
};

(async () => {
  console.log("=== 跨用户越权（IDOR）防护验证 ===\n");

  const adminToken = TOKEN;
  const me = await req("/api/v1/auth/me", "GET", undefined, adminToken);
  if (me.status !== 200) {
    console.error("管理员 token 无效（HTTP " + me.status + "），无法继续");
    process.exit(1);
  }

  // ---------- 准备两个无关用户 ----------
  const u1name = PREFIX + "u1";
  const u2name = PREFIX + "u2";
  const created = { users: [], kbs: [], folders: [], docs: [] };

  for (const name of [u1name, u2name]) {
    const r = await req("/api/v1/users", "POST",
      { username: name, password: "test123456", role: "user" }, adminToken);
    if (r.json && r.json.user) created.users.push(r.json.user.id);
  }
  const t1 = await login(u1name, "test123456");
  const t2 = await login(u2name, "test123456");

  check("已创建两个无关测试用户并登录", !!t1 && !!t2, `t1=${!!t1} t2=${!!t2}`);
  if (!t1 || !t2) {
    console.error("无法建立双用户环境，终止");
    process.exit(1);
  }

  // ---------- A. 文档 置顶 / 取消置顶 ----------
  console.log("\n【A】文档 pin / unpin");
  const kb = (await req("/api/v1/kbs", "POST", { name: PREFIX + "KB" }, t1)).json;
  if (kb && kb.id) created.kbs.push({ id: kb.id, token: t1 });
  const doc = (await req("/api/v1/documents", "POST", {
    title: PREFIX + "机密文档", content: "# 私有内容", type: "doc", kb_id: kb.id,
  }, t1)).json;
  if (doc && doc.id) created.docs.push({ id: doc.id, token: t1 });

  // 前提：属主置顶成功
  const pin = await req(`/api/v1/documents/${doc.id}/pin`, "POST", undefined, t1);
  const after = (await req(`/api/v1/documents/${doc.id}`, "GET", undefined, t1)).json;
  check("前提：属主置顶成功（pinned === true）", after && after.pinned === true,
    `HTTP=${pin.status} pinned=${after && after.pinned}`);

  // 攻击：u2 取消 u1 文档的置顶
  const attack = await req(`/api/v1/documents/${doc.id}/unpin`, "POST", undefined, t2);
  check("u2 调 unpin 被拒绝（应 403/404）", attack.status >= 400,
    `HTTP=${attack.status} ${attack.text.slice(0, 90)}`);

  const afterAttack = (await req(`/api/v1/documents/${doc.id}`, "GET", undefined, t1)).json;
  check("属主置顶未被篡改（pinned 仍为 true）", afterAttack && afterAttack.pinned === true,
    `pinned=${afterAttack && afterAttack.pinned}` +
      (afterAttack && afterAttack.pinned === false ? "  ← 被越权取消" : ""));

  // 对照组：有校验的动词必须拒绝（证明判据不是恒真）
  const ctrlPin = await req(`/api/v1/documents/${doc.id}/pin`, "POST", undefined, t2);
  check("对照：u2 调 pin 亦被拒绝（说明校验确实存在）", ctrlPin.status >= 400,
    `HTTP=${ctrlPin.status}`);

  // 读接口也应拒绝
  const read = await req(`/api/v1/documents/${doc.id}`, "GET", undefined, t2);
  check("u2 读取该文档被拒绝", read.status >= 400, `HTTP=${read.status}`);

  // 改名 / 删除 也应拒绝
  const ren = await req(`/api/v1/documents/${doc.id}/rename`, "PUT", { title: "HACKED" }, t2);
  check("u2 改名被拒绝", ren.status >= 400, `HTTP=${ren.status}`);
  const del = await req(`/api/v1/documents/${doc.id}`, "DELETE", undefined, t2);
  check("u2 删除被拒绝", del.status >= 400, `HTTP=${del.status}`);

  // ---------- B. 文件夹 置顶 / 取消置顶 ----------
  console.log("\n【B】文件夹 pin / unpin（两个动词原先都无校验）");
  const folder = (await req("/api/v1/folders", "POST", { name: PREFIX + "FLD" }, t1)).json;
  if (folder && folder.id) created.folders.push({ id: folder.id, token: t1 });

  const fpin = await req(`/api/v1/folders/${folder.id}/pin`, "POST", undefined, t1);
  check("前提：属主置顶文件夹成功", fpin.status === 200, `HTTP=${fpin.status}`);

  const fattackU = await req(`/api/v1/folders/${folder.id}/unpin`, "POST", undefined, t2);
  check("u2 取消他人文件夹置顶被拒绝", fattackU.status >= 400,
    `HTTP=${fattackU.status} ${fattackU.text.slice(0, 80)}`);

  const fattackP = await req(`/api/v1/folders/${folder.id}/pin`, "POST", undefined, t2);
  check("u2 置顶他人文件夹被拒绝", fattackP.status >= 400,
    `HTTP=${fattackP.status} ${fattackP.text.slice(0, 80)}`);

  // 属主视角复核：仍为置顶
  const fl = (await req("/api/v1/folders", "GET", undefined, t1)).json;
  const mine = ((fl && fl.folders) || []).find((f) => f.id === folder.id);
  check("属主文件夹置顶未被篡改", !mine || mine.pinned === true,
    mine ? `pinned=${mine.pinned}` : "（列表中未含，跳过）");

  // ---------- C. 无 token 一律 401 ----------
  console.log("\n【C】未登录访问受保护资源");
  for (const path of ["/api/v1/documents", "/api/v1/kbs", "/api/v1/users",
                      "/api/v1/trash", "/api/v1/settings/ai", "/api/v1/audit-logs"]) {
    const r = await req(path, "GET");
    check(`未登录 GET ${path} → 401`, r.status === 401, `HTTP=${r.status}`);
  }

  // ---------- 清理 ----------
  console.log("\n【清理】");
  for (const d of created.docs) {
    await req(`/api/v1/documents/${d.id}`, "DELETE", undefined, d.token);
    await req(`/api/v1/trash/document/${d.id}`, "DELETE", undefined, adminToken);
  }
  for (const f of created.folders) {
    await req(`/api/v1/folders/${f.id}`, "DELETE", undefined, f.token);
  }
  for (const k of created.kbs) {
    await req(`/api/v1/kbs/${k.id}`, "DELETE", undefined, k.token);
  }
  for (const u of created.users) {
    await req(`/api/v1/users/${u}`, "DELETE", undefined, adminToken);
  }

  // 零残留核对：文档（活跃 + 回收站）、文件夹、用户
  const live = (await req("/api/v1/documents?limit=1000", "GET", undefined, adminToken)).json;
  const trash = (await req("/api/v1/trash", "GET", undefined, adminToken)).json;
  const leftLive = ((live && live.documents) || []).filter((d) => String(d.title).startsWith(PREFIX));
  const leftTrash = ((trash && trash.documents) || []).filter((d) => String(d.title).startsWith(PREFIX));
  const users = (await req("/api/v1/users", "GET", undefined, adminToken)).json;
  const leftUsers = (((users && users.users) || users) || []).filter((u) =>
    String(u.username || "").startsWith(PREFIX));

  check("零残留（活跃列表无夹具）", leftLive.length === 0,
    JSON.stringify(leftLive.map((d) => d.title)));
  check("零残留（回收站无夹具）", leftTrash.length === 0,
    JSON.stringify(leftTrash.map((d) => d.title)));
  check("零残留（测试用户已删除）", leftUsers.length === 0,
    JSON.stringify(leftUsers.map((u) => u.username)));

  console.log("\n" + (fail === 0 ? "全部通过" : `失败 ${fail} 项`));
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error("脚本异常:", e);
  process.exit(1);
});