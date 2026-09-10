"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { Kb, KbShare } from "@/lib/api";
import { listShares, addShare, removeShare, searchUsers, type UserBrief } from "@/lib/api";
import { CloseIcon, TrashIcon } from "./icons";

function ShareIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
    </svg>
  );
}

export function ShareDialog({
  open,
  kb,
  onClose,
  onChanged,
}: {
  open: boolean;
  kb: Kb | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [shares, setShares] = useState<KbShare[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<UserBrief[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    if (!kb) return;
    setLoading(true);
    try {
      setShares(await listShares(kb.id));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载共享列表失败");
    } finally {
      setLoading(false);
    }
  }, [kb]);

  useEffect(() => {
    if (open && kb) {
      setQuery("");
      setCandidates([]);
      load();
    }
  }, [open, kb, load]);

  // 搜索用户（防抖 250ms）
  useEffect(() => {
    if (!open || !kb) return;
    const q = query.trim();
    if (!q) {
      setCandidates([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      try {
        setCandidates(await searchUsers(q));
      } catch {
        setCandidates([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [query, open, kb]);

  if (!open || !kb) return null;

  const handleAdd = async (u: UserBrief, permission: "read" | "write") => {
    setAddingId(u.id);
    try {
      await addShare(kb.id, u.username, permission);
      await load();
      setQuery("");
      setCandidates([]);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "添加共享失败");
    } finally {
      setAddingId(null);
    }
  };

  const handleRemove = async (userId: string) => {
    try {
      await removeShare(kb.id, userId);
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "移除共享失败");
    }
  };

  const handleTogglePermission = async (s: KbShare) => {
    if (!s.username) return;
    const next: "read" | "write" = s.permission === "read" ? "write" : "read";
    try {
      await addShare(kb.id, s.username, next);
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "更新权限失败");
    }
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog-panel flex max-h-[80vh] w-[460px] max-w-[92vw] flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent-soft text-accent">
              <ShareIcon size={15} />
            </span>
            <div className="leading-tight">
              <div className="text-[15px] font-semibold text-text">共享与协作</div>
              <div className="text-[12px] text-faint">{kb.name}</div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-md text-faint transition-colors hover:bg-hover hover:text-text"
          >
            <CloseIcon size={15} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* 添加用户 */}
          <div className="relative">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="输入用户名或昵称搜索并添加协作者…"
              className="w-full rounded-lg border border-line bg-background px-3 py-2 text-[14px] text-text outline-none placeholder:text-faint focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
            {query.trim() && (
              <div className="menu-panel absolute left-0 right-0 top-full z-20 mt-1 max-h-[220px] overflow-y-auto">
                {searching ? (
                  <div className="px-3 py-2.5 text-center text-[13px] text-faint">搜索中…</div>
                ) : candidates.length === 0 ? (
                  <div className="px-3 py-2.5 text-center text-[13px] text-faint">未找到用户</div>
                ) : (
                  candidates.map((u) => {
                    const already = shares.some((s) => s.user_id === u.id);
                    return (
                      <div
                        key={u.id}
                        className="flex items-center justify-between gap-2 px-3 py-1.5"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent-soft text-[12px] font-semibold text-accent">
                            {(u.nickname || u.username).slice(0, 1)}
                          </span>
                          <div className="min-w-0 leading-tight">
                            <div className="truncate text-[14px] text-text">{u.nickname || u.username}</div>
                            <div className="truncate text-[10px] text-faint">@{u.username}</div>
                          </div>
                        </div>
                        {already ? (
                          <span className="text-[12px] text-faint">已添加</span>
                        ) : (
                          <div className="flex shrink-0 gap-1">
                            <button
                              onClick={() => handleAdd(u, "read")}
                              disabled={addingId === u.id}
                              className="rounded-md border border-line px-2 py-1 text-[12px] text-muted transition-colors hover:bg-hover hover:text-text"
                            >
                              只读
                            </button>
                            <button
                              onClick={() => handleAdd(u, "write")}
                              disabled={addingId === u.id}
                              className="rounded-md bg-accent-soft px-2 py-1 text-[12px] text-accent transition-colors hover:bg-accent hover:text-white"
                            >
                              可编辑
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {error && (
            <div className="mt-3 rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-xs text-danger">
              {error}
            </div>
          )}

          {/* 已共享列表 */}
          <div className="mt-4">
            <div className="mb-2 text-[13px] font-semibold text-muted">
              已共享成员（{shares.length}）
            </div>
            {loading ? (
              <div className="py-4 text-center text-[13px] text-faint">加载中…</div>
            ) : shares.length === 0 ? (
              <div className="rounded-lg border border-dashed border-line py-6 text-center text-[13px] text-faint">
                尚未共享给任何用户
              </div>
            ) : (
              <ul className="space-y-1.5">
                {shares.map((s) => (
                  <li
                    key={s.user_id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface px-3 py-2"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent-soft text-[13px] font-semibold text-accent">
                        {(s.nickname || s.username || "?").slice(0, 1)}
                      </span>
                      <div className="min-w-0 leading-tight">
                        <div className="truncate text-[14px] text-text">{s.nickname || s.username}</div>
                        {s.username && s.username !== s.nickname && (
                          <div className="truncate text-[10px] text-faint">@{s.username}</div>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        onClick={() => handleTogglePermission(s)}
                        className={`rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors ${
                          s.permission === "write"
                            ? "bg-accent-soft text-accent hover:bg-accent hover:text-white"
                            : "bg-surface-2 text-faint hover:bg-hover hover:text-text"
                        }`}
                      >
                        {s.permission === "write" ? "可编辑" : "只读"}
                      </button>
                      <button
                        onClick={() => handleRemove(s.user_id)}
                        className="grid h-6 w-6 place-items-center rounded-md text-faint transition-colors hover:bg-danger-soft hover:text-danger"
                      >
                        <TrashIcon size={13} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
