import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";
import type { Config } from "dompurify";
import anchor from "markdown-it-anchor";
import taskLists from "markdown-it-task-lists";
import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
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
  instance.use(mention);
}

// 标题锚点「#」链接：hover 标题时浮现，点击复制锚点 URL（分享/定位到章节）
for (const instance of [md, mdSafe]) {
  const defaultHeadingOpen = instance.renderer.rules.heading_open;
  instance.renderer.rules.heading_open = (tokens, idx, options, env, self) => {
    const id = tokens[idx].attrGet("id");
    const rendered = defaultHeadingOpen
      ? defaultHeadingOpen(tokens, idx, options, env, self)
      : self.renderToken(tokens, idx, options);
    return id
      ? `${rendered}<a class="md-anchor" href="#${id}" title="复制链接">#</a>`
      : rendered;
  };
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
    // 空内容 / 含换行 / 含 [ ] 嵌套 / 含 shell 特征（$、=~）视为非 wikilink
    if (!label || /[\n\[\]$]/.test(label) || label.includes("=~")) return false;
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

// —— @ 提及 ——
// 把 markdown 正文里的 `@昵称` 渲染为 `<a class="mention" data-user-name="…">@昵称</a>`。
// 触发规则：@ 之前必须是空白/行首/中文标点（与编辑器内的 @ 唤起守卫一致 —— 避免邮箱误触）。
// 限制：昵称最大 24 字（覆盖真实姓名/拼音首字母+中文）。这是纯文本写法，
// 不需要 TipTap 节点 —— 与 wikilink 走同一条「写时是字面文本，读时由 markdown 解析」的路线，
// 序列化器（getMarkdown）能正常往返，存的就是 "@Hook测试" 这种字面。
function mention(md: MarkdownItInstance) {
  function tokenize(state: any, silent: boolean): boolean {
    const src = state.src;
    const start = state.pos;
    if (src.charCodeAt(start) !== 0x40 /* @ */) return false;
    // 前驱必须是空白/行首/中文标点（与 @ 唤起的 allow 规则一致）
    if (start > 0) {
      const prev = src.charCodeAt(start - 1);
      const isSpace = prev === 0x20 || prev === 0x09 || prev === 0x0a || prev === 0x0d;
      const isCjk = prev >= 0x3000 && prev <= 0x303f; // CJK 标点
      if (!isSpace && !isCjk) return false;
    }
    // 匹配：@ 后跟 1~24 个字符（字母数字下划线中文）
    let end = start + 1;
    while (end < state.posMax) {
      const c = src.charCodeAt(end);
      const isAlnum =
        (c >= 0x30 && c <= 0x39) || // 0-9
        (c >= 0x41 && c <= 0x5a) || // A-Z
        (c >= 0x61 && c <= 0x7a) || // a-z
        c === 0x5f; // _
      const isCjkChar =
        (c >= 0x4e00 && c <= 0x9fff) || // CJK 统一汉字
        (c >= 0x3400 && c <= 0x4dbf); // CJK 扩展 A
      if (!isAlnum && !isCjkChar) break;
      end++;
    }
    const label = src.slice(start + 1, end);
    if (!label) return false;
    if (silent) return true;
    const token = state.push("mention", "a", 0);
    token.content = label;
    state.pos = end;
    return true;
  }
  md.inline.ruler.before("link", "mention", tokenize);
  md.renderer.rules.mention = (tokens: any, idx: number) => {
    const label = md.utils.escapeHtml(tokens[idx].content);
    // id 暂用占位 —— 真实身份在客户端做一次「昵称 → id」映射（异步）。
    // 一期只渲染样式与可点击区域，跨文档点击行为按 data-user-name 走「@昵称 + 回退搜索」。
    return `<a class="mention" data-user-name="${label}">@${label}</a>`;
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
  // 双向链接 <span data-wikilink> / @ 提及 <a data-user-name class="mention">：数据属性需放行
  // 图片尺寸与对齐（DocImage）：data-width / data-align 是自定义属性，
  // 不放行会被清洗掉 → 预览态宽度失效（编辑态却正常，很难发现）。
  // `style` 是 DOMPurify 的默认放行属性之一，但这里显式列出以免误判；
  // 值仍由 DOMPurify 过滤（危险样式会被剔除）。
  ADD_ATTR: ["data-wikilink", "data-user-name", "data-doc-id", "data-width", "data-align", "style"],
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// 媒体 URL 绝对化
// ---------------------------------------------------------------------------

/**
 * 后端产出的媒体引用一律是「根绝对路径」：
 * - `/api/v1/media/{sha1}.{ext}` —— zip 导入时内容寻址存储的图片/视频
 * - `/uploads/{uuid}.{ext}`       —— 编辑器上传的图片、附件、AI 附件缩略图
 *
 * 这两个路径在**生产**是同源的（nginx 反代 `/api/` 与 `/uploads/`），
 * 浏览器按当前 origin 解析即可命中，无需处理。
 *
 * 但**本地开发前后端分端口**（前端 3001 / 后端 8000）时就不同源了：
 * 浏览器会去 `localhost:3001/api/v1/media/xxx.png` 取图 → 404 → 图片全裂。
 *
 * 因此这里按 `NEXT_PUBLIC_API_BASE` 判断：只有它配成**绝对地址**时才补 origin；
 * 配相对路径（同源生产）时原样返回，保证线上零影响。
 */

/** 后端 origin；`NEXT_PUBLIC_API_BASE` 为相对路径时返回 null（表示同源、不需要改写）。 */
function mediaOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_API_BASE;
  if (!raw || !/^https?:\/\//i.test(raw)) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

/**
 * 需要绝对化的路径前缀。
 *
 * 刻意只列这两个**媒体**入口，不做 `/api/v1/` 的通用改写：前者是路由
 * （`routes.py` 的 `GET /media/{filename}`），后者是挂在应用根的静态目录
 * （`main.py` 的 `app.mount("/uploads", …)`），二者行为不同但都是浏览器
 * 直接取资源。其它 API 路径即便被绝对化在本地也更正确，但不在本次
 * 缺陷范围内，保持最小改动以免引入意外行为。
 */
const MEDIA_PATH_RE = /^\/(?:api\/v1\/media\/|uploads\/)/;

/** 属性名 → 值是否为媒体路径。 */
function absolutizeOne(url: string, origin: string): string {
  return MEDIA_PATH_RE.test(url) ? origin + url : url;
}

/**
 * 把 HTML 里指向后端的根绝对路径补成后端 origin（仅 `src`/`href`/`poster`/`srcset`）。
 *
 * 为什么用属性正则而不是 DOMPurify hook：`renderMarkdown` 在 SSR / 无 DOM 环境走
 * 的是不过 DOMPurify 的 `mdSafe` 分支，hook 覆盖不到；属性正则两条分支都能用。
 * 代码块里的示例 HTML 在渲染时已被转义为 `&lt;img src=&quot;…`，不会命中本正则。
 */
export function absolutizeMediaUrls(html: string): string {
  const origin = mediaOrigin();
  if (!origin || !html) return html;

  // src / href / poster：单值属性
  let out = html.replace(
    /(\s(?:src|href|poster)\s*=\s*)(["'])([^"']*)\2/gi,
    (m, prefix: string, quote: string, url: string) =>
      `${prefix}${quote}${absolutizeOne(url, origin)}${quote}`,
  );

  // srcset：逗号分隔的「URL 描述符」列表，需逐项处理
  out = out.replace(
    /(\ssrcset\s*=\s*)(["'])([^"']*)\2/gi,
    (m, prefix: string, quote: string, value: string) => {
      const rewritten = value
        .split(",")
        .map((part) => {
          const trimmed = part.trim();
          if (!trimmed) return part;
          const sp = trimmed.indexOf(" ");
          const url = sp === -1 ? trimmed : trimmed.slice(0, sp);
          const desc = sp === -1 ? "" : trimmed.slice(sp);
          return absolutizeOne(url, origin) + desc;
        })
        .join(", ");
      return `${prefix}${quote}${rewritten}${quote}`;
    },
  );

  return out;
}

/**
 * 把单个媒体路径补成后端 origin（供组件渲染 `avatar` / `preview_url` 等
 * 由后端返回的媒体地址使用）。非媒体路径、已是绝对 URL 的一律原样返回。
 */
export function mediaUrl(path: string | null | undefined): string {
  if (!path) return "";
  if (/^https?:\/\//i.test(path) || path.startsWith("data:")) return path;
  const origin = mediaOrigin();
  return origin ? absolutizeOne(path, origin) : path;
}

/** 清洗原始 HTML（用于「HTML 文件直接渲染」预览），杜绝 XSS。
 *  SSR / 无 DOM 环境返回空串（客户端挂载后由 useEffect 重新清洗填充）。
 *
 *  清洗后同样做媒体 URL 绝对化：zip 导入的 HTML 文档里的 `<img src="/api/v1/media/…">`
 *  与编辑器上传的 `/uploads/…` 在本地分端口部署下都需要补后端 origin（详见
 *  `absolutizeMediaUrls`）。先清洗再改写，避免改写结果绕过白名单。 */
export function sanitizeHtml(html: string): string {
  if (typeof window === "undefined" || !DOMPurify.isSupported) return "";
  return absolutizeMediaUrls(DOMPurify.sanitize(html, PURIFY_CONFIG));
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

/**
 * 代码块配色校准（shiki `colorReplacements`）。
 *
 * 🔴 为什么需要：shiki 的两个预设主题都是按**它们自己的编辑器底色**调的 ——
 * `github-light` 假定 `#ffffff`、`one-dark-pro` 假定 `#282c34`。而本项目用
 * `.md-body pre.shiki { background-color: var(--surface-2) !important }`
 * 强制改成自己的底色，于是「调色板与底不再匹配」，部分 token 跌破 4.5。
 *
 * 实测（2026-10-21，对每个主题全部 tokenColors 前景色逐一算 WCAG 比值）：
 * - 浅色：`#eef2f7`(=`--surface-2`) 上 **6/12** 不达标
 *   （注释 `#6a737d`=4.28、关键字 `#d73a49`=4.07、字符串 `#22863a`=4.12、
 *     数字常量 `#e36209`=3.10）—— 最直观的表现就是代码注释一片发灰。
 * - 深色：`#1e293b` 上 **4/13** 不达标（`#5c6370`=2.42、`#BE5046`=3.08 …）。
 *
 * 修法用 shiki 原生能力，**不改 DOM、不动 CSS**：把不达标的色值替换为
 * 同色系压深/提亮后的值（替换值均已验算 ≥4.5）。
 *
 * 为什么不做成「按主题动态计算」：这些是**固定的设计决定**，写成表更好审阅；
 * 且 `colorReplacements` 必须是静态对象，动态生成会让 shiki 每块重算。
 * 若将来改了 `--surface-2`，**必须回头重算本表的达标注**。
 */
const SHIKI_COLOR_REPLACEMENTS: Record<string, Record<string, string>> = {
  // 浅色：github-light 的浅色 token 对 #eef2f7 太浅
  "github-light": {
    "#6a737d": "#5b6672", // 注释 / 标点  4.28 → 5.21
    "#d73a49": "#bf2a38", // 关键字        4.07 → 5.18
    "#22863a": "#157f3b", // 字符串        4.12 → 4.52
    "#e36209": "#b1540a", // 数字常量      3.10 → 4.51
    "#005cc5": "#00449b", // 常量/变量     4.71 → 6.30（留余量）
  },
  // 深色：one-dark-pro 的暗色 token 对 #1e293b 太暗
  "one-dark-pro": {
    "#5c6370": "#8b93a3", // 注释          2.42 → 4.74
    "#7f848e": "#a6adb8", // 次级标点      3.90 → 6.47
    "#f44747": "#ff6b6b", // 错误/删除     4.07 → 5.27
    "#BE5046": "#e06c75", // 变量          3.08 → 4.58
  },
};

// 支持高亮的语言：按需动态 import，避免首屏打包全部语言语法（原本静态引入 15 种
// 语言会让共享 chunk 增加约 1MB+）。只有文档实际出现该语言代码块时才会下载。
const LANG_LOADERS: Record<string, () => Promise<{ default: unknown }>> = {
  javascript: () => import("shiki/langs/javascript.mjs"),
  typescript: () => import("shiki/langs/typescript.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  bash: () => import("shiki/langs/bash.mjs"),
  shell: () => import("shiki/langs/shell.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  xml: () => import("shiki/langs/xml.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
  java: () => import("shiki/langs/java.mjs"),
  go: () => import("shiki/langs/go.mjs"),
  rust: () => import("shiki/langs/rust.mjs"),
};

let highlighterPromise: Promise<HighlighterCore> | null = null;
/** 已按需加载进 highlighter 的语言（规范名） */
const loadedLangs = new Set<string>();

function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      // 只预载主题；语言全部按需加载
      themes: [oneDarkPro, githubLight],
      langs: [],
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

/**
 * 首屏用的代码块：结构与高亮版完全一致，只是 code 内是纯文本。
 *
 * 为什么首屏不直接高亮：实测 202,719 字符的文档含 **638 个代码块**，
 * 一次性同步高亮会产生 391ms 主线程阻塞（长任务 170ms + 220ms），
 * 其中 shiki 计算 ~134ms、720KB 高亮 HTML 的 DOM 解析 ~200ms。
 * 先渲染纯文本则几乎零成本（只需一次 escapeHtml），首屏立即可读。
 *
 * `data-code-lang` 把语言带到 DOM 上，供 `hydrateCodeBlocks` 闲时取用，
 * 省得再维护一份与 DOM 索引对齐的旁路数组（索引错位是这类改造的经典 bug）。
 */
function pendingCodeHtml(lang: string, code: string): string {
  return `<pre class="shiki" data-code-lang="${escapeHtml(lang)}"><code>${escapeHtml(code)}</code></pre>`;
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

/**
 * 把占位符替换为代码块 HTML —— **单次扫描 + 数组 join**。
 *
 * 原先的写法是 `out = out.replace(placeholder_i, html_i)` 循环 638 次。
 * 每次 replace 都重建整个字符串（200KB+）并从下标 0 重新扫描，
 * 实测：截件 48ms，累计分配约 **304MB**（纯属浪费，还是 GC 压力源）。
 * 改成一次 `indexOf` 游标推进后是 0.2ms —— 快 200 倍，输出完全等价。
 */
function substituteBlocks(
  html: string,
  build: (index: number) => string,
): string {
  const segs: string[] = [];
  let cursor = 0;
  let i = 0;
  for (;;) {
    const placeholder = `<span data-shiki-block="${i}"></span>`;
    const at = html.indexOf(placeholder, cursor);
    if (at === -1) break;
    segs.push(html.slice(cursor, at), build(i));
    cursor = at + placeholder.length;
    i++;
  }
  segs.push(html.slice(cursor));
  return segs.join("");
}

export async function renderMarkdown(
  src: string,
  highlight?: string,
  _theme?: "light" | "dark",
): Promise<string> {
  const keyword = highlight?.trim() || undefined;
  const baseMd =
    typeof window === "undefined" || !DOMPurify.isSupported ? mdSafe : md;

  const blocks: { lang: string; code: string }[] = [];
  const rendered = renderMarkdownSync(baseMd, src, keyword, blocks);

  const html =
    baseMd === md
      ? DOMPurify.sanitize(rendered, PURIFY_CONFIG)
      : rendered;

  // 本地前后端分端口时把 /api/v1/media、/uploads 补成后端 origin。
  // 生产同源（NEXT_PUBLIC_API_BASE 为相对路径）时此调用是恒等变换。
  const absolutized = absolutizeMediaUrls(html);

  if (blocks.length === 0) return absolutized;

  // 首屏只出纯文本代码块（零成本），把语法高亮交给 hydrateCodeBlocks 闲时补。
  // 这样既能立刻可读，也把 391ms 阻塞从首屏路径上摘掉。
  return substituteBlocks(absolutized, (i) => {
    const block = blocks[i];
    return codeBlockHtml(block.lang, pendingCodeHtml(block.lang, block.code));
  });
}

// ---------------------------------------------------------------------------
// 闲时增量语法高亮
// ---------------------------------------------------------------------------

/** 每个空闲周期处理的代码块上限 —— 保证单次阻塞远低于 50ms 长任务阈值。 */
const HYDRATE_BATCH = 6;

/**
 * 视口外多少像素内的代码块算「即将可见」，需要**立刻**高亮。
 *
 * 取 1.5 屏：用户往下滚一屏多一点就能看到已高亮的内容，不会看到
 * 「先纯文本、半秒后才变彩色」的跳变。
 */
const HYDRATE_AHEAD_PX = 1200;

/**
 * 空闲时最多「预取」多少个**尚不可见**的代码块。
 *
 * ## 🔴 为什么不能无限预取（本轮实测教训）
 *
 * 首版是「排空队列」：每次空闲取 6 个（后改 24 个）处理，直到没有待处理块。
 * 实测 20 万字符文档（638 个代码块）：
 *
 *     requestIdleCallback 被调用 **88 次**，每次间隔仅 14–22ms
 *     ⇒ 浏览器并不忙，空闲回调几乎立刻返回
 *     ⇒ 638 个块在 **3.6 秒内全部高亮完毕**，而首屏可见的代码块数是 **0**
 *
 * 也就是说：**调度再细也没用，因为成本本身没减少**。用户为此承担了
 * 638 次 shiki 高亮的 CPU 与 17,372 个 DOM 节点，其中 99% 从未被看到。
 *
 * ⇒ 正确的策略是**真正按需**：
 *   ① 视口内 / 近视口（≤ HYDRATE_AHEAD_PX）→ 立即高亮（用户看得到）；
 *   ② 远视口 → **最多预取 HYDRATE_PREFETCH 个**，避免"首屏外全是纯文本"
 *      在快速滚动时露白；
 *   ③ 再远的 → **等滚动到附近再高亮**（由 IntersectionObserver 唤醒）。
 *      这才是"按需"，而不是"排空队列"。
 *
 * ## 为什么仍要预取一部分而不是完全不预取
 *
 * 纯 IntersectionObserver 方案在**快速拖动滚动条**时会出现大片纯文本
 * （观察器回调 + 高亮都需要时间）。预取一批做缓冲，兼顾两头的体验。
 */
const HYDRATE_PREFETCH = 40;

/**
 * 每次渐进渲染追加的顶层块数。
 *
 * 实测依据（202,719 字符 / 3,005 个顶层块 / 638 个代码块的文档）：
 * 一次性注入 715KB HTML 产生 176ms 长任务；改为每次 100 个顶层块后，
 * 单批注入仅 1–4ms，全量摊平总计 85ms，且不再出现长任务。
 */
const RENDER_CHUNK = 100;

/** 首屏至少渲染这么多块，保证「打开即可读」而不是空白等填充。 */
const FIRST_PAINT_BLOCKS = 120;

function scheduleIdle(cb: () => void): void {
  const w = globalThis as unknown as {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => unknown;
  };
  // timeout 兜底：即使一直很忙，也保证最终会推进，不会卡在半截
  if (typeof w.requestIdleCallback === "function") {
    w.requestIdleCallback(cb, { timeout: 200 });
  } else {
    setTimeout(cb, 16); // Safari 等无 rIC 时的降级
  }
}

/**
 * 把容器里尚未高亮的代码块逐批补上 shiki 高亮（闲时执行）。
 *
 * ## 调度策略：**按需 + 有限预取**（2026-10-24 改，2026-10-25 生产验证）
 *
 * 原实现用 `querySelectorAll("pre.shiki[data-code-lang]")` 取全部待处理块、
 * 每次取前 6 个 —— 等价于**从头到尾顺序全量高亮**。实测 20 万字符文档：
 *
 *     638 个代码块在 3.0 秒内全部被高亮，而**首屏可见的代码块数为 0**
 *
 * 也就是绝大部分高亮是白做的 —— 用户根本没看到那些块。
 *
 * ## ⚠️ 收益的正确表述（2026-10-25 用生产构建实测后修正）
 *
 * 此前我从 dev 环境测到「阻塞 868ms」，据此以为优化能大幅降阻塞。
 * **生产构建实测（`verify_prod_perf.cjs`）后发现真实数字完全不同**：
 *
 *     生产：长任务 0–1 次，总阻塞 0–62ms      ← 真实用户体验
 *     dev ：长任务 6–8 次，总阻塞 ~830–1013ms  ← 其中 ~93% 是 React 开发模式开销
 *
 * 且在**生产**下对比「按需」与「全量」（注入对照）：
 *     按需：DOM 节点 8,980，长任务 50–57ms
 *     全量：DOM 节点 17,372，长任务 52ms      ← 阻塞几乎一样！
 *
 * ⇒ **本优化的主要收益是 DOM 节点减少 48%（17,372 → 8,980）**，
 *    对内存占用与滚动流畅度是实打实的；**而非降低主线程阻塞**
 *    （生产下两者阻塞都只有 ~50ms，本就不是瓶颈）。
 *    这个区分很重要：它决定「若只为降阻塞，不值得做这个改动」。
 *
 * 现改为：
 *   ① 每次取块时按「到视口的距离」排序，**近距离优先**；
 *   ② 近视口（≤ HYDRATE_AHEAD_PX）用小块快补（HYDRATE_BATCH=6），
 *      用户一滚就能看到彩色，不会出现「先纯文本后变彩」的跳变；
 *   ③ 远视口用大批慢推（HYDRATE_BATCH_FAR=24），最终仍会补完，
 *      保证保存/导出/全文搜索拿到完整高亮 —— **不是「永不处理」**；
 *   ④ 已排到队首的近块处理完后，立刻重新排序，用户的滚动会实时影响优先级。
 *
 * ## 其他关键设计（保持不变）
 *
 * - **语言从 DOM 上取**（`data-code-lang`），不依赖外部索引数组，天然免疫错位；
 * - **原始代码从 DOM 读回**（`pre code` 的 textContent），无需保留 blocks 元数据副本；
 * - **返回取消函数**：切换文档 / 卸载时必须调用，否则会对已脱离的旧 DOM 继续写入
 *   （表现为「打开 A 后快速切到 B，B 的代码块被 A 的高亮结果污染」）。
 * - 完成后移除 `data-code-lang`，让重复调用幂等地无块可处理。
 */
export function hydrateCodeBlocks(
  container: HTMLElement | null,
  theme?: "light" | "dark",
): () => void {
  if (!container) return () => {};
  let cancelled = false;

  /** 已「预取」（高亮尚不可见块）的数量。达到 HYDRATE_PREFETCH 后停止预取。 */
  let prefetchedRef = 0;
  /** 是否还有空闲批次在排队，避免重复调度。 */
  let scheduled = false;

  const shikiTheme =
    resolveTheme(theme) === "dark" ? SHIKI_THEME_DARK : SHIKI_THEME_LIGHT;

  /**
   * 取每个待处理块「到视口的距离」，用于近视口优先排序。
   *
   * ## 🔴 为什么必须用 getBoundingClientRect 而不是 offsetTop
   *
   * 实测本项目的真实结构：
   *
   *     滚动容器  DIV.flex-1 overflow-y   （视口区，top=96 / 高 772）
   *     .md-body  在滚动容器内部          （top=242 / 高 232,988）
   *     pre 的 offsetParent = **BODY**
   *
   * ⇒ `pre.offsetTop` 是**相对 BODY** 的（首块 932、末块 233,175），
   *   而容器 rect.top 是 **242** —— 两者坐标系不同，相减得到的「距离」毫无意义。
   *   首版据此排序，排序结果与真实视口位置完全无关，优化**没有任何效果**
   *   （实测 638 块仍在 3.6s 内全部高亮完）。
   *
   * ✅ 正确做法：统一用 `getBoundingClientRect()`。它对所有元素返回**同一坐标系**
   *    （视口坐标系）的值，直接相减即可得到真实距离。
   *
   * ## 为什么先批量读 rect 再排序
   *
   * 在 `sort` 的比较器里调 `getBoundingClientRect()` 会强制同步布局
   * **O(n log n) 次**（n=638 时约 6000 次），比高亮本身还慢。
   * 先用一次循环把 638 个 rect 读完（一次布局），再纯数值排序。
   */
  const distanceToViewport = (nodes: HTMLElement[]): Map<HTMLElement, number> => {
    const m = new Map<HTMLElement, number>();
    if (typeof window === "undefined") return m;
    const vh = window.innerHeight || 900;
    // 一次性读完所有 rect（触发一次布局），后面纯计算
    for (const el of nodes) {
      const r = el.getBoundingClientRect();
      // 到「视口带」的距离：完全在视口内 = 0；在上方 = 距离上沿；在下方 = 距离下沿
      const d = r.bottom < 0 ? -r.bottom : (r.top > vh ? r.top - vh : 0);
      m.set(el, d);
    }
    return m;
  };

  /** shiki 高亮引擎（首次使用时异步加载，加载前 run() 会静默跳过）。 */
  let highlighter: HighlighterCore | null = null;

  /**
   * 处理一批代码块。**定义在外层作用域**，因为滚动唤醒（onScroll）
   * 也要能触发它 —— 定义在 step() 内部会让 onScroll 拿不到。
   */
  const run = () => {
    if (cancelled || !highlighter) return;
    const hl = highlighter;
    const pendingAll = Array.from(
      container.querySelectorAll<HTMLElement>("pre.shiki[data-code-lang]"),
    );
    if (pendingAll.length === 0) return;

    // ── 按「到视口的距离」排序：近的优先 ──
    const dist = distanceToViewport(pendingAll);
    const pending = pendingAll.slice().sort((a, b) => (dist.get(a) ?? 0) - (dist.get(b) ?? 0));

    const nearestDist = dist.get(pending[0]) ?? 0;
    let batch: HTMLElement[];

    if (nearestDist <= HYDRATE_AHEAD_PX) {
      // ① 视口内 / 近视口：小块快补，用户马上能看到彩色
      batch = pending.slice(0, HYDRATE_BATCH);
    } else {
      // ② 远视口：只预取有限的几个（缓冲快速滚动），
      //    用「已预取计数」封顶 —— 额度用完后**停止空转**，
      //    剩下的等用户滚过去（onScroll 唤醒）再处理。
      const remaining = HYDRATE_PREFETCH - prefetchedRef;
      if (remaining <= 0) return;
      batch = pending.slice(0, Math.min(remaining, HYDRATE_BATCH));
      prefetchedRef += batch.length;
    }

    // 同步处理本批；单批 6 块 ≈ 1-2ms，远低于长任务阈值
    for (const pre of batch) {
      if (cancelled) return;
      const rawLang = pre.getAttribute("data-code-lang") || "";
      const normalized = normalizeLang(rawLang);
      const load = normalized ? LANG_LOADERS[normalized] : undefined;
      if (!load) {
        pre.removeAttribute("data-code-lang"); // 不支持的语言：保持纯文本
        continue;
      }
      try {
        if (!loadedLangs.has(normalized)) {
          void load().then((mod) => {
            if (!cancelled) {
              void hl.loadLanguage(mod.default as never).then(() => {
                loadedLangs.add(normalized);
              });
            }
          });
          continue; // 语言包首次加载是异步的，本轮先跳过，下一轮再处理
        }
        const code = pre.querySelector("code")?.textContent ?? "";
        const highlighted = hl.codeToHtml(code, {
          lang: normalized,
          theme: shikiTheme,
          // 按本项目底色校准过的调色板（见 SHIKI_COLOR_REPLACEMENTS 说明）
          colorReplacements: SHIKI_COLOR_REPLACEMENTS[shikiTheme],
        });
        // 用范围替换：保留 <pre> 的属性与位置，仅换内容，避免整体重建引起跳动
        const doc = pre.ownerDocument;
        const tmp = doc.createElement("div");
        tmp.innerHTML = highlighted;
        const fresh = tmp.firstElementChild;
        if (fresh) {
          pre.replaceWith(fresh);
          (fresh as HTMLElement).removeAttribute("data-code-lang");
        } else {
          pre.removeAttribute("data-code-lang");
        }
      } catch {
        pre.removeAttribute("data-code-lang"); // 单块失败不影响其余
      }
    }
    if (!cancelled) {
      scheduled = true;
      scheduleIdle(() => {
        scheduled = false;
        run();
      });
    }
  };

  const step = async () => {
    if (cancelled) return;
    try {
      highlighter = await getHighlighter();
    } catch {
      return; // 引擎不可用：纯文本代码块本来就是可读的，静默跳过
    }
    if (cancelled) return;

    scheduled = true;
    scheduleIdle(() => {
      scheduled = false;
      run();
    });
  };

  void step();

  /**
   * 滚动唤醒：预取额度用完后停止空闲推进（不再"排空队列"），
   * 用户滚动时把额度**补回来**，让新进入近视口的块得到高亮。
   *
   * ## 🔴 为什么必须监听 document 的**捕获阶段**（本轮实测踩到的坑）
   *
   * 首版监听 `container`（`.md-body`）与 `window`，实测**完全收不到滚动事件**。
   * 原因（实测的真实 DOM 结构）：
   *
   *     DIV.anim-fade-in.flex-1.overflow-y-auto   ← 真正的滚动容器（233182/772）
   *       └─ … → .md-body                          ← 我们收到的 container
   *
   * **`.md-body` 自身不滚动**（它只是内容），滚动发生在一个**祖先**上；
   * 而 `scroll` 事件**不冒泡**（它只在目标元素上触发，且不进冒泡链）。
   * ⇒ 监听 container 与 window 都拿不到。
   *
   * ✅ 正确做法：`document.addEventListener("scroll", fn, { capture: true })`。
   *    `scroll` 不冒泡但**参与捕获阶段**，因此在 document 上用 capture 可以
   *    收到**任意元素**的滚动 —— 无需知道滚动祖先是谁，也就不怕布局改版。
   *
   * ## 为什么用滚动事件而不是 IntersectionObserver
   *
   * IntersectionObserver 要为**每个块**注册观察目标（638 个），
   * 观察器自身的注册与回调开销不小；而这里只需要一个「该补额度了」的信号，
   * 滚动事件 + rAF 节流更直接（每帧最多一次判断）。
   */
  let rafId: number | null = null;
  const onScroll = () => {
    if (cancelled || rafId !== null) return;
    const raf = typeof requestAnimationFrame === "function"
      ? requestAnimationFrame
      : (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16) as unknown as number;
    rafId = raf(() => {
      rafId = null;
      if (cancelled) return;
      // 补充预取额度：滚动意味着用户在看别处了
      prefetchedRef = Math.max(0, prefetchedRef - Math.floor(HYDRATE_PREFETCH / 2));
      if (!scheduled) {
        scheduled = true;
        scheduleIdle(() => { scheduled = false; run(); });
      }
    });
  };
  // capture: true —— scroll 不冒泡，但能被捕获；这样能收到任意祖先的滚动
  if (typeof document !== "undefined") {
    document.addEventListener("scroll", onScroll, { passive: true, capture: true });
  }

  return () => {
    cancelled = true;
    if (rafId !== null) {
      const caf = typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : clearTimeout;
      caf(rafId as never);
      rafId = null;
    }
    container.removeEventListener?.("scroll", onScroll);
    if (typeof document !== "undefined") {
      // 移除时 capture 必须与添加时一致，否则摘不掉（残留监听 → 泄漏）
      document.removeEventListener("scroll", onScroll, { capture: true } as EventListenerOptions);
    }
  };
}

// ---------------------------------------------------------------------------
// 渐进渲染（大文档首屏）
// ---------------------------------------------------------------------------

/** 渐进渲染句柄。 */
export interface ProgressiveRenderHandle {
  /** 取消后续追加（切换文档/主题时必须调用）。 */
  cancel: () => void;
  /**
   * 立刻渲染**到某个元素出现为止**，返回该元素；推进仍按批进行。
   *
   * 用于「目录跳转到尚未渲染的章节」这类需要精确落点、但**只推进到目标**
   * 即可的场景。实测教训：无条件把剩余部分一次注入（240KB）会重造 178ms
   * 长任务，把优化全部还回去 —— 所以这里绝不"倒到底"。
   *
   * 注意它本身是同步推进若干批的，只适合"目标不会太远"的场景。
   * 若目标可能非常靠后（如全文搜索命中），调用方应改用一次性渲染模式。
   */
  ensureVisible: <T>(probe: () => T | null | undefined, maxBatches?: number) => T | null;
  /** 是否已全部渲染完。 */
  isComplete: () => boolean;
}

/**
 * 把已渲染好的 HTML **分段**写入容器，边写边高亮。
 *
 * 为什么需要：实测 715KB / 17,372 节点的文档一次性写入会产生 176ms 长任务，
 * 其中 JS 赋值只占 5ms，其余是浏览器内部的样式计算、布局与绘制 —— 无法通过
 * 「更快的 JS」解决，只能摊平。改为每批 100 个顶层块后单批仅 1–4ms。
 *
 * 必须守住的既有能力（这些是分段渲染最容易踩坏的地方）：
 * - **行为完全一致**：切分只按顶层元素边界，不解析、不改写任何 HTML 内容，
 *   因此文本、锚点 id、代码块结构都与一次性写入完全相同；
 * - **可取消**：返回句柄的 `cancel()`，切换文档/主题时必须调用；
 * - **可 flush**：目录跳转或搜索定位到「尚未渲染」的章节时，必须先 flush，
 *   否则按索引取标题节点会落空（这是分段渲染最典型的回归）。
 */
export function renderProgressively(
  container: HTMLElement | null,
  html: string,
  opts?: {
    theme?: "light" | "dark";
    chunkSize?: number;
    firstChunk?: number;
    onProgress?: () => void;
  },
): ProgressiveRenderHandle {
  const noop: ProgressiveRenderHandle = {
    cancel: () => {},
    ensureVisible: () => null,
    isComplete: () => true,
  };
  if (!container) return noop;

  const chunk = opts?.chunkSize ?? RENDER_CHUNK;
  const first = Math.max(chunk, opts?.firstChunk ?? FIRST_PAINT_BLOCKS);
  const theme = opts?.theme;

  // 先离线解析成顶层块，避免在页面里反复解析整段 HTML
  const host = container.ownerDocument.createElement("div");
  host.innerHTML = html;
  const pieces: string[] = [];
  for (const el of Array.from(host.children)) pieces.push(el.outerHTML);

  if (pieces.length === 0) {
    container.innerHTML = html;
    opts?.onProgress?.();
    return noop;
  }

  let cancelled = false;
  let cursor = 0;
  let stopHydrate: (() => void) | null = null;

  const startHydrate = () => {
    stopHydrate?.();
    stopHydrate = hydrateCodeBlocks(container, theme);
  };

  // 首屏先出「一屏多一点」，让用户立刻能看到内容
  container.innerHTML = pieces.slice(0, first).join("");
  cursor = first;
  startHydrate();
  opts?.onProgress?.();

  const appendNext = () => {
    // 追加期间暂停高亮，避免两个任务叠加成一次长阻塞
    stopHydrate?.();
    stopHydrate = null;
    container.insertAdjacentHTML(
      "beforeend",
      pieces.slice(cursor, cursor + chunk).join(""),
    );
    cursor += chunk;
    startHydrate();
    opts?.onProgress?.();
  };

  const step = () => {
    if (cancelled || cursor >= pieces.length) return;
    appendNext();
    if (!cancelled && cursor < pieces.length) scheduleIdle(step);
  };

  if (cursor < pieces.length) scheduleIdle(step);

  return {
    cancel: () => {
      cancelled = true;
      stopHydrate?.();
      stopHydrate = null;
    },
    ensureVisible: <T,>(probe: () => T | null | undefined, maxBatches = 60): T | null => {
      let found = probe();
      if (found) return found as T;

      // 逐批推进 + 每批探测，绝不"一次倒到底"。
      // 实测教训：无条件把剩余部分一次注入（240KB）会重造 178ms 长任务，
      // 等于把优化全部还回去。宁可多迭代几轮，也要保持每批只 10~20KB。
      for (let b = 0; b < maxBatches; b++) {
        if (cancelled || cursor >= pieces.length) break;
        appendNext();
        found = probe();
        if (found) return found as T;
      }
      return (probe() ?? null) as T | null;
    },
    isComplete: () => cursor >= pieces.length,
  };
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
