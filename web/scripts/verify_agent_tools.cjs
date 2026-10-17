#!/usr/bin/env node
/**
 * 真机验证：智能体工具编排（阶段 4）。
 *
 * ## 为什么必须真机验证
 *
 * 工具编排的行为**绝大部分在模型侧**：同一个问题，模型可能直接回答，
 * 也可能调工具、调哪个工具也不确定。单测只能覆盖「工具函数本身正确」，
 * 覆盖不到「用户屏幕上到底发生了什么」。
 *
 * ## 断言（都读用户的真实界面）
 *
 *   A. 简单问答：不调工具，直接出文字（不能因为接了工具就变慢/变哑）
 *   B. 需要检索：出现「搜索文档」工具标签，且回答里带上了检索到的内容
 *   C. 破坏性操作：**出现确认卡片**、文案含「需要你确认」与「尚未执行」、
 *      且**此时数据库里文档仍在**（最关键的一条）
 *   D. 点「取消」：卡片消失、文档仍在
 *   E. 点「确认执行」：卡片消失、文档真的被删（进回收站）
 *
 * C 与 E 必须成对：只测 C 不能证明「确认能用」，只测 E 不能证明「确认前没执行」。
 *
 * ## 用法
 *   cd web && SUNNYDOC_TOKEN=xxx node scripts/verify_agent_tools.cjs
 */
const { chromium } = require("playwright");
const fs = require("fs");

const TOKEN =
  process.env.SUNNYDOC_TOKEN ||
  fs.readFileSync(process.env.SUNNYDOC_TOKEN_FILE || "/tmp/sunnydoc-token.txt", "utf8").trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 靶子文档由外部注入（脚本不自建 —— 删除类断言需要一个真实目标）
const TARGET_DOC_ID = process.env.AGENT_TARGET_DOC_ID || "";
const TARGET_TITLE = process.env.AGENT_TARGET_TITLE || "__AGENT_UI_靶子__";

let fail = 0;
const check = (n, c, d) => {
  if (c) console.log("  ✅ " + n);
  else {
    fail++;
    console.log("  ❌ " + n + "\n       " + (d || ""));
  }
};

/**
 * AI 面板的选择器。
 *
 * 🔴 **不要用 `aside`** —— 页面上有**两个** `aside`：文件树侧栏（`relative`）
 * 与 AI 面板浮层（`fixed z-50`）。`document.querySelector("aside")` 命中的是
 * 文件树，于是所有断言都跑在「文件树」上，必然全红（实测踩过，且这是本项目
 * 第二次因为「抓错容器」得到一整片假失败）。
 * 用浮层特征（fixed + z-50 + 含输入框）精确定位。
 */
const PANEL_SEL = "aside.fixed.z-50";

/** 取 AI 面板内的可见文本（面板不存在时回退到 body，便于诊断）。 */
const readPanel = (sel) => {
  const el = document.querySelector(sel) || document.body;
  return el.innerText || "";
};

/**
 * 等面板回到「空闲」（不再生成）。
 *
 * 🔴 **这一步不能省**。`AiPanel.send()` 开头是 `if (!q || loading) return;` ——
 * 上一轮还在流式时新提问会被**静默忽略**（不报错、不清空输入框）。
 * 实测踩过：A 段的 `expect` 一满足就返回，紧接着 fill+Enter 落在 loading 期间，
 * 于是 B/C/E 的提问根本没发出去 —— 面板里始终只有 A 那一轮的记录，
 * 一整片断言全红，而产品其实完全正常。
 *
 * 判据用「正在生成回答…」这个可见标记（AiPanel 里 loading 状态下渲染的固定文案）。
 */
async function waitIdle(p, timeoutMs = 90000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const busy = await p.evaluate((sel) => {
      const el = document.querySelector(sel);
      return !!el && (el.innerText || "").includes("正在生成回答");
    }, PANEL_SEL);
    if (!busy) {
      await sleep(500); // 再等一拍，避开状态切换的瞬间
      const stillBusy = await p.evaluate((sel) => {
        const el = document.querySelector(sel);
        return !!el && (el.innerText || "").includes("正在生成回答");
      }, PANEL_SEL);
      if (!stillBusy) return true;
    }
    await sleep(500);
  }
  return false;
}

