#!/usr/bin/env node
/**
 * 并发编辑冲突护栏：两个人同时改同一篇文档时，必须「绝不静默覆盖」。
 *
 * ## 为什么需要
 *
 * 乐观锁（`revision` + `expected_revision` → 409）是**数据安全**的最后一道闸。
 * 它一旦退化（比如某次改动顺手把 `where` 里的 revision 条件去掉），
 * 表现是「悄悄丢内容」—— 用户不会收到任何报错，只会发现自己的编辑消失了。
 * 这类缺陷**没有报错、没有日志**，只能靠断言守。
 *
 * ## 判据分两层（API + UI），两层都要有
 *
 * - **API 层**：旧 revision 必须 409、附服务端最新状态、且**库里仍是对方内容**
 *   （只看 409 不够 —— 409 只是"拒绝了"，还得证明拒绝后数据没被改写）
 * - **UI 层**：对话框要真的出现，三个出口齐全，「保留我的」真的能覆盖
 *   （API 正确 ≠ 用户能看到提示；`ConflictDialog` 若没接上就是白做）
 *
 * ## 顺带钉住两条「该/不该递增 revision」的约定
 *
 * - 改**标题**要递增（标题也是内容，别人基于旧标题做的修改同样会冲突）
 * - 只改**排序**不递增（拖拽一下不该让别人的编辑器弹冲突框）
 *
 * 这两条很容易写反。我第一版就把「改标题不该递增」写进断言，
 * 实测 3→4 报错后才发现是断言错了 —— 注释里的约定是「内容/**标题**变化时置 True」，
 * 「仅移动/排序不递增」。**判据要对着实现文档写，不能凭直觉。**
 */
const fs = require("fs");

const API = process.env.SUNNYDOC_API || "http://127.0.0.1:8000";
const KB = process.env.SUNNYDOC_KB || "fdef57f179384d679b62a3c4bae2d2e3";
const TOKEN =
  process.env.SUNNYDOC_TOKEN ||
  fs.readFileSync(process.env.SUNNYDOC_TOKEN_FILE || "/tmp/sunnydoc-token.txt", "utf8").trim();

let pass = 0;
let fail = 0;
const check = (n, ok, d) => {
  if (ok) {
    pass++;
    console.log("  ✅ " + n);
  } else {
    fail++;
    console.log("  ❌ " + n + "\n       " + String(d).slice(0, 260));
  }
};

async function j(path, method = "GET", body) {
  const r = await fetch(API + "/api/v1" + path, {
    method,
    headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  let parsed;
  try {
    parsed = JSON.parse(t);
  } catch {
    parsed = { raw: t.slice(0, 200) };
  }
  return { status: r.status, json: parsed };
}

(async () => {
  if (!TOKEN) {
    console.log("❌ 缺少 token");
    process.exit(1);
  }
  console.log("=== 并发编辑冲突护栏 ===\n");

  const c = await j("/documents", "POST", {
    title: "CONFLICT-护栏夹具",
    content: "初始内容",
    type: "doc",
    kb_id: KB,
  });
  const did = c.json?.id;
  if (!did) {
    console.log("❌ 建夹具失败:", JSON.stringify(c.json).slice(0, 200));
    process.exit(1);
  }
  // POST /documents 只返回 {id, kb_id, title}，revision 必须单独取
  const g = await j("/documents/" + did);
  const base = g.json.revision;
  console.log(`夹具 ${did.slice(0, 8)} 初始 revision=${base}\n`);

  try {
    // ---------- A. 旧 revision 必须被拒 ----------
    console.log("【A】旧 revision 保存必须 409");
    const a1 = await j("/documents/" + did, "PUT", { content: "甲写的内容", expected_revision: base });
    check("首次保存成功", a1.status === 200, `status=${a1.status}`);
    const a2 = await j("/documents/" + did, "PUT", { content: "乙写的内容", expected_revision: base });
    check("旧 revision 保存返回 409", a2.status === 409, `实际 ${a2.status}`);

    const det = a2.json?.detail || {};
    check(
      `409 附带服务端最新 revision（${det.current_revision}）`,
      det.current_revision === base + 1,
      JSON.stringify(det).slice(0, 180),
    );

    // 🔴 最关键：409 之后库里必须仍是甲的内容（拒绝 ≠ 允许写一半）
    const cur = await j("/documents/" + did);
    check(
      "冲突被拒后库里仍是甲的内容（无静默覆盖）",
      cur.json.text === "甲写的内容",
      `实际=${JSON.stringify(cur.json.text)}`,
    );

    // ---------- B. 两个出口都要能走通 ----------
    console.log("\n【B】「采用对方」与「保留我的」都能走通");
    const fresh = await j("/documents/" + did);
    const b1 = await j("/documents/" + did, "PUT", {
      content: "乙基于最新版本的内容",
      expected_revision: fresh.json.revision,
    });
    check("用最新 revision 重试成功（采用对方路径）", b1.status === 200, `status=${b1.status}`);

    const b2 = await j("/documents/" + did, "PUT", { content: "最终裁决内容" });
    check("不带 revision 强制覆盖成功（保留我的路径）", b2.status === 200, `status=${b2.status}`);
    const after = await j("/documents/" + did);
    check("强制覆盖后内容正确", after.json.text === "最终裁决内容", `实际=${JSON.stringify(after.json.text)}`);

    // ---------- C. revision 递增的两条约定 ----------
    console.log("\n【C】revision 递增约定（标题要递增 / 排序不递增）");
    const r0 = after.json.revision;
    await j("/documents/" + did, "PUT", { title: "CONFLICT-改标题" });
    const c1 = await j("/documents/" + did);
    check(
      `只改标题 revision 递增（${r0}→${c1.json.revision}）`,
      c1.json.revision === r0 + 1,
      "约定是「内容/标题变化时递增」，不是「只有正文变化」",
    );

    const r1 = c1.json.revision;
    await j("/documents/" + did, "PUT", { sort_order: 4096 });
    const c2 = await j("/documents/" + did);
    check(
      `只改排序 revision 不变（${r1}）`,
      c2.json.revision === r1,
      "拖拽一下不该让别人的编辑器弹冲突框",
    );
    check(
      "排序值确实生效",
      Math.abs((c2.json.sort_order || 0) - 4096) < 1,
      `sort_order=${c2.json.sort_order}`,
    );
  } finally {
    // 夹具清理：软删 + purge（`DELETE` 是软删，不清会在回收站堆积）
    await j("/documents/" + did, "DELETE").catch(() => {});
    await j("/trash/document/" + did, "DELETE").catch(() => {});
    console.log("\n  夹具已清理");
  }

  console.log(`\n通过 ${pass} / 失败 ${fail}`);
  console.log(fail === 0 ? "✅ 全部通过" : "❌ 存在失败项");
  process.exit(fail ? 1 : 0);
})();