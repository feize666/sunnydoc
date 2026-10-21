#!/usr/bin/env node
/**
 * 真机验证「Sunny 品牌落地」—— 8 个展示点 + 品牌字 + 标题 + favicon + 知识库名。
 *
 * ## 为什么需要这个脚本（与 verify_brand_logo.cjs 的分工）
 *
 * `verify_brand_logo.cjs` 验的是 **SVG 资源本身**（把 SVG 画到 canvas 上逐像素看）。
 * 本脚本验的是 **产品里真的接对了** —— 组件替换、文案改名、标题、favicon、
 * 数据库记录。两者缺一不可：资源对了但没接上，用户看到的仍是旧品牌。
 *
 * ## 判据设计（每条都对应一类真实漏法）
 *
 * 🔴 **必须验「无旧品牌残留」**：本轮要把 9 处「知库」/「知」字换掉。
 *    只验「新品牌出现了」是不够的 —— 漏改一处照样通过。所以两条都要验。
 *
 * 🔴 **必须验 logo 真的画出了太阳，而不是「有个元素」**：
 *    一度 `.logo-mark` 是「蓝渐变底 + 白字」。若只验 DOM 里存在 `[data-brand]`，
 *    把它换成任何东西都能过。这里取 `<svg>` 内**实际存在的 path/ellipse/circle
 *    子元素数量与关键属性**，并断言描边色为深棕、填充为黄。
 *
 * 🔴 **切主题必须走真实按钮**，不能改 `dataset.theme`：
 *    主题由 React state 驱动，外部改 DOM 会被下次渲染覆盖（本项目已踩过）。
 *
 * 🔴 **必须断言「测到了目标」**（如 `spots === 8`）：空集合会让 `every()` 恒真。
 *
 * 用法：
 *   NODE_PATH=<托管 node_modules> node web/scripts/verify_brand_inapp.cjs
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const TOKEN = (
  process.env.SUNNYDOC_TOKEN ||
  fs.readFileSync(process.env.SUNNYDOC_TOKEN_FILE || "/tmp/sunnydoc-token.txt", "utf8")
).trim();
const WEB = process.env.SUNNYDOC_WEB || "http://localhost:3001";
const API = process.env.SUNNYDOC_API || "http://127.0.0.1:8000";
const KB = process.env.SUNNYDOC_KB || "fdef57f179384d679b62a3c4bae2d2e3";
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const GEOM = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, "docs", "brand", "geom.json"), "utf8"),
);
const C = GEOM.colors;

// 期望的品牌文案（与 sunny_geom / 替换清单一致）
const BRAND = "Sunny";
const TAGLINE = "个人知识库";
const PAGE_TITLE = `${BRAND} · ${TAGLINE}`;
// 旧品牌残留词（用于「无残留」断言）
const LEGACY = ["知库", "知库助手", "文档知识库"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (n, ok, d = "") => {
  console.log(`  ${ok ? "✅" : "❌"} ${n}${ok || !d ? "" : "  " + String(d).slice(0, 220)}`);
  ok ? pass++ : fail++;
};

// 🔴 **不要用 `networkidle`**：Next dev server 有 HMR websocket 长连接，
//    页面永远不会进入 networkidle → `page.goto` 30s 超时。
//    统一用 `domcontentloaded` + 显式 `sleep` 等渲染。
async function login(page) {
  await page.goto(WEB + "/", { waitUntil: "domcontentloaded" });
  await page.evaluate((t) => localStorage.setItem("sunnydoc.token", t), TOKEN);
}

/** 把页面里所有 Sunny logo 的「结构指纹」取出来。 */
const GLYPH_FINGERPRINT = `(() => {
  const nodes = Array.from(document.querySelectorAll('[data-brand="sunny"]'));
  return nodes.map((n) => {
    const svg = n.querySelector("svg");
    if (!svg) return { ok: false, why: "无 svg" };
    const paths = Array.from(svg.querySelectorAll("path"));
    const bodyPath = paths.find((p) => p.getAttribute("stroke") && p.getAttribute("fill"));
    return {
      ok: true,
      w: svg.getAttribute("width"),
      h: svg.getAttribute("height"),
      viewBox: svg.getAttribute("viewBox"),
      ellipses: svg.querySelectorAll("ellipse").length,
      circles: svg.querySelectorAll("circle").length,
      paths: paths.length,
      bodyFill: bodyPath ? bodyPath.getAttribute("fill") : null,
      bodyStroke: bodyPath ? bodyPath.getAttribute("stroke") : null,
      dLen: bodyPath ? (bodyPath.getAttribute("d") || "").length : 0,
      // 容器不得有背景图/背景色（旧版是蓝渐变底）
      containerBg: getComputedStyle(n).backgroundImage,
      containerBgColor: getComputedStyle(n).backgroundColor,
    };
  });
})()`;

