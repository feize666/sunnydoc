#!/usr/bin/env node
/**
 * 真机验证「划词批注锚定与高亮」（P2-4）。
 *
 * 10 项断言，每项都绑定**本次操作**的证据（不用"存在某元素"式的恒真断言）：
 *   1. 划词后浮动条出现，含「批注」按钮
 *   2. 点批注 → 面板出现引用块，文本 == 选中文本
 *   3. 发布后正文出现 1 个 mark.comment-anchor，文本 == 选中文本
 *   4. 刷新重开文档 → 高亮仍在（锚点持久化 + 重新定位）
 *   5. 点正文标记 → 面板打开，该条评论带 comment-item-flash
 *   6. 点评论引用块 → 正文标记带 comment-anchor-flash
 *   7. 正文改写（保留前后缀）→ 仍锚定，且高亮跟着改写后的文本（上下文回退）
 *   8. 前后缀彻底删除 → 正文 0 标记，面板显示「未锚定」（降级而非静默丢失）
 *   9. 不带引用的普通评论不产生正文标记
 *  10. 清理：评论与临时文档零残留
 *
 * 用法：
 *   NODE_PATH=<托管 workspace node_modules> node web/scripts/verify_anchor.cjs
 */
const { chromium } = require("playwright");
const fs = require("fs");

const TOKEN =
  process.env.SUNNYDOC_TOKEN ||
  fs.readFileSync(process.env.SUNNYDOC_TOKEN_FILE || "/tmp/sunnydoc-token.txt", "utf8").trim();
const WEB = process.env.SUNNYDOC_WEB || "http://localhost:3001";
const API = process.env.SUNNYDOC_API || "http://localhost:8000";

