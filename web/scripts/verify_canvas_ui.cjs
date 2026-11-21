#!/usr/bin/env node
/**
 * 画布编辑器 UI 护栏（流程图 / 思维导图）
 *
 * ## 为什么需要它
 *
 * 这两个编辑器是本项目代码量最大的两个文件（3741 / 2555 行），
 * 但它们的问题是**结构性的**，不是逻辑 bug：
 *   - 工具栏 18 个按钮平铺，`flex-wrap` 在窄屏折成两三行，挤掉画布高度
 *   - 「连线形状」「网格吸附」「画布背景」是画一次就不动的设置，
 *     却和「撤销」「删除」这种高频动作放在同一视觉层级
 *   - 思维导图左栏只有 176px 宽，6 条「标题 + 描述」两行文字占 264px，
 *     把下方「主题配色」挤出可视区（而左栏没有任何滚动提示）
 *
 * 这类问题**不会报错、不会崩**，只是"用起来别扭"——没有人会为它提 bug，
 * 但每个用户每天都会碰到。所以只能用尺寸断言守。
 *
 * ## 判据
 *
 * A. 流程图：工具栏 ≤14 个按钮、单行高 ≤50px、连线/视图收进下拉且能展开
 * B. 思维导图：结构区是 2 列 × 6 项网格、每项有几何图标、高度 ≤200px
 * C. 两者的图标按钮都有 `aria-label`（只有 `title` 屏幕阅读器读不到）
 *
 * ## 已知的设计意图（勿改）
 *
 * - 高频动作（撤销/重做/删除/自动布局）**故意常驻**，不塞进下拉。
 *   判据只卡"总数 ≤14"，不卡"每个都必须在下拉里"。
 * - 结构图标是抽象几何示意，不是装饰：`logic` 画左→右、`org` 画上→下，
 *   目标是"不读文字也能认布局"。所以只断言"每项有 svg"，不断言具体形状。
 */
const { chromium } = require("playwright");
const fs = require("fs");

const API = "http://127.0.0.1:8000";
const WEB = "http://localhost:3001";
const TOKEN = fs.readFileSync("/tmp/sunnydoc-token.txt", "utf8").trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0,
  fail = 0;
function check(name, ok, extra = "") {
  console.log(`  ${ok ? "✅" : "❌"} ${name}${extra ? "  " + extra : ""}`);
  ok ? pass++ : fail++;
}

