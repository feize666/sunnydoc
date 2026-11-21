#!/usr/bin/env node
/**
 * 第一轮 UI 改造护栏：可发现性 + 导出
 *
 * ## 为什么需要它
 *
 * 这一轮改的都是「功能本来就有，但用户找不到 / 用了会出错」的东西。
 * 它们没有任何单测能覆盖：
 *   - 树行按钮的 `aria-label`：删掉也能跑，只是屏幕阅读器读不到
 *   - 当前行按钮常显：改回 `reveal-on-hover` 也不报错，只是看不见
 *   - 折叠持久化：不落盘时表现为"刷新后位置丢失"，没人会报 bug
 *   - 导出按目录：**过滤失效时导出的是全库**（实测 27 篇 vs 254 篇），
 *     用户只会觉得"文件有点大"，不会发现拿错了内容
 *   - 导出媒体：**按目录导出 21 篇却打包 515MB**（整个实例的图片）
 *
 * ## 判据（四组）
 *
 * A. 可发现性：树行按钮有可读名、当前行按钮常显
 * B. 折叠持久化：点开目录 → 刷新 → 仍是展开
 * C. 导出范围：4 档齐全（文档有目录时才有「当前目录」）
 * D. 导出正确性：按目录导出的文档数 ≈ 该子树文档数（不是全库）；
 *    zip 体积与该目录实际引用的媒体量相当（不是全库 524MB）
 *
 * ## 已知的设计意图（勿改）
 *
 * - 「当前目录」只在**打开一篇有 folder_id 的文档**时出现。
 *   254 篇里 238 篇有目录，剩下 16 篇是根级文档，此时不显示是对的。
 * - 树行按钮只在**当前打开那一行**常显，其余行悬停才出现 ——
 *   全部常显会让 253 行 × 3 个按钮变成一片图标墙。
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const API = "http://127.0.0.1:8000";
const WEB = "http://localhost:3001";
const TOKEN = fs.readFileSync("/tmp/sunnydoc-token.txt", "utf8").trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0,
  fail = 0;
function check(name, ok, extra = "") {
  console.log(`  ${ok ? "✅" : "❌"} ${name}${extra ? "  " + extra : ""}`);
  ok ? pass++ : fail++;
}

async function api(p, method = "GET", body) {
  const r = await fetch(API + "/api/v1" + p, {
    method,
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + TOKEN },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  try {
    return { s: r.status, j: JSON.parse(t) };
  } catch {
    return { s: r.status, j: { raw: t.slice(0, 200) } };
  }
}

(async () => {
  console.log("=== 第一轮 UI 改造护栏 ===");

  // ---------- 准备：找一个有文档的目录 ----------
  const fRes = await api("/folders");
  const folders = fRes.j.folders || [];
  const dRes = await api("/documents?limit=1000");
  const docs = dRes.j.documents || [];
  const total = docs.length;

  const byFolder = {};
  docs.forEach((d) => {
    if (d.folder_id) byFolder[d.folder_id] = (byFolder[d.folder_id] || 0) + 1;
  });
  const target = folders
    .map((f) => ({ f, n: byFolder[f.id] || 0 }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)[0];

  // 取一篇**确实在目录里**的文档做 UI 定位靶子。
  // 只看缩进不够：深层目录的行也有缩进，而那篇可能是根级文档。
  // 用 API 给的 folder_id 才能确保「当前目录」应该出现。
  const inFolderDoc = target ? docs.find((d) => d.folder_id === target.f.id) : null;

  check(`库里有可导出目录（${target ? target.f.name + " " + target.n + " 篇" : "无"}）`, !!target);

  // ---------- D. 导出正确性（API 层，先跑：不依赖 UI） ----------
  if (target) {
    const sub = await api("/export", "POST", { format: "json", folder_id: target.f.id });
    const arr = Array.isArray(sub.j) ? sub.j : sub.j.documents || [];
    check(
      `按目录导出只含该子树（${arr.length} 篇，全库 ${total} 篇）`,
      arr.length > 0 && arr.length < total,
      `${arr.length} / ${total}`,
    );

    // zip 体积：必须与该目录量级相当，不能是全库
    const zr = await fetch(API + "/api/v1/export", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + TOKEN },
      body: JSON.stringify({ format: "zip", folder_id: target.f.id }),
    });
    const buf = Buffer.from(await zr.arrayBuffer());
    const mb = buf.length / 1024 / 1024;
    check(
      `按目录 zip 体积合理（${mb.toFixed(1)} MB < 150MB）`,
      mb < 150,
      `🔴 超过说明媒体又变成「整个 MEDIA_DIR 无差别打包」（实测踩过 515MB）`,
    );

    // 反向：外部人 / 不存在的目录必须被拒
    const bad = await api("/export", "POST", { format: "json", folder_id: "nonexistent-folder-id" });
    check(`不存在的目录被拒（${bad.s}）`, bad.s === 404, `返回 ${bad.s}`);
  }

  // ---------- UI 部分 ----------
  const b = await chromium.launch({ headless: true, args: ["--no-proxy-server"] });
  const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 }, locale: "zh-CN" });
  const p = await ctx.newPage();
  await p.addInitScript((t) => localStorage.setItem("sunnydoc.token", t), TOKEN);
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e).slice(0, 140)));

  await p.goto(WEB + "/", { waitUntil: "domcontentloaded" });
  await sleep(3600);
  await p.addStyleTag({
    content: "nextjs-portal{display:none!important;pointer-events:none!important}",
  });
  await p.locator('[data-testid="kb-card"]').first().click();
  for (let i = 0; i < 40; i++) {
    if (await p.evaluate(() => document.querySelectorAll("[data-tree-kind]").length > 0)) break;
    await sleep(300);
  }
  await sleep(900);

  // ---------- A. 可发现性 ----------
  const a = await p.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('[data-tree-kind="doc"]')).slice(0, 6);
    const btns = [];
    rows.forEach((r) =>
      r.querySelectorAll("button").forEach((x) =>
        btns.push({ aria: x.getAttribute("aria-label") || "", title: x.getAttribute("title") || "" }),
      ),
    );
    return { total: btns.length, noName: btns.filter((x) => !x.aria && !x.title).length };
  });
  check(`树行按钮都有可读名（${a.total} 个，无名称 ${a.noName} 个）`, a.total > 0 && a.noName === 0);

  // 打开一篇**有目录**的文档（这样「当前目录」才会出现）
  await p.locator('[data-tree-kind="folder"]:visible').first().locator("button.flex-1").first().click();
  await sleep(800);
  const subRows = p.locator('[data-tree-kind="doc"]:visible');
  const hasSub = (await subRows.count()) > 0;
  if (hasSub) {
    await subRows.first().click();
    await sleep(2600);
  }

  const bst = await p.evaluate(() => {
    const active = document.querySelector('[data-tree-kind="doc"].bg-accent-soft');
    if (!active) return null;
    return Array.from(active.querySelectorAll("button")).map((x) => getComputedStyle(x).opacity);
  });
  check(
    `当前行操作按钮常显（${bst ? bst.filter((o) => o === "1").length + "/" + bst.length : "无高亮行"}）`,
    !!bst && bst.filter((o) => o === "1").length >= 2,
  );

  // ---------- B. 折叠持久化 ----------
  const openBefore = await p.evaluate(() => {
    const f = document.querySelector('[data-tree-kind="folder"]');
    return f ? f.getAttribute("data-open") : null;
  });
  await p.reload({ waitUntil: "domcontentloaded" });
  await sleep(4200);
  const openAfter = await p.evaluate(() => {
    const f = document.querySelector('[data-tree-kind="folder"]');
    return f ? f.getAttribute("data-open") : null;
  });
  check(
    `刷新后折叠状态保持（${openBefore} → ${openAfter}）`,
    openBefore !== null && openBefore === openAfter,
    "不落盘时表现为「刷新后位置丢失」",
  );

  // ---------- C. 导出范围 ----------
  // 刷新后要重新进库
  await p.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('[data-testid="kb-card"]'));
    if (cards.length) cards[0].click();
  });
  for (let i = 0; i < 40; i++) {
    if (await p.evaluate(() => document.querySelectorAll("[data-tree-kind]").length > 0)) break;
    await sleep(300);
  }
  await sleep(900);
  await p.locator('[data-tree-kind="folder"]:visible').first().locator("button.flex-1").first().click();
  await sleep(1000);

  // 展开**目标目录本身**（不是"第一个可见的"）：
  // 第一个可见目录未必是 inFolderDoc 所在的目录，那样下面的
  // `data-tree-key` 定位必然落空 —— 表现为「找到目录内文档 = null」。
  if (target) {
    const tf = p.locator(`[data-tree-key="${target.f.id}"]`).first();
    if ((await tf.count()) > 0) {
      const open = await tf.getAttribute("data-open");
      if (open !== "1") {
        await tf.locator("button.flex-1").first().click();
        await sleep(1000);
      }
    }
  }

  // 🔴 必须取**目录内部**的文档，不能用全局第一个。
  //    树里同时存在「根级文档」（folder_id=null）与「目录内文档」，
  //    全局第一个可能是根级文档 —— 它本来就没有目录，
  //    「当前目录」不出现是**正确行为**，按它判会让断言假失败。
  //    取法：从已展开的 folder 行往后走，找第一个 doc 行。
  // 用 `data-tree-key`（文档 id）定位，不用标题文本匹配：
  // 标题可能含引号/括号/斜杠，拼进 CSS 选择器会失效；
  // id 是安全字符，且树行本来就带这个属性。
  const picked = inFolderDoc
    ? await (async () => {
        const row = p.locator(`[data-tree-key="${inFolderDoc.id}"]`).first();
        if ((await row.count()) === 0) return null;
        await row.click();
        return inFolderDoc.title.slice(0, 24);
      })()
    : await p.evaluate(() => {
    // 目录内的文档有两个特征：① paddingLeft 比顶级目录大（缩进）
    // ② 它前面最近的 folder 行是展开的。
    // 直接按"缩进最深"取最稳 —— 树是递归嵌套渲染的，
    // DOM 顺序里 folder 后面紧跟的不一定是它的子文档（可能是兄弟目录）。
    const folders = [...document.querySelectorAll('[data-tree-kind="folder"]')];
    const basePad = Math.min(
      ...folders.map((f) => parseFloat(getComputedStyle(f).paddingLeft) || 999),
    );
    const docs = [...document.querySelectorAll('[data-tree-kind="doc"]')].filter((d) => {
      const pad = parseFloat(getComputedStyle(d).paddingLeft) || 0;
      return pad > basePad; // 有缩进 = 在某目录里
    });
    if (!docs.length) return null;
    docs[0].click();
    return (docs[0].innerText || "").trim().slice(0, 24);
  });
  check(`找到目录内文档（${picked}）`, !!picked, "目录内没有文档则无法验证「当前目录」");
  await sleep(2600);

  // 「当前目录」依赖文档真的有 folder_id。视觉缩进 ≠ 一定在目录里
  // （深层嵌套目录的行也有缩进），所以按**实际层级行**确认，
  // 没有层级的换一篇，最多试 4 篇。
  let layered = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    const loc = await p.evaluate(() => {
      const h1 = document.querySelector("h1");
      const p2 = h1 ? h1.parentElement.querySelector("p") : null;
      return p2 ? p2.innerText.replace(/\s+/g, " ") : "";
    });
    if (loc.includes("›")) {
      layered = true;
      break;
    }
    const moved = await p.evaluate(() => {
      const folders = [...document.querySelectorAll('[data-tree-kind="folder"]')];
      const basePad = Math.min(...folders.map((f) => parseFloat(getComputedStyle(f).paddingLeft) || 999));
      const docs = [...document.querySelectorAll('[data-tree-kind="doc"]')].filter(
        (d) => (parseFloat(getComputedStyle(d).paddingLeft) || 0) > basePad,
      );
      const active = docs.findIndex((d) => d.className.includes("bg-accent-soft"));
      const next = docs[active + 1] || docs[0];
      if (!next) return false;
      next.click();
      return true;
    });
    if (!moved) break;
    await sleep(2400);
  }
  check("打开的文档有层级信息（标题下方出现 ›）", layered, "没有则「当前目录」不会出现，这是正确的降级");
  // 2026-11-21 侧栏把「导出」收进了「更多」下拉（头部 175→133px），
  // 原来按精确文案找按钮会落空。改为：先点「更多」，再点菜单里的「导出文档」。
  const clicked = await p.evaluate(() => {
    const more = document.querySelector('[data-testid="sidebar-more"]');
    if (more) {
      more.click();
      return { ok: true, via: "more" };
    }
    // 兜底：老布局里侧栏有常显的「导出」按钮
    const btns = [...document.querySelectorAll("button")].filter((x) => x.offsetParent !== null);
    const x = btns.find((y) => (y.innerText || "").trim() === "导出");
    if (!x) return { ok: false, visible: btns.map((b) => (b.innerText || "").trim()).slice(0, 12) };
    x.click();
    return { ok: true, via: "direct" };
  });
  if (clicked.via === "more") {
    await sleep(500);
    await p.evaluate(() => {
      const item = document.querySelector('[data-testid="sidebar-more-export"]');
      if (item) item.click();
    });
  }
  await sleep(1200);
  const dlgOpen = await p.evaluate(() => !!(document.body.innerText || "").includes("导出范围"));
  if (!clicked.ok || !dlgOpen) {
    console.log(`  ⚠️ 导出框未打开（clicked=${JSON.stringify(clicked).slice(0, 160)} dlg=${dlgOpen}）`);
  }
  // ⚠️ 不能用 document.body.innerText 模糊匹配：
  //    「当前文档」这几个字在导出框打开前就可能出现在别处（页面正文/侧栏），
  //    模糊匹配会在框没打开时也判"通过"，反过来也会因为取到整页文本而误判。
  //    判据必须是**导出对话框内部**的按钮，且按精确文案比对。
  const scopes = await p.evaluate(() => {
    // 对话框 = 含「导出范围」标签的那个 panel
    const panel = [...document.querySelectorAll("div")].find(
      (d) =>
        (d.className || "").includes("dialog-panel") ||
        (d.getAttribute("role") === "dialog" && (d.innerText || "").includes("导出范围")),
    );
    const scope = panel || document.body;
    return [...scope.querySelectorAll("button")]
      .map((x) => (x.innerText || "").trim())
      .filter((t) => ["当前文档", "当前目录", "全部文档", "整个知识库"].includes(t));
  });
  check(
    `导出范围四档齐全（${scopes.join(" / ")}）`,
    scopes.length === 4,
    "文档有 folder_id 时应含「当前目录」",
  );

  console.log(`\n页面错误: ${errs.length ? errs.join(" | ") : "无"}`);
  await b.close();

  // runner 认的是「全部通过 / ALL PASS」这两个字样（run_all_verify.cjs:64）。
  // 只写「通过 N / 失败 0」会被判成「退出码 0 但未见全部通过」= 失败，
  // 即使实际全绿 —— 这是回归里最容易踩的格式坑。
  console.log(`\n通过 ${pass} / 失败 ${fail}`);
  console.log(fail === 0 ? "✅ 全部通过" : "❌ 存在失败项");
  process.exit(fail === 0 ? 0 : 1);
})();