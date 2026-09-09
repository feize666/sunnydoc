"use client";

import { useState, useRef, useEffect } from "react";
import type { User } from "@/lib/api";

export function UserMenu({
  user,
  onOpenProfile,
  onOpenUsers,
  onLogout,
}: {
  user: User;
  onOpenProfile: () => void;
  onOpenUsers: () => void;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const name = user.nickname ?? user.username;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-full py-1 pl-1 pr-2 transition-colors hover:bg-hover"
        title={name}
      >
        <span className="grid h-7 w-7 place-items-center rounded-full bg-accent-soft text-[12px] font-semibold text-accent">
          {user.avatar?.trim() || name.slice(0, 1)}
        </span>
        <span className="max-w-[100px] truncate text-xs text-muted">{name}</span>
      </button>

      {open && (
        <div className="menu-panel absolute right-0 top-full z-50 mt-1 w-40 overflow-hidden rounded-lg py-1">
          <button
            onClick={() => {
              setOpen(false);
              onOpenProfile();
            }}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-text hover:bg-hover"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" />
            </svg>
            个人信息
          </button>
          {user.role === "admin" && (
            <button
              onClick={() => {
                setOpen(false);
                onOpenUsers();
              }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-text hover:bg-hover"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted">
                <path d="M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9.5" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              用户管理
            </button>
          )}
          <div className="my-1 border-t border-line" />
          <button
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-danger hover:bg-danger-soft"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
            </svg>
            退出登录
          </button>
        </div>
      )}
    </div>
  );
}
