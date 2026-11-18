#!/usr/bin/env node
/**
 * AI 助理的视觉护栏：对比度 / 布局溢出 / 响应式 / Logo 可辨性。
 *
 * ## 为什么单独立一个脚本
 *
 * 功能护栏（`verify_agent_tools` 等）只验「能不能用」，
 * 但「看不清 / 挤出边界 / 小屏塌掉」这类问题它们全都不管 ——
 * 而这些恰恰是用户第一眼就撞上的。
 *
 * ## 判据（四组）
 *
 * A. **Logo 可辨性**：三档都透明底，靠「填充」或「描边」之一勾轮廓。
 *    实测记录的坑：给 logo 加 `bg-accent-soft` 后
 *      浅色 填充 #FFD93D 对 #EAF1FF 只有 **1.22**、
 *      深色 描边 #7C2D12 对 #172554 只有 **1.57**
 *    ⇒ 判据是「填充对比 ≥3 **或** 描边对比 ≥3」，不是「两者都要」——
 *      这个 logo 的设计是双主题各靠一项（见 LogoMark 文件头）。
 *      写成「两者都要 ≥3」会把正确实现判成失败。
 *
 * B. **无横向溢出**：面板内滚动容器 `scrollWidth <= clientWidth + 2`，
 *    且子元素右边界不超出面板。小屏最容易出问题（标题栏 6 个按钮）。
 *
 * C. **响应式四档**：390 / 768 / 1024 / 1440 都要能打开面板、4 张能力卡、
 *    无元素被压扁（卡高 < 40px 视为挤坏）。
 *
 * D. **文字对比度**：能力卡正文/提示行 ≥ 4.5（正文标准）。
 *
 * ## 已知的"设计意图"，不要当成 bug
 *
 * - 浅色主题下太阳**填充**对比很低（1.32）—— 这是有意的，靠描边勾轮廓
 * - 能力卡文案用了 `truncate`，长文案被截断是设计（避免撑破卡片）
 */
const { chromium } = require("playwright");
const fs = require("fs");

const API = process.env.SUNNYDOC_API || "http://127.0.0.1:8000";
const WEB = process.env.SUNNYDOC_WEB || "http://localhost:3001";
const TOKEN =
  process.env.SUNNYDOC_TOKEN ||
  fs.readFileSync(process.env.SUNNYDOC_TOKEN_FILE || "/tmp/sunnydoc-token.txt", "utf8").trim();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
const check = (n, ok, d) => {
  if (ok) {
    pass++;
    console.log("  ✅ " + n);
  } else {
    fail++;
    console.log("  ❌ " + n + "\n       " + String(d).slice(0, 280));
  }
};

function parseCss(css) {
  const m = String(css).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/);
  if (!m) return null;
  return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
}
function lum(c) {
  const f = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}
