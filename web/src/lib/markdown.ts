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
};

export function renderMarkdown(src: string): string {
  // 无 DOM 环境（如 SSR 预渲染）时退回禁用内联 HTML 的安全渲染。
  if (typeof window === "undefined" || !DOMPurify.isSupported) {
    return mdSafe.render(src);
  }
  const dirty = md.render(src);
  return DOMPurify.sanitize(dirty, PURIFY_CONFIG);
}

export function countWords(src: string): number {
  return src.replace(/\s/g, "").length;
}
