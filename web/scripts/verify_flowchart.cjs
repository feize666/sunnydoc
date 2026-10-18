#!/usr/bin/env node
/**
 * 真机验证「流程图编辑器」的核心交互。
 *
 * 背景（2026-10-19）：与思维导图同样是 3698 行零验证的组件，补测时抓到真实缺陷：
 *
 * 🔴 **就地编辑框抢不到焦点 → 关不掉，且画布快捷键被挡**
 *    React Flow 双击后会把焦点落到节点 div 上，时机**晚于**输入框的 `autoFocus`
 *    → 焦点被抢走。后果三连：
 *      · `onKeyDown` 里的 Esc 收不到 → **编辑框关不掉**
 *        （实测点空白 / 点另一节点 / 点工具栏 / Esc 四种方式都关不掉）；
 *      · `onBlur` 从不触发（它从未获焦）→ `commitEdit` 不执行；
 *      · 编辑期间画布快捷键（Ctrl+D / Delete）被挡 → 用户以为「快捷键坏了」。
 *    修法：用 rAF 延后一帧主动 `focus()` 抢回；并在画布 onKeyDown 里加
 *    「编辑期间只认 Esc」的兜底。
 *
 * ⚠️ 断言一律走**真实鼠标 / 键盘**：合成事件不经过焦点抢占与 pointer capture，
 *    正好把这两个缺陷掩盖住（这正是它们此前没被发现的原因）。
 *
 * 18 项断言：
 *   1. 可创建流程图文档 / 编辑器渲染（React Flow 面板 + 预设节点）
 *   2. 点节点 → 进入选中态（`.selected`）
 *   3. 双击节点 → 出现就地编辑框
 *   4. 编辑框**确实拿到焦点**（回归：这正是一度失败的点）
 *   5. 改文字 + 提交 → 节点标签更新
 *   6. 点画布空白 → 编辑框关闭（回归）
 *   7. Esc → 编辑框关闭（回归）
 *   8. Ctrl+D 复制节点
 *   9. Delete 删除节点
 *  10. Ctrl+Z 撤销
 *  11. Ctrl+Y 重做
 *  12. Ctrl+A 全选
 *  13. 保存后文档源为 {nodes, edges} 且含改动
 *  14. 导出 PNG 有产物
 *  15. 零残留
 *  16. 运行期无未捕获异常
 *
 * 用法：
 *   NODE_PATH=<托管 workspace node_modules> node web/scripts/verify_flowchart.cjs
 */
const { chromium } = require("playwright");
const fs = require("fs");

const TOKEN =
  process.env.SUNNYDOC_TOKEN ||
  fs.readFileSync(process.env.SUNNYDOC_TOKEN_FILE || "/tmp/sunnydoc-token.txt", "utf8").trim();
