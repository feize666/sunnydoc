#!/usr/bin/env node
/**
 * 搜索的「自然语言提问」语义护栏。
 *
 * ## 为什么需要它（2026-11-04 实测缺陷）
 *
 * `/search` 按空白分组做 AND。中文用户习惯在问句里带口语成分，
 * 而文档正文里当然不会有「怎么写」「怎么用」「做…」这些词 ——
 * 于是那一组恒定无命中，**整条查询被 AND 归零**：
 *
 *     「traefik」单独            → 13 条
 *     「怎么用 traefik 做入口路由」 → **0 条**
 *     「ansible playbook」        → 9 条
 *     「ansible playbook 怎么写」  → **0 条**
 *
 * 更隐蔽的一条链路：「怎么写」被 jieba 切成 `['怎么','写']`，
 * 「怎么」被停用词过滤、只剩单字「写」又被最小长度滤掉，
 * 于是「分组空了就退回原串」的兜底把它还原成 `['怎么写']`
 * —— **兜底把已经被正确丢弃的词又救回来了**。
 *
 * ## 判据设计（两侧都要测，避免修一边坏一边）
 *
 * A. **自然语言提问必须能命中**（这是修复目标）
 * B. **标识符/精确/引号语义不得退化**（这是防回归的护栏）
 *    - `/dev/sda` 曾因误用分词 OR 从"精确"膨胀到 124 条
 *    - `ceph-osd` / `vt-x` 同理
 * C. **纯填充词查询不得退化成「匹配全部」**（这是修复的边界）
 */
const fs = require("fs");

const API = process.env.SUNNYDOC_API || "http://127.0.0.1:8000";
const TOKEN =
  process.env.SUNNYDOC_TOKEN ||
  fs.readFileSync(process.env.SUNNYDOC_TOKEN_FILE || "/tmp/sunnydoc-token.txt", "utf8").trim();

let pass = 0;
let fail = 0;
const check = (name, ok, detail) => {
  if (ok) {
    pass++;
    console.log("  ✅ " + name);
  } else {
    fail++;
    console.log("  ❌ " + name + "\n       " + String(detail).slice(0, 260));
  }
};

async function count(q) {
  const r = await fetch(`${API}/api/v1/search?q=${encodeURIComponent(q)}&limit=50`, {
    headers: { Authorization: "Bearer " + TOKEN },
  });
  const d = await r.json();
  const list = d.results || d.documents || [];
  return {
    n: list.length,
    titles: list.slice(0, 3).map((x) => String(x.title || "")),
    // 判据要看**全部结果**里是否出现关键词，而不只是前 3 条
    // （实测教训：宽查询如「linux 防火墙配置」正确命中 50 条，
    //   但标题排序靠前的几篇未必含关键词 → 只看前 3 会假失败）
    allTitles: list.map((x) => String(x.title || "")),
  };
}

(async () => {
  console.log("=== 搜索自然语言语义护栏 ===\n");

  // ---------- A. 自然语言提问必须命中 ----------
  console.log("【A】自然语言提问应能命中（修复目标）");
  const natural = [
    ["怎么用 traefik 做入口路由", ["Traefik"]],
    ["ansible playbook 怎么写", ["playbook", "Ansible"]],
    ["如何配置 nginx 负载均衡", ["负载均衡", "Nginx"]],
    ["docker 镜像怎么打包", ["镜像", "Docker"]],
    ["kafka 集群搭建", ["Kafka"]],
    ["redis 集群怎么搭", ["Redis"]],
    ["linux 防火墙配置", ["iptables", "防火墙"]],
  ];
  for (const [q, expects] of natural) {
    const { n, titles, allTitles } = await count(q);
    const hit = allTitles.some((t) => expects.some((e) => t.toLowerCase().includes(e.toLowerCase())));
    check(
      `「${q}」命中 ${expects[0]}（${n} 条）`,
      n > 0 && hit,
      `前 3: ${JSON.stringify(titles)}`,
    );
  }

  // ---------- B. 标识符/精确语义不得退化 ----------
  console.log("\n【B】标识符与精确匹配不得退化（防回归）");
  // 这些是"应该保持窄"的查询：结果数过多说明被错误地分词 OR 了
  const precise = [
    ["/dev/sda", 20],
    ["ceph-osd", 20],
    ["vt-x", 20],
  ];
  for (const [q, max] of precise) {
    const { n, titles } = await count(q);
    check(`「${q}」保持精确（${n} 条 ≤ ${max}）`, n > 0 && n <= max, `实际 ${n} 条: ${JSON.stringify(titles)}`);
  }

  // 引号原样匹配
  {
    const { n } = await count('"负载均衡"');
    check(`引号原样匹配仍生效（${n} 条）`, n > 0, "引号查询返回 0 条");
  }

  // 纯英文多词 AND
  {
    const { n, titles } = await count("kvm virsh");
    check(`纯英文多词 AND 仍生效（${n} 条）`, n > 0, `实际前 3: ${JSON.stringify(titles)}`);
  }

  // ---------- C. 纯填充词不得退化成全匹配 ----------
  console.log("\n【C】纯填充词查询的边界（不得匹配全部）");
  {
    const { n } = await count("怎么写");
    // 库里没有文档含「怎么写」，所以必须是 0；关键是**不能变成"全部文档"**
    check(`「怎么写」不等于匹配全部（${n} 条，库内无此词应为 0）`, n < 10, `实际 ${n} 条 —— 已退化为宽松匹配`);
  }

  // ---------- 汇总 ----------
  console.log(`\n通过 ${pass} / 失败 ${fail}`);
  console.log(fail === 0 ? "✅ 全部通过" : "❌ 存在失败项");
  process.exit(fail ? 1 : 0);
})();