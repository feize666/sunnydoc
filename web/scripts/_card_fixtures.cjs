#!/usr/bin/env node
/**
 * 真机脚本共享夹具：卡片嵌入系列所需文档的**播种 / 清理**。
 *
 * 为什么单独抽出来：`verify_embed_* / verify_card_*` 原先假设库中**预存**了
 * 「嵌入测试-容器文档」「嵌入测试-表格源」等夹具，自己不自建 ——
 * 结果夹具一旦被清理（或换台机器），这些脚本整批失效，且失败信息
 * （"容器文档可被搜到" 失败）与真因（夹具不存在）完全无关，极易误判成产品回归。
 *
 * 本模块让它们**自建自清**（项目纪律）：跑前播种、跑后清理，
 * 且幂等（已存在则复用，不重复创建）。
 *
 * 用法（在脚本里）：
 *   const { seedCardFixtures, cleanupCardFixtures } = require("./_card_fixtures.cjs");
 *   const fx = await seedCardFixtures(p, { container: "嵌入测试-容器文档", source: "嵌入测试-表格源" });
 *   // ... 断言 ...
 *   await cleanupCardFixtures(p, [fx.containerId, fx.sourceId]);
 */

const API = process.env.SUNNYDOC_API || "http://localhost:8000";
const KB = process.env.SUNNYDOC_KB || "fdef57f179384d679b62a3c4bae2d2e3";

/** 表格源文档的初始内容（3×3，与表格编辑器默认一致，卡片内应能查到单元格）。 */
const TABLE_BODY = JSON.stringify([
  ["名称", "数量", "单价"],
  ["苹果", "3", "5"],
  ["香蕉", "2", "4"],
]);

/** 在页面上下文里调 API（复用页面已登录的 token，避免脚本各自传 token）。 */
async function api(page, path, method = "GET", body) {
  return page.evaluate(
    async ([apiBase, p, m, b]) => {
      const tok = localStorage.getItem("sunnydoc.token") || "";
      const r = await fetch(apiBase + p, {
        method: m,
        headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" },
        body: b ? JSON.stringify(b) : undefined,
      });
      const t = await r.text();
      try {
        return { status: r.status, json: JSON.parse(t) };
      } catch {
        return { status: r.status, json: t };
      }
    },
    [API, path, method, body],
  );
}

/**
 * 播种卡片夹具。
 * @param page Playwright page（须已设置 localStorage token 并加载过页面）
 * @param opts.container 容器文档标题
 * @param opts.source    表格源文档标题
 * @param opts.withCard  为 true 时，容器文档正文里**预置一个卡片**（指向 source）。
 *                       用于验证「卡片渲染/观感/渐进渲染」的脚本 —— 它们必须先有卡片可看。
 * @returns {containerId, sourceId, created:[...]} 创建的 id 列表（供清理时避免误删既有文档）
 */
async function seedCardFixtures(page, opts = {}) {
  const containerTitle = opts.container || "嵌入测试-容器文档";
  const sourceTitle = opts.source || "嵌入测试-表格源";

  const list = await api(page, "/api/v1/documents?limit=500");
  const all = list.json?.documents || [];
  const find = (t) => all.find((d) => d.title === t);

  const created = [];
  let container = find(containerTitle);
  let source = find(sourceTitle);

  // 先确保 source 存在（容器里的卡片要指向它）
  if (!source) {
    const r = await api(page, "/api/v1/documents", "POST", {
      title: sourceTitle,
      content: TABLE_BODY,
      type: "table",
      kb_id: KB,
    });
    source = r.json;
    created.push(source.id);
  }

  if (!container) {
    // 卡片标记就是编辑器保存后的形态：<div data-doc-id="..." class="doc-embed"> </div>
    // （与 verify_embed_card 里观察到的"保存后的正文"一致，非自造格式）
    const body = opts.withCard
      ? `<p>卡片观感验证容器。</p>\n\n<div data-doc-id="${source.id}" class="doc-embed"> </div>\n`
      : "";
    const r = await api(page, "/api/v1/documents", "POST", {
      title: containerTitle,
      content: body,
      type: "doc",
      kb_id: KB,
    });
    container = r.json;
    created.push(container.id);
  }

  return {
    containerId: container.id,
    sourceId: source.id,
    containerTitle,
    sourceTitle,
    created,
  };
}

/** 清理**本次新建**的夹具（不动原本就存在的文档）。
 *
 * ⚠️ 仅 `DELETE` 是**软删除** —— 文档会进入回收站并长期留着。
 * 想真正清干净请用 `purgeDocuments`（见下）。
 */
async function cleanupCardFixtures(page, ids = []) {
  for (const id of ids.filter(Boolean)) {
    await api(page, "/api/v1/documents/" + id, "DELETE");
  }
}

