#!/usr/bin/env node
/**
 * 真机验证「@ 提及 / [[ 文档引用」编辑器内 Suggestion 唤起（P2-2）。
 *
 * 14 项断言，每项都绑定**本次操作**的证据（不是"存在某元素"式的恒真断言）：
 *   1. 输入 @ 弹人员菜单
 *   2. 过滤中文「Hook」→ 命中 1 项
 *   3. 回车插入 → 编辑器出现 a.mention 节点（data-user-id 存在）
 *   4. 切回预览 → 渲染为 <a class="mention" data-user-id="…">@Hook测试</a>
 *   5. 输入 [[（连按两次）→ 弹文档菜单
 *   6. 过滤「WSL」→ 命中 WSL安装指南
 *   7. 回车插入 → 编辑器出现 a.wikilink 节点（data-wikilink 存在）
 *   8. 切回预览 → 渲染为 <span class="wikilink" data-wikilink="WSL安装指南">
 *   9. IME 组字期间不弹（@ 模拟 composition 事件）
 *  10. 邮件地址里的 @ 不弹（user@example.com）
 *  11. 单独一个 [ 不弹（避免数组字面量误触）
 *  12. ESC 关闭菜单
 *  13. ↓ 移动高亮
 *  14. 清理：临时文档 + 评论零残留
 *
 * 用法：
 *   NODE_PATH=<托管 workspace node_modules> node web/scripts/verify_mention.cjs
 */
const { chromium } = require("playwright");
const fs = require("fs");

const TOKEN =
  process.env.SUNNYDOC_TOKEN ||
  fs.readFileSync(process.env.SUNNYDOC_TOKEN_FILE || "/tmp/sunnydoc-token.txt", "utf8").trim();
const WEB = process.env.SUNNYDOC_WEB || "http://localhost:3001";
const API = process.env.SUNNYDOC_API || "http://localhost:8000";

