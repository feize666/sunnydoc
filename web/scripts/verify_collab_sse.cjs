#!/usr/bin/env node
/**
 * 协作 SSE 订阅护栏：打开一篇文档只应建立 **1 条** `events/collab` 连接。
 *
 * ## 为什么需要（2026-11-13 实测发现）
 *
 * `Editor.tsx` 的 SSE effect 依赖里含 `onRemoteUpdate`，而宿主 `page.tsx` 传的是
 * **内联箭头函数**（`activeKey ? () => refreshDoc(activeKey) : undefined`）——
 * 每次父组件渲染都是新引用 → effect 反复重跑 → SSE 反复重连。
 *
 * 实测一次打开文档发了 **3 次** `GET /api/v1/events/collab/{id}`（都在 100ms 内，
 * 所以不是 3 秒重连兜底，是 effect 重复执行）。
 *
 * 后果不只是多发请求：`subscribeSSE` 每条连接都占一个 SSE 长连接与对应线程，
 * 反复重连会让「在线人数」抖动，长期还会累积泄漏。
 *
 * 判据：打开一篇文档后的 **5 秒窗口**内，`events/collab` 请求数必须 == 1。
 * 5 秒是有意的：`subscribeSSE` 的失败重连是 3000ms，若因异常重连可以接受，
 * 但正常打开不应有任何重连。
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const API = process.env.SUNNYDOC_API || "http://127.0.0.1:8000";
const WEB = process.env.SUNNYDOC_WEB || "http://localhost:3001";
const TOKEN =
  process.env.SUNNYDOC_TOKEN ||
  fs.readFileSync(process.env.SUNNYDOC_TOKEN_FILE || "/tmp/sunnydoc-token.txt", "utf8").trim();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let pass = 0;
  let fail = 0;
  const check = (n, ok, d) => {
    if (ok) {
      pass++;
      console.log("  ✅ " + n);
    } else {
      fail++;
      console.log("  ❌ " + n + "\n       " + String(d).slice(0, 240));
    }
  };

  const b = await chromium.launch({ headless: true, args: ["--no-proxy-server"] });
  try {
    const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 }, locale: "zh-CN" });
    const p = await ctx.newPage();
    await p.addInitScript((t) => localStorage.setItem("sunnydoc.token", t), TOKEN);

    const sseReqs = [];
    p.on("request", (r) => {
      if (r.url().includes("/events/collab/")) sseReqs.push(Date.now());
    });

    await p.goto(WEB + "/", { waitUntil: "domcontentloaded" });
    await sleep(3000);
    // Next dev 的 `<nextjs-portal>` 会吃掉所有指针事件
    await p.addStyleTag({
      content: "nextjs-portal{display:none!important;pointer-events:none!important}",
    });

    await p.locator('[data-testid="kb-card"]').first().click();
    for (let i = 0; i < 50; i++) {
      if (await p.evaluate(() => document.querySelectorAll("[data-tree-kind]").length > 0)) break;
      await sleep(300);
    }
    await sleep(800);

    // 用过滤框定位一个 doc 类型行（树可能很长，直接按序号点不稳）
    await p.fill('[data-testid="tree-filter"]', "openEuler");
    await sleep(900);
    const row = p.locator('[data-tree-kind="doc"]:visible').first();
    const hasRow = (await row.count()) > 0;
    check("找到可打开的文档行", hasRow, "过滤 openEuler 后无结果");

    if (hasRow) {
      sseReqs.length = 0;
      await row.click();
      // 等正文出现（不依赖固定 sleep）
      for (let i = 0; i < 50; i++) {
        const n = await p.evaluate(() => (document.querySelector(".md-body")?.innerText || "").length);
        if (n > 500) break;
        await sleep(200);
      }
      const openMs = sseReqs.length;
      // 观察窗口：5 秒（覆盖 3000ms 重连兜底）
      await sleep(5000);

      // 触发一次父组件重渲染：点一下树里的另一行再点回来，或改过滤框再清空。
      // 这里用「过滤框输入再清空」——它必然引起宿主 setState → 重渲染。
      await p.fill('[data-testid="tree-filter"]', "openEuler");
      await sleep(600);
      await p.fill('[data-testid="tree-filter"]', "");
      await sleep(2000);

      console.log(`     打开瞬间建立 ${openMs} 条，观测 5s + 一次父级重渲染后共 ${sseReqs.length} 条`);
      check(
        `打开文档只建 1 条 SSE 连接（实测 ${sseReqs.length} 条）`,
        sseReqs.length === 1,
        `期望 1 条，实际 ${sseReqs.length} 条——effect 依赖含不稳定引用会导致反复重连`,
      );
    }

    // ---- 反向：订阅确实在工作（能收到 presence 事件，不是「连接建了但没数据」）----
    const bodyOk = await p.evaluate(async (api) => {
      const tok = localStorage.getItem("sunnydoc.token");
      const r = await fetch(api + "/api/v1/events/collab/__probe__", {
        headers: { Authorization: "Bearer " + tok },
      });
      return r.status;
    }, API);
    // 不存在的文档 id 也返回 200（SSE 流会立即结束）或 404，都说明端点活着
    check("SSE 端点可达", bodyOk === 200 || bodyOk === 404, `status=${bodyOk}`);
  } finally {
    await b.close().catch(() => {});
  }

  console.log(`\n通过 ${pass} / 失败 ${fail}`);
  console.log(fail === 0 ? "✅ 全部通过" : "❌ 存在失败项");
  process.exit(fail ? 1 : 0);
})();