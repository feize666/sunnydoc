import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";
import type { Config } from "dompurify";
import anchor from "markdown-it-anchor";
import taskLists from "markdown-it-task-lists";
import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import javascript from "shiki/langs/javascript.mjs";
import typescript from "shiki/langs/typescript.mjs";
import python from "shiki/langs/python.mjs";
import json from "shiki/langs/json.mjs";
import bash from "shiki/langs/bash.mjs";
import shell from "shiki/langs/shell.mjs";
import sql from "shiki/langs/sql.mjs";
import css from "shiki/langs/css.mjs";
import html from "shiki/langs/html.mjs";
import xml from "shiki/langs/xml.mjs";
import mdLang from "shiki/langs/markdown.mjs";
import yaml from "shiki/langs/yaml.mjs";
import java from "shiki/langs/java.mjs";
import go from "shiki/langs/go.mjs";
import rust from "shiki/langs/rust.mjs";
import oneDarkPro from "shiki/themes/one-dark-pro.mjs";
import githubLight from "shiki/themes/github-light.mjs";

// markdown-it 实例类型（@types/markdown-it 使用 export =，默认导入只带值）
type MarkdownItInstance = ReturnType<typeof MarkdownIt>;

// 支持内联 HTML（用于字体颜色 <span style="color:...">），
// 渲染结果会经 DOMPurify 白名单过滤，杜绝 XSS。
const md = new MarkdownIt({
  html: true,
  linkify: true,
  breaks: false,
});

// SSR / 无 DOM 环境下的保守降级实例：不渲染内联 HTML，保证安全。
const mdSafe = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
});

// 标题锚点（生成 id）+ GitHub 风格任务列表 + 语雀语法兼容 + 双向链接
for (const instance of [md, mdSafe]) {
  instance.use(anchor, { level: [1, 2, 3, 4, 5, 6] });
  instance.use(taskLists);
  instance.use(yuqueCompat);
  instance.use(wikilink);
}

