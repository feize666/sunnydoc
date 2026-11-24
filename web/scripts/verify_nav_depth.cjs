#!/usr/bin/env node
/**
 * 真机验证：3~4 级导航（阶段 3）—— 可到达性 + hash 同步 + 浏览器后退。
 *
 * **为什么必须真机验证**：层级代码写对了 ≠ 用户真能「到达并回退」。
 * 本脚本读真实 `location.hash`、真实点击面板项、真实调用 `history.back()`。
 *
 * ## 阶段 3 要解决的问题（改造前）
 *
 * 应用只有 4 个顶层视图（home/kb/users/trash），而 **28 个对话框**承载绝大多数
 * 功能 —— 弹窗**进去就到底**：无法「设置 → AI 配置 → 某供应商」，
 * 也无法用后退键逐级返回。
 *
 * ## 断言
 *   1. 用户菜单 → 系统设置：**进入 L2 页面**，hash 变为 `#/settings`
 *   2. 直接访问 `#/settings`（分享链接/刷新）：**落在设置页**（可深链）
 *   3. 按浏览器后退：**回到上一级**（hash 与界面同时回退）
 *   4. 设置页头部仅有「返回 + 系统设置」，返回按钮沿用浏览器后退语义
 *   5. 移动端（375px）：四分区可达、无页面横向溢出；横向页签的未选中离屏项不误计为溢出
 *   6. 预设上次知识库：显式设置深链优先；无深链首页仍恢复知识库且同步 hash
 *
 * ## 用法
 *   cd web && SUNNYDOC_TOKEN=xxx node scripts/verify_nav_depth.cjs
 */
const { chromium } = require("playwright");
const fs = require("fs");

const TOKEN =
  process.env.SUNNYDOC_TOKEN ||
  fs.readFileSync(process.env.SUNNYDOC_TOKEN_FILE || "/tmp/sunnydoc-token.txt", "utf8").trim();
const WEB = process.env.SUNNYDOC_WEB || "http://localhost:3001";
const API = process.env.SUNNYDOC_API || "http://127.0.0.1:8000";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fail = 0;
const check = (n, c, d) => {
  if (c) console.log("  ✅ " + n);
  else {
    fail++;
    console.log("  ❌ " + n + "\n       " + (d || ""));
  }
};

/** 静态导出预览没有 dev 的 API 代理；仅在测试浏览器内转发到本地后端。 */
async function setupBackendProxy(target) {
  const base = new URL(WEB);
  if (base.port === "3001") return;
  await target.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/v1/events/notifications") return route.abort();
    return route.continue({ url: API + url.pathname + url.search });
  });
}

async function boot(p) {
  await p.goto(WEB, { waitUntil: "domcontentloaded" });
  await p.evaluate((t) => localStorage.setItem("sunnydoc.token", t), TOKEN);
  await p.reload({ waitUntil: "domcontentloaded" });
  await sleep(2800);
}

/** 打开用户菜单（TitleBar 右侧的头像按钮）。 */
async function openUserMenu(p) {
  // 头像按钮的 title 是用户名；用 .touch-target 定位更稳（我们给它加过该类）
  const btn = p
    .locator("button.touch-target")
    .filter({ hasNotText: "搜索" })
    .first();
  if (await btn.count()) {
    await btn.click();
    await sleep(600);
    return true;
  }
  return false;
}

