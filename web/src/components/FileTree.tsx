"use client";

import { useState } from "react";
import type { TreeNode } from "@/data/docs";
import type { Folder } from "@/lib/api";
import {
  FileIcon,
  FolderIcon,
  ChevronIcon,
  CloseIcon,
  MoveIcon,
  TrashIcon,
  EditIcon,
} from "./icons";
import { ConfirmDialog } from "./ConfirmDialog";
import { RenameFolderDialog } from "./RenameFolderDialog";

function FileTreeNode({
  node,
  activeKey,
  onSelect,
  folders,
  onRequestDeleteDoc,
  onRequestDeleteFolder,
  onRequestRenameFolder,
  onMoveDoc,
  depth = 0,
}: {
  node: TreeNode;
  activeKey: string | null;
  onSelect: (key: string) => void;
  folders: Folder[];
  onRequestDeleteDoc?: (node: TreeNode) => void;
  onRequestDeleteFolder?: (node: TreeNode) => void;
  onRequestRenameFolder?: (node: TreeNode) => void;
  onMoveDoc?: (docId: string, folderId: string | null) => void;
  depth?: number;
}) {
  const [open, setOpen] = useState(depth === 0);
  const [moveOpen, setMoveOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  if (node.type === "folder") {
    return (
      <div
        onDragOver={(e) => {
          if (!onMoveDoc) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "move";
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          if (!onMoveDoc) return;
          e.preventDefault();
          e.stopPropagation();
          const docId = e.dataTransfer.getData("text/plain");
          setDragOver(false);
          if (docId && node.key && docId !== node.key) {
            onMoveDoc(docId, node.key);
          }
        }}
      >
        <div
          className={`group flex w-full items-center gap-1.5 rounded-md py-1 text-left text-[13px] transition-colors ${
            dragOver
              ? "bg-active ring-1 ring-inset ring-accent text-text"
              : "text-muted hover:bg-hover"
          }`}
        >
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex min-w-0 flex-1 items-center gap-1.5"
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
          {onRequestRenameFolder && node.key && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRequestRenameFolder(node);
              }}
              className="mr-1 grid h-4 w-4 shrink-0 place-items-center rounded text-faint opacity-0 transition-opacity hover:bg-hover hover:text-accent group-hover:opacity-100"
              title="重命名文件夹"
            >
              <EditIcon size={12} />
            </button>
          )}
          {onRequestDeleteFolder && node.key && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRequestDeleteFolder(node);
              }}
              className="mr-1 grid h-4 w-4 shrink-0 place-items-center rounded text-faint opacity-0 transition-opacity hover:bg-hover hover:text-red-500 group-hover:opacity-100"
              title="删除文件夹"
            >
              <TrashIcon size={12} />
            </button>
          )}
        </div>
        {open && node.children && (
          <div>
            {(node.children ?? []).map((child) => (
              <FileTreeNode
                key={child.key ?? child.name}
                node={child}
                activeKey={activeKey}
                onSelect={onSelect}
                folders={folders}
                onRequestDeleteDoc={onRequestDeleteDoc}
                onRequestDeleteFolder={onRequestDeleteFolder}
                onRequestRenameFolder={onRequestRenameFolder}
                onMoveDoc={onMoveDoc}
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
      draggable={!!onMoveDoc}
      onDragStart={(e) => {
        if (!node.key) return;
        e.dataTransfer.setData("text/plain", node.key);
        e.dataTransfer.effectAllowed = "move";
      }}
      className={`group flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-left text-[13px] transition-colors ${
        active
          ? "bg-active text-accent"
          : "text-muted hover:bg-hover hover:text-text"
      }`}
      style={{ paddingLeft: 8 + depth * 12 + 18 }}
    >
      <FileIcon size={15} className={`shrink-0 ${active ? "text-accent" : "text-faint"}`} />
      <span className="min-w-0 flex-1 truncate">{node.name}</span>
      {onMoveDoc && node.key && (
        <div className="relative shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setMoveOpen((v) => !v);
            }}
            className="grid h-4 w-4 place-items-center rounded text-faint opacity-0 transition-opacity hover:bg-hover hover:text-accent group-hover:opacity-100"
            title="移动到文件夹"
          >
            <MoveIcon size={13} />
          </button>
          {moveOpen && (
            <div
              className="absolute right-0 top-full z-20 mt-1 max-h-56 w-44 overflow-y-auto rounded-lg border border-line bg-background py-1 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => {
                  onMoveDoc(node.key!, null);
                  setMoveOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-muted hover:bg-hover hover:text-text"
              >
                <FolderIcon size={13} className="shrink-0 text-faint" />
                根目录
              </button>
              {(folders ?? []).map((f) => (
                <button
                  key={f.id}
                  onClick={() => {
                    onMoveDoc(node.key!, f.id);
                    setMoveOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-muted hover:bg-hover hover:text-text"
                >
                  <FolderIcon size={13} className="shrink-0 text-faint" />
                  <span className="truncate">{f.name}</span>
                </button>
              ))}
              {folders.length === 0 && (
                <div className="px-3 py-1.5 text-[11px] text-faint">
                  暂无文件夹，可先新建
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {onRequestDeleteDoc && node.key && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRequestDeleteDoc(node);
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
  folders = [],
  onDeleteDoc,
  onDeleteFolder,
  onRenameFolder,
  onMoveDoc,
}: {
  data: TreeNode[];
  activeKey: string | null;
  onSelect: (key: string) => void;
  folders?: Folder[];
  onDeleteDoc?: (key: string) => void;
  onDeleteFolder?: (id: string) => void;
  onRenameFolder?: () => void;
  onMoveDoc?: (docId: string, folderId: string | null) => void;
}) {
  const [pendingDeleteDoc, setPendingDeleteDoc] = useState<TreeNode | null>(null);
  const [pendingDeleteFolder, setPendingDeleteFolder] = useState<TreeNode | null>(
    null,
  );
  const [pendingRenameFolder, setPendingRenameFolder] = useState<Folder | null>(
    null,
  );
  const [dragOverRoot, setDragOverRoot] = useState(false);

  return (
    <>
      <nav
        className={`flex flex-col gap-0.5 rounded-md ${
          dragOverRoot ? "bg-active ring-1 ring-inset ring-accent" : ""
        }`}
        onDragOver={(e) => {
          if (!onMoveDoc) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setDragOverRoot(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDragOverRoot(false);
        }}
        onDrop={(e) => {
          if (!onMoveDoc) return;
          e.preventDefault();
          const docId = e.dataTransfer.getData("text/plain");
          setDragOverRoot(false);
          if (docId) onMoveDoc(docId, null);
        }}
      >
        {(data ?? []).map((node) => (
          <FileTreeNode
            key={node.key ?? node.name}
            node={node}
            activeKey={activeKey}
            onSelect={onSelect}
            folders={folders}
            onRequestDeleteDoc={onDeleteDoc ? setPendingDeleteDoc : undefined}
            onRequestDeleteFolder={
              onDeleteFolder ? setPendingDeleteFolder : undefined
            }
            onRequestRenameFolder={
              onRenameFolder
                ? (node) => {
                    const f = folders.find((x) => x.id === node.key);
                    if (f) setPendingRenameFolder(f);
                  }
                : undefined
            }
            onMoveDoc={onMoveDoc}
          />
        ))}
      </nav>

      <ConfirmDialog
        open={pendingDeleteDoc !== null}
        title="删除文档"
        message={`确定要删除「${pendingDeleteDoc?.name ?? ""}」吗？此操作不可恢复。`}
        confirmText="删除"
        cancelText="取消"
        onConfirm={() => {
          if (pendingDeleteDoc?.key && onDeleteDoc) {
            onDeleteDoc(pendingDeleteDoc.key);
          }
          setPendingDeleteDoc(null);
        }}
        onCancel={() => setPendingDeleteDoc(null)}
      />

      <ConfirmDialog
        open={pendingDeleteFolder !== null}
        title="删除文件夹"
        message={`确定要删除文件夹「${pendingDeleteFolder?.name ?? ""}」吗？文件夹内的文档不会被删除，将移动到根目录。`}
        confirmText="删除"
        cancelText="取消"
        onConfirm={() => {
          if (pendingDeleteFolder?.key && onDeleteFolder) {
            onDeleteFolder(pendingDeleteFolder.key);
          }
          setPendingDeleteFolder(null);
        }}
        onCancel={() => setPendingDeleteFolder(null)}
      />

      <RenameFolderDialog
        folder={pendingRenameFolder}
        onClose={() => setPendingRenameFolder(null)}
        onRenamed={() => {
          onRenameFolder?.();
        }}
      />
    </>
  );
}
