#!/usr/bin/env node
/**
 * 卡片渲染修复的完整验证。
 *
 * 覆盖两个实测到的缺陷：
 *  A. 预览态卡片不可见（修复前容器高 0px、子元素 0）
 *  B. 编辑态卡片占 71% 视口（修复前 639px）
 *
 * 判据选择说明：不用「.doc-embed 存在」这种恒真断言（DOM 里占位 div 一直都在），
 * 而要断言**实际渲染出的内容尺寸**与**内部真实控件**。
 */
const { chromium } = require("playwright");
const fs = require("fs");
const { seedCardFixtures, cleanupCardFixtures } = require("./_card_fixtures.cjs");
// token 走环境变量，避免把凭据写进仓库
const TOKEN = process.env.SUNNYDOC_TOKEN || fs.readFileSync(process.env.SUNNYDOC_TOKEN_FILE || "/tmp/sunnydoc-token.txt", "utf8").trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fail = 0;
const check = (n, c, d) => {
  if (c) console.log("  ✅ " + n);
  else { fail++; console.log("  ❌ " + n + "\n       " + String(d).slice(0, 220)); }
};

const VH = 900;
const MAX_CARD_H = 560; // 卡片高度上限（含头部 44px + 内容 460px + 边框）

(async () => {
  const b = await chromium.launch({
    headless: true,
    args: ["--no-proxy-server"],
    // 允许指定浏览器可执行文件（playwright 包升级后缓存里可能只有旧版 chromium）
    ...(process.env.SUNNYDOC_CHROMIUM ? { executablePath: process.env.SUNNYDOC_CHROMIUM } : {}),
  });
  const p = await b.newPage({ viewport: { width: 1440, height: VH } });
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e).slice(0, 160)));
  p.on("console", (m) => {
    if (m.type() === "error") errs.push("console: " + m.text().slice(0, 160));
  });

  await p.goto((process.env.SUNNYDOC_WEB || "http://localhost:3001"), { waitUntil: "domcontentloaded" });
  await p.evaluate((t) => localStorage.setItem("sunnydoc.token", t), TOKEN);
  await p.reload({ waitUntil: "domcontentloaded" });
  await sleep(2500);
  const kb = p.locator('[data-testid="kb-card"]').filter({ hasText: "云计算知识库" }).first();
  if (await kb.count()) { await kb.click(); await sleep(2200); }

  // 容器标题参数化：曾硬编码上一轮的文档名，那个文档被清理后脚本就静默搜不到、
  // 从而"一张卡片都没抓到"（而 every() 对空数组恒真，看起来全过）。
  const CONTAINER = process.argv[2] || "卡片观感-容器";
  // 自建夹具：容器正文里**预置一个卡片**（本脚本要断言卡片的实际渲染尺寸与内部控件，
  // 没有卡片可看就无从测起）。不再依赖库中预存夹具。
  const fx = await seedCardFixtures(p, {
    container: CONTAINER,
    source: "嵌入测试-表格源",
    withCard: true,
  });
  console.log("  夹具: 容器=" + fx.containerId + " 来源=" + fx.sourceId +
    (fx.created.length ? "（新建 " + fx.created.length + "）" : "（复用既有）"));
  const box = p.locator('input[type="search"], input[placeholder*="搜索"]').first();
  await box.fill(CONTAINER);
  await sleep(2000);
  const hit = p.getByText(CONTAINER, { exact: true }).first();
  check("容器文档可被搜到", (await hit.count()) > 0, "未找到 " + CONTAINER);
  if (await hit.count()) await hit.click({ force: true }).catch(() => {});
  await sleep(4000);

  // ── 预览态 ──
  console.log("=== A. 预览态（默认视图）===");
  const preview = await p.evaluate(() => {
    const wraps = Array.from(document.querySelectorAll(".md-body .doc-embed"));
    return wraps.map((w) => {
      const card = w.querySelector(".doc-embed-card");
      const r = card ? card.getBoundingClientRect() : null;
      const canvas = w.querySelector(".doc-embed-canvas");
      return {
        hasCard: !!card,
        h: r ? Math.round(r.height) : 0,
        type: card ? card.getAttribute("data-embed-type") : null,
        title: (w.querySelector(".doc-embed-title")?.textContent || "").trim(),
        // 内部真实控件数 —— 证明「不是空壳」
        innerInputs: w.querySelectorAll("input").length,
        innerTable: w.querySelectorAll("table").length,
        innerSvg: w.querySelectorAll("svg").length,
        hasRemoveBtn: !!w.querySelector('[aria-label="移除卡片"]'),
      };
    });
  });
  check("预览态渲染出卡片本体", preview.length > 0 && preview.every((c) => c.hasCard),
    JSON.stringify(preview));
  check("预览态卡片有可见高度（> 100px）", preview.length > 0 && preview.every((c) => c.h > 100),
    preview.map((c) => c.h).join(", "));
  check("预览态卡片高度受控（每个 < " + MAX_CARD_H + "px）", preview.length > 0 && preview.every((c) => c.h < MAX_CARD_H),
    preview.map((c) => c.h).join(", "));
  check("预览态卡片渲染出真实内容（表格 input 或 svg）",
    preview.length > 0 && preview.every((c) => c.innerInputs > 0 || c.innerSvg > 0 || c.innerTable > 0),
    JSON.stringify(preview.map((c) => ({ i: c.innerInputs, t: c.innerTable, s: c.innerSvg }))));
  check("预览态不显示「移除卡片」按钮（只读视图不该有删除入口）",
    preview.length > 0 && preview.every((c) => !c.hasRemoveBtn), JSON.stringify(preview.map((c) => c.hasRemoveBtn)));
  console.log("  卡片明细: " + JSON.stringify(preview.map((c) => ({ type: c.type, h: c.h, title: c.title.slice(0, 12) }))));

  // ── 编辑态 ──
  console.log("\n=== B. 编辑态 ===");
  const eb = p.locator("button").filter({ hasText: /^编辑$/ }).first();
  if (await eb.count()) await eb.click({ force: true }).catch(() => {});
  await sleep(5000);

  const edit = await p.evaluate(() => {
    const wraps = Array.from(document.querySelectorAll(".ProseMirror .doc-embed"));
    return wraps.map((w) => {
      const card = w.querySelector(".doc-embed-card");
      const r = card ? card.getBoundingClientRect() : null;
      return {
        h: r ? Math.round(r.height) : 0,
        type: card ? card.getAttribute("data-embed-type") : null,
        innerInputs: w.querySelectorAll("input").length,
        innerTable: w.querySelectorAll("table").length,
        innerSvg: w.querySelectorAll("svg").length,
        // 思维导图是 DOM div 渲染，无 input/table/svg 时要靠文本兜底
        innerText: ((w.querySelector(".doc-embed-canvas")?.textContent || "").trim().length),
        hasRemoveBtn: !!w.querySelector('[aria-label="移除卡片"]'),
      };
    });
  });
  check("编辑态卡片数与原一致", edit.length === preview.length, edit.length + " vs " + preview.length);
  check("编辑态卡片高度受控（每个 < " + MAX_CARD_H + "px）", edit.length > 0 && edit.every((c) => c.h < MAX_CARD_H),
    edit.map((c) => c.h).join(", "));
  // 判据不能用 input 数：思维导图是 DOM div 渲染，本来就没有 input（同类坑踩过一次）。
  // 改用「有真实内容」的多通道判据：input / table / svg / 文本 四者取或。
  check("编辑态仍然渲染出真实内容",
    edit.length > 0 && edit.every((c) => c.innerInputs > 0 || c.innerTable > 0 || c.innerSvg > 0 || c.innerText > 0),
    JSON.stringify(edit.map((c) => ({ i: c.innerInputs, t: c.innerTable, s: c.innerSvg, x: c.innerText }))));
  check("编辑态保留「移除卡片」按钮", edit.length > 0 && edit.every((c) => c.hasRemoveBtn),
    JSON.stringify(edit.map((c) => c.hasRemoveBtn)));
  check("data-embed-type 两态一致且非空",
    edit.length > 0 && edit.every((c) => c.type) && edit.map((c) => c.type).join() === preview.map((c) => c.type).join(),
    edit.map((c) => c.type).join() + " vs " + preview.map((c) => c.type).join());

  // ── 切回预览态：确认卡片能复原（验证 unmount 后 WeakMap 清理正确）──
  console.log("\n=== C. 切回预览态（验证卡片可复原）===");
  // 按钮文案是「取消」（放弃编辑，回预览），**不是「预览」** ——
  // 曾猜错文案导致根本没切回去，却误判为「切回后卡片不可见」（假失败）。
  const pv = p.locator("button").filter({ hasText: /^取消$/ }).first();
  check("找到「取消」按钮（切回预览态）", (await pv.count()) > 0, "未找到");
  if (await pv.count()) await pv.click({ force: true }).catch(() => {});
  await sleep(2500);
  // 轮询等卡片重新挂载（预览态是重新 hydrate 的一份，不是保留编辑态那份）
  let backWait = 0;
  while (backWait < 30000) {
    const n = await p.evaluate(
      () => document.querySelectorAll(".md-body .doc-embed .doc-embed-card").length,
    );
    if (n > 0) break;
    await sleep(500);
    backWait += 500;
  }
  const back = await p.evaluate(() => {
    const wraps = Array.from(document.querySelectorAll(".md-body .doc-embed"));
    return wraps.map((w) => {
      const card = w.querySelector(".doc-embed-card");
      return { hasCard: !!card, h: card ? Math.round(card.getBoundingClientRect().height) : 0 };
    });
  });
  check("切回预览态后卡片仍可见（未被永久卸载）",
    back.length > 0 && back.every((c) => c.hasCard && c.h > 100), JSON.stringify(back));

  console.log("\n  console/page 错误: " + (errs.length ? errs.slice(0, 3).join(" | ") : "无"));
  check("无运行时错误", errs.length === 0, errs.slice(0, 2).join(" | "));

  await p.screenshot({ path: "/tmp/sd_card/after.png", fullPage: false });
  // 清理本次新建的夹具（不动原本就存在的文档）
  await cleanupCardFixtures(p, fx.created);
  await b.close();
  console.log("\n" + (fail ? "❌ FAIL = " + fail : "✅ ALL PASS"));
  process.exit(fail ? 1 : 0);
})();