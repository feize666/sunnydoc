"use client";

import { useState, useRef, useEffect } from "react";
import { renderMarkdown, hydrateCodeBlocks, mediaUrl } from "@/lib/markdown";
import { handleCodeBlockCopy } from "../CodeBlock";

/**
 * AI 回答正文：随流式内容增量异步渲染 markdown。
 *
 * 从 `AiPanel` 抽出（原文件 1346 行）。逻辑一行未改，只是搬了位置。
 */
export function AiMarkdown({
  content,
  theme,
}: {
  content: string;
  theme: "light" | "dark";
}) {
  const [html, setHtml] = useState("");
  const renderId = useRef(0);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = ++renderId.current;
    let cancelled = false;
    renderMarkdown(content, undefined, theme).then((h) => {
      if (!cancelled && id === renderId.current) setHtml(h);
    });
    return () => {
      cancelled = true;
    };
  }, [content, theme]);

  // 闲时增量补语法高亮（AI 回答里常带代码示例）
  useEffect(() => {
    if (!html) return;
    return hydrateCodeBlocks(bodyRef.current, theme);
  }, [html, theme]);

  return (
    <div
      ref={bodyRef}
      className="md-body"
      onClick={handleCodeBlockCopy}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}