#!/usr/bin/env node
/**
 * 全量真机回归 runner：串行跑 web/scripts/verify_*.cjs，汇总结果。
 *
 * 为什么需要它：每个脚本单跑 20~40s，25 个手工点一遍不现实；
 * 而发布后（打 tag 前）必须知道「这版整体是稳的」——单看某几个脚本不够。
 *
 * 串行而非并行：所有脚本都打同一个后端 + 共享测试数据，
 * 并行会互相干扰夹具（且前端 dev server 是单进程）。
 *
 * 用法：
 *   NODE_PATH=<托管 workspace node_modules> node web/scripts/run_all_verify.cjs
 *   node web/scripts/run_all_verify.cjs --only search,citation   # 只跑名字含关键词的
 *   node web/scripts/run_all_verify.cjs --skip perf             # 跳过含关键词的
 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const SCRIPTS_DIR = __dirname;
const args = process.argv.slice(2);
const argVal = (name) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
};
const only = argVal("--only");
const skip = argVal("--skip");
const TIMEOUT_MS = 180_000; // 单脚本上限：大文档性能脚本较慢，给足余量

const all = fs
  .readdirSync(SCRIPTS_DIR)
  .filter((f) => /^verify_.*\.cjs$/.test(f))
  .sort();

const picked = all.filter((f) => {
  if (only && !only.split(",").some((k) => f.includes(k.trim()))) return false;
  if (skip && skip.split(",").some((k) => f.includes(k.trim()))) return false;
  return true;
});

if (picked.length === 0) {
  console.error("没有匹配的脚本");
  process.exit(1);
}

console.log(`共 ${picked.length} 个脚本，串行执行\n${"=".repeat(56)}`);

const results = [];
const t0 = Date.now();

picked.forEach((file, idx) => {
  const label = `[${idx + 1}/${picked.length}] ${file}`;
  const started = Date.now();
  let ok = false;
  let note = "";
  try {
    const out = execFileSync(process.execPath, [path.join(SCRIPTS_DIR, file)], {
      cwd: path.resolve(SCRIPTS_DIR, ".."),
      env: process.env,
      timeout: TIMEOUT_MS,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    ok = /全部通过|ALL PASS/.test(out);
    // 没打印「全部通过」但退出码 0 —— 说明脚本没走完汇总逻辑，按失败处理
    if (!ok) note = "退出码 0 但未见「全部通过」";
    // 抓失败项，便于汇总时直接看出问题
    const failed = out.split("\n").filter((l) => l.includes("❌")).slice(0, 3);
    if (failed.length) note = failed.map((l) => l.trim()).join(" | ");
  } catch (e) {
    note =
      e.killed || e.signal
        ? `超时/被杀（${e.signal || TIMEOUT_MS + "ms"}）`
        : `退出码 ${e.status ?? "?"}`;
    const out = String(e.stdout || "");
    const failed = out.split("\n").filter((l) => l.includes("❌")).slice(0, 3);
    if (failed.length) note += " :: " + failed.map((l) => l.trim()).join(" | ");
    const lastErr = out.split("\n").filter((l) => /Error|失败/.test(l)).slice(-1)[0];
    if (lastErr && !failed.length) note += " :: " + lastErr.trim().slice(0, 120);
  }
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`${ok ? "✅" : "❌"} ${label}  ${secs}s${note ? "\n      " + note : ""}`);
  results.push({ file, ok, secs: Number(secs), note });
});

const totalSecs = ((Date.now() - t0) / 1000).toFixed(1);
const passed = results.filter((r) => r.ok).length;
const failedList = results.filter((r) => !r.ok);

console.log("=".repeat(56));
console.log(`总计 ${results.length} 个 · 通过 ${passed} · 失败 ${failedList.length} · 耗时 ${totalSecs}s`);
if (failedList.length) {
  console.log("\n失败清单：");
  failedList.forEach((r) => console.log(`  ❌ ${r.file}  —  ${r.note || "未通过"}`));
}

// ---------- 收尾清扫 ----------
// 🔴 为什么必须在 runner 层面做（而不是只靠各脚本自己清）：
//   脚本内的 `finally` 覆盖不到三种情况 ——
//     ① 建夹具的代码在 try 之外时，抛异常就绕过清理；
//     ② runner 超时 SIGKILL 杀进程，`finally` 根本不会跑；
//     ③ 新脚本忘了清。
//   实测代价（2026-10-25）：本机积了 **165 篇夹具文档**（在活跃列表里，
//   用户打开知识库满屏垃圾）+ 28 个空 BMV-目标库 + 回收站 35 文件夹/28 知识库，
//   而各脚本的「零残留」断言**全绿** —— 因为泄漏发生在它们自己看不见的路径上。
//   清扫只删「确有把握是夹具」的项，判据见 fixture_sweep.cjs 头部。
if (!skip || !skip.split(",").some((k) => k.trim() === "sweep")) {
  console.log("\n" + "=".repeat(56));
  try {
    execFileSync(process.execPath, [path.join(SCRIPTS_DIR, "fixture_sweep.cjs")], {
      cwd: path.resolve(SCRIPTS_DIR, ".."),
      // 显式放行：清扫有「防误删正在运行的回归」保护，runner 内部调用属安全场景
      env: { ...process.env, SUNNYDOC_SWEEP_FORCE: "1" },
      timeout: 120_000,
      encoding: "utf8",
      stdio: "inherit",
    });
  } catch (e) {
    console.log("⚠️ 夹具清扫未能完成（不影响上面的验证结论）：" + (e.message || "").split("\n")[0]);
  }
}

process.exit(failedList.length === 0 ? 0 : 1);