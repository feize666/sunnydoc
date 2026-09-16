"use client";

import { useState, useEffect } from "react";
import { renameFolder, type Folder } from "@/lib/api";
import { useModalFocus } from "@/lib/useModalFocus";
import { CloseIcon } from "./icons";

export function RenameFolderDialog({
  folder,
  onClose,
  onRenamed,
}: {
  folder: Folder | null;
  onClose: () => void;
  onRenamed: () => void;
}) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (folder) {
      setName(folder.name);
      setError(null);
    }
  }, [folder]);

  const panelRef = useModalFocus<HTMLDivElement>(!!folder, onClose, "重命名文件夹");

  if (!folder) return null;

  const handleRename = async () => {
    if (!name.trim()) {
      setError("文件夹名称不能为空");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await renameFolder(folder.id, name.trim());
      onRenamed();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "重命名失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        ref={panelRef}
        className="dialog-panel w-[420px] max-w-[92vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <span className="text-sm font-semibold">重命名文件夹</span>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="icon-btn text-muted hover:text-text"
          >
            <CloseIcon size={16} />
          </button>
        </div>

        <div className="p-4">
          <label className="field-label">文件夹名</label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="输入文件夹名称"
            className="input"
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
              onClick={handleRename}
              disabled={submitting}
              className="btn btn-accent text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "保存中…" : "保存"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
