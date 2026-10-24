#!/usr/bin/env node
/**
 * 长文档「按需高亮」护栏 —— 防止退回「全量高亮」。
 *
 * ## 为什么需要这个脚本
 *
 * 本库有 21 篇文档超过 5 万字符，最长 **202,719 字符**（openEuler安全配置基线，
 * 638 个代码块 / 757 个标题 / 9084 行）。实测原来的实现在**首屏可见代码块为 0**
 * 的情况下，仍把 **638 个块全部高亮**，纯属白做。
 *
 * 2026-10-24 改为「按需 + 有限预取」后：
 *
 *      高亮块数：638 → **46**
 *      保持纯文本：0 → **592**
 *
 * ## 🔴 判据设计：只判「我们控住的不变量」，不判受环境影响的绝对耗时
 *
 * 本轮实测（CPU profile 铁证）发现：打开长文档时的 ~850ms 长任务里，
 * **约 570ms 来自 React 开发模式**：
 *
 *      341.9ms  addObjectDiffToProperties  @react-dom-client.DEVELOPMENT.js
 *      154.2ms  exports.jsxDEV             @react-jsx-dev-runtime.DEVELOPMENT.js
 *       34.1ms  jsxDEVImpl                 @react-jsx-dev-runtime.DEVELOPMENT.js
 *       23.6ms  ReactElement               @react-jsx-dev-runtime.DEVELOPMENT.js
 *       11.6ms  updateProperties           @react-dom-client.DEVELOPMENT.js
 *
 * 这些代码**在生产构建中完全不存在**。若把「长任务总时长」写成硬断言，
 * 那它在 dev 下永远失败、在生产下永远通过 —— **一个随环境漂移的判据毫无价值**。
 *
 * ⇒ 因此本脚本断言的是**业务不变量**：
 *    ① 首屏可见范围内**必须已高亮**（用户看得到的地方不能是纯文本）；
 *    ② 远视口**必须保持按需**（不能一次全量高亮）—— 这条直接钉住「不白做」；
 *    ③ 滚动到新位置后**能唤醒高亮**（按需 ≠ 永不处理）；
 *    ④ 纯文本块仍可读（语言标签/内容都在，只是没有颜色）。
 *
 * 绝对耗时只作为**信息性输出**，不参与通过判定。
 *
 * 用法：
 *   NODE_PATH=<托管 node_modules> node web/scripts/verify_longdoc_perf.cjs
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const TOKEN = (
  process.env.SUNNYDOC_TOKEN ||
  fs.readFileSync(process.env.SUNNYDOC_TOKEN_FILE || "/tmp/sunnydoc-token.txt", "utf8")
).trim();
const WEB = process.env.SUNNYDOC_WEB || "http://localhost:3001";
const KB = process.env.SUNNYDOC_KB || "fdef57f179384d679b62a3c4bae2d2e3";
/** 最长文档（202,719 字符 / 638 代码块）。可用环境变量覆盖。 */
const DOC = process.env.SUNNYDOC_LONGDOC || "e1cf4cb9ed0d463b9edca6d97e194ee3";
/** 该文档在树中的路径（点击打开需要逐层展开）。 */
const FOLDER_PATH = (process.env.SUNNYDOC_LONGDOC_PATH || "05-DevOps,05-安全与迁移").split(",");
/** 树中必须有这么多行才认为「加载完成」。 */
const MIN_TREE_ROWS = 30;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (n, ok, d = "") => {
  console.log(`  ${ok ? "✅" : "❌"} ${n}${ok || !d ? "" : "  " + String(d).slice(0, 200)}`);
  ok ? pass++ : fail++;
};

