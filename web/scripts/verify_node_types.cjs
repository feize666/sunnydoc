#!/usr/bin/env node
/**
 * 真机验证「表格 / 数据表 分工清晰」（P1-2 / 缺陷 D3）。
 *
 * 核心主张：菜单文案必须让人一眼分清两者，**且文案不得与真实能力脱节**。
 * 因此断言分两层：
 *   A. 文案层：两个 desc 不相同、且分别写出各自独有能力词
 *   B. 能力层（关键）：真机建出两类文档，验证
 *      - 表格确实有公式能力（=SUM 提示可见）
 *      - 数据表确实有列类型与筛选
 *      —— 若只刷文案而能力不匹配，B 层必失败。
 *
 * 8 项断言：
 *   1. 「+ 新建」菜单可打开
 *   2. 「表格」「数据表」desc 互不相同（不是同义反复）
 *   3. 表格 desc 含「内嵌」或「公式」等表专用词
 *   4. 数据表 desc 含「列类型」或「筛选」等数据表专用词
 *   5. 两类卡片 desc 均单行（不换行撑高网格）
 *   6. 建出的「表格」文档编辑器含 =SUM 公式提示（能力与文案一致）
 *   7. 建出的「数据表」文档编辑器含列类型选择（能力与文案一致）
 *   8. 零残留
 *
 * 用法：
 *   NODE_PATH=<托管 workspace node_modules> node web/scripts/verify_node_types.cjs
 */
const { chromium } = require("playwright");
const fs = require("fs");

const TOKEN =
  process.env.SUNNYDOC_TOKEN ||
  fs.readFileSync(process.env.SUNNYDOC_TOKEN_FILE || "/tmp/sunnydoc-token.txt", "utf8").trim();
