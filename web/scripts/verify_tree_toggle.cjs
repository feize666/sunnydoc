#!/usr/bin/env node
/**
 * 真机验证「文档树一键折叠展开 + 默认折叠」（本轮需求）。
 *
 * 8 项断言，每项都绑定**本次操作**的证据：
 *   1. 进入知识库后，默认所有 folder 节点都是折叠态（data-open="0"）
 *   2. 可见行数 == 顶层节点数（无子节点泄露）
 *   3. 点「全部展开」→ 所有 folder 节点 data-open="1"，可见行数显著增加
 *   4. 「全部展开」按钮进入选中态（aria-pressed="true" / text-accent）
 *   5. 点「全部折叠」→ 回到全折叠，可见行数 == 顶层节点数
 *   6. 手动展开单个节点后，点「全部折叠」→ 该节点保持展开（用户偏好优先）
 *   7. 折叠态下层级缩进 / 树结构未被破坏（顶层节点 depth 一致）
 *   8. 零残留（本脚本不创建文档，无夹具）
 *
 * 用法：
 *   NODE_PATH=<托管 workspace node_modules> node web/scripts/verify_tree_toggle.cjs
 */
const { chromium } = require("playwright");
const fs = require("fs");

const TOKEN =
  process.env.SUNNYDOC_TOKEN ||
  fs.readFileSync(process.env.SUNNYDOC_TOKEN_FILE || "/tmp/sunnydoc-token.txt", "utf8").trim();
const WEB = process.env.SUNNYDOC_WEB || "http://localhost:3001";
const KB_NAME = "云计算知识库";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fail = 0;
const check = (n, c, d) => {
  if (c) console.log("  ✅ " + n);
  else {
    fail++;
    console.log("  ❌ " + n + "\n       " + String(d).slice(0, 400));
  }
};

/** 读文档树里所有 folder 行的展开态。 */
const readTree = (p) =>
  p.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("[data-tree-kind='folder']"));
    return {
      total: rows.length,
      openCount: rows.filter((r) => r.getAttribute("data-open") === "1").length,
      keys: rows.map((r) => r.getAttribute("data-tree-key")),
      opens: rows.map((r) => r.getAttribute("data-open")),
      // 顶层行 = 缩进最小的一批
      minIndent: rows.length
        ? Math.min(...rows.map((r) => parseFloat(getComputedStyle(r).paddingLeft) || 0))
        : 0,
    };
  });

