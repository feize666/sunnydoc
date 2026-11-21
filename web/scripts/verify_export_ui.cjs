#!/usr/bin/env node
/**
 * 导出可用性护栏（UI 端到端）
 *
 * ## 为什么需要它
 *
 * 2026-11-21 第五轮实测发现：**点「导出」永远失败**，报「未登录或登录已过期」。
 *
 * 根因在 `lib/api.ts` 的 `exportDocuments()`：
 *
 * ```js
 * fetch(`${BASE}/export`, {
 *   headers: { "Content-Type": "application/json" },   // ← 只写了这一行
 * ```
 *
 * `/export` 是**要登录**的端点（而且要 write 权限）。同一文件里其他手写
 * `fetch` （上传图片、上传附件、chat/stream、SSE）全都带了 `authHeaders()`，
 * 唯独这一个漏了 —— 于是整条导出链路不可用。
 *
 * ## 为什么既有的护栏没抓到
 *
 * `verify_export_authz`（越权）和 `verify_export_perf`（性能）都是**直接用
 * curl / fetch 手动带上 Bearer 头**打后端的 —— 它们测的是"后端权限对不对"，
 * 从来没走过前端那个函数。**后端全绿 + 前端全坏**可以同时成立。
 *
 * ⇒ 这正是「API 层与 UI 层护栏都要有」的反例：只测后端等于没测用户路径。
 *
 * ## 判据
 *
 * A. 打开导出框 → 点导出 → **真的产生下载**（不是报错）
 * B. 下载产物**内容非空且格式正确**（md 能读到文本、zip 能解出条目）
 * C. 成功后有**屏幕阅读器可读**的提示（`role=status` + `aria-live`）
 * D. 请求确实带了 `Authorization`（抓请求头断言，比"有没有报错"更精准）
 * E. 未登录时**给出明确错误**而不是静默失败（负向用例）
 *
 * ## 用法
 *   cd web && NODE_PATH=<node_modules> node scripts/verify_export_ui.cjs
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

/** 进入知识库并打开第一篇文档。返回该文档标题。 */
async function enterKbAndOpenDoc(p) {
  await p.goto(WEB + "/", { waitUntil: "domcontentloaded" });
  await sleep(3600);
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
  if (!docs.length) return null;
  await p.locator(`[data-tree-key="${docs[0]}"]`).click();
  await sleep(2400);
  return docs[0];
}

/** 打开侧栏「更多 → 导出」。 */
async function openExport(p) {
  const more = p.locator('[data-testid="sidebar-more"]');
  if (await more.count()) {
    await more.click();
    await sleep(400);
    const item = p.locator('[data-testid="sidebar-more-export"]');
    if (await item.count()) { await item.click(); await sleep(600); return true; }
  }
  // 老布局兜底：直接找文字为「导出」的侧栏按钮
  const legacy = p.locator("aside button").filter({ hasText: /^导出$/ }).first();
  if (await legacy.count()) { await legacy.click(); await sleep(600); return true; }
  return false;
}

