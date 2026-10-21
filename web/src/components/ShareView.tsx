"use client";

import { useState, useEffect, useRef } from "react";
import { getSharedDoc, type SharedDoc } from "@/lib/api";
import { renderMarkdown, hydrateCodeBlocks } from "@/lib/markdown";
import { hydrateEmbeds } from "./DocumentEmbed";
import { handleCodeBlockCopy } from "./CodeBlock";
import { LogoMark } from "./LogoMark";
import { PasswordInput } from "./PasswordInput";
import { ThemeToggle } from "./ThemeToggle";
import { Watermark } from "./Watermark";
import { useImageZoom } from "./ImageLightbox";

/** 公开分享的只读文档视图（无需登录，可带密码保护）。 */
export function ShareView({ token }: { token: string }) {
  const [doc, setDoc] = useState<SharedDoc | null>(null);
  const [html, setHtml] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [needPassword, setNeedPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const bodyRef = useRef<HTMLDivElement>(null);
  // 分享页正文也是 HTML 渲染，图片点击放大同样要走事件委托
  const imageLightbox = useImageZoom(bodyRef);

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

  // 闲时增量补语法高亮（与编辑器预览同一策略：首屏纯文本、空闲再高亮）
  useEffect(() => {
    if (!html) return;
    return hydrateCodeBlocks(bodyRef.current, theme);
  }, [html, theme]);

  // 分享页里的文档卡片：与编辑器预览同理，HTML 里只有空的 div[data-doc-id]，
  // 必须挂载 React 卡片组件才可见。
  useEffect(() => {
    if (!html) return;
    return hydrateEmbeds(bodyRef.current);
  }, [html]);

  if (needPassword) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-background">
        <LogoMark size={48} rounded="rounded-xl" />
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
      {/* 水印只出现在**真正拿到文档内容之后**。密码输入页 / 报错页不加：
          那时页面上没有任何受保护内容，加水印只是噪音。
          （也不放在最外层 —— 那会让三种前置态都带上水印。） */}
      <Watermark theme={theme} />

      <header className="relative z-10 flex h-12 shrink-0 items-center gap-2.5 border-b border-line bg-background px-5">
        <LogoMark size={28} rounded="rounded-lg" />
        <span className="text-sm font-semibold text-text">Sunny · 分享文档</span>
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
            ref={bodyRef}
            className="md-body md-zoomable mt-6"
            onClick={handleCodeBlockCopy}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      </div>

      {/* 点图片放大 */}
      {imageLightbox}
    </div>
  );
}
