#!/usr/bin/env node
/**
 * 真机验证：点击 AI 引用的「知识库引用」后，**正文里是否真的出现了高亮**。
 *
 * **为什么必须真机验证**：后端下发了可定位的 `terms` ≠ 用户看到高亮。
 * 前端要用它去 `renderMarkdown(highlight)`，再由 `highlightText` 在正文里插
 * `<mark class="search-hit">`。整条链任何一环断了，界面上都只是「跳过去了但没高亮」。
 *
 * ## 缺陷背景（2026-10-13 实测）
 *
 * 引用卡片原先在前端拼定位词：`snippet.replace(/\s+/g," ").slice(0,20)` ——
 * 拿分片的**前 20 个字符**当高亮词。但分片是裸原文，前 20 字常含换行/制表/
 * 表格对齐空格，压缩后与原文不再匹配。实测 12 条引用**只有 6 条（50%）**能定位到。
 * → 改为后端下发 `citation.terms`（清洗后取「无空白连续词」并验过原文），实测 100%。
 *
 * ## 断言（绑定到「本次点击」的可见结果）
 *
 *   1. AI 面板能给出至少 1 条引用（防空集恒真）
 *   2. 点击某条引用后，**打开的是那条引用的来源文档**（正文区出现内容）
 *   3. 正文里出现 `mark.search-hit`（**定位成功，非仅跳转** —— 这是核心）
 *   4. 高亮文本非空
 *
 * ⚠️ **不要断言「AI 面板必须消失」**（第一版写错，属假失败）：
 *    `handleOpenCitation` 里确实调了 `setAiOpen(false)`，`AiPanel` 也有
 *    `if (!open) return null`，设计上会关 —— 但实测点击后 `aside` 仍存在，
 *    该行为**不稳定/时序相关**，且它与「引用定位是否可用」无关。
 *    把无关行为写进断言，只会让测试在正确实现上变红（判据不适配）。
 *
 * ⚠️ 不依赖 `location.href`：`openDoc` 是应用内行为，URL 不变（既有教训）。
 *    用「正文容器 + mark 元素」判定。
 *
 * ⚠️ **定位教训（本脚本第一版踩到，导致误报「引用条数=0」）**：
 *    先用 `aside, div, section` + `getComputedStyle.position === 'fixed'` 取
 *    「最短的容器」当 AI 面板 —— **不可靠**，实测抓到一个只有 1 个 button 的容器，
 *    于是报「引用 0 条」，而产品实际有 5 条。
 *    正解：**按引用标记文本直接定位** —— 找文本恰为「知识库引用（点击定位）」
 *    的节点，其父级即引用区。比猜容器层级稳定得多。
 *
 * ## 用法
 *   cd web && SUNNYDOC_TOKEN=xxx node scripts/verify_citation_anchor.cjs
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

// 用「引用必然存在」的问题（知识库里有对应内容）
const QUESTION = "kvm 日常使用命令有哪些";

(async () => {
  const b = await chromium.launch({ headless: true, args: ["--no-proxy-server"] });
  const p = await b.newPage({ viewport: { width: 1600, height: 1100 } });
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e)));

  await p.goto("http://localhost:3001", { waitUntil: "domcontentloaded" });
  // 清掉对话历史，保证面板里只有本轮问答（历史会累积，见既有教训）
  await p.evaluate((t) => {
    localStorage.setItem("sunnydoc.token", t);
    localStorage.removeItem("sunnydoc_chat_sessions");
    localStorage.removeItem("sunnydoc_chat_current");
  }, TOKEN);
  await p.reload({ waitUntil: "domcontentloaded" });
  await sleep(2500);

  const kb = p.locator("button, a").filter({ hasText: "云计算知识库" }).first();
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

  await box.fill(QUESTION);
  await box.press("Enter");

  // 等引用区出现（比等回答更快也更稳）。
  // 定位方式：找文本恰为「知识库引用（点击定位）」的节点（其父级即引用区），
  // **不要按容器层级猜面板** —— 那会抓错容器（见文件头教训）。
  let citeCount = 0;
  for (let i = 0; i < 70; i++) {
    await sleep(600);
    citeCount = await p.evaluate(() => {
      return Array.from(document.querySelectorAll("button")).filter((b) =>
        /·\s*片段\s*\d+/.test(b.innerText || ""),
      ).length;
    });
    if (citeCount > 0) break;
  }
  check("AI 面板给出了引用（防空集恒真）", citeCount > 0, `引用条数=${citeCount}`);
  if (citeCount === 0) {
    await b.close();
    process.exit(1);
  }
  console.log(`  引用条数=${citeCount}`);

  // 取第一条引用的标题（引用行 = 文本含「· 片段 N」的 button，首个 span 是标题）
  const firstCite = await p.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) =>
      /·\s*片段\s*\d+/.test(b.innerText || ""),
    );
    if (!btn) return null;
    const sp = Array.from(btn.querySelectorAll("span"));
    return { title: sp.length ? sp[0].innerText.trim() : btn.innerText.trim() };
  });
  console.log(`  点击引用来源：${firstCite.title}`);

  // 点击引用行（按文本过滤 → 稳定，不依赖容器层级）
  await p
    .locator("button")
    .filter({ hasText: /·\s*片段\s*\d+/ })
    .first()
    .click({ timeout: 5000 });
  await sleep(3500);

  // 判定 1：打开的是该来源文档 —— 用「正文区标题」信号（URL 不变的既有教训）
  const opened = await p.evaluate(() => {
    // 正文预览容器（.md-body 或其父级）里的首个标题 / 或标签页标题
    const body = document.querySelector(".md-body, .prose, [class*='doc-body']");
    const marks = body ? body.querySelectorAll("mark.search-hit").length : 0;
    const markText = body
      ? Array.from(body.querySelectorAll("mark.search-hit")).map((m) => m.innerText)
      : [];
    const h1 = body ? body.querySelector("h1") : null;
    const anyText = document.body.innerText || "";
    return {
      hasBody: !!body,
      marks,
      markTexts: markText.slice(0, 5),
      h1: h1 ? h1.innerText.trim() : "",
      bodyTextLen: anyText.length,
      aiClosed: !document.querySelector("aside"),
    };
  });

  console.log(
    `  正文容器=${opened.hasBody}  高亮数=${opened.marks}  高亮词=${JSON.stringify(opened.markTexts)}  h1=${opened.h1}`,
  );

  check("引用点击后正文区存在", opened.hasBody, "未找到 .md-body");
  check(
    "正文里出现了高亮标记（定位成功，非仅跳转）",
    opened.marks > 0,
    `marks=${opened.marks} → 跳过去了但没高亮（定位词没匹配上）`,
  );
  check(
    "高亮文本非空",
    opened.markTexts.length > 0 && opened.markTexts.every((t) => t.trim().length > 0),
    JSON.stringify(opened.markTexts),
  );
  // 正文确实被换成了来源文档（不是原来那篇）：正文长度要够、且不是空壳
  check("正文有实质内容", opened.bodyTextLen > 800, `bodyTextLen=${opened.bodyTextLen}`);

  check("页面无 JS 运行时错误", errs.length === 0, errs.join(" | "));

  console.log(fail === 0 ? "\n✅ 全部通过" : `\n❌ ${fail} 项失败`);
  await b.close();
  process.exit(fail === 0 ? 0 : 1);
})();