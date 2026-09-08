"use client";

import { useState, useRef, useEffect } from "react";
import { FileTree } from "./FileTree";
import { PlusIcon } from "./icons";
import type { TreeNode } from "@/data/docs";
import type { Folder } from "@/lib/api";

export function Sidebar({
  data,
  activeKey,
  onSelect,
  collapsed,
  onToggleCollapse,
  folders,
  onImport,
  onNewDoc,
  onNewFolder,
  onExport,
  onRefresh,
  onDeleteDoc,
  onDeleteFolder,
  onRenameFolder,
  onMoveDoc,
  listError,
  kbName,
  onBackHome,
}: {
  data: TreeNode[];
  activeKey: string | null;
  onSelect: (key: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  folders: Folder[];
  onImport: () => void;
  onNewDoc: () => void;
  onNewFolder: () => void;
  onExport: () => void;
  onRefresh?: () => void;
  onDeleteDoc?: (key: string) => void;
  onDeleteFolder?: (id: string) => void;
  onRenameFolder?: () => void;
  onMoveDoc?: (docId: string, folderId: string | null) => void;
  listError?: string | null;
  kbName?: string;
  onBackHome?: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  if (collapsed) return null;

  const createItems = [
    {
      label: "新建文档",
      icon: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6",
      action: () => onNewDoc(),
    },
    {
      label: "新建文件夹",
      icon: "M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z",
      action: () => onNewFolder(),
    },
  ];

  return (
    <aside className="flex w-[260px] min-w-[180px] max-w-[420px] shrink-0 flex-col border-r border-line bg-surface">
      <div className="border-b border-line px-3 pb-2.5 pt-2.5">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex min-w-0 items-center gap-1">
            {onBackHome && (
              <button
                onClick={onBackHome}
                className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-faint transition-colors hover:bg-hover hover:text-text"
                title="返回首页"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M19 12H5M12 19l-7-7 7-7" />
                </svg>
              </button>
            )}
            <span className="truncate text-xs text-faint">
              {kbName ?? "知识库 · 全部文档"}
            </span>
          </div>
          {onRefresh && (
            <button
              onClick={onRefresh}
              className="grid h-6 w-6 place-items-center rounded-md text-faint transition-colors hover:bg-hover hover:text-text"
              title="刷新文档列表"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15" />
              </svg>
            </button>
          )}
        </div>

        <div className="flex gap-1.5">
          <div className="relative flex-1" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="btn-accent flex w-full items-center justify-center gap-1 rounded-lg px-3 py-1.5 text-[13px] font-medium text-white"
            >
              <PlusIcon size={14} />
              新建
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                className={`transition-transform ${menuOpen ? "rotate-180" : ""}`}
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>

            {menuOpen && (
              <div className="absolute left-0 top-full z-50 mt-1 w-44 overflow-hidden rounded-lg border border-line bg-background py-1 shadow-xl">
                {createItems.map((item, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      item.action();
                      setMenuOpen(false);
                    }}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-text hover:bg-hover"
                  >
                    <svg
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className="shrink-0 text-muted"
                    >
                      <path d={item.icon} />
                    </svg>
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={onImport}
            className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-[13px] text-text transition-colors hover:bg-hover"
            title="导入文档"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-muted"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
            </svg>
            导入
          </button>

          <button
            onClick={onExport}
            className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-[13px] text-text transition-colors hover:bg-hover"
            title="导出文档"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-muted"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
            </svg>
            导出
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-1.5 py-2">
        {listError && (
          <div className="mx-1 mb-2 rounded-md border border-red-300 bg-red-50 px-2 py-1.5 text-[11px] text-red-600">
            {listError}（后端服务未启动？）
          </div>
        )}
        {data.length === 0 && !listError && (
          <div className="px-2 py-4 text-center text-[12px] text-faint">
            暂无文档，点击上方「导入」或「新建」
          </div>
        )}
        <FileTree
          data={data}
          activeKey={activeKey}
          onSelect={onSelect}
          folders={folders}
          onDeleteDoc={onDeleteDoc}
          onDeleteFolder={onDeleteFolder}
          onRenameFolder={onRenameFolder}
          onMoveDoc={onMoveDoc}
        />
      </div>
    </aside>
  );
}
