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
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  folders: Folder[];
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
      await createFolder(name.trim(), parentId || null);
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
        className="w-[420px] max-w-[92vw] overflow-hidden rounded-xl border border-line bg-background shadow-2xl"
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
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
            }}
            placeholder="输入文件夹名称"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent"
          />

          <label className="mb-1 mt-3 block text-xs text-muted">
            上级文件夹（可选）
          </label>
          <select
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent"
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
