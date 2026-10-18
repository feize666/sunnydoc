#!/usr/bin/env node
/**
 * 真机验证「阅读态 / 分享页的图片放大」。
 *
 * 背景（2026-10-18 实测）：用户要求「阅读或编辑时双击可放大」。编辑态的双击
 * 早已实现，但阅读态的放大**整个是坏的**（单击、双击都毫无反应），而且此前的
 * 32 项 `verify_image_edit` 断言**只覆盖编辑态**（`.ProseMirror img`），
 * 一条都没测到它。根因：`useImageZoom` 的 effect 依赖 ref 对象（恒定）→ 只跑
 * 一次；首帧文档未加载、正文容器还不存在 → `if (!root) return` → **永不重绑**。
 *
 * 本脚本专测那条被漏掉的分支，两处入口各测一遍：
 *   · 阅读态（Editor 预览，容器 contentRef）
 *   · 分享页（ShareView，容器 bodyRef）—— 独立容器分支，必须单独验
 *
 * 断言（9 项）：
 *   1. 阅读态正文渲染出图片且带 md-zoomable
 *   2. 阅读态单击可打开放大
 *   3. Esc 可关闭
 *   4. **阅读态双击可打开且不被第二下关掉**（开场宽限期）
 *   5. 点遮罩空白处可关闭（子容器不能吞冒泡）
 *   6. 分享页正文渲染出图片且带 md-zoomable
 *   7. 分享页双击可打开且不被第二下关掉
 *   8. 分享页点空白处可关闭
 *   9. 零残留 + 无运行期异常
 *
 * ⚠️ 双击一律用**真实鼠标序列**（`p.mouse.dblclick`），不用合成
 *    `dispatchEvent(new MouseEvent("dblclick"))` —— 合成事件没有前面的 click#1，
 *    正好绕开「第二下点掉刚打开的遮罩」，判据会失去区分度。
 *
 * 用法：
 *   NODE_PATH=<托管 workspace node_modules> node web/scripts/verify_image_read_zoom.cjs
 */
const { chromium } = require("playwright");
const fs = require("fs");

const TOKEN =
  process.env.SUNNYDOC_TOKEN ||
  fs.readFileSync(process.env.SUNNYDOC_TOKEN_FILE || "/tmp/sunnydoc-token.txt", "utf8").trim();
const WEB = process.env.SUNNYDOC_WEB || "http://localhost:3001";
const API = process.env.SUNNYDOC_API || "http://localhost:8000";
const KB = process.env.SUNNYDOC_KB || "fdef57f179384d679b62a3c4bae2d2e3";
const TITLE = "IMGR-阅读态放大验证";
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

/** 200×100 的纯色 PNG，经 Python zlib 生成并解压校验（IDAT 是真能解码的数据）。 */
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAMgAAABkCAIAAABM5OhcAAAAzElEQVR42u3SMQ0AAAgEsZeFSNShCBMM" +
  "DE2q4HKpHjgXCTAWxsJYYCyMhbHAWBgLY4GxMBbGAmNhLIwFxsJYGAuMhbEwFhgLY2EsMBbGwlhgLIyF" +
  "scBYGAtjgbEwFsYCY2EsjAXGwlgYC4yFsTAWGAtjYSwwFsbCWGAsjIWxwFgYC2OBsTAWxgJjYSyMBcbC" +
  "WBgLjIWxMBYYC2NhLDAWxsJYYCyMhbHAWBgLY4GxMBbGAmNhLIyFsVTAWBgLY4GxMBbGAmNhLIwFxuK3" +
  "BV6a7faRBxaTAAAAAElFTkSuQmCC";

