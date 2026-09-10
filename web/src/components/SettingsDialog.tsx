"use client";

import { CloseIcon } from "./icons";
import { ThemeToggle } from "./ThemeToggle";

export function SettingsDialog({
  open,
  onClose,
  theme,
  onToggleTheme,
}: {
  open: boolean;
  onClose: () => void;
  theme: "light" | "dark";
  onToggleTheme: () => void;
}) {
  if (!open) return null;

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog-panel flex max-h-[85vh] w-[480px] max-w-[92vw] flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div className="text-[15px] font-semibold text-text">设置</div>
          <button
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-md text-faint transition-colors hover:bg-hover hover:text-text"
          >
            <CloseIcon size={15} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="text-[13px] font-semibold text-muted">外观</div>
          <div className="mt-2 flex items-center justify-between rounded-lg border border-line bg-surface px-3 py-2.5">
            <div>
              <div className="text-[14px] text-text">主题</div>
              <div className="text-[12px] text-faint">
                当前为{theme === "light" ? "浅色" : "深色"}主题
              </div>
            </div>
            <ThemeToggle
              theme={theme}
              onToggle={onToggleTheme}
              size={18}
              className="h-9 w-9"
            />
          </div>

          <div className="mt-4 text-[13px] font-semibold text-muted">语言</div>
          <div className="mt-2 flex items-center justify-between rounded-lg border border-line bg-surface px-3 py-2.5">
            <span className="text-[14px] text-text">简体中文</span>
            <span className="text-[12px] text-faint">当前仅支持中文</span>
          </div>

          <div className="mt-4 text-[13px] font-semibold text-muted">关于</div>
          <div className="mt-2 rounded-lg border border-line bg-surface px-3 py-3">
            <div className="flex items-center gap-2">
              <span className="logo-mark grid h-7 w-7 place-items-center rounded-lg text-sm font-bold">
                知
              </span>
              <div className="leading-tight">
                <div className="text-[14px] font-semibold text-text">知库 sunnydoc</div>
                <div className="text-[12px] text-faint">以文档为核心的私有知识库</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
