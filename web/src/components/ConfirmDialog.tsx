"use client";

import { useEffect } from "react";
import { AlertIcon } from "./icons";

export function ConfirmDialog({
  open,
  title,
  message,
  confirmText = "删除",
  cancelText = "取消",
  danger = true,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div
        className="dialog-panel w-[400px] max-w-[92vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 px-5 py-4">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-danger-soft text-danger">
            <AlertIcon size={20} />
          </div>
          <div className="min-w-0 flex-1 pt-0.5">
            <div className="text-sm font-semibold text-text">{title}</div>
            <div className="mt-1 text-[13px] leading-relaxed text-muted">
              {message}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
          <button
            onClick={onCancel}
            className="btn-secondary rounded-lg px-4 py-2 text-sm"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className={`rounded-lg px-4 py-2 text-sm text-white ${
              danger
                ? "bg-danger hover:bg-danger-hover"
                : "bg-accent hover:bg-accent-hover"
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
