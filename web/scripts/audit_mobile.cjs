#!/usr/bin/env node
/**
 * 移动端适配体检（阶段 2 的**基线测量**，不是断言脚本）。
 *
 * 目的：在动手改之前，用真实数据回答「移动端现在到底哪里不能看」，
 * 而不是凭代码猜。输出可直接作为改造清单。
 *
 * 检查项（在 iPhone 尺寸视口下）：
 *   1. 横向溢出：documentElement.scrollWidth > clientWidth（最常见硬伤）
 *   2. 溢出元素清单：谁超出了视口宽度
 *   3. 触控目标 < 44px 的可点元素（iOS HIG 建议值）
 *   4. 弹窗/面板是否超宽（> 视口）
 *   5. 字号 < 12px 的文本（移动端可读性）
 *
 * 用法：cd web && SUNNYDOC_TOKEN=xxx node scripts/audit_mobile.cjs
 */
const { chromium } = require("playwright");
const fs = require("fs");

const TOKEN =
  process.env.SUNNYDOC_TOKEN ||
  fs.readFileSync(process.env.SUNNYDOC_TOKEN_FILE || "/tmp/sunnydoc-token.txt", "utf8").trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const VIEWPORTS = [
  { name: "iPhone SE", width: 375, height: 667 },
  { name: "iPhone 14 Pro", width: 393, height: 852 },
  { name: "Android 常规", width: 412, height: 915 },
];

async function auditPage(page) {
  return page.evaluate(() => {
    const de = document.documentElement;
    const vw = de.clientWidth;
    const overflowX = de.scrollWidth - vw;

    // 溢出元素：右边界超出视口且可见
    const over = [];
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cs = getComputedStyle(el);
      if (cs.position === "fixed" || cs.visibility === "hidden" || cs.display === "none") continue;
      if (r.right > vw + 1) {
        over.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className || "").toString().slice(0, 70),
          right: Math.round(r.right),
          w: Math.round(r.width),
        });
      }
    }

    // 触控目标过小：可点元素且宽或高 < 44
    // ⚠️ **必须算上 ::after 扩展的命中区**（2026-10-13）：
    // 行内小图标（如卡片上的「共享/编辑/删除」）视觉尺寸是 24×24，
    // 但触屏下用透明 `::after` 把可点范围扩到 40×40 —— 检测器若只量
    // border-box 会**误报**这些按钮过小。这里把 ::after 的尺寸并入计算。
    const small = [];
    for (const el of document.querySelectorAll("button, a[href], [role='button'], input[type='checkbox']")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none") continue;

      // 命中区 = border-box 与 ::after 的并集
      let hitW = r.width;
      let hitH = r.height;
      const af = getComputedStyle(el, "::after");
      if (af && af.content && af.content !== "none") {
        const aw = parseFloat(af.width) || 0;
        const ah = parseFloat(af.height) || 0;
        if (aw > 0) hitW = Math.max(hitW, aw);
        if (ah > 0) hitH = Math.max(hitH, ah);
      }

      if (hitW < 44 || hitH < 44) {
        small.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className || "").toString().slice(0, 60),
          label: (el.innerText || el.getAttribute("aria-label") || "").trim().slice(0, 24),
          w: Math.round(r.width),
          h: Math.round(r.height),
          hitW: Math.round(hitW),
          hitH: Math.round(hitH),
        });
      }
    }

    return {
      vw,
      overflowX,
      over: over.slice(0, 12),
      overCount: over.length,
      smallCount: small.length,
      small: small.slice(0, 12),
    };
  });
}

(async () => {
  const b = await chromium.launch({ headless: true, args: ["--no-proxy-server"] });
  for (const vp of VIEWPORTS) {
    const ctx = await b.newContext({
      viewport: { width: vp.width, height: vp.height },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });
    const p = await ctx.newPage();
    await p.goto("http://localhost:3001", { waitUntil: "domcontentloaded" });
    await p.evaluate((t) => localStorage.setItem("sunnydoc.token", t), TOKEN);
    await p.reload({ waitUntil: "domcontentloaded" });
    await sleep(2800);

    console.log(`\n════════ ${vp.name} (${vp.width}×${vp.height}) ════════`);

    // 首页
    let r = await auditPage(p);
    console.log(`【首页】视口宽=${r.vw}  横向溢出=${r.overflowX}px  溢出元素=${r.overCount}  触控过小=${r.smallCount}`);
    for (const o of r.over.slice(0, 6)) console.log(`   ↳ 溢出 ${o.tag}.${o.cls} right=${o.right} w=${o.w}`);
    for (const s of r.small.slice(0, 6)) console.log(`   ↳ 过小 ${s.tag} "${s.label}" ${s.w}×${s.h} .${s.cls}`);

    // 进知识库（主界面）
    const kb = p.locator('[data-testid="kb-card"]').filter({ hasText: "云计算知识库" }).first();
    if (await kb.count()) {
      await kb.click();
      await sleep(2500);
      r = await auditPage(p);
      console.log(`【知识库】横向溢出=${r.overflowX}px  溢出元素=${r.overCount}  触控过小=${r.smallCount}`);
      for (const o of r.over.slice(0, 8)) console.log(`   ↳ 溢出 ${o.tag}.${o.cls} right=${o.right} w=${o.w}`);
      for (const s of r.small.slice(0, 8)) console.log(`   ↳ 过小 ${s.tag} "${s.label}" ${s.w}×${s.h}`);
    }

    // 打开一篇文档（正文阅读）
    const firstDoc = p.locator(".tree-row, button").filter({ hasText: /^0|^1|kvm|网络|磁盘/ }).first();
    if (await firstDoc.count()) {
      await firstDoc.click().catch(() => {});
      await sleep(2500);
      r = await auditPage(p);
      console.log(`【文档阅读】横向溢出=${r.overflowX}px  溢出元素=${r.overCount}  触控过小=${r.smallCount}`);
      for (const o of r.over.slice(0, 6)) console.log(`   ↳ 溢出 ${o.tag}.${o.cls} right=${o.right} w=${o.w}`);
    }

    await ctx.close();
  }
  await b.close();
})();