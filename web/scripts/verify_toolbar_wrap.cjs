#!/usr/bin/env node
/**
 * 画布工具栏「不折行」护栏
 *
 * ## 为什么需要它
 *
 * 2026-11-21 第五轮实测：`MindMapEditor` 工具栏 15 个按钮全带文字，
 * 内容宽 **1102px** —— 1600/1440/1366 单行 ✅，但 **1280 及以下折成 2 行**
 * （工具栏 45px → 80px）。1280 / 1366 恰恰是最常见的笔记本分辨率，
 * 等于**绝大多数用户第一次打开就在被挤掉 35px 画布高度**。
 *
 * 第三轮的提交信息写的是「工具栏 41px 单行不折行」，但那只验证了 1600px
 * 一个宽度 —— **单点验证会把「某个宽度下成立」当成「普遍成立」**。
 *
 * 这类问题四个特征，决定了它必须由护栏守：
 *   1. **不报错**：没有异常、没有警告，TS 也不管布局；
 *   2. **只在小窗口出现**：开发者本机通常是大屏，永远看不到；
 *   3. **沉默地损害主功能区**：折行挤掉的是画布高度（这是编辑器的全部意义）；
 *   4. **会随功能增加而复发**：每加一个按钮就更容易折，没人会为此提 issue。
 *
 * ## 判据（不是"看起来挺好"，是可量的几何量）
 *
 * A. 900 / 1024 / 1280 / 1366 / 1600 五个宽度下，工具栏高度都 ≤ 48px
 *    （单行；折行后是 73~80px）
 * B. 同宽度下没有任何按钮被容器右边界裁切（`right > 容器 right`）
 * C. 收起文字后，每个可见按钮仍 ≥ 28px（不能靠「缩到 16px」来省宽）
 * D. 窄容器下「更多」出现、且菜单里能点到被收走的低频项
 *    （**功能没有因为变窄而丢失** —— 这是本护栏最核心的一条）
 * E. 每个可见按钮都有可访问名（收起文字后只剩图标，不能变成无名按钮）
 *
 * ## 已知的设计意图（勿改）
 *
 * - 宽容器（≥1030px）**保留文字**：图标猜含义的成本比多 35px 画布更高。
 * - 收起是**容器查询**（`@container`）不是视口断点：侧栏展开/折叠会让
 *   工具栏可用宽在 940~1180px 间变化，视口断点对不上。
 * - `.tbtn-more` / `.tbtn-in-more` 必须写在 `@layer components` **之外**，
 *   否则被 Tailwind utilities 层压掉（实测 `moreVisible` 恒为 true）。
 *
 * ## 用法
 *   cd web && NODE_PATH=<node_modules> node scripts/verify_toolbar_wrap.cjs
 */
const { chromium } = require("playwright");
const fs = require("fs");

const WEB = "http://localhost:3001";
const API = "http://localhost:8000";
const TOKEN = (
  process.env.SUNNYDOC_TOKEN ||
  fs.readFileSync(process.env.SUNNYDOC_TOKEN_FILE || "/tmp/sunnydoc-token.txt", "utf8")
).trim();
const KB = "fdef57f179384d679b62a3c4bae2d2e3";
const TITLE_MM = "AUDTW-工具栏护栏-导图";
const TITLE_FC = "AUDTW-工具栏护栏-流程图";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SEED_MM = JSON.stringify({
  nodes: [
    { id: "root", text: "中心主题", parentId: null },
    { id: "a", text: "分支 A", parentId: "root" },
    { id: "b", text: "分支 B", parentId: "root" },
  ],
  links: [],
});
const SEED_FC = JSON.stringify({
  nodes: [
    { id: "n1", x: 200, y: 120, label: "开始" },
    { id: "n2", x: 420, y: 250, label: "结束" },
  ],
  edges: [{ id: "e1", from: "n1", to: "n2" }],
});

let pass = 0,
  fail = 0;
function check(name, ok, extra = "") {
  console.log(`  ${ok ? "✅" : "❌"} ${name}${extra ? "  " + extra : ""}`);
  ok ? pass++ : fail++;
}

