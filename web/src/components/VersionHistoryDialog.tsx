"use client";

import { useState, useEffect, useCallback } from "react";
import { listDocVersions, rollbackDocument, type DocVersion } from "@/lib/api";
import { CloseIcon } from "./icons";

function formatTime(ts: number): string {
  const d = new Date(ts * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function VersionHistoryDialog({
  open,
  docId,
  onClose,
  onRolledBack,
}: {
  open: boolean;
  docId: string | null;
  onClose: () => void;
  onRolledBack: () => void;
}) {
  const [versions, setVersions] = useState<DocVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!docId) return;
    setLoading(true);
    try {
      setVersions(await listDocVersions(docId));
    } catch {
      setVersions([]);
    } finally {
      setLoading(false);
    }
  }, [docId]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  if (!open || !docId) return null;

  const rollback = async (versionId: string) => {
    if (!window.confirm("回滚到该版本？当前内容会先存为新版本，可再次恢复。")) return;
    setBusyId(versionId);
    try {
      await rollbackDocument(docId, versionId);
      onRolledBack();
      onClose();
    } catch (e) {
      alert(`回滚失败：${e instanceof Error ? e.message : "未知错误"}`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog-panel flex max-h-[70vh] w-[440px] max-w-[92vw] flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div className="text-[14px] font-semibold text-text">版本历史</div>
          <button
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-md text-faint transition-colors hover:bg-hover hover:text-text"
          >
            <CloseIcon size={15} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-2">
          {loading ? (
            <div className="px-3 py-8 text-center text-[13px] text-faint">加载中…</div>
          ) : versions.length === 0 ? (
            <div className="px-3 py-8 text-center text-[13px] text-faint">
              暂无历史版本，保存文档后会自动记录
            </div>
          ) : (
            <ul>
              {versions.map((v) => (
                <li key={v.id}>
                  <div className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-hover">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-text">{v.title}</span>
                      <span className="block text-[11px] text-faint">{formatTime(v.created_at)}</span>
                    </span>
                    <button
                      onClick={() => rollback(v.id)}
                      disabled={busyId === v.id}
                      className="rounded-md border border-line px-2.5 py-1 text-xs text-muted transition-colors hover:border-accent/40 hover:text-accent disabled:opacity-50"
                    >
                      {busyId === v.id ? "回滚中…" : "回滚"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