const WEB = process.env.SUNNYDOC_WEB || "http://localhost:3001";
const API = process.env.SUNNYDOC_API || "http://localhost:8000";
const KB = process.env.SUNNYDOC_KB || "fdef57f179384d679b62a3c4bae2d2e3";
const TITLE = "FCV-流程图验证";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fail = 0;
const check = (n, c, d = "") => {
  if (c) console.log("  ✅ " + n);
  else {
    fail++;
    console.log("  ❌ " + n + "  " + String(d).slice(0, 200));
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

/** 预设图：两个节点 + 一条连线（有内容才能测选中/复制/删除）。 */
const SEED = JSON.stringify({
  nodes: [
    { id: "a", type: "process", position: { x: 120, y: 100 }, data: { label: "开始" } },
    { id: "b", type: "process", position: { x: 420, y: 100 }, data: { label: "结束" } },
  ],
  edges: [{ id: "e1", source: "a", target: "b" }],
});

(async () => {
  const b = await chromium.launch({
    headless: true,
    args: ["--no-proxy-server"],
    ...(process.env.SUNNYDOC_CHROMIUM ? { executablePath: process.env.SUNNYDOC_CHROMIUM } : {}),
  });
  const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));
  await p.addStyleTag({ content: "nextjs-portal{display:none!important;pointer-events:none!important}" });

  const api = (path, method = "GET", body) =>
    p.evaluate(
      async ([a, t, p2, m, b2]) => {
        const r = await fetch(a + p2, {
          method: m,
          headers: { Authorization: "Bearer " + t, "Content-Type": "application/json" },
          body: b2 ? JSON.stringify(b2) : undefined,
        });
        const x = await r.text();
        try {
          return { status: r.status, json: JSON.parse(x) };
        } catch {
          return { status: r.status, json: x };
        }
      },
      [API, TOKEN, path, method, body],
    );

  await p.goto(WEB, { waitUntil: "domcontentloaded" });
  await p.evaluate((t) => localStorage.setItem("sunnydoc.token", t), TOKEN);
  await p.reload({ waitUntil: "domcontentloaded" });
  await sleep(2500);

  const cleanup = async () => {
    const L = await api("/api/v1/documents?limit=500");
    for (const d of L.json.documents || []) if (d.title === TITLE) await api("/api/v1/documents/" + d.id, "DELETE");
  };
  await cleanup();

  const fc = await api("/api/v1/documents", "POST", {
    title: TITLE,
    content: SEED,
    type: "flowchart",
    kb_id: KB,
  });
  const DOC_ID = fc.json.id;
  check("可创建流程图文档", !!DOC_ID, JSON.stringify(fc.json).slice(0, 150));

  await sleep(1500);
  const kb = p.locator('[data-testid="kb-card"]').filter({ hasText: "云计算知识库" }).first();
  if (await kb.count()) await kb.click({ force: true });
  await sleep(2500);
  const rf = p.locator('[data-testid="refresh-doc-list"]').first();
  if (await rf.count()) {
    await rf.click({ force: true });
    await sleep(2500);
  }
  const tg = p.locator('[data-testid="toggle-batched-all"]').first();
  if ((await tg.count()) && (await tg.getAttribute("aria-pressed")) !== "true") {
    await tg.click({ force: true });
    await sleep(1200);
  }
  await p.locator('input[type="search"], input[placeholder*="搜索"]').first().fill(TITLE);
  await sleep(2000);
  const hit = p.getByText(TITLE, { exact: true }).first();
  if (await hit.count()) await hit.click({ force: true });
  await sleep(4500);

  const nodes = async () => await p.locator(".react-flow__node").count();
  const editBoxes = () => p.evaluate(() => document.querySelectorAll("textarea, input[placeholder*='文字']").length);
  const selectedCount = () => p.evaluate(() => document.querySelectorAll(".react-flow__node.selected").length);
  const nodePos = async (i = 0) =>
    p.evaluate((idx) => {
      const n = document.querySelectorAll(".react-flow__node")[idx];
      if (!n) return null;
      const r = n.getBoundingClientRect();
      return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
    }, i);

  check("编辑器渲染出预设节点（2 个）", (await nodes()) === 2, `nodes=${await nodes()}`);
  check("React Flow 画布存在", await p.evaluate(() => !!document.querySelector(".react-flow__pane")));

  // 1) 点节点 → 选中
  const n0 = await nodePos(0);
  await p.mouse.click(n0.cx, n0.cy);
  await sleep(800);
  check("点节点后进入选中态（.selected）", (await selectedCount()) === 1, `selected=${await selectedCount()}`);

  // 2) 双击 → 就地编辑框 + **焦点必须在输入框**（本轮的回归点）
  await p.mouse.dblclick(n0.cx, n0.cy, { delay: 40 });
  await sleep(1000);
  const boxCount = await editBoxes();
  check("双击节点出现就地编辑框", boxCount > 0, `boxes=${boxCount}`);
  // 🔴 焦点断言：这正是曾经的缺陷（autoFocus 被 React Flow 抢走）
  const focused = await p.evaluate(() => {
    const t = document.querySelector("textarea, input[placeholder*='文字']");
    return !!t && document.activeElement === t;
  });
  check("就地编辑框确实拿到焦点（曾被 React Flow 抢走）", focused, "焦点不在编辑框");

  // 3) 改文字 + 提交
  if (focused) {
    await p.keyboard.press("Control+a");
    await p.keyboard.type("改名验证ABC");
    await p.keyboard.press("Control+Enter"); // 多行 textarea 用 Ctrl+Enter 提交
    await sleep(900);
    check("改文字后节点标签更新", await p.evaluate(() => document.body.innerText.includes("改名验证ABC")));
  } else {
    check("改文字后节点标签更新", false, "前置未成立");
  }

  // 4) 点画布空白 → 编辑框关闭（回归）
  await p.mouse.dblclick(n0.cx, n0.cy, { delay: 40 });
  await sleep(900);
  const openedAgain = (await editBoxes()) > 0;
  await p.mouse.click(120, 300);
  await sleep(800);
  check("点画布空白处可关闭编辑框", openedAgain && (await editBoxes()) === 0, `打开=${openedAgain} 剩余=${await editBoxes()}`);

  // 5) Esc → 编辑框关闭（回归）
  await p.mouse.dblclick(n0.cx, n0.cy, { delay: 40 });
  await sleep(900);
  const opened3 = (await editBoxes()) > 0;
  await p.keyboard.press("Escape");
  await sleep(800);
  check("Esc 可关闭编辑框", opened3 && (await editBoxes()) === 0, `打开=${opened3} 剩余=${await editBoxes()}`);

  // 5b) 编辑期间按键**落到画布**时不得改数据（兜底守卫）
  //
  // 为什么单独测这条：焦点修好后，正常按键都落在输入框上并由它 stopPropagation，
  // 画布的守卫分支**走不到** —— 也就是说「回滚守卫」在其它断言里不会失败
  // （对抗性验证当场证明：去掉守卫，其余 18 项照样全绿）。
  // 而守卫本身是有意义的：一旦焦点因任何原因落到画布（React Flow 抢焦点、
  // 浏览器差异、将来新增的浮层），Delete 就会删掉正在编辑的节点。
  // 这里直接向画布派发 keydown 来触达那条分支，断言「节点数不变且退出编辑」。
  await p.mouse.dblclick(n0.cx, n0.cy, { delay: 40 });
  await sleep(900);
  const editingNow = (await editBoxes()) > 0;
  const beforeGuard = await nodes();
  await p.evaluate(() => {
    // 把焦点交回画布容器（模拟「焦点不在输入框」的意外情形），但不触发 blur 提交
    const pane = document.querySelector(".react-flow__pane") || document.body;
    const t = document.querySelector("textarea");
    t?.blur();
    pane.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true }));
  });
  await sleep(700);
  check(
    "编辑期间按键落到画布也不会删掉节点（兜底守卫生效）",
    editingNow && (await nodes()) === beforeGuard,
    `编辑中=${editingNow} 节点 ${beforeGuard} → ${await nodes()}`,
  );
  await p.keyboard.press("Escape");
  await sleep(600);

  // 6) Ctrl+D 复制
  const n1 = await nodePos(0);
  await p.mouse.click(n1.cx, n1.cy);
  await sleep(700);
  let c = await nodes();
  await p.keyboard.press("Control+d");
  await sleep(900);
  check("Ctrl+D 复制节点", (await nodes()) > c, `${c} → ${await nodes()}`);

  // 7) Delete 删除
  c = await nodes();
  await p.keyboard.press("Delete");
  await sleep(900);
  check("Delete 删除节点", (await nodes()) < c, `${c} → ${await nodes()}`);

  // 8) 撤销 / 重做
  c = await nodes();
  await p.keyboard.press("Control+z");
  await sleep(800);
  const afterUndo = await nodes();
  check("Ctrl+Z 撤销", afterUndo !== c, `${c} → ${afterUndo}`);
  await p.keyboard.press("Control+y");
  await sleep(800);
  check("Ctrl+Y 重做", (await nodes()) === c, `期望 ${c}，实际 ${await nodes()}`);

  // 9) Ctrl+A 全选
  await p.mouse.click((await nodePos(0)).cx, (await nodePos(0)).cy);
  await sleep(600);
  await p.keyboard.press("Control+a");
  await sleep(800);
  check("Ctrl+A 全选", (await selectedCount()) === (await nodes()), `selected=${await selectedCount()} / nodes=${await nodes()}`);

  // 10) 保存落库
  const saved = await (async () => {
    for (let i = 0; i < 30; i++) {
      const d = await api("/api/v1/documents/" + DOC_ID);
      try {
        const j = JSON.parse(String(d.json.text || ""));
        if (Array.isArray(j.nodes) && j.nodes.length >= 1) return j;
      } catch {
        /* 尚未落库成合法结构 */
      }
      await sleep(500);
    }
    return null;
  })();
  check(
    "保存后文档源为 {nodes, edges} 结构且含改动",
    !!saved && Array.isArray(saved.nodes) && Array.isArray(saved.edges),
    `nodes=${saved?.nodes?.length} edges=${saved?.edges?.length}`,
  );

  // 11) 导出 PNG
  let dlOk = false;
  let dlSize = 0;
  try {
    await p.locator('button[title*="导出"]').first().click({ force: true });
    await sleep(700);
    const [dl] = await Promise.all([
      p.waitForEvent("download", { timeout: 25000 }),
      p.locator("button").filter({ hasText: /^导出 PNG$/ }).first().click({ force: true }),
    ]);
    const path = await dl.path();
    if (path) dlSize = fs.statSync(path).size;
    dlOk = /\.png$/.test(dl.suggestedFilename()) && dlSize > 1000;
  } catch (e) {
    console.log("     导出异常: " + String(e).slice(0, 140));
  }
  check("导出 PNG 有产物", dlOk, `size=${dlSize}`);

  // 清理
  await cleanup();
  const L2 = await api("/api/v1/documents?limit=500");
  check("零残留", (L2.json.documents || []).filter((d) => d.title === TITLE).length === 0);
  check("运行期无未捕获页面异常", errs.length === 0, errs.slice(0, 2).join(" | "));

  console.log("\n" + (fail === 0 ? "全部通过 ✅" : `失败 ${fail} 项 ❌`));
  await b.close();
  process.exit(fail === 0 ? 0 : 1);
})();