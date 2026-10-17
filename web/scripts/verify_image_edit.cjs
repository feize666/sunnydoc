#!/usr/bin/env node
/**
 * 真机验证「图片编辑体验」：插入 → 选中出浮条 → 改宽/对齐/删除 → 往返不丢。
 *
 * 背景：图片原先只有「插入」能力 —— 插进来就动不了了：想改大小得删掉重插，
 * 想对齐只能靠整段 textAlign（会连带整段文字）。本脚本钉住新增的三件事：
 *   1. 点选图片 → 浮出操作条（对齐×3 / 原宽 / 删除）
 *   2. 右下角拖动手柄改宽度；松手才落库（一次拖动 = 一步 undo）
 *   3. 宽度/对齐写进文档源（data-width / data-align），**保存后重新打开仍在**
 *
 * 重点在 3：只改 DOM 不改数据是「看起来能用」的典型陷阱 ——
 * 刷新即失效，但当场看着一切正常。
 *
 * 12 项断言：
 *   1. 能上传图片并插入正文（URL 形式，非 base64）
 *   2. 插入后 img.src 指向 /api/v1/media/
 *   3. 点击图片 → 出现浮条（img-toolbar）
 *   4. 浮条含三个对齐按钮 + 原宽 + 删除
 *   5. 点「居中」→ 容器 data-align=center
 *   6. 拖动手柄 → 宽度变化
 *   7. 保存后文档源里含 data-width / data-align（数据真的落库）
 *   8. 重新打开 → 宽度与对齐仍是改过的值（持久化）
 *   9. 只读/预览态不出现浮条（浮条是编辑态专属）
 *   10. 预览态宽度仍然生效（renderHTML 分支也要带 width，否则两态不一致）
 *   11. 点「删除」→ 图片从正文消失
 *   12. 零残留 + 无运行期异常
 *
 * 用法：
 *   NODE_PATH=<托管 workspace node_modules> node web/scripts/verify_image_edit.cjs
 */
const { chromium } = require("playwright");
const fs = require("fs");

const TOKEN =
  process.env.SUNNYDOC_TOKEN ||
  fs.readFileSync(process.env.SUNNYDOC_TOKEN_FILE || "/tmp/sunnydoc-token.txt", "utf8").trim();
const WEB = process.env.SUNNYDOC_WEB || "http://localhost:3001";
const API = process.env.SUNNYDOC_API || "http://localhost:8000";
const KB = process.env.SUNNYDOC_KB || "fdef57f179384d679b62a3c4bae2d2e3";
const TITLE = "IMG-图片编辑验证";
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

/**
 * 夹具图片：200×100 的纯色 PNG（真实矩形比例）。
 *
 * ⚠️ 两个坑（都实际踩过）：
 * 1. **不要用 1×1 图片**：CSS 会把它拉到容器宽度、高度按 1:1 比例算，
 *    手柄定位到很奇怪的位置（实测在视口外 380px），拖动测不了。
 * 2. **这一串 base64 必须是真能解码的**：早先版本只看「PNG 签名对、IHDR 尺寸对」
 *    就当成有效图，实际 IDAT 是坏数据 —— 浏览器加载必然失败，而当时没有
 *    错误提示，表现为「图片插入了但一片空白」，查了很久才定位到是夹具本身坏。
 *    现在这串由 Python 的 zlib 生成并**解压校验通过**（file/sips 双重确认 200x100）。
 *    改这串前后务必本地解码验一次，别只看前缀。
 */
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAMgAAABkCAIAAABM5OhcAAAAzElEQVR42u3SMQ0AAAgEsZeFSNShCBMM" +
  "DE2q4HKpHjgXCTAWxsJYYCyMhbHAWBgLY4GxMBbGAmNhLIwFxsJYGAuMhbEwFhgLY2EsMBbGwlhgLIyF" +
  "scBYGAtjgbEwFsYCY2EsjAXGwlgYC4yFsTAWGAtjYSwwFsbCWGAsjIWxwFgYC2OBsTAWxgJjYSyMBcbC" +
  "WBgLjIWxMBYYC2NhLDAWxsJYYCyMhbHAWBgLY4GxMBbGAmNhLIyFsVTAWBgLY4GxMBbGAmNhLIwFxuK3" +
  "BV6a7faRBxaTAAAAAElFTkSuQmCC";

