#!/usr/bin/env node
/**
 * 真机验证「标签管理：重命名 / 合并 / 删除」（P4-2 标签体系）。
 *
 * 背景：标签只能逐篇设置（`PUT /documents/{id}/tags`）——打错一个字就得在每篇
 * 文档里逐个改，篇数一多就没人愿意收拾，标签体系会自然腐烂。
 * 本轮补：后端 `GET /tags/stats` + `POST /tags/rename`（空 new = 删除），
 * 前端 `TagManagerDialog`（侧栏「标签」标题行的齿轮按钮）。
 *
 * 断言分三层：
 *   A. 可达层：侧栏标签区有「管理标签」入口，能打开对话框
 *   B. 交互层：列表显示「标签 + N 篇」；点「重命名」进入编辑态
 *   C. 能力层（关键）：重命名后**后端所有相关文档同步更新**、合并**不产生重复**、
 *      删除后标签消失；并核对侧栏标签区同步
 *
 * 12 项断言：
 *   1. 进入知识库、侧栏出现标签区
 *   2. 标签区有「管理标签」入口（data-testid=manage-tags）
 *   3. 打开对话框，出现「标签管理」标题
 *   4. 列表显示标签与篇数（含夹具标签，篇数正确）
 *   5. 点「重命名」出现输入框
 *   6. 重命名成功 → 后端该标签消失、新标签出现且篇数守恒
 *   7. 合并到同名标签不产生重复（同一文档不出现两个同名标签）
 *   8. 删除标签 → 该标签从后端与文档上消失
 *   9. 侧栏标签区同步反映变更（关闭对话框后）
 *  10. new===old 时不产生无意义改动（返回 0）
 *  11. 零残留
 *  12. 运行期无未捕获页面异常
 *
 * 用法：
 *   NODE_PATH=<托管 workspace node_modules> node web/scripts/verify_tag_manager.cjs
 */
const { chromium } = require("playwright");
const fs = require("fs");

const TOKEN =
  process.env.SUNNYDOC_TOKEN ||
  fs.readFileSync(process.env.SUNNYDOC_TOKEN_FILE || "/tmp/sunnydoc-token.txt", "utf8").trim();
const WEB = process.env.SUNNYDOC_WEB || "http://localhost:3001";
const API = process.env.SUNNYDOC_API || "http://localhost:8000";
const KB = "fdef57f179384d679b62a3c4bae2d2e3";
const P = "TGM-"; // 夹具文档前缀
// 夹具标签名（带前缀，避免与真实标签混淆 / 污染）
const TAG_A = "TGM-甲";
const TAG_B = "TGM-乙";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fail = 0;
const check = (n, c, d) => {
  if (c) console.log("  ✅ " + n);
  else {
    fail++;
    console.log("  ❌ " + n + "\n       " + String(d).slice(0, 400));
  }
};

const waitFor = async (fn, ms = 8000, label = "") => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await sleep(150);
  }
  console.log("     (waitFor 超时: " + label + ")");
  return false;
};

