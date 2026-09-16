"use client";

import { AlertIcon } from "./icons";
import { useModalFocus } from "@/lib/useModalFocus";

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
  const panelRef = useModalFocus<HTMLDivElement>(open, onCancel, title);

  if (!open) return null;

  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div
        ref={panelRef}
        className="dialog-panel w-[400px] max-w-[92vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 px-5 py-4">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-danger-soft text-danger">
            <AlertIcon size={20} />
          </div>
          <div className="min-w-0 flex-1 pt-0.5">
            <div className="text-sm font-semibold text-text">{title}</div>
            <div className="mt-1 text-[14px] leading-relaxed text-muted">
              {message}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
          <button
            onClick={onCancel}
            className="btn btn-secondary"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className={`btn text-white ${
              danger
                ? "bg-danger hover:bg-danger-hover"
                : "btn-accent"
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