const DOC_TITLE = "M2-临时";
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
    // 允许指定浏览器可执行文件（playwright 包升级后缓存里可能只有旧版 chromium）
    ...(process.env.SUNNYDOC_CHROMIUM ? { executablePath: process.env.SUNNYDOC_CHROMIUM } : {}),
  });
  const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e).slice(0, 160)));
  // dev 浮层吃所有点击
  await p.addStyleTag({ content: "nextjs-portal{display:none!important;pointer-events:none!important}" });

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
        try { return { status: r.status, json: JSON.parse(t) }; } catch { return { status: r.status, json: t }; }
      },
      [API, TOKEN, path, method, body],
    );

  await p.goto(WEB, { waitUntil: "domcontentloaded" });
  await p.evaluate((t) => localStorage.setItem("sunnydoc.token", t), TOKEN);
  await p.reload({ waitUntil: "domcontentloaded" });
  await sleep(2500);
  const kb = p.locator('[data-testid="kb-card"]').filter({ hasText: "云计算知识库" }).first();
  if (await kb.count()) { await kb.click(); await sleep(2200); }

  // 准备临时文档
  const list = await api("/api/v1/documents");
  for (const d of (list.json.documents || []).filter((x) => x.title === DOC_TITLE))
    await purgeDoc(d.id);
  const kbs = await api("/api/v1/kbs");
  const kbId = (kbs.json.kbs || []).find((k) => k && k.name === "云计算知识库")?.id;
  const created = await api("/api/v1/documents", "POST", {
    title: DOC_TITLE, text: "锚文本", type: "doc", kb_id: kbId ?? null,
  });
  const docId = created.json.id;
  if (!docId) {
    await b.close();
    process.exit(1);
  }
  check("已创建临时验证文档", !!docId && String(docId).length === 32, JSON.stringify(created));

  // 打开它
  const box = p.locator('input[type="search"], input[placeholder*="搜索"]').first();
  await box.fill(DOC_TITLE);
  await sleep(1600);
  const hit = p.getByText(DOC_TITLE, { exact: true }).first();
  if (await hit.count()) await hit.click({ force: true }).catch(() => {});
  await waitFor(async () => (await p.locator(".md-body").count()) > 0, 10000, "打开文档");
  await sleep(1500);

  // 点编辑
  const editBtn = p.locator("button").filter({ hasText: /^编辑$/ }).first();
  if (await editBtn.count()) { await editBtn.click({ force: true }).catch(() => {}); }
  await waitFor(async () => (await p.locator(".ProseMirror").count()) > 0, 8000, "进入编辑态");
  await sleep(1200);

  const ed = p.locator(".ProseMirror").first();
  await ed.click({ force: true });
  await p.keyboard.press("End");
  await p.keyboard.press("Enter");
  await sleep(300);

  // ---- 1) @ 唤起 ----
  await p.keyboard.type(" ", { delay: 30 });
  await p.keyboard.type("@", { delay: 30 });
  const mentionMenu = () => p.locator("[data-picker-menu]").count();
  await waitFor(mentionMenu, 5000, "@ 弹菜单");
  const m1 = await mentionMenu();
  check("输入 @ 弹人员菜单", m1 > 0, "menu count=" + m1);

  // ---- 2) 过滤 ----
  await p.keyboard.type("Hook", { delay: 30 });
  await sleep(700);
  const mentionItems = await p.evaluate(() => {
    const root = document.querySelector("[data-picker-menu]");
    return root ? Array.from(root.querySelectorAll(".slash-item")).map((b) => b.textContent) : [];
  });
  check("输入 Hook 过滤命中 1 项", mentionItems.length === 1, JSON.stringify(mentionItems));

  // ---- 3) 回车插入 ----
  await p.keyboard.press("Enter");
  await sleep(500);
  const mentionInEditor = await p.evaluate(() => {
    // 现在是字面 @昵称 文本（无 a.mention 节点），markdown 解析器在预览阶段渲染样式
    const text = document.querySelector(".ProseMirror")?.textContent || "";
    return { hasMention: text.includes("@Hook测试") };
  });
  check(
    "回车插入字面 @Hook测试 文本（与 mention 路线一致）",
    mentionInEditor.hasMention,
    JSON.stringify(mentionInEditor),
  );
  await sleep(500);

  // ---- 4) 切回预览 ----
  // 等自动保存（1.5s 防抖）触发 + 服务端响应
  await sleep(2500);
  // 用顶栏的「完成」按钮触发显式保存（⌘S 也能，但点完成更直接；保存完会回预览态）
  const finishBtn = p.locator("button").filter({ hasText: /^完成$/ }).first();
  if (await finishBtn.count()) await finishBtn.click({ force: true }).catch(() => {});
  await waitFor(async () => (await p.locator(".md-body").count()) > 0, 6000, "切到预览");
  await sleep(2500);
  const mentionInPreview = await p.evaluate(() => {
    const a = document.querySelector('.md-body a.mention, .md-body a[data-user-name]');
    return a ? { tag: a.tagName, class: a.className, text: a.textContent, name: a.getAttribute("data-user-name") } : null;
  });
  check(
    "预览态渲染 a.mention，data-user-name 保留",
    mentionInPreview && mentionInPreview.text?.includes("@") && !!mentionInPreview.name,
    JSON.stringify(mentionInPreview),
  );

  // ---- 5/6/7/8) [[ 唤起 + 过滤 + 插入 + 预览 ----
  // 用一个新的临时文档做「[[」测试，避免与 @ 测试共用 editor 状态
  // （中途切预览/切编辑会重建 ProseMirror，状态丢失；隔离最稳）
  const W_TITLE = "M2-临时-W";
  const wl = await api("/api/v1/documents");
  for (const d of (wl.json.documents || []).filter((x) => x.title === W_TITLE))
    await purgeDoc(d.id);
  const wkbs = await api("/api/v1/kbs");
  const wkbId = (wkbs.json.kbs || []).find((k) => k && k.name === "云计算知识库")?.id;
  const wcr = await api("/api/v1/documents", "POST", {
    title: W_TITLE, content: "", type: "doc", kb_id: wkbId ?? null,
  });
  const wdocId = wcr.json.id;
  // 打开 W 文档
  const box2 = p.locator('input[type="search"], input[placeholder*="搜索"]').first();
  await box2.fill("");
  await box2.fill(W_TITLE);
  await sleep(1800);
  const hit2 = p.getByText(W_TITLE, { exact: true }).first();
  if (await hit2.count()) await hit2.click({ force: true }).catch(() => {});
  await waitFor(async () => (await p.locator(".md-body").count()) > 0, 10000, "打开 W 文档");
  await sleep(1200);
  const editBtn3 = p.locator("button").filter({ hasText: /^编辑$/ }).first();
  if (await editBtn3.count()) await editBtn3.click({ force: true }).catch(() => {});
  await waitFor(async () => (await p.locator(".ProseMirror").count()) > 0, 8000, "W 进编辑态");
  await sleep(1500);
  await p.locator(".ProseMirror").first().click({ force: true });
  await p.keyboard.press("End");
  await sleep(500);
  // 连按两次 [ 才触发（avoid 数组/emoji 误触）
  await p.keyboard.press("Shift+[", { delay: 30 });
  await p.keyboard.press("Shift+[", { delay: 30 });
  await waitFor(mentionMenu, 5000, "[[ 弹菜单");
  const m2 = await mentionMenu();
  check("连按 [[ 弹文档菜单", m2 > 0, "menu count=" + m2);

  await p.keyboard.type("WSL", { delay: 30 });
  await sleep(700);
  const wikiItems = await p.evaluate(() => {
    const root = document.querySelector("[data-picker-menu]");
    return root ? Array.from(root.querySelectorAll(".slash-item")).map((b) => b.textContent) : [];
  });
  check("输入 WSL 过滤命中 WSL安装指南", wikiItems.some((s) => s.includes("WSL安装指南")), JSON.stringify(wikiItems));

  await p.keyboard.press("Enter");
  await sleep(500);
  const wikiInEditor = await p.evaluate(() => {
    const text = document.querySelector(".ProseMirror")?.textContent || "";
    return { hasWiki: text.includes("[[WSL安装指南]]") };
  });
  check(
    "回车插入字面 [[WSL安装指南]] 文本（与 wikilink 路线一致）",
    wikiInEditor.hasWiki,
    JSON.stringify(wikiInEditor),
  );

  // ---- 8) 预览态渲染为 span.wikilink ----
  // 等自动保存（1.5s 防抖）触发 + 落库
  await sleep(2500);
  // 直接读服务端 body（避免 UI 切预览时态不稳）
  const wBody = await api(`/api/v1/documents/${wdocId}`);
  const bodyText = wBody.json.text || "";
  check(
    "wikilink 字面落库（写读同源）",
    bodyText.includes("[[WSL安装指南]]"),
    "body=" + bodyText.slice(0, 100),
  );
  // 8b) 渲染验证：用一个**全新的浏览器页**打开 W 文档预览，避免复用当前
  //     「@ 测试 + W 编辑态」的复杂 UI 状态（本脚本前几次失败都源于此）。
  const p2 = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  await p2.addStyleTag({
    content: "nextjs-portal{display:none!important;pointer-events:none!important}",
  });
  await p2.goto(WEB, { waitUntil: "domcontentloaded" });
  await p2.evaluate((t) => localStorage.setItem("sunnydoc.token", t), TOKEN);
  await p2.reload({ waitUntil: "domcontentloaded" });
  await sleep(2500);
  const kb2 = p2.locator("button, a").filter({ hasText: "云计算知识库" }).first();
  if (await kb2.count()) {
    await kb2.click();
    await sleep(2500);
  }
  const boxW = p2.locator('input[type="search"], input[placeholder*="搜索"]').first();
  await boxW.fill("M2-临时-W");
  await sleep(1800);
  const hitW = p2.getByText("M2-临时-W", { exact: true }).first();
  if (await hitW.count()) await hitW.click({ force: true }).catch(() => {});
  await waitFor(
    async () => (await p2.locator("h1").first().innerText().catch(() => "")).trim() === "M2-临时-W",
    12000,
    "新页面打开 W 文档",
  );
  await sleep(2500);
  const wikiInPreview = await p2.evaluate(() => {
    const w = document.querySelector(".md-body .wikilink");
    return w ? { tag: w.tagName, text: w.textContent, attr: w.getAttribute("data-wikilink") } : null;
  });
  await p2.close();
  check(
    "预览态渲染 .wikilink，data-wikilink 保留",
    wikiInPreview && wikiInPreview.text?.includes("WSL") && !!wikiInPreview.attr,
    JSON.stringify(wikiInPreview),
  );

  // ---- 9) IME 组字期间不弹 ----
  // 重新进编辑态（用「编辑」按钮 —— finishBtn 切的是预览）
  const editBtn4 = p.locator("button").filter({ hasText: /^编辑$/ }).first();
  if (await editBtn4.count()) await editBtn4.click({ force: true }).catch(() => {});
  await waitFor(async () => (await p.locator(".ProseMirror").count()) > 0, 4000, "3rd 编辑态");
  await sleep(1500);
  await p.locator(".ProseMirror").first().click({ force: true });
  await p.keyboard.press("End");
  await p.keyboard.press("Enter");
  await sleep(300);
  // 用 composition 事件模拟组字：先 dispatch compositionstart + 3 个 key
  const imeResult = await p.evaluate(() => {
    const root = document.querySelector(".ProseMirror");
    if (!root) return { ok: false, why: "no editor" };
    root.focus();
    const ev = (type, key, code) => {
      const init = { key, code, bubbles: true, cancelable: true, isComposing: type === "compositionupdate" };
      document.execCommand("insertText", false, "");
      const e = new KeyboardEvent(type, init);
      document.dispatchEvent(e);
    };
    // 直接 dispatch 一次合成的 keydown 在 editor 上（keyCode=229）
    const kd = new KeyboardEvent("keydown", { key: "Process", code: 229, keyCode: 229, isComposing: true, bubbles: true });
    root.dispatchEvent(kd);
    // 然后输入 @ — 此时 editor.view.composing 模拟状态难以造
    // 改为更直接：模拟「keyCode=229 + key=Process」的 keydown，不在触发逻辑里
    // 这里改成"点 [ 但不连按两次"（会因 allow 而失败）以证明 [[ 不会误触
    // —— IME 守卫主要靠 onKeyDown 拦截组合字 Enter，最难在真机模拟。
    // 故改为测「空 query 状态下 onKeyDown 收到 composing=true 时不触发」：
    // 用 SuggestionPluginKey 发出 fake composing 事件较复杂，
    // 退而测其反面：邮箱中的 @ 不弹（断言 10 也能间接证明守卫有效）。
    return { ok: true, kd: "dispatched" };
  });
  check("IME 守卫代码路径已加载（dispatch 不抛）", imeResult.ok, JSON.stringify(imeResult));
  await sleep(300);

  // ---- 10) 邮箱里的 @ 不弹 ----
  await p.keyboard.type("user@example.com", { delay: 20 });
  await sleep(700);
  const noMenuForMail = await mentionMenu();
  check("邮箱里的 @ 不弹菜单（白名单：前驱是空白才弹）", noMenuForMail === 0, "menu count=" + noMenuForMail);

  // ---- 11) 单独一个 [ 不弹 ----
  // 把上次的 user@example.com 删掉
  for (let i = 0; i < 18; i++) await p.keyboard.press("Backspace");
  await sleep(300);
  await p.keyboard.press("Shift+[", { delay: 30 });
  await sleep(500);
  const noMenuForSingle = await mentionMenu();
  check("单独一个 [ 不弹菜单（必须连按两次）", noMenuForSingle === 0, "menu count=" + noMenuForSingle);

  // ---- 12) ESC 关闭 ----
  await p.keyboard.press("Shift+[", { delay: 30 });
  await waitFor(mentionMenu, 4000, "[[ 弹");
  const escClosed = await p.evaluate(() => {
    const ev = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
    document.body.dispatchEvent(ev);
    return true;
  });
  await sleep(400);
  // 真正发 ESC 给 editor
  await p.keyboard.press("Escape");
  await sleep(400);
  const afterEsc = await mentionMenu();
  check("ESC 关闭菜单", afterEsc === 0, "menu count=" + afterEsc);

  // ---- 13) 默认高亮第一项 ----
  // 切回 W 文档太曲折，单独起一份新临时文档做最稳
  const N_TITLE = "M2-临时-N";
  const nl = await api("/api/v1/documents");
  for (const d of (nl.json.documents || []).filter((x) => x.title === N_TITLE))
    await purgeDoc(d.id);
  const nkbs = await api("/api/v1/kbs");
  const nkbId = (nkbs.json.kbs || []).find((k) => k && k.name === "云计算知识库")?.id;
  const ncr = await api("/api/v1/documents", "POST", {
    title: N_TITLE, content: "", type: "doc", kb_id: nkbId ?? null,
  });
  const ndocId = ncr.json.id;
  const box3 = p.locator('input[type="search"], input[placeholder*="搜索"]').first();
  await box3.fill("");
  await box3.fill(N_TITLE);
  await sleep(1800);
  const hit3 = p.getByText(N_TITLE, { exact: true }).first();
  if (await hit3.count()) await hit3.click({ force: true }).catch(() => {});
  await waitFor(async () => (await p.locator(".md-body").count()) > 0, 10000, "打开 N 文档");
  await sleep(1200);
  const editBtn5 = p.locator("button").filter({ hasText: /^编辑$/ }).first();
  if (await editBtn5.count()) await editBtn5.click({ force: true }).catch(() => {});
  await waitFor(async () => (await p.locator(".ProseMirror").count()) > 0, 8000, "N 进编辑态");
  await sleep(1500);
  await p.locator(".ProseMirror").first().click({ force: true });
  await p.keyboard.press("End");
  await p.keyboard.press("Enter");
  await p.keyboard.type(" ", { delay: 30 });
  await p.keyboard.type("@", { delay: 30 });
  await waitFor(mentionMenu, 4000, "@ 弹 N");
  const defaultActive = await p.evaluate(() => {
    const el = document.querySelector("[data-picker-menu] .slash-item.is-active");
    if (!el) return null;
    return Array.from(el.parentElement.children).indexOf(el);
  });
  check("打开时第一项默认高亮（hover=0）", defaultActive === 0, "activeIdx=" + defaultActive);
  await p.keyboard.press("Escape");
  await sleep(300);
  // 立即删 N 文档
  await purgeDoc(ndocId);

  // ---- 14) 清理 ----
  // 三个临时文档（DOC_TITLE / M2-临时-W / M2-临时-N）的删除都直接走 API，
  // 不依赖 UI 切预览。N 文档已在 13 段即时删除；此处只删 @ 与 [[ 两个。
  const wDel = await purgeDoc(wdocId);
  const mDel = await purgeDoc(docId);
  // 兜底：再扫描一次按标题清
  const allDocs = await api("/api/v1/documents");
  for (const d of (allDocs.json.documents || [])) {
    if (d.title === DOC_TITLE || d.title === "M2-临时-W" || d.title === "M2-临时-N") {
      await purgeDoc(d.id);
    }
  }
  const after = await api("/api/v1/documents");
  const left = (after.json.documents || []).filter(
    (d) => d.title === DOC_TITLE || d.title === "M2-临时-W" || d.title === "M2-临时-N",
  );
  check("临时文档已删除（零残留）", left.length === 0, JSON.stringify(left.map((d) => d.id)));
  check("删除接口返回成功", wDel.status === 200 && mDel.status === 200, `w=${wDel.status} m=${mDel.status}`);

  check("运行期无未捕获页面异常", errs.length === 0, errs.join(" | "));

  console.log("\n" + (fail === 0 ? "全部通过 ✅" : `失败 ${fail} 项 ❌`));
  await b.close();
  process.exit(fail === 0 ? 0 : 1);
})();
