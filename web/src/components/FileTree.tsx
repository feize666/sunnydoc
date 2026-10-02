"use client";

import { useState, useRef, useMemo } from "react";
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
import { NewNodeMenu, type NodeType } from "./NewNodeMenu";
import { TreeNodeMenu, type MenuItem } from "./TreeNodeMenu";
import { RenameDialog } from "./RenameDialog";
import { sortSiblingsForManual } from "@/lib/buildTree";

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

function KbIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}

function ImportIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
    </svg>
  );
}

type RenameTarget = { kind: "doc" | "folder"; id: string; name: string };
type DropPos = "before" | "after" | "inside";

// 排序步长，与后端 db.SORT_STEP 保持一致。
// 旧实现用 createdAt（秒级时间戳，约 1.79e9）兜底，与重播种后的「间隔 1024 小整数」
// 相差 6 个数量级，混用会让落点难以预料 —— 因此兜底改为常量基准，不再依赖时间戳。
const SORT_STEP = 1024;

/** 无 sort_order 时的兜底值。用 0 起步，与后端 reseed 的「首个 = 1024」同一坐标系。 */
const orderOf = (n: TreeNode) => n.sort_order ?? 0;

/** 选中项的 kind：文档只能软删除（连后代）；文件夹软删除自身+后代、文档回根目录。 */
type SelectionKind = "doc" | "folder";

// ── 树缩进常数 ────────────────────────────────────────────────────────────
//
// ⚠️ 缩进必须**只有一个来源**：行容器的 paddingLeft。
//
// 曾经的实现把缩进同时写在两处 —— 文件夹行的 SelectBox `<span>` 用 marginLeft、
// 内层 `<button>` 用 paddingLeft，两个 8 + depth*12 是叠加的，文件夹行每层实际
// 递进 24px；而文档行只在行上写一次（8 + depth*12 + 18），每层只递进 12px。
// 步长不一致的后果：越深偏得越远。实测（depth 1→3）
//   d1 文件夹 label@102
//   d2 文件夹 label@126   ← 比同级文档(090) 靠右 36px
//   d3 文档   label@102   ← 与 d1 文件夹同深
// 于是「kvm 下的文档」看起来挂在 d1 上，「09-虚拟化工具使用」的直属文档比父文件夹还浅。
//
// 现在：选择框改为 absolute（停在这条常驻留白带里，不占布局宽度），
// 缩进统一由行 paddingLeft 承担，文件夹行与文档行严格同层同深。

/** 每层缩进步长（px）。文件夹行与文档行共用，沿用修复前的既有值，未做设计变更。 */
const INDENT_STEP = 12;
/** 树根行内容相对侧栏左缘的内边距（px）。 */
const TREE_BASE_PAD = 8;
/**
 * 选择框的常驻留白宽度（px）。文件夹行把它作为内层 `<button>` 的**常量** paddingLeft；
 * 选择框本身绝对定位停在这条留白带里，不占布局宽度、也不再随 depth 累加。
 */
const SELECT_GUTTER = 22;
/**
 * 文档行的前缀补偿（px）：让文档的**类型图标**与**文字**同时和同级文件夹对齐。
 *
 *   文件夹：pl=8 → [留白 22] [chevron 14] [gap 6] [folderIcon 16] [gap 6] 文字
 *                  ⇒ folderIcon@ pl+42、文字@ pl+64
 *   文档  ：pl=8+42=50 → [fileIcon 16] [gap 6] 文字
 *                  ⇒ fileIcon@ pl+42、文字@ pl+64  ✅ 两项都对齐
 *
 * 注意文档行用的是 `gap-1.5`(6px) 而非 `gap-1`(4px)：不是随手改的 ——
 * 4px 只能让「图标对齐、文字差 2px」或反之，二者不可兼得；取 6px 才同时成立。
 */
const DOC_PREFIX_COMPENSATION = SELECT_GUTTER + 20;

function CheckIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

