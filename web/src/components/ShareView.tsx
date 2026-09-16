"use client";

import { useState, useEffect } from "react";
import { getSharedDoc, type SharedDoc } from "@/lib/api";
import { renderMarkdown } from "@/lib/markdown";
import { handleCodeBlockCopy } from "./CodeBlock";
import { PasswordInput } from "./PasswordInput";
import { ThemeToggle } from "./ThemeToggle";

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
          <div className="w-56">
            <PasswordInput
              value={password}
              onChange={setPassword}
              onKeyDown={(e) => {
                if (e.key === "Enter") load(password);
              }}
              placeholder="访问密码"
              autoFocus
              className="input h-10"
            />
          </div>
          <button
            onClick={() => load(password)}
            className="btn btn-accent h-10 shrink-0 px-4 text-white"
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
        <ThemeToggle
          theme={theme}
          onToggle={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
        />
      </header>

      <div className="flex-1 overflow-y-auto py-8">
        <div className="mx-auto max-w-[760px] px-4 sm:px-10">
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
