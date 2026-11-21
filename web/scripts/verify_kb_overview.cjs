#!/usr/bin/env node
/**
 * 知识库总览 + 文档顶栏分层护栏
 *
 * ## 为什么需要它
 *
 * 2026-11-21 实测两处「信息架构」问题：
 *
 * ### 1. 进入知识库后主区只有一份「最近浏览」
 *
 * 20 条、行高 69px、总高 **1501px**：1600×1000 下要滚 581px，
 * 1366×768 下首屏只看得到 10 条就到底了；而**这个知识库有什么**
 * （目录、文档规模、置顶、收藏）全都没有 —— 只能靠侧栏树自己翻。
 *
 * 语雀 / Notion 进知识库的第一屏是**总览**，「最近浏览」只是其中一块。
 *
 * ### 2. 文档顶栏 8 个动作全平铺、等宽
 *
 * 实测「复制/分享/收藏/置顶/标签/摘要/历史/评论」各 **72×32**，
 * 一排占 640px，主次完全抹平 —— **每分钟按的「编辑」和一年按一次的「置顶」
 * 长得一模一样**。而且「复制」「分享」两个"把内容带出去"的动作紧邻，易误点。
 *
 * ## 判据
 *
 * A. 总览：主区有 `h1` = 知识库名 + 规模副标题；首屏（1600×1000）无需滚动
 * B. 总览：目录块可点 → 侧栏对应文件夹 `data-open="1"`（真的展开了）
 * C. 总览：「最近浏览」被降级（≤8 条），不再独占主区
 * D. 顶栏：可见的**文字按钮**只剩主操作（编辑），其余是图标（32×32）
 * E. 顶栏：每个图标按钮都有 `aria-label`（文字收起后不能变无名按钮）
 * F. 顶栏：「更多」下拉含置顶/标签/摘要/历史，且点「置顶」真的生效
 *
 * ## 已知的设计意图（勿改）
 *
 * - 总览**不新增接口**，全部由已有 metas/folders/recent 前端现算。
 * - 低频项收进下拉、但**频次高的（复制/分享/收藏/评论）保持常显图标** ——
 *   收得太多会变成"什么都得点两下"。
 * - 「编辑」保持文字 + 实心主色：它是这一屏唯一的视线终点。
 *
 * ## 用法
 *   cd web && NODE_PATH=<node_modules> node scripts/verify_kb_overview.cjs
 */
const { chromium } = require("playwright");
const fs = require("fs");

const WEB = "http://localhost:3001";
const TOKEN = (
  process.env.SUNNYDOC_TOKEN ||
  fs.readFileSync(process.env.SUNNYDOC_TOKEN_FILE || "/tmp/sunnydoc-token.txt", "utf8")
).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0,
  fail = 0;
function check(name, ok, extra = "") {
  console.log(`  ${ok ? "✅" : "❌"} ${name}${extra ? "  " + extra : ""}`);
  ok ? pass++ : fail++;
}

