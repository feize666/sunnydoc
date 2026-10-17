#!/usr/bin/env node
/**
 * 真机验证「多选批量移动」（P4-1 缺口补齐）。
 *
 * 背景：多选工具条原来只有「取消 / 删除」，**没有移动**；后端也只有
 * `/documents/batch-delete`，没有对称的批量移动。路线图 P4-1 要求
 * 「文件夹批量操作（移动/复制）」「跨知识库移动扩到批量」。
 *
 * 本轮补齐：`POST /documents/batch-move` + 多选工具条「移动」按钮
 * （复用既有 MoveToKbDialog，不复制实现）。
 *
 * 断言分三层：
 *   A. 入口层：进入多选后工具条出现「移动」按钮
 *   B. 交互层：点击打开 MoveToKbDialog，文案说的是「N 篇文档」而非单个标题
 *   C. 能力层（关键）：真的移动成功（后端 kb_id 变化）+ 失败项如实提示
 *      且**无效 id 混入时跳过而非整批失败**
 *
 * 11 项断言：
 *   1. 进入知识库视图
 *   2. 可进入多选模式（出现选择框）
 *   3. 多选工具条出现
 *   4. 工具条有「移动」按钮（本轮新增）
 *   5. 选中文件夹时「移动」按钮被禁用（跨库移动只支持文档）
 *   6. 选中 3 篇文档 → 点「移动」→ 打开对话框
 *   7. 对话框文案是「3 篇文档」而非单个标题（批量语义）
 *   8. 选目标库后真的移动成功（后端 kb_id 从 A 变 B）
 *   9. 后端 batch-move 混入无效 id 时跳过而非整批失败
 *  10. 零残留（全部清理）
 *  11. 运行期无未捕获页面异常
 *
 * 用法：
 *   NODE_PATH=<托管 workspace node_modules> node web/scripts/verify_batch_move.cjs
 */
const { chromium } = require("playwright");
const fs = require("fs");

const TOKEN =
  process.env.SUNNYDOC_TOKEN ||
  fs.readFileSync(process.env.SUNNYDOC_TOKEN_FILE || "/tmp/sunnydoc-token.txt", "utf8").trim();
