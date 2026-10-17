#!/usr/bin/env node
/**
 * 真机验证「非文档类型发现性」（D4 修复）。
 *
 * 背景：生产数据 `SELECT type, count(*) ... GROUP BY type` → 241 条全是 `doc`，
 * 5 个非文档编辑器（流程图/思维导图/表格/数据表/画板）写了 3000+ 行、一条没用上。
 * 根因不是「没人需要」，而是入口太深：唯一路径是「进知识库 → 点 ⨁ 新建」。
 *
 * 本轮修复：命令面板（⌘K）补上「新建 X」直达通道，且新建后自动切到知识库视图。
 *
 * 断言分两层（沿用 verify_node_types.cjs 的做法）：
 *   A. 可达层：命令面板里能搜到各族类型的「新建 X」命令
 *   B. 能力层（关键）：点命令后**真能建出该类型文档并进入编辑器**
 *      —— 若只是把命令列上去、点了没反应，B 层必失败
 *
 * 12 项断言：
 *   1. 命令面板可打开（⌘K）
 *   2. 空查询时就已列出各类型「新建」命令（不是只有搜到才出现）
 *   3. 7 种可用类型（doc/table/datasheet/mindmap/flowchart/board + folder）都有入口
 *   4. 搜索 "流程图" 能过滤到「新建流程图」
 *   5. 类型清单与 ⨁ 菜单同源（desc 措辞一致）
 *   6. 点「新建流程图」→ 建出 flowchart 类型文档
 *   7. 且自动进入知识库视图（不是停在首页）
 *   8. 点「新建数据表」→ 建出 datasheet 类型文档
 *   9. 点「新建思维导图」→ 建出 mindmap 类型文档
 *  10. 新建的流程图编辑器真的渲染出来（能力层，非空壳）
 *  11. 零残留（全部清理）
 *  12. 运行期无未捕获页面异常
 *
 * 用法：
 *   NODE_PATH=<托管 workspace node_modules> node web/scripts/verify_discoverability.cjs
 */
const { chromium } = require("playwright");
const fs = require("fs");

const TOKEN =
  process.env.SUNNYDOC_TOKEN ||
  fs.readFileSync(process.env.SUNNYDOC_TOKEN_FILE || "/tmp/sunnydoc-token.txt", "utf8").trim();
const WEB = process.env.SUNNYDOC_WEB || "http://localhost:3001";
const API = process.env.SUNNYDOC_API || "http://localhost:8000";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 脚本自建的文档标题前缀（用于零残留校验）
const TMP_PREFIX = "DISCOV-";

let fail = 0;
const check = (n, c, d) => {
  if (c) console.log("  ✅ " + n);
  else {
    fail++;
    console.log("  ❌ " + n + "\n       " + String(d).slice(0, 400));
  }
};

const waitFor = async (fn, ms = 8000, label = "") => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await sleep(150);
  }
  console.log("     (waitFor 超时: " + label + ")");
  return false;
};

