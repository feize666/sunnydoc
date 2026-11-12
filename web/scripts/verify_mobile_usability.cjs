#!/usr/bin/env node
/**
 * 移动端**真实可用性**护栏（触屏交互，不是布局指标）。
 *
 * ## 与 `verify_mobile_adaptive.cjs` 的分工
 *
 * 那个脚本量的是**布局指标**：无横向溢出、触控目标 ≥44px。
 * 它答不了「手机用户能不能真的完成任务」—— 布局全对、功能全废也是可能的。
 * 本脚本补的是**任务流**：进库 → 开抽屉 → 选文档 → 读 → 编辑，每步都要能走通。
 *
 * ## 🔴 写这个脚本时踩的两个坑（都已修正，记下来免得重犯）
 *
 * 1. **`querySelectorAll('[data-tree-kind]')` 会抓到桌面隐藏侧栏里的那一份**
 *    （`display:none`、宽高 0）。移动端 DOM 里有**两份**侧栏：
 *    隐藏的桌面版 + 抽屉版。直接用 `[0]` 会拿到 0×0 的元素，
 *    表现为「element is not visible」或「点了没反应」—— 一度误判成
 *    「移动端侧栏打不开」的重大缺陷，实际功能完全正常。
 *    ⇒ 一律加 `:visible` 或按 `getBoundingClientRect().width > 0` 过滤。
 *
 * 2. **`element.click()`（合成事件）对「按视口宽度分流」的 handler 可能不进预期分支**；
 *    且卡片可能在首屏外，手算坐标去 `touchscreen.tap` 会点到空白。
 *    ⇒ 用 `locator.tap()`（会先 scrollIntoView），必要时才退 `click({force})`。
 */
const { chromium, devices } = require("playwright");
const fs = require("fs");

const TOKEN =
  process.env.SUNNYDOC_TOKEN ||
  fs.readFileSync(process.env.SUNNYDOC_TOKEN_FILE || "/tmp/sunnydoc-token.txt", "utf8").trim();
const WEB = process.env.SUNNYDOC_WEB || "http://localhost:3001";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
const check = (n, ok, d) => {
  if (ok) {
    pass++;
    console.log("  ✅ " + n);
  } else {
    fail++;
    console.log("  ❌ " + n + "\n       " + String(d).slice(0, 220));
  }
};

/** 点元素：优先 tap（会 scrollIntoView），失败再退 force click。 */
async function tapEl(loc) {
  try {
    await loc.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
    await loc.tap({ timeout: 8000 });
    return true;
  } catch {
    try {
      await loc.click({ force: true, timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }
}

/** 抽屉状态：遮罩是否出现 + 可见 aside 的宽度。 */
const drawerState = (p) =>
  p.evaluate(() => {
    const overlay = Array.from(document.querySelectorAll("div")).some(
      (d) => getComputedStyle(d).position === "fixed" && String(d.className).includes("bg-black/30"),
    );
    const vis = Array.from(document.querySelectorAll("aside")).filter(
      (a) => a.getBoundingClientRect().width > 100 && getComputedStyle(a).display !== "none",
    );
    return { overlay, asideW: vis.length ? Math.round(vis[0].getBoundingClientRect().width) : 0 };
  });

/** 可见树行的统计（务必过滤 0 宽的桌面隐藏版）。 */
const visibleTree = (p) =>
  p.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("[data-tree-kind]")).filter((r) => {
      const b = r.getBoundingClientRect();
      return b.width > 0 && b.height > 0;
    });
    return {
      visible: rows.length,
      docs: rows.filter((r) => r.getAttribute("data-tree-kind") === "doc").length,
    };
  });

(async () => {
  const b = await chromium.launch({ headless: true, args: ["--no-proxy-server"] });
  const ctx = await b.newContext({ ...devices["iPhone 13"], locale: "zh-CN" });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e).slice(0, 120)));

  await p.goto(WEB + "/", { waitUntil: "domcontentloaded" });
  await p.evaluate((t) => localStorage.setItem("sunnydoc.token", t), TOKEN);
  await p.reload({ waitUntil: "domcontentloaded" });
  await sleep(3500);
  // Next dev 的浮层会吃掉所有指针事件
  await p.addStyleTag({ content: "nextjs-portal{display:none!important;pointer-events:none!important}" });

  const vp = await p.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  console.log(`=== 移动端真实可用性（${vp.w}×${vp.h}，触屏）===\n`);

  // ---------- 1) 首页 → 进库 ----------
  console.log("【1】首页 → 进知识库");
  const card = p.locator('[data-testid="kb-card"]').first();
  check("首页有知识库卡片", (await card.count()) > 0, "未找到 kb-card");
  check("点卡片成功", await tapEl(card), "tap 与 click 均失败");

  // ⚠️ 判据要用「抽屉关闭 + 树已加载」而不是「可见树行 > 0」：
