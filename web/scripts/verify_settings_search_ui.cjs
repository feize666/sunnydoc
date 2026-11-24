#!/usr/bin/env node
/**
 * 第九轮：侧栏搜索与系统设置 UI 护栏。
 *
 * 实测基线：主搜索框仅 149px，却与 81px 排序按钮争同一行；下方树筛选
 * 与主搜索外观相同。设置页把通用项、9 个 AI 字段、索引健康和关于串成
 * 一条全宽长表单。这里钉住改造后的结构，也验证搜索/设置行为没有退化。
 *
 * 只创建 SETUI- 临时文档。AI 保存、连接测试和外部模型请求在浏览器内
 * mock，绝不修改用户真实 AI 配置、密钥或调用真实供应商。
 * SUNNYDOC_TEST_OLD_UI=1 时只注入旧视觉样式做受控对照：本专项必须失败。
 */
const { chromium } = require("playwright");
const fs = require("fs");

const TOKEN = process.env.SUNNYDOC_TOKEN || fs.readFileSync("/tmp/sunnydoc-token.txt", "utf8").trim();
const API = process.env.SUNNYDOC_API || "http://127.0.0.1:8000";
const WEB = process.env.SUNNYDOC_WEB || "http://localhost:3001";
const KB = process.env.SUNNYDOC_KB || "fdef57f179384d679b62a3c4bae2d2e3";
const PREFIX = "SETUI-";
const TERM = "setuialphaword";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
let docId = null;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "✅" : "❌"} ${name}${ok ? "" : "\n      " + String(detail).slice(0, 700)}`);
  if (!ok) fail++;
};
async function j(path, method = "GET", body) {
  const r = await fetch(API + "/api/v1" + path, {
    method,
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + TOKEN },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { s: r.status, j: data };
}
async function cleanup() {
  for (const path of ["/documents?limit=1000", "/trash"]) {
    const r = await j(path);
    for (const d of r.j.documents || []) {
      if (!d.title?.startsWith(PREFIX)) continue;
      if (path === "/documents?limit=1000") await j("/documents/" + d.id, "DELETE");
      await j("/trash/document/" + d.id, "DELETE");
    }
  }
}
async function waitFor(fn, label, ms = 12000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if (await fn()) return true; } catch { /* 重采样 */ }
    await sleep(150);
  }
  console.log("     waitFor 超时: " + label);
  return false;
}
const visible = (p, selector) => p.locator(selector).filter({ visible: true }).first();
const isStaticPreview = new URL(WEB).port !== "3001";
const apiUrl = (value) => isStaticPreview ? API + new URL(value).pathname + new URL(value).search : value;

/** 静态导出没有 dev API 代理，仅在测试浏览器中把接口转发到本地后端。 */
async function setupBackendProxy(target) {
  if (!isStaticPreview) return;
  await target.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/v1/events/notifications") return route.abort();
    try {
      const response = await route.fetch({ url: apiUrl(route.request().url()) });
      await route.fulfill({ response });
    } catch {
      // 页面关闭时中止请求是正常清理，不应把 SSE 清理异常伪装成产品失败。
      await route.abort().catch(() => {});
    }
  });
}

(async () => {
  console.log("=== 侧栏搜索 / 系统设置 UI 护栏 ===");
  await cleanup();
  const fixture = await j("/documents", "POST", {
    title: `${PREFIX}搜索验证`, content: `# UI 验证\n\n正文包含 ${TERM}。`, type: "doc", kb_id: KB,
  });
  docId = fixture.j.id;
  check("建立唯一英文检索夹具", fixture.s === 200 && !!docId, JSON.stringify(fixture));
  const browser = await chromium.launch({ headless: true, args: ["--no-proxy-server"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "zh-CN" });
  const page = await context.newPage();
  await setupBackendProxy(page);
  const errors = [];
  const searchRequests = [];
  const searchResponses = [];
  let savePayload = null;
  const testPayloads = [];
  const modelPayloads = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.pathname === "/api/v1/search") {
      searchRequests.push(url.searchParams.get("q"));
      void req.response()?.then(async (response) => {
        const data = await response.json();
        searchResponses.push({ query: url.searchParams.get("q"), terms: data.terms || [], results: data.results || [] });
      }).catch(() => {});
    }
  });
  await page.addInitScript((t) => {
    localStorage.setItem("sunnydoc.token", t);
    sessionStorage.setItem("sunnydoc.currentKbId", "fdef57f179384d679b62a3c4bae2d2e3");
  }, TOKEN);
  await page.route("**/api/v1/settings/ai", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const response = await route.fetch({ url: apiUrl(route.request().url()) });
    const config = await response.json();
    await route.fulfill({ response, json: {
      ...config,
      llm_base_url: "https://chat.example/v1",
      llm_api_key: "sk-saved***",
      llm_model: "setui-llm-model",
      rerank_base_url: "",
      rerank_model: "setui-rerank-model",
    } });
  });
  await page.route("**/api/v1/settings/ai/test", async (route) => {
    const payload = route.request().postDataJSON();
    if (process.env.SUNNYDOC_TEST_OLD_AI_FLOW) await route.continue();
    else {
      testPayloads.push(payload);
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, status: 200, detail: "", content: `UI 验证连接 ${payload.group}` }) });
    }
  });
  await page.route("**/api/v1/settings/ai/models", async (route) => {
    modelPayloads.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, status: 200, detail: "", models: ["setui-model-a", "setui-model-b"] }) });
  });
  await page.route("**/api/v1/settings/ai", async (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    savePayload = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });

  try {
    await page.goto(WEB + "/#/kb", { waitUntil: "domcontentloaded" });
    const search = visible(page, '[data-testid="sidebar-search"]');
    await search.waitFor({ state: "visible" });
    await visible(page, '[data-testid="tree-filter"]').waitFor({ state: "visible" });
    if (process.env.SUNNYDOC_TEST_OLD_UI) {
      // addStyleTag 绑定当前 Document；必须在页面完成导航、目标 DOM 挂载后注入，
      // 不能在空白 about:blank 注入后指望它跨 document 保留。
      await page.addStyleTag({ content: `
        .sidebar-search-input.input,
        .sidebar-search-input.input:focus,
        .sidebar-search-input.input:focus-visible {
          border: 1px solid var(--line) !important;
          background: var(--surface-2) !important;
          box-shadow: none !important;
        }
        @media (hover: hover) and (pointer: fine) {
          .settings-nav-item:hover:not(.is-active) {
            transform: none !important;
            box-shadow: none !important;
          }
          .settings-nav-item:hover:not(.is-active) .settings-nav-icon {
            transform: none !important;
          }
          .settings-nav-item:hover:not(.is-active)::after {
            transform: scaleY(0) !important;
          }
        }
      ` });
      const injected = await search.evaluate((input) => getComputedStyle(input).borderTopWidth);
      check("旧双层搜索框已实际注入当前文档", injected === "1px", injected);
    } else {
      await page.addStyleTag({ content: "nextjs-portal{display:none!important;pointer-events:none!important}" });
    }
    const metrics = await search.evaluate((input) => {
      const aside = input.closest("aside");
      const filter = aside.querySelector('[data-testid="tree-filter"]');
      const sort = aside.querySelector('[data-testid="sidebar-sort"]');
      const inputRow = input.parentElement.parentElement;
      const filterStyle = getComputedStyle(filter);
      const inputStyle = getComputedStyle(input);
      return {
        inputWidth: input.getBoundingClientRect().width,
        asideWidth: aside.getBoundingClientRect().width,
        inputRowContainsSort: inputRow.contains(sort),
        sortNearTreeHeading: !!sort.closest('[data-testid="tree-heading"]'),
        inputHeight: input.getBoundingClientRect().height,
        filterHeight: filter.getBoundingClientRect().height,
        inputBorderWidth: inputStyle.borderTopWidth,
        shellHeight: input.parentElement.getBoundingClientRect().height,
        shellBorder: getComputedStyle(input.parentElement).borderTopColor,
        shellBackground: getComputedStyle(input.parentElement).backgroundColor,
        filterBorder: filterStyle.borderTopColor,
        filterBackground: filterStyle.backgroundColor,
      };
    });
    check("全文搜索独占整行（有效宽度 ≥200px）", metrics.inputWidth >= 200 && !metrics.inputRowContainsSort, JSON.stringify(metrics));
    check("排序归到文档树工具区", metrics.sortNearTreeHeading, JSON.stringify(metrics));
    check("树筛选采用紧凑次级样式，与全文搜索可区分", metrics.filterHeight === 32 && metrics.inputHeight === 38 && metrics.shellHeight === 40 && metrics.filterBackground !== metrics.shellBackground, JSON.stringify(metrics));
    check("主搜索只有容器一层边框，输入框不再重复描边", metrics.inputBorderWidth === "0px" && metrics.shellBackground !== "rgba(0, 0, 0, 0)", JSON.stringify(metrics));
    await search.focus();
    await page.waitForTimeout(200);
    const searchFocus = await search.evaluate((input) => ({
      shellBorder: getComputedStyle(input.parentElement).borderTopColor,
      shellShadow: getComputedStyle(input.parentElement).boxShadow,
      inputShadow: getComputedStyle(input).boxShadow,
    }));
    check("聚焦由唯一容器显示描边与光晕", searchFocus.shellBorder !== metrics.shellBorder && searchFocus.shellShadow !== "none" && searchFocus.inputShadow === "none", JSON.stringify(searchFocus));
    await search.blur();

    const sort = visible(page, '[data-testid="sidebar-sort"]');
    await sort.click();
    await page.getByRole("menuitemradio", { name: "按名称", exact: true }).click();
    check("文档排序仍可选择", (await sort.getAttribute("aria-label")) === "文档排序：按名称", await sort.getAttribute("aria-label"));
    const filter = visible(page, '[data-testid="tree-filter"]');
    await filter.fill("SETUI-不存在的名称");
    check("树筛选未发起全文检索", searchRequests.length === 0, JSON.stringify(searchRequests));
    await filter.fill("");
    await search.fill(TERM);
    const searched = await waitFor(async () => {
      const asideText = await search.evaluate((el) => el.closest("aside").innerText);
      return asideText.includes(`${PREFIX}搜索验证`);
    }, "全文搜索结果");
    check("主搜索仍返回真实后端结果", searched && searchRequests.includes(TERM), JSON.stringify(searchRequests));
      const marked = await waitFor(() => search.evaluate((input, { id, term }) => {
      const result = input.closest("aside")?.querySelector(`[data-search-doc-id="${id}"]`);
      return !!result && Array.from(result.querySelectorAll("mark")).some((m) => m.textContent === term);
    }, { id: docId, term: TERM }), "结果命中高亮");
    check("结果使用真实命中词高亮", marked, JSON.stringify({
      response: searchResponses.find((r) => r.query === TERM),
      dom: await search.evaluate((input, id) => input.closest("aside")?.querySelector(`[data-search-doc-id="${id}"]`)?.outerHTML || "未找到当前夹具的搜索结果", docId),
    }));
    await search.press("Enter");
    const keyboardOpened = await waitFor(() => page.locator(".md-body mark.search-hit").allTextContents()
      .then((hits) => hits.includes(TERM)), "键盘打开搜索结果");
    check("键盘 Enter 打开结果并在正文精确高亮", keyboardOpened,
      await page.locator(".md-body").innerText().catch(() => "正文未加载"));
    await page.getByRole("button", { name: "清除搜索", exact: true }).click();
    check("清除搜索恢复文档树", await filter.isVisible(), "搜索清空后树筛选未恢复");

    const mobileSearch = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: "zh-CN" });
    const mobileSearchPage = await mobileSearch.newPage();
    await setupBackendProxy(mobileSearchPage);
    mobileSearchPage.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
    await mobileSearchPage.addInitScript((t) => {
      localStorage.setItem("sunnydoc.token", t);
      sessionStorage.setItem("sunnydoc.currentKbId", "fdef57f179384d679b62a3c4bae2d2e3");
    }, TOKEN);
    await mobileSearchPage.goto(WEB + "/#/kb", { waitUntil: "domcontentloaded" });
    await mobileSearchPage.getByRole("banner").getByRole("button", { name: "折叠侧栏", exact: true }).tap();
    const mobileInput = visible(mobileSearchPage, '[data-testid="sidebar-search"]');
    await mobileInput.waitFor({ state: "visible" });
    const mobileFilter = visible(mobileSearchPage, '[data-testid="tree-filter"]');
    await mobileFilter.fill("SETUI-");
    const mobileFilterMetrics = await mobileFilter.evaluate((input) => ({
      height: input.getBoundingClientRect().height,
      clearHeight: input.parentElement.querySelector('[aria-label="清除筛选"]').getBoundingClientRect().height,
      clearWidth: input.parentElement.querySelector('[aria-label="清除筛选"]').getBoundingClientRect().width,
    }));
    check("移动树筛选与清除操作满足 44px", mobileFilterMetrics.height >= 44 && mobileFilterMetrics.clearHeight >= 44 && mobileFilterMetrics.clearWidth >= 44, JSON.stringify(mobileFilterMetrics));
    await mobileFilter.fill("");
    await mobileInput.fill(TERM);
    const mobileResult = visible(mobileSearchPage, `[data-search-doc-id="${docId}"]`);
    await mobileResult.waitFor({ state: "visible" });
    await mobileResult.tap();
    const drawerClosed = await waitFor(() => mobileSearchPage.locator("aside").evaluateAll((nodes) =>
      nodes.filter((el) => el.getBoundingClientRect().width > 0).length === 0
    ), "搜索结果关闭移动抽屉");
    const mobileHit = await waitFor(() => mobileSearchPage.locator(".md-body mark.search-hit").allTextContents()
      .then((hits) => hits.includes(TERM)), "移动结果正文高亮");
    check("移动搜索真实 tap 打开结果后关闭抽屉", drawerClosed && mobileHit, JSON.stringify({
      visibleAsides: await mobileSearchPage.locator("aside").evaluateAll((nodes) => nodes.filter((el) => el.getBoundingClientRect().width > 0).length),
      body: await mobileSearchPage.locator("body").innerText().then((t) => t.slice(0, 300)),
    }));
    await mobileSearchPage.getByRole("banner").getByRole("button", { name: "折叠侧栏", exact: true }).tap();
    const mobileSearchMetrics = await mobileInput.evaluate((input) => {
      const aside = input.closest("aside");
      const filter = aside.querySelector('[data-testid="tree-filter"]');
      const clear = aside.querySelector('[aria-label="清除搜索"]');
      const rect = (el) => el ? el.getBoundingClientRect().toJSON() : null;
      return { search: rect(input), filter: rect(filter), clear: rect(clear), coarse: matchMedia("(hover: none) and (pointer: coarse)").matches, overflow: document.documentElement.scrollWidth - innerWidth };
    });
    check("移动抽屉搜索区完整且无横向溢出", mobileSearchMetrics.search.width >= 200 && mobileSearchMetrics.overflow === 0, JSON.stringify(mobileSearchMetrics));
    check("移动搜索操作与输入目标符合粗指针 44px", mobileSearchMetrics.coarse
      && mobileSearchMetrics.search.height >= 44
      && (!mobileSearchMetrics.clear || (mobileSearchMetrics.clear.width >= 44 && mobileSearchMetrics.clear.height >= 44)), JSON.stringify(mobileSearchMetrics));
    await mobileSearchPage.screenshot({ path: "/tmp/setui-mobile-search-light.png", fullPage: true });
    await mobileSearchPage.locator("div.fixed.inset-0.z-30").tap({ position: { x: 340, y: 400 } });
    await mobileSearchPage.getByRole("button", { name: "切换主题", exact: true }).tap();
    await mobileSearchPage.getByRole("banner").getByRole("button", { name: "折叠侧栏", exact: true }).tap();
    await mobileSearchPage.screenshot({ path: "/tmp/setui-mobile-search-dark.png", fullPage: true });
    await mobileSearch.close();

    await page.goto(WEB + "/#/settings", { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="settings-general"]');
    check("默认进入外观与通用，而非整张 AI 长表单", await page.locator('[data-testid="settings-general"]').isVisible() && await page.locator('[data-testid="settings-llm"]').count() === 0);
    const settingsHeader = await page.locator("header").filter({ has: page.getByRole("heading", { name: "系统设置", exact: true }) }).evaluate((header) => ({
      text: header.innerText.trim(),
      headings: Array.from(header.querySelectorAll("h1")).map((el) => el.textContent.trim()),
      backButtons: header.querySelectorAll('[aria-label="返回上一级"]').length,
      actions: header.querySelectorAll("button").length,
      crumbs: header.querySelectorAll('[aria-label="位置"]').length,
    }));
    check("设置页头部只显示系统设置与返回标志，无面包屑、AI 状态或右侧操作", settingsHeader.text === "系统设置" && settingsHeader.headings.length === 1 && settingsHeader.headings[0] === "系统设置" && settingsHeader.backButtons === 1 && settingsHeader.actions === 1 && settingsHeader.crumbs === 0, JSON.stringify(settingsHeader));
    const navLabel = await page.locator(".settings-nav").evaluate((nav) => ({
      text: nav.innerText,
      accessibleLabel: nav.getAttribute("aria-label"),
      children: Array.from(nav.children).map((el) => el.tagName),
    }));
    check("分类栏不显示设置分类提示，但保留无障碍名称", !navLabel.text.includes("设置分类") && navLabel.accessibleLabel === "设置分类" && navLabel.children.every((tag) => tag === "BUTTON"), JSON.stringify(navLabel));
    await page.getByTestId("settings-tab-ai").click();
    check("AI 配置状态仍保留在所属分区内", await page.locator('[aria-label="AI 配置状态"]').count() === 1);
    await page.getByTestId("settings-tab-general").click();
    const hoverTab = page.getByTestId("settings-tab-ai");
    const restNav = await hoverTab.evaluate((el) => ({ transform: getComputedStyle(el).transform, shadow: getComputedStyle(el).boxShadow }));
    await hoverTab.hover();
    await page.waitForTimeout(250);
    const hoverNav = await hoverTab.evaluate((el) => ({
      transform: getComputedStyle(el).transform,
      x: el.getBoundingClientRect().x,
      iconScale: getComputedStyle(el.querySelector("svg").parentElement).transform,
      shadow: getComputedStyle(el).boxShadow,
      indicator: getComputedStyle(el, "::after").transform,
      icons: el.querySelectorAll("svg").length,
    }));
    check("桌面分类悬停具有右移、图标联动、指示条和阴影", restNav.transform === "none" && hoverNav.transform === "matrix(1, 0, 0, 1, 6, 0)" && hoverNav.iconScale !== "none" && hoverNav.shadow !== "none" && hoverNav.indicator !== "none" && hoverNav.icons === 1, JSON.stringify({ restNav, hoverNav }));
    const selectedNav = await page.getByTestId("settings-tab-general").evaluate((el) => ({ selected: el.getAttribute("aria-selected"), transform: getComputedStyle(el).transform, indicator: getComputedStyle(el, "::after").transform }));
    check("选中分类保持稳定且有持续指示条", selectedNav.selected === "true" && selectedNav.transform === "none" && selectedNav.indicator !== "none", JSON.stringify(selectedNav));
    await page.getByTestId("settings-tab-general").focus();
    await page.keyboard.press("ArrowRight");
    const keyboardNavReady = await waitFor(() => page.getByTestId("settings-tab-ai").evaluate((el) => document.activeElement === el && el.getAttribute("aria-selected") === "true"), "分类方向键焦点同步");
    const focusedNav = await page.getByTestId("settings-tab-ai").evaluate((el) => ({ focused: document.activeElement === el, selected: el.getAttribute("aria-selected"), outline: getComputedStyle(el).outlineStyle }));
    check("键盘切换分类时焦点和选中项同步", keyboardNavReady && focusedNav.focused && focusedNav.selected === "true" && focusedNav.outline !== "none", JSON.stringify(focusedNav));
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByTestId("settings-tab-ai").hover();
    const reducedNav = await hoverTab.evaluate((el) => ({ transform: getComputedStyle(el).transform, transition: getComputedStyle(el).transitionDuration }));
    check("减少动态效果时取消分类位移与过渡", reducedNav.transform === "none" && reducedNav.transition === "0s", JSON.stringify(reducedNav));
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.getByTestId("settings-tab-general").click();
    const themeBefore = await page.evaluate(() => document.documentElement.dataset.theme);
    for (const section of ["general", "ai", "search", "about"]) {
      await page.getByTestId(`settings-tab-${section}`).click();
      const settingsMetrics = await page.evaluate((current) => ({
        theme: document.documentElement.dataset.theme,
        overflow: document.documentElement.scrollWidth - innerWidth,
        visible: !!document.querySelector(`#settings-panel-${current}`)?.getClientRects().length,
        tokens: Object.fromEntries(["--background", "--text", "--faint", "--accent"].map((name) => [name, getComputedStyle(document.documentElement).getPropertyValue(name).trim()])),
      }), section);
      check(`${themeBefore} 主题设置分区 ${section} 可见且无横向溢出`, settingsMetrics.visible && settingsMetrics.overflow === 0, JSON.stringify(settingsMetrics));
      await page.screenshot({ path: `/tmp/setui-${themeBefore}-${section}.png`, fullPage: true });
    }
    await page.getByTestId("settings-tab-general").click();
    const nextTheme = themeBefore === "dark" ? "light" : "dark";
    await page.getByTestId(`settings-theme-${nextTheme}`).click();
    check("主题卡片切换真实主题", await page.evaluate((t) => document.documentElement.dataset.theme === t, nextTheme) && await page.getByTestId(`settings-theme-${nextTheme}`).getAttribute("aria-pressed") === "true");
    for (const section of ["general", "ai", "search", "about"]) {
      await page.getByTestId(`settings-tab-${section}`).click();
      const settingsMetrics = await page.evaluate((current) => ({
        theme: document.documentElement.dataset.theme,
        overflow: document.documentElement.scrollWidth - innerWidth,
        visible: !!document.querySelector(`#settings-panel-${current}`)?.getClientRects().length,
        tokens: Object.fromEntries(["--background", "--text", "--faint", "--accent"].map((name) => [name, getComputedStyle(document.documentElement).getPropertyValue(name).trim()])),
      }), section);
      check(`${nextTheme} 主题设置分区 ${section} 可见且无横向溢出`, settingsMetrics.theme === nextTheme && settingsMetrics.visible && settingsMetrics.overflow === 0, JSON.stringify(settingsMetrics));
      await page.screenshot({ path: `/tmp/setui-${nextTheme}-${section}.png`, fullPage: true });
    }
    await page.getByTestId("settings-tab-general").click();
    await page.getByTestId(`settings-theme-${themeBefore}`).click();

    const aiTab = page.getByTestId("settings-tab-ai");
    await aiTab.click();
    await page.waitForSelector('[data-testid="settings-llm"]');
    const fieldMetrics = await page.evaluate(() => ({
      inputs: document.querySelectorAll('#settings-panel-ai input').length,
      tests: Array.from(document.querySelectorAll('#settings-panel-ai button')).filter((b) => b.textContent === "测试连接").length,
      modelButtons: Array.from(document.querySelectorAll('#settings-panel-ai button')).filter((b) => b.textContent === "获取模型").length,
      unlabeledInputs: Array.from(document.querySelectorAll('#settings-panel-ai input')).filter((el) => !el.labels?.length).length,
      providerLabeled: !!document.querySelector("#settings-provider")?.labels?.length,
    }));
    check("三组 AI 配置字段完整保留", fieldMetrics.inputs === 8 && fieldMetrics.tests === 3 && fieldMetrics.modelButtons === 2, JSON.stringify(fieldMetrics));
    check("每个 AI 输入和供应商均有可关联标签", fieldMetrics.unlabeledInputs === 0 && fieldMetrics.providerLabeled, JSON.stringify(fieldMetrics));
    await aiTab.focus();
    await page.keyboard.press("ArrowRight");
    check("设置页签支持方向键与焦点同步", await page.getByTestId("settings-tab-search").getAttribute("aria-selected") === "true" && await page.evaluate(() => document.activeElement?.id === "settings-tab-search"));
    await page.getByTestId("settings-vector-health").waitFor({ state: "visible" });
    const vectorText = await page.getByTestId("settings-vector-health").innerText();
    check("向量健康与修复入口独立成区", /向量服务|PostgreSQL/.test(vectorText) && /重新检测/.test(vectorText), vectorText);
    await aiTab.click();
    await page.locator('[data-testid="settings-llm"] button').filter({ hasText: /^测试连接$/ }).click();
    const tested = await waitFor(() => page.locator('[data-testid="settings-llm"]').innerText().then((t) => t.includes("连接成功") && t.includes("UI 验证连接")), "连接测试反馈");
    check("连接测试反馈归属对话模型", tested, "对话模型卡片没有连接成功反馈");
    const savedTest = testPayloads.at(-1);
    check("留空密钥使用服务端保存配置，不回传脱敏密钥", !!savedTest && savedTest.saved === true && savedTest.group === "llm" && savedTest.api_key === "", JSON.stringify(savedTest));
    await page.locator('[data-testid="settings-llm"] input[type="password"]').fill("setui-explicit-secret");
    await page.locator('[data-testid="settings-llm"] button').filter({ hasText: /^测试连接$/ }).click();
    await waitFor(() => testPayloads.length >= 2, "显式密钥测试请求");
    const explicitTest = testPayloads.at(-1);
    check("显式新密钥优先且不读取保存配置", explicitTest?.api_key === "setui-explicit-secret" && explicitTest?.saved === false && explicitTest?.group === "llm", JSON.stringify(explicitTest));
    await page.locator('[data-testid="settings-llm"] input[type="password"]').fill("");
    await page.locator('[data-testid="settings-llm"] button').filter({ hasText: /^获取模型$/ }).click();
    await page.getByRole("button", { name: "setui-model-b", exact: true }).click();
    check("模型列表能填入所选模型", await page.locator('[data-testid="settings-llm"] input').nth(2).inputValue() === "setui-model-b");
    check("模型列表按所属分组请求且复用保存密钥", modelPayloads[0]?.group === "llm" && modelPayloads[0]?.saved === true && modelPayloads[0]?.api_key === "", JSON.stringify(modelPayloads));
    await page.locator('[data-testid="settings-embedding"] button').filter({ hasText: /^测试连接$/ }).click();
    await page.locator('[data-testid="settings-rerank"] button').filter({ hasText: /^测试连接$/ }).click();
    await waitFor(() => testPayloads.some((p) => p.group === "embedding") && testPayloads.some((p) => p.group === "rerank"), "向量与精排分组请求");
    const rerankTest = testPayloads.find((p) => p.group === "rerank");
    check("向量与精排测试请求归属各自分组", testPayloads.some((p) => p.group === "embedding") && !!rerankTest, JSON.stringify(testPayloads.map((p) => p.group)));
    check("精排使用当前模型名，接口留空复用对话地址", !!rerankTest && rerankTest.model === "setui-rerank-model"
      && rerankTest.base_url === "https://chat.example/v1" && rerankTest.saved === true, JSON.stringify(rerankTest));
    await page.locator('[data-testid="settings-llm"] input[type="password"]').fill("setui-rerank-secret");
    await page.locator('[data-testid="settings-rerank"] button').filter({ hasText: /^测试连接$/ }).click();
    await waitFor(() => testPayloads.filter((p) => p.group === "rerank").length >= 2, "精排显式新密钥请求");
    const explicitRerank = testPayloads.filter((p) => p.group === "rerank").at(-1);
    check("精排显式新密钥优先于保存密钥", explicitRerank?.api_key === "setui-rerank-secret" && explicitRerank?.saved === false, JSON.stringify({ payloads: testPayloads, input: await page.locator('[data-testid="settings-llm"] input[type="password"]').inputValue() }));
    await page.locator('[data-testid="settings-llm"] input[type="password"]').fill("");
    await page.getByTestId("settings-save").click();
    const saved = await waitFor(() => page.locator('#settings-panel-ai [role="status"]').filter({ hasText: "配置已保存" }).isVisible(), "保存反馈");
    const expectedSaveFields = [
      "provider", "llm_base_url", "llm_api_key", "llm_model",
      "embedding_base_url", "embedding_api_key", "embedding_model",
      "rerank_base_url", "rerank_model",
    ];
    const saveFields = Object.keys(savePayload || {}).sort();
    check("保存配置沿用原接口与全部字段", saved && !!savePayload
      && JSON.stringify(saveFields) === JSON.stringify([...expectedSaveFields].sort())
      && savePayload.llm_model === "setui-model-b" && savePayload.llm_api_key === "", JSON.stringify(savePayload));
    await page.getByTestId("settings-tab-about").click();
    check("关于分区独立可见", await page.getByTestId("settings-about").isVisible());
    await page.getByTestId("settings-tab-general").click();
    await page.getByTestId(`settings-theme-${themeBefore}`).click();

    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: "zh-CN" });
    const mp = await mobile.newPage();
    await setupBackendProxy(mp);
    await mp.addInitScript((t) => localStorage.setItem("sunnydoc.token", t), TOKEN);
    await mp.goto(WEB + "/#/settings", { waitUntil: "domcontentloaded" });
    await mp.getByTestId("settings-tab-ai").tap();
    await mp.getByTestId("settings-llm").waitFor({ state: "visible" });
    const mobileMetrics = await mp.evaluate(() => {
      const panel = document.querySelector("#settings-panel-ai");
      const overflowing = Array.from(panel.querySelectorAll("*")).filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.right > innerWidth + 1;
      });
      return {
        pageOverflow: document.documentElement.scrollWidth - innerWidth,
        overflowing: overflowing.map((el) => ({ tag: el.tagName, class: el.className, right: el.getBoundingClientRect().right })),
        save: document.querySelector('[data-testid="settings-save"]').getBoundingClientRect().toJSON(),
        saveVisible: !!document.querySelector('[data-testid="settings-save"]').getClientRects().length,
      };
    });
    check("390px AI 表单无横向溢出", mobileMetrics.pageOverflow === 0 && mobileMetrics.overflowing.length === 0, JSON.stringify(mobileMetrics));
    check("移动端保存按钮可达且触控高度 ≥44px", mobileMetrics.saveVisible && mobileMetrics.save.height >= 44, JSON.stringify(mobileMetrics.save));
    await mp.screenshot({ path: "/tmp/setui-mobile-ai-light.png", fullPage: true });
    for (const section of ["general", "ai", "search", "about"]) {
      await mp.getByTestId(`settings-tab-${section}`).tap();
      await mp.waitForTimeout(350);
      const mobileSection = await mp.evaluate((current) => {
        const tab = document.querySelector(`[data-testid="settings-tab-${current}"]`);
        const nav = tab.closest("nav");
        const rect = tab.getBoundingClientRect();
        const bounds = nav.getBoundingClientRect();
        return {
          pageWidth: document.documentElement.scrollWidth,
          viewport: document.documentElement.clientWidth,
          selected: tab.getAttribute("aria-selected"),
          selectedVisible: rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1,
          panel: !!document.querySelector(`#settings-panel-${current}`)?.getClientRects().length,
        };
      }, section);
      check(`375px 设置分区 ${section} 无页面溢出且选中页签可见`, mobileSection.pageWidth === mobileSection.viewport
        && mobileSection.selected === "true" && mobileSection.selectedVisible && mobileSection.panel, JSON.stringify(mobileSection));
    }
    await mp.getByTestId("settings-tab-ai").tap();
    await mp.getByTestId("settings-llm").waitFor({ state: "visible" });
    const mobileControls = await mp.locator("#settings-panel-ai button, #settings-panel-ai input, #settings-panel-ai select, [role='tab']").evaluateAll((nodes) => nodes.filter((el) => el.getClientRects().length).map((el) => ({
      text: el.getAttribute("aria-label") || el.textContent?.trim().slice(0, 24) || el.tagName,
      width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height,
    })));
    const undersized = mobileControls.filter((el) => el.width < 44 || el.height < 44);
    check("移动设置页签与表单控件均满足 44px 触控目标", undersized.length === 0, JSON.stringify(undersized));
    await mp.getByTestId("settings-tab-about").tap();
    await mp.waitForTimeout(350);
    const mobileTab = await mp.getByTestId("settings-tab-about").evaluate((el) => {
      const nav = el.closest("nav");
      const r = el.getBoundingClientRect(), n = nav.getBoundingClientRect();
      return { icons: el.querySelectorAll("svg").length, height: r.height, visible: r.left >= n.left && r.right <= n.right + 1, navWidth: nav.clientWidth, scrollWidth: nav.scrollWidth, coarse: matchMedia("(hover: none) and (pointer: coarse)").matches };
    });
    check("移动图标分类支持触控、横向滚动和选中项可见", mobileTab.icons === 1 && mobileTab.height >= 44 && mobileTab.visible && mobileTab.coarse && mobileTab.scrollWidth >= mobileTab.navWidth, JSON.stringify(mobileTab));
    await mp.getByTestId("settings-tab-search").tap();
    check("移动端可切换到向量健康", await mp.getByTestId("settings-vector-health").isVisible());
    await mobile.close();
    check("全程无 JS 运行时错误", errors.length === 0, errors.join(" | "));
  } finally {
    await context.close();
    await browser.close();
    await cleanup();
    const active = await j("/documents?limit=1000");
    const trash = await j("/trash");
    const remaining = [...(active.j.documents || []), ...(trash.j.documents || [])].filter((d) => d.title?.startsWith(PREFIX));
    check("临时文档活跃列表与回收站零残留", remaining.length === 0, JSON.stringify(remaining.map((d) => d.id)));
  }
  console.log(fail === 0 ? "\n✅ 全部通过" : `\n❌ ${fail} 项失败`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(async (e) => {
  console.error(e);
  await cleanup();
  process.exit(1);
});
