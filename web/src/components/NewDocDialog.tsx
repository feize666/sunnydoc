"use client";

import { useState } from "react";
import { createDocument } from "@/lib/api";
import { CloseIcon } from "./icons";
import { DOC_TEMPLATES, getTemplate } from "@/lib/templates";

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
  const [templateId, setTemplateId] = useState("blank");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const reset = () => {
    setTitle("");
    setContent("");
    setTemplateId("blank");
    setError(null);
  };

  const pickTemplate = (id: string) => {
    setTemplateId(id);
    const t = getTemplate(id);
    setContent(t ? t.content : "");
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
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog-panel w-[640px] max-w-[94vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <span className="text-sm font-semibold">新建文档</span>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-hover"
          >
            <CloseIcon size={16} />
          </button>
        </div>

        <div className="p-4">
          {/* 模板选择 */}
          <label className="mb-2 block text-xs text-muted">选择模板</label>
          <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
            {DOC_TEMPLATES.map((t) => (
              <button
                key={t.id}
                onClick={() => pickTemplate(t.id)}
                className={`flex flex-col items-center gap-1 rounded-lg border px-2 py-2.5 text-center transition-colors ${
                  templateId === t.id
                    ? "border-accent/50 bg-accent-soft"
                    : "border-line bg-background hover:border-accent/40 hover:bg-hover"
                }`}
              >
                <span className="text-lg leading-none">{t.icon}</span>
                <span
                  className={`text-[11px] leading-tight ${
                    templateId === t.id ? "text-accent" : "text-text"
                  }`}
                >
                  {t.name}
                </span>
              </button>
            ))}
          </div>

          <label className="mb-1 block text-xs text-muted">标题</label>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleCreate();
            }}
            placeholder="输入文档标题"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />

          <label className="mb-1 mt-3 block text-xs text-muted">
            内容（可选，Markdown）
          </label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="输入文档内容，可留空"
            rows={8}
            className="w-full resize-y rounded-lg border border-line bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />

          {error && (
            <div className="mt-2 rounded-md border border-danger/40 bg-danger-soft px-2 py-1.5 text-xs text-danger">
              {error}
            </div>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <button onClick={onClose} className="btn btn-secondary">
              取消
            </button>
            <button
              onClick={handleCreate}
              disabled={submitting}
              className="btn btn-accent text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "创建中…" : "创建"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
