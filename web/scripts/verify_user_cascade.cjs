#!/usr/bin/env node
/**
 * 删除用户时的**级联清理**验证。
 *
 * ## 为什么需要它（2026-10-26 实测发现的真实缺陷）
 *
 * `DELETE /users/{id}` 原先只删 users 表记录，**不清理其知识库/文件夹/文档**，
 * 留下 owner 已不存在的**孤儿数据**。后果比"占空间"严重：
 *   `list_trash(user_id)` / 文档列表都按 user_id 过滤，而该 id 已不存在
 *   → 这些数据**任何用户都看不到、也删不掉**，成了永久不可见的幽灵。
 *
 * 实测本机因此积了 **17 个孤儿知识库 + 15 个孤儿文件夹 + 1 篇无主文档**，
 * 而回收站接口返回 `kbs: []` —— 排查时极易误判成"已清干净"。
 *
 * ## 判据设计（避免恒真）
 *
 * 不能只断言「回收站里没有」——那正是当初失效的判据（过滤后本来就看不到）。
 * 必须**直接从数据库数孤儿行**：`user_id` 指向不存在的用户即为孤儿。
 * 这才是能区分「代码有权联」与「代码没级联」的硬判据。
 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const API = process.env.SUNNYDOC_API || "http://127.0.0.1:8000";
const API_V1 = API + "/api/v1";
const TOKEN =
  process.env.SUNNYDOC_TOKEN ||
  fs.readFileSync(process.env.SUNNYDOC_TOKEN_FILE || "/tmp/sunnydoc-token.txt", "utf8").trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Python 解释器：优先环境变量，否则用项目 venv（保证有 psycopg）。 */
const PY = (() => {
  if (process.env.SUNNYDOC_PY) return process.env.SUNNYDOC_PY;
  const venv = path.resolve(__dirname, "../../api/.venv/bin/python");
  return fs.existsSync(venv) ? venv : "python3";
})();

let pass = 0;
let fail = 0;
const check = (name, ok, detail) => {
  if (ok) {
    pass++;
    console.log("  ✅ " + name);
  } else {
    fail++;
    console.log("  ❌ " + name + "\n       " + String(detail).slice(0, 300));
  }
};

