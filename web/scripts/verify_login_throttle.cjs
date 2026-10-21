#!/usr/bin/env node
/**
 * 真机验证「登录节流」与「导入大小上限」两处安全加固（纯 HTTP，不需浏览器）。
 *
 * 背景（2026-10-21 审计报告 §1.2 / §1.3 实测）：
 *   1. 登录接口**完全没有节流** —— 连打 12 次错误密码全部 401、总耗时 127ms
 *      （约 6000 次/分钟），而密码下限仅 6 位且无复杂度要求 → 弱口令可被高速枚举。
 *   2. `/documents/import` **完全没有大小上限** —— 函数体内只判断「文件是否为空」，
 *      循环内不累计字节 → 可无限写盘直到打满磁盘；而同一产品的图片 10MB /
 *      附件 30MB 都有上限，属明显不对称。
 *
 * 判据设计（每条都能区分「真修好」与「恰好通过」）：
 *   - 节流：必须给出「**前 5 次仍然放行**」的对照。否则「全都 429」也可能是因为
 *     路由坏了，判据失去区分度。
 *   - 节流键按「用户名 + IP」：必须断言**另一个用户名不受影响**，
 *     否则等于把全站登录一起锁死（可用性被反利用）。
 *   - 导入：不只断言 413，还要断言**临时目录文件数没有增长** ——
 *     「拒绝请求但留下垃圾」是这类改动的典型副作用。
 *
 * 断言（15 项）：
 *   A 节流
 *     1. 前 5 次失败返回 401（正常用户打错密码无感）
 *     2. 第 6 次起出现 429
 *     3. 429 带 Retry-After 头
 *     4. 锁定期内即使密码正确也 429（否则节流形同虚设）
 *     5. 对照：另一个用户名不受影响（键按用户隔离，不是全站锁）
 *     6. 对照：真实账号输错密码同样 401（不是只对不存在的用户生效）
 *   B 导入上限
 *     7. 超过上限的文件返回 413
 *     8. 超限后临时文件未残留
 *     9. 对照：正常小文件仍可导入（上限没误伤正常路径）
 *
 * 用法：
 *   NODE_PATH=<托管 node_modules> node web/scripts/verify_login_throttle.cjs
 */
const fs = require("fs");
const path = require("path");

const API = process.env.SUNNYDOC_API || "http://127.0.0.1:8000";
const TOKEN = (
  process.env.SUNNYDOC_TOKEN ||
  fs.readFileSync(process.env.SUNNYDOC_TOKEN_FILE || "/tmp/sunnydoc-token.txt", "utf8")
).trim();
const KB = process.env.SUNNYDOC_KB || "fdef57f179384d679b62a3c4bae2d2e3";
/** 后端临时落盘目录（与本脚本同仓，故用相对仓库根定位，避免硬编码绝对路径）。 */
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const TMP_DIR = process.env.SUNNYDOC_TMP_DIR || path.join(REPO_ROOT, "api", "data", "tmp");
/** 上限应与 routes.py 的 MAX_IMPORT_BYTES 一致（100MB）。 */
const MAX_IMPORT_MB = 100;

