"use client";

import type { DocMeta } from "@/lib/api";
import { CloseIcon } from "./icons";

/** 全局收藏入口浮层：展示收藏的文档，点击打开。 */
export function FavoritesPopover({
  open,
  onClose,
  favorites,
  onOpen,
}: {
  open: boolean;
  onClose: () => void;
  favorites: DocMeta[];
  onOpen: (doc: DocMeta) => void;
}) {
  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />
      <div className="fixed right-6 top-16 z-50 flex max-h-[70vh] w-[340px] max-w-[90vw] flex-col overflow-hidden rounded-xl border border-line bg-background shadow-lg">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <span className="text-[14px] font-semibold text-text">我的收藏</span>
          <button
            onClick={onClose}
            className="grid h-6 w-6 place-items-center rounded-md text-faint transition-colors hover:bg-hover hover:text-text"
          >
            <CloseIcon size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-1.5">
          {favorites.length === 0 ? (
            <div className="px-3 py-8 text-center text-[13px] text-faint">
              暂无收藏，打开文档点击「收藏」即可加入
            </div>
          ) : (
            <ul>
              {favorites.map((d) => (
                <li key={d.id}>
                  <button
                    onClick={() => {
                      onOpen(d);
                      onClose();
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-hover"
                  >
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                      </svg>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] text-text">{d.title}</span>
                      <span className="block truncate text-[12px] text-faint">{d.source}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
