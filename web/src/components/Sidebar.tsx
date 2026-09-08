"use client";

import { useState, useRef, useEffect } from "react";
import { FileTree } from "./FileTree";
import { PlusIcon } from "./icons";
import type { TreeNode, Doc } from "@/data/docs";
import {
  exportDocAsMarkdown,
  exportAllAsJson,
  exportAllAsZip,
} from "@/lib/exporter";

export function Sidebar({
  data,
  activeKey,
  onSelect,
  collapsed,
  onToggleCollapse,
  docs,
  activeDoc,
  onImport,
}: {
  data: TreeNode[];
  activeKey: string | null;
  onSelect: (key: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  docs: Doc[];
  activeDoc: Doc | null;
  onImport: () => void;
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

  const menuItems = [
    {
      label: "新建文档",
      icon: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6",
      disabled: true,
      hint: "即将支持",
      action: () => {},
    },
    {
      label: "新建文件夹",
      icon: "M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z",
      disabled: true,
      hint: "即将支持",
      action: () => {},
    },
    {
      label: "导入文档",
      icon: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12",
      disabled: false,
      hint: "",
      action: () => onImport(),
    },
  ];

  const exportItems = [
    {
      label: "导出当前文档 (.md)",
      disabled: !activeDoc,
      action: () => activeDoc && exportDocAsMarkdown(activeDoc),
    },
    {
      label: "导出全部文档 (.json)",
      disabled: docs.length === 0,
      action: () => exportAllAsJson(docs),
    },
    {
      label: "导出全部文档 (.zip)",
      disabled: docs.length === 0,
      action: () => exportAllAsZip(docs),
    },
  ];

  return (
    <aside className="flex w-[260px] min-w-[180px] max-w-[420px] shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-3 py-2.5 text-xs text-faint">
        <span>知识库 · 全部文档</span>
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="grid h-6 w-6 place-items-center rounded-md text-faint transition-colors hover:bg-hover hover:text-text"
            title="新建 / 导入 / 导出"
          >
            <PlusIcon size={15} />
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-lg border border-line bg-background py-1 shadow-xl">
              {menuItems.map((item, i) => (
                <button
                  key={i}
                  disabled={item.disabled}
                  onClick={() => {
                    item.action();
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-text hover:bg-hover disabled:cursor-not-allowed disabled:text-faint"
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
                  <span className="flex-1">{item.label}</span>
                  {item.hint && (
                    <span className="text-[11px] text-faint">{item.hint}</span>
                  )}
                </button>
              ))}

              <div className="my-1 h-px bg-line" />

              {exportItems.map((item, i) => (
                <button
                  key={i}
                  disabled={item.disabled}
                  onClick={() => {
                    item.action();
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-text hover:bg-hover disabled:cursor-not-allowed disabled:text-faint"
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
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                  </svg>
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-1.5 py-2">
        <FileTree data={data} activeKey={activeKey} onSelect={onSelect} />
      </div>
    </aside>
  );
}
