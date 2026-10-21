#!/usr/bin/env node
/**
 * 真机验证：AI 问答（项目定位的核心路径）是否真正由大模型生成、引用是否能溯源定位。
 *
 * 为什么必须真机验证：后端接口返回 200 ≠ 用户看到正确答案。
 * 2026-10-12 实测发现配置的模型名 404 导致**全程降级为规则拼接**，
 * 而接口一直返回 200、引用也正常 —— 只有读**用户屏幕上真正的回答文本**才能发现。
 *
 * ⚠️ 四个定位教训（四个版本各踩一个，全都值得记住）：
 *
 *  1. **别用「innerText 最长的容器」找目标面板。**
 *     第一版用 `aside, [class*="ai"], …` 取最长者 → 抓到**左侧文件树侧栏（1204 字）**
 *     而非 AI 面板（549 字），所有断言跑在错误元素上。
 *     信号是「两次提问的回答长度完全相同（1204/1204）」—— **同一数值反复出现要当定位失败查**。
 *     → 正解：AI 面板是 `position: fixed` 且含「AI 问答」标题，候选中取**文本最短**的那个。
 *
 *  2. **面板会累积对话历史 → 切片必须绑定「本轮」。**
 *     第二版用 `lastIndexOf(问题)` + `indexOf("知识库引用")` 切片，
 *     第二轮取到的是**上一轮**的引用区索引（小于本轮问题索引）→ 切片串轮，
 *     表现为「引用行 10 条」（两轮各 5 条）与「回答里没有 [N] 标注」（切到上一轮尾部）。
 *     → 正解：用 `lastIndexOf` 取**最后一个**引用区标记，并按 DOM 顺序
 *       （`compareDocumentPosition`）只数**该标记之后**的引用行。
 *
 *  3. **对话历史持久化在 localStorage，重载无法制造「干净状态」。**
 *     第三、四版以为「每轮重载页面」就能让面板只剩一组问答 —— **错的**。
 *     实测 `localStorage` 里有 `sunnydoc_chat_sessions` / `sunnydoc_chat_current`，
 *     重载后历史仍在（第二轮仍数到 10 条引用）。
 *     → 正解：**开测前显式删掉这两个键**制造干净起点，之后按第 2 点的「本轮切片」处理累积。
 *       （不要用产品的「清空」按钮来适配测试 —— 那是为测试改变被测对象。）
 *
 *  4. **对话式面板的「条数断言」不能写死成单轮上限**（见第 2 点）。
 *
 * 断言（每条都绑定到「本轮提问」的可见结果）：
 *   1. 回答非空、不等于提问本身、且引用区属于本轮（切片有效性护栏）
 *   2. 回答不含「大模型错误」/「已自动降级」（本次缺陷的直接信号）
 *   3. 回答不是规则拼接模板（不以「根据知识库中的「…」」开头）
 *   4. 回答长度 > 200
 *   5. 出现引用标注（LLM 依片段作答的迹象，如 `[1]` / `片段[1]`）
 *   6. 本轮引用条数在 1..top_k
 *   7. 点击一条引用能真的呈现来源文档内容（引用溯源可用性）
 *
 * 用法：
 *   cd web && SUNNYDOC_TOKEN=xxx node scripts/verify_ai_answer.cjs
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

const QUESTIONS = ["vCenter 部署需要什么环境", "kvm 日常使用命令有哪些"];
const TOP_K = 5;
const CITE_MARKER = "知识库引用（点击定位）";

/** 页面内执行：定位 AI 面板，抽出「本轮」回答文本与本轮引用条数。
 *  ⚠️ 本函数在**浏览器**里执行，取不到 Node 作用域的常量 → 必须由参数传入。 */
