#!/usr/bin/env node
/**
 * 最终验收：**单次写入体积**是最有区分度的指标。
 *
 * 为什么不用"长任务总时长"做主判据：实测对抗性验证时发现，
 * 回滚优化后长任务合计 149ms 仍能通过 200ms 阈值 —— 阈值不够strict，
 * 断言会"恒真"而失去回归价值。
 *
 * 改用「单次 DOM 写入体积」：
 *   优化后 = 30 次 × ~13KB（分批）
 *   回滚后 =  1 次 × ~398KB（全量）
 * 这个指标**无法被蒙混**：只要恢复一次性注入就必然超标。
 */
const { chromium } = require("playwright");
const fs = require("fs");
const TITLE = process.argv[2] || "openEuler安全配置基线";
const EXPECT_BLOCKS = parseInt(process.argv[3] || "638", 10);
// token 从命令行第 3 个参数或环境变量取，避免把凭据写进仓库
const TOKEN = process.env.SUNNYDOC_TOKEN || fs.readFileSync(process.env.SUNNYDOC_TOKEN_FILE || "/tmp/sunnydoc-token.txt", "utf8").trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fail = 0;
const check = (n, c, d) => { if (c) console.log("  ✅ " + n); else { fail++; console.log("  ❌ " + n + "\n       " + d); } };