async function j(path, method = "GET", body) {
  const r = await fetch(API + "/api/v1" + path, {
    method,
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + TOKEN },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  try {
    return { s: r.status, j: JSON.parse(t) };
  } catch {
    return { s: r.status, j: { raw: t.slice(0, 200) } };
  }
}

(async () => {
  console.log("=== 画布编辑器 UI 护栏 ===");

  const kb = await j("/kbs", "POST", { name: "R3CANVAS-探针", description: "ui guard" });
  const KB = kb.j.id || (kb.j.kb && kb.j.kb.id);
  const fc = await j("/documents", "POST", {
    title: "R3CANVAS-流程图",
    content: '{"nodes":[{"id":"n1","x":200,"y":150,"w":140,"h":56,"text":"开始"}],"edges":[]}',
    type: "flowchart",
    kb_id: KB,
  });
  const mm = await j("/documents", "POST", {
    title: "R3CANVAS-脑图",
    content: '{"nodes":[{"id":"r","text":"中心","children":[{"id":"c1","text":"子A"}]}]}',
    type: "mindmap",
    kb_id: KB,
  });
  check("建探针（流程图 + 脑图）", fc.s === 200 && mm.s === 200, `${fc.s}/${mm.s}`);

  const b = await chromium.launch({ headless: true, args: ["--no-proxy-server"] });
  const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 }, locale: "zh-CN" });
  const p = await ctx.newPage();
  await p.addInitScript((t) => localStorage.setItem("sunnydoc.token", t), TOKEN);
  await p.goto(WEB + "/", { waitUntil: "domcontentloaded" });
  await sleep(3900);
  await p.addStyleTag({
    content: "nextjs-portal{display:none!important;pointer-events:none!important}",
  });
  await p.evaluate(() => {
    const cards = [...document.querySelectorAll('[data-testid="kb-card"]')];
    const c = cards.find((x) => x.innerText.includes("R3CANVAS"));
    if (c) c.click();
  });
  for (let i = 0; i < 40; i++) {
    if (await p.evaluate(() => document.querySelectorAll("[data-tree-kind]").length > 0)) break;
    await sleep(300);
  }
  await sleep(900);

  // ---------- A. 流程图 ----------
  const fcRow = p.locator('[data-tree-kind]:has-text("R3CANVAS-流程图")').first();
  if ((await fcRow.count()) > 0) {
    await fcRow.click();
    await sleep(3200);

    const m = await p.evaluate(() => {
      const bar = [...document.querySelectorAll("div")].find(
        (d) => (d.className || "").includes("flex-wrap") && (d.innerText || "").includes("自动布局"),
      );
      if (!bar) return null;
      const btns = [...bar.querySelectorAll("button")];
      return {
        btnCount: btns.length,
        barH: Math.round(bar.getBoundingClientRect().height),
        text: bar.innerText || "",
      };
    });
    check(`工具栏 ≤14 个按钮（${m?.btnCount}）`, !!m && m.btnCount <= 14, "原 18 个平铺");
    check(
      `工具栏单行高 ≤50px（${m?.barH}px）`,
      !!m && m.barH <= 50,
      "flex-wrap 折行会挤掉画布高度",
    );
    check("连线形状收进下拉（按钮显示当前值）", !!m && /连线|曲线|直线|正交/.test(m.text));
    check("画布视图设置收进下拉", !!m && m.text.includes("视图"));

    // 下拉能展开且选项齐全
    const edgeBtn = p.locator('button[title="连线形状"]').first();
    if ((await edgeBtn.count()) > 0) {
      await edgeBtn.click();
      await sleep(500);
      const opts = await p.evaluate(() =>
        [...document.querySelectorAll('[role="menu"] button')].map((x) => (x.innerText || "").trim()),
      );
      check(`连线下拉 4 个选项（${opts.join("/")}）`, opts.length === 4);
      // 遮罩只监听 onClick，Escape 关不掉 —— 必须点遮罩
      await p.evaluate(() => {
        const mask = document.querySelector("div.fixed.inset-0.z-10");
        if (mask) mask.click();
      });
      await sleep(400);
    }

    const a = await p.evaluate(() => {
      const btns = [...document.querySelectorAll("button")].filter((x) => {
        const r = x.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      return btns.filter(
        (x) => !(x.innerText || "").trim() && !x.getAttribute("aria-label") && x.getAttribute("title"),
      ).length;
    });
    check(`流程图图标按钮都有 aria-label（仅 title 的 ${a} 个）`, a === 0);
  } else {
    check("打开流程图", false, "树行未找到");
  }

  // ---------- B. 思维导图 ----------
  const mmRow = p.locator('[data-tree-kind]:has-text("R3CANVAS-脑图")').first();
  if ((await mmRow.count()) > 0) {
    await mmRow.click();
    await sleep(3200);
    const m2 = await p.evaluate(() => {
      const structBtn = [...document.querySelectorAll("button")].find(
        (x) => (x.innerText || "").trim() === "逻辑图",
      );
      const panel = structBtn ? structBtn.closest('[class*="grid"]') : null;
      const btns = panel ? [...panel.querySelectorAll("button")] : [];
      return {
        cols: panel ? getComputedStyle(panel).gridTemplateColumns.split(" ").length : 0,
        count: btns.length,
        height: panel ? Math.round(panel.getBoundingClientRect().height) : 0,
        svgs: btns.filter((x) => x.querySelector("svg")).length,
      };
    });
    check(`结构区是 2 列网格（${m2?.cols} 列 / ${m2?.count} 项）`, m2.cols === 2 && m2.count === 6);
    check(`每项都有几何图标（${m2?.svgs}/6）`, m2.svgs === 6, "不读文字也能认布局");
    check(
      `结构区高度 ≤200px（${m2?.height}px）`,
      m2.height <= 200,
      "原约 264px，会把下方「主题配色」挤出可视区",
    );

    const a2 = await p.evaluate(() => {
      const btns = [...document.querySelectorAll("button")].filter((x) => {
        const r = x.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      return btns.filter(
        (x) => !(x.innerText || "").trim() && !x.getAttribute("aria-label") && x.getAttribute("title"),
      ).length;
    });
    check(`脑图图标按钮都有 aria-label（仅 title 的 ${a2} 个）`, a2 === 0);
  } else {
    check("打开思维导图", false, "树行未找到");
  }

  await b.close();

  // 清理
  for (const id of [fc.j.id, mm.j.id]) {
    if (!id) continue;
    await j(`/documents/${id}`, "DELETE");
    await j(`/trash/document/${id}`, "DELETE");
  }
  if (KB) {
    await j(`/kbs/${KB}`, "DELETE");
    await j(`/trash/kb/${KB}`, "DELETE");
  }

  console.log(`\n通过 ${pass} / 失败 ${fail}`);
  console.log(fail === 0 ? "✅ 全部通过" : "❌ 存在失败项");
  process.exit(fail === 0 ? 0 : 1);
})();