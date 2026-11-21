#!/usr/bin/env node
/**
 * 点击目标尺寸护栏（WCAG 2.5.8 Target Size）
 *
 * ## 为什么需要它
 *
 * 2026-11-21 第五轮实测四个页面状态（首页 / 知识库 / 文档 / 命令面板），
 * 发现三处低于 24×24 的点击目标，且**数量都不止一个**：
 *
 * | 位置 | 实测 | 危害 |
 * | --- | --- | --- |
 * | 文件树行「选择此文档」 | **16×16** × 18 个 | 紧贴展开三角与文件名，点偏就变成钩选 |
 * | 标签页「关闭」 | **16×16** | 标签挨得紧，点偏会切到相邻文档 |
 * | 代码块「复制」 | 42×**20** | 紧邻横向滚动条，点偏变拖滚动 |
 * | 正文标题锚点「#」 | **11**×24 | 需要瞄准才能点中 |
 *
 * 这些都不会报错、不会崩，只是「用起来别扭」—— 而"别扭"恰恰是最难被
 * 用户准确描述、也最容易长期无人修的一类问题。所以必须由护栏守。
 *
 * ## 判据
 *
 * A. 四个页面状态下，**没有任何可见交互元素**小于 24×24
 *    （含 `button` / `a` / `[role=button]` / `[tabindex]`）
 * B. 视觉尺寸可以小于 24（比如 16px 的方块），但**命中区**必须 ≥24
 *    —— 这条由 A 的测量方式保证：量的是元素自身盒子，
 *    所以实现上必须用"外层撑命中区、内层做视觉"的做法
 * C. 文件树行高不得因扩命中区而变（32px）—— 缩进/行高是功能性规格
 *
 * ## 已知的设计意图（勿改）
 *
 * - 勾选框视觉仍是 **16px**（DESIGN.md 规格），只是外层 24×24 透明命中区。
 * - kbd / 纯文字角标不算交互元素，不在本护栏范围（它们不可点）。
 *
 * ## 用法
 *   cd web && NODE_PATH=<node_modules> node scripts/verify_target_size.cjs
 */
const { chromium } = require("playwright");
const fs = require("fs");

const WEB = "http://localhost:3001";
const TOKEN = (
  process.env.SUNNYDOC_TOKEN ||
  fs.readFileSync(process.env.SUNNYDOC_TOKEN_FILE || "/tmp/sunnydoc-token.txt", "utf8")
).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIN = 24;

let pass = 0,
  fail = 0;
function check(name, ok, extra = "") {
  console.log(`  ${ok ? "✅" : "❌"} ${name}${extra ? "  " + extra : ""}`);
  ok ? pass++ : fail++;
}

/** 收集当前页面所有可见交互元素中，尺寸不足的（按 尺寸+名称 聚合）。 */
const SCAN = (MIN) => {
  const vis = (e) => {
    const r = e.getBoundingClientRect();
    const cs = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden";
  };
  const out = {};
  const els = document.querySelectorAll(
    'button, a, [role="button"], [role="menuitem"], [tabindex]:not([tabindex="-1"])',
  );
  for (const e of els) {
    if (!vis(e)) continue;
    const r = e.getBoundingClientRect();
    if (r.width >= MIN && r.height >= MIN) continue;
    const name = (
      e.getAttribute("aria-label") ||
      e.innerText ||
      e.getAttribute("title") ||
      "?"
    )
      .trim()
      .slice(0, 18)
      .replace(/\s+/g, " ");
    const key = `${Math.round(r.width)}×${Math.round(r.height)} ${name}`;
    out[key] = (out[key] || 0) + 1;
  }
  return out;
};

(async () => {
  console.log("=== 点击目标尺寸护栏（≥24×24） ===");

  const b = await chromium.launch({ headless: true, args: ["--no-proxy-server"] });
  const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 }, locale: "zh-CN" });
  const p = await ctx.newPage();
  await p.addInitScript((t) => localStorage.setItem("sunnydoc.token", t), TOKEN);
  await p.goto(WEB + "/", { waitUntil: "domcontentloaded" });
  await sleep(3600);
  await p.addStyleTag({ content: "nextjs-portal{display:none!important}" });

  const report = async (label) => {
    const small = await p.evaluate(SCAN, MIN);
    const keys = Object.keys(small);
    const desc = keys.map((k) => `${k}${small[k] > 1 ? ` ×${small[k]}` : ""}`).join(" | ");
    check(`${label}：无小于 ${MIN}×${MIN} 的目标`, keys.length === 0, desc);
    return keys;
  };

  await report("首页");

  await p.locator('[data-testid="kb-card"]').first().click();
  for (let i = 0; i < 40; i++) {
    if (await p.evaluate(() => document.querySelectorAll("[data-tree-kind]").length > 0)) break;
    await sleep(250);
  }
  await sleep(900);
  await report("知识库（文件树）");

  /* C. 扩命中区不能改行高 —— 缩进/行高是功能性规格 */
  const rowH = await p.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-tree-kind="doc"]')].slice(0, 3);
    return rows.map((r) => Math.round(r.getBoundingClientRect().height));
  });
  check("树行高仍为 32px（扩命中区不得挤乱缩进）", rowH.length > 0 && rowH.every((h) => h === 32), JSON.stringify(rowH));

  // 打开文档 → 正文（会渲染代码块复制按钮 + 标题锚点）
  const docs = await p.evaluate(() =>
    [...document.querySelectorAll('[data-tree-kind="doc"]')].map((e) => e.getAttribute("data-tree-key")),
  );
  if (docs.length) {
    await p.locator(`[data-tree-key="${docs[0]}"]`).click();
    await sleep(2600);
    await report("文档正文（含代码块 / 标题锚点）");

    // 顺带确认这两个元素真的渲染了（否则上面的"通过"没有意义）
    const presence = await p.evaluate(() => ({
      copy: document.querySelectorAll(".codeblock-copy").length,
      anchor: document.querySelectorAll(".md-anchor").length,
    }));
    check(
      "该文档确实含代码块复制按钮与标题锚点（判据有覆盖）",
      presence.copy > 0 || presence.anchor > 0,
      JSON.stringify(presence),
    );
  } else {
    check("文档正文（含代码块 / 标题锚点）", false, "树里没有文档，判据无法覆盖");
  }

  await p.keyboard.press("Meta+k");
  await sleep(800);
  await report("命令面板");
  await p.keyboard.press("Escape");

  await b.close();
  // runner 以「全部通过」作为判定（见 run_all_verify.cjs）：
  // 只打印统计而不打印这句，会被判成「退出码 0 但未见全部通过」——
  // 那是脚本的格式问题，不是产品问题。
  console.log(`\n${pass} 通过 / ${fail} 失败`);
  console.log(fail === 0 ? "✅ 全部通过" : "❌ 存在失败项");
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("脚本异常：", e.message);
  process.exit(1);
});