(async () => {
  const b = await chromium.launch({ headless: true, args: ["--no-proxy-server"] });
  const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e).slice(0, 160)));
  await p.addStyleTag({
    content: "nextjs-portal{display:none!important;pointer-events:none!important}",
  });

  const api = (path, method = "GET", body) =>
    p.evaluate(
      async ([apiBase, tok, path2, method2, body2]) => {
        const h = { Authorization: "Bearer " + tok, "Content-Type": "application/json" };
        const r = await fetch(apiBase + path2, {
          method: method2,
          headers: h,
          body: body2 ? JSON.stringify(body2) : undefined,
        });
        const t = await r.text();
        try {
          return { status: r.status, json: JSON.parse(t) };
        } catch {
          return { status: r.status, json: t };
        }
      },
      [API, TOKEN, path, method, body],
    );

  const norm = (v) => (Array.isArray(v) ? v : (() => { try { return JSON.parse(v || "[]"); } catch { return []; } })());

  await p.goto(WEB, { waitUntil: "domcontentloaded" });
  await p.evaluate((t) => localStorage.setItem("sunnydoc.token", t), TOKEN);
  await p.reload({ waitUntil: "domcontentloaded" });
  await sleep(2500);

  // ---------- 清理 + 夹具 ----------
  const cleanup = async () => {
    const L = await api("/api/v1/documents?limit=500");
    for (const d of L.json.documents || []) {
      if (d.title && d.title.startsWith(P)) await api("/api/v1/documents/" + d.id, "DELETE");
    }
    for (const t of [TAG_A, TAG_B, "TGM-丙"]) {
      await api("/api/v1/tags/rename", "POST", { old: t, new: "" });
    }
  };
  await cleanup();

  const mk = async (title, tags) => {
    const c = await api("/api/v1/documents", "POST", { title, content: "x", type: "doc", kb_id: KB });
    await api("/api/v1/documents/" + c.json.id + "/tags", "PUT", { tags });
    return c.json.id;
  };
  // d1 同时带 甲+乙（用于验证合并去重）；d2 只带甲；d3 只带乙
  const d1 = await mk(P + "1", [TAG_A, TAG_B]);
  const d2 = await mk(P + "2", [TAG_A]);
  const d3 = await mk(P + "3", [TAG_B]);

  const stats = async () => (await api("/api/v1/tags/stats")).json.tags || [];
  const findTag = async (n) => (await stats()).find((x) => x.tag === n);

  // ---------- 1/2) 进入知识库 + 侧栏标签区 ----------
  const kbCard = p.locator('[data-testid="kb-card"]').filter({ hasText: "云计算知识库" }).first();
  if (await kbCard.count()) await kbCard.click({ force: true });
  else {
    const kb = p.locator("button, a").filter({ hasText: "云计算知识库" }).first();
    if (await kb.count()) await kb.click({ force: true });
  }
  await waitFor(async () => (await p.locator("[data-tree-kind]").count()) > 0, 10000, "进入 KB");
  // 刷新列表，让夹具的标签进入 metas
  const rf = p.locator('[data-testid="refresh-doc-list"]').first();
  if (await rf.count()) {
    await rf.click({ force: true });
    await sleep(3000);
  }
  const hasTagArea = await waitFor(
    async () => (await p.locator('[data-testid="manage-tags"]').count()) > 0,
    8000,
    "标签区管理入口出现",
  );
  check("侧栏出现标签区（存在标签时才渲染）", hasTagArea, "manage-tags 未出现");

  // 标题里的「标签」二字（确认是标签区而非其它按钮）
  const tagAreaText = await p.evaluate(() => (document.body.innerText || "").includes("标签"));
  check("侧栏标签区有「管理标签」入口", hasTagArea && tagAreaText, JSON.stringify({ hasTagArea, tagAreaText }));

  // ---------- 3) 打开对话框 ----------
  await p.locator('[data-testid="manage-tags"]').first().click({ force: true });
  const dlgOpen = await waitFor(
    async () => /标签管理/.test(await p.evaluate(() => document.body.innerText || "")),
    5000,
    "对话框打开",
  );
  check("打开标签管理对话框", dlgOpen, "未出现「标签管理」");

  // ---------- 4) 列表显示标签 + 篇数 ----------
  const listInfo = await p.evaluate(() => {
    const txt = document.body.innerText || "";
    return { txt: txt.slice(0, 600), hasCount: /\d+\s*篇/.test(txt) };
  });
  const aCount = await findTag(TAG_A);
  check(
    `对话框列表显示标签与篇数（${TAG_A} 应有 2 篇）`,
    listInfo.hasCount && aCount?.count === 2,
    JSON.stringify({ hasCount: listInfo.hasCount, aCount, txt: listInfo.txt.slice(0, 200) }),
  );

  // ---------- 5) 点重命名 → 输入框 ----------
  const renameBtn = p.locator(`[data-testid="tag-rename-${TAG_A}"]`).first();
  let inputShown = false;
  if (await renameBtn.count()) {
    await renameBtn.click({ force: true });
    inputShown = await waitFor(
      async () => (await p.locator('[data-testid="tag-rename-input"]').count()) > 0,
      4000,
      "重命名输入框",
    );
  }
  check("点「重命名」出现输入框", inputShown, "未出现 tag-rename-input");

  // ---------- 6) 重命名成功 ----------
  const NEW_NAME = "TGM-丙";
  if (inputShown) {
    const inp = p.locator('[data-testid="tag-rename-input"]').first();
    await inp.fill(NEW_NAME);
    await p.locator('[data-testid="tag-rename-confirm"]').first().click({ force: true });
    await sleep(3000);
  }
  const afterRename = await findTag(NEW_NAME);
  const oldGone = !(await findTag(TAG_A));
  check(
    `重命名后：旧标签消失、新标签出现且篇数守恒（${NEW_NAME} 应 2 篇）`,
    oldGone && afterRename?.count === 2,
    JSON.stringify({ oldGone, afterRename }),
  );
  // 后端文档真的改了
  const d2tags = norm((await api("/api/v1/documents/" + d2)).json.tags);
  check(
    "后端文档标签真的同步更新",
    d2tags.length === 1 && d2tags[0] === NEW_NAME,
    JSON.stringify(d2tags),
  );

  // ---------- 7) 合并到已存在标签：不产生重复 ----------
  // 把 TGM-丙 合并进 TAG_B（d1 同时含 丙 与 乙；d3 只有乙）
  const merge = await api("/api/v1/tags/rename", "POST", { old: NEW_NAME, new: TAG_B });
  const d1tags = norm((await api("/api/v1/documents/" + d1)).json.tags);
  const dupOk = d1tags.length === 1 && d1tags[0] === TAG_B && new Set(d1tags).size === d1tags.length;
  check(
    "合并到同名标签不产生重复（d1 只留一个「乙」）",
    merge.status === 200 && dupOk,
    JSON.stringify({ merge: merge.json, d1tags }),
  );
  const bCount = await findTag(TAG_B);
  check(
    `合并后篇数正确（乙 应 3 篇：d1 + d3 + d2）`,
    bCount?.count === 3,
    JSON.stringify(bCount),
  );

  // ---------- 8) 删除标签 ----------
  const del = await api("/api/v1/tags/rename", "POST", { old: TAG_B, new: "" });
  const goneTag = !(await findTag(TAG_B));
  const d1After = norm((await api("/api/v1/documents/" + d1)).json.tags);
  check(
    "删除标签：标签从统计与文档上同时消失（不残留空串）",
    del.status === 200 && goneTag && d1After.length === 0,
    JSON.stringify({ del: del.json, goneTag, d1After }),
  );

  // ---------- 9) 侧栏标签区同步 ----------
  // 关闭对话框 → 刷新 → 夹具标签应已不在侧栏
  await p.keyboard.press("Escape");
  await sleep(600);
  const closeBtn = p.locator("button").filter({ hasText: /^完成$/ }).first();
  if (await closeBtn.count()) {
    await closeBtn.click({ force: true });
    await sleep(800);
  }
  if (await rf.count()) {
    await rf.click({ force: true });
    await sleep(3000);
  }
  const sidebarTags = await p.evaluate(() => {
    // 侧栏标签 chip 形如 #TAG_X
    return Array.from(document.querySelectorAll("button"))
      .map((e) => (e.textContent || "").trim())
      .filter((t) => t.startsWith("#TGM-"));
  });
  check(
    "侧栏标签区同步反映变更（夹具标签均已消失）",
    sidebarTags.length === 0,
    JSON.stringify(sidebarTags),
  );

  // ---------- 10) new===old 返回 0，不误报 ----------
  const noop = await api("/api/v1/tags/rename", "POST", { old: "任意", new: "任意" });
  check(
    "new===old 时返回 0 改动（不制造无意义写入与审计噪音）",
    noop.status === 200 && noop.json.updated === 0,
    JSON.stringify(noop.json),
  );

  // ---------- 11) 零残留 ----------
  await cleanup();
  const L = await api("/api/v1/documents?limit=500");
  const leftDocs = (L.json.documents || []).filter((d) => d.title && d.title.startsWith(P));
  const leftTags = (await stats()).filter((s) => s.tag.startsWith("TGM-"));
  check(
    "零残留（夹具文档 + 夹具标签）",
    leftDocs.length === 0 && leftTags.length === 0,
    JSON.stringify({ leftDocs: leftDocs.map((d) => d.title), leftTags }),
  );

  // ---------- 12) 无异常 ----------
  check("运行期无未捕获页面异常", errs.length === 0, errs.join(" | "));

  console.log("\n" + (fail === 0 ? "全部通过 ✅" : `失败 ${fail} 项 ❌`));
  await b.close();
  process.exit(fail === 0 ? 0 : 1);
})();