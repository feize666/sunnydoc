"use client";

import { useState } from "react";
import type { Kb, RecentDoc, User, DocMeta, Stats } from "@/lib/api";
import { ConfirmDialog } from "./ConfirmDialog";
import { Tooltip } from "./Tooltip";
import { UserMenu } from "./UserMenu";
import { ThemeToggle } from "./ThemeToggle";
import { PlusIcon, TrashIcon, HistoryIcon, FolderIcon, EditIcon, FileIcon, AlertIcon, ShareIcon } from "./icons";
import { EmptyState } from "./EmptyState";
import { useFlipList } from "@/hooks/useFlipList";

function StarIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
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

/** 按当前时段返回问候语（欢迎条用）。 */
function greeting(): string {
  const h = new Date().getHours();
  if (h < 6) return "夜深了";
  if (h < 11) return "早上好";
  if (h < 14) return "中午好";
  if (h < 18) return "下午好";
  return "晚上好";
}

/* —— 数据看板图表（纯 SVG / CSS，不引第三方图表库） —— */

function TrendChart({ data }: { data: { date: string; count: number }[] }) {
  if (!data || data.length < 2) return null;
  const w = 560;
  const h = 150;
  const padX = 8;
  const padY = 22;
  const max = Math.max(1, ...data.map((d) => d.count));
  const total = data.reduce((s, d) => s + d.count, 0);
  const avg = Math.round(total / data.length);
  const stepX = (w - padX * 2) / (data.length - 1);
  const pts = data.map((d, i) => ({
    x: padX + i * stepX,
    y: h - padY - (d.count / max) * (h - padY * 2),
    ...d,
  }));
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ");
  const area = `${line} L${pts[pts.length - 1].x},${h - padY} L${pts[0].x},${h - padY} Z`;
  const labelEvery = Math.max(1, Math.ceil(data.length / 7));
  return (
    <div>
      {/* 图上摘要：总量 / 日均，让趋势一眼可读 */}
      <div className="mb-3 flex items-baseline gap-4">
        <span className="flex items-baseline gap-1.5">
          <span className="text-[20px] font-semibold leading-none text-text">{total}</span>
          <span className="text-[12px] text-faint">近 {data.length} 天新增</span>
        </span>
        <span className="flex items-baseline gap-1.5">
          <span className="text-[14px] font-medium leading-none text-muted">{avg}</span>
          <span className="text-[12px] text-faint">日均</span>
        </span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label="文档创建趋势">
        <defs>
          <linearGradient id="trend-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.26" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75, 1].map((r) => {
          const y = h - padY - (h - padY * 2) * r;
          return (
            <line key={r} x1={padX} x2={w - padX} y1={y} y2={y} stroke="var(--line)" strokeDasharray="3 3" />
          );
        })}
        <path d={area} fill="url(#trend-area)" />
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {pts.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={p.count === max && max > 0 ? 4 : 3} fill="var(--background)" stroke="var(--accent)" strokeWidth="2" />
            {i % labelEvery === 0 && (
              <text x={p.x} y={h - 5} textAnchor="middle" fontSize="10" fill="var(--faint)">
                {p.date}
              </text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}

function KbBarChart({ data }: { data: { name: string; count: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="flex flex-col gap-3">
      {data.map((d, i) => (
        <div key={i} className="flex items-center gap-2.5">
          <span className="w-24 shrink-0 truncate text-right text-[12px] text-muted" title={d.name}>
            {d.name}
          </span>
          <div className="h-4 flex-1 overflow-hidden rounded bg-surface-2">
            <div
              className="h-full rounded transition-[width] duration-500 ease-out"
              style={{
                width: `${(d.count / max) * 100}%`,
                background: "var(--accent)",
                opacity: 0.35 + 0.65 * (d.count / max),
              }}
            />
          </div>
          <span className="w-8 shrink-0 text-right text-[12px] tabular-nums text-faint">{d.count}</span>
        </div>
      ))}
    </div>
  );
}

function TagCloud({ data }: { data: { name: string; count: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="flex flex-wrap gap-2">
      {data.map((d, i) => {
        const size = 12 + Math.round((d.count / max) * 6);
        const weight = d.count / max > 0.6 ? 600 : 500;
        return (
          <span
            key={i}
            className="inline-flex items-center rounded-full bg-accent-soft px-3 py-1 text-accent transition-colors hover:bg-accent-solid hover:text-white"
            style={{ fontSize: size, fontWeight: weight }}
          >
            #{d.name}
            <span className="ml-1.5 text-[10px] tabular-nums opacity-60">{d.count}</span>
          </span>
        );
      })}
    </div>
  );
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

  // FLIP 动画：最近浏览/收藏列表项增删、重排时平滑移动
  const recentListRef = useFlipList<HTMLUListElement>(recent);
  const favListRef = useFlipList<HTMLUListElement>(favorites);

  const kbNameOf = (kbId: string | null) =>
    kbId ? kbs.find((k) => k.id === kbId)?.name ?? "未知知识库" : "全部文档";

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-line bg-background px-5 select-none">
        <div className="flex min-w-0 items-center gap-3">
          <span className="logo-mark grid h-8 w-8 shrink-0 place-items-center rounded-lg text-sm font-bold">
            知
          </span>
          <div className="min-w-0 leading-tight">
            <div className="text-[16px] font-semibold text-text">知库</div>
            <div className="truncate text-[12px] text-faint">文档知识库</div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={onOpenPalette}
            className="group flex min-w-[200px] items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-xs text-faint transition-colors hover:border-accent/40 hover:bg-background hover:text-muted"
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

          <button
            onClick={onCreateKb}
            className="btn btn-accent btn-sm text-white"
            title="新建知识库"
          >
            <PlusIcon size={14} />
            新建知识库
          </button>

          <ThemeToggle theme={theme} onToggle={onToggleTheme} />

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
        <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
          {/* 欢迎条：渐变品牌面 + 实时概览 */}
          <section className="hero-surface anim-rise-in mb-6 overflow-hidden rounded-2xl px-4 py-5 sm:px-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="min-w-0">
                <div className="text-[20px] font-semibold tracking-tight">
                  {greeting()}，{user?.nickname || user?.username || "你好"}
                </div>
                <p className="mt-1.5 text-[13px] text-[var(--hero-ink-muted)]">
                  {stats && stats.total_docs > 0
                    ? `已沉淀 ${stats.total_docs} 篇文档，分布在 ${stats.total_kbs} 个知识库`
                    : "创建第一个知识库，开始整理你的文档"}
                </p>
              </div>
              {favorites.length > 0 && (
                <span className="hero-chip">
                  <StarIcon size={11} />
                  {favorites.length} 篇收藏
                </span>
              )}
            </div>
          </section>

          {/* 数据概览 */}
          {stats && (
            <section className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: "文档", value: stats.total_docs, icon: <FileIcon size={20} /> },
                { label: "知识库", value: stats.total_kbs, icon: <FolderIcon size={20} /> },
                { label: "收藏", value: stats.total_favorites, icon: <StarIcon size={20} /> },
                { label: "最近浏览", value: stats.recent_count, icon: <HistoryIcon size={20} /> },
              ].map((s) => (
                <div key={s.label} className="stat-tile">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
                    {s.icon}
                  </span>
                  <div className="min-w-0 leading-tight">
                    <div
                      className="text-xl font-semibold tabular-nums"
                      style={{
                        backgroundImage: "var(--accent-grad)",
                        WebkitBackgroundClip: "text",
                        backgroundClip: "text",
                        color: "transparent",
                      }}
                    >
                      {s.value}
                    </div>
                    <div className="text-[12px] text-faint">{s.label}</div>
                  </div>
                </div>
              ))}
            </section>
          )}

          {/* 数据看板图表 */}
          {stats &&
            (stats.doc_trend?.length || stats.docs_by_kb?.length || stats.top_tags?.length) && (
              <section className="stagger mb-8 grid grid-cols-1 gap-4 lg:grid-cols-5">
                {stats.doc_trend && stats.doc_trend.length > 0 && (
                  <div className="card p-4 lg:col-span-3">
                    <h3 className="mb-3 text-sm font-semibold text-text">文档创建趋势（近 14 天）</h3>
                    <TrendChart data={stats.doc_trend} />
                  </div>
                )}
                {stats.docs_by_kb && stats.docs_by_kb.length > 0 && (
                  <div className="card p-4 lg:col-span-2">
                    <h3 className="mb-3 text-sm font-semibold text-text">知识库分布</h3>
                    <KbBarChart data={stats.docs_by_kb} />
                  </div>
                )}
                {stats.top_tags && stats.top_tags.length > 0 && (
                  <div className="card p-4 lg:col-span-5">
                    <h3 className="mb-3 text-sm font-semibold text-text">热门标签</h3>
                    <TagCloud data={stats.top_tags} />
                  </div>
                )}
              </section>
            )}

          {/* 知识库 */}
          <section>
            <h2 className="section-heading mb-4">
              知识库
              {kbs.length > 0 && (
                <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium tabular-nums text-faint">
                  {kbs.length}
                </span>
              )}
            </h2>

            {error && (
              <div className="mb-4 flex items-start gap-2 rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-[13px] text-danger">
                <span className="mt-0.5 shrink-0">
                  <AlertIcon size={14} />
                </span>
                <span>{error}（后端服务未启动？）</span>
              </div>
            )}

            {loadingKbs ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="skeleton h-[7.5rem] rounded-lg" />
                ))}
              </div>
            ) : kbs.length === 0 ? (
              <EmptyState
                icon={<FolderIcon size={24} />}
                title="还没有知识库"
                description="创建一个知识库，开始整理你的文档"
                action={
                  <button onClick={onCreateKb} className="btn btn-accent text-white">
                    <PlusIcon size={14} />
                    创建第一个知识库
                  </button>
                }
              />
            ) : (
              <div className="stagger grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {kbs.map((kb) => (
                  <button
                    key={kb.id}
                    onClick={() => onOpenKb(kb.id)}
                    className="group relative flex flex-col gap-2.5 overflow-hidden rounded-xl border border-line bg-background p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-glow"
                  >
                    {/* hover 时顶部浮现渐变装饰条 */}
                    <span className="kb-topline" />
                    <div className="flex items-start justify-between">
                      <span className="kb-badge grid h-9 w-9 place-items-center rounded-lg text-sm font-semibold">
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
                              className="reveal-on-hover grid h-6 w-6 place-items-center rounded-md text-faint hover:bg-hover hover:text-accent"
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
                              className="reveal-on-hover grid h-6 w-6 place-items-center rounded-md text-faint hover:bg-hover hover:text-accent"
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
                              className="reveal-on-hover grid h-6 w-6 place-items-center rounded-md text-faint hover:bg-danger-soft hover:text-danger"
                            >
                              <TrashIcon size={13} />
                            </span>
                          </Tooltip>
                        </div>
                      ) : (
                        <span className="flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
                          <ShareIcon size={11} />
                          {kb.permission === "write" ? "共享 · 可编辑" : "共享 · 只读"}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-text transition-colors group-hover:text-accent">
                        {kb.name}
                      </div>
                      <div className="mt-1 line-clamp-2 min-h-[2rem] text-xs leading-relaxed text-muted">
                        {kb.description || "暂无描述"}
                      </div>
                    </div>
                    <div className="mt-auto flex items-center justify-between border-t border-line pt-2.5">
                      <span className="text-[12px] text-faint">
                        <span className="font-medium tabular-nums text-muted">{kb.doc_count ?? 0}</span> 篇文档
                      </span>
                      <span className="reveal-on-hover-text flex items-center gap-0.5 text-[12px] font-medium text-accent">
                        打开
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M9 6l6 6-6 6" />
                        </svg>
                      </span>
                    </div>
                  </button>
                ))}

                {/* 新建知识库卡片 */}
                <button
                  onClick={onCreateKb}
                  className="flex min-h-[7.5rem] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line text-faint transition-all hover:-translate-y-0.5 hover:border-accent/50 hover:bg-accent-soft/40 hover:text-accent"
                >
                  <PlusIcon size={22} />
                  <span className="text-xs">新建知识库</span>
                </button>
              </div>
            )}
          </section>

          {/* 最近浏览 */}
          <section className="mt-10">
            <h2 className="section-heading mb-3">
              <HistoryIcon size={15} className="text-muted" />
              最近浏览
              {recent.length > 0 && (
                <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium tabular-nums text-faint">
                  {recent.length}
                </span>
              )}
            </h2>

            {recent.length === 0 ? (
              <EmptyState
                icon={<HistoryIcon size={20} />}
                title="暂无最近浏览"
                description="打开过的文档会显示在这里，方便快速回看"
              />
            ) : (
              <ul ref={recentListRef} className="anim-rise-in overflow-hidden rounded-xl border border-line bg-background shadow-sm">
                {recent.map((r, i) => (
                  <li key={r.doc_id} data-flip-key={`recent:${r.doc_id}`}>
                    <button
                      onClick={() => onOpenRecent(r.doc_id, r.kb_id)}
                      className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-hover"
                    >
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-faint transition-colors group-hover:bg-accent-soft group-hover:text-accent">
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
                        <span className="block truncate text-[14px] text-text transition-colors group-hover:text-accent">
                          {r.title}
                        </span>
                        <span className="mt-0.5 block truncate text-[12px] text-faint">
                          {kbNameOf(r.kb_id)} · {formatTime(r.viewed_at)}
                        </span>
                      </span>
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="reveal-on-hover shrink-0 text-faint"
                      >
                        <path d="M9 6l6 6-6 6" />
                      </svg>
                    </button>
                    {i < recent.length - 1 && (
                      <div className="ml-14 border-b border-line" />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* 我的收藏 */}
          <section className="mt-10">
            <h2 className="section-heading mb-3">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" className="text-muted">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
              我的收藏
              {favorites.length > 0 && (
                <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium tabular-nums text-faint">
                  {favorites.length}
                </span>
              )}
            </h2>

            {favorites.length === 0 ? (
              <EmptyState
                icon={<StarIcon size={20} />}
                title="暂无收藏"
                description="在文档右上角点击「收藏」即可加入"
              />
            ) : (
              <ul ref={favListRef} className="anim-rise-in overflow-hidden rounded-xl border border-line bg-background shadow-sm">
                {favorites.map((d, i) => (
                  <li key={d.id} data-flip-key={`fav:${d.id}`}>
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
                        <span className="block truncate text-[14px] text-text transition-colors group-hover:text-accent">
                          {d.title}
                        </span>
                        <span className="mt-0.5 block truncate text-[12px] text-faint">
                          {kbNameOf(d.kb_id ?? null)}
                        </span>
                      </span>
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="reveal-on-hover shrink-0 text-faint"
                      >
                        <path d="M9 6l6 6-6 6" />
                      </svg>
                    </button>
                    {i < favorites.length - 1 && (
                      <div className="ml-14 border-b border-line" />
                    )}
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