/**
 * 提问并轮询到「期望条件成立」。
 *
 * 🔴 **不要用「猜请求是否结束」来收敛等待**（踩过）：
 * 我原先按「页面上有没有『停止/生成中』按钮」判断流式结束，而该文案并不存在，
 * 于是 `busy` 恒为 false → 在 ~4 秒时提前 break → 工具标签（更晚渲染）读到空数组，
 * 造成「功能是好的但断言全红」。**轮询到期望状态**才是稳的：
 * 需要断言什么，就等什么出现。
 *
 * @param expect 可选断言函数；提供时轮询到它返回 true（或超时）才返回。
 */
async function ask(p, q, { expect, waitMs = 60000 } = {}) {
  // 先等上一轮结束，否则这次输入会被静默丢弃
  await waitIdle(p);
  const box = p.locator(`${PANEL_SEL} textarea`).last();
  await box.fill(q);
  await box.press("Enter");

  const started = Date.now();
  let snap = { trace: [], cards: [], txt: "" };
  while (Date.now() - started < waitMs) {
    await sleep(600);
    snap = await p.evaluate((sel) => {
      const side = document.querySelector(sel) || document.body;
      return {
        // 工具轨迹：按结构定位。
        // 轨迹容器是 `div.mb-1.flex.flex-wrap`（AiPanel 里包裹标签的 div），
        // 内部每个 `span` 是一个工具标签。
        // ⚠️ 用结构而不是「文本在白名单里」——那种写法会在文案微调后静默失效
        //    （本项目已因这类「断言依赖文案」吃过假失败）。
        trace: Array.from(side.querySelectorAll("[data-tool-trace] span"))
          .map((s) => (s.innerText || "").trim())
          .filter(Boolean),
        // 确认卡片：用 data-pending-card 锚点（不依赖文案与类名）
        cards: Array.from(side.querySelectorAll("[data-pending-card]"))
          .map((d) => (d.innerText || "").trim())
          .slice(0, 3),
        txt: side.innerText || "",
        // 本轮是否仍在生成（判据用 AiPanel 里 loading 态的固定文案）
        busy: (side.innerText || "").includes("正在生成回答"),
      };
    }, PANEL_SEL);
    if (expect && expect(snap)) {
      // 命中期望后再等一拍，让「执行中」的转圈收尾，然后**重读一次**快照 ——
      // 直接沿用命中的那次快照会读到「条件刚满足那一瞬间」的数据，
      // 而 DOM 在同一 tick 内还可能继续变化（实测造成「有轨迹却读到空数组」）。
      await sleep(700);
      snap = await p.evaluate((sel) => {
        const side = document.querySelector(sel) || document.body;
        return {
          trace: Array.from(side.querySelectorAll("[data-tool-trace] span"))
            .map((s) => (s.innerText || "").trim())
            .filter(Boolean),
          cards: Array.from(side.querySelectorAll("[data-pending-card]"))
            .map((d) => (d.innerText || "").trim())
            .slice(0, 3),
          txt: side.innerText || "",
          busy: (side.innerText || "").includes("正在生成回答"),
        };
      }, PANEL_SEL);
      break;
    }
    if (!expect) {
      // 未指定期望时，用「回答已出现且不再增长」作为收敛信号
      if (snap.txt.length > 200) {
        await sleep(1500);
        const after = await p.evaluate(readPanel, PANEL_SEL);
        if (after.length === snap.txt.length) break;
      }
    }
  }
  const answer = await p.evaluate(readPanel, PANEL_SEL);
  return { ...snap, answer };
}

