"use client";

import { useMemo } from "react";

/**
 * 知识库总览（进入知识库、未打开任何文档时的主区）。
 *
 * ## 为什么需要它
 *
 * 原来这里只有一份「最近浏览」：20 条、行高 69px、总高 **1501px**，
 * 1366×768 的笔记本上首屏只能看到 10 条，而且**没有任何"这个知识库有什么"的信息**
 * —— 目录结构、文档规模、收藏、置顶，全都要靠侧栏树自己翻。
 *
 * 对比语雀 / Notion：进入知识库的第一屏是**总览**（多少个文档、几个目录、
 * 最近编辑、收藏），「最近浏览」只是其中一块。本组件就是补上这一层。
 *
 * ## 设计取舍
 *
 * - **不新增接口**：全部由已有的 `metas` / `folders` / `recent` 在前端算，
 *   打开知识库不用多打一次网络请求（首屏速度优先）。
 * - **信息按"要不要动手"排序**：置顶（最该看的）→ 收藏 → 目录 → 最近浏览。
 *   「最近浏览」原来独占主区，现在降为最后一块 —— 它是"回头看"，
 *   不是"这里有什么"。
 * - **目录块可点**：直接进该目录（走 `onOpenFolder`），比在树里找快。
 * - **空知识库要有起点**：一个文档都没有时给「新建文档 / 导入」两个动作，
 *   而不是一句"暂无"（Notion 空态给三个起点，同理）。
 */
