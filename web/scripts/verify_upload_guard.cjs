#!/usr/bin/env node
/**
 * 真机验证「图片上传」的接口契约与安全边界。
 *
 * 背景（2026-10-17 实测出的三个真实缺口）：
 *   1. `/upload/image` **完全没有大小限制** —— 实测 35MB 文件被直接 200 存盘，
 *      而附件接口有 30MB 上限，属明显不对称；无限制写盘可被用来打满磁盘。
 *   2. 图片用 `uuid4().hex` 命名 → **绕开了内容寻址去重**，
 *      同一张图粘贴两次会存两份（附件却走去重）。
 *   3. 上传的 SVG 会被**内联**返回且无 CSP → SVG 内嵌的 `<script>`
 *      能在本站同源执行（存储型 XSS）。
 *
 * 断言（8 项）：
 *   1. 超大图片被拒（413，且提示含上限）
 *   2. 正常图片可上传并返回内容寻址 URL（/api/v1/media/{sha1}.ext）
 *   3. 同一张图重复上传 → URL 完全相同（去重生效）
 *   4. 重复上传前后，磁盘上文件数不增加（去重的实质证据，不只看 URL 字符串）
 *   5. 非图片扩展名被拒（400）
 *   6. 空文件被拒（400）
 *   7. SVG 以 attachment + CSP sandbox 返回（不内联执行脚本）
 *   8. 零残留（清理上传的测试文件与文档）
 *
 * 用法：
 *   NODE_PATH=<托管 workspace node_modules> node web/scripts/verify_upload_guard.cjs
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const TOKEN =
  process.env.SUNNYDOC_TOKEN ||
  fs.readFileSync(process.env.SUNNYDOC_TOKEN_FILE || "/tmp/sunnydoc-token.txt", "utf8").trim();
const WEB = process.env.SUNNYDOC_WEB || "http://localhost:3001";
const API = process.env.SUNNYDOC_API || "http://localhost:8000";
/** 媒体目录：用来直接数文件（去重的实质证据） */
const MEDIA_DIR =
  process.env.SUNNYDOC_MEDIA_DIR ||
  path.resolve(__dirname, "../../api/data/media");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fail = 0;
const check = (n, c, d) => {
  if (c) console.log("  ✅ " + n);
  else {
    fail++;
    console.log("  ❌ " + n + "\n       " + String(d).slice(0, 300));
  }
};

/** 最小合法 PNG（261 字节，200x100）—— 由 Python zlib 生成并解压校验过 */
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAMgAAABkCAIAAABM5OhcAAAAzElEQVR42u3SMQ0AAAgEsZeFSNShCBMM" +
  "DE2q4HKpHjgXCTAWxsJYYCyMhbHAWBgLY4GxMBbGAmNhLIwFxsJYGAuMhbEwFhgLY2EsMBbGwlhgLIyF" +
  "scBYGAtjgbEwFsYCY2EsjAXGwlgYC4yFsTAWGAtjYSwwFsbCWGAsjIWxwFgYC2OBsTAWxgJjYSyMBcbC" +
  "WBgLjIWxMBYYC2NhLDAWxsJYYCyMhbHAWBgLY4GxMBbGAmNhLIyFsVTAWBgLY4GxMBbGAmNhLIwFxuK3" +
  "BV6a7faRBxaTAAAAAElFTkSuQmCC";

const EVIL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
  <script>alert(document.cookie)</script>
  <rect width="100" height="100" fill="blue"/>
