"use client";

import { useState, useRef, useEffect } from "react";
import { FileTree } from "./FileTree";
import { Tooltip } from "./Tooltip";
import { PlusIcon, SearchIcon, CloseIcon, FileIcon } from "./icons";
import { EmptyState } from "./EmptyState";
import { useResizable } from "@/hooks/useResizable";
import { parseTagQuery } from "@/lib/tagQuery";
import type { TreeNode, SortBy } from "@/data/docs";
import type { Folder, SearchResult, DocMeta } from "@/lib/api";
import { NewNodeMenu, PORTAL_MENU_ATTR, type NodeType } from "./NewNodeMenu";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** 安全地高亮关键词（先转义，再包裹 <mark>）；支持多关键词（空格分隔）。 */
function highlightKw(text: string, kw: string): string {
  const escaped = escapeHtml(text);
  if (!kw) return escaped;
  const kws = kw.trim().split(/\s+/).filter(Boolean).map(escapeHtml);
  if (kws.length === 0) return escaped;
  const lower = escaped.toLowerCase();
  // 收集所有命中区间
  const ranges: Array<[number, number]> = [];
  for (const k of kws) {
    const kl = k.toLowerCase();
    let i = 0;
    while (i < escaped.length) {
      const idx = lower.indexOf(kl, i);
      if (idx === -1) break;
      ranges.push([idx, idx + k.length]);
      i = idx + k.length;
    }
  }
  if (ranges.length === 0) return escaped;
  // 合并重叠区间
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) {
      last[1] = Math.max(last[1], r[1]);
    } else {
      merged.push([r[0], r[1]]);
    }
  }
  // 按区间插入 mark
  let out = "";
  let pos = 0;
  for (const [s, e] of merged) {
    out += escaped.slice(pos, s);
    out += `<mark class="search-hit">${escaped.slice(s, e)}</mark>`;
    pos = e;
  }
  out += escaped.slice(pos);
  return out;
}

/**
 * 搜索态的类型过滤 chip。
 *
 * ⚠️ 必须覆盖**全部**可搜索的类型：此前只有 doc/table/board/datasheet 四项，
 * 流程图与思维导图建出来后按类型过滤会「消失」（不是没数据，是入口没列），
 * 幻灯片同理。这类「枚举漏项」不会报错，只会让功能悄悄少一块。
 * 不要含 `folder`：目录不是文档，不出现在搜索结果里。
 */
const TYPE_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "全部" },
  { value: "doc", label: "文档" },
  { value: "table", label: "表格" },
  { value: "datasheet", label: "数据表" },
  { value: "board", label: "画板" },
  { value: "mindmap", label: "思维导图" },
  { value: "flowchart", label: "流程图" },
  { value: "slides", label: "幻灯片" },
];

