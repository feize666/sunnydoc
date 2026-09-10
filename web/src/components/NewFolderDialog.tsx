"use client";

import { useState } from "react";
import { createFolder, type Folder } from "@/lib/api";
import { CloseIcon } from "./icons";

function depthOf(id: string, map: Map<string, Folder>): number {
  let depth = 0;
  let cur: string | undefined = id;
  while (cur) {
    depth++;
    cur = map.get(cur)?.parent_id ?? undefined;
  }
  return depth;
}

export function NewFolderDialog({
  open,
  onClose,
  onCreated,
  folders,
  kbId,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  folders: Folder[];
  kbId?: string | null;
}) {
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const map = new Map<string, Folder>(folders.map((f) => [f.id, f]));

  const reset = () => {
    setName("");
    setParentId("");
    setError(null);
  };

  const handleCreate = async () => {
    if (!name.trim()) {
      setError("文件夹名不能为空");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await createFolder(name.trim(), parentId || null, kbId);
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
        className="dialog-panel w-[420px] max-w-[92vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <span className="text-sm font-semibold">新建文件夹</span>
          <button
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-hover"
          >
            <CloseIcon size={16} />
          </button>
        </div>

        <div className="p-4">
          <label className="mb-1 block text-xs text-muted">文件夹名</label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="输入文件夹名称"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />

          <label className="mb-1 mt-3 block text-xs text-muted">
            上级文件夹（可选）
          </label>
          <select
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          >
            <option value="">根目录</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {"　".repeat(depthOf(f.id, map) - 1)}
                {f.name}
              </option>
            ))}
          </select>

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
