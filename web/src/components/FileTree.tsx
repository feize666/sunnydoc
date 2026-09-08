"use client";

import { useState } from "react";
import type { TreeNode } from "@/data/docs";
import { FileIcon, FolderIcon, ChevronIcon, CloseIcon } from "./icons";
import { ConfirmDialog } from "./ConfirmDialog";

function FileTreeNode({
  node,
  activeKey,
  onSelect,
  onRequestDelete,
  depth = 0,
}: {
  node: TreeNode;
  activeKey: string | null;
  onSelect: (key: string) => void;
  onRequestDelete?: (node: TreeNode) => void;
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
                onRequestDelete={onRequestDelete}
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
    <div
      onClick={() => node.key && onSelect(node.key)}
      className={`group flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-left text-[13px] transition-colors ${
        active
          ? "bg-active text-accent"
          : "text-muted hover:bg-hover hover:text-text"
      }`}
      style={{ paddingLeft: 8 + depth * 12 + 18 }}
    >
      <FileIcon size={15} className={`shrink-0 ${active ? "text-accent" : "text-faint"}`} />
      <span className="flex-1 truncate">{node.name}</span>
      {onRequestDelete && node.key && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRequestDelete(node);
          }}
          className="grid h-4 w-4 shrink-0 place-items-center rounded text-faint opacity-0 transition-opacity hover:bg-hover hover:text-red-500 group-hover:opacity-100"
          title="删除文档"
        >
          <CloseIcon size={12} />
        </button>
      )}
    </div>
  );
}

export function FileTree({
  data,
  activeKey,
  onSelect,
  onDelete,
}: {
  data: TreeNode[];
  activeKey: string | null;
  onSelect: (key: string) => void;
  onDelete?: (key: string) => void;
}) {
  const [pendingDelete, setPendingDelete] = useState<TreeNode | null>(null);

  return (
    <>
      <nav className="flex flex-col gap-0.5">
        {data.map((node) => (
          <FileTreeNode
            key={node.key ?? node.name}
            node={node}
            activeKey={activeKey}
            onSelect={onSelect}
            onRequestDelete={setPendingDelete}
          />
        ))}
      </nav>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="删除文档"
        message={`确定要删除「${pendingDelete?.name ?? ""}」吗？此操作不可恢复。`}
        confirmText="删除"
        cancelText="取消"
        onConfirm={() => {
          if (pendingDelete?.key && onDelete) {
            onDelete(pendingDelete.key);
          }
          setPendingDelete(null);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </>
  );
}
