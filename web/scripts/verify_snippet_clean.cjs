#!/usr/bin/env node
/**
 * 真机验证：侧栏搜索结果片段（snippet）是否**可读**、且高亮仍落在命中词上。
 *
 * **为什么必须真机验证**：接口返回的 snippet 干净 ≠ 用户看到干净。
 * 前端会把 snippet 交给 `highlightKw`（先转义、再插 `<mark>`），若清洗破坏了
 * 词边界或引入了新的结构字符，屏幕上才会暴露。本脚本读**渲染后的真实 DOM 文本**。
 *
 * ## 缺陷背景（2026-10-13 实测）
 *
 * snippet 原先是「以命中点为中心、固定半径的原样切片」→ 命中点落在 markdown
 * 结构里就切出结构噪声。实测 10 个高频查询、185 条结果，**77% 含噪声**
 * （标题号 / 代码围栏 / 表格对齐长空白 / 图片链接 / 表格竖线）。
 *
 * ## 断言
 *   1. 多组查询下，渲染出的片段**不含**结构噪声特征
 *   2. **标题或片段至少有一处高亮**（见下方「判据修正」）
 *   3. 片段长度合理（不是只剩几个字，也不是整篇文档）
 *
 * ⚠️ **判据修正（本脚本第一版写错，属「假失败」）**
 *
 * 第一版断言「每个片段都必须有 <mark>」，实测有 4 条不满足并报失败。
 * 数据库直查后确认**那是判据错、不是产品错**：
 *     `01-集群部署` / `03-Grafana部署与使用` / `部署harbor仓库` 等文档
 *     **标题含「部署」但正文完全不含**（`position('部署' in text) = 0`），
 *     于是走「仅标题命中」的兜底分支，片段取正文开头 —— 自然没有命中词。
 * 此时**标题已经高亮**，用户看得出为什么命中。
 *
 * 正确的用户级要求是：**标题或片段至少有一处高亮**，而不是「片段必须有」。
 * （同族教训：断言失败先怀疑判据，再怀疑代码。）
 *
 * ## 用法
 *   cd web && SUNNYDOC_TOKEN=xxx node scripts/verify_snippet_clean.cjs
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

const QUERIES = ["磁盘", "内存", "部署", "网络", "kvm"];

(async () => {
  const b = await chromium.launch({
    headless: true,
    args: ["--no-proxy-server"],
    // 允许指定浏览器可执行文件（playwright 包升级后缓存里可能只有旧版 chromium）
    ...(process.env.SUNNYDOC_CHROMIUM ? { executablePath: process.env.SUNNYDOC_CHROMIUM } : {}),
  });
  const p = await b.newPage({ viewport: { width: 1440, height: 1100 } });
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e)));

  await p.goto("http://localhost:3001", { waitUntil: "domcontentloaded" });
  await p.evaluate((t) => localStorage.setItem("sunnydoc.token", t), TOKEN);
  await p.reload({ waitUntil: "domcontentloaded" });
  await sleep(2500);

  const kb = p.locator('[data-testid="kb-card"]').filter({ hasText: "云计算知识库" }).first();
  if (await kb.count()) {
    await kb.click();
    await sleep(2000);
  }
  const box = p.locator('input[placeholder*="搜索"]').first();
  check("侧栏搜索框存在", (await box.count()) > 0, "未找到搜索框");
  if (!(await box.count())) {
    await b.close();
    process.exit(1);
  }

  let allSnippets = 0;
  let noisySnippets = 0;
  let missingMark = 0;
  let titleOnly = 0;
  const noisySamples = [];
  const badMarkSamples = [];

  for (const q of QUERIES) {
    await box.fill("");
    await sleep(350);
    await box.fill(q);
    for (let i = 0; i < 40; i++) {
      await sleep(250);
      const t = await p.evaluate(() => {
        const side = document.querySelector("aside, [class*='sidebar']");
        const txt = side ? side.innerText : "";
        return /共\s*\d+\s*条结果|无匹配结果/.test(txt);
      });
      if (t) break;
    }
    await sleep(500);

    const rows = await p.evaluate(() => {
      const side = document.querySelector("aside, [class*='sidebar']") || document.body;
      const list = Array.from(side.querySelectorAll(".line-clamp-2"));
      return list.map((el) => {
        // 结果行 = 片段的父级按钮；标题在同一行里
        const row = el.closest("button") || el.parentElement;
        return {
          text: el.innerText || "",
          marks: el.querySelectorAll("mark.search-hit").length,
          titleMarks: row ? row.querySelectorAll("mark.search-hit").length - el.querySelectorAll("mark.search-hit").length : 0,
        };
      });
    });

    console.log(`━━━ 「${q}」渲染出的片段 ${rows.length} 条 ━━━`);
    for (const r of rows) {
      allSnippets++;
      const noise = [];
      if (r.text.includes("```")) noise.push("代码围栏");
      if (/[ \t]{6,}/.test(r.text)) noise.push("长空白");
      if ((r.text.match(/\|/g) || []).length >= 2) noise.push("表格竖线");
      if (/!\[|\]\(/.test(r.text)) noise.push("图片/链接语法");
      if (/(^|\s)#{1,6}\s/.test(r.text)) noise.push("标题号");
      if (/-{3,}/.test(r.text)) noise.push("分隔线");
      if (noise.length) {
        noisySnippets++;
        if (noisySamples.length < 6) noisySamples.push({ q, noise, text: r.text.slice(0, 90) });
      }
      // 「标题或片段至少一处高亮」——命中词可能只在标题里（正文确实不含）
      if (r.marks + r.titleMarks === 0) {
        missingMark++;
        if (badMarkSamples.length < 6) badMarkSamples.push({ q, text: r.text.slice(0, 90) });
      } else if (r.marks === 0) {
        titleOnly++;
      }
    }
    if (rows[0]) console.log(`   样例: ${rows[0].text.slice(0, 110)}`);
  }

  console.log("\n━━━ 汇总 ━━━");
  console.log(
    `  片段总数=${allSnippets}  含噪声=${noisySnippets}  无任何高亮=${missingMark}  （仅标题命中=${titleOnly}，属正常）`,
  );
  check("抓到了片段（防空集恒真）", allSnippets >= 10, `实际 ${allSnippets}`);
  check(
    "片段不含结构噪声（修复前 77% 含噪）",
    noisySnippets / Math.max(1, allSnippets) <= 0.05,
    `${noisySnippets}/${allSnippets} 含噪\n       ` +
      noisySamples.map((s) => `[${s.q}] ${s.noise} :: ${s.text}`).join("\n       "),
  );
  check(
    "标题或片段至少一处高亮",
    missingMark === 0,
    `${missingMark} 条完全无高亮（用户看不出为何命中）\n       ` +
      badMarkSamples.map((s) => `[${s.q}] ${s.text}`).join("\n       "),
  );

  check("页面无 JS 运行时错误", errs.length === 0, errs.join(" | "));

  console.log(fail === 0 ? "\n✅ 全部通过" : `\n❌ ${fail} 项失败`);
  await b.close();
  process.exit(fail === 0 ? 0 : 1);
})();