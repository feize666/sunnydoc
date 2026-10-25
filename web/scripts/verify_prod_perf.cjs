#!/usr/bin/env node
/**
 * 长文档**生产构建**性能验证 —— 把「生产环境才代表真实体验」变成可重复的能力。
 *
 * ## 为什么必须单独有这一支
 *
 * `verify_longdoc_perf.cjs` 跑在 **dev server**（3001）上，它的判据刻意只判
 * 「业务不变量」（视口内已高亮 / 远视口保持纯文本），**不判绝对耗时** ——
 * 因为实测发现 dev 下约 **93% 的阻塞来自 React 开发模式**：
 *
 *     addObjectDiffToProperties  @react-dom-client.DEVELOPMENT.js  ← props 深比较
 *     exports.jsxDEV / jsxDEVImpl / ReactElement  @react-jsx-dev-runtime.DEVELOPMENT.js
 *
 * 于是「这个页面到底快不快」在 dev 下**测不出来**。本脚本补上这一环：
 * 用独立目录的生产构建（`output: "export"` 静态产物）+ 同域反代，测真实性能。
 *
 * ## 实测结论（2026-10-25，20 万字符 / 638 代码块文档）
 *
 *     生产：长任务 0–1 次，总阻塞 0–62ms   ← 真实用户体验
 *     dev ：长任务 6 次，   总阻塞 ~830ms
 *     ⇒ 生产比 dev 少阻塞 93%
 *
 * ## 安全约束（很重要）
 *
 * 🔴 **绝不在 `web/` 目录里跑 `next build`** —— 与 dev server 共用 `.next`
 *    会导致用户白屏**且 dev server 进程被杀**（见 MEMORY.md）。
 *    本脚本的做法：把源码复制到独立临时目录构建，与 dev 完全隔离。
 *
 * 🔴 **不要用 `node_modules` 软链**：Turbopack 会拒绝
 *    （`Symlink [project]/node_modules is invalid, it points out of the filesystem root`）。
 *    用 APFS 克隆 `cp -Rc`（copy-on-write，511MB 约 4 秒，比普通复制快一个量级）。
 *
 * 用法：
 *   NODE_PATH=<托管 node_modules> node web/scripts/verify_prod_perf.cjs
 *   # 可选：SKIP_BUILD=1 复用上次构建产物
 */
const { chromium } = require("playwright");
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");

const TOKEN = (
  process.env.SUNNYDOC_TOKEN ||
  fs.readFileSync(process.env.SUNNYDOC_TOKEN_FILE || "/tmp/sunnydoc-token.txt", "utf8")
).trim();
const API = process.env.SUNNYDOC_API || "http://127.0.0.1:8000";
const KB = process.env.SUNNYDOC_KB || "fdef57f179384d679b62a3c4bae2d2e3";
const DOC = process.env.SUNNYDOC_LONGDOC || "e1cf4cb9ed0d463b9edca6d97e194ee3";

const WEB_DIR = path.resolve(__dirname, "..");
const PROD_DIR = "/tmp/sunny-prod";
const PROD_PORT = parseInt(process.env.SUNNYDOC_PROD_PORT || "3901", 10);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (n, ok, d = "") => {
  console.log(`  ${ok ? "✅" : "❌"} ${n}${ok || !d ? "" : "  " + String(d).slice(0, 200)}`);
  ok ? pass++ : fail++;
};

