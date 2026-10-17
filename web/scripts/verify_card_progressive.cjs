#!/usr/bin/env node
/**
 * 验证「渐进渲染下、不在首批的卡片」能被挂载（走**非搜索态**）。
 *
 * 关键教训（先后两次栽在这里）：
 *  1. 用搜索框打开文档 → 走的是**搜索态一次性渲染**，永远测不到渐进追加；
 *  2. 「先搜索打开、再清空搜索框」也**不会**触发重渲染（实测只写 1 次 25KB）
 *     —— 因为清空搜索只是回到同一份已渲染的 DOM，不重建。
 *
 * 正确路径：**直接在文件树点开文档**（新文档建在根级，可点到）。
 * 这样 mode=preview 且 highlight 为空 → 走 renderProgressively → 才会分批追加。
 */
const { chromium } = require("playwright");
const { seedBigDocFixture, cleanupCardFixtures } = require("./_card_fixtures.cjs");
const fs = require("fs");
// token 走环境变量，避免把凭据写进仓库
const TOKEN = process.env.SUNNYDOC_TOKEN || fs.readFileSync(process.env.SUNNYDOC_TOKEN_FILE || "/tmp/sunnydoc-token.txt", "utf8").trim();
const TITLE = process.argv[2] || "卡片远置测试-容器";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fail = 0;
const check = (n, c, d) => {
  if (c) console.log("  ✅ " + n);
  else { fail++; console.log("  ❌ " + n + "\n       " + String(d).slice(0, 240)); }
};

