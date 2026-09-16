"use client";

import dynamic from "next/dynamic";
import type { ComponentType } from "react";

/**
 * 重型编辑器懒加载包装。
 *
 * 背景：编辑器（React Flow / TipTap / html-to-image / jszip 等）体量大，
 * 若在 Editor.tsx 里急切 import，会被打进首屏共享 chunk（实测约 2.4MB），
 * 而首页/普通文档阅读根本用不到。改为 next/dynamic 后按需加载：
 * 只有真正打开对应类型文档时才下载对应 chunk，首屏体积大幅下降。
 *
 * ssr:false —— 这些编辑器依赖 DOM/Canvas/浏览器 API，无服务端渲染意义。
 */

type EditorProps = {
  value: string;
  onChange: (v: string) => void;
  readOnly?: boolean;
  placeholder?: string;
};

const loading = () => (
  <div className="flex min-h-[240px] items-center justify-center rounded-lg border border-line bg-surface text-[13px] text-faint">
    正在加载编辑器…
  </div>
);

function lazy(loader: () => Promise<ComponentType<EditorProps>>) {
  return dynamic(loader, { ssr: false, loading }) as unknown as ComponentType<EditorProps>;
}

export const LazyFlowchartEditor = lazy(
  () => import("./FlowchartEditor").then((m) => m.FlowchartEditor) as never,
);

export const LazyMindMapEditor = lazy(
  () => import("./MindMapEditor").then((m) => m.MindMapEditor) as never,
);

export const LazyBoardEditor = lazy(
  () => import("./BoardEditor").then((m) => m.BoardEditor) as never,
);

export const LazyDatasheetEditor = lazy(
  () => import("./DatasheetEditor").then((m) => m.DatasheetEditor) as never,
);

export const LazyTableEditor = lazy(
  () => import("./TableEditor").then((m) => m.TableEditor) as never,
);

export const LazyRichEditor = lazy(
  () => import("./RichEditor").then((m) => m.RichEditor) as never,
);