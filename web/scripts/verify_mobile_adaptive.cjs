#!/usr/bin/env node
/**
 * 真机验证：移动端自适应（阶段 2）—— 横向溢出与触控目标。
 *
 * **为什么必须真机验证**：`md:hidden` 之类的类名写对了 ≠ 布局真的不溢出。
 * 溢出只有把元素放进真实视口量 `getBoundingClientRect()` 才知道。
 *
 * ## 阶段 2 的实测基线（2026-10-13，动手前）
 *
 * | 视图 | 375px 下横向溢出元素 | 触控目标 <44px |
 * |---|---|---|
 * | 首页 | 15（头部总宽 564px，右侧全被推出屏幕） | 7 |
 * | 知识库 | 5 | 7 |
 * | 文档阅读 | 5 | 7 |
 *
 * ## 断言
 *   1. 三档手机视口 × 三个视图：**横向溢出元素为 0**
 *   2. 触控目标（含 ::after 扩展区）**全部 ≥ 44×44**
 *   3. PC 视口（1440px）下：关键元素**未被移动端规则影响**（回归护栏）
 *      —— 防止「为移动端改动了桌面布局」这类反向破坏
 *
 * ## 用法
 *   cd web && SUNNYDOC_TOKEN=xxx node scripts/verify_mobile_adaptive.cjs
 */
const { chromium } = require("playwright");
const fs = require("fs");

const TOKEN =
  process.env.SUNNYDOC_TOKEN ||
  fs.readFileSync(process.env.SUNNYDOC_TOKEN_FILE || "/tmp/sunnydoc-token.txt", "utf8").trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fail = 0;
const check = (n, c, d) => {
  if (c) console.log("  ✅ " + n);
  else {
    fail++;
    console.log("  ❌ " + n + "\n       " + (d || ""));
  }
};

const MOBILE_VPS = [
  { name: "iPhone SE", width: 375, height: 667 },
  { name: "iPhone 14 Pro", width: 393, height: 852 },
  { name: "Android 常规", width: 412, height: 915 },
];

/** 统计横向溢出元素（含 ::after 命中区）与触控过小元素。 */
async function measure(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    let overCount = 0;
    const overSamples = [];
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cs = getComputedStyle(el);
      if (cs.position === "fixed" || cs.visibility === "hidden" || cs.display === "none") continue;
      if (r.right > vw + 1) {
        overCount++;
        if (overSamples.length < 5) {
          overSamples.push(`${el.tagName.toLowerCase()}.${(el.className || "").toString().slice(0, 50)} right=${Math.round(r.right)}`);
        }
      }
    }

    let smallCount = 0;
    const smallSamples = [];
    for (const el of document.querySelectorAll("button, a[href], [role='button'], input[type='checkbox']")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none") continue;
      let hitW = r.width, hitH = r.height;
      const af = getComputedStyle(el, "::after");
      if (af && af.content && af.content !== "none") {
        const aw = parseFloat(af.width) || 0;
        const ah = parseFloat(af.height) || 0;
        if (aw > 0) hitW = Math.max(hitW, aw);
        if (ah > 0) hitH = Math.max(hitH, ah);
      }
      if (hitW < 44 || hitH < 44) {
        smallCount++;
        if (smallSamples.length < 5) {
          smallSamples.push(`${el.tagName.toLowerCase()} "${(el.innerText || el.getAttribute("aria-label") || "").trim().slice(0, 16)}" ${Math.round(r.width)}×${Math.round(r.height)}`);
        }
      }
    }
    return { vw, overCount, overSamples, smallCount, smallSamples };
  });
}

async function openKbAndDoc(p) {
  const kb = p.locator('[data-testid="kb-card"]').filter({ hasText: "云计算知识库" }).first();
  if (await kb.count()) {
    await kb.click();
    await sleep(2200);
  }
  const doc = p.locator(".tree-row").first();
  if (await doc.count()) {
    await doc.click().catch(() => {});
    await sleep(2000);
  }
}

