"use client";

import { useState, useEffect, useCallback } from "react";
import {
  listTrash,
  restoreTrash,
  purgeTrash,
  type TrashKind,
  type TrashItem,
} from "@/lib/api";
import { ConfirmDialog } from "./ConfirmDialog";
import { Tooltip } from "./Tooltip";

function BackIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5M12 19l-7-7 7-7" />
    </svg>
  );
}

export function TrashView({ onBack }: { onBack: () => void }) {
  const [data, setData] = useState<{
    documents: TrashItem[];
    folders: TrashItem[];
    kbs: TrashItem[];
  }>({ documents: [], folders: [], kbs: [] });
  const [loading, setLoading] = useState(true);
  const [pendingPurge, setPendingPurge] = useState<{ kind: TrashKind; item: TrashItem } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await listTrash());
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleRestore = async (kind: TrashKind, id: string) => {
    try {
      await restoreTrash(kind, id);
      load();
    } catch (e) {
      alert(`恢复失败：${e instanceof Error ? e.message : "未知错误"}`);
    }
  };

  const handlePurge = async () => {
    if (!pendingPurge) return;
    try {
      await purgeTrash(pendingPurge.kind, pendingPurge.item.id);
      setPendingPurge(null);
      load();
    } catch (e) {
      alert(`彻底删除失败：${e instanceof Error ? e.message : "未知错误"}`);
      setPendingPurge(null);
    }
  };

  const total = data.documents.length + data.folders.length + data.kbs.length;

  const renderSection = (
    title: string,
    items: TrashItem[],
    kind: TrashKind,
  ) => {
    if (items.length === 0) return null;
    return (
      <section className="mt-6">
        <h2 className="mb-2 text-[14px] font-semibold text-muted">{title}</h2>
        <ul className="overflow-hidden rounded-xl border border-line bg-surface">
          {items.map((item, i) => (
            <li key={item.id}>
              <div className="flex items-center gap-3 px-4 py-2.5">
                <span className="min-w-0 flex-1 truncate text-[15px] text-text">
                  {item.title ?? item.name}
                </span>
                <button
                  onClick={() => handleRestore(kind, item.id)}
                  className="rounded-md border border-line px-2.5 py-1 text-xs text-muted transition-colors hover:border-accent/40 hover:text-accent"
                >
                  恢复
                </button>
                <Tooltip content="彻底删除（不可恢复）">
                  <button
                    onClick={() => setPendingPurge({ kind, item })}
                    className="grid h-6 w-6 place-items-center rounded-md text-faint transition-colors hover:bg-danger-soft hover:text-danger"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    </svg>
                  </button>
                </Tooltip>
              </div>
              {i < items.length - 1 && <div className="border-b border-line" />}
            </li>
          ))}
        </ul>
      </section>
    );
  };

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-4">
        <Tooltip content="返回">
          <button
            onClick={onBack}
            className="grid h-8 w-8 place-items-center rounded-md text-muted transition-colors hover:bg-hover hover:text-text"
          >
            <BackIcon />
          </button>
        </Tooltip>
        <div className="leading-tight">
          <div className="text-[16px] font-semibold text-text">回收站</div>
          <div className="text-[12px] text-faint">
            {loading ? "加载中…" : `共 ${total} 项，删除后可在此恢复`}
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-6">
          {!loading && total === 0 && (
            <div className="rounded-xl border border-dashed border-line py-16 text-center text-[14px] text-faint">
              回收站是空的
            </div>
          )}
          {renderSection("文档", data.documents, "document")}
          {renderSection("文件夹", data.folders, "folder")}
          {renderSection("知识库", data.kbs, "kb")}
        </div>
      </div>

      <ConfirmDialog
        open={pendingPurge !== null}
        title="彻底删除"
        message={`确定要彻底删除「${pendingPurge?.item.title ?? pendingPurge?.item.name ?? ""}」吗？此操作不可恢复。`}
        confirmText="彻底删除"
        cancelText="取消"
        onConfirm={handlePurge}
        onCancel={() => setPendingPurge(null)}
      />
    </div>
  );
}