function TypeIcon({ type }: { type?: string }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (type === "table") {
    return (
      <svg {...common}>
        <path d="M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18" />
      </svg>
    );
  }
  if (type === "board") {
    return (
      <svg {...common}>
        <path d="M3 3h18v18H3zM7 16l4-4 3 2 4-5" />
      </svg>
    );
  }
  if (type === "datasheet") {
    return (
      <svg {...common}>
        <path d="M4 5h16v14H4zM4 9h16M9 9v10" />
      </svg>
    );
  }
  if (type === "slides") {
    return (
      <svg {...common}>
        <path d="M3 5h18v12H3zM3 9h18M9 9v8" />
      </svg>
    );
  }
  if (type === "flowchart") {
    return (
      <svg {...common}>
        <path d="M4 4h6v5H4zM14 15h6v5h-6zM7 9v3a3 3 0 0 0 3 3h4" />
      </svg>
    );
  }
  if (type === "mindmap") {
    return (
      <svg {...common}>
        <path d="M12 4v16M12 8H5M12 14h7M4 6h4v4H4zM16 12h4v4h-4z" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}

export function Sidebar({
  data,
  activeKey,
  onSelect,
  collapsed,
  onToggleCollapse,
  folders,
  onImport,
  onExport,
  onRefresh,
  onDeleteDoc,
  onDeleteFolder,
  onDeleteSelected,
  onMoveSelected,
  onManageTags,
  onRenameFolder,
  onMoveDoc,
  onMoveFolder,
  onMoveToKb,
  onNew,
  onRenameDoc,
  onDuplicateDoc,
  onPinDoc,
  onPinFolder,
  onExportDoc,
  onImportToFolder,
  /**
   * 文档树批量展开/折叠的状态。null 表示未控制（用户自由态）。
   * Sidebar 把这个状态透传给 FileTree —— FileTree 内部用 useEffect 把批量值
   * 应用到每个节点，但「用户单独点过某节点」会让该节点脱离批量控制。
   */
  batchedAll,
  batchedAt,
  onToggleBatchedAll,
  listError,
  kbName,
  searchQuery,
  onSearchChange,
  searchType,
  onSearchTypeChange,
  searchTag,
  onSearchTagChange,
  /** 侧栏「标签」浏览区的标签及计数（page.tsx 从已加载 metas 现算，零额外请求）。 */
  tagList,
  /** 当前选中标签下的文档（同样现算，不新增请求）。 */
  tagDocs,
  onEditTags,
  onGenerateSummary,
  onTagSelect,
  searchSort,
  onSearchSortChange,
  searchResults,
  searchTerms,
  searching,
  onOpenSearchResult,
  sortBy,
  onSortChange,
  readOnly,
  onOpenTrash,
  mobile,
  onCloseMobile,
}: {
  data: TreeNode[];
  activeKey: string | null;
  onSelect: (key: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  folders: Folder[];
  onImport: () => void;
  onExport: () => void;
  onRefresh?: () => void;
  onDeleteDoc?: (key: string) => void;
  onDeleteFolder?: (id: string) => void;
  /** 批量删除选中项；返回实际删除数量。 */
  onDeleteSelected?: (docIds: string[], folderIds: string[]) => Promise<number>;
  /** 批量移动选中的文档到其他知识库（打开 MoveToKbDialog）。 */
  onMoveSelected?: (docIds: string[]) => void;
  /** 打开标签管理（重命名 / 合并 / 删除）。 */
  onManageTags?: () => void;
  onRenameFolder?: (folderId: string, name: string) => Promise<void> | void;
  onMoveDoc?: (docId: string, folderId: string | null, sortOrder?: number | null) => void;
  onMoveFolder?: (folderId: string, parentId: string | null, sortOrder?: number | null) => void;
  onMoveToKb?: (docId: string) => void;
  onNew?: (type: NodeType, parentFolderId: string | null) => void;
  onRenameDoc?: (docId: string, name: string) => Promise<void> | void;
  onDuplicateDoc?: (docId: string) => void;
  // 第二个参数是「目标状态」（希望变成的样子），不是当前状态
  onPinDoc?: (docId: string, nextPinned: boolean) => void;
  onPinFolder?: (folderId: string, nextPinned: boolean) => void;
  onExportDoc?: (docId: string) => void;
  onImportToFolder?: (folderId: string, folderName: string) => void;
  /** 批量展开/折叠：null=未控制；true=展开全部；false=折叠全部 */
  batchedAll?: boolean | null;
  /** 切换批量展开/折叠：参数是「下一个目标态」 */
  onToggleBatchedAll?: () => void;
  /**
   * 每次切批量态时 +1（让 FileTree 内部 useEffect 重新触发；batchedAll=true/false
   * 看起来一样但用 timestamp 区分「用户期望再应用一次」）。
   */
  batchedAt?: number;
  listError?: string | null;
  kbName?: string;
  onOpenTrash?: () => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  searchType: string;
  onSearchTypeChange: (t: string) => void;
  searchTag: string;
  onSearchTagChange: (t: string) => void;
  tagList?: { name: string; count: number }[];
  tagDocs?: DocMeta[];
  onEditTags?: (docId: string) => void;
  onGenerateSummary?: (docId: string) => void;
  onTagSelect?: (tag: string) => void;
  searchSort: string;
  onSearchSortChange: (s: string) => void;
  searchResults: SearchResult[];
  /**
   * 后端实际参与匹配的词。**高亮必须用它**：后端按中文分词 OR 匹配，
   * 「虚拟机怎么开机」命中的是「虚拟机」「开机」，文档里没有整串 ——
   * 若用原始查询串高亮会「有结果但零高亮」。空数组时回退到原始查询串。
   */
  searchTerms: string[];
  searching: boolean;
  onOpenSearchResult: (docId: string) => void;
  sortBy: SortBy;
  onSortChange: (s: SortBy) => void;
  readOnly?: boolean;
  mobile?: boolean;
  onCloseMobile?: () => void;
}) {
  /**
   * 高亮用的关键词串。
   *
   * 优先用后端回传的 `searchTerms`（空格拼接 —— `highlightKw` 本就按空白拆多词）。
   * 为什么不能只用 `searchQuery`：后端按中文分词 OR 匹配，
   * 「虚拟机怎么开机」命中的词是「虚拟机」「开机」，**文档里没有这个整串**，
   * 用原始串高亮会「有结果但零高亮」。`searchTerms` 为空时（旧后端/空查询）回退。
   */
  const hlKw = searchTerms.length > 0 ? searchTerms.join(" ") : searchQuery.trim();

  /**
   * `tag:xxx` 查询语法（解析与 page.tsx 的搜索 effect 共用 lib/tagQuery.ts，
   * 两边分叉会出现「侧栏显示搜索页、effect 却什么也没搜」）。
   *
   * - `effectiveQuery`：剥离标签 token 后的查询词 —— **视图分支用它**
   *   （只剩 "tag:foo" 时不应显示「无匹配结果」的搜索页，而是标签浏览视图）；
   * - `activeTag`：查询语法里的 token 优先于已选中的 chip（用户正在改标签名时
   *   视图要立刻跟上，不等 effect 同步）。
   */
  const { q: effectiveQuery, tag: tagFromQuery } = parseTagQuery(searchQuery);
  const activeTag = tagFromQuery || searchTag;

  /**
   * 显式设置标签筛选。查询框里未消费的 tag: token 会被剥离，但**保留其余查询词**
   * （粘贴「tag:foo 季度」后点其它标签 chip，不能把「季度」一起弄丢）；
   * 光敲「tag:foo」没敲完时 effectiveQuery 为 ""，即整个清掉。
   * 不剥离的话，留着 token 会让下一次 effect 运行把筛选又改回 token 里的标签
   * —— 表现为「点哪个 chip 都被弹回去」。
   */
  const setTagFilter = (t: string) => {
    if (tagFromQuery) onSearchChange(effectiveQuery);
    onSearchTagChange(t);
  };
  const clearTagFilter = () => setTagFilter("");

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const sortMenuRef = useRef<HTMLDivElement>(null);
  const [selIndex, setSelIndex] = useState(0);
  const [focused, setFocused] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [tagsCollapsed, setTagsCollapsed] = useState(false);
  /**
   * 树内**名称过滤**关键词（与 `searchQuery` 的全文搜索独立）。
   * 见渲染处注释：本库需滚 27.5 屏，需要「按名称秒筛、留在树里」的能力。
   */
  const [treeFilter, setTreeFilter] = useState("");

  /** 切换知识库时清空过滤 —— 过滤词是针对上一个库的，带过去会得到"空树"。 */
  useEffect(() => {
    setTreeFilter("");
  }, [kbName]);

  useEffect(() => {
    try {
      setHistory(JSON.parse(localStorage.getItem("search_history") || "[]"));
    } catch {
      setHistory([]);
    }
  }, []);

  const pushHistory = (q: string) => {
    const kw = q.trim();
    if (!kw) return;
    const next = [kw, ...history.filter((h) => h !== kw)].slice(0, 8);
    setHistory(next);
    try {
      localStorage.setItem("search_history", JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const { width: sidebarWidth, onMouseDown: onResize, dragging } = useResizable(260, 220, 480, "sidebar_width");

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      // createPortal 菜单挂在 body 上，DOM 不在 menuRef 子树内，
      // 不能只靠 contains 判定「点击外部」——否则 mousedown 会先卸载菜单，
      // mouseup/click 失去目标，菜单项永远点不动。命中 portal 标记时放行。
      const inPortalMenu =
        target instanceof Element && !!target.closest(`[${PORTAL_MENU_ATTR}]`);
      if (!inPortalMenu) {
        if (menuRef.current && !menuRef.current.contains(target)) {
          setMenuOpen(false);
        }
        if (
          sortMenuRef.current &&
          !sortMenuRef.current.contains(target)
        ) {
          setSortMenuOpen(false);
        }
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // 折叠态：aside 宽度平滑过渡到 40px，内容淡出（见下方 return）

  const sortOptions: { value: SortBy; label: string }[] = [
    { value: "manual", label: "手动顺序" },
    { value: "numeric", label: "按数字" },
    { value: "name", label: "按名称" },
    { value: "created", label: "按创建时间" },
    { value: "updated", label: "按修改时间" },
  ];

  const sortLabel =
    sortOptions.find((o) => o.value === sortBy)?.label ?? "排序";

  return (
    <aside
      style={{ width: collapsed && !mobile ? 40 : sidebarWidth }}
      className={`relative flex shrink-0 flex-col overflow-hidden border-r border-line bg-surface ${
        dragging ? "" : "sidebar-transition"
      } ${mobile ? "fixed inset-y-0 left-0 z-40 md:hidden" : "hidden md:flex"}`}
    >
      {/* 折叠态：仅显示展开按钮 */}
      {collapsed && !mobile && (
        <div className="flex justify-center pt-2.5">
          <Tooltip content="展开侧栏">
            <button
              onClick={onToggleCollapse}
              className="icon-btn border border-line text-faint hover:text-text"
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
          </Tooltip>
        </div>
      )}

      {!(collapsed && !mobile) && (
        <div
          onMouseDown={onResize}
          className="absolute right-0 bottom-0 top-0 z-10 w-2 cursor-col-resize transition-colors hover:bg-accent/25"
        />
      )}

      {/* 内容层：固定宽度，折叠时淡出 */}
      <div
        className="flex min-h-0 flex-1 flex-col"
        style={{
          width: sidebarWidth,
          opacity: collapsed && !mobile ? 0 : 1,
          transition:
            collapsed && !mobile ? "opacity 0.15s ease" : "opacity 0.15s ease 0.05s",
          pointerEvents: collapsed && !mobile ? "none" : "auto",
        }}
      >
      <div className="border-b border-line px-3 pb-2.5 pt-2.5">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex min-w-0 items-center gap-1.5">
            {/* 「返回首页」统一由 TitleBar 承担（其按钮 32px 位于全局标题栏）。
                此处原有一个 28px 的重复按钮，与标题栏纵向相邻、图标同为 ·左箭头·，
                属同一动作的冗余入口，故移除，避免「返回首页」重影。
                注：本头部右端的「折叠侧栏」（15 18l-6-6 6-6）与标题栏的汉堡按钮
                「折叠侧栏」（3 6h18…）是不同交互，保留。 */}
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="shrink-0 text-accent"
            >
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
            <span className="truncate text-[15px] font-semibold text-text">
              {kbName ?? "知识库 · 全部文档"}
            </span>
          </div>
          <div className="flex items-center gap-0.5">
            {onRefresh && (
              <Tooltip content="刷新文档列表">
                <button
                  onClick={onRefresh}
                  data-testid="refresh-doc-list"
                  className="grid h-6 w-6 place-items-center rounded-md text-faint transition-colors hover:bg-hover hover:text-text"
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
              </Tooltip>
            )}
            {/* 「全部展开 / 全部折叠」切换：
                - 当前未控制（batchedAll=null）：按钮文案「全部展开」
                - 当前批量展开（batchedAll=true）：按钮高亮 + 切到「全部折叠」
                - 当前批量折叠（batchedAll=false）：按钮高亮 + 切到「全部展开」
                三角双箭头图标在「未控制」与「折叠」下指右（点 → 展开）；
                在「展开」下指下（点 → 折叠）。 */}
            {onToggleBatchedAll && (
              <Tooltip
                content={
                  batchedAll === true
                    ? "全部折叠（按住以恢复默认）"
                    : batchedAll === false
                      ? "全部展开"
                      : "全部展开"
                }
              >
                <button
                  onClick={onToggleBatchedAll}
                  data-testid="toggle-batched-all"
                  aria-pressed={batchedAll === true}
                  className={`grid h-6 w-6 place-items-center rounded-md transition-colors hover:bg-hover ${
                    batchedAll === true
                      ? "text-accent"
                      : "text-faint hover:text-text"
                  }`}
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
                    // batchedAll=true 时旋转 90°（指针向下 → 表示已展开，提示点击会折叠）
                    style={{ transform: batchedAll === true ? "rotate(90deg)" : undefined }}
                  >
                    {/* 双三角：外"<<"  内">>*/}
                    <path d="M7 8l-4 4 4 4" />
                    <path d="M17 8l4 4-4 4" />
                  </svg>
                </button>
              </Tooltip>
            )}
            <Tooltip content="折叠侧栏">
              <button
                onClick={onToggleCollapse}
                className="grid h-6 w-6 place-items-center rounded-md text-faint transition-colors hover:bg-hover hover:text-text"
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
                  <path d="M15 18l-6-6 6-6" />
                </svg>
              </button>
            </Tooltip>
          </div>
        </div>

        {readOnly ? (
          <div className="flex items-center gap-1.5 rounded-lg bg-surface-2 px-2.5 py-1.5 text-[13px] text-faint">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            只读模式
          </div>
        ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="btn btn-accent text-white"
              data-testid="new-node-btn"
            >
              <PlusIcon size={15} />
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
              <NewNodeMenu
                align="left"
                anchorRef={menuRef}
                onSelect={(t) => {
                  onNew?.(t, null);
                  setMenuOpen(false);
                }}
                onClose={() => setMenuOpen(false)}
              />
            )}
          </div>

          <Tooltip content="导入文档">
            <button
              onClick={onImport}
              className="btn btn-secondary"
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
          </Tooltip>

          <Tooltip content="导出文档">
            <button
              onClick={onExport}
              className="btn btn-secondary"
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
          </Tooltip>
        </div>
        )}

        <div className="mt-2 flex items-center gap-1.5">
          <div className="relative flex-1">
            <SearchIcon
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
            />
            <input
              value={searchQuery}
              onChange={(e) => {
                onSearchChange(e.target.value);
                setSelIndex(0);
              }}
              onFocus={() => setFocused(true)}
              onBlur={() => setTimeout(() => setFocused(false), 150)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setSelIndex((i) => Math.min(i + 1, searchResults.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setSelIndex((i) => Math.max(i - 1, 0));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  const r = searchResults[Math.max(0, Math.min(selIndex, searchResults.length - 1))];
                  if (r) {
                    pushHistory(searchQuery);
                    onOpenSearchResult(r.doc_id);
                  }
                } else if (e.key === "Escape") {
                  onSearchChange("");
                  setSelIndex(0);
                }
              }}
              placeholder="搜索文档内容…"
              data-testid="sidebar-search"
              className="input input-icon pr-9"
            />
            {searchQuery && (
              <button
                onClick={() => onSearchChange("")}
                className="absolute right-1.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full text-faint transition-colors hover:bg-hover hover:text-text"
                title="清除"
              >
                <CloseIcon size={14} />
              </button>
            )}

            {focused && searchQuery.trim() === "" && history.length > 0 && (
              <div className="menu-panel absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-xl py-1">
                <div className="px-3 py-1 text-[12px] text-faint">最近搜索</div>
                {history.map((h) => (
                  <button
                    key={h}
                    onClick={() => onSearchChange(h)}
                    className="menu-item"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-faint">
                      <circle cx="11" cy="11" r="7" />
                      <path d="M21 21l-4-4" />
                    </svg>
                    <span className="truncate">{h}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="relative shrink-0" ref={sortMenuRef}>
            <Tooltip content="排序方式">
              <button
                onClick={() => setSortMenuOpen((v) => !v)}
                className="flex h-9 items-center gap-1 rounded-lg border border-line px-2.5 text-[14px] text-muted transition-colors hover:bg-hover hover:text-text"
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M8 6h13M8 12h13M8 18h13" />
                  <path d="M3 5l2 2 2-2M3 11l2 2 2-2M3 17l2 2 2-2" />
                </svg>
                {sortLabel}
              </button>
            </Tooltip>
            {sortMenuOpen && (
              <div className="menu-panel absolute right-0 top-full z-50 mt-1 w-32">
                {sortOptions.map((o) => (
                  <button
                    key={o.value}
                    onClick={() => {
                      onSortChange(o.value);
                      setSortMenuOpen(false);
                    }}
                    className={`menu-item justify-between ${
                      sortBy === o.value
                        ? "text-accent"
                        : "text-muted hover:text-text"
                    }`}
                  >
                    <span>{o.label}</span>
                    {sortBy === o.value && <span>✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 标签浏览区：数据由 page.tsx 从已加载 metas 现算，零额外请求。
          点击 chip = 按该标签筛选（再点一次取消）；仅在存在标签时渲染，
          避免无标签用户看到一块空白区。 */}
      {tagList && tagList.length > 0 && (
        <div className="border-b border-line px-3 py-2">
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-faint">标签</span>
            <div className="flex items-center gap-0.5">
              {onManageTags && (
                <button
                  onClick={onManageTags}
                  className="grid h-5 w-5 place-items-center rounded text-faint transition-colors hover:bg-hover hover:text-text"
                  title="管理标签（重命名 / 合并 / 删除）"
                  data-testid="manage-tags"
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                </button>
              )}
              <button
                onClick={() => setTagsCollapsed((v) => !v)}
                className="grid h-5 w-5 place-items-center rounded text-faint transition-colors hover:bg-hover hover:text-text"
                title={tagsCollapsed ? "展开标签" : "收起标签"}
              >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`transition-transform ${tagsCollapsed ? "" : "rotate-180"}`}
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            </div>
          </div>
          {!tagsCollapsed && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              {tagList.map((t) => (
                <button
                  key={t.name}
                  data-testid="sidebar-tag-chip"
                  data-active={activeTag === t.name ? "1" : undefined}
                  onClick={() =>
                    activeTag === t.name ? clearTagFilter() : setTagFilter(t.name)
                  }
                  className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] transition-colors ${
                    activeTag === t.name
                      ? "bg-accent-solid text-white"
                      : "bg-surface-2 text-muted hover:bg-accent-soft hover:text-accent"
                  }`}
                >
                  <span>#{t.name}</span>
                  {/*
                    🔴 计数必须用实色白，不能用 text-white/70（2026-10-21 实测修复）：
                    激活态底是 bg-accent-solid #2862f4，white/70 合成后 rgb(191,208,252)
                    对它只有 **3.29**（需 4.5）；实色白是 5.07 ✅。
                    这正是 DESIGN.md §6.3 写下的物理约束 —— 半透白恒 ≤ 纯白，
                    底是「实色中深蓝」时靠调 alpha 永远补不回来。
                  */}
                  <span className={activeTag === t.name ? "text-white" : "text-faint"}>
                    {t.count}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-1.5 py-2">
        {effectiveQuery !== "" ? (
          <div className="flex flex-col gap-0.5">
            <div className="flex flex-wrap items-center gap-1 px-1 py-1">
              {TYPE_FILTERS.map((t) => (
                <button
                  key={t.value}
                  onClick={() => onSearchTypeChange(t.value)}
                  className={`rounded-full px-2.5 py-0.5 text-[12px] transition-colors ${
                    searchType === t.value
                      ? "bg-accent-solid text-white"
                      : "text-muted hover:bg-hover hover:text-text"
                  }`}
                >
                  {t.label}
                </button>
              ))}
              <span className="mx-0.5 h-3 w-px bg-line" />
              <button
                onClick={() => onSearchSortChange("relevance")}
                className={`rounded-full px-2 py-0.5 text-[12px] transition-colors ${
                  searchSort === "relevance" ? "bg-accent-solid text-white" : "text-muted hover:bg-hover hover:text-text"
                }`}
              >
                相关度
              </button>
              <button
                onClick={() => onSearchSortChange("created")}
                className={`rounded-full px-2 py-0.5 text-[12px] transition-colors ${
                  searchSort === "created" ? "bg-accent-solid text-white" : "text-muted hover:bg-hover hover:text-text"
                }`}
              >
                时间
              </button>
              {activeTag && (
                <button
                  onClick={clearTagFilter}
                  className="flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[12px] text-accent"
                >
                  #{activeTag}
                  <span className="text-faint">×</span>
                </button>
              )}
            </div>
            <div className="flex items-center gap-1.5 px-2 py-1 text-[12px] text-faint">
              {searching ? (
                <>
                  <span className="spinner spinner-sm" />
                  搜索中…
                </>
              ) : (
                `共 ${searchResults.length} 条结果`
              )}
            </div>
            {searching && (
              <div className="space-y-1.5 px-1 py-1">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="rounded-md px-1 py-1.5">
                    <div className="skeleton skeleton-line w-3/4" />
                    <div className="skeleton skeleton-line mt-1.5 w-1/2" />
                  </div>
                ))}
              </div>
            )}
            {!searching && searchResults.length === 0 && (
              <div className="px-2 py-6 text-center text-[13px] text-faint">
                无匹配结果
              </div>
            )}
            {searchResults.map((r, i) => (
              <button
                key={r.doc_id}
                onClick={() => onOpenSearchResult(r.doc_id)}
                onMouseEnter={() => setSelIndex(i)}
                className={`lift-x flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left ${
                  i === selIndex ? "bg-hover" : "hover:bg-hover"
                }`}
              >
                <span className="mt-0.5 shrink-0 text-faint">
                  <TypeIcon type={r.type} />
                </span>
                <span className="flex min-w-0 flex-col gap-1">
                  <span
                    className="truncate text-[16px] text-text"
                    dangerouslySetInnerHTML={{
                      __html: highlightKw(r.title, hlKw),
                    }}
                  />
                  <span
                    className="line-clamp-2 text-[13px] leading-snug text-faint"
                    dangerouslySetInnerHTML={{
                      __html: highlightKw(r.snippet, hlKw),
                    }}
                  />
                  {r.summary && (
                    <span className="line-clamp-1 text-[12px] text-muted">
                      {r.summary}
                    </span>
                  )}
                  {(r.match_count ?? 0) > 0 && (
                    <span className="text-[11px] text-faint/80">
                      命中 {r.match_count} 处
                    </span>
                  )}
                  {(r.tags && r.tags.length > 0) && (
                    <span className="flex flex-wrap items-center gap-1">
                      {r.tags.map((t) => (
                        <span
                          key={t}
                          onClick={(e) => {
                            e.stopPropagation();
                            setTagFilter(t);
                          }}
                          className="rounded bg-surface-2 px-1.5 py-px text-[11px] text-muted hover:bg-accent-soft hover:text-accent"
                        >
                          #{t}
                        </span>
                      ))}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        ) : activeTag ? (
          /* 标签浏览视图：无关键词时按标签列出文档。
             数据来自 page.tsx 现算（tagDocs），不新增请求；
             点文档直接打开，点文档上的其它标签 chip 可横向切换筛选。 */
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center justify-between px-2 py-1">
              <span className="text-[12px] text-faint">
                标签 <span className="text-accent">#{activeTag}</span> ·{" "}
                {tagDocs?.length ?? 0} 篇
              </span>
              <button
                onClick={clearTagFilter}
                className="flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[12px] text-accent"
              >
                清除筛选
                <span className="text-faint">×</span>
              </button>
            </div>
            {(tagDocs?.length ?? 0) === 0 && (
              <div className="px-2 py-6 text-center text-[13px] text-faint">
                该标签下暂无文档
              </div>
            )}
            {(tagDocs ?? []).map((d) => (
              <button
                key={d.id}
                onClick={() => onOpenSearchResult(d.id)}
                className="lift-x flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-hover"
              >
                <span className="mt-0.5 shrink-0 text-faint">
                  <TypeIcon type={d.type} />
                </span>
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="truncate text-[16px] text-text">{d.title}</span>
                  {d.summary && (
                    <span className="line-clamp-1 text-[12px] text-muted">
                      {d.summary}
                    </span>
                  )}
                  {(d.tags?.length ?? 0) > 0 && (
                    <span className="flex flex-wrap items-center gap-1">
                      {d.tags!.map((t) => (
                        <span
                          key={t}
                          onClick={(e) => {
                            e.stopPropagation();
                            setTagFilter(t);
                          }}
                          className="rounded bg-surface-2 px-1.5 py-px text-[11px] text-muted hover:bg-accent-soft hover:text-accent"
                        >
                          #{t}
                        </span>
                      ))}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <>
            {listError && (
              <div className="mx-1 mb-2 rounded-md border border-danger/40 bg-danger-soft px-2 py-1.5 text-[12px] text-danger">
                {listError}（后端服务未启动？）
              </div>
            )}
            {data.length === 0 && !listError && (
              <EmptyState
                size="panel"
                icon={<FileIcon size={16} />}
                title="暂无文档"
                description="点击上方「导入」或「新建」开始"
              />
            )}

            {/* ── 树内名称过滤（与上方「搜索文档内容…」是两个不同能力）──
                实测：本库 419 篇文档 + 55 个根层文件夹，树内容高 14,702px /
                可视 534px ⇒ **需滚 27.5 屏**。上方搜索框走后端全文检索、
                只返前 50 条、并会切到独立结果视图；而「我知道它叫什么」这个
                场景需要的是**留在树里、按名称秒筛**。故补此输入框：
                  · 纯前端过滤，零网络请求；命中项的祖先目录自动保留 + 展开；
                  · 目录自身命中时保留整棵子树（搜目录名即看其全部内容）。
                条目少时不显示（避免给简单场景添乱）。 */}
            {data.length > 12 && (
              <div className="relative mx-1 mb-1.5">
                <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-faint">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                       stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="m21 21-4.35-4.35M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0z" />
                  </svg>
                </span>
                <input
                  value={treeFilter}
                  onChange={(e) => setTreeFilter(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.stopPropagation(); // 不要冒泡到全局 Esc（会退出全屏等）
                      setTreeFilter("");
                    }
                  }}
                  placeholder="在树中按名称筛选…"
                  aria-label="在文档树中按名称筛选"
                  data-testid="tree-filter"
                  className="input input-icon pr-8 text-[13px]"
                />
                {treeFilter && (
                  <button
                    onClick={() => setTreeFilter("")}
                    className="absolute right-1 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full text-faint transition-colors hover:bg-hover hover:text-text"
                    title="清除筛选"
                    aria-label="清除筛选"
                  >
                    <CloseIcon size={13} />
                  </button>
                )}
              </div>
            )}
            <FileTree
              data={data}
              filterQuery={treeFilter}
              activeKey={activeKey}
              onSelect={(key) => {
                onSelect(key);
                if (mobile) onCloseMobile?.();
              }}
              folders={folders}
              onNew={readOnly ? undefined : onNew}
              onRenameDoc={readOnly ? undefined : onRenameDoc}
              onRenameFolder={readOnly ? undefined : onRenameFolder}
              onDuplicateDoc={readOnly ? undefined : onDuplicateDoc}
              onPinDoc={readOnly ? undefined : onPinDoc}
              onPinFolder={readOnly ? undefined : onPinFolder}
              onExportDoc={readOnly ? undefined : onExportDoc}
              onDeleteDoc={readOnly ? undefined : onDeleteDoc}
              onDeleteFolder={readOnly ? undefined : onDeleteFolder}
              onMoveDoc={readOnly ? undefined : onMoveDoc}
              onMoveFolder={readOnly ? undefined : onMoveFolder}
              onMoveToKb={readOnly ? undefined : onMoveToKb}
              onImportToFolder={readOnly ? undefined : onImportToFolder}
              onDeleteSelected={readOnly ? undefined : onDeleteSelected}
              onMoveSelected={readOnly ? undefined : onMoveSelected}
              onEditTags={readOnly ? undefined : onEditTags}
              onGenerateSummary={readOnly ? undefined : onGenerateSummary}
              onTagSelect={onTagSelect ? (t) => setTagFilter(t) : undefined}
              batchedAll={batchedAll === null || batchedAll === undefined ? undefined : batchedAll}
              batchedAt={batchedAt}
            />
          </>
        )}
      </div>

      {onOpenTrash && (
        <div className="border-t border-line p-1.5">
          <button
            onClick={onOpenTrash}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[14px] text-muted transition-colors hover:bg-hover hover:text-text"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            </svg>
            回收站
          </button>
        </div>
      )}
      </div>
    </aside>
  );
}
