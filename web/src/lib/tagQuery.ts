/**
 * 搜索框的 `tag:xxx` 查询语法解析。
 *
 * 输入「tag:周报 季度」→ `{ q: "季度", tag: "周报" }`：
 * - `tag` 同步为标签筛选（侧栏筛选条 chip 可见、可点 × 清除）；
 * - `q` 是剥离标签 token 后的实际查询词（发给后端的内容检索）。
 *
 * 约定：
 * - 只有**第一个** `tag:` token 生效（后端 `/search?tag=` 只接受单个标签）；
 * - 查询词里出现 "tag:" 字样会被当作语法，与 Gmail `label:` 等工具一致；
 * - `tag:` 后必须紧跟非空白字符才算一个 token（光敲 "tag:" 时按普通文本搜索）。
 *
 * ⚠️ 侧栏的视图分支与 page.tsx 的搜索 effect **必须共用本函数**：
 * 两边各写一份正则，一旦分叉就会出现「侧栏显示搜索页、effect 却什么也没搜」。
 */

/** 匹配单个 tag token（行首或空白之后）。 */
const TAG_TOKEN = /(?:^|\s)tag:([^\s]+)/;
/** 匹配所有 tag token（用于从查询词中剥离）。 */
const TAG_TOKEN_G = /(?:^|\s)tag:[^\s]+/g;

export function parseTagQuery(raw: string): { q: string; tag: string } {
  const text = raw.trim();
  const m = text.match(TAG_TOKEN);
  const tag = m ? m[1] : "";
  // 剥离后会留下 token 前的空白（"html tag:div 用法" → "html  用法"），
  // 必须折叠——这个串会经 setTagFilter 回显进输入框，双空格用户看得见。
  const q = text.replace(TAG_TOKEN_G, " ").replace(/\s+/g, " ").trim();
  return { q, tag };
}