(async () => {
  console.log("=== 知识库总览 + 文档顶栏护栏 ===");

  const b = await chromium.launch({ headless: true, args: ["--no-proxy-server"] });
  const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 }, locale: "zh-CN" });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e).slice(0, 140)));

  await p.addInitScript((t) => localStorage.setItem("sunnydoc.token", t), TOKEN);
  await p.goto(WEB + "/", { waitUntil: "domcontentloaded" });
  await sleep(3600);
  await p.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  await p.locator('[data-testid="kb-card"]').first().click();
  for (let i = 0; i < 40; i++) {
    if (await p.evaluate(() => document.querySelectorAll("[data-tree-kind]").length > 0)) break;
    await sleep(250);
  }
  await sleep(1100);

  /* ---------- A/B/C：总览 ---------- */
  const ov = await p.evaluate(() => {
    const main = document.querySelector("main");
    if (!main) return null;
    const h1 = main.querySelector("h1");
    const secs = [...main.querySelectorAll("section")].map((s) => ({
      head: (s.querySelector("h2")?.innerText || "").replace(/\n/g, " "),
      btns: s.querySelectorAll("button").length,
    }));
    return {
      h1: (h1?.innerText || "").trim(),
      sub: (h1?.nextElementSibling?.innerText || "").trim(),
      secs,
      scrollH: main.scrollHeight,
      clientH: main.clientHeight,
      // 旧实现里主区第一个 h2 是「最近浏览」
      firstHeading: (main.querySelector("h2")?.innerText || "").trim().split("\n")[0],
    };
  });

  check("主区有知识库标题（h1）", !!ov && ov.h1.length > 0, ov?.h1 || "无 h1");
  check(
    "标题下有规模副标题（N 篇文档 · M 个目录）",
    !!ov && /篇文档/.test(ov.sub),
    ov?.sub || "无",
  );
  check(
    "首屏无需滚动（1600×1000 下 scrollH ≤ clientH）",
    !!ov && ov.scrollH <= ov.clientH + 4,
    `scrollH=${ov?.scrollH} clientH=${ov?.clientH}（旧实现 1501/920）`,
  );
  check(
    "「最近浏览」不再独占主区（首个区块不是它）",
    !!ov && ov.firstHeading !== "最近浏览",
    `first=${ov?.firstHeading}`,
  );
  check(
    "主区有「目录」区块",
    !!ov && ov.secs.some((s) => s.head.startsWith("目录")),
    JSON.stringify(ov?.secs.map((s) => s.head)),
  );

  // 最近浏览被降级（≤8 条）
  const recentRows = await p.evaluate(() => {
    const sec = [...document.querySelectorAll("main section")].find((s) =>
      (s.querySelector("h2")?.innerText || "").includes("最近浏览"),
    );
    return sec ? sec.querySelectorAll("li").length : -1;
  });
  check("「最近浏览」条目 ≤8（原 20 条 / 1356px）", recentRows >= 0 && recentRows <= 8, `${recentRows} 条`);

  /* ---------- B：点目录 → 侧栏真的展开 ---------- */
  const dirName = await p
    .locator("main section")
    .filter({ hasText: "目录" })
    .first()
    .locator("button")
    .first()
    .evaluate((el) => (el.innerText || "").trim().split("\n")[0])
    .catch(() => "");
  if (dirName) {
    await p
      .locator("main section")
      .filter({ hasText: "目录" })
      .first()
      .locator("button")
      .first()
      .click();
    await sleep(1200);
    const opened = await p.evaluate((name) => {
      const rows = [...document.querySelectorAll('[data-tree-kind="folder"]')];
      const t = rows.find((r) => (r.innerText || "").includes(name));
      // ⚠️ 文件夹行的展开态标记是 `data-open="1"`，**不是** aria-expanded
      //    （aria-expanded 只用在"更多操作"菜单上）。用错属性会得到
      //    "点了没反应"的假失败。
      return {
        found: !!t,
        open: t ? t.getAttribute("data-open") : null,
        visible: t ? t.getBoundingClientRect().width > 0 : false,
      };
    }, dirName);
    check(
      `点目录「${dirName}」→ 侧栏对应文件夹展开`,
      opened.found && opened.open === "1" && opened.visible,
      JSON.stringify(opened),
    );
  } else {
    check("点目录 → 侧栏对应文件夹展开", false, "前置：总览里没有目录块");
  }

  /* ---------- D/E/F：文档顶栏 ---------- */
  const docs = await p.evaluate(() =>
    [...document.querySelectorAll('[data-tree-kind="doc"]')].map((e) => e.getAttribute("data-tree-key")),
  );
  if (docs.length) {
    await p.locator(`[data-tree-key="${docs[0]}"]`).click();
    await sleep(2700);

    const bar = await p.evaluate(() => {
      // ⚠️ 必须限定在**顶栏容器**内，不能用 "top < 120" 这种坐标近似：
      //    大纲侧栏（右侧 aside）里的目录树按钮也是按钮，实测坐标同样落在
      //    顶部区域（211×29），会被误算成"顶栏动作"→ 假失败。
      //    顶栏是 main 里第一个带 border-b 的 flex 行。
      const main = document.querySelector("main");
      const header = [...main.querySelectorAll("div")].find(
        (d) =>
          typeof d.className === "string" &&
          d.className.includes("border-b") &&
          d.className.includes("h-12"),
      );
      if (!header) return [];
      const btns = [...header.querySelectorAll("button")].filter((x) => x.offsetParent !== null);
      return btns.map((x) => {
        const r = x.getBoundingClientRect();
        return {
          text: (x.innerText || "").trim(),
          aria: (x.getAttribute("aria-label") || "").trim(),
          title: (x.getAttribute("title") || "").trim(),
          w: Math.round(r.width),
          h: Math.round(r.height),
        };
      });
    });

    // 文字型按钮应当只剩「编辑」（主操作）
    const textBtns = bar.filter((x) => x.text && x.text.length <= 4);
    check(
      "顶栏文字按钮只剩主操作「编辑」",
      textBtns.length === 1 && /^编辑$/.test(textBtns[0].text),
      JSON.stringify(textBtns.map((x) => x.text)),
    );
    // 图标按钮 32×32
    const iconBtns = bar.filter((x) => !x.text || x.text.length > 4);
    check(
      "顶栏其余动作是 32×32 图标按钮",
      iconBtns.length >= 3 && iconBtns.every((x) => x.w >= 30 && x.w <= 40 && x.h >= 30 && x.h <= 40),
      iconBtns.map((x) => `${x.aria || x.title}=${x.w}×${x.h}`).join(" "),
    );
    // 每个图标按钮都要有可访问名
    const unnamed = iconBtns.filter((x) => !x.aria && !x.title).length;
    check("顶栏图标按钮都有 aria-label / title", unnamed === 0, `unnamed=${unnamed}`);
    // 原来 9 个动作平铺占 640px 宽度
    const barW = iconBtns.reduce((a, x) => a + x.w, 0);
    check("顶栏动作区宽度明显收窄（原 8×72=576px）", barW < 400, `${barW}px`);

    /* F. 「更多」下拉 */
    const more = p.locator('button[aria-label="更多文档操作"]');
    check("有「更多文档操作」入口", (await more.count()) > 0);
    if (await more.count()) {
      await more.click();
      await sleep(450);
      const items = await p.evaluate(() =>
        [...document.querySelectorAll('main [role="menuitem"]')]
          .filter((e) => e.getBoundingClientRect().width > 0)
          .map((e) => e.innerText.trim()),
      );
      check(
        "「更多」含置顶/标签/摘要/历史",
        ["置顶", "标签", "AI 摘要", "版本历史"].every((t) => items.some((i) => i.startsWith(t))),
        JSON.stringify(items),
      );
      // 点「置顶」要真的生效：再打开菜单应变成「取消置顶」
      const pin = p.locator('main [role="menuitem"]').filter({ hasText: /^置顶$/ }).first();
      let toggled = false;
      if (await pin.count()) {
        await pin.click();
        await sleep(1000);
        await p.locator('button[aria-label="更多文档操作"]').click();
        await sleep(450);
        const after = await p.evaluate(() =>
          [...document.querySelectorAll('main [role="menuitem"]')]
            .filter((e) => e.getBoundingClientRect().width > 0)
            .map((e) => e.innerText.trim()),
        );
        toggled = after.some((t) => t.startsWith("取消置顶"));
        // 复原，避免污染用户数据
        const un = p.locator('main [role="menuitem"]').filter({ hasText: /^取消置顶$/ }).first();
        if (await un.count()) { await un.click(); await sleep(600); }
        else { await p.keyboard.press("Escape"); await p.mouse.click(700, 700); }
      }
      check("点「置顶」真的生效（菜单变「取消置顶」）", toggled);
    }
  } else {
    check("顶栏分层", false, "前置：树里没有文档");
  }

  check("运行期无未捕获页面异常", errs.length === 0, errs.join(" | "));

  await b.close();
  console.log(`\n${pass} 通过 / ${fail} 失败`);
  console.log(fail === 0 ? "✅ 全部通过" : "❌ 存在失败项");
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("脚本异常：", e.message);
  process.exit(1);
});