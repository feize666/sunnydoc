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
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40"
      onClick={onCancel}
    >
      <div
        className="w-[400px] max-w-[92vw] overflow-hidden rounded-xl border border-line bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 px-5 py-4">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-red-50 text-red-500">
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
            className="rounded-lg border border-line px-4 py-2 text-sm text-text hover:bg-hover"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className={`rounded-lg px-4 py-2 text-sm text-white ${
              danger
                ? "bg-red-500 hover:bg-red-600"
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
