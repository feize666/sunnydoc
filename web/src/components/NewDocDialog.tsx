"use client";

import { useState } from "react";
import { createDocument } from "@/lib/api";
import { CloseIcon } from "./icons";

export function NewDocDialog({
  open,
  onClose,
  onCreated,
  kbId,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  kbId?: string | null;
}) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const reset = () => {
    setTitle("");
    setContent("");
    setError(null);
  };

  const handleCreate = async () => {
    if (!title.trim()) {
      setError("标题不能为空");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await createDocument(title.trim(), content, kbId);
      reset();
      onCreated();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/30"
      onClick={onClose}
    >
      <div
        className="w-[560px] max-w-[92vw] overflow-hidden rounded-xl border border-line bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <span className="text-sm font-semibold">新建文档</span>
          <button
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-hover"
          >
            <CloseIcon size={16} />
          </button>
        </div>

        <div className="p-4">
          <label className="mb-1 block text-xs text-muted">标题</label>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleCreate();
            }}
            placeholder="输入文档标题"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent"
          />

          <label className="mb-1 mt-3 block text-xs text-muted">
            内容（可选，Markdown）
          </label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="输入文档内容，可留空"
            rows={8}
            className="w-full resize-y rounded-lg border border-line bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent"
          />

          {error && (
            <div className="mt-2 rounded-md border border-red-300 bg-red-50 px-2 py-1.5 text-xs text-red-600">
              {error}
            </div>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-line px-4 py-2 text-sm text-text hover:bg-hover"
            >
              取消
            </button>
            <button
              onClick={handleCreate}
              disabled={submitting}
              className="btn-accent rounded-lg px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "创建中…" : "创建"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
