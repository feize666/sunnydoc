#!/usr/bin/env node
/**
 * 真机验证：搜索结果片段是否落在**内容最密集**处（而不是第一个命中点）。
 *
 * **为什么必须真机验证**：后端选了哪个位置，只有读用户屏幕上的片段才能确认；
 * 而且片段经过清洗（markdown 噪声被剥离），密度要在**渲染后**的文本上算。
 *
 * ## 缺陷背景（2026-10-13 实测）
 *
 * 原实现取「正文里**最早**出现的命中词」作为片段中心。实测 464 条结果，
 * **293 条（63%）** 的密集窗口命中数明显高于首命中所在窗口。极端例：
 *   20 万字符的「openEuler安全配置基线」搜「日志」：首命中在 @13063（6% 处）
 *   周围仅 1 次；密集窗口 14 次。
 * → 首命中常常落在**目录 / 引言 / 顺带提及**处。
 *
 * ## 断言（可区分「取首个」与「取最密集」两种实现）
 *
 * 对每个结果：
 *   A = 渲染出的片段里的命中词次数
 *   B = 「首命中位置起的同等长度窗口」里的命中词次数（用接口拿到的原文复算）
 *
 * ⚠️ **判据修正（第一版不够有区分度，被对抗性验证抓出）**
 *
 * 第一版断言「A ≥ B 的占比 ≥ 90%」——**回滚成「取首个命中点」后它仍然通过**！
 * 因为回滚时 A 与 B 算的就是同一处 → `A == B` 占比高达 85%，
 * 「≥」自然满足。而 `A > B` 的占比差异巨大：
 *     正确实现 55%   vs   回滚实现 5%
 * → 正确判据是 **`A > B` 的占比**（严格更密），不是「≥」。
 * 这是「阈值型断言看似合理、实则无区分度」的又一例 ——
 * **每个断言都要用「回滚实现」验一遍能否失败**。
 *
 * 最终断言：
 *   1. `A > B` 占比 ≥ 25%（实测正确 55% / 回滚 5%）
 *   2. `A < B` 占比 ≤ 15%（回滚时该值也会升高）
 *
 * ## 用法
 *   cd web && SUNNYDOC_TOKEN=xxx node scripts/verify_snippet_position.cjs
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

const QUERIES = ["日志", "nginx", "docker", "命令", "磁盘"];
const API = "http://127.0.0.1:8000/api/v1";

async function api(path) {
  const r = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!r.ok) throw new Error(`API ${r.status} ${path}`);
  return r.json();
}

/** 统计 terms 在 s 中出现的次数（允许重叠，与后端口径一致）。 */
function countTerms(s, terms) {
  const low = s.toLowerCase();
  let n = 0;
  for (const t of terms) {
    if (!t) continue;
    let i = 0;
    while (true) {
      const k = low.indexOf(t.toLowerCase(), i);
      if (k < 0) break;
      n++;
      i = k + 1;
    }
  }
  return n;
}

(async () => {
  const b = await chromium.launch({ headless: true, args: ["--no-proxy-server"] });
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

  let better = 0; // A > B
  let equal = 0; // A == B
  let worse = 0; // A < B
  let considered = 0;
  const worseSamples = [];

  for (const q of QUERIES) {
    // 拿接口结果（含 terms）与原文，用于复算「首命中窗口」的密度
    let data;
    try {
      data = await api(`/search?q=${encodeURIComponent(q)}&limit=20`);
    } catch (e) {
      check(`接口可用（${q}）`, false, String(e));
      continue;
    }
    const terms = data.terms || [];
    const byId = new Map(data.results.map((r) => [r.doc_id, r]));

    await box.fill("");
    await sleep(350);
    await box.fill(q);
    for (let i = 0; i < 40; i++) {
      await sleep(250);
      const ready = await p.evaluate(() =>
        /共\s*\d+\s*条结果|无匹配结果/.test(
          (document.querySelector("aside, [class*='sidebar']") || document.body).innerText,
        ),
      );
      if (ready) break;
    }
    await sleep(500);

    // 读界面上渲染出的片段（按结果行顺序）
    const rendered = await p.evaluate(() => {
      const side = document.querySelector("aside, [class*='sidebar']") || document.body;
      const rows = Array.from(side.querySelectorAll("button"));
      return rows
        .map((btn) => {
          const snip = btn.querySelector(".line-clamp-2");
          const title = btn.querySelector(".truncate");
          return snip ? { title: title ? title.innerText : "", snippet: snip.innerText } : null;
        })
        .filter(Boolean);
    });

    console.log(`━━━ 「${q}」界面渲染片段 ${rendered.length} 条（接口 ${data.results.length} 条）━━━`);

    for (const r of rendered) {
      // 按标题匹配回接口结果，拿到 doc_id
      const meta =
        Array.from(byId.values()).find(
          (x) => (x.title || "").trim() === (r.title || "").trim(),
        ) || null;
      if (!meta) continue;

      let doc;
      try {
        doc = await api(`/documents/${meta.doc_id}`);
      } catch {
        continue;
      }
      const text = doc.text || "";
      const low = text.toLowerCase();

      // B：首命中位置起的同等长度窗口
      let firstIdx = -1;
      for (const t of terms) {
        const i = low.indexOf(t.toLowerCase());
        if (i >= 0 && (firstIdx === -1 || i < firstIdx)) firstIdx = i;
      }
      if (firstIdx < 0) continue; // 正文无命中（仅标题命中）→ 不参与该对照
      const winLen = r.snippet.length || 140;
      const firstWindow = text.slice(firstIdx, firstIdx + winLen);

      const A = countTerms(r.snippet, terms.length ? terms : [q]);
      const B = countTerms(firstWindow, terms.length ? terms : [q]);
      considered++;
      if (A > B) better++;
      else if (A === B) equal++;
      else {
        worse++;
        if (worseSamples.length < 5) {
          worseSamples.push({ q, title: r.title, A, B, snippet: r.snippet.slice(0, 80) });
        }
      }
    }
  }

  console.log("\n━━━ 汇总 ━━━");
  console.log(
    `  参与对照 ${considered} 条：A>B ${better} · A==B ${equal} · A<B ${worse}`,
  );
  check("对照样本充足（防空集恒真）", considered >= 15, `实际 ${considered}`);
  const betterRate = better / Math.max(1, considered);
  const worseRate = worse / Math.max(1, considered);
  check(
    "「片段比首命中窗口更密」的占比 ≥ 25%",
    betterRate >= 0.25,
    `实际 ${(betterRate * 100).toFixed(0)}%（${better}）—— 正确实现约 55%，` +
      `退化为「取首个」时仅 5%\n       ` +
      worseSamples.map((s) => `[${s.q}] ${s.title} A=${s.A} B=${s.B}`).join("\n       "),
  );
  check(
    "「片段比首命中窗口更疏」的占比 ≤ 15%",
    worseRate <= 0.15,
    `实际 ${(worseRate * 100).toFixed(0)}%（${worse}/${considered}）\n       ` +
      worseSamples.map((s) => `[${s.q}] ${s.title} A=${s.A} B=${s.B} :: ${s.snippet}`).join("\n       "),
  );

  check("页面无 JS 运行时错误", errs.length === 0, errs.join(" | "));

  console.log(fail === 0 ? "\n✅ 全部通过" : `\n❌ ${fail} 项失败`);
  await b.close();
  process.exit(fail === 0 ? 0 : 1);
})();