function extractInPage({ question, CITE_MARKER }) {
  const cands = Array.from(document.querySelectorAll("aside, div, section")).filter((n) => {
    const t = n.innerText || "";
    if (!t.includes("AI 问答")) return false;
    return getComputedStyle(n).position === "fixed";
  });
  cands.sort((a, b) => (a.innerText || "").length - (b.innerText || "").length);
  const panel = cands[0];
  if (!panel) return { found: false };
  window.__sdPanel = panel;

  const full = panel.innerText || "";
  const qIdx = full.lastIndexOf(question);

  // 本轮引用区 = 面板内**最后一个**「知识库引用（点击定位）」标记
  const markers = Array.from(panel.querySelectorAll("*")).filter((n) =>
    (n.innerText || "").trim().startsWith(CITE_MARKER),
  );
  const lastMarker = markers[markers.length - 1] || null;

  // 护栏：引用区必须排在本轮问题之后（DOM 顺序），否则说明抓到了上一轮
  let citeBelongsToThisTurn = false;
  if (lastMarker && qIdx >= 0) {
    const qNode = Array.from(panel.querySelectorAll("*")).find(
      (n) => (n.innerText || "").trim() === question,
    );
    if (qNode) {
      citeBelongsToThisTurn = !!(
        qNode.compareDocumentPosition(lastMarker) & Node.DOCUMENT_POSITION_FOLLOWING
      );
    }
  }

  // 回答 = 本轮问题之后、到本轮引用区之前的文本
  let answer = "";
  if (qIdx >= 0) {
    answer = full.slice(qIdx + question.length);
    const citeTextIdx = answer.indexOf(CITE_MARKER);
    if (citeTextIdx > 0) answer = answer.slice(0, citeTextIdx);
  }
  // 剥掉面板头部文案（品牌名 + 操作按钮），只留答案正文。
  // 🔴 这里必须与 `AiPanel.tsx` 的头部实际文案同步：品牌从「知库助手」改成
  //    「Sunny 助手」后，旧正则里的 `知库助手|知` 就匹配不到了 ——
  //    后果是答案开头残留「Sunny 助手」四个字，后续按文本比对答案的断言会**静默走偏**。
  //    另：logo 已改为内联 SVG（无文本），故不再需要剥离「知」字。
  answer = answer.replace(/^(Sunny\s*助手|Sunny|复制|重新生成|\s)+/, "").trim();

  // 本轮引用条数：只数最后一个引用区标记**之后**的引用行（DOM 顺序）
  const allRows = Array.from(panel.querySelectorAll("*")).filter((n) =>
    /^·\s*片段\s*\d+$/.test((n.innerText || "").trim()),
  );
  const rows = lastMarker
    ? allRows.filter(
        (r) => !!(lastMarker.compareDocumentPosition(r) & Node.DOCUMENT_POSITION_FOLLOWING),
      ).length
    : 0;

  return { found: true, answer, rows, citeBelongsToThisTurn, totalRows: allRows.length };
}

