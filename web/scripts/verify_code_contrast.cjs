#!/usr/bin/env node
/**
 * 真机验证「代码块配色校准」与两处半透明白文字的对比度修复。
 *
 * 背景（2026-10-21 审计报告 §2.1 / §2.2 实测）：
 *   1. 代码块配色未按本项目底色校准 —— shiki 两个预设主题都是按**它们自己的**
 *      编辑器底色调的（`github-light` 假定 `#ffffff`、`one-dark-pro` 假定 `#282c34`），
 *      而项目用 `.md-body pre.shiki { background-color: var(--surface-2) !important }`
 *      强制改底，于是调色板与底不再匹配：
 *        - 浅色 `#eef2f7` 上 **6/12** token 跌破 4.5（注释 `#6a737d`=4.28 最典型）
 *        - 深色 `#1e293b` 上 **4/13** 不达标（`#5c6370`=2.42）
 *      修法：shiki 原生 `colorReplacements`（不改 DOM、不动 CSS）。
 *   2. `Sidebar` 激活标签计数用 `text-white/70`，落在 `bg-accent-solid #2862f4` 上
 *      只有 **3.29**（需 4.5）→ 改 `text-white` = 5.07。
 *   3. `SlideEditor` 放映提示 `text-white/40` 在 `bg-black` 上 **3.66**
 *      → 提到 `/50` = 5.32。
 *
 * ⚠️ 两个**测量陷阱**（首版都踩过，务必保留本注释）：
 *   - **切主题不能用 `document.documentElement.dataset.theme = "dark"`**：主题由
 *     React state 驱动（`page.tsx` 的 useEffect 把 state 写回 data-theme），
 *     外部改 DOM 会被下次渲染覆盖 → 代码块仍是浅色配色，看起来像「深色没修好」。
 *     **必须点真实的 `button[aria-label="切换主题"]`。**
 *   - **必须断言「测到了 token」**（`tokens > 0`）：首版因文档树未刷新导致
 *     `pre.shiki` 为 0，断言被静默跳过 —— 「没测到」被误当成「通过」。
 *
 * 用法：
 *   NODE_PATH=<托管 node_modules> node web/scripts/verify_code_contrast.cjs
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { cleanupDocuments, listFixtureDocs, listFixtureTrash } = require("./_card_fixtures.cjs");

const TOKEN = (
  process.env.SUNNYDOC_TOKEN ||
  fs.readFileSync(process.env.SUNNYDOC_TOKEN_FILE || "/tmp/sunnydoc-token.txt", "utf8")
).trim();
const WEB = process.env.SUNNYDOC_WEB || "http://localhost:3001";
const API = process.env.SUNNYDOC_API || "http://127.0.0.1:8000";
const KB = process.env.SUNNYDOC_KB || "fdef57f179384d679b62a3c4bae2d2e3";
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const TITLE = "CBX-配色验证";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fail = 0;
const check = (n, c, d = "") => {
  if (c) console.log("  ✅ " + n);
  else {
    fail++;
    console.log("  ❌ " + n + "  " + String(d).slice(0, 220));
  }
};

/** 浏览器侧 WCAG 计算（内联，不用 eval —— eval 的 const 不会泄漏到外层作用域）。 */
const HELPERS = `
  const lum=([r,g,b])=>{const f=c=>{c/=255;return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4);};return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b);};
  const C=(a,b)=>{const x=lum(a),y=lum(b);return Math.round(((Math.max(x,y)+0.05)/(Math.min(x,y)+0.05))*100)/100;};
  const parse=c=>{const m=String(c).match(/\\d+(\\.\\d+)?/g);return m?m.slice(0,3).map(Number):null;};
`;

