#!/usr/bin/env node
/**
 * 真机验证「回收站」全链路（TrashView，此前零覆盖）。
 *
 * 为什么优先做它：这是**数据安全的最后一环** —— 删除 → 进回收站 → 恢复 / 彻底删除。
 * 这里出错代价最高（误删不可逆、恢复不回来）。此前 32 个脚本没有一条碰它。
 *
 * 本轮的三个发现（都靠实测，不是读代码推断）：
 *  1. 🔴 **所有验证脚本的清理只做软删除**：`DELETE /documents/{id}` 是**软删**，
 *     文档进回收站并保留；而「零残留」断言只查活跃列表 —— 于是
 *     **清理没清干净、断言也看不见**，回收站实测堆了 **764 条历次夹具**。
 *     本脚本改用 `cleanupDocuments`（软删 + purge），「零残留」同时核对两处。
 *  2. 🔴 **全选按钮是 `<button>` 套 `<button>`**（Checkbox 自身即 button）→
 *     无效 HTML + React hydration 报错。已改为 div 布局 + 两个独立按钮。
 *  3. 回收站页此前**没有任何 data-testid**，无法写稳定判据；已补齐。
 *
 * 17 项断言：
 *   1. 可进入回收站页（侧栏入口）
 *   2. 页头汇总显示总项数
 *   3. 删除的文档出现在回收站（按 data-item-id 精确匹配）
 *   4. 「恢复」后：回到活跃列表
 *   5. 且从回收站消失
 *   6. 再次删除 → 点「彻底删除」需二次确认（不可逆操作必须有确认）
 *   7. 确认后：从回收站消失
 *   8. 且活跃列表也没有（彻底删除不是软删）
 *   9. 再建两篇 → 用「全选」选中
 *  10. 批量恢复 → 两篇都回到活跃列表
 *  11. 全选态下「取消全选」生效
 *  12. 勾选单项 → 批量栏显示「已选 N 项」
 *  13. 取消选择清空计数
 *  14. 零残留（**同时核对活跃列表与回收站**）
 *  15. 无 button 嵌套（回归：曾报 hydration error）
 *  16. 运行期无未捕获异常
 *
 * 用法：
 *   NODE_PATH=<托管 workspace node_modules> node web/scripts/verify_trash.cjs
 */
const { chromium } = require("playwright");
const fs = require("fs");
const {
  cleanupDocuments,
  fixtureResidue,
  api,
} = require("./_card_fixtures.cjs");

const TOKEN =
  process.env.SUNNYDOC_TOKEN ||
  fs.readFileSync(process.env.SUNNYDOC_TOKEN_FILE || "/tmp/sunnydoc-token.txt", "utf8").trim();
