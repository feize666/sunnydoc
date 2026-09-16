"use client";

import { useState, useEffect } from "react";
import { createKb, updateKb, type Kb } from "@/lib/api";
import { useModalFocus } from "@/lib/useModalFocus";
import { CloseIcon } from "./icons";

export function NewKbDialog({
  open,
  onClose,
  onSaved,
  kb,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** 传入则为编辑模式（重命名/改描述），否则为新建模式 */
  kb?: Kb | null;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 打开时初始化表单；编辑模式回填原值
  useEffect(() => {
    if (open) {
      setName(kb?.name ?? "");
      setDescription(kb?.description ?? "");
      setError(null);
    }
  }, [open, kb]);

  const panelRef = useModalFocus<HTMLDivElement>(open, onClose, kb ? "编辑知识库" : "新建知识库");

  if (!open) return null;

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError("知识库名称不能为空");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      if (kb) {
        await updateKb(kb.id, { name: name.trim(), description: description.trim() });
      } else {
        await createKb(name.trim(), description);
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        ref={panelRef}
        className="dialog-panel w-[460px] max-w-[92vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <span className="text-sm font-semibold">
            {kb ? "编辑知识库" : "新建知识库"}
          </span>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="icon-btn text-muted hover:text-text"
          >
            <CloseIcon size={16} />
          </button>
        </div>

        <div className="p-4">
          <label className="field-label">名称</label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="输入知识库名称"
            className="input"
          />

          <label className="field-label mt-3">
            描述（可选）
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="一句话说明这个知识库的用途"
            rows={3}
            className="textarea"
          />

          {error && (
            <div className="mt-2 rounded-md border border-danger/40 bg-danger-soft px-2 py-1.5 text-xs text-danger">
              {error}
            </div>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <button
              onClick={onClose}
              className="btn btn-secondary"
            >
              取消
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="btn btn-accent text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "保存中…" : kb ? "保存" : "创建"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
