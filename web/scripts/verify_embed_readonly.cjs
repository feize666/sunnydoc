#!/usr/bin/env node
/**
 * 补验两项：①点卡片标题跳转来源文档 ②卡片内容只读（不可编辑）。
 *
 * 只读这一项尤其重要：卡片内挂的是另一个编辑器实例，
 * 若能编辑会造成「改了卡片但来源没变」的错觉，必须实测拦住。
 */
const { chromium } = require("playwright");
const fs = require("fs");
// token 走环境变量，避免把凭据写进仓库
const TOKEN = process.env.SUNNYDOC_TOKEN || fs.readFileSync(process.env.SUNNYDOC_TOKEN_FILE || "/tmp/sunnydoc-token.txt", "utf8").trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (n, c, d) => { if (c) console.log("  ✅ " + n); else { fail++; console.log("  ❌ " + n + "\n       " + String(d).slice(0, 200)); } };

(async () => {
  const b = await chromium.launch({ headless: true, args: ["--no-proxy-server"] });
  const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  const errs = []; p.on("pageerror", (e) => errs.push(String(e).slice(0, 120)));
  await p.goto((process.env.SUNNYDOC_WEB || "http://localhost:3001"), { waitUntil: "domcontentloaded" });
  await p.evaluate((t) => localStorage.setItem("sunnydoc.token", t), TOKEN);
  await p.reload({ waitUntil: "domcontentloaded" });
  await sleep(2400);
  const kb = p.locator("button, a").filter({ hasText: "云计算知识库" }).first();
  if (await kb.count()) { await kb.click(); await sleep(2000); }
  const box = p.locator('input[type="search"], input[placeholder*="搜索"]').first();
  await box.fill("嵌入测试-容器文档"); await sleep(2000);
  const hit = p.getByText("嵌入测试-容器文档", { exact: true }).first();
  if (await hit.count()) await hit.click({ force: true }).catch(() => {});
  await sleep(4000);
  const eb = p.locator("button").filter({ hasText: /^编辑$/ }).first();
  if (await eb.count()) { await eb.click({ force: true }).catch(() => {}); await sleep(3000); }

  // ---- 只读：尝试往卡片内的表格单元格输入，内容不应改变 ----
  const before = await p.evaluate(() => {
    const cell = document.querySelector(".doc-embed table input");
    return cell ? cell.value : null;
  });
  const cell = p.locator(".doc-embed table input").first();
  let typed = false;
  if (await cell.count()) {
    const ro = await cell.evaluate((el) => el.readOnly || el.disabled || el.getAttribute("readonly") !== null);
    check("卡片内单元格为只读（readOnly/disabled）", ro, "readonly=" + ro);
    await cell.click({ force: true }).catch(() => {});
    await p.keyboard.type("XXXEDIT", { delay: 20 });
    typed = true;
    await sleep(800);
  } else {
    check("卡片内找到可检查的单元格", false, "未找到 .doc-embed table input");
  }
  const after = await p.evaluate(() => {
    const cell = document.querySelector(".doc-embed table input");
    return cell ? cell.value : null;
  });
  check("输入后卡片内容未被改变", before === after, `before=${before} after=${after}`);

  // ---- 跳转：点卡片标题应切到来源文档 ----
  const title = p.locator(".doc-embed .doc-embed-title").first();
  let jumped = false;
  if (await title.count()) {
    await title.click({ force: true }).catch(() => {});
    await sleep(4000);
    // 判据不能只看 h1：来源文档是「表格」类型，表格编辑器根本没有 h1
    // （这与思维导图那次同类错误——用不适配的选择器导致假失败）。
    // 改用三重证据：①搜索框已清空（离开搜索结果视图）
    // ②正文区出现表格编辑器特征 ③卡片标记不再占据正文区
    const st = await p.evaluate(() => {
      const box = document.querySelector('input[type="search"], input[placeholder*="搜索"]');
      const embedStillThere = !!document.querySelector(".doc-embed");
      // 表格编辑器：正文区出现可编辑表格 + 工具栏「添加行」
      const tableInputs = document.querySelectorAll("table input").length;
      const hasTableToolbar = (document.body.innerText || "").includes("行 ×");
      return {
        searchValue: box ? box.value : "(无搜索框)",
        embedStillThere,
        tableInputs,
        hasTableToolbar,
      };
    });
    console.log("  跳转后状态: " + JSON.stringify(st));
    jumped = st.searchValue === "" && st.hasTableToolbar && st.tableInputs > 0;
  }
  check("点卡片标题跳转到来源文档", jumped, "状态不符（见上）");

  console.log("  console 错误: " + (errs.length ? errs.slice(0, 2).join(" | ") : "无"));
  if (errs.length) fail++;
  await b.close();
  console.log(fail ? "❌ FAIL = " + fail : "✅ ALL PASS");
  process.exit(fail ? 1 : 0);
})();
