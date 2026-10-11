"use client";

import { useEffect, useMemo, useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { getDocument, listDocuments, type DocDetail, type DocMeta } from "@/lib/api";
import {
  LazyTableEditor,
  LazyBoardEditor,
  LazyDatasheetEditor,
  LazyMindMapEditor,
  LazyFlowchartEditor,
} from "./LazyEditors";
import { Tooltip } from "./Tooltip";

/**
 * 可嵌入正文的文档类型（P2-3 卡片嵌入）。
 *
 * 为什么只允许这 5 种：它们当前必须「新建一个独立文档」才能使用，
 * 实测数据里 241 篇文档中一条都没有 —— 不是没人需要，而是门槛太高。
 * 改成可在正文里随手插入后，使用成本降到接近零。
 *
 * 不含 `doc`：把整篇文档嵌进另一篇会形成无意义的递归；
 * 也不含 `slides`：尚未实现。
 */
export const EMBEDDABLE_TYPES = [
  "table",
  "datasheet",
  "board",
  "mindmap",
  "flowchart",
] as const;

export type EmbeddableType = (typeof EMBEDDABLE_TYPES)[number];

const TYPE_LABEL: Record<string, string> = {
  table: "表格",
  datasheet: "数据表",
  board: "画板",
  mindmap: "思维导图",
  flowchart: "流程图",
};

/**
 * 各类型的**初始内容**与默认标题。
 *
 * ⚠️ 必须与 `page.tsx` 的 `handleNew` 逐字一致 —— 两处若不一致，
 * 会出现「从文件树新建」与「从卡片新建」得到不同初始结构的怪现象，
 * 而各编辑器的解析器对结构有假设（如思维导图要求 nodes 数组）。
 * 这里的取值是照抄 handleNew 的，不是自己编的。
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
};

/** 按类型给出对应的懒加载编辑器。缺省返回 null（未知类型则不渲染内容）。 */
function renderEmbedded(
  type: string | undefined,
  body: string,
  title: string,
): React.ReactNode {
  switch (type) {
    case "table":
      return <LazyTableEditor value={body} onChange={() => {}} readOnly title={title} />;
    case "datasheet":
      return <LazyDatasheetEditor value={body} onChange={() => {}} readOnly title={title} />;
    case "board":
      return <LazyBoardEditor value={body} onChange={() => {}} readOnly title={title} />;
    case "mindmap":
      return <LazyMindMapEditor value={body} onChange={() => {}} readOnly title={title} />;
    case "flowchart":
      return <LazyFlowchartEditor value={body} onChange={() => {}} readOnly title={title} />;
    default:
      return null;
  }
}

/**
 * 正文里的「文档卡片」节点渲染。
 *
 * 关键设计：
 * - **只读渲染**：卡片内直接用对应编辑器的 `readOnly` 模式，避免在一个 ProseMirror
 *   实例里再挂一个可写编辑器（两套选区/撤销栈必然打架）。编辑请跳转到来源文档。
 * - **内容按需拉取**：`docId` 存在节点属性里（可序列化进 markdown），
 *   正文内容在渲染时用 `getDocument` 取，保证卡片跟随来源文档更新，
 *   而不是把内容快照进正文（那样会立刻过期）。
 * - **懒加载编辑器**：复用 `LazyEditors`，不把 3000+ 行的图表编辑器打进首屏包。
 */
export function DocumentEmbedView({ node, deleteNode, selected }: NodeViewProps) {
  const docId = (node.attrs.docId as string) || "";
  const [doc, setDoc] = useState<DocDetail | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "missing" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    if (!docId) {
      setState("missing");
      return;
    }
    setState("loading");
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

  return (
    <NodeViewWrapper
      className="doc-embed"
      data-doc-id={docId}
      data-embed-type={doc?.type ?? ""}
    >
      <div
        className={`doc-embed-card${selected ? " is-selected" : ""}`}
        // 卡片内的点击不应把光标放进卡片（否则会以为能直接编辑）
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
            <Tooltip content="移除卡片">
              <button
                type="button"
                className="doc-embed-btn"
                onClick={() => deleteNode()}
                aria-label="移除卡片"
              >
                ✕
              </button>
            </Tooltip>
          </span>
        </div>

        <div className="doc-embed-body">
          {state === "loading" && (
            <div className="doc-embed-placeholder">正在加载卡片内容…</div>
          )}
          {state === "missing" && (
            <div className="doc-embed-placeholder">
              来源文档不存在或无权访问，卡片内容无法显示。
            </div>
          )}
          {state === "error" && (
            <div className="doc-embed-placeholder">卡片内容加载失败。</div>
          )}
          {state === "ok" && doc && (
            <div className="doc-embed-canvas">
              {renderEmbedded(doc.type, doc.text ?? "", doc.title ?? "")}
            </div>
          )}
        </div>
      </div>
    </NodeViewWrapper>
  );
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