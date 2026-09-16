"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  listTrash,
  restoreTrash,
  purgeTrash,
  type TrashKind,
  type TrashItem,
} from "@/lib/api";
import { ConfirmDialog } from "./ConfirmDialog";
import { Tooltip } from "./Tooltip";
import { EmptyState } from "./EmptyState";
import { useToast } from "./Toast";
import { useFlipList } from "@/hooks/useFlipList";

function BackIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5M12 19l-7-7 7-7" />
    </svg>
  );
}

/** 自定义复选框：checked = true / false / "indeterminate" */
function Checkbox({
  checked,
  onChange,
  title,
}: {
  checked: boolean | "indeterminate";
  onChange: () => void;
  title?: string;
}) {
  const isOn = checked === true;
  const isPartial = checked === "indeterminate";
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      title={title}
      aria-checked={isPartial ? "mixed" : isOn}
      role="checkbox"
      className={`grid h-4 w-4 shrink-0 place-items-center rounded border transition-colors ${
        isOn || isPartial
          ? "border-accent bg-accent text-white"
          : "border-line bg-background text-transparent hover:border-accent/50"
      }`}
    >
      {isOn ? (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6L9 17l-5-5" />
        </svg>
      ) : isPartial ? (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
          <path d="M5 12h14" />
        </svg>
      ) : null}
    </button>
  );
}

