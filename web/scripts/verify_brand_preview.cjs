#!/usr/bin/env node
/**
 * 验证品牌预览页（`docs/brand/preview.html`）—— 用户做设计决策的唯一依据。
 *
 * 这个页面必须自身可靠：若有渲染错误、SVG 缺失或明暗切换失效，
 * 用户会基于错误的观感做决策。所以逐项断言。
 *
 * ## 本版页面的结构（2026-10-21 改版）
 *
 * 用户要求「透明底 + 随浏览器主题背景显示」，所以预览页不再有"多款配色方案"，
 * 改为**同一份透明底 logo 贴在 8 个真实位置上**，核心验证是「明暗两主题都清晰」。
 *
 * 🔴 期望值从模板结构**精确推导**，不拍「差不多」的阈值
 *    （本项目曾因写 `gradBoxes >= 18` 而实际应为 15 造成一次假失败；
 *     又在结构改版后因写死 12 而连报 4 项假失败 —— 结构变了就必须回头改期望值）。
 *    当前结构：8 个展示点，其中 1 个（登录页左栏）使用自己的深玻璃底，
 *    其余 7 个直接贴在页面背景上（透明底，无自己的底色）。
 */
const { chromium } = require("playwright");
const path = require("path");

const PREVIEW = "file://" + path.resolve(__dirname, "../../docs/brand/preview.html");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (n, ok, d = "") => {
  console.log(`  ${ok ? "✅" : "❌"} ${n}${d ? "  " + d : ""}`);
  ok ? pass++ : fail++;
};

const EXPECT_SPOTS = 8;       // SPOTS 数组长度
const EXPECT_SIZES = 8;       // SIZES：16/20/28/32/40/48/56/128
const EXPECT_HERO_CHIP = 1;   // 仅「登录页左栏」用自己的深玻璃底

(async () => {
  const b = await chromium.launch({ headless: true, args: ["--no-proxy-server"] });
  const p = await b.newPage({ viewport: { width: 1400, height: 1200 } });
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));
  p.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 200)); });

  await p.goto(PREVIEW, { waitUntil: "load" });
  await sleep(1200);

  const s = await p.evaluate(() => {
    const spots = [...document.querySelectorAll(".spot")];
    let svgCount = 0, heroChip = 0, transparent = 0;
    for (const sp of spots) {
      if (sp.querySelector("svg")) svgCount++;
      const holder = sp.querySelector("span[style]");
      if (!holder) continue;
      const cs = getComputedStyle(holder);
      const hasOwnBg = cs.backgroundColor !== "rgba(0, 0, 0, 0)"
        || (cs.backgroundImage && cs.backgroundImage !== "none");
      if (hasOwnBg) heroChip++; else transparent++;
    }
    return {
      spots: spots.length,
      svgCount,
      heroChip,
      transparent,
      sizes: document.querySelectorAll("#sizes figure").length,
      tables: document.querySelectorAll("table tr").length,
      sunny: (document.body.innerText.match(/Sunny/g) || []).length,
    };
  });

  console.log("=== 结构 ===");
  console.log("  " + JSON.stringify(s));

  check(`展示点 = ${EXPECT_SPOTS}（全部真实位置）`, s.spots === EXPECT_SPOTS, `spots=${s.spots}`);
  check("每个展示点都渲染了 SVG", s.svgCount === EXPECT_SPOTS, `svg=${s.svgCount}`);
  check(`带自己底色的仅 ${EXPECT_HERO_CHIP} 个（登录页深玻璃）`,
    s.heroChip === EXPECT_HERO_CHIP, `heroChip=${s.heroChip}`);
  check(`其余 ${EXPECT_SPOTS - EXPECT_HERO_CHIP} 个为透明底（随页面背景）`,
    s.transparent === EXPECT_SPOTS - EXPECT_HERO_CHIP, `transparent=${s.transparent}`);
  check(`尺寸压力测试 = ${EXPECT_SIZES} 档`, s.sizes === EXPECT_SIZES, `sizes=${s.sizes}`);
  check("规格表存在（≥8 行）", s.tables >= 8, `rows=${s.tables}`);
  check("页面含品牌字 Sunny", s.sunny >= 6, `count=${s.sunny}`);

  console.log("\n=== 明暗切换（本页核心：透明底要跨主题成立）===");
  const before = await p.evaluate(() => document.documentElement.dataset.theme);
  await p.click(".toggle");
  await sleep(600);
  const after = await p.evaluate(() => document.documentElement.dataset.theme);
  const bgAfter = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check("主题可切换到 dark", before === "light" && after === "dark", `${before} → ${after}`);
  check("深色主题背景确实变暗", bgAfter !== "rgb(255, 255, 255)", bgAfter);

  // 关键：两主题下 logo 都还在（不能因为透明底而在某主题下消失）
  const stillThere = await p.evaluate(() => {
    let n = 0;
    for (const sp of document.querySelectorAll(".spot")) {
      const svg = sp.querySelector("svg");
      if (svg && svg.getBoundingClientRect().width > 0) n++;
    }
    return n;
  });
  check("深色主题下所有 logo 仍渲染（未因透明底消失）",
    stillThere === EXPECT_SPOTS, `visible=${stillThere}`);

  await p.click(".toggle");
  await sleep(400);
  const back = await p.evaluate(() => document.documentElement.dataset.theme);
  check("可切回浅色", back === "light", back);

  check("运行期无未捕获异常", errs.length === 0, errs.slice(0, 2).join(" | "));

  await p.screenshot({ path: "/tmp/preview_full.png", fullPage: true });
  console.log("\n  已保存整页截图 /tmp/preview_full.png");
  // 🔴 输出格式必须含「全部通过」—— runner（run_all_verify.cjs）正是按这个字符串
  //    判定成功的（见其 `/全部通过|ALL PASS/.test(out)`）。只打印「通过 N / 失败 0」
  //    会被判为「退出码 0 但未见『全部通过』」→ **假失败**（本轮踩过）。
  console.log(`\n通过 ${pass} / 失败 ${fail}`);
  console.log(fail === 0 ? "✅ 全部通过" : "❌ 存在失败项");
  await b.close();
  process.exit(fail ? 1 : 0);
})();