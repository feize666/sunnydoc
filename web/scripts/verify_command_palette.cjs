#!/usr/bin/env node
/**
 * 真机验证「命令面板」的可用性与统一检索入口（P4-2）。
 *
 * 背景（2026-10-17 实测出的真实缺陷）：
 *   命令面板里 `Command.action` 是**可选**的，而「全文搜索」「系统设置」
 *   两项没有接线 —— 点击后只关闭面板、焦点掉到 body，什么都没发生：
 *     panelOpen:false, active:"BODY", hasSearchBox:false
 *   用户会以为功能坏了。这类「假按钮」不报错、不崩溃，属最难发现的一类。
 *
 * 断言（10 项）：
 *   1. ⌘K 能打开命令面板
 *   2. 每一项命令都有 action（渲染层用 data-disabled 标记无 action 的项）
 *   3. 点「全文搜索」→ 焦点落到侧栏搜索框（而非掉到 body）
 *   4. 点「系统设置」→ 真的进入设置视图
 *   5. 输入关键词能过滤命令
 *   6. 输入标签名 → 出现「标签」分组并列出匹配标签（含篇数）
 *   7. 点标签项 → 侧栏进入该标签的浏览视图
 *   8. 输入文档关键词 → 出现「文档搜索结果」分组
 *   9. 无 action 的命令键盘 Enter 不会静默关闭面板（兜底）
 *   10. 零残留 + 无运行期异常
 *
 * 夹具：本脚本自建 2 篇带标签的文档（标签功能实测时全库 0 标签，
 * 必须自己造数据才测得到），结束后清理。
 *
 * 用法：
 *   NODE_PATH=<托管 workspace node_modules> node web/scripts/verify_command_palette.cjs
 */
const { chromium } = require("playwright");
const fs = require("fs");

const TOKEN =
  process.env.SUNNYDOC_TOKEN ||
  fs.readFileSync(process.env.SUNNYDOC_TOKEN_FILE || "/tmp/sunnydoc-token.txt", "utf8").trim();