(async () => {
  const b = await chromium.launch({ headless: true, args: ["--no-proxy-server"] });
  const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  await p.addStyleTag({ content: "nextjs-portal{display:none!important;pointer-events:none!important}" });
  await p.goto(WEB, { waitUntil: "domcontentloaded" });
  await p.evaluate((t) => localStorage.setItem("sunnydoc.token", t), TOKEN);
  await p.reload({ waitUntil: "domcontentloaded" });
  await sleep(2500);

  /**
   * 开跑前先清**历史残留**。
   *
   * 🔴 为什么必须有（2026-10-21 本脚本首跑就踩到）：本脚本按「标题」判定零残留，
   * 而上一版脚本曾因异常（`parse is not defined`）中断、没走到清理，留下同名孤儿文档。
   * 于是**新脚本的清理逻辑完全正常，却因为查到历史残留而报「零残留 ❌」** ——
   * 看起来像缺陷，实际是判据把「上一次的债」算到了这一次头上。
   * ⇒ 任何「按标题判定零残留」的脚本都应在开跑前先自清前置残留。
   */
  // 注意：共享 helper 的形参名是 `page`，本脚本的实例变量叫 `p` —— 必须传 `p`
  const staleDocs = [...(await listFixtureDocs(p, TITLE)), ...(await listFixtureTrash(p, TITLE))];
  if (staleDocs.length) {
    await cleanupDocuments(p, staleDocs.map((d) => d.id));
    console.log(`  （开跑前清理历史残留 ${staleDocs.length} 篇）`);
  }

  // 建一篇覆盖多种 token 的代码文档（注释/关键字/字符串/数字都要有）
  const doc = await p.evaluate(
    async ([api, tok, kb, title]) => {
      const r = await fetch(api + "/api/v1/documents", {
        method: "POST",
        headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          type: "doc",
          kb_id: kb,
          content: [
            "# 代码块配色验证",
            "",
            "```python",
            "# 注释 token：审计里最不达标的一类",
            "def hello(name: str) -> str:",
            '    """文档字符串"""',
            '    return f"Hello {name}"  # 行尾注释',
            "",
            "COUNT = 42",
            "ratio = 3.14",
            "```",
            "",
            "正文段落。",
          ].join("\n"),
        }),
      });
      return await r.json();
    },
    [API, TOKEN, KB, TITLE],
  );

  // 进知识库 → 刷新 → 展开 → 按 id 点文档树行（不依赖搜索排名）
  const kbCard = p.locator('[data-testid="kb-card"]').first();
  if (await kbCard.count()) {
    await kbCard.click({ force: true });
    await sleep(2500);
  }
  const rf = p.locator('[data-testid="refresh-doc-list"]').first();
  if (await rf.count()) {
    await rf.click({ force: true });
    await sleep(3000);
  }
  const tg = p.locator('[data-testid="toggle-batched-all"]').first();
  if ((await tg.count()) && (await tg.getAttribute("aria-pressed")) !== "true") {
    await tg.click({ force: true });
    await sleep(1500);
  }
  const row = p.locator(`[data-tree-kind="doc"][data-tree-key="${doc.id}"]`).first();
  if (await row.count()) {
    await row.click({ force: true });
    await sleep(3500);
  } else {
    const box = p.locator('[data-testid="sidebar-search"]').first();
    if (await box.count()) {
      await box.fill(TITLE);
      await sleep(2000);
      const hit = p.getByText(TITLE, { exact: true }).first();
      if (await hit.count()) {
        await hit.click({ force: true });
        await sleep(3000);
      }
    }
  }

  // 等 shiki 闲时高亮完成（最多 8s）
  for (let i = 0; i < 16; i++) {
    const n = await p.evaluate(() => document.querySelectorAll("pre.shiki span[style]").length);
    if (n > 5) break;
    await sleep(500);
  }

  const measure = async () =>
    p.evaluate(() => {
      const lum = ([r, g, b]) => {
        const f = (c) => {
          c /= 255;
          return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const C = (a, b) => {
        const x = lum(a),
          y = lum(b);
        return Math.round(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)) * 100) / 100;
      };
      const parse = (c) => {
        const m = String(c).match(/\d+(\.\d+)?/g);
        return m ? m.slice(0, 3).map(Number) : null;
      };
      const pre = document.querySelector("pre.shiki");
      if (!pre) return { tokens: [], bg: null };
      const bg = parse(getComputedStyle(pre).backgroundColor);
      const seen = new Map();
      for (const sp of pre.querySelectorAll("span[style]")) {
        const t = (sp.textContent || "").trim();
        if (!t) continue;
        const fgRaw = getComputedStyle(sp).color;
        const fg = parse(fgRaw);
        if (!fg || !bg) continue;
        if (seen.has(fgRaw)) continue;
        seen.set(fgRaw, { color: fgRaw, ratio: C(fg, bg), sample: t.slice(0, 26) });
      }
      return { tokens: [...seen.values()], bg: getComputedStyle(pre).backgroundColor };
    });

  const theme = await p.evaluate(() => document.documentElement.dataset.theme || "light");

  // ---------- 浅色 ----------
  console.log("=== A. 代码块配色（浅色，底 --surface-2）===");
  const light = await measure();
  check("浅色：代码块已渲染且测到 token（>0）", light.tokens.length > 0, `tokens=${light.tokens.length}`);
  const lightBad = light.tokens.filter((t) => t.ratio < 4.5);
  console.log(`  底色 ${light.bg}，token ${light.tokens.length} 种，不达标 ${lightBad.length} 种`);
  for (const t of light.tokens.sort((a, b) => a.ratio - b.ratio)) {
    console.log(`    ${String(t.ratio).padStart(5)} ${t.ratio >= 4.5 ? "✅" : "❌"}  ${t.color.padEnd(22)} "${t.sample}"`);
  }
  check("浅色：全部 token ≥ 4.5", lightBad.length === 0, lightBad.map((t) => `${t.color}=${t.ratio}`).join(" "));

  // ---------- 深色（必须点真实按钮） ----------
  console.log("\n=== B. 代码块配色（深色，底 --surface-2 暗色档）===");
  const toggle = p.locator('button[aria-label="切换主题"]').first();
  check("主题切换按钮可定位", (await toggle.count()) > 0, "未找到 aria-label=切换主题");
  if (await toggle.count()) {
    await toggle.click({ force: true });
    await sleep(3000);
  }
  const darkTheme = await p.evaluate(() => document.documentElement.dataset.theme);
  check("已进入深色主题（走真实按钮，非改 DOM）", darkTheme === "dark", `data-theme=${darkTheme}`);

  const dark = await measure();
  check("深色：代码块已渲染且测到 token（>0）", dark.tokens.length > 0, `tokens=${dark.tokens.length}`);
  const darkBad = dark.tokens.filter((t) => t.ratio < 4.5);
  console.log(`  底色 ${dark.bg}，token ${dark.tokens.length} 种，不达标 ${darkBad.length} 种`);
  for (const t of dark.tokens.sort((a, b) => a.ratio - b.ratio)) {
    console.log(`    ${String(t.ratio).padStart(5)} ${t.ratio >= 4.5 ? "✅" : "❌"}  ${t.color.padEnd(22)} "${t.sample}"`);
  }
  check("深色：全部 token ≥ 4.5", darkBad.length === 0, darkBad.map((t) => `${t.color}=${t.ratio}`).join(" "));

  // 恢复浅色
  if (await toggle.count()) {
    await toggle.click({ force: true });
    await sleep(2000);
  }

  // ---------- 半透明白文字 ----------
  console.log("\n=== C. 半透明白文字的对比度 ===");
  const tagChip = p.locator('[data-testid="sidebar-tag-chip"]').first();
  const hasTag = (await tagChip.count()) > 0;
  if (hasTag) {
    await tagChip.click({ force: true });
    await sleep(1200);
  }
  const tagM = await p.evaluate(() => {
    const lum = ([r, g, b]) => {
      const f = (c) => {
        c /= 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const C = (a, b) => {
      const x = lum(a),
        y = lum(b);
      return Math.round(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)) * 100) / 100;
    };
    const parse = (c) => {
      const m = String(c).match(/\d+(\.\d+)?/g);
      return m ? m.slice(0, 3).map(Number) : null;
    };
    const chip = document.querySelector('[data-testid="sidebar-tag-chip"][data-active="1"]');
    if (!chip) return { found: false };
    const spans = [...chip.querySelectorAll("span")];
    const cnt = spans[spans.length - 1];
    const bg = parse(getComputedStyle(chip).backgroundColor);
    const fg = parse(getComputedStyle(cnt).color);
    return {
      found: true,
      text: (cnt.textContent || "").trim(),
      color: getComputedStyle(cnt).color,
      bg: getComputedStyle(chip).backgroundColor,
      ratio: bg && fg ? C(fg, bg) : null,
    };
  });
  if (tagM.found) {
    console.log(`  激活标签计数 "${tagM.text}"  color=${tagM.color} bg=${tagM.bg} → ${tagM.ratio}`);
    check("激活标签计数对比度 ≥ 4.5（原 text-white/70 = 3.29）", tagM.ratio >= 4.5, `ratio=${tagM.ratio}`);
    await tagChip.click({ force: true });
    await sleep(600);
  } else {
    // 库里没有标签时无法真机测量 —— 退化为源码断言，并**明确说明**是静态检查
    const src = fs.readFileSync(path.join(REPO_ROOT, "web/src/components/Sidebar.tsx"), "utf8");
    check("（静态）当前库无标签，改为断言源码不再使用 text-white/70",
      !src.includes('? "text-white/70"'), "源码里仍存在 text-white/70");
  }

  const slideSrc = fs.readFileSync(path.join(REPO_ROOT, "web/src/components/SlideEditor.tsx"), "utf8");
  check("（静态）放映提示已由 white/40 提到 white/50（3.66 → 5.32）",
    slideSrc.includes('text-white/50">← → 翻页'), "源码里未找到 white/50 提示");

  // 清理（软删 + 从回收站彻底删除）
  await p.evaluate(
    async ([api, tok, id]) => {
      await fetch(`${api}/api/v1/documents/${id}`, { method: "DELETE", headers: { Authorization: "Bearer " + tok } });
      await fetch(`${api}/api/v1/trash/document/${id}`, { method: "DELETE", headers: { Authorization: "Bearer " + tok } });
    },
    [API, TOKEN, doc.id],
  );

  const live = await fetch(`${API}/api/v1/documents?limit=1000`, {
    headers: { Authorization: "Bearer " + TOKEN },
  }).then((x) => x.json());
  const trash = await fetch(`${API}/api/v1/trash`, {
    headers: { Authorization: "Bearer " + TOKEN },
  }).then((x) => x.json());
  check("零残留（活跃列表）", !(live.documents || []).some((d) => d.title === TITLE),
    JSON.stringify((live.documents || []).filter((d) => d.title === TITLE).map((d) => d.title)));
  check("零残留（回收站）", !(trash.documents || []).some((d) => d.title === TITLE),
    JSON.stringify((trash.documents || []).filter((d) => d.title === TITLE).map((d) => d.title)));

  console.log(`\n  （初始主题 ${theme}）`);
  console.log("\n" + (fail === 0 ? "全部通过" : `失败 ${fail} 项`));
  await b.close();
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error("脚本异常:", e);
  process.exit(1);
});