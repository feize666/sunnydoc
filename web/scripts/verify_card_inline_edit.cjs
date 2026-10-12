#!/usr/bin/env node
/**
 * 卡片就地编辑的真机验证（**自建夹具、自清**，不依赖预先存在的文档）。
 *
 * 为什么自建：早先版本让调用方用 `SUNNYDOC_IDS=` 传入 4 个文档 id，
 * 结果测试数据一被清理脚本就失效（实测踩过多次，且 `ids.txt` 无换行导致
 * `head -1` 取到整行、被当成一个 id）。项目里 `.workbuddy/verify_sorting.js`
 * 的既有做法就是自建自清，这里对齐。
 *
 * 核心判据（避免恒真断言）：
 *  - 「保存后来源文档内容变了」必须**用 API 直查来源文档**验证，
 *    不能只看卡片自己显示的内容（那可能只是本地 state 变了）。
 *  - 「冲突不覆盖」必须真的制造冲突：先用 API 改来源，再在卡片保存，
 *    然后比对来源文档**仍是 API 改后的值**（证明卡片没覆盖掉）。
 */
const { chromium } = require("playwright");
const fs = require("fs");
// token 走环境变量，避免把凭据写进仓库
const TOKEN = process.env.SUNNYDOC_TOKEN || fs.readFileSync(process.env.SUNNYDOC_TOKEN_FILE || "/tmp/sunnydoc-token.txt", "utf8").trim();
const API = "http://127.0.0.1:8000/api/v1";
const KB = process.env.SUNNYDOC_KB || "fdef57f179384d679b62a3c4bae2d2e3";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fail = 0;
const check = (n, c, d) => {
  if (c) console.log("  ✅ " + n);
  else { fail++; console.log("  ❌ " + n + "\n       " + String(d).slice(0, 260)); }
};

const H = { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" };

async function apiGetDoc(id) {
  const r = await fetch(`${API}/documents/${id}`, { headers: H });
  return r.json();
}
async function apiPutDoc(id, title, content) {
  const r = await fetch(`${API}/documents/${id}`, {
    method: "PUT",
    headers: H,
    body: JSON.stringify({ title, content }),
  });
  return r.status;
}
async function apiCreate(title, content, type) {
  const r = await fetch(`${API}/documents`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ title, content, type, kb_id: KB }),
  });
  if (!r.ok) throw new Error(`创建失败 ${r.status}: ${await r.text()}`);
  return (await r.json()).id;
}
async function apiDelete(ids) {
  if (!ids.length) return;
  // ⚠️ 不能只 `.catch(() => {})` 静默吞掉 —— 清理失败必须可感知，
  // 否则库里会无声堆积夹具（实测踩过：留下一组 `夹具-*(2)`）。
  try {
    const r = await fetch(`${API}/documents/batch-delete`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ doc_ids: ids }),
    });
    if (!r.ok) {
      console.warn(`  ⚠️ 夹具清理返回 ${r.status}，可能有残留：${ids.join(", ")}`);
      return;
    }
    const d = await r.json().catch(() => ({}));
    if (Array.isArray(d.skipped) && d.skipped.length) {
      console.warn(`  ⚠️ 夹具清理被跳过 ${d.skipped.length} 项：${JSON.stringify(d.skipped)}`);
    }
  } catch (e) {
    console.warn(`  ⚠️ 夹具清理异常（可能残留）：${e.message}`);
  }
}

/** 本次运行创建的文档，结束时清理。 */
const created = [];

/** 按标题前缀查库中残留（用于清理后复核）。 */
async function apiFindByPrefix(prefix) {
  try {
    const r = await fetch(`${API}/documents`, { headers: H });
    const all = (await r.json()).documents || [];
    return all.filter((d) => (d.title || "").startsWith(prefix)).map((d) => d.title);
  } catch {
    return ["(查询失败，无法复核)"];
  }
}

