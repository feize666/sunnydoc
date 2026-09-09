"use client";

import { useState } from "react";
import type { TreeNode } from "@/data/docs";
import type { Folder } from "@/lib/api";
import {
  FileIcon,
  FolderIcon,
  ChevronIcon,
  MoveIcon,
  TrashIcon,
  EditIcon,
  CopyIcon,
} from "./icons";
import { ConfirmDialog } from "./ConfirmDialog";
import { Tooltip } from "./Tooltip";
import { NewNodeMenu, type NodeType } from "./NewNodeMenu";
import { TreeNodeMenu, type MenuItem } from "./TreeNodeMenu";
import { RenameDialog } from "./RenameDialog";

function PlusIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function DotsIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </svg>
  );
}

function PinIcon({ size = 13, filled = false, className = "" }: { size?: number; filled?: boolean; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 17v5M5 12l-1 1 6 6 1-1M14 3l6 6-3 3-1-1-2 2-2-2 2-2-1-1 3-3z" />
    </svg>
  );
}

function ExportIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
    </svg>
  );
}

type RenameTarget = { kind: "doc" | "folder"; id: string; name: string };

function FileTreeNode({
  node,
  activeKey,
  onSelect,
  folders,
  onNew,
  onRequestRename,
  onRequestDeleteDoc,
  onRequestDeleteFolder,
  onMoveDoc,
  onDuplicateDoc,
  onPinDoc,
  onExportDoc,
  depth = 0,
}: {
  node: TreeNode;
  activeKey: string | null;
  onSelect: (key: string) => void;
  folders: Folder[];
  onNew?: (type: NodeType, parentFolderId: string | null) => void;
  onRequestRename?: (target: RenameTarget) => void;
  onRequestDeleteDoc?: (node: TreeNode) => void;
  onRequestDeleteFolder?: (node: TreeNode) => void;
  onMoveDoc?: (docId: string, folderId: string | null) => void;
  onDuplicateDoc?: (docId: string) => void;
  onPinDoc?: (docId: string, pinned: boolean) => void;
  onExportDoc?: (docId: string) => void;
  depth?: number;
}) {
  const [open, setOpen] = useState(depth === 0);
  const [addOpen, setAddOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const hoverBtn =
    "grid h-[22px] w-[22px] place-items-center rounded-md text-faint opacity-0 transition-opacity hover:bg-hover hover:text-accent group-hover:opacity-100";

  if (node.type === "folder") {
    const folderItems: MenuItem[] = [];
    if (onNew) {
      folderItems.push({ label: "新建文档", icon: <FileIcon size={14} />, onClick: () => onNew("doc", node.key ?? null) });
      folderItems.push({ label: "新建子目录", icon: <FolderIcon size={14} />, onClick: () => onNew("folder", node.key ?? null) });
    }
    if (onRequestRename && node.key) {
      folderItems.push({ label: "重命名", icon: <EditIcon size={14} />, onClick: () => onRequestRename({ kind: "folder", id: node.key!, name: node.name }) });
    }
    if (onRequestDeleteFolder && node.key) {
      folderItems.push({ label: "删除", icon: <TrashIcon size={14} />, danger: true, onClick: () => onRequestDeleteFolder(node) });
    }

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
          className={`group flex w-full items-center gap-1 rounded-md py-1 text-left text-[15px] transition-colors ${
            dragOver ? "bg-active ring-1 ring-inset ring-accent text-text" : "text-text hover:bg-hover"
          }`}
        >
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex min-w-0 flex-1 items-center gap-1.5"
            style={{ paddingLeft: 8 + depth * 12 }}
          >
            <ChevronIcon
              size={14}
              className={`shrink-0 text-faint transition-transform ${open ? "rotate-90" : ""}`}
            />
            <FolderIcon size={16} className="shrink-0 text-faint" />
            <span className="truncate">{node.name}</span>
          </button>

          {onNew && (
            <div className="relative shrink-0">
              <button onClick={(e) => { e.stopPropagation(); setAddOpen((v) => !v); }} className={hoverBtn}>
                <PlusIcon />
              </button>
              {addOpen && (
                <NewNodeMenu onSelect={(t) => onNew(t, node.key ?? null)} onClose={() => setAddOpen(false)} />
              )}
            </div>
          )}
          {folderItems.length > 0 && (
            <div className="relative shrink-0">
              <button onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }} className={hoverBtn}>
                <DotsIcon />
              </button>
              {menuOpen && <TreeNodeMenu items={folderItems} onClose={() => setMenuOpen(false)} />}
            </div>
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
                onNew={onNew}
                onRequestRename={onRequestRename}
                onRequestDeleteDoc={onRequestDeleteDoc}
                onRequestDeleteFolder={onRequestDeleteFolder}
                onMoveDoc={onMoveDoc}
                onDuplicateDoc={onDuplicateDoc}
                onPinDoc={onPinDoc}
                onExportDoc={onExportDoc}
                depth={depth + 1}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  const active = node.key === activeKey;
  const docItems: MenuItem[] = [];
  if (onRequestRename && node.key) {
    docItems.push({ label: "重命名", icon: <EditIcon size={14} />, onClick: () => onRequestRename({ kind: "doc", id: node.key!, name: node.name }) });
  }
  if (onMoveDoc && node.key) {
    docItems.push({ label: "移动到…", icon: <MoveIcon size={14} />, onClick: () => setMoveOpen(true) });
  }
  if (onDuplicateDoc && node.key) {
    docItems.push({ label: "复制", icon: <CopyIcon size={14} />, onClick: () => onDuplicateDoc(node.key!) });
  }
  if (onPinDoc && node.key) {
    docItems.push({
      label: node.pinned ? "取消置顶" : "置顶",
      icon: <PinIcon size={13} filled={node.pinned} />,
      onClick: () => onPinDoc(node.key!, !node.pinned),
    });
  }
  if (onExportDoc && node.key) {
    docItems.push({ label: "导出", icon: <ExportIcon size={13} />, onClick: () => onExportDoc(node.key!) });
  }
  if (onRequestDeleteDoc && node.key) {
    docItems.push({ label: "删除", icon: <TrashIcon size={14} />, danger: true, onClick: () => onRequestDeleteDoc(node) });
  }

  return (
    <div
      onClick={() => node.key && onSelect(node.key)}
      draggable={!!onMoveDoc}
      onDragStart={(e) => {
        if (!node.key) return;
        e.dataTransfer.setData("text/plain", node.key);
        e.dataTransfer.effectAllowed = "move";
      }}
      className={`group flex w-full cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-left text-[15px] transition-colors ${
        active ? "bg-active text-accent" : "text-text hover:bg-hover"
      }`}
      style={{ paddingLeft: 8 + depth * 12 + 18 }}
    >
      <FileIcon size={16} className={`shrink-0 ${active ? "text-accent" : "text-faint"}`} />
      <span className="min-w-0 flex-1 truncate">{node.name}</span>

      {node.pinned && <PinIcon size={12} filled className="shrink-0 text-accent" />}

      {onNew && (
        <div className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => setAddOpen((v) => !v)} className={hoverBtn}>
            <PlusIcon />
          </button>
          {addOpen && (
            <NewNodeMenu onSelect={(t) => onNew(t, node.folder_id ?? null)} onClose={() => setAddOpen(false)} />
          )}
        </div>
      )}
      {docItems.length > 0 && (
        <div className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => setMenuOpen((v) => !v)} className={hoverBtn}>
            <DotsIcon />
          </button>
          {menuOpen && <TreeNodeMenu items={docItems} onClose={() => setMenuOpen(false)} />}
        </div>
      )}

      {moveOpen && node.key && (
        <div
          className="menu-panel absolute right-0 top-full z-30 mt-1 max-h-56 w-44 overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              onMoveDoc!(node.key!, null);
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
                onMoveDoc!(node.key!, f.id);
                setMoveOpen(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-muted hover:bg-hover hover:text-text"
            >
              <FolderIcon size={13} className="shrink-0 text-faint" />
              <span className="truncate">{f.name}</span>
            </button>
          ))}
          {folders.length === 0 && (
            <div className="px-3 py-1.5 text-[11px] text-faint">暂无文件夹，可先新建</div>
          )}
        </div>
      )}
    </div>
  );
}

