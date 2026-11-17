#!/usr/bin/env node
/**
 * 编辑器「降级后仍能保存吗」护栏。
 *
 * ## 场景（真实用户会遇到的）
 *
 * A 把知识库共享给 B（可编辑），B 打开文档开始编辑；
 * 此时 A 把 B 降级为「只读」。**B 的编辑器还开着** —— 他按下保存会怎样？
 *
 * 三种可能的结果，只有第三种是对的：
 *   ① 保存成功 → 降级形同虚设（最严重）
 *   ② 保存被拒但**界面毫无提示** → 用户以为存上了，实际丢了（第二严重）
 *   ③ 保存被拒 + **明确提示无权限** → 正确
 *
 * ## 为什么必须实测 UI
 *
 * 服务端拒绝这件事 `verify_perm_ttl.cjs` 已经证过了。
 * 但「用户能不能知道」是前端的事 —— `Editor.tsx` 的 `catch` 分支
 * 若把 403 当成普通错误静默吞掉，用户会一直以为自己保存成功，
 * 关掉页面内容就没了。**后端正确 + 前端不告诉 = 数据丢失**。
 *
 * ## 踩过的坑
 *
 * `[data-testid="tree-filter"]` **只在搜索模式下出现**。共享库里通常只有
 * 一两篇文档，直接点树行即可；硬等过滤框会出现 30s 超时。
 */
const { chromium } = require("playwright");
const fs = require("fs");

const API = process.env.SUNNYDOC_API || "http://127.0.0.1:8000";
const WEB = process.env.SUNNYDOC_WEB || "http://localhost:3001";
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
    console.log("  ❌ " + n + "\n       " + String(d).slice(0, 300));
  }
};

async function j(path, method = "GET", body, token = TOKEN) {
  const h = { "Content-Type": "application/json" };
  if (token) h.Authorization = "Bearer " + token;
  const r = await fetch(API + "/api/v1" + path, {
    method,
    headers: h,
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  let parsed;
  try {
    parsed = JSON.parse(t);
  } catch {
    parsed = { raw: t.slice(0, 200) };
  }
  return { status: r.status, json: parsed };
}

async function login(u, p = "admin123") {
  const r = await j("/auth/login", "POST", { username: u, password: p }, null);
  return r.json?.token;
}

(async () => {
  const uname = `edit-w-${Date.now().toString(36)}`;
  const cu = await j("/users", "POST", { username: uname, password: "Test1234!", role: "user" });
  const uid = (cu.json.user || cu.json).id;
  const wtoken = await login(uname, "Test1234!");
  const kb = await j("/kbs", "POST", { name: `EDIT-KB-${Date.now().toString(36)}`, description: "编辑器降级" });
  const KB = kb.json.id || kb.json.kb?.id;
  const doc = await j("/documents", "POST", {
    title: "EDIT-降级靶子",
    content: "原始内容",
    type: "doc",
    kb_id: KB,
  });
  const DID = doc.json.id;
  await j(`/kbs/${KB}/shares`, "POST", { username: uname, permission: "write" });

  const b = await chromium.launch({ headless: true, args: ["--no-proxy-server"] });
  try {
    const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 }, locale: "zh-CN" });
    const p = await ctx.newPage();
    await p.addInitScript((t) => localStorage.setItem("sunnydoc.token", t), wtoken);
    await p.goto(WEB + "/", { waitUntil: "domcontentloaded" });
    await sleep(3000);
    // Next dev 的 <nextjs-portal> 会吃掉所有指针事件
    await p.addStyleTag({ content: "nextjs-portal{display:none!important;pointer-events:none!important}" });

    // 找到被共享的知识库卡片
    const cards = p.locator('[data-testid="kb-card"]');
    const nCards = await cards.count();
    let entered = false;
    for (let i = 0; i < nCards; i++) {
      const txt = await cards.nth(i).innerText().catch(() => "");
      if (txt.includes("EDIT-KB")) {
        await cards.nth(i).click();
        entered = true;
        break;
      }
    }
    check("编写者能在首页看到被共享的库", entered, `卡片数=${nCards}`);
    if (!entered) throw new Error("未找到知识库卡片");

    for (let i = 0; i < 50; i++) {
      if (await p.evaluate(() => document.querySelectorAll("[data-tree-kind]").length > 0)) break;
      await sleep(300);
    }
    await sleep(800);

    // 不用过滤框（只在搜索模式出现）
    const row = p.locator('[data-tree-kind="doc"]:visible').first();
    check("能看到并打开该文档", (await row.count()) > 0, "树里没有该文档");
    if ((await row.count()) === 0) throw new Error("文档不可见");
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

    await p.locator(".ProseMirror").first().click();
    await p.keyboard.type("【降级前输入】", { delay: 20 });
    await sleep(600);

    // 🔴 owner 降级（编辑器还开着）
    const dg = await j(`/kbs/${KB}/shares`, "POST", { username: uname, permission: "read" });
    check("owner 把可编辑降级为只读", dg.status === 200, dg.status);
    await sleep(1000);

    // 继续编辑并保存
    await p.locator(".ProseMirror").first().click();
    await p.keyboard.type("【降级后输入】", { delay: 20 });
    await sleep(500);
    await p.keyboard.press("Meta+s");
    await sleep(3000);

    // ① 服务端必须拒绝
    const cur = await j(`/documents/${DID}`);
    const text = String(cur.json?.text || "");
    check(
      "降级后保存被服务端拒绝（库里没有降级后内容）",
      !text.includes("降级后输入"),
      `库里已含: ${text.slice(0, 90)}`,
    );

    // ② 界面必须告知用户（否则他会以为存上了）
    const ui = await p.evaluate(() => ({
      hasErr: /没有权限|无权限|保存失败|已被移除|权限不足/.test(document.body.innerText),
      head: document.body.innerText.slice(0, 300).replace(/\n+/g, " | "),
    }));
    check("界面明确提示保存失败/无权限", ui.hasErr, `界面上没有任何提示: ${ui.head}`);
  } finally {
    await b.close().catch(() => {});
    await j(`/documents/${DID}`, "DELETE");
    await j(`/trash/document/${DID}`, "DELETE");
    await j(`/kbs/${KB}`, "DELETE");
    await j(`/trash/kb/${KB}`, "DELETE");
    await j(`/users/${uid}`, "DELETE");
    console.log("\n  夹具已清理");
  }

  console.log(`\n通过 ${pass} / 失败 ${fail}`);
  console.log(fail === 0 ? "✅ 全部通过" : "❌ 存在失败项");
  process.exit(fail ? 1 : 0);
})();