// —— 语雀 markdown 兼容 ——
// 提示块：:::type [标题] ... :::
// 折叠块：#+BEGIN_NOTE ... #+END_NOTE
function yuqueCompat(md: MarkdownItInstance) {
  const OPEN_RE = /^:::(\w+)(?:\s+(.*))?$/;
  const CLOSE_RE = /^:::$/;

  // 读取指定行的原始文本（markdown-it StateBlock 无 getLine 方法）
  function lineText(state: any, line: number): string {
    const start = state.bMarks[line] + state.tShift[line];
    const max = state.eMarks[line];
    return state.src.slice(start, max);
  }

  function callout(
    state: any,
    startLine: number,
    endLine: number,
    silent: boolean,
  ): boolean {
    const m = OPEN_RE.exec(lineText(state, startLine).trim());
    if (!m) return false;

    let nextLine = startLine + 1;
    while (nextLine < endLine && !CLOSE_RE.test(lineText(state, nextLine).trim())) {
      nextLine++;
    }
    if (nextLine >= endLine) return false;

    if (silent) return true;

    const type = m[1].toLowerCase();
    const title = (m[2] || "").trim();

    let token = state.push("yuque_callout_open", "div", 1);
    token.attrSet("class", `callout callout-${type}`);

    if (title) {
      token = state.push("yuque_callout_title", "div", 0);
      token.attrSet("class", "callout-title");
      token.content = title;
    }

    state.md.block.tokenize(state, startLine + 1, nextLine);

    token = state.push("yuque_callout_close", "div", -1);
    state.line = nextLine + 1;
    return true;
  }

  function note(
    state: any,
    startLine: number,
    endLine: number,
    silent: boolean,
  ): boolean {
    if (!/^#\+BEGIN_NOTE$/.test(lineText(state, startLine).trim())) return false;

    let nextLine = startLine + 1;
    while (nextLine < endLine && !/^#\+END_NOTE$/.test(lineText(state, nextLine).trim())) {
      nextLine++;
    }
    if (nextLine >= endLine) return false;

    if (silent) return true;

    let token = state.push("yuque_note_open", "details", 1);
    token = state.push("yuque_note_summary", "summary", 1);
    token.content = "展开";
    token = state.push("yuque_note_summary_close", "summary", -1);

    state.md.block.tokenize(state, startLine + 1, nextLine);

    token = state.push("yuque_note_close", "details", -1);
    state.line = nextLine + 1;
    return true;
  }

  md.block.ruler.before("blockquote", "yuque_callout", callout, {
    alt: ["paragraph", "reference", "blockquote", "list"],
  });
  md.block.ruler.before("blockquote", "yuque_note", note, {
    alt: ["paragraph", "reference", "blockquote", "list"],
  });

  md.renderer.rules.yuque_callout_open = (tokens, idx) =>
    `<div class="${tokens[idx].attrGet("class")}">\n`;
  md.renderer.rules.yuque_callout_title = (tokens, idx) =>
    `<div class="callout-title">${md.utils.escapeHtml(tokens[idx].content)}</div>\n`;
  md.renderer.rules.yuque_callout_close = () => `</div>\n`;
  md.renderer.rules.yuque_note_open = () => `<details class="callout callout-note">\n`;
  md.renderer.rules.yuque_note_summary = (tokens, idx) =>
    `<summary>${md.utils.escapeHtml(tokens[idx].content)}</summary>\n`;
  md.renderer.rules.yuque_note_summary_close = () => ``;
  md.renderer.rules.yuque_note_close = () => `</details>\n`;
}

// —— 双向链接 [[文档名]] ——
// 渲染为 <span class="wikilink" data-wikilink="文档名">，点击跳转由外层组件事件委托处理
function wikilink(md: MarkdownItInstance) {
  function tokenize(state: any, silent: boolean): boolean {
    const src = state.src;
    const start = state.pos;
    // 必须以 [[ 开头
    if (src.charCodeAt(start) !== 0x5b || src.charCodeAt(start + 1) !== 0x5b) return false;
    // 查找配对的 ]]
    let end = -1;
    for (let i = start + 2; i < state.posMax - 1; i++) {
      if (src.charCodeAt(i) === 0x5d && src.charCodeAt(i + 1) === 0x5d) {
        end = i;
        break;
      }
    }
    if (end === -1) return false;
    const label = src.slice(start + 2, end).trim();
    // 空内容 / 含换行 / 含 [ ] 嵌套视为非 wikilink
    if (!label || /[\n\[\]]/.test(label)) return false;
    if (silent) return true;
    const token = state.push("wikilink", "span", 0);
    token.content = label;
    state.pos = end + 2;
    return true;
  }
  md.inline.ruler.before("link", "wikilink", tokenize);
  md.renderer.rules.wikilink = (tokens: any, idx: number) => {
    const label = md.utils.escapeHtml(tokens[idx].content);
    return `<span class="wikilink" data-wikilink="${label}">${label}</span>`;
  };
}

const PURIFY_CONFIG: Config = {
  // 默认白名单已涵盖 markdown 输出（p/h1~h6/strong/em/code/pre/blockquote/
  // a/table/ul/ol/li/hr/span 等），并自动剔除 script/iframe、on* 事件属性
  // 与 javascript: 等危险协议。此处再显式禁止一批高危标签，做双保险。
  // 注意：input 不放行（任务列表复选框需要它），仅依赖 DOMPurify 白名单
  // 对 input 的属性（type/checked/disabled/class）做过滤。
  FORBID_TAGS: [
    "script",
    "style",
    "iframe",
    "object",
    "embed",
    "link",
    "meta",
    "form",
    "base",
  ],
  // 搜索命中高亮用 <mark>，语雀折叠块用 <details>/<summary>，加入白名单
  ADD_TAGS: ["mark", "details", "summary"],
  // 双向链接 <span data-wikilink>：data-wikilink 属性需放行
  ADD_ATTR: ["data-wikilink"],
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 对文本做大小写不敏感的关键词高亮（支持多关键词），非命中部分转义。 */
function highlightText(content: string, keyword: string): string {
  if (!keyword) return escapeHtml(content);
  const kws = keyword.trim().split(/\s+/).filter(Boolean);
  if (kws.length === 0) return escapeHtml(content);
  const lower = content.toLowerCase();
  // 收集所有命中区间
  const ranges: Array<[number, number]> = [];
  for (const k of kws) {
    const kl = k.toLowerCase();
    let i = 0;
    while (i < content.length) {
      const idx = lower.indexOf(kl, i);
      if (idx === -1) break;
      ranges.push([idx, idx + k.length]);
      i = idx + k.length;
    }
  }
  if (ranges.length === 0) return escapeHtml(content);
  // 合并重叠区间
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) {
      last[1] = Math.max(last[1], r[1]);
    } else {
      merged.push([r[0], r[1]]);
    }
  }
  // 按区间插入 mark
  let out = "";
  let pos = 0;
  for (const [s, e] of merged) {
    out += escapeHtml(content.slice(pos, s));
    out += `<mark class="search-hit">${escapeHtml(content.slice(s, e))}</mark>`;
    pos = e;
  }
  out += escapeHtml(content.slice(pos));
  return out;
}

// ---------------------------------------------------------------------------
// shiki 代码高亮（纯 JS 引擎，避免 oniguruma/wasm 在静态导出下的兼容问题）
// ---------------------------------------------------------------------------

// 常见语言缩写 → 已注册语言的规范名
const LANG_ALIAS: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  sh: "shell",
  zsh: "shell",
  bash: "bash",
  yml: "yaml",
  md: "markdown",
  golang: "go",
};

const SHIKI_THEME_DARK = "one-dark-pro";
const SHIKI_THEME_LIGHT = "github-light";

let highlighterPromise: Promise<HighlighterCore> | null = null;

