import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";
import type { Config } from "dompurify";

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

const PURIFY_CONFIG: Config = {
  // 默认白名单已涵盖 markdown 输出（p/h1~h6/strong/em/code/pre/blockquote/
  // a/table/ul/ol/li/hr/span 等），并自动剔除 script/iframe、on* 事件属性
  // 与 javascript: 等危险协议。此处再显式禁止一批高危标签，做双保险。
  FORBID_TAGS: [
    "script",
    "style",
    "iframe",
    "object",
    "embed",
    "link",
    "meta",
    "form",
    "input",
    "base",
  ],
  // 搜索命中高亮用 <mark>，加入白名单
  ADD_TAGS: ["mark"],
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 对文本做大小写不敏感的关键词高亮，非命中部分转义。 */
function highlightText(content: string, keyword: string): string {
  if (!keyword) return escapeHtml(content);
  const lower = content.toLowerCase();
  const kw = keyword.toLowerCase();
  let out = "";
  let i = 0;
  while (i < content.length) {
    const idx = lower.indexOf(kw, i);
    if (idx === -1) {
      out += escapeHtml(content.slice(i));
      break;
    }
    out += escapeHtml(content.slice(i, idx));
    out += `<mark class="search-hit">${escapeHtml(
      content.slice(idx, idx + keyword.length),
    )}</mark>`;
    i = idx + keyword.length;
  }
  return out;
}

export function renderMarkdown(src: string, highlight?: string): string {
  const keyword = highlight?.trim();
  const baseMd =
    typeof window === "undefined" || !DOMPurify.isSupported ? mdSafe : md;

  if (!keyword) {
    return baseMd === md
      ? DOMPurify.sanitize(baseMd.render(src), PURIFY_CONFIG)
      : baseMd.render(src);
  }

  // 临时覆盖 text 渲染规则做命中高亮，渲染后还原，避免污染单例
  const origText = baseMd.renderer.rules.text;
  baseMd.renderer.rules.text = (tokens, idx) =>
    highlightText(tokens[idx].content, keyword);
  const rendered = baseMd.render(src);
  baseMd.renderer.rules.text = origText;

  return baseMd === md
    ? DOMPurify.sanitize(rendered, PURIFY_CONFIG)
    : rendered;
}

export function countWords(src: string): number {
  return src.replace(/\s/g, "").length;
}