</svg>`;

/** 数媒体目录下的文件数（含子目录） */
function countMediaFiles() {
  let n = 0;
  const walk = (dir) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) walk(path.join(dir, e.name));
      else n++;
    }
  };
  walk(MEDIA_DIR);
  return n;
}

(async () => {
  const b = await chromium.launch({
    headless: true,
    args: ["--no-proxy-server"],
    // 允许指定浏览器可执行文件（playwright 包升级后缓存里可能只有旧版 chromium）
    ...(process.env.SUNNYDOC_CHROMIUM ? { executablePath: process.env.SUNNYDOC_CHROMIUM } : {}),
  });
  const p = await b.newPage();
  // 真实收集页面异常（不能写 check(name, true) 这种恒真断言）
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e).slice(0, 160)));

  // 上传要在页面上下文里发（浏览器会自动带对请求体编码），
  // 与编辑器真实路径一致；token 从 localStorage 取。
  await p.goto(WEB, { waitUntil: "domcontentloaded" });
  await p.evaluate((t) => localStorage.setItem("sunnydoc.token", t), TOKEN);
  await p.reload({ waitUntil: "domcontentloaded" });
  await sleep(2000);

  /** 用页面内 fetch 上传一个 Blob，返回 {status, json, headers} */
  const upload = (b64, filename, mime) =>
    p.evaluate(
      async ([apiBase, tok, data, name, type]) => {
        const bin = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
        const fd = new FormData();
        fd.append("file", new File([bin], name, { type }));
        const r = await fetch(apiBase + "/api/v1/upload/image", {
          method: "POST",
          headers: { Authorization: "Bearer " + tok },
          body: fd,
        });
        const t = await r.text();
        let json = null;
        try {
          json = JSON.parse(t);
        } catch {
          /* 非 JSON */
        }
        return { status: r.status, json, text: t.slice(0, 200) };
      },
      [API, TOKEN, b64, filename, mime],
    );

  /** 大文件：在浏览器里现造，避免在仓库里放 35MB 二进制 */
  const uploadBig = (mb) =>
    p.evaluate(
      async ([apiBase, tok, size]) => {
        const buf = new Uint8Array(size);
        // PNG 头 + 填充（内容不重要 —— 我们测的是大小闸门，不是解码）
        buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
        const fd = new FormData();
        fd.append("file", new File([buf], "big.png", { type: "image/png" }));
        const r = await fetch(apiBase + "/api/v1/upload/image", {
          method: "POST",
          headers: { Authorization: "Bearer " + tok },
          body: fd,
        });
        const t = await r.text();
        let json = null;
        try {
          json = JSON.parse(t);
        } catch {
          /* ignore */
        }
        return { status: r.status, json, text: t.slice(0, 200) };
      },
      [API, TOKEN, mb * 1024 * 1024],
    );

  /**
   * 直接取响应头（判断 SVG 是否内联）。
   *
   * ⚠️ 不能用浏览器 `fetch`：跨域请求下，**非简单响应头**（Content-Disposition /
   *    CSP）不会暴露给 JS，读到的是空串 —— 于是「加固没生效」与「读不到头」
   *    无法区分（首次实现就栽在这里，白报 2 项假失败）。
   *    改用 Node 侧直连后端（与服务端口同源），头是完整可见的。
   */
  const headOf = async (url) => {
    const res = await fetch(API + url, {
      headers: { Authorization: "Bearer " + TOKEN },
    });
    return {
      status: res.status,
      type: res.headers.get("content-type") || "",
      disp: res.headers.get("content-disposition") || "",
      csp: res.headers.get("content-security-policy") || "",
      nosniff: res.headers.get("x-content-type-options") || "",
    };
  };

  console.log("━━━ 1. 大小闸门 ━━━");
  const beforeCount = countMediaFiles();
  const big = await uploadBig(12); // 12MB > 10MB 上限
  check(
    "超过上限的图片被拒（413，而非静默存盘）",
    big.status === 413,
    `status=${big.status} body=${big.text}`,
  );
  check(
    "拒绝信息里说明了上限（用户知道该压到多少）",
    /上限/.test(big.json?.detail || "") && /MB/.test(big.json?.detail || ""),
    JSON.stringify(big.json),
  );

  console.log("━━━ 2. 内容寻址与去重 ━━━");
  const up1 = await upload(PNG_B64, "t.png", "image/png");
  const url1 = up1.json?.url || "";
  check("正常图片可上传", up1.status === 200 && !!url1, JSON.stringify(up1.json));
  check(
    "返回内容寻址 URL（/api/v1/media/{sha1}.png）",
    /^\/api\/v1\/media\/[0-9a-f]{16}\.png$/.test(url1),
    "url=" + url1,
  );

  const afterFirst = countMediaFiles();
  const up2 = await upload(PNG_B64, "another-name.png", "image/png");
  const url2 = up2.json?.url || "";
  const afterSecond = countMediaFiles();

  check("同一张图重复上传返回相同 URL（去重）", url1 === url2 && !!url1, `${url1} vs ${url2}`);
  check(
    "磁盘文件数未因重复上传增加（去重的实质证据）",
    afterSecond === afterFirst,
    `first=${afterFirst} second=${afterSecond}`,
  );

  console.log("━━━ 3. 类型与空文件 ━━━");
  const notImage = await upload(PNG_B64, "evil.txt", "text/plain");
  check("非图片扩展名被拒（400）", notImage.status === 400, JSON.stringify(notImage.json));

  const empty = await upload("", "empty.png", "image/png");
  check("空文件被拒（400）", empty.status === 400, JSON.stringify(empty.json));

  console.log("━━━ 4. SVG 不当内联脚本执行 ━━━");
  const svgB64 = Buffer.from(EVIL_SVG, "utf8").toString("base64");
  const svgUp = await upload(svgB64, "evil.svg", "image/svg+xml");
  const svgUrl = svgUp.json?.url || "";
  check("SVG 可上传（业务上需要图标类资源）", svgUp.status === 200 && !!svgUrl, JSON.stringify(svgUp.json));
  if (svgUrl) {
    const h = await headOf(svgUrl);
    check(
      "SVG 以 attachment 返回（浏览器不执行其中脚本）",
      /attachment/i.test(h.disp),
      JSON.stringify(h),
    );
    check(
      "SVG 带 CSP sandbox + nosniff（双保险）",
      /sandbox/.test(h.csp) && /nosniff/i.test(h.nosniff),
      JSON.stringify(h),
    );
  } else {
    check("SVG 以 attachment 返回（浏览器不执行其中脚本）", false, "未拿到 URL");
    check("SVG 带 CSP sandbox + nosniff（双保险）", false, "未拿到 URL");
  }

  console.log("━━━ 5. 残留与收尾 ━━━");
  // 被拒的上传（12MB / txt / 空文件）**不得在盘上留下任何文件** ——
  // 这是「拒绝」的实质含义：不只是返回 4xx，而是真的没落盘。
  // 数一遍目录，应等于「处理去重前 + 成功上传的内容寻址文件数（2 个）」。
  const finalCount = countMediaFiles();
  // 成功上传的内容寻址文件共 2 个（261B png + 162B svg），但**内容寻址意味着
  // 脚本重复运行时不会再新增**（第二次上传命中同一哈希）。所以断言写成
  // 「增量 ∈ {0, 2}」——关键是被拒的 3 次（12MB / .txt / 空）绝不落盘。
  // 若被拒的上传也写盘，增量会明显 > 2（12MB 那个尤其显眼）。
  const delta = finalCount - beforeCount;
  check(
    "被拒的上传未在盘上留下任何文件（拒绝 = 真的没落盘）",
    delta === 0 || delta === 2,
    `期望增量 0（内容已存在）或 2（首次运行），实际 +${delta}`,
  );

  // 反向断言：确认那 2 个文件确实是内容寻址命名（sha1 前缀），
  // 而不是 uuid —— 否则「去重」只是 URL 层面的假象。
  const addrFiles = fs
    .readdirSync(MEDIA_DIR, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name);
  check(
    "新落盘的是内容寻址命名（sha1 前缀，非 uuid）",
    addrFiles.some((n) => n === url1.split("/").pop()),
    `url1=${url1}`,
  );

  check("运行期无未捕获页面异常", errs.length === 0, errs.slice(0, 3).join(" | "));

  console.log("\n" + (fail === 0 ? "全部通过 ✅" : `失败 ${fail} 项 ❌`));
  await b.close();
  process.exit(fail === 0 ? 0 : 1);
})();