#!/usr/bin/env node
/**
 * 第八轮：命令面板的搜索导航与键盘焦点护栏。
 *
 * 真实缺陷：首页点搜索结果没有切视图；openDoc 随后清空 highlight；
 * 分组标题参与键盘索引；旧请求覆盖新查询；Esc 把焦点归还到 BODY。
 *
 * 夹具只使用 PALNAV- 前缀，结束时软删后 purge，不碰用户文档。
 */
const { chromium } = require("playwright");
const fs = require("fs");

const TOKEN = process.env.SUNNYDOC_TOKEN || fs.readFileSync("/tmp/sunnydoc-token.txt", "utf8").trim();
const API = process.env.SUNNYDOC_API || "http://127.0.0.1:8000";
const WEB = process.env.SUNNYDOC_WEB || "http://localhost:3001";
const KB = process.env.SUNNYDOC_KB || "fdef57f179384d679b62a3c4bae2d2e3";
const PREFIX = "PALNAV-";
const KB_NAME = "PALNAV-跨库";
const TITLE_A = "PALNAV-首页检索";
const TITLE_B = "PALNAV-跨库检索";
// 使用英文精确片段：中文检索按分词召回，用户旧文档可能合法排在夹具之前。
const TERM_A = "palnavalphaa";
const TERM_B = "palnavalphab";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
let createdKb = null;
const ids = new Set();
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "✅" : "❌"} ${name}${ok ? "" : "\n      " + String(detail).slice(0, 500)}`);
  if (!ok) fail++;
};
async function j(path, method = "GET", body) {
  const r = await fetch(API + "/api/v1" + path, {
    method,
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + TOKEN },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { s: r.status, j: json };
}
async function waitFor(fn, label, ms = 12000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if (await fn()) return true; } catch { /* 视图切换中再采样 */ }
    await sleep(150);
  }
  console.log("     waitFor 超时: " + label);
  return false;
}
async function cleanup() {
  const list = await j("/documents?limit=1000");
  for (const d of list.j.documents || []) {
    if (d.title?.startsWith(PREFIX)) {
      await j("/documents/" + d.id, "DELETE");
      await j("/trash/document/" + d.id, "DELETE");
    }
  }
  const trashed = await j("/trash");
  for (const d of trashed.j.documents || []) {
    if (d.title?.startsWith(PREFIX)) await j("/trash/document/" + d.id, "DELETE");
  }
  if (createdKb) {
    await j("/kbs/" + createdKb, "DELETE");
    await j("/trash/kb/" + createdKb, "DELETE");
    createdKb = null;
  }
}

(async () => {
  console.log("=== 命令面板：搜索导航 / 焦点 / 竞态护栏 ===");
  await cleanup();
  const a = await j("/documents", "POST", {
    title: TITLE_A,
    content: `# 检索示例\n\n这是正文里的${TERM_A}，打开结果后必须能看见真实高亮。`,
    type: "doc", kb_id: KB,
  });
  const kb = await j("/kbs", "POST", { name: KB_NAME, description: "命令面板跨库验证" });
  createdKb = kb.j.id || kb.j.kb?.id;
  const b = await j("/documents", "POST", {
    title: TITLE_B,
    content: `# 跨库示例\n\n另一知识库正文里的${TERM_B}必须准确保留。`,
    type: "doc", kb_id: createdKb,
  });
  for (const r of [a, b]) if (r.j.id) ids.add(r.j.id);
  check("建立两个知识库的独立检索夹具", a.s === 200 && b.s === 200 && ids.size === 2,
    JSON.stringify({ a: a.s, b: b.s, kb: createdKb }));

  const browser = await chromium.launch({ headless: true, args: ["--no-proxy-server"] });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: "zh-CN" });
  const p = await ctx.newPage();
  const errors = [];
  const searchRequests = [];
  p.on("request", (req) => {
    const url = new URL(req.url());
    if (url.pathname !== "/api/v1/search") return;
    searchRequests.push({ q: url.searchParams.get("q"), kbId: url.searchParams.get("kb_id") });
  });
  p.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
  await p.addInitScript((t) => {
    localStorage.setItem("sunnydoc.token", t);
    sessionStorage.removeItem("sunnydoc.currentKbId");
  }, TOKEN);
  try {
    await p.goto(WEB + "/", { waitUntil: "domcontentloaded" });
    const homeReady = await waitFor(() => p.locator('[data-testid="kb-card"]').count().then((n) => n > 1), "首页知识库加载");
    check("从首页开始（不依赖残留的当前库状态）", homeReady, "首页未加载两个知识库");
    await p.addStyleTag({ content: "nextjs-portal{display:none!important;pointer-events:none!important}" });

    const openPalette = async () => {
      await p.keyboard.press("Meta+k");
      await p.locator('[data-testid="command-palette"]').waitFor({ state: "visible", timeout: 6000 });
      await p.waitForFunction(() => document.activeElement?.getAttribute("role") === "combobox");
    };
    const query = async (text) => {
      const box = p.locator('[role="combobox"]');
      await box.fill(text);
      await waitFor(() => p.locator('[data-testid="palette-result"]').count().then((n) => n > 0), "搜索结果 " + text);
    };
    const docState = () => p.evaluate(() => ({
      hash: location.hash,
      title: document.querySelector("main h1")?.textContent || "",
      hits: document.querySelectorAll("main mark.search-hit").length,
      hitTexts: Array.from(document.querySelectorAll("main mark.search-hit"), (el) => el.textContent),
      sessionKb: sessionStorage.getItem("sunnydoc.currentKbId"),
    }));

    // 首页快捷键：打开 -> 选中 -> 正文真实 mark，而非只变了 hash。
    await p.evaluate(() => document.activeElement?.blur());
    await openPalette();
    await query(TERM_A);
    await p.keyboard.press("Enter");
    const opened = await waitFor(async () => {
      const s = await docState();
      return s.hash.includes(a.j.id) && s.title.includes(TITLE_A) && s.hitTexts.includes(TERM_A);
    }, "首页打开文档与高亮");
    const first = await docState();
    check("首页 Enter 搜索结果：切到正确文档并高亮正文命中词", opened, JSON.stringify(first));
    check("首页打开后当前知识库同步", first.sessionKb === KB, JSON.stringify(first));
    const homeSearch = searchRequests.find((r) => r.q === TERM_A);
    check("首页 ⌘K 搜索不带上次知识库的隐式过滤", homeSearch?.kbId === null, JSON.stringify(searchRequests));

    if (opened) {
      await p.goBack({ waitUntil: "domcontentloaded" }).catch(() => {});
    }
    const back = await waitFor(() => p.locator('[data-testid="kb-card"]').count().then((n) => n > 0), "浏览器返回首页");
    check("浏览器后退能回到首页", back && (await p.evaluate(() => location.hash)) === "", await p.url());
    if (!back) {
      // 快速失败路径也继续跑完独立护栏，但先恢复首页，避免级联超时掩盖定位。
      await p.goto(WEB + "/", { waitUntil: "domcontentloaded" });
      await waitFor(() => p.locator('[data-testid="kb-card"]').count().then((n) => n > 0), "对抗失败后恢复首页");
    }

    await p.evaluate(() => document.activeElement?.blur());
    await openPalette();
    await query(TERM_B);
    const backHomeSearch = searchRequests.filter((r) => r.q === TERM_B).at(-1);
    check("返回首页再搜仍为全局范围", backHomeSearch?.kbId === null, JSON.stringify(backHomeSearch));
    await p.keyboard.press("Enter");
    const cross = await waitFor(async () => {
      const s = await docState();
      return s.hash.includes(b.j.id) && s.title.includes(TITLE_B) && s.hitTexts.includes(TERM_B) && s.sessionKb === createdKb;
    }, "跨库打开与高亮");
    check("跨库打开：文档、当前库与正文高亮一起切换", cross, JSON.stringify(await docState()));

    // 设置页也没有 TitleBar；全局搜索仍需可用。
    await openPalette();
    await p.locator('[data-testid="palette-command"]').filter({ hasText: /^系统设置/ }).click();
    await waitFor(() => p.getByRole("heading", { name: "系统设置", exact: true }).count().then((n) => n > 0), "进入设置页");
    await p.evaluate(() => document.activeElement?.blur());
    await openPalette();
    await query(TERM_B);
    await p.keyboard.press("Enter");
    const fromSettings = await waitFor(async () => {
      const s = await docState();
      return s.hash.includes(b.j.id) && s.title.includes(TITLE_B) && s.hitTexts.includes(TERM_B);
    }, "设置页打开文档");
    check("设置页搜索结果同样能回到正确文档", fromSettings, JSON.stringify(await docState()));
    const settingsSearch = searchRequests.filter((r) => r.q === TERM_B).at(-1);
    check("设置页 ⌘K 搜索不带上次知识库的隐式过滤", settingsSearch?.kbId === null, JSON.stringify(settingsSearch));

    // 键盘选择：搜索无匹配命令时，首项是文档而非分组头；第二项也应是文档。
    await openPalette();
    await query(TERM_B);
    const firstSelected = await p.locator('[role="option"][aria-selected="true"]').getAttribute("role");
    await p.keyboard.press("ArrowDown");
    const nav = await p.evaluate(() => {
      const input = document.querySelector('[role="combobox"]');
      const id = input?.getAttribute("aria-activedescendant");
      const active = id ? document.getElementById(id) : null;
      return { activeRole: active?.getAttribute("role"), selected: active?.getAttribute("aria-selected"), text: active?.textContent };
    });
    check("分组标题不参与键盘选择，aria-activedescendant 指向 option",
      firstSelected === "option" && nav.activeRole === "option" && nav.selected === "true", JSON.stringify(nav));

    // 用可控网络响应制造逆序，不能依赖机器自然卡顿。
    let raceInstalled = false;
    await p.route("**/api/v1/search?*", async (route) => {
      const u = new URL(route.request().url());
      const q = u.searchParams.get("q");
      if (q !== "RACE_OLD" && q !== "RACE_NEW") return route.continue();
      raceInstalled = true;
      const old = q === "RACE_OLD";
      await sleep(old ? 900 : 80);
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({
          results: [{ doc_id: a.j.id, title: old ? "PALNAV-过期响应" : "PALNAV-当前响应", snippet: q, match_in_title: true, kb_id: KB }],
          terms: [q], total: 1,
        }),
      });
    });
    const box = p.locator('[role="combobox"]');
    await box.fill("RACE_OLD");
    await sleep(280);
    await box.fill("RACE_NEW");
    await sleep(1300);
    const race = await p.locator('[data-testid="palette-result"]').allTextContents();
    check("旧请求晚返回也不能覆盖当前查询", raceInstalled && race.length === 1 && race[0].includes("当前响应"), JSON.stringify(race));
    await p.unroute("**/api/v1/search?*");
    await p.keyboard.press("Escape");
    await waitFor(() => p.locator('[data-testid="command-palette"]').count().then((n) => n === 0), "关闭竞态面板");

    // 真实键盘：焦点不逃出；Esc 回到有语义入口，不再落到 BODY。
    await p.evaluate(() => document.activeElement?.blur());
    await openPalette();
    await p.keyboard.press("Shift+Tab");
    const trap = await p.evaluate(() => document.querySelector('[data-testid="command-palette"]')?.contains(document.activeElement));
    check("Shift+Tab 焦点仍在命令面板内", !!trap, await p.evaluate(() => document.activeElement?.outerHTML?.slice(0, 200)));
    await p.keyboard.press("Escape");
    const restore = await waitFor(() => p.evaluate(() => {
      const el = document.activeElement;
      return el?.matches('[data-testid="command-palette-trigger"], [data-testid="sidebar-search"]');
    }), "焦点归还语义入口");
    check("快捷键唤出后 Esc 归还到语义入口（非 BODY）", restore,
      await p.evaluate(() => document.activeElement?.outerHTML?.slice(0, 240)));

    const trigger = p.locator('[data-testid="command-palette-trigger"]:visible').first();
    await trigger.click();
    await p.locator('[role="combobox"]').waitFor();
    await p.keyboard.press("Escape");
    const clickedRestore = await waitFor(() => p.evaluate(() => document.activeElement?.getAttribute("data-testid") === "command-palette-trigger"), "鼠标触发焦点归还");
    check("点击搜索按钮后 Esc 精确归还触发按钮", clickedRestore, "焦点未回到触发按钮");

    // 390px 视口：面板内部滚动，无横向溢出，底部仍在可视区域。
    await p.setViewportSize({ width: 390, height: 640 });
    await p.evaluate(() => document.activeElement?.blur());
    await openPalette();
    await query(TERM_B);
    const mobile = await p.evaluate(() => {
      const panel = document.querySelector('[data-testid="command-palette"]').getBoundingClientRect();
      const list = document.querySelector("#command-palette-results");
      return {
        left: panel.left, right: panel.right, top: panel.top, bottom: panel.bottom,
        vw: innerWidth, vh: innerHeight,
        overflowX: document.documentElement.scrollWidth > innerWidth,
        internalScroll: list.clientHeight > 0 && getComputedStyle(list).overflowY === "auto",
      };
    });
    check("390×640 面板完整可达、内部滚动且无横向溢出",
      mobile.left >= 0 && mobile.right <= mobile.vw && mobile.top >= 0 && mobile.bottom <= mobile.vh && !mobile.overflowX && mobile.internalScroll,
      JSON.stringify(mobile));
    check("运行期无未捕获页面异常", errors.length === 0, errors.slice(0, 3).join(" | "));
  } finally {
    await browser.close().catch(() => {});
    await cleanup();
  }
  const left = await j("/documents?limit=1000");
  const kbs = await j("/kbs");
  const trash = await j("/trash");
  const leftDocs = (left.j.documents || []).filter((d) => d.title?.startsWith(PREFIX));
  const leftKbs = (kbs.j.kbs || []).filter((k) => k.name?.startsWith(PREFIX));
  const leftTrash = [...(trash.j.documents || []), ...(trash.j.kbs || [])]
    .filter((d) => d.title?.startsWith(PREFIX) || d.name?.startsWith(PREFIX));
  check("零残留（活跃列表 + 回收站）", leftDocs.length === 0 && leftKbs.length === 0 && leftTrash.length === 0,
    JSON.stringify({ docs: leftDocs.map((d) => d.title), kbs: leftKbs.map((k) => k.name), trash: leftTrash.map((d) => d.title || d.name) }));
  console.log("\n" + (fail === 0 ? "全部通过 ✅" : `失败 ${fail} 项 ❌`));
  process.exit(fail === 0 ? 0 : 1);
})().catch(async (e) => {
  console.error(e);
  await cleanup();
  process.exit(1);
});