let fail = 0;
const check = (n, c, d = "") => {
  if (c) console.log("  ✅ " + n);
  else {
    fail++;
    console.log("  ❌ " + n + "  " + String(d).slice(0, 200));
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const postJson = async (p, body, token) => {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  const r = await fetch(API + p, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 非 JSON */
  }
  return { status: r.status, json, text, retryAfter: r.headers.get("retry-after") };
};

const countTmp = () => (fs.existsSync(TMP_DIR) ? fs.readdirSync(TMP_DIR).length : 0);

(async () => {
  console.log("=== A. 登录节流（防在线暴力破解）===");

  // 用**不存在**的用户名做节流测试，避免影响真实账号
  const probeUser = "THR-" + Date.now().toString(36);
  const codes = [];
  let firstRetryAfter = null;
  for (let i = 0; i < 14; i++) {
    const r = await postJson("/api/v1/auth/login", { username: probeUser, password: "wrong-" + i });
    codes.push(r.status);
    if (r.status === 429 && firstRetryAfter === null) firstRetryAfter = r.retryAfter;
  }
  console.log("  状态码序列: " + codes.join(","));

  check(
    "前 5 次失败仍返回 401（正常用户打错密码无感）",
    codes.slice(0, 5).every((c) => c === 401),
    codes.slice(0, 5).join(","),
  );
  check(
    "第 6 次起触发 429（节流生效）",
    codes.slice(5).some((c) => c === 429),
    codes.join(","),
  );
  check(
    "429 响应带 Retry-After 头（客户端可据此退避）",
    !!firstRetryAfter && /^\d+$/.test(firstRetryAfter),
    `retry-after=${firstRetryAfter}`,
  );

  const locked = await postJson("/api/v1/auth/login", { username: probeUser, password: "whatever" });
  check("锁定期内任何请求一律 429（否则节流形同虚设）", locked.status === 429, `HTTP=${locked.status}`);

  // 对照 1：其他用户名不受影响 —— 若键不含用户名，会把全站登录一起锁死
  const other = await postJson("/api/v1/auth/login", { username: "t_hook", password: "admin123" });
  check("对照：其他用户名不受影响（键按用户+IP 隔离）", other.status === 200, `HTTP=${other.status}`);

  // 对照 2：真实账号输错密码也受限（证明不是只对不存在的用户生效）
  const admWrong = await postJson("/api/v1/auth/login", { username: "t_hook", password: "definitely-wrong" });
  check("对照：真实账号输错密码同样返回 401（非特例）", admWrong.status === 401, `HTTP=${admWrong.status}`);

  console.log("\n=== B. /documents/import 大小上限 ===");
  const before = countTmp();

  // 造一个比上限大 1MB 的文件（流式写入，避免占内存）
  const bigPath = path.join(REPO_ROOT, "api", "data", "tmp-import-probe.bin");
  const mb = MAX_IMPORT_MB + 1;
  const fd = fs.openSync(bigPath, "w");
  const chunk = Buffer.alloc(1024 * 1024, 0x30);
  for (let i = 0; i < mb; i++) fs.writeSync(fd, chunk);
  fs.closeSync(fd);
  console.log(`  测试文件: ${mb}MB（上限 ${MAX_IMPORT_MB}MB）`);

  let r;
  try {
    const form = new FormData();
    form.append("file", new Blob([fs.readFileSync(bigPath)]), "too-big.bin");
    const res = await fetch(API + "/api/v1/documents/import", {
      method: "POST",
      headers: { Authorization: "Bearer " + TOKEN },
      body: form,
    });
    r = { status: res.status, text: await res.text() };
  } finally {
    fs.rmSync(bigPath, { force: true });
  }
  check(`超过 ${MAX_IMPORT_MB}MB 的导入返回 413`, r.status === 413, `HTTP=${r.status} ${r.text.slice(0, 90)}`);
  check("超限后临时文件未残留", countTmp() <= before, `before=${before} after=${countTmp()}`);

  // 对照：正常小文件必须能导入（上限没有误伤正常路径）
  const smallPath = path.join(REPO_ROOT, "api", "data", "tmp-import-ok.md");
  fs.writeFileSync(
    smallPath,
    "# 导入冒烟\n\n用于验证导入上限未误伤正常路径的临时文档，脚本结束会自行清理。\n",
  );
  const form2 = new FormData();
  form2.append("file", new Blob([fs.readFileSync(smallPath)]), "import-ok.md");
  form2.append("kb_id", KB);
  const res2 = await fetch(API + "/api/v1/documents/import", {
    method: "POST",
    headers: { Authorization: "Bearer " + TOKEN },
    body: form2,
  });
  const j2 = await res2.json().catch(() => ({}));
  fs.rmSync(smallPath, { force: true });
  check(
    "对照：正常小文件仍可导入（200 + task_id）",
    res2.status === 200 && !!j2.task_id,
    `HTTP=${res2.status}`,
  );

  // 等后台任务收尾，再清理冒烟文档（软删 + 从回收站彻底删除）
  if (j2.task_id) {
    for (let i = 0; i < 40; i++) {
      const t = await fetch(`${API}/api/v1/documents/import/${j2.task_id}`)
        .then((x) => x.json())
        .catch(() => ({}));
      if (["done", "failed", "error"].includes(t.status)) break;
      await sleep(500);
    }
  }
  const list = await fetch(`${API}/api/v1/documents?limit=1000`, {
    headers: { Authorization: "Bearer " + TOKEN },
  }).then((x) => x.json());
  let cleaned = 0;
  for (const d of (list.documents || []).filter((x) => x.title === "导入冒烟")) {
    await fetch(`${API}/api/v1/documents/${d.id}`, {
      method: "DELETE",
      headers: { Authorization: "Bearer " + TOKEN },
    });
    await fetch(`${API}/api/v1/trash/document/${d.id}`, {
      method: "DELETE",
      headers: { Authorization: "Bearer " + TOKEN },
    });
    cleaned++;
  }

  // 零残留核对（活跃 + 回收站两处）
  const live = await fetch(`${API}/api/v1/documents?limit=1000`, {
    headers: { Authorization: "Bearer " + TOKEN },
  }).then((x) => x.json());
  const trash = await fetch(`${API}/api/v1/trash`, {
    headers: { Authorization: "Bearer " + TOKEN },
  }).then((x) => x.json());
  const leftLive = (live.documents || []).filter((d) => d.title === "导入冒烟");
  const leftTrash = (trash.documents || []).filter((d) => d.title === "导入冒烟");
  check("零残留（活跃列表无冒烟文档）", leftLive.length === 0, JSON.stringify(leftLive.map((d) => d.title)));
  check("零残留（回收站无冒烟文档）", leftTrash.length === 0, JSON.stringify(leftTrash.map((d) => d.title)));

  console.log(`\n  已清理冒烟文档 ${cleaned} 篇`);
  console.log("\n" + (fail === 0 ? "全部通过" : `失败 ${fail} 项`));
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error("脚本异常:", e);
  process.exit(1);
});