/**
 * **彻底删除**文档：先软删，再从回收站 purge。
 *
 * 🔴 为什么必须用它（2026-10-20 发现的系统性缺陷）：
 *   所有验证脚本的清理此前只调 `DELETE /documents/{id}` —— 那是**软删除**，
 *   文档会进回收站并保留 30 天。而「零残留」断言只查 `/documents` 活跃列表，
 *   于是**从来没检查过回收站** → 一次跑 30+ 个脚本、每个建若干夹具，
 *   日积月累在回收站堆了 **284 个历次夹具**（实测），却一直显示「零残留 ✅」。
 *   这是**判据口径与清理动作同时漏了回收站**：清理没清干净，断言也看不见。
 *
 * 用法（脚本收尾）：
 *   await cleanupDocuments(page, ids);            // 软删 + purge，返回 {purged}
 *   const left = await countFixtures(page, pref); // 同时核对活跃 + 回收站
 */
async function cleanupDocuments(page, ids = []) {
  let purged = 0;
  for (const id of ids.filter(Boolean)) {
    // 1) 先软删（已是删除态时会 404，忽略）
    await api(page, "/api/v1/documents/" + id, "DELETE").catch(() => {});
    // 2) 再从回收站彻底删除。purge 对「已不在回收站」返回 404 —— 属正常，忽略。
    const r = await api(page, "/api/v1/trash/document/" + id, "DELETE").catch(() => null);
    if (r && (r.status === 200 || r.status === 404)) purged++;
  }
  return { purged };
}

/** 按标题前缀找出**活跃**文档。 */
async function listFixtureDocs(page, titlePrefix) {
  const list = await api(page, "/api/v1/documents?limit=1000");
  return (list.json?.documents || []).filter((d) => String(d.title || "").startsWith(titlePrefix));
}

/** 按标题前缀找出**回收站**里的文档（软删残留就藏在这里）。 */
async function listFixtureTrash(page, titlePrefix) {
  const t = await api(page, "/api/v1/trash");
  return (t.json?.documents || []).filter((d) => String(d.title || "").startsWith(titlePrefix));
}

/**
 * 夹具是否真的清干净 —— **同时核对活跃列表与回收站**。
 *
 * 直接拿它当「零残留」断言的数据源：只查活跃列表的旧写法会漏掉软删残留
 * （见 cleanupDocuments 的说明）。
 */
async function fixtureResidue(page, titlePrefix) {
  const [live, trash] = await Promise.all([
    listFixtureDocs(page, titlePrefix),
    listFixtureTrash(page, titlePrefix),
  ]);
  return {
    live: live.map((d) => d.title),
    trash: trash.map((d) => d.title),
    clean: live.length === 0 && trash.length === 0,
  };
}

/**
 * 播种「大文档 + 远置卡片」夹具 —— 供 `verify_card_progressive.cjs` 使用。
 *
 * 该脚本验证的是**渐进渲染**：大文档首屏只渲染一批块，剩下的在空闲时追加。
 * 因此夹具必须满足：
 *   - 顶层块足够多（脚本断言 >= 900），否则一次性就渲染完，测不到分批；
 *   - 卡片放在**文档末尾**（"远置"）—— 保证它不在首批里，才能验证"不在首批也要挂载"。
 *
 * @param page Playwright page
 * @param opts.title       容器文档标题
 * @param opts.cardCount   末尾嵌入的卡片数量
 * @param opts.paragraphs 段落数量（默认 950，确保顶层块 >= 900）
 */
async function seedBigDocFixture(page, opts = {}) {
  const title = opts.title || "卡片远置测试-容器";
  const cardCount = opts.cardCount ?? 2;
  const paragraphs = opts.paragraphs ?? 950;

  const list = await api(page, "/api/v1/documents?limit=1000");
  const all = list.json?.documents || [];
  const existed = all.find((d) => d.title === title);
  if (existed) {
    return { containerId: existed.id, created: [], reused: true };
  }

  // 源文档（卡片指向它）
  const sourceTitle = "大文档卡片来源";
  let source = all.find((d) => d.title === sourceTitle);
  const created = [];
  if (!source) {
    const r = await api(page, "/api/v1/documents", "POST", {
      title: sourceTitle,
      content: TABLE_BODY,
      type: "table",
      kb_id: KB,
    });
    source = r.json;
    created.push(source.id);
  }

  // 大正文：段落 + 末尾 N 张卡片
  const paras = [];
  for (let i = 1; i <= paragraphs; i++) {
    paras.push(`第 ${i} 段：用于撑起渐进渲染的顶层块数量，验证首屏只渲染一批。`);
  }
  const cards = Array.from(
    { length: cardCount },
    () => `<div data-doc-id="${source.id}" class="doc-embed"> </div>`,
  ).join("\n\n");
  const content = paras.join("\n\n") + "\n\n" + cards + "\n";

  const r = await api(page, "/api/v1/documents", "POST", {
    title,
    content,
    type: "doc",
    kb_id: KB,
  });
  created.push(r.json.id);

  return { containerId: r.json.id, sourceId: source.id, created, reused: false };
}

module.exports = {
  seedCardFixtures,
  cleanupCardFixtures,
  cleanupDocuments,
  listFixtureDocs,
  listFixtureTrash,
  fixtureResidue,
  seedBigDocFixture,
  api,
  KB,
  TABLE_BODY,
};