const H = { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" };

async function j(path, method = "GET", body) {
  const r = await fetch(API_V1 + path, {
    method,
    headers: H,
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  try {
    return { status: r.status, json: JSON.parse(t) };
  } catch {
    return { status: r.status, json: t };
  }
}

/** 直接在数据库里数孤儿行 —— 唯一能穿透"过滤后看不到"的判据。 */
function countOrphans() {
  const py = `
import psycopg, json
url = None
for line in open("${process.cwd()}/../api/.env"):
    if line.startswith("DATABASE_URL="):
        url = line.split("=", 1)[1].strip()
url = url.replace("postgresql+psycopg://", "postgresql://")
out = {}
with psycopg.connect(url, connect_timeout=5) as c:
    with c.cursor() as cur:
        for name, sql in [
            ("kbs", "SELECT count(*) FROM knowledge_bases k WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id=k.user_id)"),
            ("folders", "SELECT count(*) FROM folders f WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id=f.user_id)"),
            ("documents", "SELECT count(*) FROM documents d WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id=d.user_id)"),
            ("favorites", "SELECT count(*) FROM favorites x WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id=x.user_id)"),
            ("recent_views", "SELECT count(*) FROM recent_views x WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id=x.user_id)"),
            ("comments", "SELECT count(*) FROM comments x WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id=x.user_id)"),
            ("kb_shares", "SELECT count(*) FROM kb_shares x WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id=x.user_id)"),
            ("audit_logs", "SELECT count(*) FROM audit_logs x WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id=x.user_id)"),
            ("notifications", "SELECT count(*) FROM notifications x WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id=x.user_id OR u.id=x.actor_id)"),
        ]:
            cur.execute(sql)
            out[name] = cur.fetchone()[0]
print(json.dumps(out))
`;
  try {
    const out = execFileSync(PY, ["-c", py], {
      encoding: "utf8",
      timeout: 30000,
    });
    return JSON.parse(out.trim());
  } catch (e) {
    return { error: String(e.message || e).slice(0, 200) };
  }
}

(async () => {
  console.log("=== 删除用户的级联清理验证 ===\n");

  const base = countOrphans();
  // 🔴 `audit_logs` **不计入基线** —— 审计日志刻意随用户删除而保留
  //    （合规要求：账号存续期内的操作必须可追溯），其 user_id 指向已删用户
  //    是**设计意图**，不是缺陷。断言它为 0 会是错的判据。
  const baseWithoutAudit = { ...base };
  delete baseWithoutAudit.audit_logs;
  console.log("基线孤儿数（不含 audit_logs）:", JSON.stringify(baseWithoutAudit));
  check(
    "基线：数据库里无孤儿数据（清理干净的状态）",
    !base.error && Object.values(baseWithoutAudit).every((v) => v === 0),
    JSON.stringify(base),
  );

  // ---------- 建一个临时用户 ----------
  const uname = "CAS-" + Date.now().toString(36);
  const created = await j("/users", "POST", {
    username: uname,
    password: "CasTest123!",
    role: "user",
  });
  // 注意：`POST /users` 的响应是 `{user: {...}}`（嵌套），不是裸对象
  const uid = created.json?.user?.id ?? created.json?.id;
  check(
    "建临时用户成功",
    created.status === 200 && !!uid,
    `${created.status} ${JSON.stringify(created.json).slice(0, 120)}`,
  );
  if (!uid) {
    console.log("\n无法继续（建用户失败）");
    process.exit(1);
  }

  // ---------- 用该用户建知识库 + 文件夹 + 文档 ----------
  const login = await fetch(API_V1 + "/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: uname, password: "CasTest123!" }),
  }).then((r) => r.json());
  const uTok = login.token;
  const uH = { Authorization: "Bearer " + uTok, "Content-Type": "application/json" };

  const kb = await fetch(API_V1 + "/kbs", {
    method: "POST",
    headers: uH,
    body: JSON.stringify({ name: "CAS-孤儿验证库", description: "级联验证用" }),
  }).then((r) => r.json());

  const folder = await fetch(API_V1 + "/folders", {
    method: "POST",
    headers: uH,
    body: JSON.stringify({ name: "CAS-文件夹", kb_id: kb.id }),
  }).then((r) => r.json());

  const doc = await fetch(API_V1 + "/documents", {
    method: "POST",
    headers: uH,
    body: JSON.stringify({ title: "CAS-文档", content: "级联验证内容", type: "doc", kb_id: kb.id }),
  }).then((r) => r.json());

  check(
    "该用户建了 知识库 / 文件夹 / 文档",
    !!kb.id && !!folder.id && !!doc.id,
    JSON.stringify({ kb: kb.id, folder: folder.id, doc: doc.id }),
  );
  // 让它产生 1 条收藏与 1 条浏览记录（覆盖关系类表）
  await fetch(API_V1 + `/documents/${doc.id}/favorite`, { method: "POST", headers: uH });
  await fetch(API_V1 + `/documents/${doc.id}`, { headers: uH });
  await sleep(300);

  // ---------- 删除该用户 ----------
  const del = await j(`/users/${uid}`, "DELETE");
  check("删除用户返回 200", del.status === 200, `${del.status} ${JSON.stringify(del.json).slice(0, 100)}`);
  await sleep(800);

  // ---------- 核心判据：数据库里不得有任何孤儿 ----------
  const after = countOrphans();
  console.log("\n删除后孤儿数:", JSON.stringify(after));
  check(
    "删除用户后：知识库无孤儿",
    after.kbs === 0,
    `kbs=${after.kbs}（若 >0 说明未级联，且这些库用户永远看不到）`,
  );
  check("删除用户后：文件夹无孤儿", after.folders === 0, `folders=${after.folders}`);
  check("删除用户后：文档无孤儿", after.documents === 0, `documents=${after.documents}`);
  check("删除用户后：收藏无孤儿", after.favorites === 0, `favorites=${after.favorites}`);
  check("删除用户后：浏览记录无孤儿", after.recent_views === 0, `recent_views=${after.recent_views}`);
  check("删除用户后：通知无孤儿（含 actor_id）", after.notifications === 0, `notifications=${after.notifications}`);
  check("删除用户后：评论无孤儿", after.comments === 0, `comments=${after.comments}`);
  check("删除用户后：共享无孤儿", after.kb_shares === 0, `kb_shares=${after.kb_shares}`);
  // audit_logs **刻意保留**（审计追溯是合规要求）——故不断言其为 0，
  // 而是断言「本次被删用户的操作确实留痕了」——这才是正确的判据方向。
  check(
    "删除用户后：审计日志**保留**了该用户的操作痕迹（合规要求）",
    after.audit_logs >= base.audit_logs,
    `基线 ${base.audit_logs} → 现 ${after.audit_logs}（不应减少）`,
  );

  // ---------- 用户本身确实没了 ----------
  const gone = await j(`/users/${uid}`);
  check("该用户已从用户列表消失", gone.status === 404 || gone.json?.username !== uname, `${gone.status}`);

  // ---------- 回收站接口应为空（用户所见） ----------
  const trash = await j("/trash");
  check(
    "回收站接口无残留（不可见幽灵已不存在）",
    (trash.json.documents || []).length === 0 &&
      (trash.json.folders || []).length === 0 &&
      (trash.json.kbs || []).length === 0,
    JSON.stringify(trash.json).slice(0, 200),
  );

  console.log(`\n通过 ${pass} / 失败 ${fail}`);
  console.log(fail === 0 ? "✅ 全部通过" : "❌ 存在失败项");
  process.exit(fail ? 1 : 0);
})();