export function FileTree({
  data,
  activeKey,
  onSelect,
  folders = [],
  onNew,
  onRenameDoc,
  onRenameFolder,
  onDeleteDoc,
  onDeleteFolder,
  onMoveDoc,
  onDuplicateDoc,
  onPinDoc,
  onExportDoc,
}: {
  data: TreeNode[];
  activeKey: string | null;
  onSelect: (key: string) => void;
  folders?: Folder[];
  onNew?: (type: NodeType, parentFolderId: string | null) => void;
  onRenameDoc?: (docId: string, name: string) => Promise<void> | void;
  onRenameFolder?: (folderId: string, name: string) => Promise<void> | void;
  onDeleteDoc?: (key: string) => void;
  onDeleteFolder?: (id: string) => void;
  onMoveDoc?: (docId: string, folderId: string | null) => void;
  onDuplicateDoc?: (docId: string) => void;
  onPinDoc?: (docId: string, pinned: boolean) => void;
  onExportDoc?: (docId: string) => void;
}) {
  const [pendingDeleteDoc, setPendingDeleteDoc] = useState<TreeNode | null>(null);
  const [pendingDeleteFolder, setPendingDeleteFolder] = useState<TreeNode | null>(null);
  const [pendingRename, setPendingRename] = useState<RenameTarget | null>(null);
  const [dragOverRoot, setDragOverRoot] = useState(false);

  return (
    <>
      <nav
        className={`flex flex-col gap-0.5 rounded-md ${dragOverRoot ? "bg-active ring-1 ring-inset ring-accent" : ""}`}
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
            onNew={onNew}
            onRequestRename={setPendingRename}
            onRequestDeleteDoc={onDeleteDoc ? setPendingDeleteDoc : undefined}
            onRequestDeleteFolder={onDeleteFolder ? setPendingDeleteFolder : undefined}
            onMoveDoc={onMoveDoc}
            onDuplicateDoc={onDuplicateDoc}
            onPinDoc={onPinDoc}
            onExportDoc={onExportDoc}
          />
        ))}
      </nav>

      <ConfirmDialog
        open={pendingDeleteDoc !== null}
        title="删除文档"
        message={`确定要删除「${pendingDeleteDoc?.name ?? ""}」吗？可在回收站中恢复。`}
        confirmText="删除"
        cancelText="取消"
        onConfirm={() => {
          if (pendingDeleteDoc?.key && onDeleteDoc) onDeleteDoc(pendingDeleteDoc.key);
          setPendingDeleteDoc(null);
        }}
        onCancel={() => setPendingDeleteDoc(null)}
      />

      <ConfirmDialog
        open={pendingDeleteFolder !== null}
        title="删除文件夹"
        message={`确定要删除文件夹「${pendingDeleteFolder?.name ?? ""}」吗？文件夹内的文档将移动到根目录，可在回收站中恢复。`}
        confirmText="删除"
        cancelText="取消"
        onConfirm={() => {
          if (pendingDeleteFolder?.key && onDeleteFolder) onDeleteFolder(pendingDeleteFolder.key);
          setPendingDeleteFolder(null);
        }}
        onCancel={() => setPendingDeleteFolder(null)}
      />

      <RenameDialog
        open={pendingRename !== null}
        title={pendingRename?.kind === "doc" ? "重命名文档" : "重命名文件夹"}
        initialName={pendingRename?.name ?? ""}
        onClose={() => setPendingRename(null)}
        onConfirm={async (name) => {
          if (!pendingRename) return;
          if (pendingRename.kind === "doc") await onRenameDoc?.(pendingRename.id, name);
          else await onRenameFolder?.(pendingRename.id, name);
        }}
      />
    </>
  );
}
