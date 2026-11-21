#!/usr/bin/env node
/**
 * 编辑器格式化工具栏护栏（单行 + 收起不丢失功能）
 *
 * ## 为什么需要它
 *
 * 2026-11-21 实测：`RichEditor` 工具栏 24 个控件、内容 793px。
 *
 * | 视口 | 工具栏宽 | 高度 | 行数 |
 * |---|---|---|---|
 * | 1600 | 1034 | **79px** | **2** |
 * | 1440 | 874 | 79px | 2 |
 * | 1366 | 800 | 79px | 2 |
 * | 1280 | 714 | 79px | 2 |
 * | 1100 | 534 | **113px** | **3** |
 *
 * 这是**使用时间最长的界面**（写文章），工具栏吃掉 34~68px 正文高度。
 *
 * ## 判据
 *
 * A. 1600 / 1440 / 1366 / 1280 四档**必须单行**（≤48px，原 79px）
 * B. 每一档：**主行收起的项，在「更多」菜单里必须仍然可达**
 *    —— 这是本护栏最核心的一条，也是最容易漏的一条：
 *    实测 1024px 下「引用 / 代码块」从主行消失、菜单里也没有，
 *    用户直接**失去写引用/代码块的入口**。
 * C. 菜单入口不是"渲染出来就算" —— 真的点一下要生效
 *    （点「代码块」正文出现 pre/code；点「图片」出现输入弹窗）
 * D. 无无名按钮（只显示图标时，aria-label/title 必须还在）
 *
 * ## 已知的设计意图（勿改）
 *
 * - 1024px 以下容器只有 458px，18 项**物理上放不下**，允许两行；
 *   本护栏不对该档断言单行（写死"所有宽度都单行"会变成假失败）。
 * - 收起是**容器查询**（`@container editor-toolbar`），不是视口断点。
 * - 标记必须打在**包裹层**：Tooltip 的 `<span class="inline-flex">` 若只隐藏
 *   内层 button，外层仍是 flex 项（宽 0），照样贡献 gap 把后面挤到下一行。
 * - 紧凑模式下连分隔线一起隐藏：9 条线占 45px，正好是 1280 档缺的那 18px 的余量。
 *
 * ## 用法
 *   cd web && NODE_PATH=<node_modules> node scripts/verify_editor_toolbar.cjs
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

/** 进入知识库 → 打开第一篇 → 点「编辑」。 */
async function openEditor(p) {
  await p.goto(WEB + "/", { waitUntil: "domcontentloaded" });
  await sleep(3400);
  await p.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  await p.locator('[data-testid="kb-card"]').first().click();
  for (let i = 0; i < 40; i++) {
    if (await p.evaluate(() => document.querySelectorAll("[data-tree-kind]").length > 0)) break;
    await sleep(250);
  }
  await sleep(700);
  const docs = await p.evaluate(() =>
    [...document.querySelectorAll('[data-tree-kind="doc"]')].map((e) => e.getAttribute("data-tree-key")),
  );
  if (!docs.length) return false;
  await p.locator(`[data-tree-key="${docs[0]}"]`).click();
  await sleep(2300);
  const eb = p.locator("button").filter({ hasText: /^编辑$/ }).first();
  if (await eb.count()) {
    await eb.click();
    await sleep(1600);
  }
  return true;
}

const openMore = async (p) => {
  await p.evaluate(() => {
    const bar = document.querySelector(".editor-toolbar");
    [...bar.querySelectorAll("button")]
      .find((b) => b.querySelectorAll("circle").length === 3)
      ?.click();
  });
  await sleep(600);
};