(async () => {
  const b = await chromium.launch({
    headless: true,
    args: ["--no-proxy-server"],
    // 允许指定浏览器可执行文件（playwright 包升级后缓存里可能只有旧版 chromium）
    ...(process.env.SUNNYDOC_CHROMIUM ? { executablePath: process.env.SUNNYDOC_CHROMIUM } : {}),
  });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await setupBackendProxy(p);
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e)));

  console.log("━━━ 1. 用户菜单 → 系统设置（进 L2 页）━━━");
  await boot(p);
  const hashBefore = await p.evaluate(() => location.hash);
  console.log(`  初始 hash = ${JSON.stringify(hashBefore)}`);
  check("初始在首页（hash 为空或 #/）", hashBefore === "" || hashBefore === "#/", hashBefore);

  const menuOk = await openUserMenu(p);
  check("能打开用户菜单", menuOk, "未找到头像按钮");
  if (menuOk) {
    // 点「系统设置」
    const item = p.locator("button, [role='menuitem']").filter({ hasText: /^系统设置$/ }).first();
    check("菜单里有「系统设置」项", (await item.count()) > 0, "未找到菜单项");
    if (await item.count()) {
      await item.click();
      await sleep(1800);
      const after = await p.evaluate(() => ({
        hash: location.hash,
        // 设置页特征：分类导航与外观页签同时可见（关于已独立为分区）。
        hasAppearance: !!document.querySelector('[data-testid="settings-general"]'),
        hasAbout: !!document.querySelector('[data-testid="settings-tab-about"]'),
      }));
      console.log(`  点击后 hash = ${JSON.stringify(after.hash)}`);
      check("hash 变为 #/settings（可分享/可后退）", after.hash === "#/settings", after.hash);
      check("界面切到设置页（含「外观」「关于」分区）", after.hasAppearance && after.hasAbout, JSON.stringify(after));
    }
  }

  console.log("\n━━━ 2. 直接访问 #/settings（分享链接 / 刷新后停留）━━━");
  {
    await p.goto(WEB + "/#/settings", { waitUntil: "domcontentloaded" });
    await sleep(2800);
    const r = await p.evaluate(() => ({
      hash: location.hash,
      hasAppearance: !!document.querySelector('[data-testid="settings-general"]'),
    }));
    console.log(`  hash=${r.hash} 含「外观」=${r.hasAppearance}`);
    check("深链 #/settings 能直接落到设置页", r.hasAppearance, JSON.stringify(r));
  }

  console.log("\n━━━ 3. 浏览器后退 → 回上一级 ━━━");
  {
    // 从首页 → 设置（产生一条历史），再后退
    await boot(p);
    const menuOk = await openUserMenu(p);
    if (menuOk) {
      const item = p.locator("button, [role='menuitem']").filter({ hasText: /^系统设置$/ }).first();
      if (await item.count()) {
        await item.click();
        await sleep(1500);
      }
    }
    const atSettings = await p.evaluate(() => location.hash === "#/settings");
    check("已进入设置页（前置条件）", atSettings, `hash=${await p.evaluate(() => location.hash)}`);
    if (atSettings) {
      await p.goBack();
      await sleep(1800);
      const back = await p.evaluate(() => ({
        hash: location.hash,
        // 回到首页的特征：出现知识库/新建知识库等
        hasHomeHint: /知识库|新建知识库|最近浏览/.test(document.body.innerText),
        noAppearance: !document.querySelector('[data-testid="settings-tab-about"]'),
      }));
      console.log(`  后退后 hash=${JSON.stringify(back.hash)}`);
      check("后退回到首页", back.hash === "" || back.hash === "#/", back.hash);
      check("界面也回到首页（不再是设置页）", back.hasHomeHint && back.noAppearance, JSON.stringify(back));
    }
  }

  console.log("\n━━━ 4. 精简头部：返回按钮沿用浏览器后退 ━━━");
  {
    await p.goto(WEB, { waitUntil: "domcontentloaded" });
    await p.evaluate(() => history.pushState({}, "", "#/settings"));
    await p.reload({ waitUntil: "domcontentloaded" });
    await p.locator('[data-testid="settings-general"]').waitFor({ state: "visible" });
    const header = await p.locator("header").filter({ has: p.getByRole("heading", { name: "系统设置", exact: true }) }).evaluate((el) => ({
      text: el.innerText.trim(),
      buttons: el.querySelectorAll("button").length,
      back: el.querySelectorAll('[aria-label="返回上一级"]').length,
      crumbs: el.querySelectorAll('[aria-label="位置"]').length,
    }));
    check("设置页只有返回标志与系统设置标题", header.text === "系统设置" && header.buttons === 1 && header.back === 1 && header.crumbs === 0, JSON.stringify(header));
    await p.getByRole("button", { name: "返回上一级", exact: true }).click();
    await p.waitForFunction(() => (location.hash === "" || location.hash === "#/") && !document.querySelector('[data-testid="settings-general"]'));
    check("返回标志真实回退到上一页", true);
  }

  check("全程无 JS 运行时错误", errs.length === 0, errs.join(" | "));
  await p.close();

  console.log("\n━━━ 5. 移动端（375px）设置页可用 ━━━");
  {
    const ctx = await b.newContext({
      viewport: { width: 375, height: 667 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });
    const mp = await ctx.newPage();
    await setupBackendProxy(mp);
    await mp.goto(WEB + "/#/settings", { waitUntil: "domcontentloaded" });
    await mp.evaluate((t) => localStorage.setItem("sunnydoc.token", t), TOKEN);
    await mp.reload({ waitUntil: "domcontentloaded" });
    await sleep(2800);
    const sectionResults = [];
    for (const section of ["general", "ai", "search", "about"]) {
      await mp.getByTestId(`settings-tab-${section}`).tap();
      await mp.waitForTimeout(350);
      const r = await mp.evaluate((current) => {
        const vw = document.documentElement.clientWidth;
        const tab = document.querySelector(`[data-testid="settings-tab-${current}"]`);
        const nav = tab?.closest("nav");
        const tabRect = tab?.getBoundingClientRect();
        const navRect = nav?.getBoundingClientRect();
        return {
          hash: location.hash,
          hasAppearance: !!document.querySelector('[data-testid="settings-general"]'),
          hasCrumb: !!document.querySelector("nav[aria-label='位置']"),
          vw,
          pageWidth: document.documentElement.scrollWidth,
          navScrollable: !!nav && nav.scrollWidth > nav.clientWidth,
          selectedVisible: !!tab && tab.getAttribute("aria-selected") === "true"
            && !!tabRect && !!navRect && tabRect.left >= navRect.left - 1
            && tabRect.right <= navRect.right + 1,
        };
      }, section);
      sectionResults.push({ section, ...r });
      check(`移动端分区 ${section} 可见且选中页签已滚入视野`, r.selectedVisible, JSON.stringify(r));
    }
    const first = sectionResults[0] || {};
    console.log(`  hash=${first.hash} 含「外观」=${first.hasAppearance} 无面包屑=${!first.hasCrumb}`);
    check("移动端能到达设置页", first.hasAppearance, JSON.stringify(first));
    // 横向页签的未选中项本来就可以在滚动容器裁剪区之外。
    // rect.right > vw 不等于页面横向溢出；真实页面边界才是判据。
    check("移动端设置四个分区均无页面横向溢出", sectionResults.every((r) => r.pageWidth === r.vw), JSON.stringify(sectionResults));
    check("移动端头部同样不显示面包屑", !first.hasCrumb, JSON.stringify(first));
    await ctx.close();
  }

  console.log("\n━━━ 6. 预设知识库：显式深链优先，首页仍恢复 ━━━");
  {
    const response = await fetch(API + "/api/v1/kbs", {
      headers: { Authorization: "Bearer " + TOKEN },
    });
    const payload = await response.json();
    const kb = (payload.kbs || []).find((item) => !process.env.SUNNYDOC_KB || item.id === process.env.SUNNYDOC_KB)
      || payload.kbs?.[0];
    check("预设知识库夹具来自当前账号的真实接口", response.ok && !!kb?.id,
      JSON.stringify({ status: response.status, hasKb: !!kb?.id }));

    if (kb?.id) {
      for (const mobile of [false, true]) {
        const ctx = await b.newContext(mobile
          ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
          : { viewport: { width: 1440, height: 900 } });
        const deepLink = await ctx.newPage();
        await setupBackendProxy(deepLink);
        const deepLinkErrors = [];
        deepLink.on("pageerror", (e) => deepLinkErrors.push(String(e)));
        await deepLink.addInitScript(({ token, kbId }) => {
          localStorage.setItem("sunnydoc.token", token);
          sessionStorage.setItem("sunnydoc.currentKbId", kbId);
        }, { token: TOKEN, kbId: kb.id });
        await deepLink.goto(WEB + "/#/settings", { waitUntil: "domcontentloaded" });
        // 首次路由解析与异步知识库恢复可能交错；两种终态都等到后再判，
        // 不把设置页尚未挂载误算成产品错误。
        await deepLink.waitForFunction(() =>
          !!document.querySelector('[data-testid="settings-general"]')
          || !!document.querySelector('[data-testid="sidebar-search"]')
        );
        await sleep(700);
        const actual = await deepLink.evaluate(() => ({
          hash: location.hash,
          settings: !!document.querySelector('[data-testid="settings-general"]'),
          kb: !!document.querySelector('[data-testid="sidebar-search"]'),
        }));
        check(`${mobile ? "移动端" : "桌面端"}预设知识库不覆盖设置深链`,
          actual.hash === "#/settings" && actual.settings && !actual.kb, JSON.stringify(actual));
        check(`${mobile ? "移动端" : "桌面端"}深链无 JS 运行时错误`,
          deepLinkErrors.length === 0, deepLinkErrors.join(" | "));
        await ctx.close();
      }

      const homeCtx = await b.newContext({ viewport: { width: 1440, height: 900 } });
      const home = await homeCtx.newPage();
      await setupBackendProxy(home);
      await home.addInitScript(({ token, kbId }) => {
        localStorage.setItem("sunnydoc.token", token);
        sessionStorage.setItem("sunnydoc.currentKbId", kbId);
      }, { token: TOKEN, kbId: kb.id });
      await home.goto(WEB, { waitUntil: "domcontentloaded" });
      await home.waitForFunction(() => location.hash === "#/kb"
        && !!document.querySelector('[data-testid="sidebar-search"]'));
      const restored = await home.evaluate(() => ({
        hash: location.hash,
        kb: !!document.querySelector('[data-testid="sidebar-search"]'),
        settings: !!document.querySelector('[data-testid="settings-general"]'),
      }));
      check("无深链首页仍恢复上次知识库并同步 hash",
        restored.hash === "#/kb" && restored.kb && !restored.settings, JSON.stringify(restored));
      if (await openUserMenu(home)) {
        const item = home.locator("button, [role='menuitem']").filter({ hasText: /^系统设置$/ }).first();
        await item.click();
        await home.waitForFunction(() => location.hash === "#/settings"
          && !!document.querySelector('[data-testid="settings-general"]'));
        await home.goBack();
        // useViewStack.go() 的既有约定：同深度的顶层切换使用 replaceState。
        // 恢复时写入 #/kb 后，进入设置会替换它，因此后退回的是更早的首页，
        // 不能擅自把这个测试写成「后退回知识库」而改变历史栈契约。
        await home.waitForFunction(() => (location.hash === "" || location.hash === "#/")
          && !!document.querySelector("header")?.innerText.includes("新建知识库"));
        const backedHome = await home.evaluate(() => ({
          href: location.href,
          home: !!document.querySelector("header")?.innerText.includes("新建知识库"),
          settings: !!document.querySelector('[data-testid="settings-general"]'),
          kb: !!document.querySelector('[data-testid="sidebar-search"]'),
        }));
        check("恢复进库后的同层切换仍按 replaceState 后退到首页",
          backedHome.home && !backedHome.settings && !backedHome.kb, JSON.stringify(backedHome));
      } else {
        check("恢复知识库后可打开用户菜单", false, "未找到头像按钮");
      }
      await homeCtx.close();
    }
  }

  console.log(fail === 0 ? "\n✅ 全部通过" : `\n❌ ${fail} 项失败`);
  await b.close();
  process.exit(fail === 0 ? 0 : 1);
})();