export function TrashView({ onBack }: { onBack: () => void }) {
  const toast = useToast();
  const [data, setData] = useState<{
    documents: TrashItem[];
    folders: TrashItem[];
    kbs: TrashItem[];
  }>({ documents: [], folders: [], kbs: [] });
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pendingPurge, setPendingPurge] = useState<{ kind: TrashKind; item: TrashItem } | null>(null);
  const [pendingBatchPurge, setPendingBatchPurge] = useState(false);
  const [busy, setBusy] = useState(false);
  const [exiting, setExiting] = useState<Set<string>>(new Set());

  const keyOf = (kind: TrashKind, id: string) => `${kind}:${id}`;

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

  const allItems = useMemo(() => {
    const map = (kind: TrashKind) => (i: TrashItem) => ({ kind, item: i });
    return [
      ...data.documents.map(map("document")),
      ...data.folders.map(map("folder")),
      ...data.kbs.map(map("kb")),
    ];
  }, [data]);

  const total = allItems.length;
  const listRef = useFlipList<HTMLDivElement>(allItems);

  // 退出动画：标记项 → 播放缩小淡出 → 动画结束后从数据移除（触发剩余项 FLIP 上移）
  const addExiting = (keys: string[]) =>
    setExiting((prev) => {
      const n = new Set(prev);
      keys.forEach((k) => n.add(k));
      return n;
    });
  const removeExiting = (keys: string[]) =>
    setExiting((prev) => {
      const n = new Set(prev);
      keys.forEach((k) => n.delete(k));
      return n;
    });
  const reloadAfterExit = (keys: string[]) =>
    setTimeout(() => {
      load().finally(() => removeExiting(keys));
    }, 200);

  // 全选状态
  const allKeys = useMemo(() => allItems.map(({ kind, item }) => keyOf(kind, item.id)), [allItems]);
  const selectedCount = useMemo(
    () => allKeys.filter((k) => selected.has(k)).length,
    [allKeys, selected],
  );
  const isAllSelected = total > 0 && selectedCount === total;
  const isSomeSelected = selectedCount > 0 && !isAllSelected;

  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (isAllSelected) {
        allKeys.forEach((k) => next.delete(k));
      } else {
        allKeys.forEach((k) => next.add(k));
      }
      return next;
    });
  };

  const toggleSection = (kind: TrashKind, items: TrashItem[]) => {
    const keys = items.map((i) => keyOf(kind, i.id));
    const allOn = keys.every((k) => selected.has(k));
    setSelected((prev) => {
      const next = new Set(prev);
      keys.forEach((k) => (allOn ? next.delete(k) : next.add(k)));
      return next;
    });
  };

  const toggleItem = (kind: TrashKind, id: string) => {
    const k = keyOf(kind, id);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const clearSelection = () => setSelected(new Set());

  const handleRestore = async (kind: TrashKind, id: string) => {
    const k = keyOf(kind, id);
    addExiting([k]);
    try {
      await restoreTrash(kind, id);
      toast.success("已恢复");
      reloadAfterExit([k]);
    } catch (e) {
      toast.error(`恢复失败：${e instanceof Error ? e.message : "未知错误"}`);
      removeExiting([k]);
    }
  };

  const handlePurge = async () => {
    if (!pendingPurge) return;
    const k = keyOf(pendingPurge.kind, pendingPurge.item.id);
    setPendingPurge(null);
    addExiting([k]);
    try {
      await purgeTrash(pendingPurge.kind, pendingPurge.item.id);
      toast.success("已彻底删除");
      reloadAfterExit([k]);
    } catch (e) {
      toast.error(`彻底删除失败：${e instanceof Error ? e.message : "未知错误"}`);
      removeExiting([k]);
    }
  };

  // 批量恢复
  const handleBatchRestore = async () => {
    setBusy(true);
    const targetKeys: string[] = [];
    let ok = 0;
    let fail = 0;
    for (const { kind, item } of allItems) {
      if (!selected.has(keyOf(kind, item.id))) continue;
      targetKeys.push(keyOf(kind, item.id));
    }
    addExiting(targetKeys);
    for (const { kind, item } of allItems) {
      if (!selected.has(keyOf(kind, item.id))) continue;
      try {
        await restoreTrash(kind, item.id);
        ok++;
      } catch {
        fail++;
      }
    }
    setBusy(false);
    clearSelection();
    reloadAfterExit(targetKeys);
    if (fail === 0) toast.success(`已恢复 ${ok} 项`);
    else toast.warning(`恢复完成：成功 ${ok} 项，失败 ${fail} 项`);
  };

  // 批量彻底删除
  const handleBatchPurge = async () => {
    setBusy(true);
    const targetKeys: string[] = [];
    let ok = 0;
    let fail = 0;
    for (const { kind, item } of allItems) {
      if (!selected.has(keyOf(kind, item.id))) continue;
      targetKeys.push(keyOf(kind, item.id));
    }
    addExiting(targetKeys);
    for (const { kind, item } of allItems) {
      if (!selected.has(keyOf(kind, item.id))) continue;
      try {
        await purgeTrash(kind, item.id);
        ok++;
      } catch {
        fail++;
      }
    }
    setBusy(false);
    setPendingBatchPurge(false);
    clearSelection();
    reloadAfterExit(targetKeys);
    if (fail === 0) toast.success(`已彻底删除 ${ok} 项`);
    else toast.warning(`删除完成：成功 ${ok} 项，失败 ${fail} 项`);
  };

  const renderSection = (
    title: string,
    items: TrashItem[],
    kind: TrashKind,
  ) => {
    if (items.length === 0) return null;
    const keys = items.map((i) => keyOf(kind, i.id));
    const sectionSelected = keys.filter((k) => selected.has(k)).length;
    const sectionAll = sectionSelected === items.length;
    const sectionPartial = sectionSelected > 0 && !sectionAll;
    return (
      <section className="mt-6">
        <div className="mb-2 flex items-center gap-2">
          <Checkbox
            checked={sectionAll ? true : sectionPartial ? "indeterminate" : false}
            onChange={() => toggleSection(kind, items)}
            title={sectionAll ? "取消选择" : "全选"}
          />
          <h2 className="text-[14px] font-semibold text-muted">{title}</h2>
          <span className="text-[12px] text-faint">({items.length})</span>
        </div>
        <ul className="overflow-hidden rounded-xl border border-line bg-surface">
          {items.map((item, i) => {
            const k = keyOf(kind, item.id);
            const on = selected.has(k);
            return (
              <li
                key={item.id}
                data-flip-key={keyOf(kind, item.id)}
                className={exiting.has(keyOf(kind, item.id)) ? "anim-exit" : undefined}
              >
                <div
                  className={`flex items-center gap-3 px-4 py-2.5 transition-colors ${on ? "bg-accent/5" : ""}`}
                >
                  <Checkbox
                    checked={on}
                    onChange={() => toggleItem(kind, item.id)}
                    title={on ? "取消选择" : "选择"}
                  />
                  <span
                    className="min-w-0 flex-1 cursor-pointer truncate text-[15px] text-text"
                    onClick={() => toggleItem(kind, item.id)}
                  >
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
            );
          })}
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
        {!loading && total > 0 && (
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={toggleAll}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-muted transition-colors hover:bg-hover hover:text-text"
            >
              <Checkbox
                checked={isAllSelected ? true : isSomeSelected ? "indeterminate" : false}
                onChange={toggleAll}
                title={isAllSelected ? "取消全选" : "全选"}
              />
              <span>{isAllSelected ? "取消全选" : "全选"}</span>
            </button>
          </div>
        )}
      </header>

      {/* 批量操作栏 */}
      {selectedCount > 0 && (
        <div className="flex shrink-0 items-center gap-2 border-b border-line bg-accent/5 px-4 py-2">
          <span className="text-[13px] text-text">已选 {selectedCount} 项</span>
          <button
            onClick={clearSelection}
            className="rounded-md px-2 py-1 text-[13px] text-muted transition-colors hover:bg-hover hover:text-text"
          >
            取消选择
          </button>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={handleBatchRestore}
              disabled={busy}
              className="rounded-md border border-line px-2.5 py-1 text-[13px] text-muted transition-colors hover:border-accent/40 hover:text-accent disabled:opacity-50"
            >
              批量恢复
            </button>
            <button
              onClick={() => setPendingBatchPurge(true)}
              disabled={busy}
              className="rounded-md border border-danger/40 px-2.5 py-1 text-[13px] text-danger transition-colors hover:bg-danger-soft disabled:opacity-50"
            >
              彻底删除
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        <div ref={listRef} className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
          {!loading && total === 0 && (
            <EmptyState
              icon={
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6" />
                </svg>
              }
              title="回收站是空的"
              description="删除的文档、文件夹和知识库会先进入回收站，可在此恢复"
            />
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

      <ConfirmDialog
        open={pendingBatchPurge}
        title="彻底删除"
        message={`确定要彻底删除选中的 ${selectedCount} 项吗？此操作不可恢复。`}
        confirmText="彻底删除"
        cancelText="取消"
        onConfirm={handleBatchPurge}
        onCancel={() => setPendingBatchPurge(false)}
      />
    </div>
  );
}