function contrast(a, b) {
  if (!a || !b) return null;
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** 进库 → 开文档 → 打开 AI 面板。返回是否成功。 */
async function openPanel(p, mobile) {
  const click = async (loc) => {
    if (mobile) await loc.tap().catch(async () => await loc.click());
    else await loc.click();
  };
  const card = p.locator('[data-testid="kb-card"]').first();
  if ((await card.count()) === 0) return false;
  await click(card);
  for (let i = 0; i < 40; i++) {
    if (await p.evaluate(() => document.querySelectorAll("[data-tree-kind]").length > 0)) break;
    await sleep(300);
  }
  await sleep(700);
  const row = p.locator('[data-tree-kind="doc"]:visible').first();
  if (await row.count()) {
    await click(row);
    await sleep(1800);
  }
  const btn = p.locator('button:has-text("AI 助理")').first();
  if ((await btn.count()) === 0) return false;
  if (mobile && !(await btn.isVisible())) {
    // 小屏入口可能只有图标：退而求其次按 title 找
    const icon = p.locator('button[title*="AI 助理"], button[aria-label*="AI 助理"]').first();
    if ((await icon.count()) === 0) return false;
    await click(icon);
  } else {
    await click(btn);
  }
  await sleep(1400);
  return true;
}

(async () => {
  if (!TOKEN) {
    console.log("❌ 缺少 token");
    process.exit(1);
  }
  console.log("=== AI 助理视觉护栏 ===\n");

  const b = await chromium.launch({ headless: true, args: ["--no-proxy-server"] });
  try {
    // ---------- A + D. 双主题：Logo 可辨性、文字对比度 ----------
    for (const theme of ["light", "dark"]) {
      console.log(`【A/D】${theme === "light" ? "浅色" : "深色"}主题`);
      const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 }, locale: "zh-CN", colorScheme: theme });
      const p = await ctx.newPage();
      await p.addInitScript((t) => localStorage.setItem("sunnydoc.token", t), TOKEN);
      await p.goto(WEB + "/", { waitUntil: "domcontentloaded" });
      await sleep(3400);
      await p.addStyleTag({ content: "nextjs-portal{display:none!important;pointer-events:none!important}" });
      if (theme === "dark") {
        // 项目用 data-theme 而不是 .dark
        await p.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
        await sleep(500);
      }
      const ok = await openPanel(p, false);
      check(`能打开 AI 面板`, ok, "未找到入口或知识库卡片");
      if (!ok) {
        await ctx.close();
        continue;
      }

      const m = await p.evaluate(() => {
        const panel = Array.from(document.querySelectorAll("aside"))
          .filter((a) => a.getBoundingClientRect().width > 0)
          .pop();
        // 向上找第一个不透明背景（logo 自己是透明的）
        const bgOf = (el) => {
          let n = el;
          while (n && n !== document.documentElement) {
            const bg = getComputedStyle(n).backgroundColor;
            const mm = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/);
            if (mm && (mm[4] === undefined || +mm[4] > 0.95)) return bg;
            n = n.parentElement;
          }
          return getComputedStyle(document.body).backgroundColor;
        };
        const cap = panel.querySelector("[data-ai-capabilities] button");
        const capText = cap?.querySelector("span > span");
        const capHint = cap?.querySelectorAll("span > span")[1];
        return {
          hero: (() => {
            const el = panel.querySelector('[data-ai-logo="hero"]');
            if (!el) return null;
            const pa = el.querySelector("path");
            return {
              bg: bgOf(el),
              // 容器**自身**的背景（不向上找）—— 用来判「有没有加底色」
              ownBg: getComputedStyle(el).backgroundColor,
              fill: getComputedStyle(pa).fill,
              stroke: getComputedStyle(pa).stroke,
            };
          })(),
          capBg: cap ? getComputedStyle(cap).backgroundColor : null,
          capText: capText ? getComputedStyle(capText).color : null,
          capHint: capHint ? getComputedStyle(capHint).color : null,
          caps: panel.querySelectorAll("[data-ai-capabilities] button").length,
        };
      });

      if (m.hero) {
        const bg = parseCss(m.hero.bg);
        const rf = contrast(parseCss(m.hero.fill), bg);
        const rs = contrast(parseCss(m.hero.stroke), bg);
        check(
          `Logo 可辨（填充 ${rf?.toFixed(2)} / 描边 ${rs?.toFixed(2)}，至少一项 ≥3）`,
          (rf ?? 0) >= 3 || (rs ?? 0) >= 3,
          "两项都 <3：logo 会糊在底色里",
        );
        // 🔴 还必须判「容器自己没有底色」。
        //    实测（2026-11-18）：给 logo 加 `bg-accent-soft` 后，太阳只占 **14.7%**、
        //    底色占 **66.3%** —— 视觉上变成「蓝色圆角块 + 小太阳」，
        //    与品牌「透明底」设定不符。而且这个改动**能通过上面的
        //    『填充 OR 描边 ≥3』**（浅色描边仍有 8.27）—— 那条判据太松。
        //    所以单独钉一条：容器自身背景必须透明。
        check(
          `Logo 容器无底色（bg=${m.hero.ownBg}）`,
          /rgba?\([^)]*,\s*0\)/.test(m.hero.ownBg) || m.hero.ownBg === "transparent",
          "容器有底色会让太阳缩成小图标，破坏品牌一致性",
        );
      }

      const capBg = parseCss(m.capBg);
      const ct = contrast(parseCss(m.capText), capBg);
      const ch = contrast(parseCss(m.capHint), capBg);
      check(`能力卡正文对比度 ${ct?.toFixed(2)} ≥ 4.5`, (ct ?? 0) >= 4.5, `实测 ${ct?.toFixed(2)}`);
      check(`能力卡提示行对比度 ${ch?.toFixed(2)} ≥ 4.5`, (ch ?? 0) >= 4.5, `实测 ${ch?.toFixed(2)}`);
      check(`空态渲染 ${m.caps} 张能力卡`, m.caps === 4, `实测 ${m.caps}`);
      await ctx.close();
      console.log();
    }

    // ---------- B + C. 响应式四档：溢出 / 压扁 ----------
    console.log("【B/C】响应式（390 / 768 / 1024 / 1440）");
    for (const vp of [
      { w: 390, h: 844, n: "手机" },
      { w: 768, h: 1024, n: "平板" },
      { w: 1024, h: 768, n: "小桌面" },
      { w: 1440, h: 900, n: "桌面" },
    ]) {
      const mobile = vp.w < 800;
      const ctx = await b.newContext({ viewport: { width: vp.w, height: vp.h }, locale: "zh-CN", hasTouch: mobile, isMobile: mobile });
      const p = await ctx.newPage();
      await p.addInitScript((t) => localStorage.setItem("sunnydoc.token", t), TOKEN);
      await p.goto(WEB + "/", { waitUntil: "domcontentloaded" });
      await sleep(3400);
      await p.addStyleTag({ content: "nextjs-portal{display:none!important;pointer-events:none!important}" });
      const ok = await openPanel(p, mobile);
      check(`${vp.n} ${vp.w}px 能打开面板`, ok, "未找到入口");
      if (ok) {
        const m = await p.evaluate(() => {
          const panel = Array.from(document.querySelectorAll("aside"))
            .filter((a) => a.getBoundingClientRect().width > 0)
            .pop();
          const pr = panel.getBoundingClientRect();
          const scroll = panel.querySelector(".overflow-y-auto");
          const over = [];
          panel.querySelectorAll("*").forEach((el) => {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) return;
            if (r.right > pr.right + 1 || r.left < pr.left - 1) {
              const t = (el.innerText || "").trim().slice(0, 18);
              if (t) over.push(t);
            }
          });
          const caps = Array.from(panel.querySelectorAll("[data-ai-capabilities] button"));
          return {
            panelW: Math.round(pr.width),
            hScroll: scroll ? scroll.scrollWidth > scroll.clientWidth + 2 : false,
            over: over.slice(0, 4),
            caps: caps.length,
            squeezed: caps.filter((c) => c.getBoundingClientRect().height < 40).length,
          };
        });
        check(`${vp.n} 无横向溢出`, !m.hScroll && m.over.length === 0,
          m.hScroll ? "滚动容器有横向滚动" : `元素越界: ${JSON.stringify(m.over)}`);
        check(`${vp.n} 4 张卡未被压扁`, m.caps === 4 && m.squeezed === 0,
          `卡数=${m.caps} 压扁=${m.squeezed}`);
      }
      await ctx.close();
    }
  } finally {
    await b.close().catch(() => {});
  }

  console.log(`\n通过 ${pass} / 失败 ${fail}`);
  console.log(fail === 0 ? "✅ 全部通过" : "❌ 存在失败项");
  process.exit(fail ? 1 : 0);
})();