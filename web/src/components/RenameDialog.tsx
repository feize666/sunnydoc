"use client";

import { useState, useEffect } from "react";
import { CloseIcon } from "./icons";

/** 通用重命名弹窗（文档 / 文件夹）。 */
export function RenameDialog({
  open,
  title,
  initialName,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  initialName: string;
  onClose: () => void;
  onConfirm: (name: string) => Promise<void> | void;
}) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setName(initialName);
  }, [open, initialName]);

  if (!open) return null;

  const submit = async () => {
    const n = name.trim();
    if (!n) return;
    setSaving(true);
    try {
      await onConfirm(n);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog-panel w-[360px] max-w-[92vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div className="text-[15px] font-semibold text-text">{title}</div>
          <button
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-md text-faint transition-colors hover:bg-hover hover:text-text"
          >
            <CloseIcon size={15} />
          </button>
        </div>
        <div className="px-5 py-4">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            placeholder="请输入名称"
            className="input"
          />
          <button
            onClick={submit}
            disabled={saving || !name.trim()}
            className="btn btn-accent mt-4 w-full text-white"
          >
            {saving ? "保存中…" : "确定"}
          </button>
        </div>
      </div>
    </div>
  );
}
