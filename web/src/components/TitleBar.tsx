"use client";

import { CloseIcon } from "./icons";
import { Tooltip } from "./Tooltip";
import { ThemeToggle } from "./ThemeToggle";
import { UserMenu } from "./UserMenu";
import type { User } from "@/lib/api";

export function TitleBar({
  openDocs,
  activeKey,
  onSelect,
  onClose,
  onToggleSidebar,
  onOpenPalette,
  theme,
  onToggleTheme,
  onBackHome,
  onToggleAi,
  aiOpen,
  onOpenFavorites,
  onOpenNotifications,
  unreadCount,
  user,
  onOpenProfile,
  onOpenUsers,
  onOpenSettings,
  onLogout,
}: {
  openDocs: { key: string; title: string }[];
  activeKey: string | null;
  onSelect: (key: string) => void;
  onClose: (key: string) => void;
  onToggleSidebar: () => void;
  onOpenPalette: () => void;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onBackHome?: () => void;
  onToggleAi: () => void;
  aiOpen: boolean;
  onOpenFavorites: () => void;
  onOpenNotifications?: () => void;
  unreadCount?: number;
  user?: User;
  onOpenProfile?: () => void;
  onOpenUsers?: () => void;
  onOpenSettings?: () => void;
  onLogout?: () => void;
}) {
  return (
    <header className="flex h-12 items-center gap-2 border-b border-line bg-background px-3 select-none">
      {onBackHome && (
        <Tooltip content="返回首页">
          <button
            onClick={onBackHome}
            className="grid h-9 w-9 place-items-center rounded-md text-muted hover:bg-hover hover:text-text"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
        </Tooltip>
      )}

      <div className="flex items-center gap-1.5 px-1 text-[15px] font-semibold">
        <span className="logo-mark grid h-5 w-5 place-items-center rounded-md text-[13px] font-bold">
          知
        </span>
        知库
      </div>

      <div className="mx-1 h-5 w-px bg-line" />

      <Tooltip content="折叠侧栏">
        <button
          onClick={onToggleSidebar}
          className="grid h-9 w-9 place-items-center rounded-md text-muted hover:bg-hover hover:text-text"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 6h18M3 12h18M3 18h18" />
          </svg>
        </button>
      </Tooltip>

      <div className="flex flex-1 items-center gap-0.5 overflow-x-auto">
        {openDocs.map((d) => {
          const active = d.key === activeKey;
          return (
            <div
              key={d.key}
              onClick={() => onSelect(d.key)}
              className={`group flex h-full cursor-pointer items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-[14px] transition-colors ${
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
        className="hidden h-9 min-w-[220px] items-center gap-1.5 rounded-md bg-surface-2 px-3 text-sm text-faint md:flex"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4-4" />
        </svg>
        <span className="flex-1 text-left">搜索或执行命令</span>
        <kbd className="rounded border border-line bg-background px-1 font-mono text-[11px]">
          ⌘K
        </kbd>
      </button>

      <Tooltip content="我的收藏">
        <button
          onClick={onOpenFavorites}
          className="grid h-9 w-9 place-items-center rounded-md text-muted transition-colors hover:bg-hover hover:text-text"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
        </button>
      </Tooltip>

      {onOpenNotifications && (
        <Tooltip content="通知">
          <button
            onClick={onOpenNotifications}
            className="relative grid h-9 w-9 place-items-center rounded-md text-muted transition-colors hover:bg-hover hover:text-text"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            {unreadCount ? (
              <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[9px] font-semibold leading-none text-white">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            ) : null}
          </button>
        </Tooltip>
      )}

      <ThemeToggle theme={theme} onToggle={onToggleTheme} className="h-9 w-9" />

      <Tooltip content={aiOpen ? "收起 AI 问答" : "打开 AI 问答"}>
        <button
          onClick={onToggleAi}
          className={`flex h-9 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium transition-colors ${
            aiOpen
              ? "bg-accent text-white"
              : "bg-accent-soft text-accent hover:bg-accent hover:text-white"
          }`}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2a4 4 0 0 1 4 4c1.7 0 3 1.3 3 3 0 .8-.3 1.5-.8 2 .5.5.8 1.2.8 2 0 1.7-1.3 3-3 3a4 4 0 0 1-8 0c-1.7 0-3-1.3-3-3 0-.8.3-1.5.8-2-.5-.5-.8-1.2-.8-2 0-1.7 1.3-3 3-3z" />
          </svg>
          <span className="hidden sm:inline">AI 问答</span>
        </button>
      </Tooltip>

      {user && onLogout && (
        <UserMenu
          user={user}
          onOpenProfile={onOpenProfile ?? (() => {})}
          onOpenUsers={onOpenUsers ?? (() => {})}
          onOpenSettings={onOpenSettings ?? (() => {})}
          onLogout={onLogout}
        />
      )}
    </header>
  );
}
