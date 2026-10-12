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
  const b = await chromium.launch({ headless: true, args: ["--no-proxy-server"] });
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
  const kb = p.locator("button, a").filter({ hasText: "云计算知识库" }).first();
  if (await kb.count()) { await kb.click(); await sleep(2200); }

  const box = p.locator('input[type="search"], input[placeholder*="搜索"]').first();
  await box.fill("卡片高度测试-容器");
  await sleep(2000);
  const hit = p.getByText("卡片高度测试-容器", { exact: true }).first();
  if (await hit.count()) await hit.click({ force: true }).catch(() => {});
  await sleep(5000);

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
  check("预览态卡片有可见高度（> 100px）", preview.every((c) => c.h > 100),
    preview.map((c) => c.h).join(", "));
  check("预览态卡片高度受控（每个 < " + MAX_CARD_H + "px）", preview.every((c) => c.h < MAX_CARD_H),
    preview.map((c) => c.h).join(", "));
  check("预览态卡片渲染出真实内容（表格 input 或 svg）",
    preview.every((c) => c.innerInputs > 0 || c.innerSvg > 0 || c.innerTable > 0),
    JSON.stringify(preview.map((c) => ({ i: c.innerInputs, t: c.innerTable, s: c.innerSvg }))));
  check("预览态不显示「移除卡片」按钮（只读视图不该有删除入口）",
    preview.every((c) => !c.hasRemoveBtn), JSON.stringify(preview.map((c) => c.hasRemoveBtn)));
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
  check("编辑态卡片高度受控（每个 < " + MAX_CARD_H + "px）", edit.every((c) => c.h < MAX_CARD_H),
    edit.map((c) => c.h).join(", "));
  // 判据不能用 input 数：思维导图是 DOM div 渲染，本来就没有 input（同类坑踩过一次）。
  // 改用「有真实内容」的多通道判据：input / table / svg / 文本 四者取或。
  check("编辑态仍然渲染出真实内容",
    edit.every((c) => c.innerInputs > 0 || c.innerTable > 0 || c.innerSvg > 0 || c.innerText > 0),
    JSON.stringify(edit.map((c) => ({ i: c.innerInputs, t: c.innerTable, s: c.innerSvg, x: c.innerText }))));
  check("编辑态保留「移除卡片」按钮", edit.every((c) => c.hasRemoveBtn),
    JSON.stringify(edit.map((c) => c.hasRemoveBtn)));
  check("data-embed-type 两态一致且非空",
    edit.every((c) => c.type) && edit.map((c) => c.type).join() === preview.map((c) => c.type).join(),
    edit.map((c) => c.type).join() + " vs " + preview.map((c) => c.type).join());

  // ── 切回预览态：确认卡片能复原（验证 unmount 后 WeakMap 清理正确）──
  console.log("\n=== C. 切回预览态（验证卡片可复原）===");
  const pv = p.locator("button").filter({ hasText: /^预览$/ }).first();
  if (await pv.count()) await pv.click({ force: true }).catch(() => {});
  await sleep(3500);
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
  await b.close();
  console.log("\n" + (fail ? "❌ FAIL = " + fail : "✅ ALL PASS"));
  process.exit(fail ? 1 : 0);
})();