/** 自建夹具：三种源图表 + 一个容器。返回 [fid, mid, tid, cid]。 */
async function buildFixture() {
  const fid = await apiCreate("夹具-流程图", JSON.stringify({
    nodes: [{ id: "a", text: "开始", x: 80, y: 120 }, { id: "b", text: "处理", x: 300, y: 120 }],
    edges: [{ id: "e1", from: "a", to: "b" }],
  }), "flowchart");
  const mid = await apiCreate("夹具-思维导图", JSON.stringify({
    nodes: [{ id: "1", text: "中心", parent: null }, { id: "2", text: "分支", parent: "1" }],
  }), "mindmap");
  const tid = await apiCreate("夹具-表格",
    JSON.stringify([["服务名", "端口"], ["gateway", "8080"], ["auth", "8443"]]), "table");
  created.push(fid, mid, tid);

  // ⚠️ 必须用 JS 模板字符串拼接，**不能用 `'%s' % id`** —— 那是 Python 语法，
  //    在 JS 里 `%` 是取模运算，`字符串 % id` 会得到 `NaN`。
  //    实测踩过：容器正文变成了 "NaN"，卡片一张都渲染不出来（排查了半天）。
  const content = "夹具容器正文。\n\n" +
    [`<div data-doc-id="${fid}"></div>`,
     `<div data-doc-id="${mid}"></div>`,
     `<div data-doc-id="${tid}"></div>`].join("\n\n") + "\n\n结束。";
  const cid = await apiCreate("夹具-容器", content, "doc");
  created.push(cid);
  return [fid, mid, tid, cid];
}

