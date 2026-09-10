"use client";

import { useState, useEffect } from "react";
import { setDocTags } from "@/lib/api";
import { CloseIcon } from "./icons";

export function TagsDialog({
  open,
  docId,
  initialTags,
  onClose,
  onSaved,
}: {
  open: boolean;
  docId: string | null;
  initialTags: string[];
  onClose: () => void;
  onSaved: (tags: string[]) => void;
}) {
  const [tags, setTags] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setTags(initialTags ?? []);
      setInput("");
    }
  }, [open, initialTags]);

  if (!open || !docId) return null;

  const addTag = () => {
    const t = input.trim().replace(/^#/, "");
    if (!t || tags.includes(t)) {
      setInput("");
      return;
    }
    setTags((prev) => [...prev, t]);
    setInput("");
  };

  const removeTag = (t: string) => {
    setTags((prev) => prev.filter((x) => x !== t));
  };

  const save = async () => {
    setSaving(true);
    try {
      await setDocTags(docId, tags);
      onSaved(tags);
      onClose();
    } catch (e) {
      alert(`保存标签失败：${e instanceof Error ? e.message : "未知错误"}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog-panel w-[420px] max-w-[92vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div className="text-[15px] font-semibold text-text">文档标签</div>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-md text-faint transition-colors hover:bg-hover hover:text-text"
          >
            <CloseIcon size={15} />
          </button>
        </div>

        <div className="px-5 py-4">
          <div className="flex flex-wrap gap-1.5 rounded-lg border border-line bg-background p-2">
            {tags.map((t) => (
              <span
                key={t}
                className="flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-1 text-[13px] text-accent"
              >
                #{t}
                <button
                  onClick={() => removeTag(t)}
                  className="grid h-3.5 w-3.5 place-items-center rounded-full hover:bg-accent/20"
                >
                  <CloseIcon size={10} />
                </button>
              </span>
            ))}
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTag();
                } else if (e.key === "Backspace" && !input && tags.length > 0) {
                  removeTag(tags[tags.length - 1]);
                }
              }}
              placeholder={tags.length === 0 ? "输入标签后回车添加…" : "继续添加…"}
              className="min-w-[80px] flex-1 bg-transparent text-[14px] text-text outline-none placeholder:text-faint"
            />
          </div>
          <p className="mt-2 text-[12px] text-faint">回车添加标签，点击标签上的 × 移除</p>

          <button
            onClick={save}
            disabled={saving}
            className="btn-accent mt-4 w-full rounded-lg py-2 text-[14px] font-medium text-white disabled:opacity-50"
          >
            {saving ? "保存中…" : "保存标签"}
          </button>
        </div>
      </div>
    </div>
  );
}