const SNAPSHOT = `(() => {
  const el = document.querySelector(".md-body");
  if (!el) return null;
  const pres = Array.from(el.querySelectorAll("pre"));
  const colored = pres.filter((p) => p.querySelector("span[style]"));
  const pending = pres.filter((p) => p.getAttribute("data-code-lang"));
  const vh = window.innerHeight;
  const inView = pres.filter((p) => { const r = p.getBoundingClientRect(); return r.top < vh && r.bottom > 0; });
  return {
    total: pres.length,
    colored: colored.length,
    pending: pending.length,
    inView: inView.length,
    inViewColored: inView.filter((p) => p.querySelector("span[style]")).length,
    // 纯文本块是否仍可读（有 lang 标记或内容）
    plainReadable: pending.slice(0, 5).every((p) => (p.textContent || "").trim().length > 0),
    scrollTop: Math.round((document.scrollingElement || document.documentElement).scrollTop),
    contentH: el.scrollHeight,
    nodes: el.querySelectorAll("*").length,
  };
})()`;

(async () => {
  const b = await chromium.launch({ headless: true, args: ["--no-proxy-server"] });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(String(e).slice(0, 140)));

  await p.goto(WEB + "/", { waitUntil: "domcontentloaded" });
  await p.evaluate((t) => localStorage.setItem("sunnydoc.token", t), TOKEN);
  await p.goto(WEB + `/#/kb/${KB}`, { waitUntil: "domcontentloaded" });

  // 等树加载完
  let rows = 0;
  for (let i = 0; i < 40; i++) {
    rows = await p.evaluate(() => document.querySelectorAll("[data-tree-kind]").length);
    if (rows >= MIN_TREE_ROWS) break;
    await sleep(300);
  }
  check(`文档树已加载（≥${MIN_TREE_ROWS} 行）`, rows >= MIN_TREE_ROWS, `实际 ${rows} 行`);
  if (rows < MIN_TREE_ROWS) { await b.close(); process.exit(1); }

  // 用「树内过滤」快速定位目标文档（这也是本轮新增的能力）
  const filterBox = await p.$('[data-testid="tree-filter"]');
  let opened = false;
  if (filterBox) {
    // 先按关键词筛出目标，避免逐层展开
    await p.fill('[data-testid="tree-filter"]', "openEuler");
    await sleep(800);
    opened = await p.evaluate((id) => {
      const el = document.querySelector(`[data-tree-key="${id}"]`);
      if (!el) return false;
      el.scrollIntoView({ block: "center" });
      el.click();
      return true;
    }, DOC);
    check("用树内筛选定位并打开了长文档", opened);
    // 清空筛选（不影响已打开的文档）
    await p.fill('[data-testid="tree-filter"]', "");
  }
  if (!opened) {
    // 降级：逐层展开文件夹
    for (const name of FOLDER_PATH) {
      await p.evaluate((n) => {
        const row = Array.from(document.querySelectorAll('[data-tree-kind="folder"]'))
          .find((r) => (r.innerText || "").includes(n));
        if (row) { const btns = row.querySelectorAll("button"); (btns[1] || btns[0])?.click(); }
      }, name);
      await sleep(900);
    }
    opened = await p.evaluate((id) => {
      const el = document.querySelector(`[data-tree-key="${id}"]`);
      if (!el) return false;
      el.scrollIntoView({ block: "center" });
      el.click();
      return true;
    }, DOC);
    check("经文件夹展开打开长文档", opened);
  }
  if (!opened) { console.log("  ❌ 无法打开目标文档，终止"); await b.close(); process.exit(1); }

  // 等正文渲染（滚动期间持续观察）
  let snap = null;
  for (let i = 0; i < 50; i++) {
    snap = await p.evaluate(SNAPSHOT);
    if (snap && snap.total >= 20) break;
    await sleep(400);
  }
  await sleep(3500); // 让按需高亮的预取额度跑完
  snap = await p.evaluate(SNAPSHOT);

  console.log("\n=== ① 文档确实渲染出来了 ===");
  check("正文容器存在且含代码块", !!(snap && snap.total > 50), snap ? `${snap.total} 个 <pre>` : "无 .md-body");
  if (!snap || snap.total <= 50) { await b.close(); process.exit(1); }
  check(`渲染了足够多的块（${snap.total} ≥ 100，证明是长文档而非误开小文件）`, snap.total >= 100);

  console.log("\n=== ② 首屏可读：视力范围内的块必须已高亮 ===");
  check(
    `首屏可见代码块已高亮（${snap.inViewColored}/${snap.inView}）`,
    snap.inView === 0 || snap.inViewColored === snap.inView,
    `可见 ${snap.inView}，其中已高亮 ${snap.inViewColored}`,
  );

  console.log("\n=== ③ 按需高亮：远视口必须保持纯文本（不能全量）===");
  // 这是本轮的核心不变量。允许预取（HYDRATE_PREFETCH=40）+ 首屏若干，
  // 故上限给 40% 的宽裕度；但绝不能是「全部」。
  const coloredRatio = snap.colored / snap.total;
  check(
    `已高亮块数受控（${snap.colored}/${snap.total} = ${(coloredRatio * 100).toFixed(0)}%，须 < 40%）`,
    coloredRatio < 0.4,
    `若接近 100% 说明退回了「全量高亮」`,
  );
  check(
    `存在保持纯文本的块（${snap.pending} 个 > 0）`,
    snap.pending > 0,
    "全部高亮 = 白做（首屏看不到的块也付出了 CPU）",
  );

  console.log("\n=== ④ 纯文本块仍可读（高亮只是上色，不丢内容）===");
  check("未高亮的块仍有文本内容", snap.plainReadable !== false);

  console.log("\n=== ⑤ 按需 ≠ 永不处理：滚动应能唤醒高亮 ===");
  const beforeScroll = snap.colored;
  /**
   * 🔴 必须滚动**真正的滚动容器**，不能滚 `document.scrollingElement`。
   *
   * 实测本项目的结构：
   *     DIV.anim-fade-in.flex-1.overflow-y-auto   ← 真正的滚动容器
   *       └─ … → .md-body
   * `.md-body` 本身不滚动；滚 `document.scrollingElement` 只会得到 0 位移，
   * 于是「滚动后高亮没变」会被误读成「唤醒功能坏了」。
   * 这里从 `.md-body` 向上找第一个**可滚动**的祖先，与实现端的做法一致。
   */
  const scrolled = await p.evaluate(async () => {
    const md = document.querySelector(".md-body");
    let sc = md;
    while (sc && sc !== document.documentElement) {
      const cs = getComputedStyle(sc);
      if ((cs.overflowY === "auto" || cs.overflowY === "scroll")
          && sc.scrollHeight > sc.clientHeight + 2) break;
      sc = sc.parentElement;
    }
    if (!sc || sc === document.documentElement) sc = document.scrollingElement;
    const before = Math.round(sc.scrollTop || 0);
    sc.scrollTop = 8000;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { tag: sc.tagName + "." + String(sc.className || "").slice(0, 28), before, after: Math.round(sc.scrollTop || 0) };
  });
  check("找到了可滚动的容器且滚动生效", scrolled.after > scrolled.before,
    `容器=${scrolled.tag} scrollTop ${scrolled.before} → ${scrolled.after}`);

  await sleep(3500);
  const after = await p.evaluate(SNAPSHOT);
  const newlyColored = after.colored - beforeScroll;
  check(
    `滚动后新位置的高亮被唤醒（新增 ${newlyColored} 块）`,
    newlyColored > 0,
    `滚动前 ${beforeScroll} → 滚动后 ${after.colored}`,
  );
  check(
    `滚动后视力范围内的块已高亮（${after.inViewColored}/${after.inView}）`,
    after.inView === 0 || after.inViewColored / after.inView >= 0.5,
    `可见 ${after.inView}，已高亮 ${after.inViewColored}`,
  );

  console.log("\n=== 信息性指标（不参与判定：其耗时受 React 开发模式影响）===");
  console.log(`  内容高度 ${snap.contentH}px · DOM 节点 ${snap.nodes}`);
  console.log(`  高亮 ${snap.colored} / 纯文本 ${snap.pending} / 总计 ${snap.total}`);

  check("无未捕获页面异常", errors.length === 0, errors.slice(0, 2).join(" | "));

  console.log(`\n通过 ${pass} / 失败 ${fail}`);
  console.log(fail === 0 ? "✅ 全部通过" : "❌ 存在失败项");
  await b.close();
  process.exit(fail ? 1 : 0);
})();