(async () => {
  // 自建夹具（无论断言成败都要清理）
  const [FID, MID, TID, CID] = await buildFixture();
  console.log("夹具已建: 流程=" + FID.slice(0, 8) + " 导图=" + MID.slice(0, 8) +
    " 表格=" + TID.slice(0, 8) + " 容器=" + CID.slice(0, 8));

  // 夹具建在根级，可直接在文件树点到（不需要搜索，避免走「搜索态一次性渲染」）
  const CONTAINER_TITLE = "夹具-容器";

  const b = await chromium.launch({ headless: true, args: ["--no-proxy-server"] });
  const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e).slice(0, 150)));

  try {
  await p.goto((process.env.SUNNYDOC_WEB || "http://localhost:3001"), { waitUntil: "domcontentloaded" });
  await p.evaluate((t) => localStorage.setItem("sunnydoc.token", t), TOKEN);
  await p.reload({ waitUntil: "domcontentloaded" });
  await sleep(2500);
  const kb = p.locator("button, a").filter({ hasText: "云计算知识库" }).first();
  if (await kb.count()) { await kb.click(); await sleep(2500); }

  // 直接点文件树里的夹具容器（非搜索态 → 走渐进渲染，与真实使用一致）
  // 用搜索打开：夹具是新建文档，可能在文件树深处（实测 y≈3700，视口外），
  // 直接点文件树不稳定。搜索态虽走「一次性渲染」，但本脚本验证的是**编辑功能**，
  // 与渐进渲染无关，用搜索打开更稳。（渐进渲染另有 verify_card_progressive.cjs）
  const box = p.locator('input[type="search"], input[placeholder*="搜索"]').first();
  await box.fill(CONTAINER_TITLE);
  await sleep(2000);
  const node = p.getByText(CONTAINER_TITLE, { exact: true }).first();
  check("搜索结果里找到夹具容器", (await node.count()) > 0, "未找到 " + CONTAINER_TITLE);
  if (await node.count()) await node.click({ force: true }).catch(() => {});
  await sleep(4000);
  // 轮询等卡片挂载（固定 sleep 对懒加载 chunk 下载不敏感）
  let w = 0;
  while (w < 30000) {
    const n = await p.evaluate(
      () => document.querySelectorAll(".doc-embed .doc-embed-card").length,
    );
    if (n >= 3) break;
    await sleep(500);
    w += 500;
  }
  console.log("  等卡片挂载耗时: " + w + "ms");
  // 断言确实进了文档视图，否则后面全部无意义
  const inDoc = await p.evaluate(() => !!document.querySelector(".md-body, .ProseMirror"));
  check("已进入文档视图", inDoc, "仍在搜索结果页");
  // 进编辑态（NodeView 才有编辑按钮）
  const eb = p.locator("button").filter({ hasText: /^编辑$/ }).first();
  if (await eb.count()) { await eb.click({ force: true }).catch(() => {}); }
  await sleep(4000);

  // ── 1) 默认只读 ──
  console.log("=== 1. 默认只读 ===");
  const ro = await p.evaluate(() => {
    const cards = Array.from(document.querySelectorAll(".doc-embed"));
    return cards.map((w) => {
      const card = w.querySelector(".doc-embed-card");
      const inputs = Array.from(w.querySelectorAll("table input"));
      return {
        type: card ? card.getAttribute("data-embed-type") : null,
        editing: card ? card.getAttribute("data-embed-editing") : null,
        hasEditBtn: !!w.querySelector('[aria-label="编辑卡片"]'),
        hasSaveBtn: !!w.querySelector('[aria-label="保存卡片"]'),
        readOnlyInputs: inputs.length ? inputs.every((i) => i.readOnly) : null,
      };
    });
  });
  console.log("  " + JSON.stringify(ro));
  check("三张卡片都在", ro.length === 3, ro.length);
  check("默认均非编辑态", ro.length > 0 && ro.every((c) => c.editing === "false"), JSON.stringify(ro.map((c) => c.editing)));
  check("默认显示「编辑」按钮", ro.length > 0 && ro.every((c) => c.hasEditBtn), JSON.stringify(ro.map((c) => c.hasEditBtn)));
  check("默认不显示「保存」按钮", ro.length > 0 && ro.every((c) => !c.hasSaveBtn), JSON.stringify(ro.map((c) => c.hasSaveBtn)));
  check("表格单元格只读", ro.find((c) => c.type === "table")?.readOnlyInputs === true,
    JSON.stringify(ro.find((c) => c.type === "table")));

  // ── 2) 编辑表格卡片并保存 → 验证来源文档真的变了 ──
  console.log("\n=== 2. 就地编辑表格卡片并保存 ===");
  const beforeText = (await apiGetDoc(TID)).text;
  console.log("  保存前来源文档 text 长度: " + beforeText.length);

  // 让表格卡片进入编辑态
  const tableCard = p.locator(".doc-embed").filter({ has: p.locator('div[data-embed-type="table"]') }).first();
  const tEditBtn = tableCard.locator('[aria-label="编辑卡片"]').first();
  check("表格卡片有编辑按钮", (await tEditBtn.count()) > 0, "未找到");
  if (await tEditBtn.count()) { await tEditBtn.click({ force: true }).catch(() => {}); }
  await sleep(2500);

  const editState = await p.evaluate(() => {
    const w = Array.from(document.querySelectorAll(".doc-embed")).find(
      (e) => e.querySelector('div[data-embed-type="table"]'),
    );
    if (!w) return null;
    const inputs = Array.from(w.querySelectorAll("table input"));
    return {
      editing: w.querySelector(".doc-embed-card")?.getAttribute("data-embed-editing"),
      hasSave: !!w.querySelector('[aria-label="保存卡片"]'),
      anyEditable: inputs.some((i) => !i.readOnly),
    };
  });
  check("进入编辑态", editState?.editing === "true", JSON.stringify(editState));
  check("出现保存按钮", editState?.hasSave === true, JSON.stringify(editState));
  check("单元格变为可编辑", editState?.anyEditable === true, JSON.stringify(editState));

  // 找一个空单元格输入内容（第一行第一列改为标记）
  const marker = "EDIT_MARK_9137";
  const typed = await p.evaluate((mk) => {
    const w = Array.from(document.querySelectorAll(".doc-embed")).find(
      (e) => e.querySelector('div[data-embed-type="table"]'),
    );
    const inputs = Array.from(w.querySelectorAll("table input"));
    if (!inputs.length) return false;
    const el = inputs[0];
    // React 受控组件：必须走原生 setter + input 事件，直接改 value 不会触发 onChange
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(el, mk);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }, marker);
  check("已向首格输入标记", typed, "未找到单元格");
  await sleep(1200);

  const saveBtn = tableCard.locator('[aria-label="保存卡片"]').first();
  if (await saveBtn.count()) { await saveBtn.click({ force: true }).catch(() => {}); }
  await sleep(3500);

  const afterText = (await apiGetDoc(TID)).text;
  console.log("  保存后来源文档 text 长度: " + afterText.length);
  console.log("  含标记: " + afterText.includes(marker));
  check("保存写回了来源文档（API 直查含新内容）", afterText.includes(marker), afterText.slice(0, 160));
  check("卡片回到只读态",
    (await p.evaluate(() => {
      const w = Array.from(document.querySelectorAll(".doc-embed")).find(
        (e) => e.querySelector('div[data-embed-type="table"]'),
      );
      return w?.querySelector(".doc-embed-card")?.getAttribute("data-embed-editing");
    })) === "false", "仍在编辑态");

  // ── 3) 冲突：先用 API 改来源，再在卡片保存 → 不得覆盖 ──
  console.log("\n=== 3. 冲突不覆盖 ===");
  // 重新进编辑态并改一下（让草稿与 doc.text 不同）
  const tEditBtn2 = p.locator(".doc-embed").filter({ has: p.locator('div[data-embed-type="table"]') })
    .locator('[aria-label="编辑卡片"]').first();
  if (await tEditBtn2.count()) { await tEditBtn2.click({ force: true }).catch(() => {}); }
  await sleep(2000);
  await p.evaluate(() => {
    const w = Array.from(document.querySelectorAll(".doc-embed")).find(
      (e) => e.querySelector('div[data-embed-type="table"]'),
    );
    const el = w.querySelectorAll("table input")[1];
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(el, "MINE_LOSES");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await sleep(1000);
  // 后台改来源（模拟他人编辑）→ 版本号前进
  const othersText = JSON.stringify([["OTHERS_WIN", "b"], ["c", "d"]]);
  const putStatus = await apiPutDoc(TID, "卡片观感-表格", othersText);
  console.log("  他人改动 PUT 状态: " + putStatus);
  await sleep(500);

  const saveBtn2 = p.locator(".doc-embed").filter({ has: p.locator('div[data-embed-type="table"]') })
    .locator('[aria-label="保存卡片"]').first();
  if (await saveBtn2.count()) { await saveBtn2.click({ force: true }).catch(() => {}); }
  await sleep(3500);

  const conflictText = (await apiGetDoc(TID)).text;
  console.log("  冲突后来源文档: " + conflictText.slice(0, 80));
  check("冲突时未覆盖他人内容（来源仍是 OTHERS_WIN）",
    conflictText.includes("OTHERS_WIN") && !conflictText.includes("MINE_LOSES"),
    conflictText.slice(0, 160));

  // ── 4) 预览态无编辑入口 ──
  console.log("\n=== 4. 预览态无编辑入口 ===");
  // ⚠️ 按钮文案是「取消」（放弃编辑）而不是「预览」——曾因猜错文案导致
  //    根本没切回去、却误判为「预览态仍有编辑按钮」（假失败）。
  const pv = p.locator("button").filter({ hasText: /^取消$/ }).first();
  check("找到「取消」（切回预览态）按钮", (await pv.count()) > 0, "未找到");
  if (await pv.count()) { await pv.click({ force: true }).catch(() => {}); }
  await sleep(4000);
  // 断言真的离开了编辑态（否则后面「预览态无按钮」的断言毫无意义）
  const leftEdit = await p.evaluate(() => !document.querySelector(".ProseMirror"));
  check("确实已离开编辑态（ProseMirror 消失）", leftEdit, "仍在编辑态");
  const inPreview = await p.evaluate(() => {
    const cards = Array.from(document.querySelectorAll(".md-body .doc-embed"));
    return {
      count: cards.length,
      anyEdit: cards.some((w) => w.querySelector('[aria-label="编辑卡片"]')),
      anyRemove: cards.some((w) => w.querySelector('[aria-label="移除卡片"]')),
      visible: cards.every((w) => w.querySelector(".doc-embed-card")?.getBoundingClientRect().height > 100),
    };
  });
  console.log("  " + JSON.stringify(inPreview));
  check("预览态卡片可见", inPreview.count === 3 && inPreview.visible, JSON.stringify(inPreview));
  check("预览态无编辑按钮", inPreview.count > 0 && !inPreview.anyEdit, JSON.stringify(inPreview));
  check("预览态无移除按钮", inPreview.count > 0 && !inPreview.anyRemove, JSON.stringify(inPreview));

  check("无运行时错误", errs.length === 0, errs.slice(0, 2).join(" | "));
  await p.screenshot({ path: "/tmp/sd_edit2/edit.png", fullPage: false });
  } finally {
    // 无论成败都要清理夹具，避免在库里留垃圾数据
    await b.close().catch(() => {});
    await apiDelete(created);
    // 主动复核一次：删除接口是「逐项容错」的（不存在/无权限的进 skipped 而非报错），
    // 所以不能只看删除请求成功，必须回来查一遍是否真的没了。
    const leftover = await apiFindByPrefix("夹具-");
    if (leftover.length) {
      fail++;
      console.log("  ❌ 夹具清理后仍有残留: " + JSON.stringify(leftover));
    } else {
      console.log("  ✅ 夹具已清理干净（复核 0 残留）");
    }
  }
  console.log("\n" + (fail ? "❌ FAIL = " + fail : "✅ ALL PASS"));
  process.exit(fail ? 1 : 0);
})();