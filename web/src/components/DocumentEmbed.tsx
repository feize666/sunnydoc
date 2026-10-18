"use client";

import { useEffect, useMemo, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import {
  getDocument,
  listDocuments,
  updateDocument,
  RevisionConflictError,
  type DocDetail,
  type DocMeta,
} from "@/lib/api";
import { useToast } from "./Toast";
import {
  LazyTableEditor,
  LazyBoardEditor,
  LazyDatasheetEditor,
  LazyMindMapEditor,
  LazyFlowchartEditor,
  LazySlideEditor,
} from "./LazyEditors";
import { newSlideDocBody } from "@/lib/slideTemplates";
import { Tooltip } from "./Tooltip";

/**
 * 可嵌入正文的文档类型（P2-3 卡片嵌入）。
 *
 * 为什么只允许这几种：它们当前必须「新建一个独立文档」才能使用，
 * 实测数据里 241 篇文档中一条都没有 —— 不是没人需要，而是门槛太高。
 * 改成可在正文里随手插入后，使用成本降到接近零。
 *
 * 不含 `doc`：把整篇文档嵌进另一篇会形成无意义的递归。
 */
export const EMBEDDABLE_TYPES = [
  "table",
  "datasheet",
  "board",
  "mindmap",
  "flowchart",
  "slides",
] as const;

export type EmbeddableType = (typeof EMBEDDABLE_TYPES)[number];

const TYPE_LABEL: Record<string, string> = {
  table: "表格",
  datasheet: "数据表",
  board: "画板",
  mindmap: "思维导图",
  flowchart: "流程图",
  slides: "幻灯片",
};

/**
 * 各类型的**初始内容**与默认标题。
 *
 * ⚠️ 必须与 `page.tsx` 的 `handleNew` 逐字一致 —— 两处若不一致，
 * 会出现「从文件树新建」与「从卡片新建」得到不同初始结构的怪现象，
 * 而各编辑器的解析器对结构有假设（如思维导图要求 nodes 数组）。
 * 幻灯片的初始内容由 `@/lib/slideTemplates` 的 `newSlideDocBody()` 统一提供，
 * 两边调同一个函数，从根上避免漂移。
 */
export const NEW_DOC_TEMPLATE: Record<EmbeddableType, { title: string; body: string }> = {
  table: {
    title: "未命名表格",
    body: JSON.stringify([["", "", ""], ["", "", ""], ["", "", ""]]),
  },
  board: { title: "未命名画板", body: JSON.stringify([]) },
  datasheet: {
    title: "未命名数据表",
    body: JSON.stringify({ columns: ["字段 1", "字段 2"], rows: [["", ""], ["", ""]] }),
  },
  mindmap: {
    title: "未命名思维导图",
    body: JSON.stringify({ nodes: [{ id: "1", text: "中心主题", parent: null }] }),
  },
  flowchart: { title: "未命名流程图", body: JSON.stringify({ nodes: [], edges: [] }) },
  slides: { title: "未命名幻灯片", body: newSlideDocBody() },
};

/**
 * 按类型给出对应的懒加载编辑器。
 *
 * `readOnly` 由调用方决定：卡片默认只读，进入编辑态后才可写。
 * `onChange` 在只读时被忽略（各编辑器自身也会忽略）。
 */
function renderEmbedded(
  type: string | undefined,
  body: string,
  title: string,
  opts: { readOnly: boolean; onChange: (v: string) => void },
): React.ReactNode {
  const { readOnly, onChange } = opts;
  const common = { value: body, onChange, readOnly, title };
  switch (type) {
    case "table":
      return <LazyTableEditor {...common} />;
    case "datasheet":
      return <LazyDatasheetEditor {...common} />;
    case "board":
      return <LazyBoardEditor {...common} />;
    case "mindmap":
      return <LazyMindMapEditor {...common} />;
    case "flowchart":
      return <LazyFlowchartEditor {...common} />;
    case "slides":
      return <LazySlideEditor {...common} />;
    default:
      return null;
  }
}

/**
 * 卡片本体（编辑器 NodeView 与预览态静态挂载**共用同一份实现**）。
 *
 * 为什么必须共用：预览态走的是 `renderMarkdown` 产出的 HTML（不经过 ProseMirror），
 * 卡片在那里只剩一个空的 `<div data-doc-id>`。若把渲染逻辑写两遍，两态必然出现
 * 「编辑态能看、预览态空白」这类不一致 —— 而且改动只落到其中一处。
 *
 * **就地编辑（2026-10-12）**：
 * - 默认**只读**，点「编辑」才切到可写。理由：卡片内嵌的是完整编辑器，
 *   长期可写会让「改卡片 vs 改正文」的焦点归属变得含糊，也容易误触。
 * - 编辑结果写回**来源文档**（不是当前文档）—— 卡片只是引用，内容归属不变。
 *   保存带 `expectedRevision` 乐观锁：来源被别人改过则提示冲突，**绝不静默覆盖**。
 * - 预览态（分享页等无 `onEdit` 的场景）**永远只读**，不显示编辑按钮。
 *
 * @param docId 来源文档 id。渲染时按需拉取内容，**不存快照**（存快照会立刻过期）
 * @param onRemove 提供时才显示「移除卡片」按钮（编辑态才有意义，预览态没有）
 * @param onSaved 保存成功后回调（供主界面刷新标签页 / 目录）
 */
export function DocumentEmbedCard({
  docId,
  selected,
  onRemove,
  onSaved,
}: {
  docId: string;
  selected?: boolean;
  onRemove?: () => void;
  onSaved?: (id: string) => void;
}) {
  const [doc, setDoc] = useState<DocDetail | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "missing" | "error">("loading");
  /** 编辑态草稿；null = 未进入编辑 */
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  useEffect(() => {
    let cancelled = false;
    if (!docId) {
      setState("missing");
      return;
    }
    setState("loading");
    setDraft(null); // 换来源文档时丢弃上一份草稿，避免写到错误的文档上
    getDocument(docId)
      .then((d) => {
        if (cancelled) return;
        setDoc(d);
        setState("ok");
      })
      .catch(() => {
        if (!cancelled) setState("missing");
      });
    return () => {
      cancelled = true;
    };
  }, [docId]);

  const label = TYPE_LABEL[doc?.type ?? ""] ?? "文档";
  const editing = draft !== null;
  const dirty = editing && draft !== (doc?.text ?? "");
  // 只有「编辑态」的 NodeView 才允许改（预览态没传 onRemove）
  const canEdit = !!onRemove && state === "ok";

  const save = async () => {
    if (!doc || draft === null || saving) return;
    setSaving(true);
    try {
      // 乐观锁：带上拉取时的版本号。来源被他人改过 → 409，不覆盖
      const res = await updateDocument(doc.id, doc.title || "", draft, doc.revision ?? null);
      const next = { ...doc, text: draft, revision: res.revision ?? doc.revision };
      setDoc(next as DocDetail);
      setDraft(null);
      toast.success("卡片已保存");
      // 广播给主界面：来源文档可能正开在某个标签页里，那边的内容已经过期，
      // 需要重新拉取（否则用户切过去会看到旧内容并可能覆盖掉刚存的东西）。
      window.dispatchEvent(
        new CustomEvent("sunnydoc:doc-saved", { detail: { id: doc.id, fromEmbed: true } }),
      );
      onSaved?.(doc.id);
    } catch (e) {
      // 用专门的错误类型判定冲突，不用字符串匹配 —— 后者会把「网络失败」
      // 里偶然包含的 "409" 之类误判成冲突。
      if (e instanceof RevisionConflictError) {
        toast.error("来源文档已被修改，你的改动未覆盖对方内容（请刷新后重试）");
      } else {
        const msg = e instanceof Error ? e.message : "未知错误";
        toast.error(`保存失败：${msg}`);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className={`doc-embed-card${selected ? " is-selected" : ""}${editing ? " is-editing" : ""}`}
      // `data-embed-type` 只有拉到文档后才可知，所以放在卡片本体而非外层占位 div。
      // 编辑态与预览态都从这里读，两态取值一致。
      data-embed-type={doc?.type ?? ""}
      data-embed-editing={editing ? "true" : "false"}
      // 卡片内的点击不应把光标放进卡片（否则会以为能直接编辑正文）
      contentEditable={false}
    >
      <div className="doc-embed-head">
        <span className="doc-embed-badge">{label}</span>
        {state === "ok" && doc ? (
          <a
            className="doc-embed-title"
            href={`#embed-${doc.id}`}
            onClick={(e) => {
              e.preventDefault();
              // 交给外层应用处理跳转（避免这里耦合路由）
              window.dispatchEvent(
                new CustomEvent("sunnydoc:open-doc", { detail: { id: doc.id } }),
              );
            }}
            title="打开来源文档"
          >
            {doc.title || "未命名"}
          </a>
        ) : (
          <span className="doc-embed-title is-muted">
            {state === "loading" ? "加载中…" : "来源文档不存在"}
          </span>
        )}
        <span className="doc-embed-actions">
          {canEdit && !editing && (
            <Tooltip content="就地编辑（保存后写回来源文档）">
              <button
                type="button"
                className="doc-embed-btn"
                onClick={() => setDraft(doc?.text ?? "")}
                aria-label="编辑卡片"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
              </button>
            </Tooltip>
          )}
          {editing && (
            <>
              <Tooltip content={dirty ? "保存到来源文档" : "没有改动"}>
                <button
                  type="button"
                  className="doc-embed-btn is-primary btn-accent"
                  onClick={save}
                  disabled={saving || !dirty}
                  aria-label="保存卡片"
                >
                  {saving ? "…" : "保存"}
                </button>
              </Tooltip>
              <Tooltip content="放弃改动">
                <button
                  type="button"
                  className="doc-embed-btn"
                  onClick={() => setDraft(null)}
                  disabled={saving}
                  aria-label="取消编辑"
                >
                  取消
                </button>
              </Tooltip>
            </>
          )}
          {onRemove && !editing && (
            <Tooltip content="移除卡片">
              <button
                type="button"
                className="doc-embed-btn"
                onClick={onRemove}
                aria-label="移除卡片"
              >
                ✕
              </button>
            </Tooltip>
          )}
        </span>
      </div>

      <div className="doc-embed-body">
        {state === "loading" && <div className="doc-embed-placeholder">正在加载卡片内容…</div>}
        {state === "missing" && (
          <div className="doc-embed-placeholder">
            来源文档不存在或无权访问，卡片内容无法显示。
          </div>
        )}
        {state === "error" && <div className="doc-embed-placeholder">卡片内容加载失败。</div>}
        {state === "ok" && doc && (
          <div className="doc-embed-canvas" data-embed-editing={editing ? "true" : "false"}>
            {renderEmbedded(doc.type, editing ? (draft ?? "") : (doc.text ?? ""), doc.title ?? "", {
              readOnly: !editing,
              // ⚠️ 只在**已进入编辑态**时接收变更。
              // 图表编辑器在挂载后会自动 commit 一次（如 Flowchart 的 `mounted`
              // effect 会 `setTimeout(commit, 200)` → onChange），若这里无条件
              // `setDraft`，卡片会在预览态**自己进入编辑态**并显示「保存」按钮
              // —— 实测踩到（flowchart 卡片 reload 后自动变 editing=true）。
              // 用函数式更新读取当前 editing，避免闭包拿到过期的 draft。
              onChange: (v) => setDraft((prev) => (prev === null ? prev : v)),
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 正文里的「文档卡片」节点渲染（编辑态）。
 *
 * 关键设计：
 * - **只读渲染**：卡片内直接用对应编辑器的 `readOnly` 模式，避免在一个 ProseMirror
 *   实例里再挂一个可写编辑器（两套选区/撤销栈必然打架）。编辑请跳转到来源文档。
 * - **内容按需拉取**：`docId` 存在节点属性里（可序列化进 markdown），
 *   正文内容在渲染时用 `getDocument` 取，保证卡片跟随来源文档更新。
 * - **懒加载编辑器**：复用 `LazyEditors`，不把 3000+ 行的图表编辑器打进首屏包。
 *
 * 渲染本体见 `DocumentEmbedCard`（与预览态共用）。
 */
export function DocumentEmbedView({ node, deleteNode, selected }: NodeViewProps) {
  const docId = (node.attrs.docId as string) || "";
  return (
    <NodeViewWrapper className="doc-embed" data-doc-id={docId}>
      <DocumentEmbedCard docId={docId} selected={selected} onRemove={() => deleteNode()} />
    </NodeViewWrapper>
  );
}

/**
 * 预览态卡片挂载器（把 HTML 里的空 `<div data-doc-id>` 变成真正的卡片）。
 *
 * **为什么必须有这个**：预览态的 HTML 由 `renderMarkdown` 产出，卡片节点在
 * `renderHTML` 里只留了一个占位 div（当时的理由是"预览态渲染内容会重复加载重型
 * 编辑器"）。实测后果是 —— 用户在默认的预览态**完全看不到卡片**（容器高 0px、
 * 子元素 0），只有切到编辑态才出现。这等于卡片功能只做了一半。
 *
 * 实现要点：
 * - **幂等**：用 `WeakMap` 记录已挂载的节点，重复调用不会二次 createRoot
 *   （二次 createRoot 同一节点会报 warning 并丢内容）。
 * - **可清理**：返回的 cleanup 会 unmount 所有 root。切换文档/主题时必须调用，
 *   否则 React root 会继续持有已脱离 DOM 的节点（内存泄漏）。
 * - **可分批判**：渐进渲染是逐批追加 HTML 的，新追加的卡片要能被再次扫描到，
 *   所以 schedule 在每批之后重复调用本函数即可。
 * - **异步**：编辑器是 `next/dynamic` 懒加载的，首次挂载会拉 chunk。这没问题 ——
 *   卡片本来就是按需加载，正是我们希望的行为。
 *
 * ⚠️ **去重表必须按容器隔离**（2026-10-12 修复）：`WeakMap` 是模块级的，而
 * 「编辑态 NodeView」与「预览态静态挂载」是**两套独立的 React 树**，它们的
 * 容器元素可能被浏览器复用（同位置重建后拿到同一个对象）。共用一个去重表时，
 * 切回预览态会因「表里已有」而**跳过挂载**，从而保留上一轮编辑态的整棵树 ——
 * 实测表现：预览态卡片仍带 `is-editing`、仍显示编辑/移除按钮。
 * 因此以**容器元素自身**为键，容器换了自然重新挂载。
 */
const mountedRoots = new WeakMap<Element, Map<Element, Root>>();

export function hydrateEmbeds(container: HTMLElement | null): () => void {
  if (!container) return () => {};

  // 该容器专属的去重表；容器不同则互不影响
  let table = mountedRoots.get(container);
  if (!table) {
    table = new Map<Element, Root>();
    mountedRoots.set(container, table);
  }
  const roots = table;

  const placeholders = container.querySelectorAll<HTMLElement>("div[data-doc-id]");
  const mounted: Element[] = [];

  for (const el of Array.from(placeholders)) {
    // 编辑态的 NodeView 外层也带 data-doc-id；但那个外层内部已经有 .doc-embed-card，
    // 说明卡片已由 NodeView 渲染过，这里跳过，避免重复挂载。
    if (el.querySelector(".doc-embed-card")) continue;
    if (roots.has(el)) continue;

    const docId = el.getAttribute("data-doc-id") || "";
    // 标记成 .doc-embed，让卡片样式（外框/选中态）对预览态同样生效
    el.classList.add("doc-embed");
    const root = createRoot(el);
    root.render(<DocumentEmbedCard docId={docId} />);
    roots.set(el, root);
    mounted.push(el);
  }

  return () => {
    for (const el of mounted) {
      const root = roots.get(el);
      // 必须同时清掉去重表：否则该节点若仍在 DOM 里（渐进渲染会保留已追加的批次），
      // 后续 hydrateEmbeds 会因「表里已存在」而跳过，卡片永远无法复原。
      roots.delete(el);
      // unmount 放到微任务之后：React 18 的 createRoot().render() 是异步提交的，
      // 同步 unmount 可能落在提交之前，触发 "Attempted to synchronously unmount
      // a root while React was already rendering" 警告。
      if (root) queueMicrotask(() => root.unmount());
    }
  };
}

/**
 * 「插入卡片」的文档选择器。
 *
 * 只列出可嵌入的 5 种类型（其余类型嵌进来没有意义），并支持按标题过滤。
 * 复用项目既有的 `.menu-item` 行规格，不手写行高（见 DESIGN.md）。
 */
export function EmbedPicker({
  kbId,
  onPick,
  onCreate,
  onClose,
}: {
  kbId?: string | null;
  onPick: (doc: DocMeta) => void;
  /**
   * 新建并插入。
   *
   * 为什么需要这条路径：实测 5 个编辑器零使用的原因是**门槛**——
   * 必须先离开当前文档去新建、再回来嵌入。一步式建+插把门槛降到接近零。
   * 挂起期间由父组件负责显示「正在创建…」并禁用重复点击。
   */
  onCreate: (type: EmbeddableType) => void;
  onClose: () => void;
}) {
  const [docs, setDocs] = useState<DocMeta[] | null>(null);
  const [kw, setKw] = useState("");
  const [creating, setCreating] = useState<EmbeddableType | null>(null);

  useEffect(() => {
    let cancelled = false;
    listDocuments(kbId)
      .then((all) => {
        if (cancelled) return;
        setDocs(all.filter((d) => EMBEDDABLE_TYPES.includes((d.type ?? "") as EmbeddableType)));
      })
      .catch(() => {
        if (!cancelled) setDocs([]);
      });
    return () => {
      cancelled = true;
    };
  }, [kbId]);

  const shown = useMemo(() => {
    if (!docs) return [];
    const k = kw.trim().toLowerCase();
    if (!k) return docs;
    return docs.filter((d) => (d.title || "").toLowerCase().includes(k));
  }, [docs, kw]);

  return (
    <div className="embed-picker menu-panel" role="dialog" aria-label="插入卡片">
      <div className="embed-picker-head">
        <span className="text-[13px] font-medium text-text">插入卡片</span>
        <button type="button" className="doc-embed-btn" onClick={onClose} aria-label="关闭">
          ✕
        </button>
      </div>
      <div className="px-2 pb-1">
        <input
          autoFocus
          value={kw}
          onChange={(e) => setKw(e.target.value)}
          placeholder="搜索表格 / 数据表 / 画板 / 思维导图 / 流程图…"
          className="input-sm w-full"
        />
      </div>
      <div className="embed-picker-list">
        {/* 新建并插入：省掉「先离开文档去新建、再回来嵌入」的两步 */}
        <div className="px-3 pb-1 pt-1 text-[11px] text-faint">新建并插入</div>
        <div className="flex flex-wrap gap-1 px-2 pb-2">
          {EMBEDDABLE_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              disabled={creating !== null}
              className="embed-new-btn"
              onClick={() => {
                setCreating(t);
                onCreate(t);
              }}
            >
              {creating === t ? "创建中…" : `+ ${TYPE_LABEL[t]}`}
            </button>
          ))}
        </div>
        <div className="mx-2 border-t border-line" />
        <div className="px-3 pb-1 pt-2 text-[11px] text-faint">
          {kw.trim() ? "匹配结果" : "从已有文档选择"}
        </div>

        {docs === null && <div className="px-3 py-3 text-[12px] text-faint">加载中…</div>}
        {docs !== null && shown.length === 0 && (
          <div className="px-3 py-3 text-[12px] text-faint">
            {docs.length === 0
              ? "还没有可嵌入的文档 —— 用上面的「新建并插入」直接建一个。"
              : "没有匹配的文档。"}
          </div>
        )}
        {shown.map((d) => (
          <button
            key={d.id}
            type="button"
            className="menu-item w-full text-left"
            onClick={() => onPick(d)}
          >
            <span className="doc-embed-badge mr-2">{TYPE_LABEL[d.type ?? ""] ?? "文档"}</span>
            <span className="truncate">{d.title || "未命名"}</span>
          </button>
        ))}
      </div>
    </div>
  );
}