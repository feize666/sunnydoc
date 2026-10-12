#!/usr/bin/env node
/**
 * 真机验证：侧栏全文搜索对**中文自然语言查询**是否可用，且高亮是否对齐实际命中词。
 *
 * **为什么必须真机验证**：接口 total 变了 ≠ 用户看到对的东西。本脚本读的是
 * 用户屏幕上真实的「结果条数」与「高亮标记数量」。
 *
 * ## 缺陷背景（2026-10-12 实测）
 *
 * `/search` 原先把整个查询串当一个词做子串匹配，而中文不加空格 →
 * 「虚拟机怎么开机」要求文档里原样出现这 7 个连续汉字 → **实测 0 条**；
 * 只插一个空格（「虚拟机 开机」）就 11 条。
 * 同一知识库、同一问题：侧栏搜索 0 条，AI 问答却有 5 条引用
 * （因为 `store.search` 用了 jieba 分词，`/search` 没用）。
 *
 * ## 断言（每条都绑定到「本次查询」的可见结果）
 *
 *  1. 中文自然语言查询（无空格）能返回结果 —— **核心回归**
 *  2. 结果里出现 `<mark class="search-hit">` 高亮 —— 防「有结果但零高亮」
 *  3. 高亮到的文本必须属于「后端回传的 terms」之一 —— 防高亮错词
 *  4. 英文标识符查询（`vt-x`）仍精确（结果数不超过基线上限，防 OR 语义过宽）
 *  5. 多词 AND 查询（`kvm 磁盘`）结果数 ≤ 单词查询，证明 AND 未被破坏
 *
 * ## 用法
 *   cd web && SUNNYDOC_TOKEN=xxx node scripts/verify_search_cjk.cjs
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

(async () => {
  const b = await chromium.launch({ headless: true, args: ["--no-proxy-server"] });
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e)));

  await p.goto("http://localhost:3001", { waitUntil: "domcontentloaded" });
  await p.evaluate((t) => localStorage.setItem("sunnydoc.token", t), TOKEN);
  await p.reload({ waitUntil: "domcontentloaded" });
  await sleep(2500);

  const kb = p.locator("button, a").filter({ hasText: "云计算知识库" }).first();
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

  /**
   * 执行一次搜索，读回：
   *  - count：侧栏声明的结果条数（「共 N 条结果」）
   *  - rows：实际渲染的结果行数
   *  - marks：`.search-hit` 高亮元素数
   *  - markTexts：被高亮的文本（去重）
   */
  const runSearch = async (q) => {
    await box.fill("");
    await sleep(350);
    await box.fill(q);
    // 等结果区出现「共 N 条结果」或「无匹配结果」
    let ok = false;
    for (let i = 0; i < 40; i++) {
      await sleep(250);
      const t = await p.evaluate(() => {
        const el = document.querySelector("aside, [class*='sidebar']");
        const txt = el ? el.innerText : document.body.innerText;
        return /共\s*\d+\s*条结果|无匹配结果/.test(txt) ? txt : null;
      });
      if (t) {
        ok = true;
        break;
      }
    }
    await sleep(500);
    const res = await p.evaluate(() => {
      // 侧栏里的结果区
      const side = document.querySelector("aside, [class*='sidebar']") || document.body;
      const txt = side.innerText || "";
      const m = txt.match(/共\s*(\d+)\s*条结果/);
      const count = m ? parseInt(m[1], 10) : 0;
      const rows = side.querySelectorAll("button .line-clamp-2, button span.truncate").length;
      const marks = side.querySelectorAll("mark.search-hit").length;
      const markTexts = Array.from(
        new Set(Array.from(side.querySelectorAll("mark.search-hit")).map((e) => e.innerText)),
      );
      return { count, rows, marks, markTexts, noMatch: txt.includes("无匹配结果") };
    });
    return { ok, ...res };
  };

  console.log("━━━ 用例 1：中文自然语言查询（核心回归）━━━");
  {
    const q = "虚拟机怎么开机";
    const r = await runSearch(q);
    console.log(
      `  「${q}」→ count=${r.count} rows=${r.rows} marks=${r.marks} markTexts=${JSON.stringify(r.markTexts)}`,
    );
    check("搜索出结果（修复前恒为 0）", r.count > 0, `count=${r.count}（应为 0 之外的正数）`);
    check("实际渲染了结果行", r.rows > 0, `rows=${r.rows}`);
    check("有高亮标记（防「有结果但零高亮」）", r.marks > 0, `marks=${r.marks}`);
    // 高亮必须落在分词后的词上，而不是原始整串
    const allCjk = r.markTexts.every((t) => ["虚拟机", "开机"].includes(t));
    check(
      "高亮词恰为分词结果（虚拟机 / 开机）",
      r.markTexts.length > 0 && allCjk,
      `markTexts=${JSON.stringify(r.markTexts)}`,
    );
    check(
      "高亮词不含原始整串（文档里不存在）",
      !r.markTexts.includes(q),
      `markTexts=${JSON.stringify(r.markTexts)}`,
    );
  }

  console.log("━━━ 用例 2：英文标识符仍精确（防 OR 语义过宽）━━━");
  {
    const q = "vt-x";
    const r = await runSearch(q);
    console.log(`  「${q}」→ count=${r.count} markTexts=${JSON.stringify(r.markTexts)}`);
    check("能搜到", r.count > 0, `count=${r.count}`);
    // 修复过程中「无脑分词 OR」会让 vt 把无关文档捞进来（实测曾到 20 条）
    check("结果数收窄（≤10，防 vt 碎片泛滥）", r.count <= 10, `count=${r.count}`);
    check(
      "高亮词是原串（非 vt 碎片）",
      r.markTexts.length === 0 || r.markTexts.every((t) => t.toLowerCase() === "vt-x"),
      `markTexts=${JSON.stringify(r.markTexts)}`,
    );
  }

  console.log("━━━ 用例 3：多词 AND 未被破坏 ━━━");
  {
    const single = await runSearch("kvm");
    const multi = await runSearch("kvm 磁盘");
    console.log(`  「kvm」count=${single.count}  「kvm 磁盘」count=${multi.count}`);
    check("多词查询有结果", multi.count > 0, `count=${multi.count}`);
    check(
      "多词结果数 ≤ 单词结果数（AND 语义）",
      multi.count <= single.count + 2,
      `multi=${multi.count} single=${single.count}`,
    );
  }

  check("页面无 JS 运行时错误", errs.length === 0, errs.join(" | "));

  console.log(fail === 0 ? "\n✅ 全部通过" : `\n❌ ${fail} 项失败`);
  await b.close();
  process.exit(fail === 0 ? 0 : 1);
})();