"use client";

import { useState, useEffect, useCallback } from "react";
import {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  type Notification,
} from "@/lib/api";

function formatTime(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.toDateString() === now.toDateString()) return hm;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

function TypeIcon({ type }: { type: Notification["type"] }) {
  if (type === "mention") {
    return (
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2a10 10 0 0 1 10 10M12 22a10 10 0 0 1-10-10" />
        </svg>
      </span>
    );
  }
  if (type === "reply") {
    return (
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </span>
    );
  }
  return (
    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="18" cy="5" r="3" />
        <circle cx="6" cy="12" r="3" />
        <circle cx="18" cy="19" r="3" />
        <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
      </svg>
    </span>
  );
}

export function NotificationPanel({
  open,
  onClose,
  onOpenDoc,
  onRead,
}: {
  open: boolean;
  onClose: () => void;
  onOpenDoc: (docId: string, kbId: string | null) => void;
  onRead: (unread: number) => void;
}) {
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listNotifications(50);
      setItems(data.notifications);
      onRead(data.unread);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const openItem = async (n: Notification) => {
    if (!n.read) {
      try {
        await markNotificationRead(n.id);
        setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
        onRead(items.filter((x) => !x.read).length - 1);
      } catch {
        /* ignore */
      }
    }
    if (n.doc_id) {
      onOpenDoc(n.doc_id, n.kb_id ?? null);
      onClose();
    }
  };

  const readAll = async () => {
    try {
      await markAllNotificationsRead();
      setItems((prev) => prev.map((x) => ({ ...x, read: true })));
      onRead(0);
    } catch {
      /* ignore */
    }
  };

  const unread = items.filter((x) => !x.read).length;

  if (!open) return null;

  return (
    <div className="fixed right-24 top-12 z-50 w-[360px] max-w-[92vw] overflow-hidden rounded-xl border border-line bg-surface shadow-xl">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <span className="text-[15px] font-semibold text-text">
          通知
          {unread > 0 && (
            <span className="ml-1.5 rounded-full bg-accent-soft px-1.5 text-[11px] font-medium text-accent">
              {unread}
            </span>
          )}
        </span>
        <div className="flex items-center gap-1">
          {unread > 0 && (
            <button
              onClick={readAll}
              className="rounded-md px-2 py-1 text-[12px] text-accent hover:bg-accent-soft"
            >
              全部已读
            </button>
          )}
          <button
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-md text-faint hover:bg-hover hover:text-text"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <div className="max-h-[420px] overflow-y-auto">
        {loading ? (
          <div className="py-10 text-center text-[13px] text-faint">加载中…</div>
        ) : items.length === 0 ? (
          <div className="py-12 text-center text-[13px] text-faint">暂无通知</div>
        ) : (
          <ul>
            {items.map((n, i) => (
              <li key={n.id}>
                <button
                  onClick={() => openItem(n)}
                  className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-hover ${
                    n.read ? "" : "bg-accent-soft/40"
                  }`}
                >
                  <TypeIcon type={n.type} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] leading-relaxed text-text">
                      <span className="font-medium">{n.actor.nickname}</span>{" "}
                      {n.content}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-faint">
                      {formatTime(n.created_at)}
                    </span>
                  </span>
                  {!n.read && (
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />
                  )}
                </button>
                {i < items.length - 1 && <div className="border-b border-line" />}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