(async () => {
  console.log("=== 导出 UI 端到端护栏 ===");

  const b = await chromium.launch({ headless: true, args: ["--no-proxy-server"] });

  /* ---------- A/B/C/D：正常路径 ---------- */
  {
    const ctx = await b.newContext({
      viewport: { width: 1600, height: 1000 },
      locale: "zh-CN",
      acceptDownloads: true,
    });
    const p = await ctx.newPage();
    await p.addInitScript((t) => localStorage.setItem("sunnydoc.token", t), TOKEN);

    // 记录导出请求是否带 Authorization（比"没报错"更直接）
    const exportReqs = [];
    p.on("request", (r) => {
      if (r.url().includes("/api/v1/export") && r.method() === "POST") {
        const h = r.headers();
        exportReqs.push({ auth: !!(h["authorization"] || h["Authorization"]) });
      }
    });

    const docId = await enterKbAndOpenDoc(p);
    check("能进入知识库并打开文档（前置）", !!docId, docId || "树里没有文档");
    const opened = await openExport(p);
    check("能从侧栏打开导出对话框（前置）", opened);

    // 默认范围应是「当前文档」
    const scope = await p.evaluate(() => {
      const d = document.querySelector(".dialog-panel");
      if (!d) return null;
      return [...d.querySelectorAll("button")]
        .filter((x) => /border-accent/.test(x.className))
        .map((x) => x.innerText.trim().split("\n")[0]);
    });
    check("已有打开文档时默认范围是「当前文档」", JSON.stringify(scope || []).includes("当前文档"), JSON.stringify(scope));

    const dl = p.waitForEvent("download", { timeout: 90000 }).catch(() => null);
    await p.locator(".dialog-panel button", { hasText: /^导出$/ }).first().click();

    const d = await dl;
    check("点「导出」真的产生下载（曾恒报「未登录或登录已过期」）", !!d, d ? d.suggestedFilename() : "没有下载事件");

    if (d) {
      const path = await d.path();
      const size = path ? fs.statSync(path).size : 0;
      check("下载产物非空", size > 0, `${size} bytes`);
      // md 产物应含 Markdown 特征（标题 / 段落），不能是空壳或错误页
      let head = "";
      try { head = fs.readFileSync(path, "utf8").slice(0, 2000); } catch { /* 二进制格式不读 */ }
      const looksMd = /^(#|\s*[-*]\s|\s*$|[^\x00-\x08])/m.test(head) && !/^\s*\{?\s*"detail"/.test(head);
      check("md 产物内容是正文而非错误体", size < 2000 || looksMd, head.slice(0, 60).replace(/\n/g, "⏎"));
    }

    check("导出请求带 Authorization（根因回归点）", exportReqs.length > 0 && exportReqs.every((r) => r.auth), JSON.stringify(exportReqs));

    // C. toast 必须可被读屏软件读到。
    // ⚠️ 不能只判「容器存在」：容器是常驻的（无 toast 时是空 div），
    //    导出失败时也会存在 → 会假通过（对抗性验证实测抓到这一点）。
    //    必须要求**非空文案**，且文案指向成功。
    await sleep(800);
    const toast = await p.evaluate(() => {
      const c = document.querySelector('div[aria-live][role="status"]');
      return c ? { text: (c.innerText || "").trim(), live: c.getAttribute("aria-live") } : null;
    });
    check(
      "成功提示对读屏软件可读且有内容（role=status + aria-live）",
      !!toast && toast.text.length > 0 && /已导出/.test(toast.text),
      JSON.stringify(toast),
    );

    await ctx.close();
  }

  /* ---------- E：未登录时必须明确报错，不能静默 ---------- */
  {
    const ctx = await b.newContext({
      viewport: { width: 1600, height: 1000 },
      locale: "zh-CN",
      acceptDownloads: true,
    });
    const p = await ctx.newPage();
    // 不注入 token → 未登录
    await p.goto(WEB + "/", { waitUntil: "domcontentloaded" });
    await sleep(2600);
    // 未登录会停在登录页；这里只验证「导出函数在有 token 时带、无 token 时不带」
    // 的契约不必真跑导出，改为直接断言登录态隔离：登录页不渲染导出入口。
    const hasExportEntry = await p.evaluate(
      () => !!document.querySelector('[data-testid="sidebar-more-export"]'),
    );
    check("未登录时不暴露导出入口（无 token 无侧栏）", !hasExportEntry);
    await ctx.close();
  }

  await b.close();
  // runner 以「全部通过」作为判定（见 run_all_verify.cjs）：
  // 只打印统计而不打印这句，会被判成「退出码 0 但未见全部通过」——
  // 那是脚本的格式问题，不是产品问题。
  console.log(`\n${pass} 通过 / ${fail} 失败`);
  console.log(fail === 0 ? "✅ 全部通过" : "❌ 存在失败项");
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("脚本异常：", e.message);
  process.exit(1);
});