const DOC_TITLE = "锚点验证-临时容器";
const PREFIX = "前缀固定文本AAA";
const TARGET = "目标片段BBB";
const SUFFIX = "后缀固定文本CCC";
const BODY = `${PREFIX} ${TARGET} ${SUFFIX}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fail = 0;
const check = (n, c, d) => {
  if (c) console.log("  ✅ " + n);
  else {
    fail++;
    console.log("  ❌ " + n + "\n       " + String(d).slice(0, 300));
  }
};

/** 轮询到目标状态再收敛（不靠"猜请求结束"） */
async function waitFor(fn, ms = 8000, label = "") {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await sleep(150);
  }
  console.log("     (waitFor 超时: " + label + ")");
  return false;
}

(async () => {
  const b = await chromium.launch({ headless: true, args: ["--no-proxy-server"] });
  const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e).slice(0, 160)));

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
        try {
          return { status: r.status, json: JSON.parse(t) };
        } catch {
          return { status: r.status, json: t };
        }
      },
      [API, TOKEN, path, method, body],
    );

  const enterKb = async () => {
    const kb = p.locator('[data-testid="kb-card"]').filter({ hasText: "云计算知识库" }).first();
    if (await kb.count()) {
      await kb.click();
      await sleep(2200);
    }
  };

  const openDoc = async () => {
    const box = p.locator('input[type="search"], input[placeholder*="搜索"]').first();
    await box.fill(DOC_TITLE);
    await sleep(1600);
    const hit = p.getByText(DOC_TITLE, { exact: true }).first();
    if (await hit.count()) await hit.click({ force: true }).catch(() => {});
    await waitFor(async () => (await p.locator(".md-body").count()) > 0, 10000, "打开文档");
    await sleep(1200); // 渐进渲染 + 锚点重放防抖
  };

  const marks = () =>
    p.evaluate(() =>
      Array.from(document.querySelectorAll("mark.comment-anchor")).map((m) => ({
        id: m.dataset.commentId || "",
        text: m.textContent || "",
        flash: m.classList.contains("comment-anchor-flash"),
      })),
    );

  await p.goto(WEB, { waitUntil: "domcontentloaded" });
  // ⚠️ Next dev 浮层 <nextjs-portal> 会吃掉指针事件：即使 force click 也会点到浮层上，
  //    表现为「按钮点了没反应」「评论发布不出去」——纯脚本假失败，与产品无关。
  await p.addStyleTag({
    content: "nextjs-portal{display:none!important;pointer-events:none!important}",
  });
  await p.evaluate((t) => localStorage.setItem("sunnydoc.token", t), TOKEN);
  await p.reload({ waitUntil: "domcontentloaded" });
  await sleep(2500);
  await enterKb();

  // ---- 准备临时文档（自建自清，绝不碰真实数据） ----
  const list = await api("/api/v1/documents");
  const stale = (list.json.documents || []).filter((d) => d.title === DOC_TITLE);
  for (const d of stale) await api("/api/v1/documents/" + d.id, "DELETE");

  const kbs = await api("/api/v1/kbs");
  const kbId = (kbs.json.kbs || kbs.json.knowledge_bases || []).find(
    (k) => k && k.name === "云计算知识库",
  )?.id;
  const created = await api("/api/v1/documents", "POST", {
    title: DOC_TITLE,
    text: "",
    type: "doc",
    kb_id: kbId ?? null,
  });
  const docId = created.json.id;
  check("已创建临时验证文档", !!docId && String(docId).length === 32, JSON.stringify(created));
  if (!docId) {
    await b.close();
    process.exit(1);
  }

  // 中途任何一步抛错都必须把临时文档删掉 —— 否则会往真实库里留垃圾
  try {
  await api("/api/v1/documents/" + docId, "PUT", { title: DOC_TITLE, content: BODY });

  await openDoc();
  const bodyText = await p.locator(".md-body").first().innerText();
  check("临时文档正文已渲染", bodyText.includes(TARGET), bodyText.slice(0, 120));

  // ---- 1) 划词 → 浮动条 ----
  const rect = await p.evaluate((needle) => {
    const container = document.querySelector(".md-body");
    if (!container) return { found: false };
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const i = n.nodeValue.indexOf(needle);
      if (i >= 0) {
        const r = document.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + needle.length);
        const box = r.getBoundingClientRect();
        return {
          found: true,
          x1: box.left + 2,
          y1: box.top + box.height / 2,
          x2: box.right - 2,
          y2: box.top + box.height / 2,
        };
      }
    }
    return { found: false };
  }, TARGET);
  check("定位到待选中文本的屏幕坐标", rect.found, JSON.stringify(rect));

  await p.mouse.move(rect.x1, rect.y1);
  await p.mouse.down();
  await p.mouse.move(rect.x2, rect.y2, { steps: 10 });
  await p.mouse.up();
  await sleep(600);

  const bar = p.locator("[data-annotate-btn]");
  check("划词后浮动操作条出现", (await bar.count()) > 0, "未出现 [data-annotate-btn]");
  const annotateBtn = p.locator("[data-annotate-btn] button").filter({ hasText: "批注" }).first();
  check("浮动条含「批注」按钮", (await annotateBtn.count()) > 0, "未找到批注按钮");

  // ---- 2) 点批注 → 面板引用块 ----
  await annotateBtn.click({ force: true });
  await sleep(900);
  const panelText = await p.locator("aside.fixed").first().innerText().catch(() => "");
  check("点批注后面板带上了引用文本", panelText.includes(TARGET), panelText.slice(0, 200));

  // ---- 3) 发布 → 正文出现高亮 ----
  const ta = p.locator("aside.fixed textarea").first();
  await ta.click({ force: true });
  await p.keyboard.type("锚点验证评论-自动清理", { delay: 25 });
  await p
    .locator("aside.fixed button")
    .filter({ hasText: "发布" })
    .first()
    .dispatchEvent("click");
  const gotMark = await waitFor(async () => (await marks()).length === 1, 8000, "正文出现高亮");
  const m1 = await marks();
  check("发布后正文出现 1 个批注高亮", gotMark && m1.length === 1, JSON.stringify(m1));
  check(
    "高亮文本 == 选中文本（不是涂错地方）",
    m1.length === 1 && m1[0].text === TARGET,
    JSON.stringify(m1),
  );
  check("高亮带 comment-id（可反查评论）", m1.length === 1 && m1[0].id.length === 32, JSON.stringify(m1));
  const commentId = m1[0]?.id || "";

  // ---- 4) 刷新 → 高亮仍在（持久化 + 重新锚定） ----
  await p.reload({ waitUntil: "domcontentloaded" });
  await sleep(2000);
  await enterKb();
  await openDoc();
  const m2 = await marks();
  check(
    "刷新重开后高亮仍在（锚点持久化并重新定位）",
    m2.length === 1 && m2[0].text === TARGET && m2[0].id === commentId,
    JSON.stringify(m2),
  );

  // ---- 5) 点正文标记 → 面板定位到该评论 ----
  // 先关面板，确保「面板打开」是这次点击造成的
  const closeBtn = p.locator("aside.fixed button[aria-label='关闭评论']").first();
  if (await closeBtn.count()) await closeBtn.click({ force: true });
  await sleep(500);
  await p.locator("mark.comment-anchor").first().click({ force: true });
  const opened = await waitFor(async () => (await p.locator("aside.fixed").count()) > 0, 5000, "面板打开");
  const flashed = await waitFor(
    async () =>
      await p.evaluate(
        (id) => !!document.querySelector(`li[data-comment-id="${id}"].comment-item-flash`),
        commentId,
      ),
    4000,
    "评论项闪烁",
  );
  check("点正文标记 → 面板打开", opened, "面板未打开");
  check("点正文标记 → 对应评论被定位并闪烁", flashed, "未出现 comment-item-flash");

  // ---- 6) 点评论引用块 → 正文闪烁 ----
  await p.locator(`button[data-comment-ref="${commentId}"]`).first().click({ force: true });
  const bodyFlash = await waitFor(async () => (await marks()).some((m) => m.flash), 4000, "正文闪烁");
  check("点评论引用块 → 正文标记闪烁定位", bodyFlash, JSON.stringify(await marks()));

  // ---- 7) 正文改写（保留前后缀）→ 上下文回退定位 ----
  const REWRITTEN = "目标片段已改写ZZZ";
  await api("/api/v1/documents/" + docId, "PUT", {
    title: DOC_TITLE,
    content: `${PREFIX} ${REWRITTEN} ${SUFFIX}`,
  });
  await p.reload({ waitUntil: "domcontentloaded" });
  await sleep(2000);
  await enterKb();
  await openDoc();
  const m3 = await marks();
  check(
    "引用文本被改写后仍能锚定（上下文回退）",
    m3.length === 1 && m3[0].text === REWRITTEN,
    JSON.stringify(m3),
  );

  // ---- 8) 前后缀与引用全删 → 降级为「未锚定」 ----
  await api("/api/v1/documents/" + docId, "PUT", {
    title: DOC_TITLE,
    content: "完全无关的新内容，前后缀都不在了。",
  });
  await p.reload({ waitUntil: "domcontentloaded" });
  await sleep(2000);
  await enterKb();
  await openDoc();
  const m4 = await marks();
  check("彻底定位不到时正文不留高亮", m4.length === 0, JSON.stringify(m4));

  // 打开面板看是否降级显示「未锚定」
  const commentsBtn = p.locator("button").filter({ hasText: /评论/ }).first();
  if (await commentsBtn.count()) await commentsBtn.click({ force: true }).catch(() => {});
  const orphanShown = await waitFor(async () => {
    const t = await p.locator("aside.fixed").first().innerText().catch(() => "");
    return t.includes("未锚定");
  }, 6000, "未锚定标记");
  check("定位失败降级显示「未锚定」（不是静默丢失）", orphanShown, "面板未出现「未锚定」");

  // ---- 9) 不带引用的普通评论不产生正文标记 ----
  const ta2 = p.locator("aside.fixed textarea").first();
  await ta2.click({ force: true });
  await p.keyboard.type("普通评论-无引用", { delay: 25 });
  await p
    .locator("aside.fixed button")
    .filter({ hasText: "发布" })
    .first()
    .dispatchEvent("click");
  await sleep(1500);
  const m5 = await marks();
  const plainCount = await p.evaluate(
    () => document.querySelectorAll("aside.fixed li[data-comment-id]").length,
  );
  check("普通评论（无引用）不在正文打标", m5.length === 0, JSON.stringify(m5));
  check("普通评论仍进入评论列表", plainCount >= 2, "评论数 = " + plainCount);

  } catch (e) {
    fail++;
    console.log("  ❌ 脚本异常：" + String(e).slice(0, 300));
  } finally {
  // ---- 10) 清理 ----
  const cs = await api(`/api/v1/documents/${docId}/comments`);
  for (const c of cs.json.comments || []) await api("/api/v1/comments/" + c.id, "DELETE");
  const del = await api("/api/v1/documents/" + docId, "DELETE");
  const after = await api("/api/v1/documents");
  const left = (after.json.documents || []).filter((d) => d.title === DOC_TITLE);
  check("临时文档已删除（零残留）", left.length === 0, JSON.stringify(left.map((d) => d.id)));
  check("删除接口返回成功", del.status === 200, "status=" + del.status);

  check("运行期无未捕获页面异常", errs.length === 0, errs.join(" | "));
  }

  console.log("\n" + (fail === 0 ? "全部通过 ✅" : `失败 ${fail} 项 ❌`));
  await b.close();
  process.exit(fail === 0 ? 0 : 1);
})();
