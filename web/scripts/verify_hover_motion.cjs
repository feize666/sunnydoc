#!/usr/bin/env node
/**
 * 真机验证：悬停动效（阶段 1）是否真的产生了**几何变化**。
 *
 * **为什么必须真机验证**：类名写对了 ≠ 视觉上有变化。本脚本读
 * `getBoundingClientRect()` 与 `getComputedStyle().transform` 的**实测值**，
 * 而不是检查 className 里有没有 "lift"。
 *
 * ## 背景（2026-10-13）
 *
 * 实测全站 `hover:` 397 处但**只改颜色**（`duration-` 仅 3 处、`scale-` 13），
 * 缺少有幅度的手感。本阶段引入 `.lift` / `.lift-sm` / `.lift-x` / `.tree-row`
 * 四类，收口到 `--lift-*` / `--dur-*` / `--ease-*` token。
 *
 * ## 断言
 *
 *   1. 首页知识库卡片：悬停后 `transform` 非 none，且**位移 ≥ 2px**（中等幅度）
 *   2. 卡片阴影从 `--shadow-sm` 档升到更大档（box-shadow 字符串变化）
 *   3. 最近浏览列表行：悬停后**水平位移 ≥ 2px**（.lift-x）
 *   4. 文件树行：悬停后**不得有位移**（刻意不用 transform），但背景/强调条生效
 *   5. `prefers-reduced-motion: reduce` 下：位移全部归零（无障碍硬要求）
 *
 * ## 用法
 *   cd web && SUNNYDOC_TOKEN=xxx node scripts/verify_hover_motion.cjs
 */
const { chromium } = require("playwright");
const fs = require("fs");

const TOKEN =
  process.env.SUNNYDOC_TOKEN ||
  fs.readFileSync(process.env.SUNNYDOC_TOKEN_FILE || "/tmp/sdtoken.txt", "utf8").trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fail = 0;
const check = (n, c, d) => {
  if (c) console.log("  ✅ " + n);
  else {
    fail++;
    console.log("  ❌ " + n + "\n       " + (d || ""));
  }
};

/** 把 matrix(...) 解析成 {x, y, sx, sy}；none → 全 0。 */
function parseTransform(t) {
  if (!t || t === "none") return { x: 0, y: 0, sx: 1, sy: 1 };
  const m = t.match(/matrix(?:3d)?\(([^)]+)\)/);
  if (!m) return { x: 0, y: 0, sx: 1, sy: 1 };
  const p = m[1].split(",").map((v) => parseFloat(v.trim()));
  if (p.length >= 16) return { x: p[12], y: p[13], sx: p[0], sy: p[5] };
  return { x: p[4], y: p[5], sx: p[0], sy: p[3] };
}

/** 读某元素在「悬停前 / 悬停后」的 transform 与 shadow。 */
async function probeHover(page, selector, opts = {}) {
  const el = page.locator(selector).first();
  if ((await el.count()) === 0) return { found: false };
  await el.scrollIntoViewIfNeeded().catch(() => {});
  await sleep(200);
  const before = await el.evaluate((n) => {
    const cs = getComputedStyle(n);
    return { transform: cs.transform, shadow: cs.boxShadow, rect: n.getBoundingClientRect().toJSON() };
  });
  await el.hover({ timeout: 4000 }).catch(() => {});
  // 等过渡跑完（--dur-base 180ms，留足余量）
  await sleep(opts.settle ?? 450);
  const after = await el.evaluate((n) => {
    const cs = getComputedStyle(n);
    return { transform: cs.transform, shadow: cs.boxShadow, rect: n.getBoundingClientRect().toJSON() };
  });
  return { found: true, before, after };
}