const WEB = process.env.SUNNYDOC_WEB || "http://localhost:3001";
const API = process.env.SUNNYDOC_API || "http://localhost:8000";
const KB = process.env.SUNNYDOC_KB || "fdef57f179384d679b62a3c4bae2d2e3";
/** 夹具标题前缀 —— 「零残留」按它核对活跃列表与回收站两处。 */
const PREFIX = "TRV-";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fail = 0;
const check = (n, c, d = "") => {
  if (c) console.log("  ✅ " + n);
  else {
    fail++;
    console.log("  ❌ " + n + "  " + String(d).slice(0, 220));
  }
};
const waitFor = async (fn, ms = 10000, label = "") => {
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
    ...(process.env.SUNNYDOC_CHROMIUM ? { executablePath: process.env.SUNNYDOC_CHROMIUM } : {}),
  });
  const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));
  // 捕获 React 的 hydration / DOM 合法性警告（button 嵌套就是从这里发现的）
  const consoleErrors = [];
  p.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200));
  });
  await p.addStyleTag({ content: "nextjs-portal{display:none!important;pointer-events:none!important}" });

  await p.goto(WEB, { waitUntil: "domcontentloaded" });
  await p.evaluate((t) => localStorage.setItem("sunnydoc.token", t), TOKEN);
  await p.reload({ waitUntil: "domcontentloaded" });
  await sleep(2500);

  const rm = (path, method = "GET", body) => api(p, "/api/v1" + path, method, body);
  const mkDoc = async (title) =>
    (await rm("/documents", "POST", { title, content: `# ${title}`, type: "doc", kb_id: KB })).json.id;
  const softDelete = async (id) => await rm("/documents/" + id, "DELETE");
  const liveHas = async (title) =>
    ((await rm("/documents?limit=1000")).json.documents || []).some((d) => d.title === title);
  const trashHas = async (title) =>
    ((await rm("/trash")).json.documents || []).some((d) => d.title === title);

  // 清掉可能的历史残留（含回收站）
  const pre = await fixtureResidue(p, PREFIX);
  const preIds = [
    ...(await rm("/documents?limit=1000")).json.documents
      .filter((d) => String(d.title).startsWith(PREFIX))
      .map((d) => d.id),
    ...(await rm("/trash")).json.documents
      .filter((d) => String(d.title).startsWith(PREFIX))
      .map((d) => d.id),
  ];
  if (preIds.length) await cleanupDocuments(p, preIds);
  console.log(`  预清理：${preIds.length} 项（活跃 ${pre.live.length} / 回收站 ${pre.trash.length}）`);

  // ---------- 进知识库（回收站入口在侧栏底部，只在 kb 视图可见） ----------
  /**
   * 进回收站页。
   *
   * ⚠️ **不要用 `p.reload()` 来"刷新"回收站**：`view` 是内存态，
   * 刷新后会回到首页 → `trash-item` 永远找不到（首版就在这里假失败 11 项，
   * 看起来像「回收站条目渲染不出来」，实际是导航流程被我自己打断了）。
   * 正确做法：回首页 → 进知识库 → 点侧栏「回收站」（入口只在 kb 视图可见）。
   */
  const gotoTrash = async () => {
    await p.evaluate(() => {
      history.pushState(null, "", location.pathname);
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await sleep(1200);
    const k = p.locator('[data-testid="kb-card"]').filter({ hasText: "云计算知识库" }).first();
    if (await k.count()) await k.click({ force: true });
    await sleep(2200);
    const e = p.getByRole("button", { name: "回收站" }).first();
    if (await e.count()) await e.click({ force: true });
    await sleep(1800);
  };

  // 先确认「有可见入口」再进去 —— 入口是发现性的前提
  // （回收站只在 kb 视图的侧栏底部；首页没有侧栏）
  const kbEntry = p.locator('[data-testid="kb-card"]').filter({ hasText: "云计算知识库" }).first();
  if (await kbEntry.count()) await kbEntry.click({ force: true });
  await sleep(2200);
  const trashEntry = p.getByRole("button", { name: "回收站" }).first();
  check("侧栏存在可见的回收站入口", (await trashEntry.count()) > 0, "未找到入口按钮（发现性问题）");
  if (await trashEntry.count()) {
    await trashEntry.click({ force: true });
    await sleep(2000);
  }

  // ⚠️ 「侧栏入口」必须在**进入回收站之前**查 —— 进了回收站视图后侧栏已不在 DOM，
  //    之后再查必然 count()===0（首版把这条放在后面，假失败了一次）。
  const inTrash = await waitFor(
    async () => (await p.locator('[data-testid="trash-summary"]').count()) > 0,
    8000,
    "进入回收站页",
  );
  check("可进入回收站页", inTrash, "未出现 trash-summary");
  if (!inTrash) {
    await cleanupDocuments(p, []);
    await b.close();
    console.log("\n失败 " + fail + " 项 ❌（未进入回收站，后续断言跳过）");
    process.exit(1);
  }

  const summary = await p.locator('[data-testid="trash-summary"]').innerText();
  check("页头汇总显示总项数", /共\s*\d+\s*项/.test(summary), JSON.stringify(summary));

  // ---------- 1) 删除 → 出现在回收站 ----------
  const t1 = PREFIX + "恢复验证";
  const id1 = await mkDoc(t1);
  await softDelete(id1);
  await sleep(1200);
  await gotoTrash();
  const item1 = p.locator(`[data-testid="trash-item"][data-item-id="${id1}"]`).first();
  const appear1 = await waitFor(async () => (await item1.count()) > 0, 8000, "条目出现在回收站");
  check("删除的文档出现在回收站（按 id 精确匹配）", appear1, `id=${id1}`);
  check("回收站接口也确认该条目（与 UI 同源）", await trashHas(t1));

  // ---------- 2) 恢复 ----------
  if (appear1) {
    await item1.locator('[data-testid="trash-restore"]').first().click({ force: true });
    await sleep(2000);
    check("「恢复」后回到活跃列表", await liveHas(t1), "活跃列表找不到");
    check("且从回收站消失", !(await trashHas(t1)), "回收站仍有");
  } else {
    check("「恢复」后回到活跃列表", false, "前置未成立");
    check("且从回收站消失", false, "前置未成立");
  }

  // ---------- 3) 彻底删除（需二次确认） ----------
  if (await liveHas(t1)) {
    await softDelete(id1);
    await sleep(1200);
    await gotoTrash();
    const it1 = p.locator(`[data-testid="trash-item"][data-item-id="${id1}"]`).first();
    if ((await it1.count()) > 0) {
      await it1.locator('[data-testid="trash-purge"]').first().click({ force: true });
      await sleep(900);
      // 不可逆操作必须有确认
      const confirm = p.locator('[role="dialog"]').filter({ hasText: "彻底删除" }).first();
      const hasConfirm = (await confirm.count()) > 0;
      check("「彻底删除」弹出二次确认（不可逆操作必须有确认）", hasConfirm, "未出现确认对话框");
      if (hasConfirm) {
        await confirm.getByRole("button", { name: "彻底删除" }).first().click({ force: true });
        await sleep(2000);
      }
      check("确认后从回收站消失", !(await trashHas(t1)), "回收站仍有");
      check("且活跃列表也没有（彻底删除 ≠ 软删）", !(await liveHas(t1)), "活跃列表仍在");
    } else {
      check("「彻底删除」弹出二次确认（不可逆操作必须有确认）", false, "条目不在回收站");
      check("确认后从回收站消失", false, "前置未成立");
      check("且活跃列表也没有（彻底删除 ≠ 软删）", false, "前置未成立");
    }
  } else {
    check("「彻底删除」弹出二次确认（不可逆操作必须有确认）", false, "前置未成立");
    check("确认后从回收站消失", false, "前置未成立");
    check("且活跃列表也没有（彻底删除 ≠ 软删）", false, "前置未成立");
  }

  // ---------- 4) 全选 / 批量恢复 / 计数 ----------
  const t2 = PREFIX + "批量甲";
  const t3 = PREFIX + "批量乙";
  const id2 = await mkDoc(t2);
  const id3 = await mkDoc(t3);
  await softDelete(id2);
  await softDelete(id3);
  await sleep(1200);
  await gotoTrash();

  // 勾选单项 → 批量栏计数
  const it2 = p.locator(`[data-testid="trash-item"][data-item-id="${id2}"]`).first();
  if ((await it2.count()) > 0) {
    await it2.locator('[data-testid="trash-item-check"]').first().click({ force: true });
    await sleep(700);
    const cnt = await p.locator('[data-testid="trash-selected-count"]').innerText().catch(() => "");
    check("勾选单项后批量栏显示「已选 N 项」", /已选\s*1\s*项/.test(cnt), JSON.stringify(cnt));
    // 取消选择
    await p.locator('[data-testid="trash-clear-selection"]').first().click({ force: true });
    await sleep(600);
    const gone = (await p.locator('[data-testid="trash-bulk-bar"]').count()) === 0;
    check("「取消选择」清空计数并隐藏批量栏", gone, "批量栏仍在");
  } else {
    check("勾选单项后批量栏显示「已选 N 项」", false, "条目未出现");
    check("「取消选择」清空计数并隐藏批量栏", false, "前置未成立");
  }

  // 全选（含点全选复选框再取消，覆盖 button 嵌套回归点）→ 批量恢复
  const allCheck = p.locator('[data-testid="trash-toggle-all-check"]').first();
  if ((await allCheck.count()) > 0) {
    await allCheck.click({ force: true });
    await sleep(900);
    const cnt2 = await p.locator('[data-testid="trash-selected-count"]').innerText().catch(() => "");
    check("「全选」把全部条目选中", /已选\s*\d+\s*项/.test(cnt2) && !/已选\s*0\s*项/.test(cnt2), JSON.stringify(cnt2));
    // 取消全选
    await allCheck.click({ force: true });
    await sleep(700);
    const hidden = (await p.locator('[data-testid="trash-bulk-bar"]').count()) === 0;
    check("再次点击「全选」变为取消全选", hidden, "批量栏仍在（未取消）");
    // 重新全选并批量恢复
    await allCheck.click({ force: true });
    await sleep(800);
    await p.locator('[data-testid="trash-batch-restore"]').first().click({ force: true });
    await sleep(2600);
    check("批量恢复：两篇都回到活跃列表", (await liveHas(t2)) && (await liveHas(t3)), `甲=${await liveHas(t2)} 乙=${await liveHas(t3)}`);
  } else {
    check("「全选」把全部条目选中", false, "未找到全选复选框");
    check("再次点击「全选」变为取消全选", false, "前置未成立");
    check("批量恢复：两篇都回到活跃列表", false, "前置未成立");
  }

  // ---------- 5) button 嵌套回归（曾在控制台持续报 hydration error） ----------
  const nestedErr = consoleErrors.filter((e) => /cannot be a descendant of|nested/i.test(e));
  check(
    "无 button 嵌套导致的 hydration 报错（回归）",
    nestedErr.length === 0,
    nestedErr.slice(0, 2).join(" | "),
  );

  // ---------- 6) 零残留（同时核对活跃列表与回收站） ----------
  const leftovers = [
    ...(await rm("/documents?limit=1000")).json.documents
      .filter((d) => String(d.title).startsWith(PREFIX))
      .map((d) => d.id),
    ...(await rm("/trash")).json.documents
      .filter((d) => String(d.title).startsWith(PREFIX))
      .map((d) => d.id),
  ];
  await cleanupDocuments(p, leftovers);
  /**
   * 🔴 这条断言**刻意不调用 `fixtureResidue()`**，而是直接读两个接口的原始响应。
   *
   * 为什么：`cleanupDocuments` 与 `fixtureResidue` 同在一个模块里，若两者的
   * 「是否处理回收站」同时退化（例如都退回旧口径），它们会**互相抵消** ——
   * 清理没清、断言也看不见，于是照旧全绿。
   * 对抗性验证当场撞上了这一点：同时注入「清理只软删 + 断言只查活跃」→ 19 项全过。
   * 断言必须**独立于被测的清理工具**，直接问 API 要事实。
   */
  const liveLeft = ((await rm("/documents?limit=1000")).json.documents || []).filter((d) =>
    String(d.title).startsWith(PREFIX),
  );
  const trashLeft = ((await rm("/trash")).json.documents || []).filter((d) =>
    String(d.title).startsWith(PREFIX),
  );
  check(
    "零残留：活跃列表已清空",
    liveLeft.length === 0,
    `仍有 ${liveLeft.length} 项：${liveLeft.map((d) => d.title).join(",")}`,
  );
  check(
    "零残留：**回收站也已清空**（软删残留曾在此堆积 764 条）",
    trashLeft.length === 0,
    `回收站仍有 ${trashLeft.length} 项：${trashLeft.map((d) => d.title).join(",")}`,
  );
  check("运行期无未捕获页面异常", errs.length === 0, errs.slice(0, 2).join(" | "));

  console.log("\n" + (fail === 0 ? "全部通过 ✅" : `失败 ${fail} 项 ❌`));
  await b.close();
  process.exit(fail === 0 ? 0 : 1);
})();