"use client";

import { useState } from "react";
import type { TreeNode } from "@/data/docs";
import { FileIcon, FolderIcon, ChevronIcon } from "./icons";

function FileTreeNode({
  node,
  activeKey,
  onSelect,
  depth = 0,
}: {
  node: TreeNode;
  activeKey: string | null;
  onSelect: (key: string) => void;
  depth?: number;
}) {
  const [open, setOpen] = useState(depth === 0);

  if (node.type === "folder") {
    return (
      <div>
        <button
          onClick={() => setOpen((v) => !v)}
          className="group flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[13px] text-muted hover:bg-hover"
          style={{ paddingLeft: 8 + depth * 12 }}
        >
          <ChevronIcon
            size={13}
            className={`shrink-0 text-faint transition-transform ${
              open ? "rotate-90" : ""
            }`}
          />
          <FolderIcon size={15} className="shrink-0 text-faint" />
          <span className="truncate">{node.name}</span>
        </button>
        {open && node.children && (
          <div>
            {node.children.map((child) => (
              <FileTreeNode
                key={child.name}
                node={child}
                activeKey={activeKey}
                onSelect={onSelect}
                depth={depth + 1}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  const active = node.key === activeKey;
  return (
    <button
      onClick={() => node.key && onSelect(node.key)}
      className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[13px] transition-colors ${
        active
          ? "bg-active text-accent"
          : "text-muted hover:bg-hover hover:text-text"
      }`}
      style={{ paddingLeft: 8 + depth * 12 + 18 }}
    >
      <FileIcon size={15} className={`shrink-0 ${active ? "text-accent" : "text-faint"}`} />
      <span className="truncate">{node.name}</span>
    </button>
  );
}

export function FileTree({
  data,
  activeKey,
  onSelect,
}: {
  data: TreeNode[];
  activeKey: string | null;
  onSelect: (key: string) => void;
}) {
  return (
    <nav className="flex flex-col gap-0.5">
      {data.map((node) => (
        <FileTreeNode
          key={node.name}
          node={node}
          activeKey={activeKey}
          onSelect={onSelect}
        />
      ))}
    </nav>
  );
}