function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      themes: [oneDarkPro, githubLight],
      langs: [
        javascript,
        typescript,
        python,
        json,
        bash,
        shell,
        sql,
        css,
        html,
        xml,
        mdLang,
        yaml,
        java,
        go,
        rust,
      ],
      // forgiving: 个别语法含 JS 引擎无法模拟的 oniguruma 特性时，
      // 跳过不支持的 pattern 而不是抛错，保证其余部分仍能正常高亮。
      engine: createJavaScriptRegexEngine({ forgiving: true }),
    }).catch((err) => {
      // 初始化失败则重置，允许下次重试
      highlighterPromise = null;
      throw err;
    });
  }
  return highlighterPromise;
}

function resolveTheme(theme?: "light" | "dark"): "light" | "dark" {
  if (theme === "light" || theme === "dark") return theme;
  if (
    typeof document !== "undefined" &&
    document.documentElement.dataset.theme === "dark"
  ) {
    return "dark";
  }
  return "light";
}

function normalizeLang(raw: string): string {
  const lower = raw.trim().toLowerCase();
  if (!lower) return "";
  return LANG_ALIAS[lower] ?? lower;
}

/** 未高亮（无语言 / 引擎不可用 / 高亮抛错）时的降级代码块。 */
function plainCodeHtml(code: string): string {
  return `<pre class="shiki"><code>${escapeHtml(code)}</code></pre>`;
}

/** 组装带语言标签 + 复制按钮的代码块容器。 */
function codeBlockHtml(displayLang: string, body: string): string {
  const label = escapeHtml(displayLang.trim() || "text");
  return (
    `<div class="codeblock">` +
    `<div class="codeblock-head"><span class="codeblock-lang">${label}</span>` +
    `<button type="button" class="codeblock-copy">复制</button></div>` +
    body +
    `</div>`
  );
}

/** 同步渲染 markdown（含可选搜索高亮），期间用占位符替代代码块。 */
function renderMarkdownSync(
  baseMd: MarkdownItInstance,
  src: string,
  keyword: string | undefined,
  blocks: { lang: string; code: string }[],
): string {
  const origFence = baseMd.renderer.rules.fence;
  baseMd.renderer.rules.fence = (tokens, idx) => {
    const info = (tokens[idx].info || "").trim();
    const lang = info.split(/\s+/)[0] || "";
    const id = blocks.length;
    blocks.push({ lang, code: tokens[idx].content });
    return `<span data-shiki-block="${id}"></span>`;
  };

  let rendered: string;
  try {
    if (!keyword) {
      rendered = baseMd.render(src);
    } else {
      const origText = baseMd.renderer.rules.text;
      baseMd.renderer.rules.text = (tokens, idx) =>
        highlightText(tokens[idx].content, keyword);
      rendered = baseMd.render(src);
      baseMd.renderer.rules.text = origText;
    }
  } finally {
    baseMd.renderer.rules.fence = origFence;
  }
  return rendered;
}

export async function renderMarkdown(
  src: string,
  highlight?: string,
  theme?: "light" | "dark",
): Promise<string> {
  const keyword = highlight?.trim() || undefined;
  const baseMd =
    typeof window === "undefined" || !DOMPurify.isSupported ? mdSafe : md;
  const themeName = resolveTheme(theme);

  const blocks: { lang: string; code: string }[] = [];
  const rendered = renderMarkdownSync(baseMd, src, keyword, blocks);

  const html =
    baseMd === md
      ? DOMPurify.sanitize(rendered, PURIFY_CONFIG)
      : rendered;

  if (blocks.length === 0) return html;

  // 异步高亮：先拿到 highlighter 单例，再逐个替换占位符。
  let highlighter: HighlighterCore | null = null;
  try {
    highlighter = await getHighlighter();
  } catch {
    highlighter = null;
  }

  const shikiTheme = themeName === "dark" ? SHIKI_THEME_DARK : SHIKI_THEME_LIGHT;
  let out = html;
  blocks.forEach((block, i) => {
    const placeholder = `<span data-shiki-block="${i}"></span>`;
    const normalized = normalizeLang(block.lang);
    let body: string;
    if (highlighter && normalized) {
      try {
        body = highlighter.codeToHtml(block.code, {
          lang: normalized,
          theme: shikiTheme,
        });
      } catch {
        body = plainCodeHtml(block.code);
      }
    } else {
      body = plainCodeHtml(block.code);
    }
    out = out.replace(placeholder, codeBlockHtml(block.lang, body));
  });
  return out;
}

export function countWords(src: string): number {
  return src.replace(/\s/g, "").length;
}

export interface TocItem {
  level: number;
  text: string;
}

/** 提取文档标题大纲（H1~H4），返回顺序与渲染后 DOM 中的标题顺序一致。 */
export function extractToc(src: string): TocItem[] {
  const tokens = md.parse(src, {});
  const toc: TocItem[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== "heading_open") continue;
    const level = parseInt(t.tag.slice(1), 10);
    if (level < 1 || level > 4) continue;
    const inline = tokens[i + 1];
    const text =
      inline && inline.type === "inline" && inline.children
        ? md.renderer
            .renderInline(inline.children, md.options, {})
            .replace(/<[^>]+>/g, "")
        : "";
    toc.push({ level, text: text.trim() || "未命名" });
  }
  return toc;
}
