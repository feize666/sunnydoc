#!/usr/bin/env node
/**
 * 真机验证「思维导图编辑器」的核心交互。
 *
 * 背景（2026-10-19）：这两个编辑器合计 6186 行（流程图 3698 / 思维导图 2488），
 * 是本项目最大的两个组件，却**一条真机断言都没有**。补测时立刻抓到一个严重缺陷：
 *
 * 🔴 **pointer capture 让节点点击/双击全部失效**
 *    `onPointerDown` 末尾无条件 `setPointerCapture` → 浏览器把**后续 click /
 *    dblclick 的 target 重定向到画布 div** → 节点 `<g onClick / onDoubleClick>`
 *    永远收不到事件 → `selected` 恒为 null → `onKeyDown` 开头的
 *    `if (!selected) return` 把 **Tab / Enter / Delete / F2 / Ctrl+C/V/D /
 *    方向键全部挡掉**，连双击改名也进不去。
 *    实测铁证：真实鼠标点节点什么也不发生；而**直接派发**
 *    `dispatchEvent(new MouseEvent("click"))` 却能正常选中 —— 说明是
 *    「事件到不了」，不是处理逻辑有问题。
 *
 * 本脚本的断言一律走**真实鼠标 / 键盘**：合成事件会绕过 pointer capture，
 * 正好把这个缺陷掩盖掉（这也是它此前没被发现的原因）。
 *
 * 16 项断言：
 *   1. 编辑器渲染（初始 1 个节点）
 *   2. 点节点 → 进入选中态（右侧出现「节点操作」面板）
 *   3. Tab 添加子主题
 *   4. Enter 添加同级主题（需先选中）
 *   5. 双击节点 → 进入编辑态
 *   6. 改名后新文字出现在画布
 *   7. Ctrl+C / Ctrl+V 复制子树
 *   8. Ctrl+D 复制并粘贴
 *   9. Delete 删除节点
 *  10. Ctrl+Z 撤销
 *  11. Ctrl+Y 重做
 *  12. 保存后文档源含多节点（数据真的落库）
 *  13. 导出 PNG 有产物
 *  14. 零残留
 *  15. 运行期无未捕获异常
 *
 * ⚠️ 脚本层注意（两条都会造成**假失败**，不是产品问题）：
 *   · `addChild` / `addSibling` 加完会**立即进入编辑态**（方便直接输名字），
 *     后续按键会被输入框吃掉 → 需要先 Esc/Enter 退出编辑再继续。
 *   · `Esc` 在**非编辑态**是「取消选中」→ 按完要重新点选，否则后续
 *     「依赖选中」的快捷键断言会失败。
 *
 * 用法：
 *   NODE_PATH=<托管 workspace node_modules> node web/scripts/verify_mindmap.cjs
 */
const { chromium } = require("playwright");
const fs = require("fs");

const TOKEN =
  process.env.SUNNYDOC_TOKEN ||
  fs.readFileSync(process.env.SUNNYDOC_TOKEN_FILE || "/tmp/sunnydoc-token.txt", "utf8").trim();
const WEB = process.env.SUNNYDOC_WEB || "http://localhost:3001";
const API = process.env.SUNNYDOC_API || "http://localhost:8000";
const KB = process.env.SUNNYDOC_KB || "fdef57f179384d679b62a3c4bae2d2e3";
const TITLE = "MMV-思维导图验证";
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

