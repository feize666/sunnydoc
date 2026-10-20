#!/usr/bin/env node
/**
 * 真机验证「幻灯片」类型（路线图 P1-1，补齐 `NODE_TYPES` 里唯一未实现的类型）。
 *
 * 背景：`NewNodeMenu` 里 `slides` 长期是 `available: false`，菜单能看到但点不了。
 * 本轮补齐后，从「新建」到「编辑 → 保存 → 刷新往返 → 放映 → 导出」整条链路都要真能用。
 *
 * 断言分两层（沿用 verify_discoverability 的做法，避免「菜单亮了就算过」）：
 *   A. 可达层：类型入口可用，不再 disabled
 *   B. 能力层（关键）：建出来 → 真能加元素/改文字 → **保存后刷新仍在**（数据落库）
 *      → 放映能翻页 → 导出有产物
 *      —— 只把菜单点亮、点了没反应或刷新就丢，B 层必失败
 *
 * 15 项断言：
 *   1. ⨁ 菜单里「幻灯片」不再禁用
 *   2. 点它能建出 slides 类型文档
 *   3. 并进入知识库视图（不是停在首页）
 *   4. 幻灯片编辑器真渲染出来（能力层，非空壳）
 *   5. 初始有 1 页（封面模板）+ 模板按钮齐全
 *   6. 点「文本」能加元素（元素数 +1）
 *   7. 属性条能改文字，且画布同步显示
 *   8. 拖动元素后坐标改变（逻辑坐标系换算正确）
 *   9. 加页后可切换，页码指示更新
 *  10. 保存后文档源是 pages 结构（数据真的落库）
 *  11. 重新打开 → 页数/元素/文字仍一致（往返不丢）
 *  12. 放映模式可打开且显示页码
 *  13. → 键能翻页
 *  14. Esc 退出放映
 *  15. 导出 PNG 触发下载且产物非空
 *  + 零残留、无运行期异常
 *
 * 用法：
 *   NODE_PATH=<托管 workspace node_modules> node web/scripts/verify_slides.cjs
 */
const { chromium } = require("playwright");
const fs = require("fs");

const TOKEN =
  process.env.SUNNYDOC_TOKEN ||
  fs.readFileSync(process.env.SUNNYDOC_TOKEN_FILE || "/tmp/sunnydoc-token.txt", "utf8").trim();
const WEB = process.env.SUNNYDOC_WEB || "http://localhost:3001";
const API = process.env.SUNNYDOC_API || "http://localhost:8000";
const KB = process.env.SUNNYDOC_KB || "fdef57f179384d679b62a3c4bae2d2e3";
const TITLE = "SLIDES-幻灯片验证";
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

// ⚠️ 通过菜单新建出的文档标题是「未命名幻灯片」（不是 TITLE）——脚本必须把它
// 重命名成 TITLE 再搜索，否则「重新打开」这一步必然找不到（判据与实现不对齐）。
// 另一个可选做法是建完直接用 API 搜「未命名幻灯片」，但那样会与真实用户路径脱节。
const DEFAULT_TITLE = "未命名幻灯片";