(async () => {
  const b = await chromium.launch({ headless: true, args: ["--no-proxy-server"] });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e).slice(0, 150)));

  // 埋点：记录对 .md-body 的每次写入及其体积 —— 判定「是否分批」的硬证据。
  await p.addInitScript(() => {
    window.__inj = [];
    const iah = Element.prototype.insertAdjacentHTML;
    Element.prototype.insertAdjacentHTML = function (pos, html) {
      if (this.classList && this.classList.contains("md-body"))
        window.__inj.push(Math.round((typeof html === "string" ? html.length : 0) / 1024));
      return iah.call(this, pos, html);
    };
    const d = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
    Object.defineProperty(Element.prototype, "innerHTML", {
      ...d,
      set(v) {
        if (this.classList && this.classList.contains("md-body"))
          window.__inj.push(-Math.round((typeof v === "string" ? v.length : 0) / 1024));
        d.set.call(this, v);
      },
    });
  });

  await p.goto((process.env.SUNNYDOC_WEB || "http://localhost:3001"), { waitUntil: "domcontentloaded" });
  await p.evaluate((t) => localStorage.setItem("sunnydoc.token", t), TOKEN);
  await p.reload({ waitUntil: "domcontentloaded" });
  await sleep(2500);
  const kb = p.locator('[data-testid="kb-card"]').filter({ hasText: "云计算知识库" }).first();
  if (await kb.count()) { await kb.click(); await sleep(2500); }

  // 自建夹具：大文档（>= 900 顶层块）+ 末尾远置卡片。
  // 不再依赖库中预存夹具 —— 它被清理后本脚本会报「文件树里找不到目标文档」，
  // 失败信息与真因（夹具不存在）无关，极易误判成产品回归。
  const fx = await seedBigDocFixture(p, {
    title: TITLE,
    cardCount: parseInt(process.argv[3] || "2", 10),
  });
  console.log("  夹具: " + fx.containerId + (fx.created.length ? "（新建）" : "（复用既有）"));
  // 让新文档进入侧栏 metas（脚本用 API 建文档，前端列表还是旧的）
  const rf = p.locator('[data-testid="refresh-doc-list"]').first();
  if (await rf.count()) { await rf.click({ force: true }); await sleep(3000); }
  // 展开全部，确保能在树里找到（默认折叠）
  const tg = p.locator('[data-testid="toggle-batched-all"]').first();
  if (await tg.count() && (await tg.getAttribute("aria-pressed")) !== "true") {
    await tg.click({ force: true });
    await sleep(1500);
  }

  // ★ 直接在文件树点开（非搜索态）
  // ⚠️ 必须用 getByText 而不是 locator("button").filter({hasText})：
  //    文件树里文档行的文本在一个 `SPAN.block` 内、其祖先才是 `BUTTON.group`，
  //    用 button 过滤会匹配到但点击目标不是行本身（实测点不开、md-body 不存在）。
  const node = p.getByText(TITLE, { exact: true }).first();
  const nodeCount = await node.count();
  check("文件树里能找到目标文档（非搜索态路径可用）", nodeCount > 0, "未找到 " + TITLE);
  if (nodeCount) await node.click({ force: true }).catch(() => {});
  await sleep(2000);
  // 断言确实进入了文档视图且未停留在搜索结果页 —— 否则后面的断言毫无意义
  const inDoc = await p.evaluate(() => ({
    mdBody: !!document.querySelector(".md-body"),
    resultPanel: (document.body.innerText || "").includes("条结果"),
  }));
  check("已进入文档视图（非搜索结果页）", inDoc.mdBody && !inDoc.resultPanel, JSON.stringify(inDoc));

  const samples = [];
  for (let i = 0; i < 8; i++) {
    await sleep(700);
    const s = await p.evaluate(() => {
      const body = document.querySelector(".md-body");
      const wraps = Array.from(document.querySelectorAll(".md-body .doc-embed"));
      return {
        inj: window.__inj.length,
        injDetail: window.__inj.slice(),
        blocks: body ? body.children.length : -1,
        wraps: wraps.length,
        mounted: wraps.filter((w) => w.querySelector(".doc-embed-card")).length,
      };
    });
    samples.push(s);
    console.log(`  ${(i + 1) * 700}ms: 写入${s.inj}次 顶层块=${s.blocks} 占位=${s.wraps} 已挂载=${s.mounted}`);
  }
  const last = samples[samples.length - 1];
  const inj = last.injDetail;
  const maxInj = inj.length ? Math.max(...inj.map(Math.abs)) : 0;
  console.log("  写入体积序列: " + JSON.stringify(inj) + "（正=追加，负=全量）");

  check("确实走了渐进渲染（写入次数 > 3）", inj.length > 3, "写入 " + inj.length + " 次");
  check("单次写入体积受控（最大 < 60KB，非一次性全量）", maxInj < 60, "最大 " + maxInj + "KB");
  check("最终顶层块完整（>= 900）", last.blocks >= 900, last.blocks);

  const detail = await p.evaluate(() => {
    const wraps = Array.from(document.querySelectorAll(".md-body .doc-embed"));
    return wraps.map((w) => {
      const card = w.querySelector(".doc-embed-card");
      return {
        hasCard: !!card,
        type: card ? card.getAttribute("data-embed-type") : null,
        h: card ? Math.round(card.getBoundingClientRect().height) : 0,
        loading: !!w.querySelector(".doc-embed-placeholder"),
      };
    });
  });
  console.log("  卡片明细: " + JSON.stringify(detail));

  // 卡片数量与类型不再硬编码：不同测试数据不同。核心是「不在首批的卡片也要出现」。
  const EXPECT = parseInt(process.argv[3] || "0", 10);
  check("远置的卡片全部挂载（不在首批也要出现）",
    detail.length > 0 && detail.every((c) => c.hasCard), JSON.stringify(detail));
  if (EXPECT > 0) {
    check("卡片数量符合预期（" + EXPECT + "）", detail.length === EXPECT, detail.length);
  }
  check("每张卡片都识别出了类型（非空）",
    detail.length > 0 && detail.every((c) => !!c.type), detail.map((c) => c.type).join());
  check("卡片渲染完成（高度 > 100、无 loading 占位）",
    detail.length > 0 && detail.every((c) => c.h > 100 && !c.loading),
    JSON.stringify(detail.map((c) => ({ h: c.h, l: c.loading }))));
  check("无运行时错误", errs.length === 0, errs.slice(0, 2).join(" | "));

  await cleanupCardFixtures(p, fx.created);
  await p.screenshot({ path: "/tmp/sd_card/progressive.png", fullPage: false });
  await b.close();
  console.log("\n" + (fail ? "❌ FAIL = " + fail : "✅ ALL PASS"));
  process.exit(fail ? 1 : 0);
})();