(async () => {
  console.log("=== 编辑器格式化工具栏护栏 ===");

  const b = await chromium.launch({ headless: true, args: ["--no-proxy-server"] });

  /* ---------- A + B + D：四档宽度 ---------- */
  for (const w of [1600, 1440, 1366, 1280]) {
    const ctx = await b.newContext({ viewport: { width: w, height: 900 }, locale: "zh-CN" });
    const p = await ctx.newPage();
    await p.addInitScript((t) => localStorage.setItem("sunnydoc.token", t), TOKEN);
    const ok = await openEditor(p);
    if (!ok) {
      check(`${w} 前置：能打开文档并进入编辑`, false);
      await ctx.close();
      continue;
    }

    // ⚠️ 工具栏高度会随「容器查询生效 → 项被隐藏 → 重排」变化，
    //    刚进编辑态时可能先量到一个中间值（实测 1280 档一度读到 79px，
    //    稳定后其实是 45px）。这里轮询到高度不再变化再判定。
    // 同时盯「高度」与「可见项数」：只盯高度时，如果某一帧恰好和上一帧
    // 相同就会误判为稳定（实测注入缺陷后出现过）。两项都稳定才算稳定。
    let sig = "";
    for (let i = 0; i < 25; i++) {
      const cur = await p.evaluate(() => {
        const bar = document.querySelector(".editor-toolbar");
        if (!bar) return "-1:0";
        const n = [...bar.children].filter(
          (c) => getComputedStyle(c).display !== "none" && c.getBoundingClientRect().width > 0,
        ).length;
        return `${Math.round(bar.getBoundingClientRect().height)}:${n}`;
      });
      if (cur === sig) break;
      sig = cur;
      await sleep(220);
    }

    const m = await p.evaluate(() => {
      const bar = document.querySelector(".editor-toolbar");
      if (!bar) return null;
      const R = bar.getBoundingClientRect();
      const inMain = (label) => {
        const el = bar.querySelector(`button[title="${label}"], button[aria-label="${label}"]`);
        return !!(el && el.getBoundingClientRect().width > 0);
      };
      const btns = [...bar.querySelectorAll("button")].filter((x) => x.getBoundingClientRect().width > 0);
      return {
        barW: Math.round(R.width),
        barH: Math.round(R.height),
        // 主行是否还显示这些"可被收起"的项
        shown: {
          图片: inMain("图片"),
          插入附件: inMain("插入附件"),
          插入卡片: inMain("插入卡片"),
          插入表格: inMain("插入表格"),
          引用: inMain("引用"),
          代码块: inMain("代码块"),
        },
        unnamed: btns.filter((x) => {
          const n = (x.getAttribute("aria-label") || x.getAttribute("title") || x.innerText || "").trim();
          return !n;
        }).length,
      };
    });

    check(`${w} 工具栏单行（≤48px）`, !!m && m.barH <= 48, m ? `${m.barH}px（原 79px / 1100 时为 113px）` : "未渲染");
    if (m) check(`${w} 无无名按钮`, m.unnamed === 0, `unnamed=${m.unnamed}`);

    // B：收起项必须在菜单里
    await openMore(p);
    const menu = await p.evaluate(() => {
      const pn = [...document.querySelectorAll(".editor-toolbar .menu-panel")].find(
        (e) => e.getBoundingClientRect().width > 0,
      );
      return pn ? [...pn.querySelectorAll(".menu-item")].map((e) => e.innerText.trim()) : [];
    });
    const ALIAS = {
      图片: ["图片"],
      插入附件: ["附件"],
      插入卡片: ["卡片"],
      插入表格: ["卡片", "表格"],
      引用: ["引用"],
      代码块: ["代码块"],
    };
    const lost = Object.entries(m?.shown ?? {})
      .filter(([, visible]) => !visible)
      .map(([k]) => k)
      .filter((k) => !ALIAS[k].some((a) => menu.some((mi) => mi.includes(a))));
    check(
      `${w} 主行收起的项在「更多」里仍可达`,
      lost.length === 0,
      lost.length ? `丢失：${lost.join("/")}` : `菜单 ${menu.length} 项`,
    );

    await ctx.close();
  }

  /* ---------- C：菜单入口真的能用（用最窄档，收得最多） ---------- */
  {
    const ctx = await b.newContext({ viewport: { width: 1024, height: 900 }, locale: "zh-CN" });
    const p = await ctx.newPage();
    await p.addInitScript((t) => localStorage.setItem("sunnydoc.token", t), TOKEN);
    const ok = await openEditor(p);
    if (ok) {
      await p.evaluate(() => document.querySelector(".ProseMirror")?.focus());
      await openMore(p);
      await p.evaluate(() => {
        const pn = [...document.querySelectorAll(".editor-toolbar .menu-panel")].find(
          (e) => e.getBoundingClientRect().width > 0,
        );
        [...pn.querySelectorAll(".menu-item")].find((e) => e.innerText.trim() === "代码块")?.click();
      });
      await sleep(800);
      const codeOk = await p.evaluate(() => !!document.querySelector(".ProseMirror pre, .ProseMirror code"));
      check("「更多 → 代码块」真的插入代码块", codeOk);

      await openMore(p);
      await p.evaluate(() => {
        const pn = [...document.querySelectorAll(".editor-toolbar .menu-panel")].find(
          (e) => e.getBoundingClientRect().width > 0,
        );
        [...pn.querySelectorAll(".menu-item")].find((e) => e.innerText.trim() === "图片")?.click();
      });
      await sleep(800);
      const imgOk = await p.evaluate(() => !!document.querySelector('[data-testid="image-url-input"]'));
      check("「更多 → 图片」真的打开插入弹窗", imgOk);
    } else {
      check("「更多」入口可用（前置）", false, "打不开文档");
    }
    await ctx.close();
  }

  await b.close();
  console.log(`\n${pass} 通过 / ${fail} 失败`);
  console.log(fail === 0 ? "✅ 全部通过" : "❌ 存在失败项");
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("脚本异常：", e.message);
  process.exit(1);
});