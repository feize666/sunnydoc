"use client";

import { useState, useEffect, useCallback } from "react";
import { listAuditLogs, type AuditLog } from "@/lib/api";

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  create: { label: "创建", color: "text-emerald-500" },
  update: { label: "更新", color: "text-accent" },
  delete: { label: "删除", color: "text-danger" },
  duplicate: { label: "复制", color: "text-accent" },
  share: { label: "共享", color: "text-accent" },
  comment: { label: "评论", color: "text-muted" },
  comment_delete: { label: "删评论", color: "text-danger" },
};

const TYPE_LABELS: Record<string, string> = {
  doc: "文档",
  kb: "知识库",
  folder: "文件夹",
  user: "用户",
  comment: "评论",
};

function formatTime(ts: number): string {
  if (!ts) return "-";
  const d = new Date(ts * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function AuditLogView() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      setLogs(await listAuditLogs(200, 0));
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载操作日志失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-xs text-faint">
          记录团队成员对文档、知识库的增删改与共享操作
        </p>
        <button
          onClick={() => {
            setLoading(true);
            refresh();
          }}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted hover:bg-hover hover:text-text"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15" />
          </svg>
          刷新
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-xs text-danger">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-faint">加载中…</div>
      ) : logs.length === 0 ? (
        <div className="rounded-xl border border-line bg-background py-16 text-center text-sm text-faint">
          暂无操作记录
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-background">
          <table className="w-full text-left text-[14px]">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-xs text-muted">
                <th className="px-4 py-2.5 font-medium">时间</th>
                <th className="px-4 py-2.5 font-medium">操作者</th>
                <th className="px-4 py-2.5 font-medium">操作</th>
                <th className="px-4 py-2.5 font-medium">对象</th>
                <th className="px-4 py-2.5 font-medium">详情</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => {
                const a = ACTION_LABELS[l.action] ?? { label: l.action, color: "text-muted" };
                return (
                  <tr key={l.id} className="border-b border-line last:border-0 hover:bg-surface">
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs text-faint">
                      {formatTime(l.created_at)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-text">
                      {l.user.nickname}
                    </td>
                    <td className={`whitespace-nowrap px-4 py-2.5 text-[13px] font-medium ${a.color}`}>
                      {a.label}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs text-muted">
                      {TYPE_LABELS[l.target_type] ?? l.target_type}
                    </td>
                    <td className="max-w-[360px] truncate px-4 py-2.5 text-[13px] text-text">
                      {l.detail}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
