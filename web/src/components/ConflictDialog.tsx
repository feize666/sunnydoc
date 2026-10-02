"use client";

import { useEffect, useState } from "react";
import { AlertIcon } from "./icons";
import { useModalFocus } from "@/lib/useModalFocus";

function formatTime(ts: number): string {
  const d = new Date(ts * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 保存冲突对话框。
 *
 * 触发场景：用户编辑期间，他人已保存同一文档，本地 `revision` 已过期。
 * 服务端返回 409 并附上最新状态，此处置信「绝不静默覆盖」——把选择权交给用户。
 *
 * 三个出口：
 *  - 保留我的：以服务端最新 revision 为基线强制保存，覆盖对方内容
 *  - 采用对方：丢弃本地草稿，重新拉取服务端内容
 *  - 继续编辑（右上角 × / Esc / 点遮罩）：什么都不做，草稿仍在，稍后再决定
 *
 * 刻意不做「自动合并」：正文是 Markdown 纯文本，自动合并极易产生语义错乱
 * （如两处修改交错），让用户看着两个版本自己选更安全。
 */
export function ConflictDialog({
  open,
  currentTitle,
  currentUpdatedAt,
  onKeepMine,
  onTakeTheirs,
  onCancel,
  busy = false,
}: {
  open: boolean;
  /** 服务端最新标题（可能已被对方改过）。 */
  currentTitle?: string;
  /** 服务端最后一次修改时间（epoch 秒）。 */
  currentUpdatedAt?: number;
  onKeepMine: () => void;
  onTakeTheirs: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  const panelRef = useModalFocus<HTMLDivElement>(open, onCancel, "该文档已被他人修改");

  // 服务端未返回 updatedAt 时本就不该渲染时间行 —— 用 hasTime 显式判定，
  // 而不是靠 `currentUpdatedAt &&` 的短路（0 会被当作 falsy 而漏显）。
  const hasTime = typeof currentUpdatedAt === "number" && currentUpdatedAt > 0;

  if (!open) return null;

  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div
        ref={panelRef}
        className="dialog-panel w-[460px] max-w-[92vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 px-5 py-4">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-warning-soft text-warning">
            <AlertIcon size={20} />
          </div>
          <div className="min-w-0 flex-1 pt-0.5">
            <div className="text-sm font-semibold text-text">该文档已被他人修改</div>
            <div className="mt-1 text-[14px] leading-relaxed text-muted">
              你在编辑期间，他人保存了新的内容。请选择保留哪一份。
            </div>
            {hasTime && (
              <div className="mt-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-[12px] text-muted">
                <div className="flex items-center gap-1.5">
                  <span className="text-faint">对方版本：</span>
                  <span className="min-w-0 flex-1 truncate text-text">
                    {currentTitle || "（无标题）"}
                  </span>
                </div>
                <div className="mt-0.5 text-[11px] text-faint">
                  更新于 {formatTime(currentUpdatedAt!)}
                </div>
              </div>
            )}
            <div className="mt-2 text-[12px] leading-relaxed text-faint">
              选择「保留我的」会覆盖对方的内容，且无法撤销。
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
          <button onClick={onCancel} disabled={busy} className="btn btn-secondary">
            继续编辑
          </button>
          <button onClick={onTakeTheirs} disabled={busy} className="btn btn-secondary">
            采用对方
          </button>
          <button
            onClick={onKeepMine}
            disabled={busy}
            className="btn bg-danger-solid hover:bg-danger-solid-hover text-white"
          >
            {busy ? "保存中…" : "保留我的"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 供调用方判断「是否需要弹窗」的轻量 hook（避免在组件里散落 open 状态）。 */
export function useConflictDialog() {
  const [conflict, setConflict] = useState<{
    currentRevision: number;
    currentTitle?: string;
    currentUpdatedAt?: number;
  } | null>(null);

  useEffect(() => {
    // 文档卸载时清空，避免残留的冲突状态在下一次打开时误弹。
    return () => setConflict(null);
  }, []);

  return { conflict, setConflict, close: () => setConflict(null) };
}