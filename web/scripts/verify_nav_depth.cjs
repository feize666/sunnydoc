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
 *   4. 面包屑「首页」可点 → 回到首页
 *   5. 移动端（375px）：设置页可用、无横向溢出
 *
 * ## 用法
 *   cd web && SUNNYDOC_TOKEN=xxx node scripts/verify_nav_depth.cjs
 */
const { chromium } = require("playwright");
const fs = require("fs");

const TOKEN =
  process.env.SUNNYDOC_TOKEN ||
  fs.readFileSync(process.env.SUNNYDOC_TOKEN_FILE || "/tmp/sdtoken.txt", "utf8").trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fail = 0;
const check = (n, c, d) => {
  if (c) console.log("  ✅ " + n);
  else {
    fail++;
    console.log("  ❌ " + n + "\n       " + (d || ""));
  }
};

async function boot(p) {
  await p.goto("http://localhost:3001", { waitUntil: "domcontentloaded" });
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
  const b = await chromium.launch({ headless: true, args: ["--no-proxy-server"] });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
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
        // 设置页特征：出现「外观」分区标题
        hasAppearance: document.body.innerText.includes("外观"),
        hasAbout: document.body.innerText.includes("关于"),
      }));
      console.log(`  点击后 hash = ${JSON.stringify(after.hash)}`);
      check("hash 变为 #/settings（可分享/可后退）", after.hash === "#/settings", after.hash);
      check("界面切到设置页（含「外观」「关于」分区）", after.hasAppearance && after.hasAbout, JSON.stringify(after));
    }
  }

  console.log("\n━━━ 2. 直接访问 #/settings（分享链接 / 刷新后停留）━━━");
  {
    await p.goto("http://localhost:3001/#/settings", { waitUntil: "domcontentloaded" });
    await sleep(2800);
    const r = await p.evaluate(() => ({
      hash: location.hash,
      hasAppearance: document.body.innerText.includes("外观"),
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
        noAppearance: !document.body.innerText.includes("关于"),
      }));
      console.log(`  后退后 hash=${JSON.stringify(back.hash)}`);
      check("后退回到首页", back.hash === "" || back.hash === "#/", back.hash);
      check("界面也回到首页（不再是设置页）", back.hasHomeHint && back.noAppearance, JSON.stringify(back));
    }
  }

  console.log("\n━━━ 4. 面包屑「首页」可点回退 ━━━");
  {
    await p.goto("http://localhost:3001/#/settings", { waitUntil: "domcontentloaded" });
    await sleep(2800);
    const crumb = p.locator("nav[aria-label='位置'] button").filter({ hasText: "首页" }).first();
    check("设置页有「首页」面包屑且可点", (await crumb.count()) > 0, "未找到可点面包屑");
    if (await crumb.count()) {
      await crumb.click();
      await sleep(1600);
      const r = await p.evaluate(() => ({ hash: location.hash }));
      check("点面包屑回到首页", r.hash === "" || r.hash === "#/", r.hash);
    }
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
    await mp.goto("http://localhost:3001/#/settings", { waitUntil: "domcontentloaded" });
    await mp.evaluate((t) => localStorage.setItem("sunnydoc.token", t), TOKEN);
    await mp.reload({ waitUntil: "domcontentloaded" });
    await sleep(2800);
    const r = await mp.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      let over = 0;
      for (const el of document.querySelectorAll("body *")) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0) continue;
        const cs = getComputedStyle(el);
        if (cs.position === "fixed" || cs.display === "none" || cs.visibility === "hidden") continue;
        if (rect.right > vw + 1) over++;
      }
      return {
        hash: location.hash,
        hasAppearance: document.body.innerText.includes("外观"),
        over,
        hasCrumb: !!document.querySelector("nav[aria-label='位置']"),
      };
    });
    console.log(`  hash=${r.hash} 含「外观」=${r.hasAppearance} 横向溢出=${r.over} 有面包屑=${r.hasCrumb}`);
    check("移动端能到达设置页", r.hasAppearance, JSON.stringify(r));
    check("移动端设置页无横向溢出", r.over === 0, `${r.over} 个元素`);
    check("移动端保留面包屑（层级唯一可视线索）", r.hasCrumb, JSON.stringify(r));
    await ctx.close();
  }

  console.log(fail === 0 ? "\n✅ 全部通过" : `\n❌ ${fail} 项失败`);
  await b.close();
  process.exit(fail === 0 ? 0 : 1);
})();