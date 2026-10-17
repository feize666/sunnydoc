#!/usr/bin/env node
/**
 * 真机验证：侧栏搜索结果的**显示顺序**是否已按相关性排列。
 *
 * 为什么必须真机验证：后端接口排序正确 ≠ 用户看到正确。
 * 前端可能自己再排一次（或按 index 渲染错位），必须读 DOM 里真实的展示顺序。
 *
 * 断言：
 *   1. 搜「docker」时，标题带 Docker 的排在标题无关的前面
 *   2. 每组内按命中量降序（用接口的 match_count 交叉校验）
 *   3. 搜索不至于慢（记录输入到结果出现的耗时）
 */
const { chromium } = require("playwright");
const fs = require("fs");
// token 走环境变量，避免把凭据写进仓库
const TOKEN = process.env.SUNNYDOC_TOKEN || fs.readFileSync(process.env.SUNNYDOC_TOKEN_FILE || "/tmp/sunnydoc-token.txt", "utf8").trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (n, c, d) => {
  if (c) console.log("  ✅ " + n);
  else { fail++; console.log("  ❌ " + n + "\n       " + d); }
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

  const kb = p.locator('[data-testid="kb-card"]').filter({ hasText: "云计算知识库" }).first();
  if (await kb.count()) { await kb.click(); await sleep(2200); }

  const box = p.locator('input[type="search"], input[placeholder*="搜索"]').first();
  check("侧栏搜索框存在", (await box.count()) > 0, "未找到搜索框");
  if (!(await box.count())) { await b.close(); process.exit(1); }

  for (const q of ["docker", "磁盘"]) {
    console.log("━━━ 搜索「" + q + "」━━━");
    await box.fill("");
    await sleep(300);
    const t0 = Date.now();
    await box.fill(q);
    // 等结果出现
    let waited = 0;
    while (waited < 6000) {
      await sleep(200);
      waited = Date.now() - t0;
      const n = await p.evaluate(() => {
        const el = document.querySelector("[class*='result'], ul li, ol li");
        return document.body.innerText.includes("条结果") || !!el;
      });
      if (n) break;
    }
    await sleep(800);

    // 读 DOM 里真实展示的结果顺序。
    // 结构（Sidebar.tsx 654 起）：每个结果是 <button>，标题在 span.truncate.text-[16px]，
    // 下方还有「命中 N 处」。按此结构精确抓取，避免选择器落空导致假通过。
    const shown = await p.evaluate(() => {
      const out = [];
      for (const btn of Array.from(document.querySelectorAll("button"))) {
        const titleEl = btn.querySelector("span.truncate");
        if (!titleEl) continue;
        const title = (titleEl.textContent || "").trim();
        if (!title) continue;
        const cnt = (btn.textContent || "").match(/命中\s*(\d+)\s*处/);
        if (!cnt) continue; // 有「命中 N 处」的才是搜索结果项
        out.push({ title, hits: parseInt(cnt[1], 10) });
      }
      return out.slice(0, 10);
    });

    console.log("  UI 展示顺序（前 8）:");
    shown.slice(0, 8).forEach((x, i) =>
      console.log(`    ${i + 1}. ${x.title.slice(0, 46).padEnd(48)} 命中=${x.hits}`),
    );
    console.log("  输入→结果耗时: " + waited + " ms");

    // 交叉校验：直接问接口要顺序，比对 UI 是否一致
    const api = await p.evaluate(async (query) => {
      const tok = localStorage.getItem("sunnydoc.token");
      const r = await fetch(
        `http://localhost:8000/api/v1/search?q=${encodeURIComponent(query)}&limit=8`,
        { headers: { Authorization: "Bearer " + tok } },
      );
      const d = await r.json();
      return (d.results || []).map((x) => ({ title: x.title, hits: x.match_count, inTitle: x.match_in_title }));
    }, q);

    console.log("  接口顺序（前 8）:");
    api.slice(0, 8).forEach((x, i) =>
      console.log(`    ${i + 1}. ${(x.title || "").slice(0, 46).padEnd(48)} 标题=${x.inTitle} 命中=${x.hits}`),
    );

    // 断言：接口序应「标题命中组在前」，且组内命中量降序
    const firstNonTitle = api.findIndex((x) => !x.inTitle);
    const titleCount = api.filter((x) => x.inTitle).length;
    if (firstNonTitle !== -1 && titleCount > 0) {
      check(
        `  标题命中项全部排在非标题命中项之前`,
        firstNonTitle === titleCount,
        `首个非标题命中出现在第 ${firstNonTitle + 1} 位，但标题命中只有 ${titleCount} 个`,
      );
    }
    if (firstNonTitle > 1) {
      const grp = api.slice(0, firstNonTitle).map((x) => x.hits);
      const desc = grp.every((v, i) => i === 0 || grp[i - 1] >= v);
      check("  标题命中组内按命中量降序", desc, JSON.stringify(grp));
    }
    // 断言：UI 展示的首项应与接口首项一致（前端未自行乱排）
    check("  UI 抓到了结果项（非空）", shown.length > 0, "抓取到 " + shown.length + " 项");
    if (shown.length && api.length) {
      const a = shown[0].title.replace(/\s+/g, "");
      const bb = (api[0].title || "").replace(/\s+/g, "");
      check("  UI 首项与接口首项一致", a.includes(bb) || bb.includes(a), `UI="${a.slice(0, 30)}" API="${bb.slice(0, 30)}"`);
      // 逐项比对 UI 与接口顺序（抓前 5 项，避免长尾差异）
      const n = Math.min(5, shown.length, api.length);
      let same = 0;
      for (let i = 0; i < n; i++) {
        const u = shown[i].title.replace(/\s+/g, "");
        const x = (api[i].title || "").replace(/\s+/g, "");
        if (u.includes(x) || x.includes(u)) same++;
      }
      check(`  UI 与接口顺序一致（前 ${n} 项）`, same === n, `一致 ${same}/${n}`);
    }
    console.log("");
  }

  console.log("console 错误: " + (errs.length ? errs.slice(0, 2).join(" | ") : "无"));
  if (errs.length) fail++;
  await p.screenshot({ path: "/tmp/sd_srch/search.png" });
  await b.close();
  console.log(fail ? "❌ FAIL = " + fail : "✅ ALL PASS");
  process.exit(fail ? 1 : 0);
})();