/**
 * 划词批注锚点：定位、高亮、降级（P2-4）。
 *
 * 设计取舍：**不存绝对字符偏移**。
 * 正文随时会被编辑，偏移必然失效；存「引用文本 + 前后上下文快照 + 第几次出现」
 * 才能在改文后回退定位，彻底找不到时降级为「未锚定」而不是静默丢失高亮。
 *
 * 定位与写入共用同一套「DOM 文本索引」（buildTextIndex），
 * 这是刻意的：若写入侧用 selection.toString()、定位侧用另一套拼接规则，
 * 两端文本模型不一致 → 上下文快照永远对不上 → 锚定率凭空掉一截。
 */

export interface CommentAnchor {
  /** 引用文本之前的上下文快照（最多 32 字） */
  prefix: string;
  /** 引用文本之后的上下文快照（最多 32 字） */
  suffix: string;
  /** 引用文本在正文中的第几次出现（从 0 起），用于消歧重复片段 */
  index: number;
}

export interface AnchorTarget {
  commentId: string;
  quote: string;
  anchor: CommentAnchor | null;
}

export interface ApplyResult {
  /** 成功渲染出高亮的评论 id */
  resolved: string[];
  /** 定位失败、应显示「未锚定」的评论 id */
  orphan: string[];
}

/** 上下文快照长度 */
const CTX = 32;
/** 回退定位时允许的最大跨度：超过就认为正文改动过大，不再猜 */
const FALLBACK_MAX_SPAN = 400;
/** 单个锚点最多允许高亮的字符数（防整篇被涂黄） */
const MAX_QUOTE_LEN = 600;

export const ANCHOR_MARK_CLASS = "comment-anchor";
export const ANCHOR_FLASH_CLASS = "comment-anchor-flash";

/** 块级容器：跨块之间插入一个换行，避免相邻两段的文字被拼成连续串 */
const BLOCK_SELECTOR =
  "p,li,h1,h2,h3,h4,h5,h6,td,th,blockquote,pre,figcaption,div";

interface Segment {
  node: Text | null;
  /** 该节点在全文中的起始/结束偏移 */
  start: number;
  end: number;
}

interface TextIndex {
  text: string;
  segments: Segment[];
}

function blockOf(node: Node, container: HTMLElement): Element | null {
  let cur: Node | null = node;
  while (cur && cur !== container) {
    if (cur.nodeType === Node.ELEMENT_NODE) {
      const el = cur as Element;
      if (el.matches(BLOCK_SELECTOR)) return el;
    }
    cur = cur.parentNode;
  }
  return null;
}

/**
 * 构建「容器纯文本 ↔ 文本节点」双向索引。
 *
 * 跳过：script/style；已在高亮 mark 内的节点（避免嵌套包裹）。
 * 跨块插入 "\n" 作为分隔（它占据 1 个偏移但不属于任何 Segment，
 * 因此永远不会被包裹）。
 */
