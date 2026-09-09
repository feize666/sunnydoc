"use client";

import type { ReactNode } from "react";

export type NodeType =
  | "doc"
  | "folder"
  | "table"
  | "board"
  | "datasheet"
  | "mindmap"
  | "slides"
  | "flowchart";

function Icon({ d, size = 15 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      {d.split("|").map((p, i) => (
        <path key={i} d={p} />
      ))}
    </svg>
  );
}

const TYPES: { type: NodeType; label: string; available: boolean; icon: ReactNode }[] = [
  { type: "doc", label: "文档", available: true, icon: <Icon d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z|M14 2v6h6" /> },
  { type: "table", label: "表格", available: true, icon: <Icon d="M3 3h18v18H3z|M3 9h18|M3 15h18|M9 3v18|M15 3v18" /> },
  { type: "folder", label: "目录", available: true, icon: <Icon d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /> },
  { type: "board", label: "画板", available: false, icon: <Icon d="M3 3h18v18H3z|M7 16l4-4 3 2 4-5" /> },
  { type: "datasheet", label: "数据表", available: false, icon: <Icon d="M4 5h16v14H4z|M4 9h16|M9 9v10" /> },
  { type: "mindmap", label: "思维笔记", available: false, icon: <Icon d="M12 4v16M12 8H5M12 14h7" /> },
  { type: "slides", label: "幻灯片", available: false, icon: <Icon d="M3 5h18v12H3z|M3 9h18|M9 9v8" /> },
  { type: "flowchart", label: "流程图", available: false, icon: <Icon d="M12 2l6 8-6 8-6-8z|M12 6v4M12 14v4" /> },
];

/** 「+」新建多类型面板（语雀式）。 */
export function NewNodeMenu({
  onSelect,
  onClose,
}: {
  onSelect: (type: NodeType) => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-20" onClick={onClose} />
      <div className="menu-panel absolute right-0 top-full z-30 mt-1 w-[200px] overflow-hidden rounded-xl p-1.5">
        <div className="grid grid-cols-2 gap-0.5">
          {TYPES.map((t) => (
            <button
              key={t.type}
              disabled={!t.available}
              onClick={() => {
                if (t.available) {
                  onClose();
                  onSelect(t.type);
                }
              }}
              className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors ${
                t.available
                  ? "text-text hover:bg-hover"
                  : "cursor-not-allowed text-faint"
              }`}
            >
              <span className={`shrink-0 ${t.available ? "text-muted" : "text-faint"}`}>
                {t.icon}
              </span>
              <span className="flex-1">{t.label}</span>
              {!t.available && (
                <span className="rounded bg-surface-2 px-1 py-px text-[9px] leading-none text-faint">
                  规划中
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
