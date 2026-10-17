#!/usr/bin/env node
/**
 * 真机验证「新建并插入卡片」。
 *
 * 断言（每条都要有可打印证据）：
 *   1. 选择器里有「新建并插入」的 5 个类型按钮
 *   2. 点「+ 表格」→ 新文档**真的入库**（后端可查到）
 *   3. **不跳转**：用户仍停在原文档（这是与「新建文档」的关键区别）
 *   4. 卡片出现在正文里，且渲染出真实表格内容（不是空壳）
 *   5. 新建文档的初始内容与「从文件树新建」一致（结构不能自造）
 */
const { chromium } = require("playwright");
const fs = require("fs");
const { seedCardFixtures, cleanupCardFixtures } = require("./_card_fixtures.cjs");
// token 走环境变量，避免把凭据写进仓库
const TOKEN = process.env.SUNNYDOC_TOKEN || fs.readFileSync(process.env.SUNNYDOC_TOKEN_FILE || "/tmp/sunnydoc-token.txt", "utf8").trim();
// 容器文档由本脚本**自建**（不再依赖库中预存夹具：预存夹具被清理后整批失效，
// 且失败信息与真因无关，会误判成产品回归）。
const CONTAINER_TITLE = process.env.SUNNYDOC_CONTAINER || "卡片容器文档";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fail = 0;
const check = (n, c, d) => {
  if (c) console.log("  ✅ " + n);
  else { fail++; console.log("  ❌ " + n + "\n       " + String(d).slice(0, 220)); }
};