//    移动端进库后抽屉本就该是**收起**的，此时所有树行都是 0 宽（DOM 里有但不可见）。
//    写成"可见树行 > 0"会与正确行为相反 —— 实测踩过一次（假失败）。
  let inKb = false;
  for (let i = 0; i < 50; i++) {
    inKb = await p.evaluate(() => document.querySelectorAll("[data-tree-kind]").length > 0);
    if (inKb) break;
    await sleep(300);
  }
  const stAfterEnter = await drawerState(p);
  check("进入知识库（树已加载，抽屉默认收起）", inKb && !stAfterEnter.overlay, JSON.stringify(stAfterEnter));
  await sleep(600);

  // ---------- 2) 抽屉 ----------
  console.log("\n【2】侧栏抽屉（移动端浏览文档的唯一入口）");
  let st = await drawerState(p);
  check("初始为关闭态", !st.overlay, JSON.stringify(st));

  const toggle = p.locator('button[aria-label*="侧栏"], button[title*="侧栏"]').first();
  check("存在侧栏切换按钮", (await toggle.count()) > 0, "未找到按钮");
  await tapEl(toggle);
  await sleep(1000);
  st = await drawerState(p);
  check(`点开后抽屉可见（有遮罩 + 侧栏宽 ${st.asideW}）`, st.overlay && st.asideW > 100, JSON.stringify(st));

  const tree = await visibleTree(p);
  check(`抽屉内可见树行 ${tree.visible}（文档 ${tree.docs}）`, tree.visible > 0 && tree.docs > 0, JSON.stringify(tree));

  // ---------- 3) 选文档 ----------
  console.log("\n【3】抽屉内选文档 → 正文渲染");
  const docLoc = p.locator('[data-tree-kind="doc"]:visible').first();
  const pickedTitle = (await docLoc.innerText().catch(() => "")).trim().split("\n")[0].slice(0, 24);
  check("找到可见文档行", (await docLoc.count()) > 0, "无可见 doc 行");

  if ((await docLoc.count()) > 0) {
    await tapEl(docLoc);
    let rendered = false;
    for (let i = 0; i < 60; i++) {
      rendered = await p.evaluate(() => (document.querySelector(".md-body")?.innerText || "").length > 200);
      if (rendered) break;
      await sleep(250);
    }
    check(`点「${pickedTitle}」后正文渲染`, rendered, "正文未渲染");
    // 选完应自动收起，否则会挡住正文
    let closed = false;
    for (let i = 0; i < 20; i++) {
      closed = !(await drawerState(p)).overlay;
      if (closed) break;
      await sleep(250);
    }
    check("选完文档抽屉自动收起（不挡正文）", closed, JSON.stringify(await drawerState(p)));
  }

  // ---------- 4) 阅读 ----------
  console.log("\n【4】正文阅读体验");
  const reading = await p.evaluate(() => {
    const el = document.querySelector(".md-body");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const fs = parseFloat(getComputedStyle(el).fontSize);
    return { width: Math.round(r.width), fontSize: fs, charsPerLine: Math.round(r.width / fs) };
  });
  check(
    `正文宽度占满且字号 ≥15px（宽 ${reading?.width}，字号 ${reading?.fontSize}px）`,
    reading && reading.width > 280 && reading.fontSize >= 15,
    JSON.stringify(reading),
  );

  // ---------- 5) 编辑 ----------
  console.log("\n【5】编辑能力");
  const editBtn = p.locator("button").filter({ hasText: /^编辑$/ }).first();
  check("「编辑」按钮可见", (await editBtn.count()) > 0, "未找到");
  if ((await editBtn.count()) > 0) {
    await tapEl(editBtn);
    let editable = false;
    for (let i = 0; i < 50; i++) {
      editable = await p.evaluate(() => !!document.querySelector('.ProseMirror[contenteditable="true"]'));
      if (editable) break;
      await sleep(250);
    }
    check("进入编辑态（可写）", editable, "未出现 contenteditable");
  }

  check("无 JS 运行时错误", errs.length === 0, errs.join(" | "));

  console.log(`\n通过 ${pass} / 失败 ${fail}`);
  console.log(fail === 0 ? "✅ 全部通过" : "❌ 存在失败项");
  await b.close();
  process.exit(fail ? 1 : 0);
})();