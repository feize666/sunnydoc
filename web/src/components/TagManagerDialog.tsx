"use client";

import { useCallback, useEffect, useState } from "react";
import { tagStats, renameTag, type TagStat } from "@/lib/api";
import { useModalFocus } from "@/lib/useModalFocus";
import { useToast } from "./Toast";
import { CloseIcon } from "./icons";

/**
 * 标签管理（P4-2）：重命名 / 合并 / 删除。
 *
 * 为什么要有这个对话框：标签只能逐篇设置（`PUT /documents/{id}/tags`），
 * 打错一个字（如「前端」写成「前段」）就只能在每篇文档里逐个改 ——
 * 篇数一多就没人愿意收拾，标签体系会自然腐烂。
 *
 * 合并语义复用后端：把 A 改成已存在的 B，后端会**逐篇去重**，
 * 不会出现同一篇文档同时挂 A、B 两个同名标签。
 * 删除 = 重命名为空串（同一条接口，避免多做一个只改一个字段的端点）。
 */
export function TagManagerDialog({
  open,
  onClose,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  /** 任何标签变更成功后回调（父层刷新文档列表 / 标签浏览区）。 */
  onChanged: () => void;
}) {
  const toast = useToast();
  const [stats, setStats] = useState<TagStat[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const panelRef = useModalFocus<HTMLDivElement>(open, onClose, "标签管理");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setStats(await tagStats());
    } catch (e) {
      toast.error(`加载标签失败：${e instanceof Error ? e.message : "未知错误"}`);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (open) {
      void load();
      setEditing(null);
      setConfirmDelete(null);
    }
  }, [open, load]);

  if (!open) return null;

  const submitRename = async (oldName: string) => {
    const next = draft.trim();
    if (next === oldName) {
      setEditing(null);
      return;
    }
    setBusy(oldName);
    try {
      const res = await renameTag(oldName, next);
      // 合并到已存在标签时，篇数是叠加的 —— 提示里说清，用户才知道发生了什么
      toast.success(
        next
          ? `「${oldName}」已改为「${next}」，更新 ${res.updated} 篇`
          : `已删除标签「${oldName}」，更新 ${res.updated} 篇`,
      );
      setEditing(null);
      await load();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(null);
    }
  };

  const submitDelete = async (tag: string) => {
    setBusy(tag);
    try {
      const res = await renameTag(tag, "");
      toast.success(`已删除标签「${tag}」，更新 ${res.updated} 篇`);
      setConfirmDelete(null);
      await load();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "删除失败");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        ref={panelRef}
        className="dialog-panel w-[520px] max-w-[92vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <span className="text-sm font-semibold">标签管理</span>
          <button onClick={onClose} aria-label="关闭" className="icon-btn text-muted hover:text-text">
            <CloseIcon size={16} />
          </button>
        </div>

        <div className="p-4">
          <p className="mb-3 text-[13px] text-muted">
            重命名会同步更新所有使用该标签的文档。改成
            <span className="font-medium text-text">已存在的标签名</span>
            即为合并（自动去重）。
          </p>

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-faint">
              <span className="spinner" />
              加载中…
            </div>
          ) : stats.length === 0 ? (
            <div className="rounded-lg border border-line bg-surface px-4 py-10 text-center text-sm text-faint">
              还没有任何标签。在文档的「更多操作 → 标签…」里可以给文档打标签。
            </div>
          ) : (
            <ul className="max-h-[380px] overflow-y-auto rounded-lg border border-line">
              {stats.map((s, i) => (
                <li key={s.tag}>
                  <div className="flex items-center gap-2 px-3 py-2">
                    {editing === s.tag ? (
                      <>
                        <input
                          autoFocus
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void submitRename(s.tag);
                            else if (e.key === "Escape") setEditing(null);
                          }}
                          maxLength={50}
                          className="input input-sm min-w-0 flex-1"
                          data-testid="tag-rename-input"
                        />
                        <button
                          onClick={() => void submitRename(s.tag)}
                          disabled={busy === s.tag}
                          className="btn btn-primary !px-2.5 !py-1 !text-[13px]"
                          data-testid="tag-rename-confirm"
                        >
                          {busy === s.tag ? "保存中…" : "保存"}
                        </button>
                        <button
                          onClick={() => setEditing(null)}
                          className="btn btn-secondary !px-2 !py-1 !text-[13px]"
                        >
                          取消
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="min-w-0 flex-1 truncate text-[14px] text-text" title={s.tag}>
                          {s.tag}
                        </span>
                        <span className="shrink-0 text-[12px] text-faint">{s.count} 篇</span>
                        <button
                          onClick={() => {
                            setEditing(s.tag);
                            setDraft(s.tag);
                          }}
                          className="btn btn-secondary !px-2 !py-1 !text-[13px]"
                          data-testid={`tag-rename-${s.tag}`}
                        >
                          重命名
                        </button>
                        {confirmDelete === s.tag ? (
                          <>
                            <button
                              onClick={() => void submitDelete(s.tag)}
                              disabled={busy === s.tag}
                              className="btn bg-danger-solid !px-2 !py-1 !text-[13px] text-white hover:bg-danger-solid-hover disabled:opacity-60"
                              data-testid="tag-delete-confirm"
                            >
                              {busy === s.tag ? "删除中…" : "确定删除"}
                            </button>
                            <button
                              onClick={() => setConfirmDelete(null)}
                              className="btn btn-secondary !px-2 !py-1 !text-[13px]"
                            >
                              取消
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => setConfirmDelete(s.tag)}
                            className="btn btn-secondary !px-2 !py-1 !text-[13px] text-danger"
                            data-testid={`tag-delete-${s.tag}`}
                          >
                            删除
                          </button>
                        )}
                      </>
                    )}
                  </div>
                  {i < stats.length - 1 && <div className="border-b border-line" />}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-3 flex justify-end">
            <button onClick={onClose} className="btn btn-secondary !px-3 !py-1.5 !text-[13px]">
              完成
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}