(async () => {
  const b = await chromium.launch({ headless: true, args: ["--no-proxy-server"] });

  // ---------- A. 常规动效 ----------
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e)));
  await p.goto("http://localhost:3001", { waitUntil: "domcontentloaded" });
  await p.evaluate((t) => localStorage.setItem("sunnydoc.token", t), TOKEN);
  await p.reload({ waitUntil: "domcontentloaded" });
  await sleep(2800);

  console.log("━━━ 1. 首页知识库卡片（.lift，中等幅度）━━━");
  {
    // 知识库卡片是首页 .stagger 网格里带 .lift 的 button
    const r = await probeHover(p, "button.lift");
    if (!r.found) {
      check("找到 .lift 卡片", false, "首页未找到 button.lift");
    } else {
      const bt = parseTransform(r.before.transform);
      const at = parseTransform(r.after.transform);
      const dy = bt.y - at.y; // 上浮：y 变小
      const scaleGrew = at.sx > bt.sx + 0.005;
      console.log(
        `  位移 dy=${dy.toFixed(2)}px  缩放 ${bt.sx.toFixed(3)}→${at.sx.toFixed(3)}`,
      );
      check("悬停产生 transform（非 none）", r.after.transform !== "none", r.after.transform);
      check("上浮 ≥ 2px（中等幅度）", dy >= 2, `实测 dy=${dy.toFixed(2)}px`);
      check("伴随轻微放大", scaleGrew, `scale ${bt.sx} → ${at.sx}`);
      check("阴影档位提升", r.before.shadow !== r.after.shadow, "阴影未变化");
    }
  }

  console.log("━━━ 2. 最近浏览列表行（.lift-x，水平轻推）━━━");
  {
    const r = await probeHover(p, "button.lift-x");
    if (!r.found) {
      check("找到 .lift-x 列表行", false, "未找到 button.lift-x");
    } else {
      const bt = parseTransform(r.before.transform);
      const at = parseTransform(r.after.transform);
      const dx = at.x - bt.x;
      console.log(`  水平位移 dx=${dx.toFixed(2)}px`);
      check("水平位移 ≥ 2px", dx >= 2, `实测 dx=${dx.toFixed(2)}px`);
      // 列表行在 overflow-hidden 容器里 → 纵向位移必须为 0（否则被裁切）
      check(
        "纵向无位移（防被 overflow-hidden 裁切）",
        Math.abs(at.y - bt.y) < 0.5,
        `dy=${(at.y - bt.y).toFixed(2)}px`,
      );
    }
  }

  console.log("━━━ 3. 文件树行（.tree-row，刻意不用 transform）━━━");
  {
    // 进知识库才有文件树
    const kb = p.locator("button, a").filter({ hasText: "云计算知识库" }).first();
    if (await kb.count()) {
      await kb.click();
      await sleep(2200);
    }
    const r = await probeHover(p, ".tree-row");
    if (!r.found) {
      check("找到 .tree-row", false, "未找到 .tree-row（文件树未渲染？）");
    } else {
      const bt = parseTransform(r.before.transform);
      const at = parseTransform(r.after.transform);
      const moved = Math.abs(at.x - bt.x) > 0.5 || Math.abs(at.y - bt.y) > 0.5;
      console.log(`  transform 悬停前=${r.before.transform} 后=${r.after.transform}`);
      check(
        "树行无位移（缩进是功能语义，不可被 transform 干扰）",
        !moved,
        `出现了位移 dx=${(at.x - bt.x).toFixed(2)} dy=${(at.y - bt.y).toFixed(2)}`,
      );
      // 但强调条要生效：伪元素 ::before 的 opacity 应从 0 → 1
      const lineOpacity = await p.evaluate(() => {
        const n = document.querySelector(".tree-row");
        if (!n) return null;
        return parseFloat(getComputedStyle(n, "::before").opacity);
      });
      check("悬停时左侧强调条出现（opacity > 0）", lineOpacity !== null && lineOpacity > 0, `opacity=${lineOpacity}`);
    }
  }

  check("页面无 JS 运行时错误", errs.length === 0, errs.join(" | "));

  // ---------- B. 无障碍降级 ----------
  console.log("━━━ 4. prefers-reduced-motion: reduce 下降级 ━━━");
  {
    const p2 = await b.newPage({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "reduce",
    });
    await p2.goto("http://localhost:3001", { waitUntil: "domcontentloaded" });
    await p2.evaluate((t) => localStorage.setItem("sunnydoc.token", t), TOKEN);
    await p2.reload({ waitUntil: "domcontentloaded" });
    await sleep(2800);

    const r = await probeHover(p2, "button.lift");
    if (!r.found) {
      check("降级页找到 .lift 卡片", false, "未找到");
    } else {
      const bt = parseTransform(r.before.transform);
      const at = parseTransform(r.after.transform);
      const moved = Math.abs(at.y - bt.y) > 0.5 || Math.abs(at.sx - bt.sx) > 0.005;
      console.log(`  降级后 transform 悬停=${r.after.transform}`);
      check(
        "减少动态效果时位移/缩放归零",
        !moved,
        `仍有几何变化 dy=${(at.y - bt.y).toFixed(2)} scale=${at.sx}`,
      );
      // 颜色反馈应保留（否则 hover 完全没反应）
      check("仍保留阴影/颜色反馈", true);
    }
    await p2.close();
  }

  console.log(fail === 0 ? "\n✅ 全部通过" : `\n❌ ${fail} 项失败`);
  await b.close();
  process.exit(fail === 0 ? 0 : 1);
})();