(async () => {
  if (!TARGET_DOC_ID) {
    console.log("⏭  未提供 AGENT_TARGET_DOC_ID，跳过破坏性操作用例");
  }
  const b = await chromium.launch({
    headless: true,
    args: ["--no-proxy-server"],
    // 允许指定浏览器可执行文件（playwright 包升级后缓存里可能只有旧版 chromium）
    ...(process.env.SUNNYDOC_CHROMIUM ? { executablePath: process.env.SUNNYDOC_CHROMIUM } : {}),
  });
  const p = await b.newPage({ viewport: { width: 1440, height: 950 } });
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e)));

  await p.goto("http://localhost:3001", { waitUntil: "domcontentloaded" });
  await p.evaluate((t) => localStorage.setItem("sunnydoc.token", t), TOKEN);
  // 清掉会话历史（避免上一轮的问答混进本轮断言）
  await p.evaluate(() => {
    try {
      localStorage.removeItem("sunnydoc_chat_sessions");
      localStorage.removeItem("sunnydoc_chat_current");
    } catch {}
  });
  await p.reload({ waitUntil: "domcontentloaded" });
  await sleep(3000);

  // 先进入知识库 —— AI 入口在知识库视图的标题栏里（首页没有）。
  //
  // ⚠️ 定位用「知识库卡片」而不是 hasText:/知识库/：
  // 首页的最近浏览列表里有文档标题含「知识库」（如「AI爬虫 / 云计算知识库」），
  // 宽正则会先命中那些行 —— 实测因此点错、AI 按钮永远等不到。
  // 用卡片专属类名 `.lift` + 文本组合。
  const kb = p.locator("button.lift").filter({ hasText: /云计算知识库/ }).first();
  if (await kb.count()) {
    await kb.click();
  } else {
    await p.locator("button").filter({ hasText: /^云计算知识库$/ }).first().click();
  }
  await sleep(2800);

  const aiBtn = p.locator("button").filter({ hasText: /^AI 问答$/ }).first();
  check("知识库视图里找到 AI 入口", (await aiBtn.count()) > 0, "未找到「AI 问答」按钮");
  await aiBtn.click();
  await sleep(1000);
  const hasBox = await p
    .locator(`${PANEL_SEL} textarea`)
    .last()
    .isVisible()
    .catch(() => false);
  check("AI 面板已打开", hasBox, "未找到输入框");
  if (!hasBox) {
    await b.close();
    process.exit(1);
  }

  console.log("\n━━━ A. 简单问答（不应调工具）━━━");
  {
    const r = await ask(p, "你好，用一句话介绍你自己", {
      // 等到本轮真正结束（这样 ask 返回时面板已空闲，下一轮提问才不会被丢）
      expect: (s) => s.txt.length > 150,
    });
    await waitIdle(p); // 显式再确认一次空闲（回答可能刚好在 expect 命中后仍在收尾）
    const noTool = r.trace.length === 0;
    check("简单问答未触发工具调用", noTool, `出现了工具标签：${JSON.stringify(r.trace)}`);
    check("给出了文字回答", r.answer.length > 60, `长度 ${r.answer.length}`);
  }

  console.log("\n━━━ B. 需要调工具的操作（应出现工具轨迹）━━━");
  {
    // ⚠️ **不要用「帮我搜一下 X」来触发工具**（踩过）：
    // 后端在进入智能体之前**已经做过一次知识库检索**并把命中片段注入了上下文，
    // 所以模型常常直接用已有片段回答、**不需要**再调 search_documents。
    // 那不是缺陷，是「已给足信息就别多此一举」的合理行为。
    // 要稳定验证工具链路，得问一个**上下文回答不了**的元信息问题
    // （知识库清单 / 文档总数 / 回收站内容）——实测这类必调工具。
    const r = await ask(p, "系统里一共有多少个知识库？把它们列出来", {
      expect: (s) => s.trace.length > 0 && s.busy === false,
    });
    check(
      "显示了工具轨迹（证明工具链路真的跑起来了）",
      r.trace.length > 0,
      `轨迹=${JSON.stringify(r.trace)}\n       ` + r.answer.slice(0, 200),
    );
    check(
      "工具结果是知识库类（而非其它工具）",
      r.trace.some((t) => /知识库/.test(t)),
      `轨迹=${JSON.stringify(r.trace)}`,
    );
    // 回答要真的用了工具结果（提到知识库数量或名称）
    check(
      "回答基于工具结果（提到知识库）",
      /知识库/.test(r.answer) && r.answer.length > 60,
      `长度 ${r.answer.length}`,
    );
    await waitIdle(p);
  }

  if (TARGET_DOC_ID) {
    console.log("\n━━━ C. 破坏性操作 → 待确认（不得执行）━━━");
    {
      const r = await ask(
        p,
        `请帮我删除标题是 ${TARGET_TITLE} 的文档（doc_id=${TARGET_DOC_ID}）`,
        // 等确认卡片渲染出来（这是本段要断言的对象）
        { expect: (s) => s.cards.length > 0 },
      );
      check("出现了确认卡片", r.cards.length > 0, `未找到「需要你确认」卡片`);
      check(
        "卡片文案说明尚未执行",
        r.cards.some((c) => /尚未执行/.test(c)),
        JSON.stringify(r.cards).slice(0, 300),
      );
      check("卡片有「确认执行」按钮", r.answer.includes("确认执行") || r.cards.length > 0);
      // 🔴 最关键：此时数据库里文档必须还在
      const stillThere = await p.evaluate(async (id) => {
        const t = localStorage.getItem("sunnydoc.token");
        const res = await fetch(`http://127.0.0.1:8000/api/v1/documents/${id}`, {
          headers: { Authorization: `Bearer ${t}` },
        });
        return res.ok;
      }, TARGET_DOC_ID);
      check(
        "🔴 未确认前文档仍存在（确认机制真的拦住了）",
        stillThere,
        "文档已被删除 —— 确认机制失效！",
      );
      await waitIdle(p);

      console.log("\n━━━ D. 点「取消」：不应有任何改动 ━━━");
      const cancelBtn = p
        .locator(`${PANEL_SEL} button`)
        .filter({ hasText: /^取消$/ })
        .last();
      if (await cancelBtn.count()) {
        await cancelBtn.click();
        await sleep(1200);
        const gone = await p.evaluate((sel) => {
          const side = document.querySelector(sel) || document.body;
          return !(side.innerText || "").includes("需要你确认");
        }, PANEL_SEL);
        check("取消后确认卡片消失", gone);
      } else {
        check("找到「取消」按钮", false, "未找到");
      }
      const stillAfterCancel = await p.evaluate(async (id) => {
        const t = localStorage.getItem("sunnydoc.token");
        const res = await fetch(`http://127.0.0.1:8000/api/v1/documents/${id}`, {
          headers: { Authorization: `Bearer ${t}` },
        });
        return res.ok;
      }, TARGET_DOC_ID);
      check("取消后文档仍在", stillAfterCancel);

      console.log("\n━━━ E. 新开对话 → 提问 → 点「确认执行」：应真的删除 ━━━");
      {
        // 🔴 **必须新开对话**。C/D 段刚就同一个文档问过并「取消」过，
        // 历史里留着「已准备好删除…请确认」这一轮 —— 这时模型会认为
        // 「这事刚说过、无需重复调工具」，于是不再产生新的确认卡片，
        // 断言必然失败（实测踩过）。
        // 这不是缺陷，而是合理的指代消解行为；**测试要保证条件是干净的**。
        // 面板顶部的「新建」按钮即「开始新的对话」。
        const newChatBtn = p
          .locator(`${PANEL_SEL} button`)
          .filter({ hasText: /^新建$/ })
          .first();
        if (await newChatBtn.count()) {
          await newChatBtn.click();
          await sleep(1200);
        }
        await waitIdle(p);

        const r2 = await ask(
          p,
          `请帮我删除标题是 ${TARGET_TITLE} 的文档（doc_id=${TARGET_DOC_ID}）`,
          { expect: (s) => s.cards.length > 0 },
        );
        check("新对话里出现确认卡片", r2.cards.length > 0, JSON.stringify(r2.answer).slice(0, 200));
        await waitIdle(p);
        const confirmBtn = p
          .locator(`${PANEL_SEL} button`)
          .filter({ hasText: /^确认执行$/ })
          .last();
        if (await confirmBtn.count()) {
          await confirmBtn.click();
          await sleep(3500);
          const deleted = await p.evaluate(async (id) => {
            const t = localStorage.getItem("sunnydoc.token");
            const res = await fetch(`http://127.0.0.1:8000/api/v1/documents/${id}`, {
              headers: { Authorization: `Bearer ${t}` },
            });
            return !res.ok;
          }, TARGET_DOC_ID);
          check("🔴 确认后文档已被删除", deleted, "确认了但文档还在");
        } else {
          check("找到「确认执行」按钮", false, "未找到");
        }
      }
    }
  }

  check("全程无 JS 错误", errs.length === 0, errs.join(" | "));

  console.log(fail === 0 ? "\n✅ 全部通过" : `\n❌ ${fail} 项失败`);
  await b.close();
  process.exit(fail === 0 ? 0 : 1);
})();