/** 复制源码到独立目录并构建（不碰 web/.next）。 */
function buildProd() {
  console.log("=== 构建生产版（独立目录，不碰 web/.next）===");
  if (!process.env.SKIP_BUILD) {
    fs.rmSync(PROD_DIR, { recursive: true, force: true });
    fs.mkdirSync(PROD_DIR, { recursive: true });
    for (const item of ["src", "public", "package.json", "package-lock.json",
      "next.config.ts", "tsconfig.json", "postcss.config.mjs", "next-env.d.ts"]) {
      const from = path.join(WEB_DIR, item);
      if (fs.existsSync(from)) fs.cpSync(from, path.join(PROD_DIR, item), { recursive: true });
    }
    // APFS 克隆：秒级，且是真实目录（Turbopack 拒绝软链）
    execFileSync("cp", ["-Rc", path.join(WEB_DIR, "node_modules"),
      path.join(PROD_DIR, "node_modules")], { stdio: "inherit" });
    console.log("  源码与依赖已就位");
  }
  const env = { ...process.env, NODE_ENV: "production" };
  delete env.NODE_OPTIONS;
  const out = execFileSync(
    process.execPath,
    [path.join(PROD_DIR, "node_modules", ".bin", "next"), "build"],
    { cwd: PROD_DIR, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const okLine = out.split("\n").find((l) => /Compiled successfully|✓ Compiled/.test(l));
  console.log("  " + (okLine || "（未捕获到成功行）").trim());
  const stat = fs.statSync(path.join(PROD_DIR, "out", "index.html"));
  console.log(`  产物 out/ 就绪（${(stat.size / 1024).toFixed(0)}KB index.html）`);
  // 产物纯度：生产构建不应含 development 标记
  const chunksDir = path.join(PROD_DIR, "out", "_next", "static");
  let hasDev = false;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const fp = path.join(d, e.name);
      if (e.isDirectory()) walk(fp);
      else if (e.name.endsWith(".js")) {
        const c = fs.readFileSync(fp, "utf8");
        if (c.includes("addObjectDiffToProperties") || c.includes("react-dom.development")) hasDev = true;
      }
    }
  };
  if (fs.existsSync(chunksDir)) walk(chunksDir);
  check("产物是真正的生产构建（不含 React development 代码）", !hasDev);
}

/** 静态产物 + /api 反代（生产形态：nginx 同域反代）。 */
function startServer() {
  const ROOT = path.join(PROD_DIR, "out");
  const MIME = { ".html": "text/html;charset=utf-8", ".js": "text/javascript;charset=utf-8",
    ".css": "text/css;charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml",
    ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2", ".txt": "text/plain;charset=utf-8" };
  const srv = http.createServer((req, res) => {
    if (req.url.startsWith("/api/")) {
      const u = new URL(API);
      const prox = http.request({ host: u.hostname, port: u.port, path: req.url, method: req.method,
        headers: { ...req.headers, host: `${u.hostname}:${u.port}` } }, (up) => {
        res.writeHead(up.statusCode, up.headers); up.pipe(res);
      });
      prox.on("error", () => { res.writeHead(502); res.end("{}"); });
      req.pipe(prox);
      return;
    }
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p.endsWith("/")) p += "index.html";
    let full = path.join(ROOT, p);
    if (fs.existsSync(full) && fs.statSync(full).isDirectory()) full = path.join(full, "index.html");
    if (!fs.existsSync(full)) full = path.join(ROOT, "index.html");
    res.writeHead(200, { "content-type": MIME[path.extname(full).toLowerCase()] || "application/octet-stream" });
    fs.createReadStream(full).pipe(res);
  });
  /**
   * 启动静态服务器。
   *
   * 🔴 **必须处理 `error` 事件**：若端口被占用（例如上一次运行的进程没退干净，
   *    或手工起的验证服务器还在），`listen` 会抛未捕获异常 ——
   *    脚本直接崩、退出码非 0，但**报错信息不会说明是端口冲突**，
   *    排查时容易被误导成「构建失败」或「页面渲染失败」。
   *    显式捕获并给出可操作的提示。
   */
  return new Promise((resolve, reject) => {
    srv.on("error", (e) => {
      if (e.code === "EADDRINUSE") {
        reject(new Error(
          `端口 ${PROD_PORT} 已被占用 —— 上一次运行可能未退出干净。\n` +
          `  处理：lsof -nP -iTCP:${PROD_PORT} 找到进程后 kill，或改用 SUNNYDOC_PROD_PORT 换端口。`,
        ));
      } else {
        reject(e);
      }
    });
    srv.listen(PROD_PORT, "127.0.0.1", () => resolve(srv));
  });
}