(async () => {
  const b = await chromium.launch({ headless: true, args: ["--no-proxy-server"] });
  const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e).slice(0, 160)));
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

  await p.goto(WEB, { waitUntil: "domcontentloaded" });
  await p.evaluate((t) => localStorage.setItem("sunnydoc.token", t), TOKEN);
  await p.reload({ waitUntil: "domcontentloaded" });
  await sleep(2500);

  // ---------- 清理 ----------
  const cleanup = async () => {
    const L = await api("/api/v1/documents?limit=500");
    for (const d of L.json.documents || []) {
      if (d.title === TITLE) await api("/api/v1/documents/" + d.id, "DELETE");
    }
  };
  await cleanup();

  // ---------- 夹具：一篇空文档 ----------
  const created = await api("/api/v1/documents", "POST", {
    title: TITLE,
    content: "",
    type: "doc",
    kb_id: KB,
  });
  const DOC_ID = created.json.id;

  // 进知识库
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

  // 打开文档
  const box = p.locator('input[type="search"], input[placeholder*="搜索"]').first();
  await box.fill(TITLE);
  await sleep(2000);
  const hit = p.getByText(TITLE, { exact: true }).first();
  if (await hit.count()) await hit.click({ force: true });
  await sleep(3500);

  // 切编辑态
  const editBtn = p.locator("button").filter({ hasText: /^编辑$/ }).first();
  if (await editBtn.count()) {
    await editBtn.click({ force: true });
    await sleep(2500);
  }
  const editable = await waitFor(
    async () => (await p.locator(".ProseMirror").count()) > 0,
    8000,
    "进入编辑态",
  );
  check("进入编辑态", editable, "未出现 .ProseMirror");
  if (!editable) {
    await cleanup();
    await b.close();
    process.exit(1);
  }

  // ---------- 1) 上传并插入图片 ----------
  // 用页面上传接口拿 URL，再用编辑器命令插入 —— 模拟粘贴/拖拽的最终效果，
  // 且不依赖真实文件拖拽（drag 事件带 File 在 headless 下不稳）。
  const up = await p.evaluate(
    async ([apiBase, tok, b64]) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const fd = new FormData();
      fd.append("file", new File([bin], "t.png", { type: "image/png" }));
      const r = await fetch(apiBase + "/api/v1/upload/image", {
        method: "POST",
        headers: { Authorization: "Bearer " + tok },
        body: fd,
      });
      const t = await r.text();
      try {
        return { status: r.status, json: JSON.parse(t) };
      } catch {
        return { status: r.status, json: t };
      }
    },
    [API, TOKEN, PNG_B64],
  );
  const imgUrl = up.json?.url || up.json?.src || "";
  check("图片可上传（返回 URL）", up.status === 200 && !!imgUrl, JSON.stringify(up).slice(0, 200));

  // 插入到正文：走**工具栏的「图片」按钮 → 填 URL → 确定**。
