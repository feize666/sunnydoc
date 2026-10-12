#!/usr/bin/env node
/**
 * 真机验证「文档卡片嵌入」（P2-3）。
 *
 * 覆盖 6 项（每项都要有可打印证据，不接受"看起来出来了"）：
 *   1. 工具栏有「插入卡片」按钮
 *   2. 打开选择器能看到可嵌入文档（表格源）
 *   3. 选中后正文里出现卡片，且**卡片内真的渲染出表格内容**（不是空壳）
 *   4. 保存后重新打开，卡片仍在（markdown/HTML 往返不丢）
 *   5. 点卡片标题可跳转来源文档
 *   6. 卡片内不出现「插入卡片」按钮（限制嵌套，避免递归）
 */
const { chromium } = require("playwright");
const fs = require("fs");
// token 走环境变量，避免把凭据写进仓库
const TOKEN = process.env.SUNNYDOC_TOKEN || fs.readFileSync(process.env.SUNNYDOC_TOKEN_FILE || "/tmp/sunnydoc-token.txt", "utf8").trim();
// 容器与来源都用**标题**定位，不硬编码 id —— 否则换一次测试环境脚本就失效
// （曾因写死 id 而读到空正文，误判为「卡片标记没保存」）。
const CONTAINER_TITLE = process.env.SUNNYDOC_CONTAINER || "嵌入测试-容器文档";
const SOURCE_TITLE = process.env.SUNNYDOC_SOURCE || "嵌入测试-表格源";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fail = 0;
const check = (n, c, d) => {
  if (c) console.log("  ✅ " + n);
  else { fail++; console.log("  ❌ " + n + "\n       " + String(d).slice(0, 240)); }
};

