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
  const isAdmin = user.role === "admin";

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2.5 rounded-full border border-line bg-surface py-1 pl-1.5 pr-2.5 transition-colors hover:border-accent/40 hover:bg-hover"
        title={name}
      >
        <span className="avatar-ring grid h-9 w-9 place-items-center rounded-full text-[15px] font-semibold">
          {user.avatar?.trim() || name.slice(0, 1)}
        </span>
        <span className="flex flex-col items-start leading-tight">
          <span className="flex items-center gap-1.5">
            <span className="max-w-[110px] truncate text-[13px] font-semibold text-text">
              {name}
            </span>
            {isAdmin && (
              <span className="rounded bg-accent-soft px-1 py-px text-[9px] font-medium leading-none text-accent">
                管理员
              </span>
            )}
          </span>
          <span className="text-[10px] text-faint">@{user.username}</span>
        </span>
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`text-faint transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="menu-panel absolute right-0 top-full z-50 mt-1.5 w-44 overflow-hidden rounded-xl py-1">
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
          {isAdmin && (
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
