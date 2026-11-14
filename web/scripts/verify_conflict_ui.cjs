#!/usr/bin/env node
/**
 * 冲突对话框 UI 护栏：API 返回 409 之后，用户**必须真的看到**提示并能做选择。
 *
 * ## 为什么 API 层护栏不够
 *
 * `verify_collab_conflict.cjs` 证明了「409 会被拒、数据不被静默覆盖」。
 * 但那只是后端履约。真正的风险在中间那段：
 * `Editor.tsx` 收到 `RevisionConflictError` 后若没把状态接到 `ConflictDialog`，
 * 用户看到的是「保存失败」或**什么都没有** —— 草稿还在内存里，一旦刷新就丢。
 *
 * 后端全绿 + 前端白做 = 数据照样丢。
 *
 * ## 场景（真实点击，不打桩）
 *
 * 1. 打开文档 → 进编辑态 → 本地键入（不保存）
 * 2. 「另一个用户」通过 API 改同一文档（让本地 revision 过期）
 * 3. 本地按 Cmd+S → 服务端 409 → 应弹出「该文档已被他人修改」
 * 4. 断言三个出口按钮齐全
 * 5. 点「保留我的」→ **回库核对**内容确实是本地那份（不是只看对话框关了）
 */
const { chromium } = require("playwright");
const fs = require("fs");

const API = process.env.SUNNYDOC_API || "http://127.0.0.1:8000";
const WEB = process.env.SUNNYDOC_WEB || "http://localhost:3001";
const KB = process.env.SUNNYDOC_KB || "fdef57f179384d679b62a3c4bae2d2e3";
const TOKEN =
  process.env.SUNNYDOC_TOKEN ||
  fs.readFileSync(process.env.SUNNYDOC_TOKEN_FILE || "/tmp/sunnydoc-token.txt", "utf8").trim();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
const check = (n, ok, d) => {
  if (ok) {
    pass++;
    console.log("  ✅ " + n);
  } else {
    fail++;
    console.log("  ❌ " + n + "\n       " + String(d).slice(0, 260));
  }
};

async function j(path, method = "GET", body) {
  const r = await fetch(API + "/api/v1" + path, {
    method,
    headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  try {
    return { status: r.status, json: JSON.parse(t) };
  } catch {
    return { status: r.status, json: { raw: t.slice(0, 200) } };
  }
}

(async () => {
  const TITLE = "UI冲突-护栏夹具";
  const c = await j("/documents", "POST", {
    title: TITLE,
    content: "初始内容，用于 UI 冲突护栏。",
    type: "doc",
    kb_id: KB,
  });
  const did = c.json?.id;
  if (!did) {
    console.log("❌ 建夹具失败:", JSON.stringify(c.json).slice(0, 200));
    process.exit(1);
  }
  console.log(`夹具 ${did.slice(0, 8)}`);

  const b = await chromium.launch({ headless: true, args: ["--no-proxy-server"] });
  try {
    const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 }, locale: "zh-CN" });
    const p = await ctx.newPage();
    await p.addInitScript((t) => localStorage.setItem("sunnydoc.token", t), TOKEN);
    p.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 140)));

    await p.goto(WEB + "/", { waitUntil: "domcontentloaded" });
    await sleep(3000);
    // Next dev 的 <nextjs-portal> 会吃掉指针事件
    await p.addStyleTag({
      content: "nextjs-portal{display:none!important;pointer-events:none!important}",
    });

    await p.locator('[data-testid="kb-card"]').first().click();
    for (let i = 0; i < 50; i++) {
      if (await p.evaluate(() => document.querySelectorAll("[data-tree-kind]").length > 0)) break;
      await sleep(300);
    }
    await sleep(800);

    await p.fill('[data-testid="tree-filter"]', TITLE);
    await sleep(900);
    const row = p.locator('[data-tree-kind="doc"]:visible').first();
    check("树里能找到夹具", (await row.count()) > 0, "过滤后无结果");
    if ((await row.count()) === 0) throw new Error("夹具不可见");

    await row.click();
    for (let i = 0; i < 40; i++) {
      if (await p.evaluate(() => (document.querySelector(".md-body")?.innerText || "").length > 0)) break;
      await sleep(200);
    }
    await sleep(500);

    // 进编辑态
    const editBtn = p.locator("button").filter({ hasText: /^编辑$/ }).first();
    if (await editBtn.count()) await editBtn.click();
    else await p.locator(".md-body").first().click();
    await sleep(1200);

    const editable = await p.evaluate(() => {
      const pm = document.querySelector(".ProseMirror");
      return pm ? pm.getAttribute("contenteditable") : null;
    });
    check("进入编辑态", editable === "true", `contenteditable=${editable}`);

    // 本地键入（不保存）
    await p.locator(".ProseMirror").first().click();
    await p.keyboard.type("【本地未保存改动】", { delay: 20 });
    await sleep(600);

    // 「另一个用户」改同一文档
    const before = await j("/documents/" + did);
    const remote = await j("/documents/" + did, "PUT", {
      content: "【他人保存的新内容】",
      expected_revision: before.json.revision,
    });
    check("模拟他人保存成功", remote.status === 200, `status=${remote.status}`);

    // 本地保存 → 409 → 应弹对话框
    await p.keyboard.press("Meta+s");
    let dlg = false;
    let btns = [];
    for (let i = 0; i < 40; i++) {
      const st = await p.evaluate(() => ({
        has: document.body.innerText.includes("该文档已被他人修改"),
        btns: Array.from(document.querySelectorAll("button"))
          .map((x) => x.innerText.trim())
          .filter((x) => ["保留我的", "采用对方", "继续编辑"].includes(x)),
      }));
      if (st.has) {
        dlg = true;
        btns = st.btns;
        break;
      }
      await sleep(300);
    }
    check("冲突对话框出现", dlg, "等待 12s 仍未出现");
    check(
      `三个出口齐全（实测 ${JSON.stringify(btns)}）`,
      btns.length === 3,
      "缺少按钮意味着用户无法处置冲突，只能刷新丢草稿",
    );

    if (dlg) {
      await p.locator("button").filter({ hasText: "保留我的" }).first().click();
      await sleep(2500);
      // ⚠️ 回库核对：不能只看「对话框关了」就算成功
      const after = await j("/documents/" + did);
      check(
        "「保留我的」后库里确实是本地内容",
        String(after.json.text || "").includes("本地未保存改动"),
        `实际=${JSON.stringify(String(after.json.text || "").slice(0, 60))}`,
      );
      const gone = await p.evaluate(() => !document.body.innerText.includes("该文档已被他人修改"));
      check("对话框已关闭", gone, "对话框仍在");
    }
  } finally {
    await b.close().catch(() => {});
    await j("/documents/" + did, "DELETE").catch(() => {});
    await j("/trash/document/" + did, "DELETE").catch(() => {});
    console.log("\n  夹具已清理");
  }

  console.log(`\n通过 ${pass} / 失败 ${fail}`);
  console.log(fail === 0 ? "✅ 全部通过" : "❌ 存在失败项");
  process.exit(fail ? 1 : 0);
})();