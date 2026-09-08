"use client";

import { CloseIcon } from "./icons";

export function TitleBar({
  openDocs,
  activeKey,
  onSelect,
  onClose,
  onToggleSidebar,
  onOpenPalette,
  theme,
  onToggleTheme,
}: {
  openDocs: { key: string; title: string }[];
  activeKey: string | null;
  onSelect: (key: string) => void;
  onClose: (key: string) => void;
  onToggleSidebar: () => void;
  onOpenPalette: () => void;
  theme: "light" | "dark";
  onToggleTheme: () => void;
}) {
  return (
    <header className="flex h-11 items-center gap-2 border-b border-line bg-background px-2.5 select-none">
      <div className="flex items-center gap-1.5 px-1 text-sm font-semibold">
        <span className="grid h-[18px] w-[18px] place-items-center rounded-md bg-gradient-to-br from-blue-400 to-accent text-[11px] font-bold text-white">
          知
        </span>
        知库
      </div>

      <div className="mx-1 h-5 w-px bg-line" />

      <button
        onClick={onToggleSidebar}
        className="grid h-[30px] w-[30px] place-items-center rounded-md text-muted hover:bg-hover hover:text-text"
        title="折叠侧栏"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 6h18M3 12h18M3 18h18" />
        </svg>
      </button>

      <div className="flex flex-1 items-center gap-0.5 overflow-x-auto">
        {openDocs.map((d) => {
          const active = d.key === activeKey;
          return (
            <div
              key={d.key}
              onClick={() => onSelect(d.key)}
              className={`group flex h-full cursor-pointer items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-[13px] transition-colors ${
                active
                  ? "border-accent text-text"
                  : "border-transparent text-muted hover:text-text"
              }`}
            >
              <span>{d.title}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(d.key);
                }}
                className="grid h-4 w-4 place-items-center rounded opacity-0 group-hover:opacity-70 hover:bg-hover hover:opacity-100"
              >
                <CloseIcon size={12} />
              </button>
            </div>
          );
        })}
      </div>

      <button
        onClick={onOpenPalette}
        className="flex min-w-[160px] items-center gap-1.5 rounded-md bg-surface-2 px-2.5 py-1.5 text-xs text-faint"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4-4" />
        </svg>
        <span className="flex-1 text-left">搜索或执行命令</span>
        <kbd className="rounded border border-line bg-background px-1 font-mono text-[10px]">
          ⌘K
        </kbd>
      </button>

      <button
        onClick={onToggleTheme}
        className="grid h-[30px] w-[30px] place-items-center rounded-md text-muted hover:bg-hover hover:text-text"
        title="切换主题"
      >
        {theme === "light" ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </svg>
        )}
      </button>
    </header>
  );
}