(async () => {
  buildProd();
  const srv = await startServer();
  console.log(`\n验证服务器: http://127.0.0.1:${PROD_PORT}（静态 out/ + /api 反代）`);

  /**
   * 🔴 服务器就绪自检（不能只信 `listen` 的回调）。
   *
   * 实测症状：脚本在回归里跑时首页 **始终 0 张卡片**（重试 40 次也不行），
   * 而用「外部已起好的服务器」在浏览器里看同一产物却**完全正常**（28 张卡片）。
   * 差异在于：脚本内起的服务器与 Chromium 启动之间存在竞态，
   * `domcontentloaded` 返回时页面可能拿到的是一份**不完整的响应**。
   *
   * ⇒ 在打开浏览器前先用 HTTP 自检：`/` 与 `/api/v1/kbs` 都必须可达，
   *    否则给出明确诊断而不是让后续断言以「0 张卡片」这种误导性的形式失败。
   */
  const probe = async (pathName) => {
    return new Promise((resolve) => {
      const req = http.request(
        { host: "127.0.0.1", port: PROD_PORT, path: pathName, method: "GET", timeout: 5000 },
        (r) => { r.resume(); resolve(r.statusCode || 0); },
      );
      req.on("error", () => resolve(0));
      req.on("timeout", () => { req.destroy(); resolve(0); });
      req.end();
    });
  };
  let ready = false;
  for (let i = 0; i < 20; i++) {
    const root = await probe("/");
    const api = await probe("/api/v1/kbs"); // 401 也算可达（说明反代通）
    if (root === 200 && api > 0) { ready = true; break; }
    await sleep(300);
  }
  check("验证服务器就绪（静态 200 + 反代可达）", ready);

  const b = await chromium.launch({ headless: true, args: ["--no-proxy-server"] });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e).slice(0, 140)));
  const apiStatus = [];
  p.on("response", (r) => {
    if (r.url().includes("/api/")) apiStatus.push(`${r.status()} ${r.url().split("/api/")[1]}`);
  });

  await p.goto(`http://127.0.0.1:${PROD_PORT}/`, { waitUntil: "domcontentloaded" });
  await p.evaluate((t) => localStorage.setItem("sunnydoc.token", t), TOKEN);
  await p.reload({ waitUntil: "domcontentloaded" });

  console.log("\n=== 进入知识库（走真实交互）===");
  // 🔴 不能 goto `/#/kb/xxx`：hash 路由下浏览器视为同文档导航、不重新执行脚本
  let cards = 0;
  for (let i = 0; i < 40; i++) {
    cards = await p.evaluate(() => document.querySelectorAll('[data-testid="kb-card"]').length);
    if (cards > 0) { await sleep(400); break; } // 多等一帧再点，避免元素刚挂上就被点到
    await sleep(300);
  }
  // 失败时打印现场，避免只看到「0 张」却不知为何（本轮排查花了很久）
  if (cards === 0) {
    const bodyText = await p.evaluate(() => (document.body.innerText || "").slice(0, 200));
    console.log(`  [诊断] 页面文本: ${bodyText.replace(/\n+/g, " | ")}`);
    console.log(`  [诊断] /api 请求: ${apiStatus.slice(0, 8).join(" ; ") || "（无）"}`);
    console.log(`  [诊断] 页面错误: ${errs.slice(0, 2).join(" | ") || "（无）"}`);
  }
  check("首页渲染出知识库卡片（生产数据链路通）", cards > 0, `${cards} 张`);

  // 🔴 点击要**确认真的点到了**：`querySelector` 可能命中一个尚未完成布局的元素，
  //    出现「调了 click() 但路由没变」的静默失败（表现为后续树永远是 0 行）。
  //    故先等待目标卡片可见，再点击，并断言点击成功。
  let entered = false;
  for (let i = 0; i < 20 && !entered; i++) {
    entered = await p.evaluate((kb) => {
      const all = Array.from(document.querySelectorAll('[data-testid="kb-card"]'));
      // 优先精确 id；找不到则回退按名字（夹具被清理后 id 可能不存在）
      const c = all.find((x) => x.getAttribute("data-kb-id") === kb)
        || all.find((x) => (x.innerText || "").includes("云计算"))
        || all[0];
      if (!c) return false;
      const r = c.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false; // 未完成布局
      c.scrollIntoView({ block: "center" });
      c.click();
      return true;
    }, KB);
    if (!entered) await sleep(300);
  }
  check("已进入知识库（点击卡片成功）", entered);

  /**
   * 等文档树渲染。
   *
   * 🔴 **判据不能硬编码行数**（首版写 `rows >= 30`）：
   *    实测夹具被清理后本机只剩 1 个知识库、根层文件夹很少，
   *    树行数远达不到 30 —— 于是「等 50 次 × 300ms 全部落空」，
   *    白白拖长 15 秒并把失败原因引向错误方向（看起来像"没渲染"）。
   *    改为**自适应当前数据**：只要树里出现任意行、且数量不再增长，就算稳了。
   */
  let rows = 0, prev = -1, stable = 0;
  for (let i = 0; i < 60; i++) {
    rows = await p.evaluate(() => document.querySelectorAll("[data-tree-kind]").length);
    if (rows > 0 && rows === prev) { if (++stable >= 3) break; } else stable = 0;
    prev = rows;
    await sleep(300);
  }
  check("知识库文档树已加载", rows > 0, `${rows} 行`);

  await p.evaluate(() => {
    window.__lt = [];
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__lt.push(Math.round(e.duration));
    }).observe({ entryTypes: ["longtask"] });
  });

  // 用树内筛选定位长文档
  const fb = await p.$('[data-testid="tree-filter"]');
  let opened = false;
  if (fb) {
    await p.fill('[data-testid="tree-filter"]', "openEuler");
    await sleep(800);
    opened = await p.evaluate((id) => {
      const el = document.querySelector(`[data-tree-key="${id}"]`);
      if (!el) return false;
      el.scrollIntoView({ block: "center" });
      el.click();
      return true;
    }, DOC);
    await p.fill('[data-testid="tree-filter"]', "");
  }
  check("已打开长文档", opened);

  let snap = null;
  for (let i = 0; i < 60; i++) {
    snap = await p.evaluate(() => {
      const el = document.querySelector(".md-body");
      return el ? el.querySelectorAll("pre").length : 0;
    });
    if (snap > 50) break;
    await sleep(400);
  }
  await sleep(4500);

  const r = await p.evaluate(() => {
    const el = document.querySelector(".md-body");
    const pres = el ? Array.from(el.querySelectorAll("pre")) : [];
    const lt = window.__lt || [];
    return {
      total: pres.length,
      colored: pres.filter((x) => x.querySelector("span[style]")).length,
      pending: pres.filter((x) => x.getAttribute("data-code-lang")).length,
      nodes: el ? el.querySelectorAll("*").length : 0,
      lt, total_: lt.reduce((a, c) => a + c, 0), max: lt.length ? Math.max(...lt) : 0,
    };
  });

  console.log("\n=== 生产性能实测（20 万字符 / 638 代码块）===");
  console.log(`  DOM 节点 ${r.nodes} · 代码块 ${r.total}（已高亮 ${r.colored} / 纯文本 ${r.pending}）`);
  console.log(`  长任务 ${r.lt.length} 次  合计 ${r.total_}ms  最长 ${r.max}ms`);
  console.log(`  明细 [${r.lt.join(", ")}]`);

  check("长文档已渲染", r.total > 50, `${r.total} 个代码块`);
  // 阈值依据：生产实测 3 次为 0 / 50 / 62ms；给 3 倍余量防 CI 抖动。
  // dev 下同一场景约 830ms —— 若此断言在 dev 上跑必然失败，故必须跑生产。
  check(`生产总阻塞 < 200ms（实测 0–62ms）`, r.total_ < 200, `${r.total_}ms`);
  check(`生产最长单次 < 120ms（实测 0–62ms）`, r.max < 120, `${r.max}ms`);
  check("按需高亮语义在生产同样成立（有纯文本块）", r.pending > 0,
    `已高亮 ${r.colored} / 纯文本 ${r.pending}`);
  check("无未捕获页面异常", errs.length === 0, errs.slice(0, 2).join(" | "));

  console.log(`\n通过 ${pass} / 失败 ${fail}`);
  console.log(fail === 0 ? "✅ 全部通过" : "❌ 存在失败项");
  await b.close();
  srv.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  // 顶层兜底：把「端口占用 / 构建失败」这类前置错误说清楚，
  // 而不是甩一串裸栈（那样容易被误读成产品缺陷）。
  console.error("\n❌ 验证无法开始：" + (e && e.message ? e.message : String(e)));
  console.error("❌ 存在失败项");
  process.exit(1);
});