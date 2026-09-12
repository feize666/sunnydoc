"use client";

import { useState, useEffect } from "react";
import { getSharedDoc, type SharedDoc } from "@/lib/api";
import { renderMarkdown } from "@/lib/markdown";
import { handleCodeBlockCopy } from "./CodeBlock";
import { PasswordInput } from "./PasswordInput";

/** 公开分享的只读文档视图（无需登录，可带密码保护）。 */
export function ShareView({ token }: { token: string }) {
  const [doc, setDoc] = useState<SharedDoc | null>(null);
  const [html, setHtml] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [needPassword, setNeedPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const load = (pwd?: string) => {
    setError(null);
    getSharedDoc(token, pwd)
      .then((d) => {
        setDoc(d);
        setNeedPassword(false);
      })
      .catch((e) => {
        const msg = e instanceof Error ? e.message : "加载失败";
        if (msg.includes("密码") || msg.includes("401") || msg.includes("password")) {
          setNeedPassword(true);
          setError("该分享链接需要密码访问");
        } else {
          setError(msg);
        }
      });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    renderMarkdown(doc.text, undefined, theme).then((h) => {
      if (!cancelled) setHtml(h);
    });
    return () => {
      cancelled = true;
    };
  }, [doc, theme]);

  if (needPassword) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-background">
        <span className="logo-mark grid h-12 w-12 place-items-center rounded-xl text-xl font-bold">
          知
        </span>
        <div className="text-center">
          <div className="text-base font-semibold text-text">此分享链接需要密码</div>
          <div className="mt-1 text-sm text-faint">请输入访问密码</div>
        </div>
        <div className="flex items-center gap-2">
          <PasswordInput
            value={password}
            onChange={setPassword}
            onKeyDown={(e) => {
              if (e.key === "Enter") load(password);
            }}
            placeholder="访问密码"
            autoFocus
            className="h-10 w-56 rounded-lg border border-line bg-background px-3 text-sm text-text outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
          <button
            onClick={() => load(password)}
            className="btn btn-accent h-10 px-4 text-white"
          >
            确定
          </button>
        </div>
        {error && error !== "该分享链接需要密码访问" && (
          <p className="text-sm text-danger">{error}</p>
        )}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-background">
        <p className="text-sm text-danger">{error}</p>
        <p className="text-xs text-faint">分享链接不存在或已被撤销</p>
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="flex h-full items-center justify-center bg-background text-muted">
        <p className="text-sm">加载中…</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center gap-2.5 border-b border-line bg-background px-5">
        <span className="logo-mark grid h-7 w-7 place-items-center rounded-lg text-sm font-bold">
          知
        </span>
        <span className="text-sm font-semibold text-text">知库 · 分享文档</span>
        <div className="flex-1" />
        <button
          onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
          className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-hover hover:text-text"
        >
          {theme === "light" ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <defs>
                <linearGradient id="share-moon" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#818cf8" />
                  <stop offset="100%" stopColor="#6366f1" />
                </linearGradient>
              </defs>
              <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" fill="url(#share-moon)" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <defs>
                <linearGradient id="share-sun" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#fbbf24" />
                  <stop offset="100%" stopColor="#f59e0b" />
                </linearGradient>
              </defs>
              <circle cx="12" cy="12" r="4" fill="url(#share-sun)" />
              <g stroke="#f59e0b" strokeWidth="2" strokeLinecap="round">
                <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
              </g>
            </svg>
          )}
        </button>
      </header>

      <div className="flex-1 overflow-y-auto py-8">
        <div className="mx-auto max-w-[760px] px-10">
          <h1 className="text-[32px] font-bold leading-[1.25] tracking-[-0.01em] text-text">
            {doc.title}
          </h1>
          <div className="mt-4 border-b border-line" />
          <div
            className="md-body mt-6"
            onClick={handleCodeBlockCopy}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      </div>
    </div>
  );
}