export function buildTextIndex(container: HTMLElement): TextIndex {
  const text: string[] = [];
  const segments: Segment[] = [];
  let offset = 0;
  let prevBlock: Element | null = null;

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      const tag = parent.tagName;
      if (tag === "SCRIPT" || tag === "STYLE") return NodeFilter.FILTER_REJECT;
      // 已在 mark 内：说明上一次已包过，跳过以免嵌套
      if (parent.closest(`.${ANCHOR_MARK_CLASS}`)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let n = walker.nextNode();
  while (n) {
    const node = n as Text;
    const value = node.nodeValue ?? "";
    const block = blockOf(node, container);
    if (prevBlock !== null && block !== prevBlock) {
      text.push("\n");
      offset += 1;
    }
    prevBlock = block;
    segments.push({ node, start: offset, end: offset + value.length });
    text.push(value);
    offset += value.length;
    n = walker.nextNode();
  }
  return { text: text.join(""), segments };
}

/** 列出 quote 在 text 中的全部出现位置 */
function occurrences(text: string, quote: string): number[] {
  if (!quote) return [];
  const out: number[] = [];
  let i = text.indexOf(quote);
  while (i !== -1) {
    out.push(i);
    i = text.indexOf(quote, i + 1);
    // 同一位置可能重复（空串已排除），防御死循环
    if (out.length > 500) break;
  }
  return out;
}

/**
 * 在一个文本节点区间上打标。
 *
 * splitText 会把原节点切成三段；为让后续锚点仍能使用同一份索引，
 * 这里把 Segment 就地更新为「剩余未包裹的那一段」。
 */
function wrapRange(
  seg: Segment,
  from: number,
  to: number,
  commentId: string,
): void {
  const node = seg.node;
  if (!node) return;
  const a = Math.max(from, seg.start) - seg.start;
  const b = Math.min(to, seg.end) - seg.start;
  if (b <= a) return;

  // tail 覆盖 [a, seg.end)；rest 覆盖 [b, seg.end)
  const tail = a > 0 ? node.splitText(a) : node;
  const rest = b - a < (tail.nodeValue?.length ?? 0) ? tail.splitText(b - a) : null;

  const mark = document.createElement("mark");
  mark.className = ANCHOR_MARK_CLASS;
  mark.dataset.commentId = commentId;
  tail.parentNode?.insertBefore(mark, tail);
  mark.appendChild(tail);

  // 索引推进到剩余段；没有剩余就置空，后续锚点自然跳过
  seg.node = rest;
  seg.start = seg.start + b;
}

/**
 * 按锚点在正文里定位区间 [from, to)。
 * 返回 null 表示彻底定位不到（调用方降级为「未锚定」）。
 */
export function resolveRange(
  index: TextIndex,
  quote: string,
  anchor: CommentAnchor | null,
): { from: number; to: number } | null {
  const q = (quote || "").slice(0, MAX_QUOTE_LEN);
  if (!q) return null;
  const { text } = index;

  const hits = occurrences(text, q);
  if (hits.length === 0) {
    return fallbackByContext(index, anchor);
  }
  if (hits.length === 1) return { from: hits[0], to: hits[0] + q.length };

  // 多次出现：按上下文打分，优先「前后都对得上」
  const prefix = anchor?.prefix ?? "";
  const suffix = anchor?.suffix ?? "";
  let best: { i: number; score: number } | null = null;
  for (const i of hits) {
    let score = 0;
    if (prefix && text.slice(Math.max(0, i - prefix.length), i) === prefix) score += 2;
    if (suffix && text.slice(i + q.length, i + q.length + suffix.length) === suffix) score += 2;
    if (!best || score > best.score) best = { i, score };
    if (score === 4) break;
  }
  // 上下文全都对不上时，退回「第 index 次出现」
  if (best && best.score === 0 && anchor && anchor.index >= 0 && anchor.index < hits.length) {
    return { from: hits[anchor.index], to: hits[anchor.index] + q.length };
  }
  const i = best ? best.i : hits[0];
  return { from: i, to: i + q.length };
}

/**
 * 回退定位：引用文本已被改写、找不到了，改用前后上下文夹逼出原位置。
 * 只在跨度合理时采用 —— 否则宁可判为未锚定，也不要乱涂一片。
 */
function fallbackByContext(
  index: TextIndex,
  anchor: CommentAnchor | null,
): { from: number; to: number } | null {
  if (!anchor) return null;
  const { text } = index;
  const { prefix, suffix } = anchor;
  if (!prefix || !suffix) return null;
  const p = text.indexOf(prefix);
  if (p === -1) return null;
  const from = p + prefix.length;
  const s = text.indexOf(suffix, from);
  if (s === -1) return null;
  if (s - from > FALLBACK_MAX_SPAN) return null;
  return { from, to: s };
}

/**
 * 在容器上渲染全部批注高亮。
 *
 * 幂等：每次都先 unwrap 再重包，可反复调用（渐进渲染、主题切换、
 * 评论增删都会触发重放）。
 */
export function applyAnchors(
  container: HTMLElement,
  targets: AnchorTarget[],
): ApplyResult {
  const result: ApplyResult = { resolved: [], orphan: [] };
  unwrapAnchors(container);
  if (!targets.length) return result;

  const index = buildTextIndex(container);
  const ranges: { id: string; from: number; to: number }[] = [];
  for (const t of targets) {
    const r = resolveRange(index, t.quote, t.anchor);
    if (r) ranges.push({ id: t.commentId, ...r });
    else result.orphan.push(t.commentId);
  }
  // 升序包裹：配合 wrapRange 就地推进索引，保证同一节点上的多个锚点互不踩踏
  ranges.sort((a, b) => a.from - b.from);

  for (const r of ranges) {
    let touched = false;
    for (const seg of index.segments) {
      if (seg.start >= r.to) break;
      if (!seg.node) continue; // 已被前一个锚点消耗完
      if (seg.end <= r.from) continue;
      wrapRange(seg, r.from, r.to, r.id);
      touched = true;
    }
    if (touched) result.resolved.push(r.id);
    else result.orphan.push(r.id);
  }
  return result;
}

/** 撤掉全部高亮并复原文本节点（applyAnchors 的前置步骤，也可单独调用） */
export function unwrapAnchors(container: HTMLElement): number {
  const marks = Array.from(
    container.querySelectorAll<HTMLElement>(`mark.${ANCHOR_MARK_CLASS}`),
  );
  for (const mark of marks) {
    const parent = mark.parentNode;
    if (!parent) continue;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  }
  return marks.length;
}

/**
 * 划词时采集锚点。
 *
 * 必须用与定位侧同一份索引来算 prefix/suffix/index，否则上下文对不上。
 * range 端点不是文本节点（极少数拖选情形）时降级为「按文本首现」。
 */
export function captureAnchor(
  container: HTMLElement,
  range: Range,
): { quote: string; prefix: string; suffix: string; index: number } | null {
  const index = buildTextIndex(container);
  const { text, segments } = index;

  const offsetOf = (node: Node, nodeOffset: number): number | null => {
    for (const seg of segments) {
      if (seg.node === node) return seg.start + nodeOffset;
    }
    return null;
  };

  let from: number | null = null;
  let to: number | null = null;
  if (range.startContainer.nodeType === Node.TEXT_NODE) {
    from = offsetOf(range.startContainer, range.startOffset);
  }
  if (range.endContainer.nodeType === Node.TEXT_NODE) {
    to = offsetOf(range.endContainer, range.endOffset);
  }
  if (from === null || to === null) {
    const q = range.toString().trim();
    const i = q ? text.indexOf(q) : -1;
    if (i === -1) return null;
    from = i;
    to = i + q.length;
  }
  if (to <= from) return null;

  const quote = text.slice(from, to).slice(0, MAX_QUOTE_LEN);
  if (!quote.trim()) return null;

  const before = text.slice(0, from);
  return {
    quote,
    prefix: text.slice(Math.max(0, from - CTX), from),
    suffix: text.slice(to, to + CTX),
    index: occurrences(before, quote).length,
  };
}

/** 定位到某条批注：滚动到首个标记并闪烁一下（点评论 → 定位正文） */
export function flashAnchor(container: HTMLElement, commentId: string): boolean {
  const marks = Array.from(
    container.querySelectorAll<HTMLElement>(
      `mark.${ANCHOR_MARK_CLASS}[data-comment-id="${cssEscape(commentId)}"]`,
    ),
  );
  if (!marks.length) return false;
  marks[0].scrollIntoView({ block: "center", behavior: "smooth" });
  for (const m of marks) m.classList.add(ANCHOR_FLASH_CLASS);
  window.setTimeout(() => {
    for (const m of marks) m.classList.remove(ANCHOR_FLASH_CLASS);
  }, 1200);
  return true;
}

function cssEscape(value: string): string {
  return value.replace(/["\\]/g, (c) => `\\${c}`);
}
