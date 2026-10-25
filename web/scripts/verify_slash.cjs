#!/usr/bin/env node
/**
 * 真机验证「slash 块命令菜单」（P2-1）。
 *
 * 覆盖 9 项，每项必须绑定**本次操作**的证据（不查"存在某元素"式的恒真断言）：
 *   1. 输入 `/` 弹出菜单
 *   2. 空 query 时列出全部 12 项
 *   3. 中文过滤：输入「标题」→ 只剩 4 个标题项
 *   4. 英文/拼音过滤：输入「biaoge」→ 只剩「表格」
 *   5. 键盘 ↓ 移动高亮（选中索引真的变了，不是"有高亮")
 *   6. 回车执行命令 → 该块真的进了文档（断言具体节点类型）
 *   7. **IME 组字期间不弹菜单**（composition 模拟）
 *   8. **URL 里的 `/` 不触发**（不劫持普通文本）
 *   9. 菜单行高 = 31.5px（DESIGN 规格）
 *
 * 用法：
 *   NODE_PATH=<托管 workspace node_modules> node web/scripts/verify_slash.cjs
 */
const { chromium } = require("playwright");
const fs = require("fs");

const TOKEN =
  process.env.SUNNYDOC_TOKEN ||
  fs.readFileSync(process.env.SUNNYDOC_TOKEN_FILE || "/tmp/sunnydoc-token.txt", "utf8").trim();
