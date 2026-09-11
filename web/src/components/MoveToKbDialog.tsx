"use client";

import { useState } from "react";
import { moveDocumentToKb, type Kb } from "@/lib/api";
import { CloseIcon } from "./icons";

export function MoveToKbDialog({
  open,
  onClose,
  onMoved,
  docId,
  docTitle,
  kbs,
  currentKbId,
}: {
  open: boolean;
  onClose: () => void;
  onMoved: () => void;
  docId: string | null;
  docTitle: string;
  kbs: Kb[];
  currentKbId: string | null;
}) {
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  // 可选目标：有写权限、且不是当前库
  const targets = kbs.filter(
    (k) => k.id !== currentKbId && (k.permission === "owner" || k.permission === "write"),
  );

  const handleMove = async (kb: Kb) => {
    if (!docId || submitting) return;
    setSubmitting(kb.id);
    setError(null);
    try {
      await moveDocumentToKb(docId, kb.id);
      onMoved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "移动失败");
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog-panel w-[460px] max-w-[92vw]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <span className="text-sm font-semibold">移动到知识库</span>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-hover">
            <CloseIcon size={16} />
          </button>
        </div>

        <div className="p-4">
          <p className="mb-3 text-[13px] text-muted">
            将「<span className="font-medium text-text">{docTitle}</span>」移动到其他知识库（移动后将从当前知识库移除）
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
