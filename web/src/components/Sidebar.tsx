"use client";

import { FileTree } from "./FileTree";
import { PlusIcon } from "./icons";
import type { TreeNode } from "@/data/docs";

export function Sidebar({
  data,
  activeKey,
  onSelect,
  collapsed,
  onToggleCollapse,
}: {
  data: TreeNode[];
  activeKey: string | null;
  onSelect: (key: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}) {
  if (collapsed) return null;

  return (
    <aside className="flex w-[260px] min-w-[180px] max-w-[420px] shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-3 py-2.5 text-xs text-faint">
        <span>知识库 · 全部文档</span>
        <button
          className="flex items-center gap-0.5 text-xs font-medium text-accent hover:text-accent-hover"
          title="新建文档"
        >
          <PlusIcon size={14} />
          新建
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-1.5 py-2">
        <FileTree data={data} activeKey={activeKey} onSelect={onSelect} />
      </div>
    </aside>
  );
}