const WEB = process.env.SUNNYDOC_WEB || "http://localhost:3001";
const API = process.env.SUNNYDOC_API || "http://localhost:8000";
const KB = "fdef57f179384d679b62a3c4bae2d2e3"; // 云计算知识库
const T1 = "NT-表格-临时";
const T2 = "NT-数据表-临时";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fail = 0;
const check = (n, c, d) => {
  if (c) console.log("  ✅ " + n);
  else {
    fail++;
    console.log("  ❌ " + n + "\n       " + String(d).slice(0, 300));
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
  const b = await chromium.launch({ headless: true, args: ["--no-proxy-server"] });
  const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e).slice(0, 160)));
  await p.addStyleTag({
    content: "nextjs-portal{display:none!important;pointer-events:none!important}",
  });

  const api = (path, method = "GET", body) =>
    p.evaluate(
      async ([apiBase, tok, path, method, body]) => {
        const h = { Authorization: "Bearer " + tok, "Content-Type": "application/json" };
        const r = await fetch(apiBase + path, {
          method,
          headers: h,
          body: body ? JSON.stringify(body) : undefined,
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

  // 清理旧夹具
  const pre = await api("/api/v1/documents");
  for (const d of (pre.json.documents || [])) {
    if (d.title === T1 || d.title === T2) await api("/api/v1/documents/" + d.id, "DELETE");
  }

  // 进知识库：用 data-testid 锚点，不靠文案匹配
  // （实测教训：filter({hasText}) 会命中侧栏/标题里同名的不可见按钮，
  //   点了等于没点，页面停在首页 HomeView —— 症状是"文档打不开"）
  const kbCard = p.locator('[data-testid="kb-card"]').filter({ hasText: "云计算知识库" }).first();
  if (await kbCard.count()) {
    await kbCard.click({ force: true });
  } else {
    // 兜底：首页可能没有该卡片（已在 KB 视图），直接用文案
    const kb = p.locator('[data-testid="kb-card"]').filter({ hasText: "云计算知识库" }).first();
    if (await kb.count()) await kb.click({ force: true });
  }
  await sleep(3000);
  // 判据必须绑定「确实进入了 KB 视图」：出现文档树锚点
  const inKb = await waitFor(
    async () => (await p.locator("[data-tree-kind]").count()) > 0,
    10000,
    "进入知识库视图（出现文档树）",
  );
  check("已进入知识库视图（文档树出现）", inKb, "文档树锚点数为 0");

  // ---- 1) 打开「+ 新建」菜单 ----
  // 侧栏头部「新建」按钮（有 onNew 时出现）；用 title/aria 定位更稳
  const newBtn = p
    .locator("button[title='新建子文档'], button[title='新建'], button")
    .filter({ hasText: /^新建$/ })
    .first();
  let opened = false;
  if (await newBtn.count()) {
    await newBtn.click({ force: true }).catch(() => {});
    opened = await waitFor(
      async () => (await p.locator("[data-portal-menu]").count()) > 0,
      5000,
      "新建菜单",
    );
  }
  check("「新建」菜单可打开", opened, "未找到可点击的新建按钮");
  if (!opened) {
    // 兜底：直接读组件源码常量不可行，改为 API 层断言（文案层跳过但能力层保留）
    console.log("     (菜单打不开，改用 API 层完成能力验证)");
  }

  // ---- 2/3/4/5) 文案层 ----
  if (opened) {
    const descs = await p.evaluate(() => {
      const items = Array.from(document.querySelectorAll("[data-portal-menu] button"));
      const out = {};
      for (const it of items) {
        const label = it.querySelector("span.text-\\[14px\\]")?.textContent?.trim();
        const desc = it.querySelector("span.text-\\[11px\\]")?.textContent?.trim();
        const span = it.querySelector("span.block.truncate");
        if (label) out[label] = { desc, truncate: !!span };
      }
      return out;
    });
    const tableDesc = descs["表格"]?.desc || "";
    const dsDesc = descs["数据表"]?.desc || "";
    check("「表格」与「数据表」desc 互不相同（非同义反复）", !!tableDesc && !!dsDesc && tableDesc !== dsDesc, JSON.stringify({ tableDesc, dsDesc }));
    check(
      "表格 desc 写出表专用能力（内嵌/公式）",
      /内嵌|公式/.test(tableDesc),
      "表格 desc = " + tableDesc,
    );
    check(
      "数据表 desc 写出数据表专用能力（列类型/筛选）",
      /列类型|筛选/.test(dsDesc),
      "数据表 desc = " + dsDesc,
    );
    check(
      "两类 desc 均限单行（decls 有 truncate 类）",
      descs["表格"]?.truncate === true && descs["数据表"]?.truncate === true,
      JSON.stringify(descs),
    );
// 关闭菜单：ESC（产品已支持 —— 本轮同时修了 NewNodeMenu/TreeNodeMenu
    // 缺 ESC 的可用性缺陷：原来只能点遮罩，键盘用户关不掉且残留遮罩吞点击）
    await p.keyboard.press("Escape");
    const escClosed = await waitFor(
      async () => (await p.locator("[data-portal-menu]").count()) === 0,
      3000,
      "新建菜单已关闭（ESC）",
    );
    check("新建菜单支持 ESC 关闭（键盘可达）", escClosed, "ESC 未能关闭菜单");
    await sleep(300);
  }

  // ---- 6/7) 能力层：建出两类文档，验证能力与文案一致 ----
  const c1 = await api("/api/v1/documents", "POST", { title: T1, content: "", type: "table", kb_id: KB });
  const c2 = await api("/api/v1/documents", "POST", { title: T2, content: "", type: "datasheet", kb_id: KB });
  check("两类文档均已创建", c1.status === 200 && c2.status === 200, `t1=${c1.status} t2=${c2.status}`);

  // 打开文档：用文档树锚点精确点击（文档树默认折叠，需先展开全部）
  const openDoc = async (docId, title) => {
    // 1) 先刷新列表 —— 文档是脚本通过 API 建的，前端 metas 里还没有它。
    //    不刷新就找不到文档行（本轮最先踩到的坑）。
    const refresh = p.locator('[data-testid="refresh-doc-list"]').first();
    if (await refresh.count()) {
      await refresh.click({ force: true });
      await sleep(3000); // 等 raect 重渲染 + 树重建
    }
    // 2) 展开全部（文档树默认折叠，不展开就找不到叶子节点）
    const toggle = p.locator('[data-testid="toggle-batched-all"]').first();
    if (await toggle.count()) {
      const pressed = await toggle.getAttribute("aria-pressed");
      if (pressed !== "true") {
        await toggle.click({ force: true });
        await sleep(1500);
      }
    }
    // 3) 直接按 id 找行（整棵树 242 行，id 精确定位；找不到再滚动等待）
    const row = p.locator(`[data-tree-kind="doc"][data-tree-key="${docId}"]`).first();
    const hasRow = await waitFor(async () => (await row.count()) > 0, 10000, "文档行出现 " + title);
    if (hasRow) {
      await row.scrollIntoViewIfNeeded().catch(() => {});
      await row.click({ force: true });
    }
    // 4) 判据：编辑器容器出现（table/datasheet 默认进编辑态，不渲染 .md-body）
    const ok = await waitFor(
      async () => (await p.locator("table, [contenteditable]").count()) > 0,
      10000,
      "编辑器加载 " + title,
    );
    await sleep(1500);
    return ok && hasRow;
  };

  const openedT1 = await openDoc(c1.json.id, T1);
  const tableCap = await p.evaluate(() => {
    // table/datasheet 默认进「编辑态」，不渲染 .md-body，也没有 h1。
    // 直接在整个主内容区（排除侧栏 aside）取文本。
    const main =
      Array.from(document.querySelectorAll("main, [role='main'], div")).find(
        (el) =>
          el.tagName !== "ASIDE" &&
          !el.closest("aside") &&
          el.querySelector("table, [contenteditable], select"),
      ) || document.body;
    const txt = main.innerText || "";
    return {
      hasFormula: /SUM\(/.test(txt),
      hasTable: !!document.querySelector("table"),
      textSample: txt.slice(0, 160),
    };
  });
  check(
    "表格文档确有公式能力（与 desc「支持公式」一致）",
    openedT1 && tableCap.hasFormula,
    JSON.stringify(tableCap),
  );

  const openedT2 = await openDoc(c2.json.id, T2);
  const dsCap = await p.evaluate(() => {
    // ⚠️ 判据必须与实现对齐：数据表的「筛选」是 select 的 title **属性**，
    //    不是可见文本（innerText 里只会有 option 的「全部」）。
    //    用 innerText 找「筛选」永远失败 —— 这是判据错，不是产品错。
    const filterSelects = document.querySelectorAll('select[title="筛选"]');
    const typeSelects = document.querySelectorAll('select[title="字段类型"]');
    const main =
      Array.from(document.querySelectorAll("main, [role='main'], div")).find(
        (el) =>
          el.tagName !== "ASIDE" &&
          !el.closest("aside") &&
          el.querySelector("table, [contenteditable], select"),
      ) || document.body;
    return {
      hasFilter: filterSelects.length > 0,
      hasTypes: typeSelects.length > 0,
      filterCount: filterSelects.length,
      typeCount: typeSelects.length,
      textSample: (main.innerText || "").slice(0, 120),
    };
  });
  check(
    "数据表文档确有列类型与筛选（与 desc「列类型 + 筛选」一致）",
    openedT2 && dsCap.hasTypes && dsCap.hasFilter,
    JSON.stringify(dsCap),
  );

  // ---- 8) 清理 ----
  await api("/api/v1/documents/" + c1.json.id, "DELETE");
  await api("/api/v1/documents/" + c2.json.id, "DELETE");
  const after = await api("/api/v1/documents");
  const left = (after.json.documents || []).filter((d) => d.title === T1 || d.title === T2);
  check("临时文档已删除（零残留）", left.length === 0, JSON.stringify(left.map((d) => d.id)));

  check("运行期无未捕获页面异常", errs.length === 0, errs.join(" | "));

  console.log("\n" + (fail === 0 ? "全部通过 ✅" : `失败 ${fail} 项 ❌`));
  await b.close();
  process.exit(fail === 0 ? 0 : 1);
})();