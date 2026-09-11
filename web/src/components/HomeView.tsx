"use client";

import { useState } from "react";
import type { Kb, RecentDoc, User, DocMeta, Stats } from "@/lib/api";
import { ConfirmDialog } from "./ConfirmDialog";
import { Tooltip } from "./Tooltip";
import { UserMenu } from "./UserMenu";
import { ThemeToggle } from "./ThemeToggle";
import { PlusIcon, TrashIcon, HistoryIcon, FolderIcon, EditIcon } from "./icons";

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

function formatTime(ts: number): string {
  const ms = ts && ts < 1e12 ? ts * 1000 : ts;
  const d = new Date(ms);
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.toDateString() === now.toDateString()) return `今天 ${time}`;
  const yest = new Date(now.getTime() - 86400000);
  if (d.toDateString() === yest.toDateString()) return `昨天 ${time}`;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${time}`;
}

export function HomeView({
  kbs,
  recent,
  loadingKbs,
  error,
  theme,
  onToggleTheme,
  onOpenPalette,
  onOpenKb,
  onCreateKb,
  onEditKb,
  onDeleteKb,
  onShareKb,
  onOpenRecent,
  favorites,
  onOpenFavorite,
  stats,
  user,
  onOpenProfile,
  onOpenUsers,
  onLogout,
  onOpenSettings,
}: {
  kbs: Kb[];
  recent: RecentDoc[];
  loadingKbs: boolean;
  error: string | null;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onOpenPalette: () => void;
  onOpenKb: (id: string) => void;
  onCreateKb: () => void;
  onEditKb: (kb: Kb) => void;
  onDeleteKb: (id: string) => void;
  onShareKb: (kb: Kb) => void;
  onOpenRecent: (docId: string, kbId: string | null) => void;
  favorites: DocMeta[];
  onOpenFavorite: (doc: DocMeta) => void;
  stats?: Stats | null;
  user?: User;
  onOpenProfile?: () => void;
  onOpenUsers?: () => void;
  onLogout?: () => void;
  onOpenSettings?: () => void;
}) {
  const [pendingDelete, setPendingDelete] = useState<Kb | null>(null);

  const kbNameOf = (kbId: string | null) =>
    kbId ? kbs.find((k) => k.id === kbId)?.name ?? "未知知识库" : "全部文档";

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-line bg-background px-5 select-none">
        <div className="flex items-center gap-3">
          <span className="logo-mark grid h-8 w-8 place-items-center rounded-lg text-sm font-bold">
            知
          </span>
          <div className="leading-tight">
            <div className="text-[16px] font-semibold text-text">知库</div>
            <div className="text-[12px] text-faint">文档知识库</div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onOpenPalette}
            className="flex min-w-[200px] items-center gap-1.5 rounded-lg bg-surface-2 px-3 py-1.5 text-xs text-faint"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4-4" />
            </svg>
            <span className="flex-1 text-left">搜索或执行命令</span>
            <kbd className="rounded border border-line bg-background px-1 font-mono text-[10px]">
              ⌘K
            </kbd>
          </button>

          <ThemeToggle theme={theme} onToggle={onToggleTheme} className="h-8 w-8" />

          {user && onLogout && (
            <UserMenu
              user={user}
              onOpenProfile={onOpenProfile ?? (() => {})}
              onOpenUsers={onOpenUsers ?? (() => {})}
              onOpenSettings={onOpenSettings ?? (() => {})}
              onLogout={onLogout}
            />
          )}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-6 py-8">
          {/* 数据概览 */}
          {stats && (
            <section className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: "文档", value: stats.total_docs, icon: "📄" },
                { label: "知识库", value: stats.total_kbs, icon: "📚" },
                { label: "收藏", value: stats.total_favorites, icon: "⭐" },
                { label: "最近浏览", value: stats.recent_count, icon: "🕘" },
              ].map((s) => (
                <div
                  key={s.label}
                  className="flex items-center gap-3 rounded-xl border border-line bg-background px-4 py-3.5 shadow-sm"
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-accent-soft text-lg">
                    {s.icon}
                  </span>
                  <div className="min-w-0 leading-tight">
                    <div className="text-xl font-semibold text-text">{s.value}</div>
                    <div className="text-[12px] text-faint">{s.label}</div>
                  </div>
                </div>
              ))}
            </section>
          )}

          {/* 知识库 */}
          <section>
            <h2 className="mb-4 text-base font-semibold text-text">知识库</h2>

            {error && (
              <div className="mb-4 rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-xs text-danger">
                {error}（后端服务未启动？）
              </div>
            )}

            {loadingKbs ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="h-32 animate-pulse rounded-lg border border-line bg-surface"
                  />
                ))}
              </div>
            ) : kbs.length === 0 ? (
              <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line py-16">
                <span className="grid h-14 w-14 place-items-center rounded-2xl bg-accent-soft text-accent">
                  <FolderIcon size={28} />
                </span>
                <div className="text-sm text-muted">还没有知识库</div>
                <button
                  onClick={onCreateKb}
                  className="btn btn-accent mt-1 text-white"
                >
                  创建第一个知识库
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {kbs.map((kb) => (
                  <button
                    key={kb.id}
                    onClick={() => onOpenKb(kb.id)}
                    className="group relative flex flex-col gap-2 rounded-lg border border-line bg-background p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-md"
                  >
                    <div className="flex items-start justify-between">
                      <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent-soft text-sm font-semibold text-accent">
                        {(kb.name || "知").slice(0, 1)}
                      </span>
                      {kb.permission === "owner" ? (
                        <div className="flex items-center gap-0.5">
                          <Tooltip content="共享 / 协作">
                            <span
                              role="button"
                              tabIndex={0}
                              onClick={(e) => {
                                e.stopPropagation();
                                onShareKb(kb);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.stopPropagation();
                                  onShareKb(kb);
                                }
                              }}
                              className="grid h-6 w-6 place-items-center rounded-md text-faint opacity-0 transition-opacity hover:bg-hover hover:text-accent group-hover:opacity-100"
                            >
                              <ShareIcon size={13} />
                            </span>
                          </Tooltip>
                          <Tooltip content="编辑知识库">
                            <span
                              role="button"
                              tabIndex={0}
                              onClick={(e) => {
                                e.stopPropagation();
                                onEditKb(kb);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.stopPropagation();
                                  onEditKb(kb);
                                }
                              }}
                              className="grid h-6 w-6 place-items-center rounded-md text-faint opacity-0 transition-opacity hover:bg-hover hover:text-accent group-hover:opacity-100"
                            >
                              <EditIcon size={13} />
                            </span>
                          </Tooltip>
                          <Tooltip content="删除知识库">
                            <span
                              role="button"
                              tabIndex={0}
                              onClick={(e) => {
                                e.stopPropagation();
                                setPendingDelete(kb);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.stopPropagation();
                                  setPendingDelete(kb);
                                }
                              }}
                              className="grid h-6 w-6 place-items-center rounded-md text-faint opacity-0 transition-opacity hover:bg-danger-soft hover:text-danger group-hover:opacity-100"
                            >
                              <TrashIcon size={13} />
                            </span>
                          </Tooltip>
                        </div>
                      ) : (
                        <span className="flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-medium text-accent">
                          <ShareIcon size={11} />
                          {kb.permission === "write" ? "共享 · 可编辑" : "共享 · 只读"}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-text">
                        {kb.name}
                      </div>
                      <div className="mt-0.5 line-clamp-2 min-h-[2rem] text-xs leading-relaxed text-muted">
                        {kb.description || "暂无描述"}
                      </div>
                    </div>
                    <div className="text-[12px] text-faint">
                      {kb.doc_count ?? 0} 篇文档
                    </div>
                  </button>
                ))}

                {/* 新建知识库卡片 */}
                <button
                  onClick={onCreateKb}
                  className="flex min-h-[7.5rem] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line text-faint transition-all hover:border-accent/50 hover:bg-accent-soft/40 hover:text-accent"
                >
                  <PlusIcon size={22} />
                  <span className="text-xs">新建知识库</span>
                </button>
              </div>
            )}
          </section>

          {/* 最近浏览 */}
          <section className="mt-10">
            <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-text">
              <HistoryIcon size={16} className="text-muted" />
              最近浏览
            </h2>

            {recent.length === 0 ? (
              <div className="rounded-lg border border-line bg-surface px-4 py-8 text-center text-xs text-faint">
                暂无最近浏览
              </div>
            ) : (
              <ul className="overflow-hidden rounded-lg border border-line bg-background">
                {recent.map((r, i) => (
                  <li key={`${r.doc_id}-${i}`}>
                    <button
                      onClick={() => onOpenRecent(r.doc_id, r.kb_id)}
                      className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-hover"
                    >
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-faint">
                        <svg
                          width="15"
                          height="15"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.75"
                        >
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <path d="M14 2v6h6" />
                        </svg>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] text-text group-hover:text-accent">
                          {r.title}
                        </span>
                        <span className="mt-0.5 block truncate text-[12px] text-faint">
                          {kbNameOf(r.kb_id)} · {formatTime(r.viewed_at)}
                        </span>
                      </span>
                    </button>
                    {i < recent.length - 1 && <div className="border-b border-line" />}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* 我的收藏 */}
          <section className="mt-10">
            <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-text">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-muted">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
              我的收藏
            </h2>

            {favorites.length === 0 ? (
              <div className="rounded-lg border border-line bg-surface px-4 py-8 text-center text-xs text-faint">
                暂无收藏，在文档右上角点击「收藏」即可加入
              </div>
            ) : (
              <ul className="overflow-hidden rounded-lg border border-line bg-background">
                {favorites.map((d, i) => (
                  <li key={d.id}>
                    <button
                      onClick={() => onOpenFavorite(d)}
                      className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-hover"
                    >
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                        </svg>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] text-text group-hover:text-accent">
                          {d.title}
                        </span>
                        <span className="mt-0.5 block truncate text-[12px] text-faint">
                          {kbNameOf(d.kb_id ?? null)}
                        </span>
                      </span>
                    </button>
                    {i < favorites.length - 1 && <div className="border-b border-line" />}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="删除知识库"
        message={`确定要删除知识库「${pendingDelete?.name ?? ""}」吗？其中的文档将一并删除，此操作不可恢复。`}
        confirmText="删除"
        cancelText="取消"
        onConfirm={() => {
          if (pendingDelete) onDeleteKb(pendingDelete.id);
          setPendingDelete(null);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