const WEB = process.env.SUNNYDOC_WEB || "http://localhost:3001";
const API = process.env.SUNNYDOC_API || "http://localhost:8000";
const KB = process.env.SUNNYDOC_KB || "fdef57f179384d679b62a3c4bae2d2e3";
/** 夹具前缀：清理时按它精确匹配，绝不误删用户内容 */
const PREFIX = "CMD-";
const TAG_A = "CMD-标签甲";
const TAG_B = "CMD-标签乙";
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

  // ---------- 夹具：2 篇带标签的文档 ----------
  const cleanup = async () => {
    const L = await api("/api/v1/documents?limit=500");
    for (const d of L.json.documents || []) {
      if (d.title && d.title.startsWith(PREFIX)) await purgeDoc(d.id);
    }
    // 标签本身没有「删除标签实体」的概念（标签由文档 tags 聚合而来），
    // 文档删掉后标签自然消失。但 fetch 过的内容寻址文件由后端去重管理，无需处理。
  };
  await cleanup();

  const docIds = [];
  for (const [title, tag] of [
    [`${PREFIX}甲文档`, TAG_A],
    [`${PREFIX}乙文档`, TAG_B],
  ]) {
    const c = await api("/api/v1/documents", "POST", {
      title,
      content: `${title} 的正文内容，用于命令面板检索验证。`,
      type: "doc",
      kb_id: KB,
    });
    if (c.json?.id) {
      docIds.push(c.json.id);
      await api("/api/v1/documents/" + c.json.id + "/tags", "PUT", { tags: [tag] });
    }
  }
  const tagStats = await api("/api/v1/tags/stats");
  const hasFixtureTags = (tagStats.json?.tags || []).some((t) => t.tag === TAG_A);
  console.log(
    `  夹具已建：${docIds.length} 篇文档 · 标签「${TAG_A}」存在=${hasFixtureTags}（全库标签数 ${(tagStats.json?.tags || []).length}）`,
  );

  // 进知识库（面板的搜索/标签都要在 kb 视图下才有落点）
  const kb = p.locator('[data-testid="kb-card"]').filter({ hasText: "云计算知识库" }).first();
  if (await kb.count()) await kb.click({ force: true });
  await sleep(2500);

  // ---------- 1) 打开面板 ----------
  await p.keyboard.press("Meta+k");
  const opened = await waitFor(
    async () => (await p.locator('input[placeholder*="搜索命令"]').count()) > 0,
    5000,
    "命令面板打开",
  );
  check("⌘K 打开命令面板", opened, "面板未出现");
  if (!opened) {
    await cleanup();
    await b.close();
    process.exit(1);
  }

  // ---------- 2) 每一项命令都有 action ----------
  const cmdStates = await p.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="palette-command"]')).map((e) => ({
      label: e.textContent.trim().slice(0, 24),
      noAction: e.getAttribute("data-disabled") === "1" || e.hasAttribute("disabled"),
    })),
  );
  const dead = cmdStates.filter((c) => c.noAction);
  check(
    "每一项命令都接了 action（无「点了没反应」的假按钮）",
    dead.length === 0,
    `未接线: ${JSON.stringify(dead.map((d) => d.label))}`,
  );

  // ---------- 3) 「全文搜索」真的聚焦搜索框 ----------
  const searchItem = p.locator("[data-index]").filter({ hasText: /全文搜索/ }).first();
  let focusedOk = false;
  if (await searchItem.count()) {
    await searchItem.click({ force: true });
    focusedOk = await waitFor(
      async () =>
        (await p.evaluate(() => document.activeElement?.getAttribute("data-testid") || "")) ===
        "sidebar-search",
      5000,
      "焦点落到侧栏搜索框",
    );
  }
  check("点「全文搜索」后焦点落到侧栏搜索框（修前掉到 body）", focusedOk, "焦点不在 sidebar-search");

  // ---------- 4) 「系统设置」真的进设置视图 ----------
  await p.keyboard.press("Meta+k");
  await sleep(700);
  const settingsItem = p.locator("[data-index]").filter({ hasText: /系统设置/ }).first();
  let settingsOk = false;
  if (await settingsItem.count()) {
    await settingsItem.click({ force: true });
    settingsOk = await waitFor(
      async () => (await p.evaluate(() => location.hash || "")) .includes("settings"),
      5000,
      "进入设置视图",
    );
  }
  check("点「系统设置」后真的进入设置视图", settingsOk, "hash 未变为 settings");

  // 回到知识库。
  // ⚠️ 不能靠点首页的 kb-card —— 设置页是**整页形态**（`#/settings`），
  //    侧栏与首页卡片都不在 DOM 里，`kb.count()` 为 0，这一步会静默失败，
  //    导致后面所有「侧栏相关」的断言全挂（首版就栽在这，白报 1 项）。
  //    正解：先把 hash 清回根路径（= 首页），再点卡片进库。
  await p.evaluate(() => {
    history.pushState(null, "", location.pathname);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await sleep(1500);
  const kbBack = p.locator('[data-testid="kb-card"]').filter({ hasText: "云计算知识库" }).first();
  if (await kbBack.count()) await kbBack.click({ force: true });
  await sleep(2500);
  const inKb = await waitFor(
    async () => (await p.locator('[data-testid="sidebar-search"]').count()) > 0,
    6000,
    "回到知识库视图",
  );
  check("能从设置页回到知识库（后续断言的前提）", inKb, "侧栏搜索框未出现");

  // ---------- 5) 输入过滤命令 ----------
  await p.keyboard.press("Meta+k");
  await sleep(700);
  const box = p.locator('input[placeholder*="搜索命令"]').first();
  await box.fill("导");
  await sleep(600);
  const filtered = await p.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="palette-command"]')).map((e) =>
      e.textContent.trim(),
    ),
  );
  // 断言「只剩含该关键词的命令」：输入「导」应只留「导入文档」。
  // ⚠️ 必须用 palette-command 选择器 —— 输入关键词后**文档搜索结果也会**
  //    进入 [data-index] 列表（实测混进 50+ 条），用 data-index 数会把
  //    结果项算成"命令没被过滤"（本脚本首版就误报过）。
  check(
    "输入关键词能过滤命令（只留命中的）",
    filtered.length > 0 && filtered.length < 5 && filtered.every((t) => t.includes("导")),
    `剩 ${filtered.length} 项命令: ${JSON.stringify(filtered.slice(0, 4))}`,
  );

  // ---------- 6/7) 标签检索 + 点击进入标签浏览 ----------
  await box.fill(TAG_A);
  await sleep(1200);
  const tagHits = await p.locator('[data-testid="palette-tag"]').count();
  check("输入标签名 → 出现标签匹配项（统一检索入口）", tagHits > 0, `命中 ${tagHits} 项`);

  let tagOpenOk = false;
  if (tagHits > 0) {
    // 校验篇数显示（标签项应带「N 篇」）
    const tagText = await p.locator('[data-testid="palette-tag"]').first().innerText();
    const hasCount = /\d+\s*篇/.test(tagText);
    check("标签项显示所属文档篇数", hasCount, `文本=${tagText}`);

    await p.locator('[data-testid="palette-tag"]').first().click({ force: true });
    tagOpenOk = await waitFor(
      async () =>
        (await p.evaluate((tag) => {
          // 本质判据：侧栏标签 chip 里**被点的那个标签**进入激活态。
          // 只查 body 是否含标签名会假过（面板/标题里本来就有这个名字）；
          // 只查「任意 chip 激活」也不够 —— 要确认是它。
          const chips = Array.from(
            document.querySelectorAll('[data-testid="sidebar-tag-chip"]'),
          );
          return chips.some(
            (c) => c.getAttribute("data-active") === "1" && c.textContent.includes(tag),
          );
        }, TAG_A)),
      6000,
      "侧栏标签进入激活态",
    );
  } else {
    check("标签项显示所属文档篇数", false, "无标签项");
  }
  check("点标签项 → 进入该标签的浏览视图（侧栏 chip 激活）", tagOpenOk, "未见激活态");

  // ---------- 8) 文档搜索结果分组 ----------
  await p.keyboard.press("Meta+k");
  await sleep(700);
  await p.locator('input[placeholder*="搜索命令"]').first().fill("命令面板检索验证");
  await sleep(1800);
  const resultGroup = await p.evaluate((prefix) => {
    const txt = document.body.innerText || "";
    return {
      hasHeader: /文档搜索结果/.test(txt),
      hasFixture: new RegExp(prefix).test(txt),
    };
    // ⚠️ Node 变量不会自动出现在浏览器上下文，必须显式传参
    //    （首版直接引用 PREFIX → ReferenceError: PREFIX is not defined）
  }, PREFIX);
  check(
    "输入正文关键词 → 出现「文档搜索结果」分组并命中夹具",
    resultGroup.hasHeader && resultGroup.hasFixture,
    JSON.stringify(resultGroup),
  );

  // ---------- 9) 兜底：无 action 的命令 Enter 不应静默关闭 ----------
  // 当前所有命令都有 action，故这里验证「面板在 Enter 后有明确结果」：
  // 用「切换主题」——它必然改 html data-theme，可观测。
  const themeBefore = await p.evaluate(() => document.documentElement.dataset.theme || "");
  await p.locator('input[placeholder*="搜索命令"]').first().fill("切换主题");
  await sleep(700);
  await p.keyboard.press("Enter");
  await sleep(900);
  const themeAfter = await p.evaluate(() => document.documentElement.dataset.theme || "");
  check("Enter 执行命令确实产生可观测效果（切换主题）", themeBefore !== themeAfter, `${themeBefore} → ${themeAfter}`);

  // ---------- 10) 清理 + 异常 ----------
  await cleanup();
  const L = await api("/api/v1/documents?limit=500");
  const left = (L.json.documents || []).filter((d) => d.title.startsWith(PREFIX));
  const tagLeft = await api("/api/v1/tags/stats");
  const tagLeftNames = (tagLeft.json?.tags || []).map((t) => t.tag).filter((t) => t.startsWith(PREFIX));
  check(
    "零残留（夹具文档 + 夹具标签）",
    left.length === 0 && tagLeftNames.length === 0,
    JSON.stringify({ docs: left.map((d) => d.title), tags: tagLeftNames }),
  );
  check("运行期无未捕获页面异常", errs.length === 0, errs.slice(0, 3).join(" | "));

  console.log("\n" + (fail === 0 ? "全部通过 ✅" : `失败 ${fail} 项 ❌`));
  await b.close();
  process.exit(fail === 0 ? 0 : 1);
})();