(async () => {

/**
 * 彻底删除一篇文档（软删 + 从回收站 purge）。
 *
 * 🔴 为什么不能只 `DELETE /documents/{id}`：那是**软删除**，文档会进回收站
 * 并保留（默认 30 天）。而脚本的「零残留」只查活跃列表 —— 于是**清理没清干净、
 * 断言也看不见**，回收站实测因此堆了 764 条历次夹具（2026-10-20 发现）。
 */
const purgeDoc = async (id) => {
  if (!id) return { status: 0, json: null };
  // 返回**软删那一步**的响应，保持与原写法兼容（有脚本断言 .status === 200）
  const r = await api("/api/v1/documents/" + id, "DELETE").catch(() => ({ status: 0, json: null }));
  await api("/api/v1/trash/document/" + id, "DELETE").catch(() => {});
  return r;
};

  const b = await chromium.launch({
    headless: true,
    args: ["--no-proxy-server"],
    ...(process.env.SUNNYDOC_CHROMIUM ? { executablePath: process.env.SUNNYDOC_CHROMIUM } : {}),
  });
  const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e).slice(0, 160)));
  // dev 浮层会吃掉所有指针事件
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

  const cleanup = async () => {
    const L = await api("/api/v1/documents?limit=500");
    for (const d of L.json.documents || []) {
      if (d.title === TITLE || d.title === DEFAULT_TITLE) await purgeDoc(d.id);
    }
  };
  await cleanup();

  // ---------- 进知识库 ----------
  const kb = p.locator('[data-testid="kb-card"]').filter({ hasText: "云计算知识库" }).first();
  if (await kb.count()) await kb.click({ force: true });
  await sleep(3000);

  // ---------- 1) ⨁ 菜单里「幻灯片」可用 ----------
  // 用 data-type 锚点精确取，不靠文案匹配 —— 「幻灯片」在页面上其它地方也可能出现，
  // 文案匹配会命中错误元素（本项目已多次踩到，见 MEMORY 的「点入口别用 hasText」）。
  const plus = p.locator('[data-testid="new-node-btn"]').first();
  let menuOpened = false;
  if (await plus.count()) {
    await plus.click({ force: true });
    await sleep(900);
    menuOpened = (await p.locator('[data-testid="node-type-item"]').count()) > 0;
  }
  const slideItem = p.locator('[data-testid="node-type-item"][data-type="slides"]').first();
  const slideCount = await slideItem.count();
  const slideDisabled = slideCount > 0 ? await slideItem.isDisabled() : null;
  check(
    "⨁ 菜单里「幻灯片」不再禁用",
    menuOpened && slideCount > 0 && slideDisabled === false,
    `menuOpened=${menuOpened} count=${slideCount} disabled=${slideDisabled}`,
  );

  // 顺带钉住「菜单里没有其它规划中未实现的类型」——枚举漏项/半成品最容易悄悄累积
  const unavailable = await p.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="node-type-item"][data-available="0"]')).map(
      (e) => e.getAttribute("data-type"),
    ),
  );
  check("所有节点类型均已可用（无残留「规划中」）", unavailable.length === 0, JSON.stringify(unavailable));

  // ---------- 2/3/4) 点它新建 → slides 文档 + 进 kb + 编辑器渲染 ----------
  let docId = null;
  if ((await slideItem.count()) > 0) {
    await slideItem.click({ force: true });
    await sleep(4000);
  }
  const created = await api("/api/v1/documents?limit=500");
  const mine = (created.json.documents || []).filter((d) => d.title.startsWith(DEFAULT_TITLE));
  if (mine.length > 0) docId = mine[mine.length - 1].id;
  check("点「幻灯片」能建出 slides 类型文档", !!docId, "未找到新建的 slides 文档");

  if (docId) {
    const detail = await api("/api/v1/documents/" + docId);
    check(
      "新建文档 type=slides 且初始内容为 pages 结构",
      detail.json.type === "slides" && /"pages"/.test(String(detail.json.text || "")),
      `type=${detail.json.type} text=${String(detail.json.text || "").slice(0, 120)}`,
    );
  } else {
    check("新建文档 type=slides 且初始内容为 pages 结构", false, "无 docId");
  }

  const editorUp = await waitFor(
    async () => (await p.locator('[data-testid="slide-stage"]').count()) > 0,
    12000,
    "幻灯片编辑器渲染",
  );
  check("幻灯片编辑器真的渲染出来（非空壳）", editorUp, "未出现 slide-stage");

  if (!editorUp) {
    await cleanup();
    await b.close();
    console.log("\n失败 " + fail + " 项 ❌（编辑器未渲染，后续断言跳过）");
    process.exit(1);
  }

  // ---------- 5) 初始 1 页 + 模板按钮齐全 ----------
  const tplCount = await p.locator('[data-testid^="slide-tpl-"]').count();
  const thumbInit = await p.locator('[data-testid="slide-thumb"]').count();
  check(
    "初始 1 页 + 布局模板 ≥4 套",
    thumbInit >= 1 && tplCount >= 4,
    `thumb=${thumbInit} tpl=${tplCount}`,
  );

  // ---------- 6) 加文本元素 ----------
  const beforeEl = await p.locator("[data-slide-el]").count();
  await p.locator('[data-testid="slide-add-text"]').first().click({ force: true });
  await sleep(700);
  const afterEl = await p.locator("[data-slide-el]").count();
  check("点「文本」能加元素", afterEl === beforeEl + 1, `${beforeEl} → ${afterEl}`);

  // ---------- 7) 改文字 → 画布同步 ----------
  const textInput = p.locator('[data-testid="slide-text-input"]').first();
  const hasInspector = (await textInput.count()) > 0;
  const NEW_TEXT = "验证文字XYZ";
  if (hasInspector) {
    await textInput.fill(NEW_TEXT);
    await sleep(600);
  }
  const textOnCanvas = await p.evaluate(
    (t) => Array.from(document.querySelectorAll('[data-slide-el="text"]')).some((e) => e.textContent.includes(t)),
    NEW_TEXT,
  );
  check("属性条改文字后画布同步显示", hasInspector && textOnCanvas, `inspector=${hasInspector} onCanvas=${textOnCanvas}`);

  // ---------- 8) 拖动元素 → 坐标改变（逻辑坐标系换算） ----------
  //
  // 🔴 判据必须与**实现方式**对齐，否则没有区分度：
  //    元素坐标存在 1280 逻辑坐标系里，画布被 scale 缩放过，所以
  //    「拖 N 屏幕像素」应当得到 `N / scale` 的逻辑位移，**不是** N。
  //    首版判据只写「位移在 30~400 之间」—— 实测 scale≈0.78 时
  //    正确实现得 ~154、错误实现（不除 scale）得 120，**两者都在区间内**，
  //    回滚实现照样全绿（对抗性验证当场抓到这个判据失效）。
  //    改为「与理论值比对」：先量出 scale，再要求实测贴近 N/scale。
  const dragInfo = await p.evaluate(() => {
    const el = document.querySelector('[data-slide-el="text"]');
    const stage = document.querySelector('[data-testid="slide-stage"]');
    if (!el || !stage) return null;
    const x = parseFloat(el.style.left) || 0;
    const r = el.getBoundingClientRect();
    return {
      x,
      cx: r.left + r.width / 2,
      cy: r.top + Math.min(10, r.height / 2),
      scale: stage.getBoundingClientRect().width / 1280,
    };
  });
  let movedDelta = null;
  const DRAG_PX = 300;
  if (dragInfo) {
    await p.mouse.move(dragInfo.cx, dragInfo.cy);
    await p.mouse.down();
    await p.mouse.move(dragInfo.cx + DRAG_PX, dragInfo.cy, { steps: 10 });
    await sleep(300);
    await p.mouse.up();
    await sleep(500);
    const after = await p.evaluate(() => {
      const el = document.querySelector('[data-slide-el="text"]');
      return el ? parseFloat(el.style.left) || 0 : null;
    });
    movedDelta = after === null ? null : after - dragInfo.x;
  }
  const expectLogical = dragInfo ? DRAG_PX / dragInfo.scale : 0;
  const relErr = movedDelta === null ? 1 : Math.abs(movedDelta - expectLogical) / expectLogical;
  check(
    "拖动位移按缩放比换算成逻辑坐标（基准是画布 scale，非屏幕像素）",
    movedDelta !== null && relErr < 0.15,
    `屏幕拖 ${DRAG_PX}px（scale=${dragInfo ? dragInfo.scale.toFixed(3) : "?"}）` +
      ` → 期望 ≈${Math.round(expectLogical)} 逻辑像素，实测 ${movedDelta === null ? "null" : Math.round(movedDelta)}` +
      `（未除 scale 的实现会得到 ≈${DRAG_PX}，相对误差 ${(relErr * 100).toFixed(0)}%）`,
  );

  // ---------- 9) 加页 + 页码 ----------
  await p.locator('[data-testid="slide-tpl-two-col"]').first().click({ force: true });
  await sleep(800);
  const thumbAfter = await p.locator('[data-testid="slide-thumb"]').count();
  const indicator = await p
    .locator('[data-testid="slide-thumb"][data-active="1"]')
    .first()
    .getAttribute("data-index")
    .catch(() => null);
  check(
    "加页后可切换且新页成为当前页",
    thumbAfter === thumbInit + 1 && indicator === String(thumbAfter - 1),
    `thumb ${thumbInit} → ${thumbAfter}，active=${indicator}`,
  );

  // ---------- 10) 保存后源里是 pages 结构 ----------
  // 编辑器走既有自动保存（1.5s 防抖）。等待落库并解析。
  const savedOk = await waitFor(
    async () => {
      const d = await api("/api/v1/documents/" + docId);
      try {
        const parsed = JSON.parse(String(d.json.text || ""));
        return Array.isArray(parsed.pages) && parsed.pages.length >= 2;
      } catch {
        return false;
      }
    },
    20000,
    "自动保存落库",
  );
  check("保存后文档源含 ≥2 页（数据真的落库）", savedOk, "源里页数不足或非 JSON");

  const saved = await api("/api/v1/documents/" + docId);
  let savedPages = 0;
  let savedHasText = false;
  try {
    const parsed = JSON.parse(String(saved.json.text || ""));
    savedPages = parsed.pages.length;
    savedHasText = parsed.pages.some((pg) =>
      (pg.elements || []).some((e) => e.type === "text" && String(e.text).includes(NEW_TEXT)),
    );
  } catch {
    /* 上面已判失败 */
  }
  check("落库内容含刚输入的文字（不是只存了空壳）", savedHasText, "源里找不到验证文字");

  // ---------- 11) 重新打开 → 往返一致 ----------
  // 先把「未命名幻灯片」重命名成 TITLE，否则下面的 TITLE 搜索必然落空
  // （判据必须与实现对齐：新建默认标题是「未命名幻灯片」）。
  const ren = await api("/api/v1/documents/" + docId, "PUT", { title: TITLE });
  check("可重命名（为后续搜索定位）", ren.status === 200, JSON.stringify(ren.json).slice(0, 160));

  await p.reload({ waitUntil: "domcontentloaded" });
  await sleep(2500);
  const kb2 = p.locator('[data-testid="kb-card"]').filter({ hasText: "云计算知识库" }).first();
  if (await kb2.count()) await kb2.click({ force: true });
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
  await sleep(3500);
  // 幻灯片默认进编辑态（isEdit 清单里）
  const reopened = await waitFor(
    async () => (await p.locator('[data-testid="slide-stage"]').count()) > 0,
    12000,
    "重新打开后编辑器渲染",
  );
  const reopenThumbs = await p.locator('[data-testid="slide-thumb"]').count();
  const reopenTextOk = await p.evaluate(
    (t) => Array.from(document.querySelectorAll('[data-slide-el="text"]')).some((e) => e.textContent.includes(t)),
    NEW_TEXT,
  );
  check(
    "重新打开：页数与文字仍在（往返一致）",
    reopened && reopenThumbs === savedPages && reopenTextOk,
    `reopened=${reopened} thumbs=${reopenThumbs}/${savedPages} textOk=${reopenTextOk}`,
  );

  // ---------- 12/13/14) 放映 ----------
  // 若编辑器没渲染出来（前置失败），这些断言标记失败但**不中断** ——
  // 中途抛异常会让后面的清理跑不到，留下夹具污染数据面。
  const presentBtn = p.locator('[data-testid="slide-present-btn"]').first();
  const canPresent = (await presentBtn.count()) > 0;
  if (!canPresent) {
    check("放映模式可打开且显示页码", false, "未找到「放映」按钮（编辑器未就绪）");
    check("→ 键能翻页", false, "前置未成立");
    check("Esc 退出放映", false, "前置未成立");
  } else {
    await presentBtn.click({ force: true });
    const presentUp = await waitFor(
      async () => (await p.locator('[data-testid="slide-present"]').count()) > 0,
      5000,
      "放映模式打开",
    );
    const ind0 = presentUp ? await p.locator('[data-testid="slide-present-indicator"]').innerText() : "";
    check("放映模式可打开且显示页码", presentUp && /\d+\s*\/\s*\d+/.test(ind0), `indicator=${JSON.stringify(ind0)}`);

    await p.keyboard.press("ArrowRight");
    await sleep(600);
    const ind1 = await p.locator('[data-testid="slide-present-indicator"]').innerText().catch(() => "");
    check("→ 键能翻页", presentUp && ind1 !== ind0 && /\d+\s*\/\s*\d+/.test(ind1), `${ind0} → ${ind1}`);

    await p.keyboard.press("Escape");
    await sleep(700);
    const presentClosed = (await p.locator('[data-testid="slide-present"]').count()) === 0;
    check("Esc 退出放映", presentClosed, "放映层仍在");
  }

  // ---------- 15) 导出 PNG ----------
  let downloadOk = false;
  let downloadSize = 0;
  const exportBtn = p.locator('[data-testid="slide-export-btn"]').first();
  if ((await exportBtn.count()) === 0) {
    check("导出 PNG 触发下载且产物非空", false, "未找到「导出 PNG」按钮");
  } else {
    try {
      const [dl] = await Promise.all([
        p.waitForEvent("download", { timeout: 25000 }),
        exportBtn.click({ force: true }),
      ]);
      const path = await dl.path();
      if (path) downloadSize = fs.statSync(path).size;
      const name = dl.suggestedFilename();
      downloadOk = /\.png$/.test(name) && downloadSize > 1000;
    } catch (e) {
      downloadOk = false;
      console.log("     导出异常：" + String(e).slice(0, 160));
    }
    check("导出 PNG 触发下载且产物非空", downloadOk, `size=${downloadSize}`);
  }

  // ---------- 清理 + 异常 ----------
  await cleanup();
  const L = await api("/api/v1/documents?limit=500");
  const left = (L.json.documents || []).filter((d) => d.title === TITLE);
  check("零残留", left.length === 0, JSON.stringify(left.map((d) => d.title)));
  check("运行期无未捕获页面异常", errs.length === 0, errs.slice(0, 3).join(" | "));

  console.log("\n" + (fail === 0 ? "全部通过 ✅" : `失败 ${fail} 项 ❌`));
  await b.close();
  process.exit(fail === 0 ? 0 : 1);
})();