#!/usr/bin/env node
/**
 * 侧栏信息架构护栏
 *
 * ## 为什么需要它
 *
 * 侧栏是每天看几百次的地方，但它的头部分区是"长期只增不减"的：
 * 实测改造前头部 **175px**（知识库名 24 + 新建/导入/导出 78 + 搜索排序 36
 * + 内边距），在 920px 高的侧栏里占 19%；在 600px 高的笔记本屏上占 29%，
 * 树只剩 400px 左右 —— 14 个顶级目录根本展不开。
 *
 * 问题不是"按钮不该有"，而是**频率差异被抹平**：
 * 「导入」「导出」是建库时用一次、之后一年用几次的动作，
 * 却和「新建」这种高频动作平铺成三个等宽的带文字按钮。
 *
 * 这类问题不会报错、不会崩，只是"侧栏越来越挤"——
 * 没人会为它提 bug，但每天都在为此多点几下、多滚几屏。
 *
 * ## 判据
 *
 * A. 头部高度 ≤140px（原 175px）；树区 ≥720px（原 699px）
 * B. 常显的操作按钮只剩「新建」（导入/导出收进「更多」）
 * C. 「更多」下拉里有导入/导出，且点「导入文档」能打开对话框
 * D. 树区有分区标题（用户知道"以下是我的文档树"）
 * E. ⚠️ 「更多」按钮的 title **不能含"导出"** —— 见下方说明
 *
 * ## ⚠️ 为什么单独守 E 这一条
 *
 * 给「更多」写的 title 是「更多操作（导入 / 导出 / 回收站）」时，
 * 画布编辑器的护栏用 `button[title*="导出"]` 定位导出菜单，**抢先命中了侧栏这个按钮**
 * → 点开的是"更多"下拉 → 画布导出菜单没开 → `导出 PNG 有产物 size=0` 假失败。
 *
 * 「新增文案撞上已有选择器」不会报错、不会警告，只会让别处的选择器默默选错元素。
 * 所以这条要写成断言：侧栏「更多」的 title 不许含"导出 / 导入"字样。
 *
 * ## 已知的设计意图（勿改）
 *
 * - 「新建」**故意常显**（最高频），不塞进「更多」。
 * - 树区分区标题是 11px 的弱提示，不是可点区域 —— 不加交互。
 */
const { chromium } = require("playwright");
const fs = require("fs");

const WEB = "http://localhost:3001";
const TOKEN = fs.readFileSync("/tmp/sunnydoc-token.txt", "utf8").trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0,
  fail = 0;
function check(name, ok, extra = "") {
  console.log(`  ${ok ? "✅" : "❌"} ${name}${extra ? "  " + extra : ""}`);
  ok ? pass++ : fail++;
}

(async () => {
  console.log("=== 侧栏信息架构护栏 ===");

  const b = await chromium.launch({ headless: true, args: ["--no-proxy-server"] });
  const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 }, locale: "zh-CN" });
  const p = await ctx.newPage();
  await p.addInitScript((t) => localStorage.setItem("sunnydoc.token", t), TOKEN);
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e).slice(0, 140)));
  await p.goto(WEB + "/", { waitUntil: "domcontentloaded" });
  await sleep(3900);
  await p.addStyleTag({
    content: "nextjs-portal{display:none!important;pointer-events:none!important}",
  });
  await p.locator('[data-testid="kb-card"]').first().click();
  for (let i = 0; i < 40; i++) {
    if (await p.evaluate(() => document.querySelectorAll("[data-tree-kind]").length > 0)) break;
    await sleep(300);
  }
  await sleep(1200);

  const m = await p.evaluate(() => {
    const aside = Array.from(document.querySelectorAll("aside")).filter(
      (a) => a.getBoundingClientRect().width > 0,
    )[0];
    if (!aside) return null;
    const inner = aside.querySelector(':scope > div[class*="flex-col"]') || aside;
    const head = inner.children[0];
    const tree = aside.querySelector('[class*="overflow-y-auto"]');
    const more = document.querySelector('[data-testid="sidebar-more"]');
    return {
      headH: Math.round(head.getBoundingClientRect().height),
      treeH: tree ? Math.round(tree.getBoundingClientRect().height) : 0,
      moreTitle: more ? more.getAttribute("title") || "" : null,
      moreAria: more ? more.getAttribute("aria-label") || "" : null,
      hasSectionHead: (aside.innerText || "").includes("文档树"),
      actionBtns: [...aside.querySelectorAll("button")]
        .filter((x) => x.offsetParent !== null)
        .map((x) => (x.innerText || "").trim())
        .filter((t) => ["新建", "导入", "导出"].includes(t)),
    };
  });

  // ---------- A. 尺寸 ----------
  check(`侧栏头部 ≤140px（${m?.headH}px）`, !!m && m.headH <= 140, "原 175px，占 920px 侧栏的 19%");
  check(`树区 ≥720px（${m?.treeH}px）`, !!m && m.treeH >= 720, "原 699px");

  // ---------- B. 常显操作只剩新建 ----------
  check(
    `常显操作只剩「新建」（${m?.actionBtns.join("/") || "无"}）`,
    !!m && m.actionBtns.length === 1 && m.actionBtns[0] === "新建",
    "导入/导出低频，应收进「更多」",
  );

  // ---------- D. 分区标题 ----------
  check(`树区有分区标题`, !!m && m.hasSectionHead);

  // ---------- E. title 不许撞车 ----------
  check(
    `「更多」title 不含「导出/导入」（${m?.moreTitle}）`,
    !!m && !!m.moreTitle && !/导出|导入/.test(m.moreTitle),
    "含「导出」会被画布护栏的 button[title*=导出] 抢先命中",
  );
  check(`「更多」有 aria-label（${m?.moreAria}）`, !!m && !!m.moreAria, "纯图标按钮必须有");

  // ---------- C. 下拉可用 ----------
  if (m?.moreTitle !== null) {
    await p.locator('[data-testid="sidebar-more"]').first().click();
    await sleep(600);
    const menu = await p.evaluate(() =>
      [...document.querySelectorAll('[role="menu"] button')].map((x) => (x.innerText || "").trim()),
    );
    check(`下拉含导入/导出（${menu.join(" / ")}）`, menu.includes("导入文档") && menu.includes("导出文档"));

    const imp = p.locator('[data-testid="sidebar-more-import"]').first();
    if ((await imp.count()) > 0) {
      await imp.click();
      await sleep(900);
      const opened = await p.evaluate(() => (document.body.innerText || "").includes("导入"));
      check(`点「导入文档」能打开对话框`, opened);
      await p.keyboard.press("Escape");
      await sleep(400);
    } else {
      check(`点「导入文档」能打开对话框`, false, "菜单项未渲染");
    }
  }

  console.log(`\n页面错误: ${errs.length ? errs.join(" | ") : "无"}`);
  await b.close();
  console.log(`\n通过 ${pass} / 失败 ${fail}`);
  console.log(fail === 0 ? "✅ 全部通过" : "❌ 存在失败项");
  process.exit(fail === 0 ? 0 : 1);
})();