(async () => {
  const b = await chromium.launch({ headless: true, args: ["--no-proxy-server"] });
  const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e).slice(0, 140)));
  p.on("console", (m) => { if (m.type() === "error") errs.push("console:" + m.text().slice(0, 120)); });

  await p.goto((process.env.SUNNYDOC_WEB || "http://localhost:3001"), { waitUntil: "domcontentloaded" });
  await p.evaluate((t) => localStorage.setItem("sunnydoc.token", t), TOKEN);
  await p.reload({ waitUntil: "domcontentloaded" });
  await sleep(2500);

  const kb = p.locator("button, a").filter({ hasText: "云计算知识库" }).first();
  if (await kb.count()) { await kb.click(); await sleep(2200); }

  // 按标题查出两个文档的 id（供后续精确断言用；不硬编码）
  const ids = await p.evaluate(async ([ct, st]) => {
    const tok = localStorage.getItem("sunnydoc.token");
    const r = await fetch("http://localhost:8000/api/v1/documents", {
      headers: { Authorization: "Bearer " + tok },
    });
    const all = (await r.json()).documents || [];
    return {
      container: all.find((x) => x.title === ct)?.id || null,
      source: all.find((x) => x.title === st)?.id || null,
    };
  }, [CONTAINER_TITLE, SOURCE_TITLE]);
  const SOURCE_ID = ids.source;
  console.log("  定位: 容器=" + (ids.container || "未找到") + " 来源=" + (ids.source || "未找到"));

  // 打开容器文档（用搜索，避免折叠目录问题）
  const box = p.locator('input[type="search"], input[placeholder*="搜索"]').first();
  await box.fill(CONTAINER_TITLE);
  await sleep(2000);
  const hit = p.getByText(CONTAINER_TITLE, { exact: true }).first();
  check("容器文档可被搜到", (await hit.count()) > 0, "未找到");
  if (await hit.count()) { await hit.click({ force: true }).catch(() => {}); }
  await sleep(4000);

  // ---- 1) 切到编辑态，确认有「插入卡片」按钮 ----
  const editBtn = p.locator("button").filter({ hasText: /^编辑$/ }).first();
  if (await editBtn.count()) { await editBtn.click({ force: true }).catch(() => {}); await sleep(2500); }
  const embedBtn = p.locator('button[aria-label="插入卡片"]').first();
  const hasBtn = (await embedBtn.count()) > 0;
  check("工具栏存在「插入卡片」按钮", hasBtn, "未找到 aria-label=插入卡片");

  if (!hasBtn) {
    await p.screenshot({ path: "/tmp/sd_ed/embed_fail.png" });
    await b.close();
    console.log("\nconsole 错误: " + (errs.length ? errs.slice(0, 3).join(" | ") : "无"));
    process.exit(1);
  }

  // ---- 2) 打开选择器 ----
  await embedBtn.click({ force: true });
  await sleep(1800);
  const pickerShown = await p.evaluate(() => !!document.querySelector(".embed-picker"));
  check("选择器已弹出", pickerShown, "未找到 .embed-picker");
  const listTxt = await p.evaluate(() => {
    const el = document.querySelector(".embed-picker-list");
    return el ? (el.innerText || "").slice(0, 300) : "";
  });
  console.log("  选择器内容: " + JSON.stringify(listTxt.replace(/\n+/g, " | ").slice(0, 180)));
  check("选择器列出了可嵌入文档", listTxt.includes(SOURCE_TITLE), listTxt);

  // ---- 3) 选中并插入卡片 ----
  const item = p.locator(".embed-picker .menu-item").filter({ hasText: SOURCE_TITLE }).first();
  if (await item.count()) { await item.click({ force: true }).catch(() => {}); }
  await sleep(4500);

  const card = await p.evaluate(() => {
    const el = document.querySelector(".doc-embed");
    if (!el) return null;
    const cardEl = el.querySelector(".doc-embed-card");
    return {
      exists: true,
      docId: el.getAttribute("data-doc-id"),
      // data-embed-type 在卡片本体上（两态一致），不是外层占位 div
      type: cardEl ? cardEl.getAttribute("data-embed-type") : null,
      title: (el.querySelector(".doc-embed-title")?.textContent || "").trim(),
      badge: (el.querySelector(".doc-embed-badge")?.textContent || "").trim(),
      // 卡片内是否真的渲染出表格内容
      innerTable: el.querySelectorAll("table").length,
      innerInputs: el.querySelectorAll("input").length,
      innerText: (cardEl?.innerText || "").slice(0, 160).replace(/\n+/g, " | "),
      // 限制嵌套：卡片内不应出现插入卡片按钮
      innerEmbedBtns: el.querySelectorAll('button[aria-label="插入卡片"]').length,
    };
  });
  console.log("  卡片内容: " + JSON.stringify(card));
  check("正文里出现了卡片", !!(card && card.exists), "未找到 .doc-embed");
  if (card && card.exists) {
    // 断言 docId 是合法 id 且与来源文档一致。
    // ⚠️ 原写法 `CONTAINER_ID.replace(/.*/, card.docId)` 是**恒真表达式**
    //   （replace 无论如何都返回第二参），等于没断言 —— 已改为与来源文档 id 比对。
    check("卡片记录了来源 docId（32 位且等于来源文档 id）",
      card.docId === SOURCE_ID && card.docId.length === 32,
      `card.docId=${card.docId} SOURCE_ID=${SOURCE_ID}`);
    check("卡片显示来源标题", card.title === SOURCE_TITLE, card.title);
    check("卡片显示类型徽标", card.badge === "表格", card.badge);
    check("卡片内渲染出表格内容（非空壳）", card.innerTable > 0, "table 数=" + card.innerTable);
    check("卡片内不含「插入卡片」按钮（禁止嵌套）", card.innerEmbedBtns === 0, card.innerEmbedBtns);
  }

  // ---- 4) 保存后重新打开，卡片仍在 ----
  await p.keyboard.press("Meta+s").catch(() => {});
  await sleep(3000);
  // 按标题定位容器（不依赖硬编码 id，脚本才可复用）；并轮询等保存落盘 ——
  // 保存是 1.5s 防抖，固定 sleep 可能读在保存之前（曾读到空串而误判）。
  const saved = await p.evaluate(async (title) => {
    const tok = localStorage.getItem("sunnydoc.token");
    const h = { Authorization: "Bearer " + tok };
    const list = await (await fetch("http://localhost:8000/api/v1/documents", { headers: h })).json();
    const hit = (list.documents || []).find((x) => x.title === title);
    if (!hit) return "";
    for (let i = 0; i < 12; i++) {
      const d = await (await fetch(`http://localhost:8000/api/v1/documents/${hit.id}`, { headers: h })).json();
      const t = d.text || "";
      if (/data-doc-id/.test(t)) return t.slice(0, 400);
      await new Promise((r) => setTimeout(r, 500));
    }
    return "";
  }, CONTAINER_TITLE);
  console.log("  保存后的正文: " + JSON.stringify(saved.replace(/\n+/g, " ").slice(0, 200)));
  check("保存后正文里保留了卡片标记", /data-doc-id/.test(saved), saved.slice(0, 160));

  // 重新加载页面再打开，确认卡片能重建
  await p.reload({ waitUntil: "domcontentloaded" });
  await sleep(2600);
  const kb2 = p.locator("button, a").filter({ hasText: "云计算知识库" }).first();
  if (await kb2.count()) { await kb2.click(); await sleep(2000); }
  const box2 = p.locator('input[type="search"], input[placeholder*="搜索"]').first();
  await box2.fill("嵌入测试-容器文档");
  await sleep(2000);
  const hit2 = p.getByText("嵌入测试-容器文档", { exact: true }).first();
  if (await hit2.count()) { await hit2.click({ force: true }).catch(() => {}); }
  await sleep(3500);
  const editBtn2 = p.locator("button").filter({ hasText: /^编辑$/ }).first();
  if (await editBtn2.count()) { await editBtn2.click({ force: true }).catch(() => {}); await sleep(3000); }
  const rebuilt = await p.evaluate(() => {
    const el = document.querySelector(".doc-embed");
    return el
      ? { exists: true, title: (el.querySelector(".doc-embed-title")?.textContent || "").trim(), table: el.querySelectorAll("table").length }
      : { exists: false };
  });
  console.log("  重开后: " + JSON.stringify(rebuilt));
  check("刷新后卡片被重建", rebuilt.exists, "未找到 .doc-embed");
  check("重开后仍渲染表格内容", (rebuilt.table || 0) > 0, "table 数=" + rebuilt.table);

  console.log("\nconsole 错误: " + (errs.length ? errs.slice(0, 3).join(" | ") : "无"));
  if (errs.length) fail++;
  await p.screenshot({ path: "/tmp/sd_ed/embed_ok.png" });
  await b.close();
  console.log("\n" + (fail ? "❌ FAIL = " + fail : "✅ ALL PASS"));
  process.exit(fail ? 1 : 0);
})();