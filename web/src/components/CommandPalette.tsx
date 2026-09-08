"use client";

import { useEffect, useRef } from "react";

export interface Command {
  icon: string;
  label: string;
  hint: string;
  action?: () => void;
}

export function CommandPalette({
  open,
  onClose,
  commands,
}: {
  open: boolean;
  onClose: () => void;
  commands: Command[];
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open) onClose();
        else onClose(); // 打开由 TitleBar 处理
      }
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />
      <div className="fixed left-1/2 top-[18%] z-50 w-[520px] max-w-[90vw] -translate-x-1/2 overflow-hidden rounded-xl border border-line bg-background shadow-2xl">
        <input
          ref={inputRef}
          placeholder="搜索命令…"
          className="w-full border-b border-line bg-transparent px-4 py-3.5 text-[15px] text-text outline-none placeholder:text-faint"
        />
        <div className="max-h-[320px] overflow-y-auto p-1.5">
          {commands.map((c, i) => (
            <button
              key={i}
              onClick={() => {
                onClose();
                c.action?.();
              }}
              className="group flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-[13px] hover:bg-active hover:text-accent"
            >
              <span>{c.icon}</span>
              <span className="flex-1">{c.label}</span>
              {c.hint && (
                <span className="font-mono text-[11px] text-faint">{c.hint}</span>
              )}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
