"use client";

import { useState, useEffect } from "react";
import { renderMarkdown } from "@/lib/markdown";
import { updateDocument } from "@/lib/api";
import type { Doc } from "@/data/docs";

type Mode = "preview" | "edit";

export function Editor({
  doc,
  loading,
  onSaved,
}: {
  doc: Doc | null;
  loading?: boolean;
  onSaved?: (doc: Doc, newTitle: string, newBody: string) => void;
}) {
  const [mode, setMode] = useState<Mode>("preview");
  const [draftTitle, setDraftTitle] = useState("");
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  // 切换文档时重置为预览模式
  useEffect(() => {
    setMode("preview");
  }, [doc?.key]);

  if (loading && !doc) {
    return (
      <main className="flex flex-1 items-center justify-center bg-background text-muted">
        <p className="text-sm">正在加载文档…</p>
      </main>
    );
  }

  if (!doc) {
    return (
      <main className="flex flex-1 items-center justify-center bg-background text-muted">
        <p className="text-sm">从左侧选择一个文档开始阅读</p>
      </main>
    );
  }

  const handleSwitch = (m: Mode) => {
    if (m === "edit" && mode !== "edit") {
      setDraftTitle(doc.title);
      setDraft(doc.body);
    }
    setMode(m);
  };

  const handleSave = async () => {
    if (!doc) return;
    const title = draftTitle.trim();
    if (!title) {
      alert("标题不能为空");
      return;
    }
    setSaving(true);
    try {
      await updateDocument(doc.key, title, draft);
      onSaved?.(doc, title, draft);
      setMode("preview");
    } catch (e) {
      alert(`保存失败：${e instanceof Error ? e.message : "未知错误"}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-background">
      <div className="flex items-center gap-1 border-b border-line bg-surface px-3 py-1">
        <button
          onClick={() => handleSwitch("preview")}
          className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
            mode === "preview"
              ? "bg-background text-accent shadow-[0_0_0_1px_var(--line)]"
              : "text-muted hover:text-text"
          }`}
        >
          预览
        </button>
        <button
          onClick={() => handleSwitch("edit")}
          className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
            mode === "edit"
              ? "bg-background text-accent shadow-[0_0_0_1px_var(--line)]"
              : "text-muted hover:text-text"
          }`}
        >
          编辑
        </button>
        <div className="flex-1" />
        {mode === "edit" && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "保存中…" : "保存"}
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto py-7">
        <div className="mx-auto max-w-[760px] px-10">
          {mode === "preview" ? (
            <>
              <h1 className="mb-1 text-[28px] font-bold leading-tight">
                {doc.title}
              </h1>
              <p className="mb-6 text-xs text-faint">
                {doc.path} · 更新于 {doc.updated}
              </p>
              <div
                className="md-body"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(doc.body) }}
              />
            </>
          ) : (
            <>
              <input
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                className="mb-3 w-full bg-transparent text-[24px] font-bold text-text outline-none"
                placeholder="标题"
                spellCheck={false}
              />
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="h-[calc(100vh-200px)] w-full resize-none bg-transparent font-mono text-[14px] leading-relaxed text-text outline-none"
                spellCheck={false}
              />
            </>
          )}
        </div>
      </div>
    </main>
  );
}