(async () => {
  console.log("=== 画布工具栏折行护栏 ===");

  /* ---------- 夹具 ---------- */
  const api = async (path, method = "GET", body) => {
    const r = await fetch(API + path, {
      method,
      headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const t = await r.text();
    try {
      return { status: r.status, json: JSON.parse(t) };
    } catch {
      return { status: r.status, json: t };
    }
  };

  const purge = async (id) => {
    await api("/api/v1/documents/" + id, "DELETE");
    await api("/api/v1/trash/document/" + id, "DELETE");
  };

  // 幂等清理（含回收站 —— 软删除后不 purge 会留下看不见的残留）
  const existing = await api("/api/v1/documents?limit=500");
  for (const d of existing.json.documents || []) {
    if (d.title === TITLE_MM || d.title === TITLE_FC) await purge(d.id);
  }

  const mm = await api("/api/v1/documents", "POST", {
    title: TITLE_MM, content: SEED_MM, type: "mindmap", kb_id: KB,
  });
  const fc = await api("/api/v1/documents", "POST", {
    title: TITLE_FC, content: SEED_FC, type: "flowchart", kb_id: KB,
  });
  check("可创建两个画布夹具", !!mm.json.id && !!fc.json.id, `mm=${mm.json.id} fc=${fc.json.id}`);

  const b = await chromium.launch({ headless: true, args: ["--no-proxy-server"] });

  /** 在指定宽度打开某个文档，返回工具栏几何量。 */
  const probe = async (docId, width) => {
    const ctx = await b.newContext({ viewport: { width, height: 900 }, locale: "zh-CN" });
    const p = await ctx.newPage();
    await p.addInitScript((t) => localStorage.setItem("sunnydoc.token", t), TOKEN);
    await p.goto(WEB + "/", { waitUntil: "domcontentloaded" });
    await sleep(3000);
    await p.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    await p.locator('[data-testid="kb-card"]').first().click();
    for (let i = 0; i < 40; i++) {
      if (await p.evaluate(() => document.querySelectorAll("[data-tree-kind]").length > 0)) break;
      await sleep(250);
    }
    const rf = p.locator('[data-testid="refresh-doc-list"]').first();
    if (await rf.count()) { await rf.click({ force: true }); await sleep(1600); }
    // 按 id 点树行（搜索只返回前 50，刚建的排不进去 —— 别靠搜索）
    if (await p.locator(`[data-tree-key="${docId}"]`).count()) {
      await p.locator(`[data-tree-key="${docId}"]`).click();
    }
    await sleep(2800);
    const m = await p.evaluate(() => {
      const bar = document.querySelector(".canvas-toolbar");
      if (!bar) return null;
      const R = bar.getBoundingClientRect();
      const btns = [...bar.querySelectorAll("button")].filter(
        (x) => x.getBoundingClientRect().width > 0,
      );
      const unnamed = btns.filter((x) => {
        const n = (x.getAttribute("aria-label") || x.innerText || "").trim();
        return !n;
      }).length;
      const more = bar.querySelector(".tbtn-more");
      return {
        barW: Math.round(R.width),
        barH: Math.round(R.height),
        btnN: btns.length,
        minBtnW: Math.round(Math.min(...btns.map((x) => x.getBoundingClientRect().width))),
        clipped: btns.filter((x) => x.getBoundingClientRect().right > R.right + 1).length,
        unnamed,
        moreVisible: !!more && more.getBoundingClientRect().width > 0,
        // 文字标签是否显示（大于 1px 视为显示）
        labelsVisible: [...bar.querySelectorAll(".tbtn-label")].filter(
          (e) => e.getBoundingClientRect().width > 1,
        ).length,
      };
    });
    return { p, ctx, m };
  };

  const WIDTHS = [1600, 1366, 1280, 1024, 900];

  /* ---------- A/B/C/E：五个宽度 × 两个编辑器 ---------- */
  for (const [name, id] of [["导图", mm.json.id], ["流程图", fc.json.id]]) {
    for (const w of WIDTHS) {
      const { ctx, m } = await probe(id, w);
      const tag = `${name}@${w}`;
      check(`${tag} 工具栏单行（≤48px）`, !!m && m.barH <= 48, m ? `${m.barH}px（折行为 73~80px）` : "工具栏未渲染");
      if (m) {
        check(`${tag} 无按钮被裁切`, m.clipped === 0, `clipped=${m.clipped}`);
        check(`${tag} 按钮最小宽 ≥28px`, m.minBtnW >= 28, `minBtnW=${m.minBtnW}px`);
        check(`${tag} 无无名按钮`, m.unnamed === 0, `unnamed=${m.unnamed}`);
        // 宽容器保留文字、窄容器收起 —— 保证"图标猜不出"这个问题没被修反。
        // ⚠️ 判据必须看 **容器宽（barW）** 而不是视口宽：侧栏展开/折叠会让
        //    工具栏可用宽在 940~1180px 间变化，同一视口宽下 barW 并不相同。
        //    阈值与 globals.css 的 @container 断点一一对应（1030 / 560）。
        const wantLabels = m.barW >= 1030;
        check(
          `${tag} ${wantLabels ? "宽" : "窄"}容器文字标签状态正确`,
          wantLabels ? m.labelsVisible > 0 : m.labelsVisible === 0,
          `barW=${m.barW} labels=${m.labelsVisible}`,
        );
        // 「更多」只在收起文字仍放不下时才出现（容器 <560px）
        check(
          `${tag}「更多」显隐符合预期`,
          m.moreVisible === m.barW < 560,
          `barW=${m.barW} more=${m.moreVisible}`,
        );
      }
      await ctx.close();
    }
  }

  /* ---------- D：窄容器下「更多」真的能用（功能没丢） ---------- */
  {
    const { p, ctx } = await probe(mm.json.id, 900);
    const more = p.locator(".canvas-toolbar .tbtn-more");
    let opened = false,
      items = [];
    if (await more.count()) {
      await more.click({ force: true });
      await sleep(400);
      opened = true;
      items = await p.evaluate(() =>
        [...document.querySelectorAll('.canvas-toolbar [role="menuitem"]')]
          .filter((e) => e.getBoundingClientRect().width > 0)
          .map((e) => e.innerText.trim()),
      );
    }
    check("窄容器「更多」可点开", opened);
    check(
      "「更多」菜单含被收走的低频项",
      ["导入 Xmind", "模板", "快捷键说明", "重置导图"].every((t) => items.includes(t)),
      JSON.stringify(items),
    );
    // 点「模板」要真能打开对话框（不是只渲染了一个菜单项）
    let dlgOk = false;
    const tpl = p.locator('.canvas-toolbar [role="menuitem"]', { hasText: "模板" }).first();
    if (await tpl.count()) {
      await tpl.click({ force: true });
      await sleep(900);
      dlgOk = await p.evaluate(() => !![...document.querySelectorAll(".dialog-panel, [role=dialog]")]
        .find((e) => e.getBoundingClientRect().width > 0));
    }
    check("「更多 → 模板」真的打开对话框", dlgOk);
    await ctx.close();
  }

  await b.close();

  /* ---------- 清理（软删 + purge，两级都要） ---------- */
  await purge(mm.json.id);
  await purge(fc.json.id);
  const after = await api("/api/v1/documents?limit=500");
  const left = (after.json.documents || []).filter(
    (d) => d.title === TITLE_MM || d.title === TITLE_FC,
  ).length;
  const trash = await api("/api/v1/trash");
  const leftTrash = (trash.json?.documents || []).filter(
    (d) => d.title === TITLE_MM || d.title === TITLE_FC,
  ).length;
  check("零残留（活跃列表 + 回收站）", left === 0 && leftTrash === 0, `active=${left} trash=${leftTrash}`);

  // runner 以「全部通过」作为判定（见 run_all_verify.cjs）：
  // 只打印统计而不打印这句，会被判成「退出码 0 但未见全部通过」——
  // 那是脚本的格式问题，不是产品问题。
  console.log(`\n${pass} 通过 / ${fail} 失败`);
  console.log(fail === 0 ? "✅ 全部通过" : "❌ 存在失败项");
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("脚本异常：", e.message);
  process.exit(1);
});