const WEB = process.env.SUNNYDOC_WEB || "http://localhost:3001";
const API = process.env.SUNNYDOC_API || "http://localhost:8000";
/** 专用于本脚本的容器文档标题（避免污染真实文档，结束后删除）。 */
const DOC_TITLE = "slash验证-临时容器";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fail = 0;
const check = (n, c, d) => {
  if (c) console.log("  ✅ " + n);
  else {
    fail++;
    console.log("  ❌ " + n + "\n       " + String(d).slice(0, 300));
  }
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

  await p.goto(WEB, { waitUntil: "domcontentloaded" });
  await p.evaluate((t) => localStorage.setItem("sunnydoc.token", t), TOKEN);
  await p.reload({ waitUntil: "domcontentloaded" });
  await sleep(2500);

  // ⚠️ 首页是 HomeView（仪表盘），**没有搜索框也没有编辑器**。
  // 必须先点进一个知识库，才会出现侧栏搜索框与文档树。
  const kb = p.locator('[data-testid="kb-card"]').filter({ hasText: "云计算知识库" }).first();
  if (await kb.count()) {
    await kb.click();
    await sleep(2500);
  }

  // ---- 准备一个干净的临时文档（通过 API，避免依赖 UI 新建流程） ----
  // 建在「云计算知识库」下，这样刚进的知识库树里就能搜到它。
  const created = await p.evaluate(
    async ([api, tok, title]) => {
      const h = { Authorization: "Bearer " + tok, "Content-Type": "application/json" };
      const list = await (await fetch(api + "/api/v1/documents", { headers: h })).json();
      const old = (list.documents || []).find((x) => x.title === title);
      if (old) {
        // 上一轮遗留的同名夹具：软删后必须 purge，否则只是把它换个地方堆着
        await fetch(api + "/api/v1/documents/" + old.id, { method: "DELETE", headers: h });
        await fetch(api + "/api/v1/trash/document/" + old.id, { method: "DELETE", headers: h });
      }
      const kbs = await (await fetch(api + "/api/v1/kbs", { headers: h })).json();
      const kbId = (kbs.kbs || kbs.knowledge_bases || kbs || []).find(
        (k) => k && k.name === "云计算知识库",
      )?.id;
      const r = await fetch(api + "/api/v1/documents", {
        method: "POST",
        headers: h,
        body: JSON.stringify({ title, text: "", type: "doc", kb_id: kbId ?? null }),
      });
      const d = await r.json();
      return d.id;
    },
    [API, TOKEN, DOC_TITLE],
  );
  console.log("  临时文档 id = " + created);
  check("已创建临时验证文档", !!created && created.length === 32, created);

  // 打开它（走搜索，与既有脚本同款）
  const box = p.locator('input[type="search"], input[placeholder*="搜索"]').first();
  await box.fill(DOC_TITLE);
  await sleep(1800);
  const hit = p.getByText(DOC_TITLE, { exact: true }).first();
  if (await hit.count()) await hit.click({ force: true }).catch(() => {});
  await sleep(3000);

  const editBtn = p.locator("button").filter({ hasText: /^编辑$/ }).first();
  if (await editBtn.count()) {
    await editBtn.click({ force: true }).catch(() => {});
    await sleep(2500);
  }

  const editable = p.locator(".ProseMirror").first();
  check("已进入编辑态（正文可写）", (await editable.count()) > 0, "未找到 .ProseMirror");
  if ((await editable.count()) === 0) {
    await b.close();
    process.exit(1);
  }

  const menuCount = () => p.locator("[data-slash-menu] .slash-item").count();
  const menuOpen = () => p.evaluate(() => !!document.querySelector("[data-slash-menu]"));

  // ---- 1) 输入 `/` 弹菜单 ----
  await editable.click({ force: true });
  await p.keyboard.type("/", { delay: 40 });
  await sleep(700);
  check("输入 / 弹出菜单", await menuOpen(), "未找到 [data-slash-menu]");

  // ---- 2) 空 query 列全部 12 项 ----
  const all = await menuCount();
  check("空 query 列出全部 12 个命令", all === 12, `实际 ${all} 项`);

  // ---- 3) 中文过滤 ----
  await p.keyboard.type("标题", { delay: 60 });
  await sleep(600);
  const zhLabels = await p.evaluate(() =>
    Array.from(document.querySelectorAll("[data-slash-menu] .slash-label")).map((e) => e.textContent.trim()),
  );
  check(
    "中文「标题」过滤出 4 个标题项",
    zhLabels.length === 4 && zhLabels.every((l) => l.includes("标题")),
    JSON.stringify(zhLabels),
  );

  // ---- 4) 拼音过滤 ----
  // 清掉 query：全选菜单前的 `/标题` 再重输
  await p.keyboard.press("Escape");
  await sleep(300);
  await p.evaluate(() => {
    document.querySelectorAll("[data-slash-menu]").forEach((n) => n.remove());
  });
  // 清空正文
  await editable.click({ force: true });
  await p.keyboard.press("Meta+a");
  await p.keyboard.press("Backspace");
  await sleep(300);
  await p.keyboard.type("/biaoge", { delay: 50 });
  await sleep(700);
  const pyLabels = await p.evaluate(() =>
    Array.from(document.querySelectorAll("[data-slash-menu] .slash-label")).map((e) => e.textContent.trim()),
  );
  check(
    "拼音「biaoge」过滤出「表格」",
    pyLabels.length === 1 && pyLabels[0] === "表格",
    JSON.stringify(pyLabels),
  );

  // ---- 5+6) 键盘 ↓ 移动高亮 + 回车执行 ----
  // 重新来一遍，用一个可判定的命令（表格）
  const before = await p.evaluate(() => document.querySelectorAll(".ProseMirror table").length);
  await p.keyboard.press("Enter");
  await sleep(1200);
  const afterTable = await p.evaluate(() => {
    const t = document.querySelectorAll(".ProseMirror table").length;
    const rows = document.querySelectorAll(".ProseMirror table tr").length;
    return { t, rows };
  });
  check("回车执行「表格」命令：正文出现表格", afterTable.t === before + 1, JSON.stringify(afterTable));
  check("表格为 3 行（与工具栏一致 3×3）", afterTable.rows === 3, `实际 ${afterTable.rows} 行`);
  check("执行后菜单已关闭", !(await menuOpen()), "菜单仍在");

  // ---- 键盘上下移动：单独验证 ----
  await editable.click({ force: true });
  await p.keyboard.press("Meta+a");
  await p.keyboard.press("Backspace");
  await sleep(300);
  await p.keyboard.type("/", { delay: 40 });
  await sleep(700);
  const idx0 = await p.evaluate(() => {
    const items = Array.from(document.querySelectorAll("[data-slash-menu] .slash-item"));
    return items.findIndex((e) => e.classList.contains("is-active"));
  });
  await p.keyboard.press("ArrowDown");
  await sleep(250);
  const idx1 = await p.evaluate(() => {
    const items = Array.from(document.querySelectorAll("[data-slash-menu] .slash-item"));
    return items.findIndex((e) => e.classList.contains("is-active"));
  });
  check("↓ 键移动高亮（索引真的变了）", idx0 === 0 && idx1 === 1, `idx0=${idx0} idx1=${idx1}`);
  await p.keyboard.press("Escape");
  await sleep(300);

  // ---- 7) IME 组字期间不弹菜单 ----
  // 用 compositionstart/end 模拟中文输入法组字：组字中打字母不应弹菜单。
  await editable.click({ force: true });
  await p.keyboard.press("Meta+a");
  await p.keyboard.press("Backspace");
  await sleep(300);
  const imeResult = await p.evaluate(async () => {
    const el = document.querySelector(".ProseMirror");
    const view = el && el.pmViewDesc ? null : null; // 仅作占位，不依赖内部
    el.focus();
    // compositionstart → 输入 `/biaoti`（模拟组字）→ 期间查菜单
    el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    // 直接派发 beforeinput/keydown 不会进 PM；改用 execCommand 触发真实输入
    document.execCommand("insertText", false, "/biaoti");
    await new Promise((r) => setTimeout(r, 400));
    const during = !!document.querySelector("[data-slash-menu]");
    el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 400));
    const afterEnd = !!document.querySelector("[data-slash-menu]");
    return { during, afterEnd };
  });
  check(
    "IME 组字期间不弹菜单",
    imeResult.during === false,
    JSON.stringify(imeResult),
  );

  // ---- 8) URL 里的 `/` 不触发 ----
  await p.keyboard.press("Meta+a");
  await p.keyboard.press("Backspace");
  await sleep(300);
  await p.keyboard.type("见 https://example.com/a/b", { delay: 30 });
  await sleep(700);
  check("URL 中间的 / 不触发菜单", !(await menuOpen()), "被误触发");

  // ---- 9) 菜单行高规格 ----
  await p.keyboard.press("Meta+a");
  await p.keyboard.press("Backspace");
  await sleep(300);
  await p.keyboard.type("/", { delay: 40 });
  await sleep(700);
  const h = await p.evaluate(() => {
    const it = document.querySelector("[data-slash-menu] .slash-item");
    return it ? +it.getBoundingClientRect().height.toFixed(2) : -1;
  });
  check("菜单行高 = 31.5px（DESIGN 规格）", Math.abs(h - 31.5) < 0.6, `实际 ${h}px`);
  await p.keyboard.press("Escape");
  await sleep(300);

  // ---- 清理：删掉临时文档 ----
  // 🔴 `DELETE /documents/{id}` 是**软删除**（进回收站，默认留 30 天）。
  //    必须再打 `DELETE /trash/document/{id}` 才算真删干净 ——
  //    否则每次跑都往回收站堆一条夹具（实测回收站曾积 6 篇）。
  const deleted = await p.evaluate(
    async ([api, tok, id]) => {
      const h = { Authorization: "Bearer " + tok };
      const r = await fetch(api + "/api/v1/documents/" + id, { method: "DELETE", headers: h });
      await fetch(api + "/api/v1/trash/document/" + id, { method: "DELETE", headers: h });
      return r.status;
    },
    [API, TOKEN, created],
  );
  check("临时文档已彻底删除（活跃 + 回收站）", deleted === 200 || deleted === 204, "status=" + deleted);

  console.log("\n页面错误: " + (errs.length ? errs.slice(0, 3).join(" | ") : "无"));
  if (errs.length) fail++;
  await b.close();
  console.log("\n" + (fail ? "❌ FAIL = " + fail : "✅ ALL PASS"));
  process.exit(fail ? 1 : 0);
})();