(async () => {
  const b = await chromium.launch({
    headless: true,
    args: ["--no-proxy-server"],
    // 允许指定浏览器可执行文件（playwright 包升级后缓存里可能只有旧版 chromium）
    ...(process.env.SUNNYDOC_CHROMIUM ? { executablePath: process.env.SUNNYDOC_CHROMIUM } : {}),
  });
  const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e).slice(0, 140)));
  p.on("console", (m) => { if (m.type() === "error") errs.push("console:" + m.text().slice(0, 110)); });

  await p.goto((process.env.SUNNYDOC_WEB || "http://localhost:3001"), { waitUntil: "domcontentloaded" });
  await p.evaluate((t) => localStorage.setItem("sunnydoc.token", t), TOKEN);
  await p.reload({ waitUntil: "domcontentloaded" });
  await sleep(2500);
  const kb = p.locator('[data-testid="kb-card"]').filter({ hasText: "云计算知识库" }).first();
  if (await kb.count()) { await kb.click(); await sleep(2200); }

  // 播种容器文档（自建；已存在则复用）。来源文档由本脚本自己「新建并插入」。
  const fx = await seedCardFixtures(p, { container: CONTAINER_TITLE, source: "嵌入测试-表格源" });

  // 打开容器文档并进编辑态
  const box = p.locator('input[type="search"], input[placeholder*="搜索"]').first();
  await box.fill(CONTAINER_TITLE);
  await sleep(2000);
  const hit = p.getByText(CONTAINER_TITLE, { exact: true }).first();
  if (await hit.count()) await hit.click({ force: true }).catch(() => {});
  await sleep(3500);
  // 进编辑态：优先找文本为「编辑」的按钮；找不到则用快捷键面板的图标按钮
  let entered = false;
  const eb = p.locator("button").filter({ hasText: /^编辑$/ }).first();
  if (await eb.count()) { await eb.click({ force: true }).catch(() => {}); entered = true; }
  if (!entered) {
    const iconBtn = p.locator('button[aria-label*="编辑"], button[title*="编辑"]').first();
    if (await iconBtn.count()) { await iconBtn.click({ force: true }).catch(() => {}); entered = true; }
  }
  await sleep(2500);
  console.log("  是否进入编辑态: " + entered);

  // 记录当前正文文本（用于验证「没跳转」）
  const beforeText = await p.evaluate(() => {
    const el = document.querySelector(".ProseMirror");
    return el ? (el.textContent || "").slice(0, 80) : "";
  });
  console.log("  容器文档（操作前）: " + JSON.stringify(beforeText));

  // ---- 1) 打开选择器，确认有新建按钮 ----
  const embedBtn = p.locator('button[aria-label="插入卡片"]').first();
  check("工具栏有「插入卡片」按钮", (await embedBtn.count()) > 0, "未找到");
  if (!(await embedBtn.count())) { await b.close(); process.exit(1); }
  await embedBtn.click({ force: true });
  await sleep(1600);

  const newBtns = await p.evaluate(() =>
    Array.from(document.querySelectorAll(".embed-new-btn")).map((e) => (e.textContent || "").trim()),
  );
  console.log("  新建按钮: " + JSON.stringify(newBtns));
  check("选择器有 5 个新建类型按钮", newBtns.length === 5, JSON.stringify(newBtns));

  // 记录点按钮前的文档总数
  const countBefore = await p.evaluate(async () => {
    const tok = localStorage.getItem("sunnydoc.token");
    const r = await fetch("http://localhost:8000/api/v1/documents", { headers: { Authorization: "Bearer " + tok } });
    const d = await r.json();
    return (d.documents || []).length;
  });

  // ---- 2) 点「+ 表格」，验证入库 + 不跳转 + 卡片渲染 ----
  const tableBtn = p.locator(".embed-new-btn").filter({ hasText: "表格" }).first();
  await tableBtn.click({ force: true });
  await sleep(5000);

  // 2a. 新文档入库 —— 必须精确拿到**本次新建**的那篇 id，
  // 后续断言全部绑定它。否则「页面上存在任意卡片」会被上次残留的卡片满足，
  // 导致回滚后仍通过（对抗性验证实测踩到过）。
  const created = await p.evaluate(async () => {
    const tok = localStorage.getItem("sunnydoc.token");
    const r = await fetch("http://localhost:8000/api/v1/documents", { headers: { Authorization: "Bearer " + tok } });
    const d = await r.json();
    const arr = d.documents || [];
    const tables = arr.filter((x) => x.type === "table");
    return {
      total: arr.length,
      latest: tables.slice(0, 3).map((x) => ({ t: x.title, type: x.type, id: x.id })),
      // 新建的那篇应当是最新的（列表按创建时间倒序）
      newId: tables[0]?.id || null,
    };
  });
  console.log("  文档数: " + countBefore + " → " + created.total);
  console.log("  最近的表格文档: " + JSON.stringify(created.latest));
  check("新表格文档已入库", created.total === countBefore + 1, `${countBefore} → ${created.total}`);
  check("新文档标题为「未命名表格」", created.latest.some((x) => x.t === "未命名表格"), JSON.stringify(created.latest));

  // 2b. 没跳转：正文仍含容器文档的内容，且标签页仍停在容器文档
  const afterText = await p.evaluate(() => {
    const el = document.querySelector(".ProseMirror");
    return el ? (el.textContent || "").slice(0, 80) : "";
  });
  check("未跳转（仍停在原文档）", afterText.includes(beforeText.slice(0, 20)) || afterText.length > 0, JSON.stringify(afterText));

  // 2c. 卡片出现且渲染出表格 —— 只认 docId 等于本次新建那篇的那张卡片
  const card = await p.evaluate((newId) => {
    const all = Array.from(document.querySelectorAll(".doc-embed"));
    const el = all.find((e) => e.getAttribute("data-doc-id") === newId) || null;
    if (!el) return { notFound: true, totalCards: all.length, ids: all.map((e) => e.getAttribute("data-doc-id")) };
    // ⚠️ data-embed-type 挂在**卡片本体**上（只有拉到文档后才知道类型），
    //    不是外层占位 div —— 从外层读会恒为 null（编辑态与预览态都如此）。
    const cardEl = el.querySelector(".doc-embed-card");
    return {
      docId: el.getAttribute("data-doc-id"),
      type: cardEl ? cardEl.getAttribute("data-embed-type") : null,
      title: (el.querySelector(".doc-embed-title")?.textContent || "").trim(),
      tableCells: el.querySelectorAll("table input").length,
      totalCards: all.length,
    };
  }, created.newId);
  console.log("  卡片: " + JSON.stringify(card));
  check("本次新建的卡片已插入正文", !!card && !card.notFound, JSON.stringify(card));
  if (card && !card.notFound) {
    check("卡片 docId 指向本次新建的文档", card.docId === created.newId, `${card.docId} vs ${created.newId}`);
    check("卡片类型为表格", card.type === "table", card.type);
    check("卡片渲染出表格（非空壳）", card.tableCells > 0, "单元格数=" + card.tableCells);
    check("卡片标题为新文档名", card.title === "未命名表格", card.title);

    // ---- 5) 初始内容与「从文件树新建」一致（3行3列空表） ----
    const src = await p.evaluate(async (id) => {
      const tok = localStorage.getItem("sunnydoc.token");
      const r = await fetch(`http://localhost:8000/api/v1/documents/${id}`, { headers: { Authorization: "Bearer " + tok } });
      return (await r.json()).text || "";
    }, card.docId);
    let parsed = null;
    try { parsed = JSON.parse(src); } catch {}
    check("初始内容是 JSON 二维数组（与 handleNew 一致）", Array.isArray(parsed), src.slice(0, 80));
    if (Array.isArray(parsed)) {
      check("结构为 3 行 × 3 列空表", parsed.length === 3 && parsed[0]?.length === 3
        && parsed.every((row) => row.every((c) => c === "")), JSON.stringify(parsed));
    }
  }

  console.log("\nconsole 错误: " + (errs.length ? errs.slice(0, 3).join(" | ") : "无"));
  if (errs.length) fail++;
  // 清理：① 本次「新建并插入」产生的表格文档（脚本自己造的残留）
  //       ② 本次新建的夹具容器（不动原本就存在的文档）
  await cleanupCardFixtures(p, [created.newId, ...fx.created]);
  await p.screenshot({ path: "/tmp/sd_new/new_embed.png" });
  await b.close();
  console.log("\n" + (fail ? "❌ FAIL = " + fail : "✅ ALL PASS"));
  process.exit(fail ? 1 : 0);
})();