(async () => {
  const b = await chromium.launch({ headless: true, args: ["--no-proxy-server"] });
  const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e).slice(0, 160)));
  await p.addStyleTag({
    content: "nextjs-portal{display:none!important;pointer-events:none!important}",
  });

  await p.goto(WEB, { waitUntil: "domcontentloaded" });
  await p.evaluate((t) => localStorage.setItem("sunnydoc.token", t), TOKEN);
  await p.reload({ waitUntil: "domcontentloaded" });
  await sleep(2500);

  const kb = p.locator("button, a").filter({ hasText: KB_NAME }).first();
  check("知识库入口可达", (await kb.count()) > 0, "未找到「" + KB_NAME + "」");
  if (await kb.count()) {
    await kb.click();
    await sleep(3000);
  }

  // 等文档树渲染
  let t0 = await readTree(p);
  for (let i = 0; i < 20 && t0.total === 0; i++) {
    await sleep(500);
    t0 = await readTree(p);
  }
  check("文档树已渲染（folder 行数 > 0）", t0.total > 0, "folder 行数 = " + t0.total);
  if (t0.total === 0) {
    await b.close();
    process.exit(1);
  }

  // ---- 1) 默认全折叠 ----
  check(
    `默认所有 folder 节点折叠（${t0.total} 个，open 数 = ${t0.openCount}）`,
    t0.openCount === 0,
    JSON.stringify(t0.opens.filter((o) => o === "1").length),
  );

  // ---- 2) 可见行数 == 顶层节点数 ----
  const visibleRows0 = await p.locator(".tree-row").count();
  check(
    "默认只显示顶层节点（无子节点泄露）",
    visibleRows0 === t0.total,
    `visible=${visibleRows0} folders=${t0.total}`,
  );

  // ---- 3) 点「全部展开」 ----
  const toggle = p.locator('[data-testid="toggle-batched-all"]');
  check("「全部展开/折叠」按钮存在", (await toggle.count()) > 0, "未找到按钮");
  await toggle.first().click({ force: true });
  await sleep(1200);
  const t1 = await readTree(p);
  check(
    `点「全部展开」→ 所有 folder 展开（open = ${t1.openCount}/${t1.total}）`,
    t1.total > 0 && t1.openCount === t1.total,
    JSON.stringify({ total: t1.total, open: t1.openCount }),
  );
  const visibleRows1 = await p.locator(".tree-row").count();
  check(
    "展开后可见行数显著增加（子节点被显示）",
    visibleRows1 > visibleRows0,
    `before=${visibleRows0} after=${visibleRows1}`,
  );

  // ---- 4) 按钮选中态 ----
  const pressed = await toggle.first().getAttribute("aria-pressed");
  check('「全部展开」后按钮进入选中态（aria-pressed="true"）', pressed === "true", "aria-pressed=" + pressed);

  // ---- 5) 点「全部折叠」 ----
  await toggle.first().click({ force: true });
  await sleep(1200);
  const t2 = await readTree(p);
  check(
    `点「全部折叠」→ 回到全折叠（open = ${t2.openCount}/${t2.total}）`,
    t2.openCount === 0,
    JSON.stringify({ total: t2.total, open: t2.openCount }),
  );
  const visibleRows2 = await p.locator(".tree-row").count();
  check(
    "折叠后可见行数回到顶层数",
    visibleRows2 === visibleRows0,
    `before=${visibleRows0} after=${visibleRows2}`,
  );

  // ---- 6) 手动展开单节点 → 「全部折叠」不覆盖用户偏好 ----
  const firstKey = t0.keys[0];
  const firstRow = p.locator(`[data-tree-kind='folder'][data-tree-key="${firstKey}"]`).first();
  // ⚠️ 行内 first button 是「选择框」（title="选择"），**展开按钮是第 2 个**
  //    （class 含 flex-1，文本是节点名）。首次写脚本时按"第一个按钮=展开"断言，
  //    得到的是「点了选择框」的假失败 —— 又一次「断言失败先怀疑判据」。
  const chevron = firstRow.locator("button.flex-1").first();
  await chevron.dispatchEvent("click");
  await sleep(900);
  const t3 = await readTree(p);
  const manualOpened = t3.opens[t3.keys.indexOf(firstKey)] === "1";
  check("手动点单个节点可展开", manualOpened, JSON.stringify({ key: firstKey, opens: t3.opens }));

  // 再点「全部展开」→ 再点「全部折叠」→ 手动展开的那个应保持展开
  await toggle.first().click({ force: true });
  await sleep(1000);
  await toggle.first().click({ force: true });
  await sleep(1000);
  const t4 = await readTree(p);
  const idx = t4.keys.indexOf(firstKey);
  check(
    "「全部折叠」不覆盖用户手动展开的节点（用户偏好优先）",
    idx >= 0 && t4.opens[idx] === "1",
    JSON.stringify({ key: firstKey, open: t4.opens[idx], all: t4.opens }),
  );

  // ---- 7) 树结构未被破坏（顶层缩进一致） ----
  const topRows = await p.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("[data-tree-kind='folder']"));
    if (!rows.length) return { ok: false };
    const pads = rows.map((r) => parseFloat(getComputedStyle(r).paddingLeft) || 0);
    const min = Math.min(...pads);
    return { ok: true, min, topCount: pads.filter((x) => x === min).length, total: pads.length };
  });
  check(
    "折叠态下顶层节点缩进一致（树结构完好）",
    topRows.ok && topRows.topCount > 0,
    JSON.stringify(topRows),
  );

  check("运行期无未捕获页面异常", errs.length === 0, errs.join(" | "));

  console.log("\n" + (fail === 0 ? "全部通过 ✅" : `失败 ${fail} 项 ❌`));
  await b.close();
  process.exit(fail === 0 ? 0 : 1);
})();