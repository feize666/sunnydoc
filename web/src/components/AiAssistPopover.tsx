"use client";

import { useState } from "react";
import { aiAssist, type AIAssistAction } from "@/lib/api";

const ACTIONS: { key: AIAssistAction; label: string; icon: string }[] = [
  { key: "polish", label: "润色", icon: "✨" },
  { key: "translate_en", label: "翻译成英文", icon: "🌐" },
  { key: "summarize", label: "总结", icon: "📝" },
  { key: "continue", label: "续写", icon: "➡️" },
  { key: "explain", label: "解释", icon: "💡" },
];

export function AiAssistPopover({
  x,
  y,
  text,
  onClose,
}: {
  x: number;
  y: number;
  text: string;
  onClose: () => void;
}) {
  const [action, setAction] = useState<AIAssistAction | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const run = async (a: AIAssistAction) => {
    setAction(a);
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      setResult(await aiAssist(a, text));
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI 处理失败");
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  // 面板定位：优先显示在选中文字下方，超出视口则向上
  const top = Math.min(y + 8, window.innerHeight - 320);
  const left = Math.max(8, Math.min(x, window.innerWidth - 360));

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        style={{ top, left }}
        className="fixed z-50 w-[360px] max-w-[92vw] overflow-hidden rounded-xl border border-line bg-surface shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-line px-3 py-2">
          <span className="text-[13px] font-semibold text-text">AI 助手</span>
          <button
            onClick={onClose}
            className="grid h-6 w-6 place-items-center rounded text-faint hover:bg-hover hover:text-text"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5 border-b border-line px-3 py-2">
          {ACTIONS.map((a) => (
            <button
              key={a.key}
              onClick={() => run(a.key)}
              disabled={loading}
              className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                action === a.key
                  ? "border-accent/40 bg-accent-soft text-accent"
                  : "border-line bg-background text-text hover:border-accent/40 hover:text-accent"
              }`}
            >
              <span>{a.icon}</span>
              {a.label}
            </button>
          ))}
        </div>

        <div className="max-h-[240px] overflow-y-auto px-3 py-2.5">
          {loading ? (
            <div className="flex items-center gap-1.5 py-3 text-[13px] text-faint">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
              正在处理…
            </div>
          ) : error ? (
            <p className="py-2 text-[13px] text-danger">{error}</p>
          ) : result ? (
            <div>
              <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-text">
                {result}
              </p>
              <div className="mt-2 flex justify-end">
                <button
                  onClick={copy}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-accent hover:bg-accent-soft"
                >
                  {copied ? (
                    <>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                      已复制
                    </>
                  ) : (
                    <>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="9" y="9" width="13" height="13" rx="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                      </svg>
                      复制结果
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : (
            <p className="py-3 text-center text-[12px] text-faint">
              选择上方操作，基于选中文字生成内容
            </p>
          )}
        </div>
      </div>
    </>
  );
}