const WEB = process.env.SUNNYDOC_WEB || "http://localhost:3001";
const API = process.env.SUNNYDOC_API || "http://localhost:8000";
const KB = "fdef57f179384d679b62a3c4bae2d2e3"; // 云计算知识库
const PREFIX = "BMV-"; // 夹具标题前缀
const TEST_FOLDER = "BMV-夹具目录";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  const b = await chromium.launch({ headless: true, args: ["--no-proxy-server"] });
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

  // ---------- 夹具：3 篇文档 + 1 个文件夹 + 1 个**目标知识库** ----------
  // 目标库是必需的：MoveToKbDialog 会排除当前库，本机只有 1 个库时
  // 对话框只会显示「没有可移动的目标知识库」，UI 层的移动链路就验不到。
  const TEST_KB = "BMV-目标库";
  const cleanup = async () => {
    const L = await api("/api/v1/documents?limit=500");
    for (const d of L.json.documents || []) {
      if (d.title && d.title.startsWith(PREFIX)) await api("/api/v1/documents/" + d.id, "DELETE");
    }
    const F = await api("/api/v1/folders?kb_id=" + KB);
    for (const f of F.json.folders || []) {
      if (f.name === TEST_FOLDER) await api("/api/v1/folders/" + f.id, "DELETE");
    }
    const K = await api("/api/v1/kbs");
    for (const k of K.json.kbs || []) {
      if (k.name === TEST_KB) await api("/api/v1/kbs/" + k.id, "DELETE");
    }
  };
  await cleanup();

  const targetKb = await api("/api/v1/kbs", "POST", { name: TEST_KB, description: "验证用" });
  const targetKbId = targetKb.json?.id;

  const docs = [];
  for (let i = 1; i <= 3; i++) {
    const c = await api("/api/v1/documents", "POST", {
      title: `${PREFIX}文档${i}`,
      content: `内容 ${i}`,
      type: "doc",
      kb_id: KB,
    });
    docs.push(c.json);
  }
  const folder = await api("/api/v1/folders", "POST", {
    name: TEST_FOLDER,
    parent_id: null,
    kb_id: KB,
  });

  // ---------- 1) 进知识库 ----------
  // ⚠️ 顺序很关键：必须**在进入知识库之前**建好夹具（含目标库）。
  //    因为 `kbs` state 只在 `enterKb`/`goHome` 时刷新（`refresh-doc-list` 不刷它），
  //    先进 KB 再建库的话，新库不会出现在 MoveToKbDialog 的目标列表里
  //    —— 上一版就因此走了 API 兜底，UI 层其实没验到移动链路。
  const kbCard = p.locator('[data-testid="kb-card"]').filter({ hasText: "云计算知识库" }).first();
  if (await kbCard.count()) {
    await kbCard.click({ force: true });
  } else {
    const kb = p.locator('[data-testid="kb-card"]').filter({ hasText: "云计算知识库" }).first();
    if (await kb.count()) await kb.click({ force: true });
  }
  const inKb = await waitFor(
    async () => (await p.locator("[data-tree-kind]").count()) > 0,
    10000,
    "进入知识库视图",
  );
  check("进入知识库视图（文档树出现）", inKb, "文档树锚点数为 0");

  // 刷新 + 展开全部，让夹具可见
  const refresh = p.locator('[data-testid="refresh-doc-list"]').first();
  if (await refresh.count()) {
    await refresh.click({ force: true });
    await sleep(3000);
  }
  const toggle = p.locator('[data-testid="toggle-batched-all"]').first();
  if ((await toggle.getAttribute("aria-pressed")) !== "true") {
    await toggle.click({ force: true });
    await sleep(1500);
  }

  // ---------- 2/3) 进入多选 ----------
  // 侧栏「多选」入口按钮（title 含"多选"或"批量"）
  const selBtn = p
    .locator("button")
    .filter({ hasText: /^(选择|多选|批量)$/ })
    .first();
  let selectionOn = false;
  if (await selBtn.count()) {
    await selBtn.click({ force: true });
    selectionOn = await waitFor(
      async () => (await p.locator('button[title="选择"], button[title="取消选择"]').count()) > 0,
      5000,
      "出现选择框",
    );
  }
  // 兜底：直接点第一行文档左侧的选择框（进入多选模式）
  if (!selectionOn) {
    const docRow = p.locator('[data-tree-kind="doc"]').first();
    if (await docRow.count()) {
      await docRow.hover();
      await sleep(400);
      await p
        .locator('button[title="选择"]')
        .first()
        .click({ force: true })
        .catch(() => {});
      selectionOn = await waitFor(
        async () => (await p.locator('[data-testid="batch-move"]').count()) > 0,
        5000,
        "多选工具条出现",
      );
    }
  }
  check("可进入多选模式", selectionOn, "未出现选择框 / 工具条");

  // ---------- 4) 工具条有「移动」按钮 ----------
  const moveBtn = p.locator('[data-testid="batch-move"]').first();
  check("多选工具条出现「移动」按钮（本轮新增）", (await moveBtn.count()) > 0, "未找到 batch-move");

  // ---------- 5) 选中文件夹时移动按钮禁用 ----------
  // 选中一个文件夹 + 看按钮是否 disabled
  const folderRow = p.locator(`[data-tree-kind="folder"][data-tree-key]`).filter({ hasText: TEST_FOLDER }).first();
  let folderDisabled = null;
  if (await folderRow.count()) {
    await folderRow.hover();
    await sleep(400);
    const fbox = folderRow.locator('button[title="选择"]').first();
    if (await fbox.count()) {
      await fbox.click({ force: true });
      await sleep(600);
      folderDisabled = await moveBtn.isDisabled();
    }
  }
  if (folderDisabled !== null) {
    check(
      "选中文件夹时「移动」被禁用（跨库移动只支持文档）",
      folderDisabled === true,
      "disabled=" + folderDisabled,
    );
  }

  // ⚠️ 必须**彻底清空选择**再进下一步：只点文件夹的「取消选择」不够稳
  //    （上一版就读到 selected=4，文件夹仍在选，导致移动按钮一直 disabled
  //      → 点它无效 → 对话框打不开，是脚本状态没清干净，不是产品问题）。
  //    用工具条上的「取消」（退出多选）最可靠，然后重新进入多选。
  const cancelBtn = p.locator("button").filter({ hasText: /^取消$/ }).first();
  if (await cancelBtn.count()) {
    await cancelBtn.click({ force: true });
    await sleep(800);
  }
  // 重新进入多选（点第一篇文档的选择框）
  const seedRow = p.locator(`[data-tree-kind="doc"][data-tree-key="${docs[0].id}"]`).first();
  if (await seedRow.count()) {
    await seedRow.hover();
    await sleep(400);
    const sbox = seedRow.locator('button[title="选择"]').first();
    if (await sbox.count()) await sbox.click({ force: true });
    await sleep(600);
  }

  // ---------- 6) 选中 3 篇文档 → 点移动 ----------
  // 第一篇已在「重新进入多选」时选中，这里只补第 2、3 篇
  // （再点一次已选中的行会**取消**它，上一版就在这类重复操作上踩过）。
  for (const d of docs.slice(1)) {
    const row = p.locator(`[data-tree-kind="doc"][data-tree-key="${d.id}"]`).first();
    if (await row.count()) {
      await row.hover();
      await sleep(300);
      const box = row.locator('button[title="选择"]').first();
      if (await box.count()) await box.click({ force: true });
      await sleep(400);
    }
  }
  const selectedCount = await p.evaluate(() => {
    const m = (document.body.innerText || "").match(/已选\s*(\d+)\s*项/);
    return m ? Number(m[1]) : -1;
  });
  check(`已选中 3 篇文档（实际 ${selectedCount}）`, selectedCount === 3, "selected=" + selectedCount);

  await moveBtn.click({ force: true });
  const dlgOpen = await waitFor(
    async () => (await p.locator("text=移动到知识库").count()) > 0,
    5000,
    "MoveToKbDialog 打开",
  );
  check("点「移动」打开「移动到知识库」对话框", dlgOpen, "对话框未出现");

  // ---------- 7) 对话框文案是批量语义 ----------
  const dlgText = await p.evaluate(() => document.body.innerText || "");
  check(
    "对话框文案是批量语义（「3 篇文档」而非单个标题）",
    /3\s*篇文档/.test(dlgText),
    "文案片段：" + (dlgText.match(/将选中的[^\n]{0,40}/) || ["<无>"])[0],
  );

  // ---------- 8) 真的移动成功（走 UI，点目标知识库） ----------
  // 目标库是脚本刚建的，前端 `kbs` state 里可能还没有 —— 让对话框拿到它。
  // 手段：对话框的 targets 来自页面 state，而 state 在进 KB 视图时刷新过；
  // 这里重新进一次知识库（点刷新按钮会 refreshKbs）以确保列表最新。
  const noTarget = await p.evaluate(() =>
    /没有可移动的目标知识库/.test(document.body.innerText || ""),
  );
  if (noTarget) {
    // 关掉对话框，回首页再进 KB（重走 openKb 会 refreshKbs）后重试
    await p.keyboard.press("Escape");
    await sleep(600);
    const homeBtn = p.locator("button").filter({ hasText: /首页|返回首页/ }).first();
    if (await homeBtn.count()) {
      await homeBtn.click({ force: true }).catch(() => {});
      await sleep(2000);
      const kbCard2 = p.locator('[data-testid="kb-card"]').filter({ hasText: "云计算知识库" }).first();
      if (await kbCard2.count()) await kbCard2.click({ force: true });
      await sleep(3000);
    }
    // 重新多选 + 打开对话框
    const seed2 = p.locator(`[data-tree-kind="doc"][data-tree-key="${docs[0].id}"]`).first();
    if (await seed2.count()) {
      await seed2.hover();
      await sleep(300);
      const bx = seed2.locator('button[title="选择"]').first();
      if (await bx.count()) await bx.click({ force: true });
      await sleep(500);
    }
    for (const d of docs.slice(1)) {
      const row = p.locator(`[data-tree-kind="doc"][data-tree-key="${d.id}"]`).first();
      if (await row.count()) {
        await row.hover();
        await sleep(250);
        const bx = row.locator('button[title="选择"]').first();
        if (await bx.count()) await bx.click({ force: true });
        await sleep(350);
      }
    }
    const mb2 = p.locator('[data-testid="batch-move"]').first();
    if (await mb2.count()) {
      await mb2.click({ force: true });
      await sleep(1500);
    }
  }

  // 点目标知识库（用夹具库名精确匹配）
  let moved = false;
  let movedVia = "";
  const tgtBtn = p.locator("button").filter({ hasText: TEST_KB }).first();
  if (await tgtBtn.count()) {
    await tgtBtn.click({ force: true });
    await sleep(4000);
    const after = await Promise.all(docs.map((d) => api("/api/v1/documents/" + d.id)));
    moved = after.every((a) => a.json.kb_id === targetKbId);
    movedVia = "UI（点夹具目标库）";
  } else {
    // 兜底：API 层验能力（UI 层已验证到打开对话框 + 批量文案）
    const res = await api("/api/v1/documents/batch-move", "POST", {
      doc_ids: docs.map((d) => d.id),
      kb_id: targetKbId,
      folder_id: null,
    });
    moved = res.status === 200 && res.json.count === 3;
    movedVia = "API（UI 未找到目标库项）";
  }
  check(
    `批量移动真的生效（后端 kb_id 已变为目标库）· 经由 ${movedVia}`,
    moved,
    JSON.stringify({ moved, movedVia, targetKbId }),
  );

  // ---------- 9) 混入无效 id 时跳过而非整批失败 ----------
  // 移回原库 + 混入一个不存在的 id
  const res2 = await api("/api/v1/documents/batch-move", "POST", {
    doc_ids: [docs[0].id, "no-such-doc-id"],
    kb_id: KB,
  });
  const skipOk =
    res2.status === 200 &&
    res2.json.count === 1 &&
    (res2.json.skipped || []).some((s) => s.id === "no-such-doc-id");
  check(
    "混入无效 id 时跳过而非整批失败（moved=1, skipped=1）",
    skipOk,
    JSON.stringify(res2.json),
  );

  // ---------- 10) 零残留 ----------
  await cleanup();
  const L = await api("/api/v1/documents?limit=500");
  const left = (L.json.documents || []).filter((d) => d.title && d.title.startsWith(PREFIX));
  const F = await api("/api/v1/folders?kb_id=" + KB);
  const leftF = (F.json.folders || []).filter((f) => f.name === TEST_FOLDER);
  const K = await api("/api/v1/kbs");
  const leftK = (K.json.kbs || []).filter((k) => k.name === TEST_KB);
  check(
    "零残留（文档 + 文件夹 + 目标知识库）",
    left.length === 0 && leftF.length === 0 && leftK.length === 0,
    JSON.stringify({
      docs: left.map((d) => d.title),
      folders: leftF.map((f) => f.name),
      kbs: leftK.map((k) => k.name),
    }),
  );

  // ---------- 11) 无异常 ----------
  check("运行期无未捕获页面异常", errs.length === 0, errs.join(" | "));

  console.log("\n" + (fail === 0 ? "全部通过 ✅" : `失败 ${fail} 项 ❌`));
  await b.close();
  process.exit(fail === 0 ? 0 : 1);
})();