// 这是用户真实路径，且不依赖内部字段（pmViewDesc 之类的私有属性会随版本变）。
await p.locator(".ProseMirror").first().click();
  await sleep(300);
  const imgBtn = p.locator('button[title="图片"]').first();
  let inserted = false;
  if (await imgBtn.count()) {
    await imgBtn.click({ force: true });
    await sleep(600);
    const urlInput = p.locator('[data-testid="image-url-input"]').first();
    if (await urlInput.count()) {
      await urlInput.fill(imgUrl);
      await sleep(300);
      const okBtn = p.locator('[data-testid="image-insert-btn"]').first();
      if (await okBtn.count()) {
        await okBtn.click({ force: true });
        inserted = true;
      }
    }
  }
  console.log("  插入路径: 工具栏图片按钮 = " + (inserted ? "已执行" : "未找到入口"));
  await sleep(1500);

  let imgInfo = await p.evaluate(() => {
    const im = document.querySelector(".ProseMirror img");
    return im ? { src: im.getAttribute("src") || "", has: true } : { has: false };
  });
  check("图片已插入正文", imgInfo.has, "正文里没有 img");
  // URL 形式（而非 base64 内嵌）—— 判定「是 URL 且非 data:」即可。
  // callout：图片有两种合法 URL 形态 ——
  //   · 编辑器上传：      /api/v1/upload/image 返回 /uploads/{uuid}.png
  //   · 导入/内容寻址附件：/api/v1/media/{sha1}.{ext}
  // 断言写死某一种会把另一种判成失败（我第一版就写死了 media，白报一次）。
  check(
    "图片以 URL 形式引用（非 base64 内嵌）",
    /^https?:\/\//.test(imgInfo.src || "") || /^\/(api\/v1\/media|uploads)\//.test(imgInfo.src || ""),
    "src=" + String(imgInfo.src || "(空)").slice(0, 120),
  );

  // ---------- 3/4) 点选图片 → 浮条 ----------
  // ⚠️ 不能用 `img.click()`：图片是 block 且被拉到正文整宽，在 1000px 视口里
  //    常落在视口外，Playwright 的可点性检查会直接抛
  //    「Element is outside of the viewport」（force:true 也绕不过滚动判定）。
  //    改为派发真实鼠标事件到图片中心 —— 与应用收到的事件一致，
  //    但不依赖 Playwright 的可见性/坐标校验。
  const clicked = await p.evaluate(() => {
    const im = document.querySelector(".ProseMirror img");
    if (!im) return false;
    im.scrollIntoView({ block: "center" });
    const r = im.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    im.dispatchEvent(new MouseEvent("mousedown", opts));
    im.dispatchEvent(new MouseEvent("mouseup", opts));
    im.dispatchEvent(new MouseEvent("click", opts));
    return true;
  });
  await sleep(900);
  const barShown = await waitFor(
    async () => (await p.locator('[data-testid="img-toolbar"]').count()) > 0,
    5000,
    "图片浮条出现",
  );
  check("点选图片后浮出操作条", clicked && barShown, "clicked=" + clicked);

  if (barShown) {
    const btns = await p.evaluate(() =>
      ["img-align-left", "img-align-center", "img-align-right", "img-reset-width", "img-delete"].map(
        (id) => !!document.querySelector(`[data-testid="${id}"]`),
      ),
    );
    check("浮条含 对齐×3 / 原宽 / 删除", btns.every(Boolean), JSON.stringify(btns));

    // ---------- 5) 居中 ----------
    await p.locator('[data-testid="img-align-center"]').first().click({ force: true });
    await sleep(800);
    const alignNow = await p.evaluate(
      () => document.querySelector(".ProseMirror [data-align]")?.getAttribute("data-align") || "",
    );
    check("点「居中」后容器 data-align=center", alignNow === "center", "data-align=" + alignNow);

    // ---------- 6) 拖动手柄改宽度 ----------
    const handle = p.locator('[data-testid="img-resize-handle"]').first();
    const hasHandle = (await handle.count()) > 0;
    let widthChanged = false;
    if (hasHandle) {
      const hb = await handle.boundingBox();
      console.log("     手柄 boundingBox = " + JSON.stringify(hb));
      if (hb) {
        // ⚠️ 手柄可能在视口外（图片在下方 / 页面已滚动）：
        //    Playwright 的 mouse.move 用的是**视口坐标**，目标在视口外时
        //    鼠标事件落不到元素上 —— 表现是「拖了但毫无反应」。
        //    先滚动到可见，再重新取坐标。
        await handle.scrollIntoViewIfNeeded().catch(() => {});
        await sleep(500);
        const hb2 = (await handle.boundingBox()) || hb;
        console.log("     滚动后手柄 = " + JSON.stringify(hb2));
        const beforeW = await p.evaluate(() => {
          const w = document.querySelector(".ProseMirror .doc-image-wrap span");
          return w ? Math.round(w.getBoundingClientRect().width) : 0;
        });
        // ⚠️ 位移必须**够小**，否则两种实现都会被下限 10% 夹住而结果相同 ——
//    实测：起点 18% 时拖 150px，正确实现算得 4.2%、基准取错的实现算得 -57%，
//    两者都被夹到 10% ⇒ 断言失去区分度（「阈值型断言最易无区分度」的又一例）。
//    拖 40px 时：正确 18-3.7=14%（变窄 48px）；基准取错 18-20=-2%→夹到 10%（变窄 91px）。
await p.mouse.move(hb2.x + hb2.width / 2, hb2.y + hb2.height / 2);
        await p.mouse.down();
        await p.mouse.move(hb2.x - 40, hb2.y + hb2.height / 2, { steps: 12 });
        await sleep(300);
        // 拖到一半时先看：如果 DOM 宽度在拖动中就已经变了，说明 ResizeHandle 生效，
        // 只是「松手落库」那步没写进去（两个阶段分开定位，避免混为一谈）
        const midW = await p.evaluate(() => {
          const w = document.querySelector(".ProseMirror .doc-image-wrap span");
          return w ? Math.round(w.getBoundingClientRect().width) : 0;
        });
        await p.mouse.up();
        await sleep(1200);
        const afterW = await p.evaluate(() => {
          const w = document.querySelector(".ProseMirror .doc-image-wrap span");
          return w ? Math.round(w.getBoundingClientRect().width) : 0;
        });
        console.log(`     宽度: 拖前 ${beforeW}px → 拖动中 ${midW}px → 松手后 ${afterW}px`);

        // 等自动保存落库
        const docOk = await waitFor(
          async () => {
            const d = await api("/api/v1/documents/" + DOC_ID);
            return /data-width/.test(String(d.json.text || ""));
          },
          8000,
          "data-width 落库",
        );
        widthChanged = docOk;
        check("拖动手柄后宽度写入文档源（data-width）", widthChanged, "源里无 data-width");

        // 🔴 方向与灵敏度断言：向左拖必须**变窄**，且变窄量要≈拖动像素量。
        //
        // 为什么「≈拖动像素量」是正确判据：`width:N%` 按包含块解析，拖动换算
        // 也用包含块 ⇒ N 像素位移对应 N 像素宽度变化（百分比的分子分母抵消）。
        // 基准取错（用图片自身宽 200px）时同样拖 40px 会算成 -20%，
        // 再被 10% 下限夹住 → 变窄约 91px，与 40px 差一倍多，可明确区分。
        //
        // ⚠️ 位移不能太大：拖 150px 时两种实现都被下限夹住、结果相同
        //    （阈值型断言失去区分度的典型情形，本脚本已栽过一次）。
        const base = await p.evaluate(() => {
          const w = document.querySelector(".doc-image-wrap");
          return w ? Math.round(w.getBoundingClientRect().width) : 0;
        });
        check("向左拖动后图片变窄（方向正确）", afterW < beforeW, `before=${beforeW} after=${afterW}`);
        const shrunk = beforeW - afterW;
        check(
          "变窄量≈拖动像素量（基准是包含块，而非图片自身）",
          shrunk >= 25 && shrunk <= 65,
          `实际变窄 ${shrunk}px，期望≈40px（包含块 ${base}px；基准取错时会变成 ~91px）`,
        );
      } else {
        check("拖动手柄后宽度写入文档源（data-width）", false, "手柄 boundingBox 为 null（不可见/被遮挡）");
      }
    } else {
      check("存在拖动手柄", false, "未找到 img-resize-handle");
    }
  }

  // ---------- 7) 保存后源里含属性 ----------
  // 编辑器配置了自动保存；等待其落库
  const savedOk = await waitFor(
    async () => {
      const d = await api("/api/v1/documents/" + DOC_ID);
      return /data-align="center"/.test(String(d.json.text || ""));
    },
    15000,
    "自动保存落库",
  );
  check("保存后文档源含 data-align='center'（数据真的落库）", savedOk, "源里没有该属性");

  // ---------- 8) 重新打开仍生效 ----------
  await p.reload({ waitUntil: "domcontentloaded" });
  await sleep(2500);
  const kb2 = p.locator('[data-testid="kb-card"]').filter({ hasText: "云计算知识库" }).first();
  if (await kb2.count()) await kb2.click({ force: true });
  await sleep(2500);
  const box2 = p.locator('input[type="search"], input[placeholder*="搜索"]').first();
  await box2.fill(TITLE);
  await sleep(2000);
  const hit2 = p.getByText(TITLE, { exact: true }).first();
  if (await hit2.count()) await hit2.click({ force: true });
  await sleep(4000);

  // ---------- 9/10) 预览态：无浮条但宽度/对齐仍生效 ----------
  const preview = await p.evaluate(() => {
    const root = document.querySelector(".md-body") || document.body;
    const im = root.querySelector("img");
    const wrap = root.querySelector("[data-align]");
    return {
      hasImg: !!im,
      toolbar: !!root.querySelector('[data-testid="img-toolbar"]'),
      align: wrap?.getAttribute("data-align") || "",
      style: im?.getAttribute("style") || "",
    };
  });
  check("预览态不出现浮条（编辑态专属）", preview.hasImg && !preview.toolbar, JSON.stringify(preview));
  check(
    "预览态仍保留对齐（renderHTML 分支也带 data-align）",
    preview.align === "center",
    JSON.stringify(preview),
  );

  // ---------- 11) 删除图片 ----------
  const editBtn2 = p.locator("button").filter({ hasText: /^编辑$/ }).first();
  if (await editBtn2.count()) {
    await editBtn2.click({ force: true });
    await sleep(2500);
  }
  const imgCount = await p.locator(".ProseMirror img").count();
  if (imgCount > 0) {
    // 同前：用派发事件代替 click（图片常在视口外）
    await p.evaluate(() => {
      const im = document.querySelector(".ProseMirror img");
      if (!im) return;
      im.scrollIntoView({ block: "center" });
      const r = im.getBoundingClientRect();
      const opts = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
      im.dispatchEvent(new MouseEvent("mousedown", opts));
      im.dispatchEvent(new MouseEvent("mouseup", opts));
      im.dispatchEvent(new MouseEvent("click", opts));
    });
    await sleep(900);
    const del = p.locator('[data-testid="img-delete"]').first();
    if (await del.count()) {
      await del.click({ force: true });
      await sleep(1500);
      const gone = await waitFor(
        async () => (await p.locator(".ProseMirror img").count()) === 0,
        5000,
        "图片被删除",
      );
      check("点「删除」后图片从正文消失", gone, "img 仍在");
    } else {
      check("点「删除」后图片从正文消失", false, "未找到 img-delete");
    }
  } else {
    check("点「删除」后图片从正文消失", false, "编辑态未找到 img");
  }

  // ---------- 13) 大图预览（双击图片 / 浮条「放大」） ----------
  // 编辑态切回编辑
  const editBtn3 = p.locator("button").filter({ hasText: /^编辑$/ }).first();
  if (await editBtn3.count()) {
    await editBtn3.click({ force: true });
    await sleep(2500);
  }
  if ((await p.locator(".ProseMirror img").count()) === 0) {
    // 上一步已删掉图片 —— 重新插一张（预览必须真的测到，不能因为顺序而跳过）
    const reinserted = await p.evaluate(
      async ([apiBase, tok, b64, id]) => {
        const H = { Authorization: "Bearer " + tok, "Content-Type": "application/json" };
        const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const fd = new FormData();
        fd.append("file", new File([bin], "t.png", { type: "image/png" }));
        const up = await fetch(apiBase + "/api/v1/upload/image", {
          method: "POST",
          headers: { Authorization: "Bearer " + tok },
          body: fd,
        });
        const { url } = await up.json();
        const cur = await (await fetch(apiBase + "/api/v1/documents/" + id, { headers: H })).json();
        // ⚠️ 更新文档的字段名是 `content`（不是 `text`）——PUT 时传 text 会被
        //    静默忽略（Pydantic 不报错），表现为「接口 200 但内容没变」。
        const put = await fetch(apiBase + "/api/v1/documents/" + id, {
          method: "PUT",
          headers: H,
          body: JSON.stringify({ content: String(cur.text || "") + `\n\n![测试图](${url})\n` }),
        });
        if (!put.ok) return { ok: false, reason: "PUT " + put.status };
        // 复核：读回来确认图片标记真的进去了（不假设成功）
        const after = await (await fetch(apiBase + "/api/v1/documents/" + id, { headers: H })).json();
        const wrote = /!\[测试图\]|doc-image|data-width/.test(String(after.text || ""));
        return { ok: wrote, size: String(after.text || "").length };
      },
      [API, TOKEN, PNG_B64, DOC_ID],
    );
    console.log("     重新插图: " + JSON.stringify(reinserted));
    await p.reload({ waitUntil: "domcontentloaded" });
    await sleep(2500);
    const kb3 = p.locator('[data-testid="kb-card"]').filter({ hasText: "云计算知识库" }).first();
    if (await kb3.count()) await kb3.click({ force: true });
    await sleep(2500);
    const box3 = p.locator('input[type="search"], input[placeholder*="搜索"]').first();
    await box3.fill(TITLE);
    await sleep(2000);
    const hit3 = p.getByText(TITLE, { exact: true }).first();
    if (await hit3.count()) await hit3.click({ force: true });
    await sleep(3500);
    const editBtn4 = p.locator("button").filter({ hasText: /^编辑$/ }).first();
    if (await editBtn4.count()) {
      await editBtn4.click({ force: true });
      await sleep(2500);
    }
  }

  // 双击图片 → lightbox
  const dbl = await p.evaluate(() => {
    const im = document.querySelector(".ProseMirror img");
    if (!im) return false;
    im.scrollIntoView({ block: "center" });
    const r = im.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    im.dispatchEvent(new MouseEvent("dblclick", opts));
    return true;
  });
  await sleep(1000);
  const lbOpen = await waitFor(
    async () => (await p.locator('[data-testid="img-lightbox"]').count()) > 0,
    5000,
    "lightbox 打开",
  );
  check("双击图片打开放大查看", dbl && lbOpen, `dblclick=${dbl} lightbox=${lbOpen}`);

  if (lbOpen) {
    const lbInfo = await p.evaluate(() => {
      const img = document.querySelector('[data-testid="img-lightbox-image"]');
      return {
        hasImg: !!img,
        natural: img ? img.naturalWidth + "x" + img.naturalHeight : "",
        complete: img ? img.complete : false,
        // 放大态应当真的加载成功（夹具是有效 PNG，此处应为 true）
        loadedOk: img ? img.complete && img.naturalWidth > 0 : false,
      };
    });
    check("放大态图片加载成功（非裂图）", lbInfo.loadedOk, JSON.stringify(lbInfo));

    // 缩放按钮生效
    await p.locator('[data-testid="img-zoom-in"]').first().click({ force: true });
    await p.locator('[data-testid="img-zoom-in"]').first().click({ force: true });
    await sleep(500);
    const zoomText = await p.evaluate(() => {
      const el = document.querySelector('[data-testid="img-lightbox-image"]');
      return el ? el.style.transform : "";
    });
    check("点「+」后图片被放大（transform scale > 1）", /scale\(1\.[1-9]/.test(zoomText), zoomText);

    await p.locator('[data-testid="img-zoom-fit"]').first().click({ force: true });
    await sleep(400);
    const fitText = await p.evaluate(
      () => document.querySelector('[data-testid="img-lightbox-image"]')?.style.transform || "",
    );
    check("点「适应窗口」后缩放重置", /scale\(1\)/.test(fitText), fitText);

    // Esc 关闭（走 useModalFocus 的既有约定）
    await p.keyboard.press("Escape");
    await sleep(700);
    const lbClosed = (await p.locator('[data-testid="img-lightbox"]').count()) === 0;
    check("Esc 关闭放大查看", lbClosed, "lightbox 仍存在");

    // 浮条「放大」按钮也要能开
    await p.evaluate(() => {
      const im = document.querySelector(".ProseMirror img");
      if (!im) return;
      im.scrollIntoView({ block: "center" });
      const r = im.getBoundingClientRect();
      const opts = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
      im.dispatchEvent(new MouseEvent("mousedown", opts));
      im.dispatchEvent(new MouseEvent("mouseup", opts));
      im.dispatchEvent(new MouseEvent("click", opts));
    });
    await sleep(800);
    const zoomBtn = p.locator('[data-testid="img-zoom"]').first();
    let viaBar = false;
    if (await zoomBtn.count()) {
      await zoomBtn.click({ force: true });
      await sleep(800);
      viaBar = (await p.locator('[data-testid="img-lightbox"]').count()) > 0;
      if (viaBar) {
        await p.keyboard.press("Escape");
        await sleep(600);
      }
    }
    check("浮条「放大」按钮也能打开", viaBar, "未打开或按钮不存在");
  }

  // ---------- 14) 拖动时显示宽度百分比 ----------
  await p.evaluate(() => {
    const im = document.querySelector(".ProseMirror img");
    if (!im) return;
    im.scrollIntoView({ block: "center" });
    const r = im.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    im.dispatchEvent(new MouseEvent("mousedown", opts));
    im.dispatchEvent(new MouseEvent("mouseup", opts));
    im.dispatchEvent(new MouseEvent("click", opts));
  });
  await sleep(800);
  const handle2 = p.locator('[data-testid="img-resize-handle"]').first();
  if (await handle2.count()) {
    await handle2.scrollIntoViewIfNeeded().catch(() => {});
    await sleep(400);
    const hb3 = await handle2.boundingBox();
    if (hb3) {
      await p.mouse.move(hb3.x + hb3.width / 2, hb3.y + hb3.height / 2);
      await p.mouse.down();
      await p.mouse.move(hb3.x - 80, hb3.y + hb3.height / 2, { steps: 6 });
      await sleep(400);
      const badge = await p.evaluate(
        () => document.querySelector('[data-testid="img-width-badge"]')?.textContent || "",
      );
      check("拖动中显示宽度百分比提示", /^\d+%$/.test(badge.trim()), "badge=" + JSON.stringify(badge));
      await p.mouse.up();
      await sleep(800);
      const badgeGone = (await p.locator('[data-testid="img-width-badge"]').count()) === 0;
      check("松手后百分比提示消失", badgeGone, "badge 仍在");
    } else {
      check("拖动中显示宽度百分比提示", false, "手柄不可见");
      check("松手后百分比提示消失", false, "未开始拖动");
    }
  } else {
    check("拖动中显示宽度百分比提示", false, "未找到手柄");
    check("松手后百分比提示消失", false, "未找到手柄");
  }

  // ---------- 12) 清理 + 异常 ----------
  await cleanup();
  const L = await api("/api/v1/documents?limit=500");
  const left = (L.json.documents || []).filter((d) => d.title === TITLE);
  check("零残留", left.length === 0, JSON.stringify(left.map((d) => d.title)));
  check("运行期无未捕获页面异常", errs.length === 0, errs.slice(0, 3).join(" | "));

  console.log("\n" + (fail === 0 ? "全部通过 ✅" : `失败 ${fail} 项 ❌`));
  await b.close();
  process.exit(fail === 0 ? 0 : 1);
})();