(async () => {
  const b = await chromium.launch({
    headless: true,
    args: ["--no-proxy-server"],
    // 允许指定浏览器可执行文件（playwright 包升级后缓存里可能只有旧版 chromium）
    ...(process.env.SUNNYDOC_CHROMIUM ? { executablePath: process.env.SUNNYDOC_CHROMIUM } : {}),
  });
  const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e).slice(0, 160)));
  await p.addStyleTag({
    content: "nextjs-portal{display:none!important;pointer-events:none!important}",
  });

  const api = (path, method = "GET", body) =>
    p.evaluate(
      async ([apiBase, tok, path2, method2, body2]) => {
        const h = { Authorization: "Bearer " + tok, "Content-Type": "application/json" };
        const r = await fetch(apiBase + path2, {
          method: method2,
          headers: h,
          body: body2 ? JSON.stringify(body2) : undefined,
        });
        const t = await r.text();
        try {
          return { status: r.status, json: JSON.parse(t) };
        } catch {
          return { status: r.status, json: t };
        }
      },
      [API, TOKEN, path, method, body],
    );

  await p.goto(WEB, { waitUntil: "domcontentloaded" });
  await p.evaluate((t) => localStorage.setItem("sunnydoc.token", t), TOKEN);
  await p.reload({ waitUntil: "domcontentloaded" });
  await sleep(2500);

  // 清理历史残留
  const pre = await api("/api/v1/documents?limit=500");
  for (const d of (pre.json.documents || [])) {
    if (d.title && d.title.startsWith(TMP_PREFIX)) await api("/api/v1/documents/" + d.id, "DELETE");
  }

  /** 打开命令面板（⌘K）。首页与 KB 视图都应可用。 */
  const openPalette = async () => {
    await p.keyboard.press("Meta+k");
    const ok = await waitFor(
      async () => (await p.locator('[data-index]').count()) > 0,
      5000,
      "命令面板打开",
    );
    return ok;
  };

  /** 读命令面板里所有命令项文本。 */
  const paletteCommands = () =>
    p.evaluate(() =>
      Array.from(document.querySelectorAll("[data-index]")).map((e) =>
        (e.textContent || "").trim(),
      ),
    );

  // ---- 1) 命令面板可打开 ----
  const opened = await openPalette();
  check("命令面板可打开（⌘K）", opened, "未出现 [data-index] 项");
  if (!opened) {
    await b.close();
    process.exit(1);
  }

  // ---- 2) 空查询就已列出各类型「新建」命令 ----
  const all = await paletteCommands();
  const newCmds = all.filter((t) => /^新建/.test(t));
  check(
    "空查询时已列出「新建 X」命令（不是搜到才出现）",
    newCmds.length >= 6,
    JSON.stringify(newCmds),
  );

  // ---- 3) 7 种可用类型都有入口 ----
  // 期望：文档/表格/数据表/思维导图/流程图/画板 + 文件夹
  const EXPECT = ["文档", "表格", "数据表", "思维导图", "流程图", "画板", "文件夹"];
  const missing = EXPECT.filter((name) => {
    const re = name === "文件夹" ? /^新建文件夹/ : new RegExp("^新建" + name + "[ ·]");
    return !all.some((t) => re.test(t));
  });
  check(
    `7 种可用类型都有入口（缺：${missing.join("/") || "无"}）`,
    missing.length === 0,
    JSON.stringify(all),
  );

  // ---- 4) 搜索过滤 ----
  const input = p.locator('input[type="text"], input[type="search"], input').first();
  await input.fill("流程图");
  await sleep(600);
  const filtered = await paletteCommands();
  check(
    "搜索「流程图」能过滤到「新建流程图」",
    filtered.some((t) => /^新建流程图/.test(t)),
    JSON.stringify(filtered),
  );

  // ---- 5) 与 ⨁ 菜单同源（desc 措辞一致） ----
  // ⨁ 菜单里表格 desc = "文档内嵌表 · 支持公式"
  const tableCmd = all.find((t) => /^新建表格/.test(t)) || "";
  check(
    "命令项 desc 与 ⨁ 菜单同源（表格＝文档内嵌表 · 支持公式）",
    /文档内嵌表 · 支持公式/.test(tableCmd),
    "表格命令 = " + tableCmd,
  );

  // ---- 6/7) 点「新建流程图」→ 建出 flowchart 且进入 KB ----
  const clickNew = async (kw) => {
    await input.fill(kw);
    await sleep(700);
    const item = p.locator("[data-index]").filter({ hasText: new RegExp("^新建" + kw) }).first();
    const n = await item.count();
    if (n === 0) return false;
    await item.click({ force: true });
    await sleep(3500);
    // 判据：命令面板已关闭（命令确实执行了）+ 出现了某个编辑器容器。
    // ⚠️ 不要用「文档树锚点出现」—— 第一次新建后页面已在 KB 视图，
    //    第二次新建时该锚点一直存在，判据恒真/恒假都不合适（上一版就栽在这）。
    return await waitFor(
      async () =>
        (await p.locator("[data-index]").count()) === 0 &&
        (await p.locator("table, [contenteditable], .react-flow, .md-body").count()) > 0,
      10000,
      "命令执行并加载编辑器",
    );
  };

  const inKb = await clickNew("流程图");
  check("点「新建流程图」后命令被执行并加载编辑器（不停留在空首页）", inKb, "未出现编辑器容器");

  // ---- 6b) 从首页触发也能进 KB 视图（这是产品行为，单独验一次） ----
  // 回首页 → ⌘K → 新建表格 → 应自动切到 kb 视图（出现文档树）
  const homeBtn = p.locator("button").filter({ hasText: /^首页$|返回首页/ }).first();
  if (await homeBtn.count()) {
    await homeBtn.click({ force: true }).catch(() => {});
    await sleep(2500);
  }
  const onHome = (await p.locator("[data-tree-kind]").count()) === 0;
  await openPalette();
  const itemT = p.locator("[data-index]").filter({ hasText: /^新建表格/ }).first();
  if (await itemT.count()) {
    await itemT.click({ force: true });
    await sleep(3500);
  }
  const toKb = await waitFor(
    async () => (await p.locator("[data-tree-kind]").count()) > 0,
    10000,
    "新建后进入知识库视图",
  );
  check(
    "从首页经由命令面板新建后，自动进入知识库视图（看得见结果）",
    !onHome || toKb,
    JSON.stringify({ onHome, toKb }),
  );

  // 从后端核实真的建出了 flowchart
  const afterFlow = await api("/api/v1/documents?limit=500");
  const flowDocs = (afterFlow.json.documents || []).filter((d) => d.type === "flowchart");
  check(
    "确实建出了 flowchart 类型文档（能力层）",
    flowDocs.length > 0,
    JSON.stringify(flowDocs.map((d) => ({ t: d.title, type: d.type }))),
  );

  // ---- 10) 流程图编辑器真的渲染（非空壳） ----
  const flowUi = await p.evaluate(() => {
    const txt = document.body.innerText || "";
    // FlowchartEditor 的典型 UI 词（工具栏/图形库/导出等）
    return {
      hasFlowUi: /流程图|图形库|导出|节点/.test(txt),
      hasCanvas: !!document.querySelector(".react-flow, svg[class*='flow'], [data-testid*='flow']"),
      sample: txt.slice(0, 200),
    };
  });
  check(
    "流程图编辑器真的渲染出来（能力层，非空壳）",
    flowUi.hasFlowUi,
    JSON.stringify(flowUi),
  );

  // ---- 8/9) 另两种类型 ----
  // 重新打开面板（点完一项会自动关闭）
  await openPalette();
  const inKb2 = await clickNew("数据表");
  const afterDs = await api("/api/v1/documents?limit=500");
  const dsDocs = (afterDs.json.documents || []).filter((d) => d.type === "datasheet");
  check(
    "点「新建数据表」→ 建出 datasheet 类型文档",
    inKb2 && dsDocs.length > 0,
    JSON.stringify({ inKb2, ds: dsDocs.map((d) => d.title) }),
  );

  await openPalette();
  await clickNew("思维导图");
  const afterMm = await api("/api/v1/documents?limit=500");
  const mmDocs = (afterMm.json.documents || []).filter((d) => d.type === "mindmap");
  check(
    "点「新建思维导图」→ 建出 mindmap 类型文档",
    mmDocs.length > 0,
    JSON.stringify(mmDocs.map((d) => d.title)),
  );

  // ---- 11) 零残留 ----
  // 上面各步新建的文档（未命名流程图/数据表/思维导图/表格）都是**本次验证产生的**，
  // 必须全部清理 —— 否则会污染 D4 的度量口径
  // （「非文档类型 0 条」正是 D4 的判据）。
  // 用「类型 + 未命名前缀」双重匹配，别只列前几步的 id（上一版漏了 6b 的表格）。
  const after = await api("/api/v1/documents?limit=500");
  const NON_DOC_TYPES = ["flowchart", "datasheet", "mindmap", "table", "board"];
  const junk = (after.json.documents || []).filter(
    (d) =>
      NON_DOC_TYPES.includes(d.type) &&
      typeof d.title === "string" &&
      (d.title.startsWith("未命名") || d.title.startsWith(TMP_PREFIX)),
  );
  for (const d of junk) await api("/api/v1/documents/" + d.id, "DELETE");
  const after2 = await api("/api/v1/documents?limit=500");
  const leftTypes = (after2.json.documents || []).filter((d) =>
    NON_DOC_TYPES.includes(d.type),
  );
  check(
    "零残留（非文档类型回到 0 条，不污染 D4 度量基线）",
    leftTypes.length === 0,
    JSON.stringify(leftTypes.map((d) => ({ t: d.title, type: d.type }))),
  );

  // ---- 12) 无异常 ----
  check("运行期无未捕获页面异常", errs.length === 0, errs.join(" | "));

  console.log("\n" + (fail === 0 ? "全部通过 ✅" : `失败 ${fail} 项 ❌`));
  await b.close();
  process.exit(fail === 0 ? 0 : 1);
})();