(async () => {
  const b = await chromium.launch({
    headless: true,
    args: ["--no-proxy-server"],
    ...(process.env.SUNNYDOC_CHROMIUM ? { executablePath: process.env.SUNNYDOC_CHROMIUM } : {}),
  });
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e).slice(0, 160)));
  // dev 浮层会吃掉所有指针事件（force 也躲不开）
  await p.addStyleTag({
    content: "nextjs-portal{display:none!important;pointer-events:none!important}",
  });

  const api = (path, method = "GET", body) =>
    p.evaluate(
      async ([apiBase, tok, path2, method2, body2]) => {
        const h = { Authorization: "Bearer " + tok, "Content-Type": "application/json" };
        const r = await fetch(apiBase + path2, {
          method: method2,
          headers: h,
          body: body2 ? JSON.stringify(body2) : undefined,
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

  const uploadFixture = async () =>
    await p.evaluate(
      async ([apiBase, tok, b64]) => {
        const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const fd = new FormData();
        fd.append("file", new File([bin], "t.png", { type: "image/png" }));
        const r = await fetch(apiBase + "/api/v1/upload/image", {
          method: "POST",
          headers: { Authorization: "Bearer " + tok },
          body: fd,
        });
        return await r.json();
      },
      [API, TOKEN, PNG_B64],
    );

  await p.goto(WEB, { waitUntil: "domcontentloaded" });
  await p.evaluate((t) => localStorage.setItem("sunnydoc.token", t), TOKEN);
  await p.reload({ waitUntil: "domcontentloaded" });
  await sleep(2500);

  // ---------- 清理（含分享链接，否则删除会因外键/分享残留失败） ----------
  const cleanup = async () => {
    const L = await api("/api/v1/documents?limit=500");
    for (const d of L.json.documents || []) {
      if (d.title === TITLE) {
        await api("/api/v1/documents/" + d.id + "/share", "DELETE").catch(() => {});
        await api("/api/v1/documents/" + d.id, "DELETE");
      }
    }
  };
  await cleanup();

  // ---------- 夹具：一篇带图文档 ----------
  const up = await uploadFixture();
  const imgUrl = up.url || up.src || "";
  check("夹具图片上传成功", !!imgUrl, JSON.stringify(up).slice(0, 200));

  const created = await api("/api/v1/documents", "POST", {
    title: TITLE,
    content: `# 阅读态放大\n\n![夹具图](${imgUrl})\n`,
    type: "doc",
    kb_id: KB,
  });
  const DOC_ID = created.json.id;
  check("夹具文档创建成功", !!DOC_ID, JSON.stringify(created).slice(0, 200));

  // ---------- 进知识库 → 打开文档（阅读态） ----------
  const kb = p.locator('[data-testid="kb-card"]').filter({ hasText: "云计算知识库" }).first();
  if (await kb.count()) await kb.click({ force: true });
  await sleep(3000);
  const rf = p.locator('[data-testid="refresh-doc-list"]').first();
  if (await rf.count()) {
    await rf.click({ force: true });
    await sleep(3000);
  }
  const tg = p.locator('[data-testid="toggle-batched-all"]').first();
  if ((await tg.count()) && (await tg.getAttribute("aria-pressed")) !== "true") {
    await tg.click({ force: true });
    await sleep(1200);
  }
  await p.locator('input[type="search"], input[placeholder*="搜索"]').first().fill(TITLE);
  await sleep(2000);
  const hit = p.getByText(TITLE, { exact: true }).first();
  if (await hit.count()) await hit.click({ force: true });
  await sleep(3500);

  const lbCount = async () => await p.locator('[data-testid="img-lightbox"]').count();
  const readState = await p.evaluate(() => ({
    mdImg: document.querySelectorAll(".md-body img").length,
    pm: document.querySelectorAll(".ProseMirror").length,
    zoomable: !!document.querySelector(".md-body.md-zoomable"),
  }));
  check(
    "阅读态正文渲染出图片且带 md-zoomable（非编辑态）",
    readState.mdImg > 0 && readState.pm === 0 && readState.zoomable,
    JSON.stringify(readState),
  );

  if (readState.mdImg > 0 && readState.pm === 0) {
    const readImg = p.locator(".md-body img").first();
    const center = async () => {
      await readImg.scrollIntoViewIfNeeded().catch(() => {});
      await sleep(350);
      return await readImg.boundingBox();
    };

    // 2) 单击打开
    const bb1 = await center();
    await p.mouse.click(bb1.x + bb1.width / 2, bb1.y + bb1.height / 2);
    const openByClick = await waitFor(async () => (await lbCount()) > 0, 4000, "阅读态单击打开");
    check("阅读态单击图片可放大", openByClick, `lightbox=${await lbCount()}`);

    // 3) Esc 关闭
    await p.keyboard.press("Escape");
    await sleep(700);
    check("Esc 关闭（阅读态）", (await lbCount()) === 0, "lightbox 仍在");

    // 4) 双击（真实鼠标序列；第二下会落在刚铺开的遮罩上）
    const bb2 = await center();
    await p.mouse.dblclick(bb2.x + bb2.width / 2, bb2.y + bb2.height / 2, { delay: 40 });
    await sleep(1000);
    const openByDbl = (await lbCount()) > 0;
    check(
      "阅读态双击可放大且不被第二下关掉",
      openByDbl,
      "双击后 lightbox 已消失 —— 多半是第二下点在了遮罩上（缺少开场宽限期）",
    );

    // 5) 点遮罩空白处关闭
    if (openByDbl) {
      await sleep(600); // 越过开场宽限期
      await p.mouse.click(40, 300);
      await sleep(700);
      const closed = (await lbCount()) === 0;
      check("点遮罩空白处可关闭（阅读态）", closed, "点遮罩后 lightbox 仍在");
      if (!closed) {
        await p.keyboard.press("Escape");
        await sleep(400);
      }
    } else {
      check("点遮罩空白处可关闭（阅读态）", false, "双击未能打开，无法测试关闭");
    }
  } else {
    check("阅读态单击图片可放大", false, "前置未成立");
    check("Esc 关闭（阅读态）", false, "前置未成立");
    check("阅读态双击可放大且不被第二下关掉", false, "前置未成立");
    check("点遮罩空白处可关闭（阅读态）", false, "前置未成立");
  }

  // ---------- 分享页（另一条容器分支 bodyRef） ----------
  const sh = await api("/api/v1/documents/" + DOC_ID + "/share", "POST", {});
  const shareToken = sh.json?.token || sh.json?.share?.token;
  check("可创建分享链接", !!shareToken, JSON.stringify(sh.json).slice(0, 200));

  if (shareToken) {
    // 分享页 URL 是查询串形态 `?share=<token>`（不是路径 /share/<token>）
    await p.goto(`${WEB}/?share=${shareToken}`, { waitUntil: "domcontentloaded" });
    await sleep(3000);
    const shState = await p.evaluate(() => ({
      imgs: document.querySelectorAll(".md-body img").length,
      zoomable: !!document.querySelector(".md-body.md-zoomable"),
    }));
    check("分享页渲染出图片且带 md-zoomable", shState.imgs > 0 && shState.zoomable, JSON.stringify(shState));

    const shImg = p.locator(".md-body img").first();
    if (await shImg.count()) {
      await shImg.scrollIntoViewIfNeeded().catch(() => {});
      await sleep(350);
      const bb = await shImg.boundingBox();
      await p.mouse.dblclick(bb.x + bb.width / 2, bb.y + bb.height / 2, { delay: 40 });
      await sleep(1000);
      const shOpen = (await lbCount()) > 0;
      check("分享页双击可放大且不被第二下关掉", shOpen, "lightbox 未打开或被立即关闭");
      if (shOpen) {
        await sleep(600);
        await p.mouse.click(40, 300);
        await sleep(700);
        const shClosed = (await lbCount()) === 0;
        check("分享页点空白处可关闭", shClosed, "仍开着");
        if (!shClosed) {
          await p.keyboard.press("Escape");
          await sleep(400);
        }
      } else {
        check("分享页点空白处可关闭", false, "前置未成立");
      }
    } else {
      check("分享页双击可放大且不被第二下关掉", false, "无图片");
      check("分享页点空白处可关闭", false, "无图片");
    }
    await api("/api/v1/documents/" + DOC_ID + "/share", "DELETE");
  } else {
    check("分享页渲染出图片且带 md-zoomable", false, "无分享 token");
    check("分享页双击可放大且不被第二下关掉", false, "无分享 token");
    check("分享页点空白处可关闭", false, "无分享 token");
  }

  // ---------- 清理 + 异常 ----------
  await cleanup();
  const L = await api("/api/v1/documents?limit=500");
  const left = (L.json.documents || []).filter((d) => d.title === TITLE);
  check("零残留", left.length === 0, JSON.stringify(left.map((d) => d.title)));
  check("运行期无未捕获页面异常", errs.length === 0, errs.slice(0, 3).join(" | "));

  console.log("\n" + (fail === 0 ? "全部通过 ✅" : `失败 ${fail} 项 ❌`));
  await b.close();
  process.exit(fail === 0 ? 0 : 1);
})();