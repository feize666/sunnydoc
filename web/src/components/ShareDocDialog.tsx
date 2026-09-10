"use client";

import { useState, useEffect } from "react";
import { createShare, revokeShare } from "@/lib/api";
import { CloseIcon, CheckIcon } from "./icons";

export function ShareDocDialog({
  open,
  doc,
  onClose,
}: {
  open: boolean;
  doc: { id: string; title: string } | null;
  onClose: () => void;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && doc) {
      setToken(null);
      setCopied(false);
      setError(null);
      setLoading(true);
      createShare(doc.id)
        .then((r) => setToken(r.token))
        .catch((e) => setError(e instanceof Error ? e.message : "生成分享链接失败"))
        .finally(() => setLoading(false));
    }
  }, [open, doc]);

  if (!open || !doc) return null;

  const url = token
    ? `${window.location.origin}${window.location.pathname}?share=${token}`
    : "";

  const copyLink = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  const revoke = async () => {
    try {
      await revokeShare(doc.id);
      setToken(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "撤销分享失败");
    }
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog-panel w-[460px] max-w-[92vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div className="leading-tight">
            <div className="text-[15px] font-semibold text-text">分享文档</div>
            <div className="max-w-[300px] truncate text-[12px] text-faint">{doc.title}</div>
          </div>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-md text-faint transition-colors hover:bg-hover hover:text-text"
          >
            <CloseIcon size={15} />
          </button>
        </div>

        <div className="px-5 py-4">
          <p className="text-[13px] text-muted">
            任何人打开此链接即可只读查看该文档，无需登录。
          </p>

          {loading ? (
            <div className="py-6 text-center text-[13px] text-faint">生成链接中…</div>
          ) : error ? (
            <div className="mt-3 rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-xs text-danger">
              {error}
            </div>
          ) : token ? (
            <>
              <div className="mt-3 flex items-center gap-2">
                <input
                  readOnly
                  value={url}
                  onFocus={(e) => e.target.select()}
                  className="min-w-0 flex-1 rounded-lg border border-line bg-background px-3 py-2 text-[13px] text-text outline-none"
                />
                <button
                  onClick={copyLink}
                  className="btn-accent flex shrink-0 items-center gap-1 rounded-lg px-3 py-2 text-xs font-medium text-white"
                >
                  {copied ? <CheckIcon size={13} /> : null}
                  {copied ? "已复制" : "复制链接"}
                </button>
              </div>
              <button
                onClick={revoke}
                className="mt-3 text-xs text-danger transition-colors hover:underline"
              >
                撤销分享链接
              </button>
            </>
          ) : (
            <button
              onClick={() => {
                setLoading(true);
                createShare(doc.id)
                  .then((r) => setToken(r.token))
                  .catch((e) => setError(e instanceof Error ? e.message : "生成分享链接失败"))
                  .finally(() => setLoading(false));
              }}
              className="btn btn-accent mt-3 text-white"
            >
              生成分享链接
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
