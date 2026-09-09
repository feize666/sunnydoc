"use client";

import { useEffect, useState } from "react";
import { SunIcon, MoonIcon } from "./icons";
import { Tooltip } from "./Tooltip";
import { UserMenu } from "./UserMenu";
import type { User } from "@/lib/api";

type BackendStatus = "online" | "offline" | "checking";

const backendMeta: Record<BackendStatus, { label: string; dot: string }> = {
  online: { label: "后端已连接", dot: "bg-success" },
  offline: { label: "后端未连接", dot: "bg-danger" },
  checking: { label: "检测中…", dot: "bg-warning animate-pulse" },
};

export function StatusBar({
  wordCount,
  openCount,
  backendStatus = "online",
  user,
  onOpenProfile,
  onOpenUsers,
  onLogout,
  onOpenSettings,
}: {
  wordCount: number;
  openCount: number;
  backendStatus?: BackendStatus;
  user?: User;
  onOpenProfile?: () => void;
  onOpenUsers?: () => void;
  onLogout?: () => void;
  onOpenSettings?: () => void;
}) {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const el = document.documentElement;
    const read = () =>
      setTheme(el.dataset.theme === "dark" ? "dark" : "light");
    read();
    const observer = new MutationObserver(read);
    observer.observe(el, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  const { label, dot } = backendMeta[backendStatus];

  return (
    <footer className="flex h-8 items-center gap-2 border-t border-line bg-surface pl-2 pr-3.5 text-[11px] text-faint select-none">
      {user && onLogout && (
        <UserMenu
          user={user}
          onOpenProfile={onOpenProfile ?? (() => {})}
          onOpenUsers={onOpenUsers ?? (() => {})}
          onLogout={onLogout}
          compact
          direction="up"
        />
      )}

      {onOpenSettings && (
        <Tooltip content="设置">
          <button
            onClick={onOpenSettings}
            className="grid h-6 w-6 place-items-center rounded-md text-faint transition-colors hover:bg-hover hover:text-text"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </Tooltip>
      )}

      <div className="mx-1 h-4 w-px bg-line" />

      <span>{wordCount.toLocaleString()} 字</span>
      <span>{openCount} 篇已打开</span>
      <span className="flex items-center gap-1.5">
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${dot}`} />
        {label}
      </span>
      <div className="ml-auto flex items-center gap-3.5">
        <Tooltip content="当前主题">
          <span className="flex items-center gap-1">
            {theme === "light" ? <SunIcon size={11} /> : <MoonIcon size={11} />}
            {theme === "light" ? "浅色" : "深色"}
          </span>
        </Tooltip>
        <span>Markdown</span>
        <span>UTF-8</span>
      </div>
    </footer>
  );
}