/** 选择框：未选中时 hover 才显形（沿用 reveal-on-hover），选中后常显。 */
function SelectBox({
  checked,
  onClick,
  reveal = false,
}: {
  checked: boolean;
  onClick: (e: React.MouseEvent) => void;
  reveal?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={checked ? "取消选择" : "选择"}
      aria-pressed={checked}
      className={`grid h-4 w-4 shrink-0 place-items-center rounded border transition-colors ${
        reveal && !checked ? "reveal-on-hover" : ""
      } ${
        checked
          ? "border-accent bg-accent text-white"
          : "border-line-strong bg-surface text-transparent hover:border-accent"
      }`}
    >
      <CheckIcon />
    </button>
  );
}

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
  onMoveFolder,
  onMoveToKb,
  onDuplicateDoc,
  onPinDoc,
  onPinFolder,
  onExportDoc,
  onImportToFolder,
  onReorder,
  selectionMode = false,
  selected,
  onToggleSelect,
  siblings = [],
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
  onMoveDoc?: (docId: string, folderId: string | null, sortOrder?: number | null) => void;
  onMoveFolder?: (folderId: string, parentId: string | null, sortOrder?: number | null) => void;
  onMoveToKb?: (docId: string) => void;
  onDuplicateDoc?: (docId: string) => void;
  // 第二个参数是「目标状态」（希望变成的样子），不是当前状态
  onPinDoc?: (docId: string, nextPinned: boolean) => void;
  onPinFolder?: (folderId: string, nextPinned: boolean) => void;
  onExportDoc?: (docId: string) => void;
  onImportToFolder?: (folderId: string, folderName: string) => void;
  onReorder?: (
    draggedKey: string,
    draggedKind: "folder" | "file",
    target: TreeNode,
    position: DropPos,
    siblings: TreeNode[],
  ) => void;
  selectionMode?: boolean;
  selected?: Set<string>;
  onToggleSelect?: (key: string, kind: SelectionKind, node: TreeNode) => void;
  siblings?: TreeNode[];
  depth?: number;
}) {
  const [open, setOpen] = useState(depth === 0);
  const [addOpen, setAddOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [dropPos, setDropPos] = useState<DropPos | null>(null);
  const dropPosRef = useRef<DropPos | null>(null);
  const addBtnRef = useRef<HTMLButtonElement | null>(null);
  const menuBtnRef = useRef<HTMLButtonElement | null>(null);

  const canDrag = !!onReorder;
  const isFolder = node.type === "folder";
  const isSelected = !!(node.key && selected?.has(node.key));

  const hoverBtn =
    "reveal-on-hover grid h-6 w-6 place-items-center rounded-md text-faint hover:bg-hover hover:text-accent";

  const handleDragOver = (e: React.DragEvent) => {
    if (!canDrag) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const h = rect.height;
    let pos: DropPos;
    if (isFolder && y > h * 0.3 && y < h * 0.7) {
      pos = "inside";
    } else if (y < h / 2) {
      pos = "before";
    } else {
      pos = "after";
    }
    dropPosRef.current = pos;
    setDropPos(pos);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    dropPosRef.current = null;
    setDropPos(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    if (!canDrag) return;
    e.preventDefault();
    e.stopPropagation();
    const draggedKey = e.dataTransfer.getData("text/plain");
    const draggedKind = (e.dataTransfer.getData("application/x-kind") || "file") as "folder" | "file";
    const pos = dropPosRef.current ?? (isFolder ? "inside" : "after");
    dropPosRef.current = null;
    setDropPos(null);
    if (!draggedKey || draggedKey === node.key) return;
    onReorder?.(draggedKey, draggedKind, node, pos, siblings);
  };

  const dropClass =
    dropPos === "before"
      ? "ring-2 ring-inset ring-accent ring-offset-0 [box-shadow:inset_0_2px_0_0_var(--accent,#378ADD)]"
      : dropPos === "after"
      ? "[box-shadow:inset_0_-2px_0_0_var(--accent,#378ADD)]"
      : dropPos === "inside"
      ? "bg-accent-soft ring-1 ring-inset ring-accent"
      : "";

  const renderMoveMenu = (onPick: (folderId: string | null) => void) => (
    <div
      className="menu-panel absolute right-0 top-full z-30 mt-1 max-h-56 w-44 overflow-y-auto"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        onClick={() => { onPick(null); setMoveOpen(false); }}
        className="menu-item text-muted hover:text-text"
      >
        <FolderIcon size={13} className="shrink-0 text-faint" />
        根目录
      </button>
      {folders.filter((f) => f.id !== node.key).map((f) => (
        <button
          key={f.id}
          onClick={() => { onPick(f.id); setMoveOpen(false); }}
          className="menu-item text-muted hover:text-text"
        >
          <FolderIcon size={13} className="shrink-0 text-faint" />
          <span className="truncate">{f.name}</span>
        </button>
      ))}
      {folders.length === 0 && (
        <div className="px-3 py-1.5 text-[12px] text-faint">暂无文件夹，可先新建</div>
      )}
    </div>
  );

  if (node.type === "folder") {
    const folderItems: MenuItem[] = [];
    if (onImportToFolder && node.key) {
      folderItems.push({ label: "导入文档到此处", icon: <ImportIcon size={14} />, onClick: () => onImportToFolder(node.key!, node.name) });
    }
    if (onNew) {
      folderItems.push({ label: "新建文档", icon: <FileIcon size={14} />, onClick: () => onNew("doc", node.key ?? null) });
      folderItems.push({ label: "新建子目录", icon: <FolderIcon size={14} />, onClick: () => onNew("folder", node.key ?? null) });
    }
    if (onRequestRename && node.key) {
      folderItems.push({ label: "重命名", icon: <EditIcon size={14} />, onClick: () => onRequestRename({ kind: "folder", id: node.key!, name: node.name }) });
    }
    if (onMoveFolder && node.key) {
      folderItems.push({ label: "移动到…", icon: <MoveIcon size={14} />, onClick: () => setMoveOpen(true) });
    }
    if (onPinFolder && node.key) {
      folderItems.push({
        label: node.pinned ? "取消置顶" : "置顶",
        icon: <PinIcon size={13} filled={node.pinned} />,
        onClick: () => onPinFolder(node.key!, !node.pinned),
      });
    }
    if (onRequestDeleteFolder && node.key) {
      folderItems.push({ label: "删除", icon: <TrashIcon size={14} />, danger: true, onClick: () => onRequestDeleteFolder(node) });
    }

    return (
      <div>
        <div
          draggable={canDrag}
          onDragStart={(e) => {
            if (!node.key) return;
            e.dataTransfer.setData("text/plain", node.key);
            e.dataTransfer.setData("application/x-kind", "folder");
            e.dataTransfer.effectAllowed = "move";
          }}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`group relative flex w-full items-center gap-1 rounded-md py-1 text-left text-[16px] transition-colors ${
            dropPos === "inside" ? "bg-accent-soft ring-1 ring-inset ring-accent" : "text-text hover:bg-hover"
          } ${dropClass} ${isSelected ? "bg-accent-soft" : ""}`}
          style={{ paddingLeft: TREE_BASE_PAD + depth * INDENT_STEP }}
        >
          {node.key && onToggleSelect && (
            <span
              className="absolute top-1/2 -translate-y-1/2"
              style={{ left: TREE_BASE_PAD + depth * INDENT_STEP + 1 }}
            >
              <SelectBox
                checked={!!isSelected}
                reveal
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleSelect(node.key!, "folder", node);
                }}
              />
            </span>
          )}
          <button
            onClick={() => {
              if (!node.key) return;
              // 未进入多选时保持原行为（展开/收起）；已有多选时点行即切换选中。
              if (selectionMode && onToggleSelect) onToggleSelect(node.key, "folder", node);
              else setOpen((v) => !v);
            }}
            className="flex min-w-0 flex-1 items-center gap-1.5"
            style={{ paddingLeft: SELECT_GUTTER }}
          >
            <ChevronIcon
              size={14}
              className={`shrink-0 text-faint transition-transform ${open ? "rotate-90" : ""}`}
            />
            <FolderIcon size={16} className="shrink-0 text-faint" />
            <span className="truncate">{node.name}</span>
            {node.pinned && <PinIcon size={12} filled className="shrink-0 text-accent" />}
          </button>

          {onNew && (
            <div className="relative shrink-0">
              <button ref={addBtnRef} onClick={(e) => { e.stopPropagation(); setAddOpen((v) => !v); }} className={hoverBtn} title="新建子节点">
                <PlusIcon />
              </button>
              {addOpen && (
                <NewNodeMenu align="left" anchorRef={addBtnRef} onSelect={(t) => onNew(t, node.key ?? null)} onClose={() => setAddOpen(false)} />
              )}
            </div>
          )}
          {folderItems.length > 0 && (
            <div className="relative shrink-0">
              <button ref={menuBtnRef} onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }} className={hoverBtn} title="更多操作">
                <DotsIcon />
              </button>
              {menuOpen && <TreeNodeMenu items={folderItems} anchorRef={menuBtnRef} onClose={() => setMenuOpen(false)} />}
            </div>
          )}

          {moveOpen && node.key && onMoveFolder && renderMoveMenu((fid) => onMoveFolder(node.key!, fid))}
        </div>

        {open && node.children && node.children.length > 0 && (
          <div>
            {node.children.map((child) => (
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
                onMoveFolder={onMoveFolder}
                onDuplicateDoc={onDuplicateDoc}
                onPinDoc={onPinDoc}
                onPinFolder={onPinFolder}
                onExportDoc={onExportDoc}
                onImportToFolder={onImportToFolder}
                onReorder={onReorder}
                selectionMode={selectionMode}
                selected={selected}
                onToggleSelect={onToggleSelect}
                siblings={node.children}
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
  if (onMoveToKb && node.key) {
    docItems.push({
      label: "移动到知识库",
      icon: <KbIcon size={14} />,
      onClick: () => onMoveToKb(node.key!),
    });
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
      onClick={() => {
        if (!node.key) return;
        // 未进入多选时保持原行为（打开文档）；已有多选时点行即切换选中，
        // 免得每选一项都要瞄准左侧小复选框。
        if (selectionMode && onToggleSelect) onToggleSelect(node.key, "doc", node);
        else onSelect(node.key);
      }}
      draggable={canDrag && !selectionMode}
      onDragStart={(e) => {
        if (!node.key) return;
        e.dataTransfer.setData("text/plain", node.key);
        e.dataTransfer.setData("application/x-kind", "file");
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`group relative flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-left text-[16px] transition-colors ${
        active && !selectionMode ? "bg-accent-soft text-accent" : "text-text hover:bg-hover"
      } ${dropClass} ${isSelected ? "bg-accent-soft" : ""}`}
      style={{ paddingLeft: TREE_BASE_PAD + depth * INDENT_STEP + DOC_PREFIX_COMPENSATION }}
    >
      {active && !selectionMode && (
        <span
          className="absolute top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-accent"
          style={{ left: TREE_BASE_PAD + depth * INDENT_STEP + SELECT_GUTTER - 4 }}
        />
      )}
      {node.key && onToggleSelect && (
        <span
          onClick={(e) => e.stopPropagation()}
          className="absolute top-1/2 -translate-y-1/2"
          style={{ left: TREE_BASE_PAD + depth * INDENT_STEP + 1 }}
        >
          <SelectBox
            checked={!!isSelected}
            reveal
            onClick={() => onToggleSelect(node.key!, "doc", node)}
          />
        </span>
      )}
      <FileIcon size={16} className={`shrink-0 ${active && !selectionMode ? "text-accent" : "text-faint"}`} />
      <span className="min-w-0 flex-1 truncate">{node.name}</span>

      {node.pinned && <PinIcon size={12} filled className="shrink-0 text-accent" />}

      {onNew && (
        <div className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
          <button ref={addBtnRef} onClick={() => setAddOpen((v) => !v)} className={hoverBtn} title="新建子文档">
            <PlusIcon />
          </button>
          {addOpen && (
            <NewNodeMenu align="left" anchorRef={addBtnRef} onSelect={(t) => onNew(t, node.folder_id ?? null)} onClose={() => setAddOpen(false)} />
          )}
        </div>
      )}
      {docItems.length > 0 && (
        <div className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
          <button ref={menuBtnRef} onClick={() => setMenuOpen((v) => !v)} className={hoverBtn} title="更多操作">
            <DotsIcon />
          </button>
          {menuOpen && <TreeNodeMenu items={docItems} anchorRef={menuBtnRef} onClose={() => setMenuOpen(false)} />}
        </div>
      )}

      {moveOpen && node.key && onMoveDoc && renderMoveMenu((fid) => onMoveDoc(node.key!, fid))}
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
  onMoveFolder,
  onMoveToKb,
  onDuplicateDoc,
  onPinDoc,
  onPinFolder,
  onExportDoc,
  onImportToFolder,
  onDeleteSelected,
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
  onMoveDoc?: (docId: string, folderId: string | null, sortOrder?: number | null) => void;
  onMoveFolder?: (folderId: string, parentId: string | null, sortOrder?: number | null) => void;
  onMoveToKb?: (docId: string) => void;
  onDuplicateDoc?: (docId: string) => void;
  // 第二个参数是「目标状态」（希望变成的样子），不是当前状态
  onPinDoc?: (docId: string, nextPinned: boolean) => void;
  onPinFolder?: (folderId: string, nextPinned: boolean) => void;
  onExportDoc?: (docId: string) => void;
  onImportToFolder?: (folderId: string, folderName: string) => void;
  /** 批量删除选中项；返回实际删除数量（用于决定提示文案）。 */
  onDeleteSelected?: (docIds: string[], folderIds: string[]) => Promise<number>;
}) {
  const [pendingDeleteDoc, setPendingDeleteDoc] = useState<TreeNode | null>(null);
  const [pendingDeleteFolder, setPendingDeleteFolder] = useState<TreeNode | null>(null);
  const [pendingRename, setPendingRename] = useState<RenameTarget | null>(null);
  // 多选状态：key -> kind（文档/文件夹）。用 Map 而非 Set，批量删除时才知道往哪个数组放。
  const [selection, setSelection] = useState<Map<string, SelectionKind>>(new Map());
  const [confirmBatch, setConfirmBatch] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);

  // 树数据变化后（切换知识库、删除、刷新）会有选中项已不在树中：
  // 这里用「派生」而非 effect+setState 剔除失效项，避免级联渲染与 lint 告警。
  const aliveKeys = useMemo(() => {
    const alive = new Set<string>();
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        if (n.key) alive.add(n.key);
        if (n.children) walk(n.children);
      }
    };
    walk(data);
    return alive;
  }, [data]);

  const selectedIds = { docs: [] as string[], folders: [] as string[] };
  for (const [key, kind] of selection) {
    if (!aliveKeys.has(key)) continue; // 已从树中消失的选中项对外不再计数
    if (kind === "doc") selectedIds.docs.push(key);
    else selectedIds.folders.push(key);
  }
  const effectiveCount = selectedIds.docs.length + selectedIds.folders.length;
  const selectionMode = effectiveCount > 0;
  const selectedKeys = new Set([...selectedIds.docs, ...selectedIds.folders]);

  const toggleSelect = (key: string, kind: SelectionKind) => {
    setSelection((prev) => {
      const next = new Map(prev);
      if (next.has(key)) next.delete(key);
      else next.set(key, kind);
      return next;
    });
  };
  const clearSelection = () => setSelection(new Map());

  const handleBatchDelete = async () => {
    if (!onDeleteSelected || effectiveCount === 0) return;
    setBatchBusy(true);
    try {
      await onDeleteSelected(selectedIds.docs, selectedIds.folders);
      clearSelection();
      setConfirmBatch(false);
    } finally {
      setBatchBusy(false);
    }
  };

  const canReorder = !!(onMoveDoc && onMoveFolder);

  // 收集某文件夹的所有后代 id（含自身），用于前端拦截循环引用
  const collectDescendants = (nodes: TreeNode[], key: string): Set<string> => {
    const found = nodes.find((n) => n.key === key);
    if (!found) return new Set();
    const ids = new Set<string>();
    const walk = (n: TreeNode) => {
      ids.add(n.key ?? "");
      for (const c of n.children ?? []) walk(c);
    };
    walk(found);
    return ids;
  };

  const handleReorder = (
    draggedKey: string,
    draggedKind: "folder" | "file",
    target: TreeNode,
    position: DropPos,
    siblings: TreeNode[],
  ) => {
    let parentId: string | null;
    let sortOrder: number;

    // ⚠️ 落点必须用「手动序」的相邻关系来算，不能用 siblings 的数组顺序。
    //
    // siblings 是 buildTree 按**当前排序模式**排好的视觉序（名称/数字/创建/修改），
    // 而落点要写回 sort_order —— 两者只在「手动顺序」模式下同源。在别的模式下
    // 拿视觉相邻项取中点，会落到完全无关的坐标（实测：按名称模式把 A 拖到 B 之后，
    // 落点 5632 = (C 5120 + B 6144)/2，切回手动序后 A 并不在 B 之后）。
    //
    // 修法：先在与目标**同一父节点**的兄弟中筛出「与拖拽项同类型」的集合
    // （文件夹与文档在树里是两个互不越过的区段），按手动序排序，
    // 再把拖拽项摘掉 —— 于是「视觉相邻」被替换为「手动序相邻」，中点法才成立。
    //
    // 必须摘掉拖拽项再取邻居：否则「A 拖到 B 之后」会取到 A 自己当 prev，
    // 或取到 target 自己当 next（中点 =(B+B)/2 = B，撞成并列后触发后端重平衡）。
    const draggedKindType = draggedKind === "folder" ? "folder" : "file";
    const lane = sortSiblingsForManual(siblings.filter((s) => s.type === draggedKindType));
    const reduced = lane.filter((s) => s.key !== draggedKey);

    if (position === "inside" && target.type === "folder") {
      parentId = target.key ?? null;
      const children = target.children ?? [];
      if (children.length > 0) {
        // 落到该文件夹「最上方」：同级最小值 − 步长
        sortOrder = Math.min(...children.map(orderOf)) - SORT_STEP;
      } else {
        // 空文件夹：从 0 起步（后端 reseed 的首个值为 1024，此处取 0 稳定落在其前）
        sortOrder = 0;
      }
    } else {
      parentId = target.folder_id ?? null;
      const ti = reduced.findIndex((s) => s.key === target.key);
      const prev = ti > 0 ? reduced[ti - 1] : null;
      const next = ti >= 0 && ti < reduced.length - 1 ? reduced[ti + 1] : null;
      if (position === "before") {
        // 落在 target 之前：取 prev 与 target 的中点；target 已是首个则再往前一个步长
        sortOrder = prev
          ? (orderOf(prev) + orderOf(target)) / 2
          : orderOf(target) - SORT_STEP;
      } else {
        // 落在 target 之后：取 target 与 next 的中点；target 已是末个则再往后一个步长
        sortOrder = next
          ? (orderOf(target) + orderOf(next)) / 2
          : orderOf(target) + SORT_STEP;
      }
    }

    // 前端拦截循环：文件夹不能移到自身或自己的后代
    if (draggedKind === "folder" && parentId) {
      const descendants = collectDescendants(data, draggedKey);
      if (descendants.has(parentId)) {
        return;
      }
    }

    if (draggedKind === "folder") {
      onMoveFolder?.(draggedKey, parentId, sortOrder);
    } else {
      onMoveDoc?.(draggedKey, parentId, sortOrder);
    }
  };

  return (
    <>
      <nav className="flex flex-col gap-0.5 rounded-md">
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
            onMoveFolder={onMoveFolder}
            onMoveToKb={onMoveToKb}
            onDuplicateDoc={onDuplicateDoc}
            onPinDoc={onPinDoc}
            onPinFolder={onPinFolder}
            onExportDoc={onExportDoc}
            onImportToFolder={onImportToFolder}
            onReorder={canReorder && !selectionMode ? handleReorder : undefined}
            selectionMode={selectionMode}
            selected={selectedKeys}
            onToggleSelect={toggleSelect}
            siblings={data}
          />
        ))}
      </nav>

      {selectionMode && (
        <div className="sticky bottom-0 z-20 -mx-1 mt-1 flex items-center gap-2 rounded-md border border-line bg-surface-2 px-2 py-1.5 shadow-sm">
          <span className="min-w-0 flex-1 truncate text-[13px] text-muted">
            已选 <span className="font-semibold text-text">{effectiveCount}</span> 项
          </span>
          <button
            onClick={clearSelection}
            className="btn btn-secondary !px-2 !py-1 !text-[13px]"
            title="退出多选"
          >
            取消
          </button>
          <button
            onClick={() => setConfirmBatch(true)}
            disabled={batchBusy}
            className="btn bg-danger-solid !px-2.5 !py-1 !text-[13px] text-white hover:bg-danger-solid-hover disabled:opacity-60"
          >
            {batchBusy ? "删除中…" : "删除"}
          </button>
        </div>
      )}

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

      <ConfirmDialog
        open={confirmBatch}
        title="批量删除"
        message={
          `确定要删除选中的 ${effectiveCount} 项吗？` +
          (selectedIds.folders.length > 0
            ? `其中 ${selectedIds.folders.length} 个文件夹会被删除，其下文档将移动到根目录。`
            : "") +
          "所有内容都可在回收站中恢复。"
        }
        confirmText={batchBusy ? "删除中…" : "删除"}
        cancelText="取消"
        onConfirm={handleBatchDelete}
        onCancel={() => setConfirmBatch(false)}
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
