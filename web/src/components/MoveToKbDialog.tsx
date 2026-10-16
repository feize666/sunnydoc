"use client";

import { useState } from "react";
import {
  moveDocumentToKb,
  batchMoveDocuments,
  type Kb,
} from "@/lib/api";
import { useModalFocus } from "@/lib/useModalFocus";
import { CloseIcon } from "./icons";

/**
 * 「移动到知识库」对话框。
 *
 * 同时服务两条路径（**不复制两份实现** —— 分叉代价在本项目已实证两次）：
 *  - 单个文档：行内「更多操作 → 移动到…」
 *  - 批量：多选工具条「移动」（`docIds` 长度 > 1）
 *
 * 批量走 `/documents/batch-move`（一次请求、逐项跳过无权限者）；
 * 单个仍走既有的单文档接口，保持原有行为与后端语义不变。
 */
export function MoveToKbDialog({
  open,
  onClose,
  onMoved,
  docIds,
  docTitle,
  kbs,
  currentKbId,
}: {
  open: boolean;
  onClose: () => void;
  onMoved: () => void;
  /** 批量时传多个 id；单个时长度为 1。空数组表示不可用。 */
  docIds: string[];
  /** 单个文档的标题（用于文案）；批量时留空，改用数量表述。 */
  docTitle?: string;
  kbs: Kb[];
  currentKbId: string | null;
}) {
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const panelRef = useModalFocus<HTMLDivElement>(open, onClose, "移动到知识库");

  if (!open) return null;

  const isBatch = docIds.length > 1;

  // 可选目标：有写权限、且不是当前库
  const targets = kbs.filter(
    (k) => k.id !== currentKbId && (k.permission === "owner" || k.permission === "write"),
  );

  const handleMove = async (kb: Kb) => {
    if (docIds.length === 0 || submitting) return;
    setSubmitting(kb.id);
    setError(null);
    let hasSkipped = false;
    try {
      if (isBatch) {
        const res = await batchMoveDocuments({ doc_ids: docIds, kb_id: kb.id });
        // 有跳过项时如实告知，不假装全部成功
        if (res.skipped.length > 0) {
          hasSkipped = true;
          setError(`已移动 ${res.count} 项，${res.skipped.length} 项被跳过（无权限或不存在）`);
        }
      } else {
        await moveDocumentToKb(docIds[0], kb.id);
      }
      onMoved();
      // 有跳过项时不自动关闭，让用户看清提示
      if (!hasSkipped) onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "移动失败");
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div ref={panelRef} className="dialog-panel w-[460px] max-w-[92vw]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <span className="text-sm font-semibold">移动到知识库</span>
          <button onClick={onClose} aria-label="关闭" className="icon-btn text-muted hover:text-text">
            <CloseIcon size={16} />
          </button>
        </div>

        <div className="p-4">
          <p className="mb-3 text-[13px] text-muted">
            {isBatch ? (
              <>
                将选中的 <span className="font-medium text-text">{docIds.length}</span> 篇文档移动到其他知识库（移动后将从当前知识库移除）
              </>
            ) : (
              <>
                将「<span className="font-medium text-text">{docTitle}</span>」移动到其他知识库（移动后将从当前知识库移除）
              </>
            )}
          </p>

          {targets.length === 0 ? (
            <div className="rounded-lg border border-line bg-surface px-4 py-8 text-center text-sm text-faint">
              没有可移动的目标知识库（需为其他知识库的所有者或可编辑成员）
            </div>
          ) : (
            <ul className="max-h-[300px] overflow-y-auto rounded-lg border border-line">
              {targets.map((kb, i) => (
                <li key={kb.id}>
                  <button
                    onClick={() => handleMove(kb)}
                    disabled={submitting !== null}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-hover disabled:opacity-50"
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-sm font-semibold text-accent">
                      {(kb.name || "知").slice(0, 1)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-text">{kb.name}</span>
                      <span className="block truncate text-[12px] text-faint">
                        {kb.permission === "owner" ? "所有者" : "可编辑"} · {kb.doc_count ?? 0} 篇文档
                      </span>
                    </span>
                    {submitting === kb.id ? (
                      <span className="text-xs text-faint">移动中…</span>
                    ) : (
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-faint">
                        <path d="M5 12h14M12 5l7 7-7 7" />
                      </svg>
                    )}
                  </button>
                  {i < targets.length - 1 && <div className="border-b border-line" />}
                </li>
              ))}
            </ul>
          )}

          {error && (
            <div className="mt-3 rounded-md border border-danger/40 bg-danger-soft px-2 py-1.5 text-xs text-danger">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