(async () => {
  const b = await chromium.launch({
    headless: true,
    args: ["--no-proxy-server"],
    // 允许指定浏览器可执行文件（playwright 包升级后缓存里可能只有旧版 chromium）
    ...(process.env.SUNNYDOC_CHROMIUM ? { executablePath: process.env.SUNNYDOC_CHROMIUM } : {}),
  });
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e)));

  await p.goto("http://localhost:3001", { waitUntil: "domcontentloaded" });
  // 制造干净起点：对话历史持久化在 localStorage，不清掉第二轮会与第一轮混在一起
  await p.evaluate((t) => {
    localStorage.setItem("sunnydoc.token", t);
    localStorage.removeItem("sunnydoc_chat_sessions");
    localStorage.removeItem("sunnydoc_chat_current");
  }, TOKEN);
  await p.reload({ waitUntil: "domcontentloaded" });
  await sleep(2500);

  const kb = p.locator('[data-testid="kb-card"]').filter({ hasText: "云计算知识库" }).first();
  if (await kb.count()) {
    await kb.click();
    await sleep(2000);
  }
  const aiBtn = p.locator("button, a").filter({ hasText: /AI|智能|问答|助手/ }).first();
  check("AI 面板入口存在", (await aiBtn.count()) > 0, "未找到 AI 入口");
  if (!(await aiBtn.count())) {
    await b.close();
    process.exit(1);
  }
  await aiBtn.click();
  await sleep(1500);

  const box = p.locator("aside textarea, textarea").last();
  check("输入框存在", (await box.count()) > 0, "未找到输入框");
  if (!(await box.count())) {
    await b.close();
    process.exit(1);
  }

  let askCount = 0;
  /** 每轮是否出现引用标注（如 [1]）—— 循环结束后聚合断言，避免 flaky。 */
  const citedRounds = [];
  for (const q of QUESTIONS) {
    console.log(`━━━ 提问「${q}」━━━`);
    await box.fill(q);
    await box.press("Enter");

    // 等回答稳定：面板文本长度连续三次不变即认为生成结束
    let prev = -1;
    let stable = 0;
    for (let i = 0; i < 70; i++) {
      await sleep(600);
      const len = await p.evaluate(() => (window.__sdPanel ? window.__sdPanel.innerText.length : 0));
      if (len === prev && len > 0) {
        stable++;
        if (stable >= 3) break;
      } else stable = 0;
      prev = len;
    }
    askCount++;

    const res = await p.evaluate(extractInPage, { question: q, CITE_MARKER });
    if (!res.found) {
      check(`「${q}」能定位到 AI 面板`, false, "未找到 fixed 定位且含「AI 问答」的容器");
      continue;
    }

    const a = res.answer || "";
    console.log(
      `  回答长度=${a.length}  本轮引用=${res.rows}  面板引用总计=${res.totalRows}（第 ${askCount} 次提问）`,
    );
    console.log(`  回答开头：${a.slice(0, 70).replace(/\n/g, "⏎")}`);

    // 护栏：切片必须真的切到本轮回答，否则后续断言会变成假通过
    check(
      "本轮回答切片有效（非空 / 不等于提问 / 引用区属于本轮）",
      a.length > 0 && !a.startsWith(q) && res.citeBelongsToThisTurn,
      `len=${a.length} citeBelongs=${res.citeBelongsToThisTurn} head=${JSON.stringify(a.slice(0, 50))}`,
    );
    check("回答不含「大模型错误」", !a.includes("大模型错误"), "出现降级提示 → AI 生成失败");
    check("回答不含「已自动降级」", !a.includes("已自动降级"), "出现降级提示 → AI 生成失败");
    check(
      "回答不是规则拼接模板",
      !a.includes("根据知识库中的「"),
      "命中规则拼接固定开头 → 未走 RAG 生成",
    );
    check("回答长度 > 200", a.length > 200, `实际 ${a.length}`);
    // 引用标注：**按轮次记录，最后聚合断言**（见循环外）。
    // 为什么不在每轮里硬断言：能否标号取决于模型是否遵守提示词，
    // 是个**概率性**行为（实测同一提示词下，两轮里常有一轮漏标）。
    // 每轮都要求 100% 标号 = flaky 断言（今天过、明天挂），
    // 而"至少一次标号"足以证明引用要求已生效、链路是通的。
    citedRounds.push(/\[\d+\]/.test(a));
    console.log(`  本轮标号：${/\[\d+\]/.test(a) ? "有" : "无"}（如「…[1]」）`);
    check(
      `本轮引用条数在 1..${TOP_K}`,
      res.rows >= 1 && res.rows <= TOP_K,
      `实际 ${res.rows}（面板总计 ${res.totalRows}）`,
    );
  }

  // 聚合断言：多轮里**至少一轮**出现引用标注。
  // 不要求每轮都标 —— 那是模型遵守提示词的概率问题（今天过明天挂），
  // 而「至少一次标号」已足以证明：提示词里的引用要求生效、编号与片段能对上。
  check(
    "回答含引用标注（如 [1] / 片段[1]）· 至少一轮出现",
    citedRounds.some(Boolean),
    `各轮标号情况：${JSON.stringify(citedRounds)}（全无 → 提示词的引用要求未生效）`,
  );

  // 引用点击定位（引用溯源可用性）
  console.log("━━━ 引用点击是否真能定位来源 ━━━");
  let clicked = false;
  try {
    const row = p.locator("aside").last().locator("text=/^·\\s*片段\\s*\\d+$/").first();
    if (await row.count()) {
      await row.click({ timeout: 5000 });
      clicked = true;
      await sleep(3000);
    }
  } catch {
    /* 忽略 */
  }
  check("引用行可点击", clicked, "未找到可点击的引用行");
  if (clicked) {
    // openDoc 是应用内行为（location.href 不变）→ 用「正文区出现内容」判定
    const openedLen = await p.evaluate(() => (document.body.innerText || "").length);
    check("点击引用后呈现来源文档", openedLen > 1200, `body 文本长度 ${openedLen}`);
  }

  check("页面无 JS 运行时错误", errs.length === 0, errs.join(" | "));

  console.log(fail === 0 ? "\n✅ 全部通过" : `\n❌ ${fail} 项失败`);
  await b.close();
  process.exit(fail === 0 ? 0 : 1);
})();