export function KbOverview({
  kbName,
  docCount,
  folderCount,
  folders,
  pinnedDocs,
  favoriteDocs,
  recent,
  onOpenDoc,
  onOpenRecent,
  onOpenFolder,
  onNewDoc,
  onImport,
}: {
  kbName: string;
  docCount: number;
  folderCount: number;
  folders: { id: string; name: string; count: number }[];
  pinnedDocs: { id: string; title: string }[];
  favoriteDocs: { id: string; title: string }[];
  recent: { doc_id: string; kb_id: string | null; title: string; source?: string }[];
  onOpenDoc: (id: string) => void;
  onOpenRecent: (docId: string, kbId: string | null) => void;
  onOpenFolder: (id: string) => void;
  onNewDoc: () => void;
  onImport: () => void;
}) {
  const isEmpty = docCount === 0 && folderCount === 0;

  // 「最近浏览」只留前 8 条：它是补充信息，不该占满整屏。
  const recentTop = useMemo(() => recent.slice(0, 8), [recent]);

  return (
    <main className="flex-1 overflow-y-auto bg-background">
      <div className="mx-auto max-w-[1000px] px-4 py-8 sm:px-10">
        {/* ---- 抬头：这个知识库叫什么、有多大 ---- */}
        <header className="mb-7">
          <h1 className="text-[26px] font-semibold leading-tight text-text">{kbName}</h1>
          <p className="mt-1.5 text-[13px] text-faint">
            {docCount} 篇文档
            {folderCount > 0 && ` · ${folderCount} 个目录`}
            {isEmpty && " · 还没有内容"}
          </p>
        </header>

        {isEmpty ? (
          /* 空知识库：给起点，而不是一句"暂无" */
          <div className="rounded-xl border border-dashed border-line-strong bg-surface px-6 py-12 text-center">
            <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-xl border border-line bg-accent-soft text-accent">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <path d="M14 2v6h6M12 18v-6M9 15h6" />
              </svg>
            </div>
            <div className="text-[15px] font-semibold text-text">这个知识库还是空的</div>
            <p className="mx-auto mt-1 max-w-[340px] text-[13px] leading-relaxed text-faint">
              先建第一篇文档，或把已有的 Markdown / 压缩包导进来
            </p>
            <div className="mt-4 flex items-center justify-center gap-2">
              <button onClick={onNewDoc} className="btn btn-accent text-white">
                新建文档
              </button>
              <button onClick={onImport} className="btn btn-secondary">
                导入文档
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-7">
            {/* ---- 置顶：最该先看的 ---- */}
            {pinnedDocs.length > 0 && (
              <section>
                <h2 className="section-heading mb-3">
                  置顶
                  <span className="ml-1.5 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium tabular-nums text-faint">
                    {pinnedDocs.length}
                  </span>
                </h2>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {pinnedDocs.slice(0, 6).map((d) => (
                    <button
                      key={d.id}
                      onClick={() => onOpenDoc(d.id)}
                      className="group flex min-h-11 items-center gap-2.5 rounded-lg border border-line bg-surface px-3 py-2.5 text-left transition-colors hover:border-accent/40 hover:bg-hover"
                    >
                      <PinGlyph />
                      <span className="min-w-0 flex-1 truncate text-[14px] text-text group-hover:text-accent">
                        {d.title}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* ---- 收藏 ---- */}
            {favoriteDocs.length > 0 && (
              <section>
                <h2 className="section-heading mb-3">
                  收藏
                  <span className="ml-1.5 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium tabular-nums text-faint">
                    {favoriteDocs.length}
                  </span>
                </h2>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {favoriteDocs.slice(0, 6).map((d) => (
                    <button
                      key={d.id}
                      onClick={() => onOpenDoc(d.id)}
                      className="group flex min-h-11 items-center gap-2.5 rounded-lg border border-line bg-surface px-3 py-2.5 text-left transition-colors hover:border-accent/40 hover:bg-hover"
                    >
                      <StarGlyph />
                      <span className="min-w-0 flex-1 truncate text-[14px] text-text group-hover:text-accent">
                        {d.title}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* ---- 目录：这个知识库的结构 ---- */}
            {folders.length > 0 && (
              <section>
                <h2 className="section-heading mb-3">
                  目录
                  <span className="ml-1.5 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium tabular-nums text-faint">
                    {folderCount}
                  </span>
                </h2>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {folders.slice(0, 9).map((f) => (
                    <button
                      key={f.id}
                      onClick={() => onOpenFolder(f.id)}
                      className="group flex min-h-11 items-center gap-2.5 rounded-lg border border-line bg-surface px-3 py-2.5 text-left transition-colors hover:border-accent/40 hover:bg-hover"
                    >
                      <FolderGlyph />
                      <span className="min-w-0 flex-1 truncate text-[14px] text-text group-hover:text-accent">
                        {f.name}
                      </span>
                      <span className="shrink-0 tabular-nums text-[12px] text-faint">{f.count}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* ---- 最近浏览：补充，不再独占整屏 ---- */}
            <section>
              <h2 className="section-heading mb-3">最近浏览</h2>
              {recentTop.length === 0 ? (
                <p className="rounded-lg border border-line bg-surface px-3 py-3 text-[13px] text-faint">
                  还没有浏览记录。从左侧目录选一篇打开，之后会出现在这里。
                </p>
              ) : (
                <ul className="overflow-hidden rounded-xl border border-line bg-surface">
                  {recentTop.map((r, i) => (
                    <li key={`${r.doc_id}-${i}`}>
                      <button
                        onClick={() => onOpenRecent(r.doc_id, r.kb_id)}
                        className="group flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-hover"
                      >
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted">
                          <DocGlyph />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[14px] text-text group-hover:text-accent">
                          {r.title}
                        </span>
                        <span className="shrink-0 text-[12px] text-faint">{r.source ?? ""}</span>
                      </button>
                      {i < recentTop.length - 1 && <div className="mx-4 border-b border-line" />}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}

/* ---- 图标：与全站同一套线性风格（1.75 描边） ---- */
function PinGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-accent">
      <path d="M12 17v5M5 12l-1 1 6 6 1-1M14 3l6 6-3 3-1-1-2 2-2-2 2-2-1-1 3-3z" />
    </svg>
  );
}
function StarGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-accent">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}
function FolderGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}
function DocGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}