(async () => {
  const b = await chromium.launch({
    headless: true,
    args: ["--no-proxy-server"],
    // 允许指定浏览器可执行文件（playwright 包升级后缓存里可能只有旧版 chromium）
    ...(process.env.SUNNYDOC_CHROMIUM ? { executablePath: process.env.SUNNYDOC_CHROMIUM } : {}),
  });
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
  await p.addInitScript(() => {
    window.__lt = []; window.__inj = []; window.__dataAt = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push({ d: Math.round(e.duration), s: Math.round(e.startTime) }); }).observe({ entryTypes: ["longtask"] });
    const iah = Element.prototype.insertAdjacentHTML;
    Element.prototype.insertAdjacentHTML = function (pos, html) {
      if (this.classList && this.classList.contains("md-body")) window.__inj.push(typeof html === "string" ? html.length : 0);
      return iah.call(this, pos, html);
    };
    const d = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
    Object.defineProperty(Element.prototype, "innerHTML", {
      ...d,
      set(v) { if (this.classList && this.classList.contains("md-body")) window.__inj.push(typeof v === "string" ? v.length : 0); d.set.call(this, v); },
    });
    const _f = window.fetch;
    window.fetch = function (...a) {
      const u = typeof a[0] === "string" ? a[0] : a[0]?.url || "";
      return _f.apply(this, a).then((r) => {
        if (u.includes("/documents/") && !window.__dataAt) window.__dataAt = Math.round(performance.now());
        return r;
      });
    };
  });
  await p.goto("http://localhost:3001", { waitUntil: "domcontentloaded" });
  await p.evaluate((t) => localStorage.setItem("sunnydoc.token", t), TOKEN);
  await p.reload({ waitUntil: "domcontentloaded" });
  await sleep(2500);
  const kb = p.locator('[data-testid="kb-card"]').filter({ hasText: "云计算知识库" }).first();
  if (await kb.count()) { await kb.click(); await sleep(2200); }
  // 优先在文件树直接点；找不到则退回搜索（文档可能藏在折叠目录里）
  let opened = false;
  const dn = p.getByText(TITLE, { exact: true }).first();
  if (await dn.count()) { await dn.click({ force: true }).catch(() => {}); opened = true; }
  if (!opened) {
    const box = p.locator('input[type="search"], input[placeholder*="搜索"]').first();
    if (await box.count()) {
      await box.fill(TITLE);
      await sleep(2000);
      const hit = p.getByText(TITLE, { exact: true }).first();
      if (await hit.count()) { await hit.click({ force: true }).catch(() => {}); opened = true; }
    }
  }
  console.log("  打开方式: " + (opened ? "已点击" : "⚠️ 未找到该文档"));
  await sleep(12000);

  const r = await p.evaluate(() => {
    const body = document.querySelector(".md-body");
    return {
      inj: window.__inj, lt: window.__lt, dataAt: window.__dataAt,
      nodes: body ? body.querySelectorAll("*").length : -1,
      codeblocks: body ? body.querySelectorAll(".codeblock").length : 0,
      shiki: body ? body.querySelectorAll("pre.shiki").length : 0,
      pending: body ? body.querySelectorAll("pre.shiki[data-code-lang]").length : 0,
      copyBtns: body ? body.querySelectorAll("button.codeblock-copy").length : 0,
      copyText: (() => { const c = document.querySelector(".md-body .codeblock pre code"); return c ? (c.textContent || "").slice(0, 50) : ""; })(),
    };
  });
  await b.close();

  const maxInj = r.inj.length ? Math.max(...r.inj) : 0;
  const avgInj = r.inj.length ? Math.round(r.inj.reduce((a, c) => a + c, 0) / r.inj.length) : 0;
  const render = r.lt.filter((x) => x.s >= r.dataAt - 50);

  console.log("=== 核心指标：单次写入体积 ===");
  console.log("  写入次数: " + r.inj.length + " 次");
  console.log("  单次最大: " + Math.round(maxInj / 1024) + " KB   ← 判据");
  console.log("  单次均值: " + Math.round(avgInj / 1024) + " KB");
  console.log("  （回滚对照：1 次 398KB / 优化后：30 次 13KB）");
  console.log("");
  console.log("=== 辅助指标：渲染期长任务 ===");
  console.log("  合计 " + render.reduce((a, c) => a + c.d, 0) + "ms / " + render.length + " 次 / 最长 " + (render.length ? Math.max(...render.map((x) => x.d)) : 0) + "ms");
  console.log("  （基线：391ms / 最长 220ms）");
  console.log("");
  console.log("=== 性能断言 ===");
  check("写入被分批（次数 > 10）", r.inj.length > 10, r.inj.length + " 次");
  check("单次写入 < 60KB（杜绝全量注入）", maxInj < 60 * 1024, Math.round(maxInj / 1024) + " KB");
  check("渲染期最长单次 < 150ms", (render.length ? Math.max(...render.map((x) => x.d)) : 0) < 150, Math.max(...render.map((x) => x.d)) + "ms");
  console.log("");
  console.log("=== 功能不回归 ===");
  // ── 下面两条断言在 2026-10-24 被**有意修改**（原为「节点 > 17000」与「代码块全部高亮」）──
  //
  // 原因：那一天把代码块高亮从「排空队列」改为「按需 + 有限预取」。
  // 实测 20 万字符文档有 638 个代码块，而**首屏可见的只有 0 个** ——
  // 旧行为把 638 个全部高亮，纯属白做（用户为此付出 CPU 与 17,372 个 DOM 节点）。
  //
  // 因此「节点 > 17000」与「全部高亮」不再是**期望行为**，而是被优化掉的症状。
  // 这两条若继续保留，会把「正确的按需渲染」判成失败 —— 属于**断言与新设计冲突**。
  //
  // ⚠️ 判据本身没有变松：本脚本的**核心判据（单次写入体积 < 60KB）保持原样**，
  //    且新增的 `verify_longdoc_perf.cjs` 专门钉住按需语义。
  check(
    "DOM 按需（节点数在合理区间，非全量铺开）",
    r.nodes > 3000 && r.nodes < 25000,
    `${r.nodes}（按需渲染：首屏 + 预取，而非一次性铺完）`,
  );
  check("代码块数量正确", r.codeblocks === EXPECT_BLOCKS, r.codeblocks + " vs " + EXPECT_BLOCKS);
  check(
    "代码块按需高亮（视口内已高亮 + 远视口保持纯文本）",
    r.shiki > 0 && r.pending > 0,
    `已高亮 ${r.shiki} / 待高亮 ${r.pending}（全亮 ${r.codeblocks} 才是退回旧行为）`,
  );
  check("复制按钮齐全", r.copyBtns === r.codeblocks, r.copyBtns + " vs " + r.codeblocks);
  check("复制源是纯代码（无高亮标签）", !/<span|style=/.test(r.copyText), r.copyText);
  check("无 console 错误", errs.length === 0, errs.slice(0, 2).join(" | "));
  console.log("");
  console.log(fail ? "❌ FAIL = " + fail : "✅ ALL PASS");
  process.exit(fail ? 1 : 0);
})();