(async () => {
  const b = await chromium.launch({ headless: true, args: ["--no-proxy-server"] });

  console.log("━━━ A. 移动端：横向溢出与触控目标 ━━━");
  for (const vp of MOBILE_VPS) {
    const ctx = await b.newContext({
      viewport: { width: vp.width, height: vp.height },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });
    const p = await ctx.newPage();
    const errs = [];
    p.on("pageerror", (e) => errs.push(String(e)));
    await p.goto("http://localhost:3001", { waitUntil: "domcontentloaded" });
    await p.evaluate((t) => localStorage.setItem("sunnydoc.token", t), TOKEN);
    await p.reload({ waitUntil: "domcontentloaded" });
    await sleep(2600);

    const home = await measure(p);
    await openKbAndDoc(p);
    const kb = await measure(p);

    console.log(
      `\n  ${vp.name} (${vp.width}) 首页: 溢出=${home.overCount} 过小=${home.smallCount} | 知识库/文档: 溢出=${kb.overCount} 过小=${kb.smallCount}`,
    );
    check(
      `${vp.name} 首页无横向溢出`,
      home.overCount === 0,
      `${home.overCount} 个\n       ` + home.overSamples.join("\n       "),
    );
    check(
      `${vp.name} 首页触控目标全部 ≥44`,
      home.smallCount === 0,
      `${home.smallCount} 个\n       ` + home.smallSamples.join("\n       "),
    );
    check(
      `${vp.name} 知识库/文档无横向溢出`,
      kb.overCount === 0,
      `${kb.overCount} 个\n       ` + kb.overSamples.join("\n       "),
    );
    check(
      `${vp.name} 知识库/文档触控目标全部 ≥44`,
      kb.smallCount === 0,
      `${kb.smallCount} 个\n       ` + kb.smallSamples.join("\n       "),
    );
    check(`${vp.name} 无 JS 错误`, errs.length === 0, errs.join(" | "));
    await ctx.close();
  }

  console.log("\n━━━ B. PC 端回归护栏（移动端规则不得影响桌面）━━━");
  {
    const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
    await p.goto("http://localhost:3001", { waitUntil: "domcontentloaded" });
    await p.evaluate((t) => localStorage.setItem("sunnydoc.token", t), TOKEN);
    await p.reload({ waitUntil: "domcontentloaded" });
    await sleep(2600);

    // 桌面下 icon-btn 应保持 32px（§5.12 尺寸阶梯），不得被触屏规则放大
    const iconSize = await p.evaluate(() => {
      const el = document.querySelector(".icon-btn");
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    });
    console.log(`  桌面 .icon-btn 尺寸: ${iconSize ? iconSize.w + "×" + iconSize.h : "未找到"}`);
    check(
      "桌面 .icon-btn 仍为 32px（触屏规则未污染桌面）",
      iconSize && iconSize.w === 32 && iconSize.h === 32,
      JSON.stringify(iconSize),
    );

    // 桌面下 reveal-on-hover 不应有 44px 的 ::after（否则会遮挡相邻元素）
    const afterSize = await p.evaluate(() => {
      const el = document.querySelector(".reveal-on-hover");
      if (!el) return null;
      const af = getComputedStyle(el, "::after");
      return { content: af.content, w: af.width, pos: getComputedStyle(el).position };
    });
    console.log(`  桌面 .reveal-on-hover ::after: ${JSON.stringify(afterSize)}`);
    check(
      "桌面未启用触屏 ::after 命中区扩展",
      afterSize && (afterSize.w === "auto" || afterSize.w === "0px" || afterSize.content === "none"),
      JSON.stringify(afterSize),
    );

    // 桌面下搜索框应显示完整文案（未被窄屏改动）
    const searchVisible = await p.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      const b = btns.find((x) => (x.innerText || "").includes("搜索或执行命令"));
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { w: Math.round(r.width) };
    });
    check(
      "桌面搜索入口保持完整宽度（≥200px）",
      searchVisible && searchVisible.w >= 200,
      JSON.stringify(searchVisible),
    );
    await p.close();
  }

  console.log(fail === 0 ? "\n✅ 全部通过" : `\n❌ ${fail} 项失败`);
  await b.close();
  process.exit(fail === 0 ? 0 : 1);
})();