(async () => {
  const b = await chromium.launch({ headless: true, args: ["--no-proxy-server"] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));

  // 隐藏 Next dev 浮层（它会吃掉指针事件）
  await page.addStyleTag?.({ content: "nextjs-portal{display:none!important}" }).catch(() => {});

  console.log("=== 登录 → 首页 ===");
  await login(page);
  await page.goto(WEB + "/", { waitUntil: "domcontentloaded" });
  await sleep(1200);

  const home = await page.evaluate(`(() => ({
    title: document.title,
    h: document.body.innerText,
    fp: ${GLYPH_FINGERPRINT},
  }))()`);

  check(`浏览器标题 = 「${PAGE_TITLE}」`, home.title.includes(BRAND) && home.title.includes(TAGLINE),
    home.title);
  check("首页有 Sunny logo", home.fp.length >= 1, `找到 ${home.fp.length} 个`);
  check("首页 logo 结构正确（1 有效路径 + 2 椭圆眼 + 4 圆）",
    home.fp.length >= 1 && home.fp[0].ok &&
    home.fp[0].ellipses === 2 && home.fp[0].circles === 4 && home.fp[0].paths === 2,
    JSON.stringify(home.fp[0] || {}));
  if (home.fp[0]?.ok) {
    check(`logo 填充 = 太阳黄 ${C.SUN}`, home.fp[0].bodyFill === C.SUN, home.fp[0].bodyFill);
    check(`logo 描边 = 深棕 ${C.OUTLINE}`, home.fp[0].bodyStroke === C.OUTLINE, home.fp[0].bodyStroke);
    check("logo 容器**无蓝渐变底**（旧版是蓝底白字）",
      !/gradient/.test(home.fp[0].containerBg) && home.fp[0].containerBgColor !== "rgb(47, 107, 255)",
      `bgImage=${home.fp[0].containerBg} bgColor=${home.fp[0].containerBgColor}`);
    check("logo 轮廓路径足够长（是真实图形，非占位）", home.fp[0].dLen > 500, `d 长度 ${home.fp[0].dLen}`);
  }
  check(`首页显示品牌字「${BRAND}」`, home.h.includes(BRAND));
  check(`首页副标题 =「${TAGLINE}」`, home.h.includes(TAGLINE));
  const homeLegacy = LEGACY.filter((w) => home.h.includes(w));
  check("首页无旧品牌残留（知库 / 文档知识库）", homeLegacy.length === 0, homeLegacy.join(", "));

  // ── 进知识库（顶栏 logo 所在）──
  console.log("\n=== 进入知识库 → 顶栏 ===");
  await page.goto(WEB + `/#/kb/${KB}`, { waitUntil: "domcontentloaded" });
  await sleep(1500);
  let kbState = await page.evaluate(`(() => ({
    h: document.body.innerText,
    fp: ${GLYPH_FINGERPRINT},
  }))()`);
  if (kbState.fp.length === 0) {
    // 兜底：点进第一张知识库卡片（记忆里记过：首页无搜索框，须先进知识库）
    const card = await page.$('[data-testid="kb-card"]');
    if (card) { await card.click(); await sleep(1500); }
    kbState = await page.evaluate(`(() => ({
      h: document.body.innerText, fp: ${GLYPH_FINGERPRINT},
    }))()`);
  }
  check("知识库视图有 logo", kbState.fp.length >= 1, `找到 ${kbState.fp.length} 个`);
  check("知识库顶栏品牌字 = Sunny", kbState.h.includes(BRAND));
  const kbLegacy = LEGACY.filter((w) => kbState.h.includes(w));
  check("知识库视图无旧品牌残留", kbLegacy.length === 0, kbLegacy.join(", "));

  // 知识库名（数据记录）──
  //
  // 🔴 **不要断言知识库名等于品牌名。** 知识库名是**用户自己的数据**，
  //    由用户按自己的内容命名（例如此库叫「云计算知识库」）。
  //    首版这里错写成「断言 name === Sunny」，把品牌改名强加到用户数据上 ——
  //    用户明确指出「知识库的名字不要改，要根据自己设定的知识库名字命名」。
  //    正确的断言是：**名字非空且未被品牌改名污染**（仍是用户自己的命名）。
  console.log("\n=== 知识库数据名（不得被品牌改名污染）===");
  const kbsResp = await page.evaluate(async ([api, token, kbId]) => {
    const r = await fetch(`${api}/api/v1/kbs`, { headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json();
    const list = j.kbs || j;
    const me = list.find((k) => k.id === kbId);
    return me ? { name: me.name, docCount: me.doc_count } : null;
  }, [API, TOKEN, KB]);
  check("知识库记录存在且名字非空",
    !!(kbsResp && kbsResp.name && kbsResp.name.trim()), JSON.stringify(kbsResp));
  check(`知识库名未被改成品牌名「${BRAND}」（应保持用户自己的命名）`,
    !!(kbsResp && kbsResp.name !== BRAND), kbsResp ? kbsResp.name : "");
  check("知识库仍有文档", !!(kbsResp && kbsResp.docCount > 0),
    kbsResp ? `doc_count=${kbsResp.docCount}` : "");

  // ── 明暗双主题 ──
  console.log("\n=== 双主题（走真实切换按钮）===");
  for (const want of ["dark", "light"]) {
    const btn = await page.$('button[aria-label="切换主题"]');
    if (!btn) { check(`找到主题切换按钮（目标 ${want}）`, false, "未找到按钮"); break; }
    for (let i = 0; i < 4; i++) {
      const cur = await page.evaluate(() => document.documentElement.dataset.theme);
      if (cur === want) break;
      await btn.click();
      await sleep(350);
    }
    const st = await page.evaluate(`(() => ({
      theme: document.documentElement.dataset.theme,
      fp: ${GLYPH_FINGERPRINT},
    }))()`);
    check(`已切到 ${want} 主题`, st.theme === want, st.theme);
    check(`${want} 主题下 logo 仍存在`, st.fp.length >= 1, `${st.fp.length} 个`);
    if (st.fp[0]?.ok) {
      check(`${want} 主题下 logo 描边色不变（透明底，随背景适配）`,
        st.fp[0].bodyStroke === C.OUTLINE, st.fp[0].bodyStroke);
    }
  }

  // ── 其余展示点：设置页 / 登录页 / AI 面板 ──
  console.log("\n=== 设置页（关于区）===");
  await page.goto(WEB + "/#/settings", { waitUntil: "domcontentloaded" });
  await sleep(1200);
  const settings = await page.evaluate(`(() => ({
    h: document.body.innerText, fp: ${GLYPH_FINGERPRINT},
  }))()`);
  check("设置页有 logo", settings.fp.length >= 1, `${settings.fp.length} 个`);
  check("设置页品牌字 = Sunny", settings.h.includes(BRAND));
  check("设置页无旧品牌残留",
    LEGACY.filter((w) => settings.h.includes(w)).length === 0,
    LEGACY.filter((w) => settings.h.includes(w)).join(", "));
  check("设置页描述文案保留（以文档为核心的私有知识库）",
    settings.h.includes("以文档为核心的私有知识库"));

  console.log("\n=== 登录页（未登录视图）===");
  const anon = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const loginPage = await anon.newPage();
  await loginPage.goto(WEB + "/", { waitUntil: "domcontentloaded" });
  await loginPage.evaluate(() => localStorage.removeItem("sunnydoc.token"));
  await loginPage.reload({ waitUntil: "domcontentloaded" });
  await sleep(1200);
  const loginState = await loginPage.evaluate(`(() => ({
    h: document.body.innerText, fp: ${GLYPH_FINGERPRINT},
  }))()`);
  check("登录页有 logo", loginState.fp.length >= 1, `${loginState.fp.length} 个`);
  check("登录页品牌字 = Sunny", loginState.h.includes(BRAND));
  check(`登录页副标题 =「${TAGLINE}」`, loginState.h.includes(TAGLINE));
  check("登录页无旧品牌残留",
    LEGACY.filter((w) => loginState.h.includes(w)).length === 0,
    LEGACY.filter((w) => loginState.h.includes(w)).join(", "));
  if (loginState.fp.length >= 2) {
    check("登录页两个展示点尺寸不同（左栏 40 / 兜底 56）",
      loginState.fp[0].w !== loginState.fp[1].w,
      loginState.fp.map((f) => f.w).join(" / "));
  }

  // ── favicon 资源 ──
  console.log("\n=== favicon 资源 ===");
  const appDir = path.join(REPO_ROOT, "web", "src", "app");
  check("icon.svg 存在", fs.existsSync(path.join(appDir, "icon.svg")));
  check("favicon.ico 存在（原先 /favicon.ico 是 404）",
    fs.existsSync(path.join(appDir, "favicon.ico")));
  const icoBuf = fs.existsSync(path.join(appDir, "favicon.ico"))
    ? fs.readFileSync(path.join(appDir, "favicon.ico")) : null;
  if (icoBuf) {
    const type = icoBuf.readUInt16LE(2), count = icoBuf.readUInt16LE(4);
    check("favicon.ico 是合法 ICO（type=1）且含多尺寸", type === 1 && count >= 2,
      `type=${type} count=${count}`);
  }
  // 真实 HTTP 可达性（这是原来 404 的那条路径）
  const icoHttp = await page.evaluate(async (web) => {
    const r = await fetch(web + "/favicon.ico");
    return { status: r.status, type: r.headers.get("content-type") || "" };
  }, WEB);
  check("HTTP /favicon.ico 可达（非 404）", icoHttp.status === 200,
    `status=${icoHttp.status} type=${icoHttp.type}`);

  // 静态扫描：浏览器断言查不到的漏法
  //
  // 🔴 为什么必须补这一节：本轮**独立复核**抓到了 3 类 DOM 断言永远发现不了的遗漏 ——
  //    ① `(kb.name || "知")` 这样的**兜底字**：只在名字为空时才渲染，
  //       正常数据下永不出现 → innerText 断言永远看不到，但代码里是旧品牌字。
  //    ② `apple-icon.png` 生成了却**没人引用**（layout 里 apple 仍指向 /icon.svg）。
  //    ③ 非默认视图（对话框/弹层）里的文案。
  //    ⇒ CSS/DOM 断言只能覆盖「当前渲染出来的东西」，**源码级残留必须静态扫**。
  console.log("\n=== 静态扫描（源码级品牌残留）===");
  const walkSrc = (dir, acc = []) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== "node_modules") walkSrc(p, acc);
      } else if (/\.(tsx|ts|css)$/.test(e.name)) {
        acc.push(p);
      }
    }
    return acc;   // 🔴 必须在 for 循环**之外**返回 —— 写在循环内会只扫第一个条目
  };
  const srcFiles = walkSrc(path.join(REPO_ROOT, "web", "src"));
  check("静态扫描覆盖到源文件（>50 个）", srcFiles.length > 50, `${srcFiles.length} 个`);

  const readAll = srcFiles.map((f) => ({ f, lines: fs.readFileSync(f, "utf8").split("\n") }));
  // ① 品牌名「知库」不得作为**界面文案**出现（「知识库」这个通用产品词是合法的，故精确匹配）
  const brandHits = [];
  readAll.forEach(({ f, lines }) => lines.forEach((l, i) => {
    if (/知库/.test(l)) brandHits.push(`${path.relative(REPO_ROOT, f)}:${i + 1} ${l.trim().slice(0, 70)}`);
  }));
  check("源码无「知库」品牌字（「知识库」通用词不算）", brandHits.length === 0, brandHits.join(" | "));

  // ② 不得再有 `"知"` 单字兜底（旧品牌遗留；用户数据首字用 kb.name.slice 是合法的）
  const fallbackHits = [];
  readAll.forEach(({ f, lines }) => lines.forEach((l, i) => {
    if (/['"]知['"]/.test(l)) fallbackHits.push(`${path.relative(REPO_ROOT, f)}:${i + 1} ${l.trim().slice(0, 70)}`);
  }));
  check("源码无 `\"知\"` 单字兜底（旧品牌遗留）", fallbackHits.length === 0, fallbackHits.join(" | "));

  // ③ 不得再有 JSX 文本节点 `>知<`
  const textHits = [];
  readAll.forEach(({ f, lines }) => lines.forEach((l, i) => {
    if (/>知</.test(l)) textHits.push(`${path.relative(REPO_ROOT, f)}:${i + 1} ${l.trim().slice(0, 70)}`);
  }));
  check("源码无「知」字 JSX 文本节点", textHits.length === 0, textHits.join(" | "));

  // ④ apple-icon.png 必须被 layout 真正引用（生成物没接线 = 白生成）
  const layoutSrc = fs.readFileSync(path.join(REPO_ROOT, "web", "src", "app", "layout.tsx"), "utf8");
  check("layout.tsx 引用了 apple-icon.png", layoutSrc.includes("apple-icon.png"));
  check("layout.tsx 显式声明 favicon.ico（老浏览器/爬虫只请求该路径）",
    layoutSrc.includes("favicon.ico"));

  // 🔴 输出格式必须含「全部通过」—— runner（run_all_verify.cjs）正是按这个字符串
  //    判定成功的（见其 `/全部通过|ALL PASS/.test(out)`）。只打印「通过 N / 失败 0」
  //    会被判为「退出码 0 但未见『全部通过』」→ **假失败**（本轮踩过）。
  console.log(`\n通过 ${pass} / 失败 ${fail}`);
  console.log(fail === 0 ? "✅ 全部通过" : "❌ 存在失败项");
  if (errors.length) console.log("  页面 JS 错误: " + errors.slice(0, 3).join(" | "));
  await b.close();
  process.exit(fail ? 1 : 0);
})();