(async () => {
  const b = await chromium.launch({
    headless: true,
    args: ["--no-proxy-server", "--font-render-hinting=none"],
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

  const mm = await api("/api/v1/documents", "POST", {
    title: TITLE,
    content: JSON.stringify({ nodes: [{ id: "1", text: "中心主题", parent: null }] }),
    type: "mindmap",
    kb_id: KB,
  });
  const DOC_ID = mm.json.id;
  check("可创建思维导图文档", !!DOC_ID, JSON.stringify(mm.json).slice(0, 150));

  // 打开文档
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
  await sleep(4000);

  const nodes = async () => await p.locator(".mind-node").count();
  /** 选中态的真实可见判据：右侧「样式」面板出现「节点操作」区块。
   *  ⚠️ 别用按钮的 title 文案（如「添加子主题」）—— title 不在 innerText 里。 */
  const selected = () => p.evaluate(() => /节点操作/.test(document.body.innerText));
  const posOf = async (idx = 0) =>
    p.evaluate((i) => {
      const g = document.querySelectorAll(".mind-node")[i];
      if (!g) return null;
      const r = g.getBoundingClientRect();
      return { id: g.dataset.id, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
    }, idx);
  const escOutOfEdit = async () => {
    await p.keyboard.press("Escape");
    await sleep(450);
  };

  check("编辑器渲染（初始 1 个节点）", (await nodes()) === 1, `nodes=${await nodes()}`);

  // 1) 点节点 → 选中（真实鼠标，这条正是被 capture 挡掉的）
  const n0 = await posOf(0);
  await p.mouse.click(n0.cx, n0.cy);
  await sleep(700);
  check("点节点后进入选中态（右侧出现「节点操作」）", await selected(), "选中态未建立");

  // 2) Tab 加子主题
  let c = await nodes();
  await p.keyboard.press("Tab");
  await sleep(900);
  check("Tab 添加子主题", (await nodes()) === c + 1, `${c} → ${await nodes()}`);
  await escOutOfEdit();

  // 3) Enter 加同级（单击非编辑态节点只做选中，不必先 Esc）
  const n1 = await posOf(1);
  if (n1) {
    await p.mouse.click(n1.cx, n1.cy);
    await sleep(600);
  }
  const selBefore = await selected();
  c = await nodes();
  await p.keyboard.press("Enter");
  await sleep(900);
  check("Enter 添加同级主题", selBefore && (await nodes()) === c + 1, `选中=${selBefore} ${c} → ${await nodes()}`);
  await escOutOfEdit();

  // 4) 双击 → 编辑态
  const n2 = await posOf(0);
  await p.mouse.dblclick(n2.cx, n2.cy, { delay: 40 });
  await sleep(1000);
  const editing = await p.evaluate(() => document.querySelectorAll("foreignObject input").length > 0);
  check("双击节点进入编辑态", editing, "未出现编辑输入框");
  if (editing) {
    await p.keyboard.press("Control+a");
    await p.keyboard.type("改名验证XYZ");
    await p.keyboard.press("Enter");
    await sleep(900);
    check("改名后新文字出现在画布上", await p.evaluate(() => document.body.innerText.includes("改名验证XYZ")));
  } else {
    check("改名后新文字出现在画布上", false, "前置未成立");
  }

  // 5) Ctrl+C / Ctrl+V
  const n3 = await posOf(0);
  await p.mouse.click(n3.cx, n3.cy);
  await sleep(600);
  await escOutOfEdit(); // 退编辑（也可能取消选中）
  await p.mouse.click(n3.cx, n3.cy); // 重新确保选中
  await sleep(600);
  c = await nodes();
  await p.keyboard.press("Control+c");
  await sleep(400);
  await p.keyboard.press("Control+v");
  await sleep(900);
  check("Ctrl+C / Ctrl+V 复制子树", (await nodes()) > c, `${c} → ${await nodes()}`);

  // 6) Ctrl+D
  c = await nodes();
  await p.keyboard.press("Control+d");
  await sleep(900);
  check("Ctrl+D 复制并粘贴", (await nodes()) > c, `${c} → ${await nodes()}`);

  // 7) Delete
  const nLast = await posOf((await nodes()) - 1);
  if (nLast) {
    await p.mouse.click(nLast.cx, nLast.cy);
    await sleep(600);
  }
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

  // 9) 保存落库
  const savedCount = await (async () => {
    for (let i = 0; i < 30; i++) {
      const d = await api("/api/v1/documents/" + DOC_ID);
      try {
        const j = JSON.parse(String(d.json.text || ""));
        if (Array.isArray(j.nodes) && j.nodes.length > 1) return j.nodes.length;
      } catch {
        /* 尚未保存成合法结构 */
      }
      await sleep(500);
    }
    return 0;
  })();
  check("保存后文档源含多个节点（数据真的落库）", savedCount > 1, `saved=${savedCount}`);

  // 10) 导出 PNG
  let dlOk = false;
  let dlSize = 0;
  try {
    await p.locator('button[title*="导出"]').first().click({ force: true });
    await sleep(600);
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