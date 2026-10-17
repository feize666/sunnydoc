"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { TitleBar } from "@/components/TitleBar";
import { Sidebar } from "@/components/Sidebar";
import { Editor } from "@/components/Editor";
import { AiPanel, type AgentUiAction } from "@/components/AiPanel";
import { StatusBar } from "@/components/StatusBar";
import { useToast } from "@/components/Toast";
import { CommandPalette, type Command } from "@/components/CommandPalette";
import { ShortcutPanel } from "@/components/ShortcutPanel";
import { ImportDialog } from "@/components/ImportDialog";
import { NewDocDialog } from "@/components/NewDocDialog";
import { NewFolderDialog } from "@/components/NewFolderDialog";
import { ExportDialog } from "@/components/ExportDialog";
import { NewKbDialog } from "@/components/NewKbDialog";
import { HomeView } from "@/components/HomeView";
import { LoginView } from "@/components/LoginView";
import { ProfileDialog } from "@/components/ProfileDialog";
import { UserManagementView } from "@/components/UserManagementView";
import { ShareDialog } from "@/components/ShareDialog";
import { ShareDocDialog } from "@/components/ShareDocDialog";
import { ShareView } from "@/components/ShareView";
import { FavoritesPopover } from "@/components/FavoritesPopover";
import { TrashView } from "@/components/TrashView";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { TagsDialog } from "@/components/TagsDialog";
import { VersionHistoryDialog } from "@/components/VersionHistoryDialog";
import { SettingsDialog } from "@/components/SettingsDialog";
import { PageHeader } from "@/components/PageShell";
import { useViewStack } from "@/hooks/useViewStack";
import { CommentPanel } from "@/components/CommentPanel";
import { NotificationPanel } from "@/components/NotificationPanel";
import { MoveToKbDialog } from "@/components/MoveToKbDialog";
import { TagManagerDialog } from "@/components/TagManagerDialog";
import {
  NODE_TYPES,
  NodeTypeIcon,
  type NodeType,
} from "@/components/NewNodeMenu";
import type { Doc, TreeNode, SortBy } from "@/data/docs";
import { countWords } from "@/lib/markdown";
import { buildTree } from "@/lib/buildTree";
import { parseTagQuery } from "@/lib/tagQuery";
import { ImportIcon, FolderIcon, RefreshIcon, SearchIcon, SunIcon, MoonIcon, SettingsIcon } from "@/components/icons";
import {
  listDocuments,
  listFolders,
  getDocument,
  deleteDocument,
  deleteFolder,
  batchDeleteDocuments,
  moveDocument,
  createDocument,
  createFolder,
  renameFolder,
  moveFolder,
  exportDocuments,
  duplicateDocument,
  renameDocument,
  listKbs,
  deleteKb,
  listRecent,
  recordRecent,
  getStats,
  getUnreadCount,
  subscribeSSE,
  searchDocuments,
  searchDocumentsFull,
  getMe,
  logout,
  getToken,
  setToken,
  addFavorite,
  removeFavorite,
  listFavorites,
  pinDocument,
  unpinDocument,
  pinFolder,
  unpinFolder,
  generateSummary,
  listBacklinks,
  lookupDocumentByTitle,
  listComments,
  type DocMeta,
  type Folder,
  type Kb,
  type RecentDoc,
  type SearchResult,
  type Citation,
  type User,
  type Stats,
  type Backlink,
  type DocComment,
  type CommentAnchor,
} from "@/lib/api";
import type { AnchorTarget } from "@/lib/commentAnchor";

function formatTime(ts: number): string {
  const d = new Date(ts * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const SESSION_KEY = "sunnydoc.currentKbId";
const SIDEBAR_KEY = "sunnydoc.sidebarCollapsed";
const SORT_KEY = "sunnydoc.sortBy";
const SORT_VALUES: SortBy[] = ["manual", "numeric", "name", "created", "updated"];
function loadSortBy(): SortBy {
  try {
    const v = localStorage.getItem(SORT_KEY);
    // 白名单校验：localStorage 可能残留旧版本或被手改的值
    return SORT_VALUES.includes(v as SortBy) ? (v as SortBy) : "numeric";
  } catch {
    return "numeric";
  }
}
function saveSortBy(s: SortBy) {
  try {
    localStorage.setItem(SORT_KEY, s);
  } catch {
    /* ignore */
  }
}
function loadSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === "1";
  } catch {
    return false;
  }
}
function saveSidebarCollapsed(collapsed: boolean) {
  try {
    localStorage.setItem(SIDEBAR_KEY, collapsed ? "1" : "0");
  } catch {
    /* ignore */
  }
}
function loadSessionKbId(): string | null {
  try {
    return sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}
function saveSessionKbId(id: string) {
  try {
    sessionStorage.setItem(SESSION_KEY, id);
  } catch {
    /* ignore */
  }
}
function clearSessionKbId() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export default function Home() {
  const toast = useToast();
  const [docs, setDocs] = useState<Record<string, Doc>>({});
  const [metas, setMetas] = useState<DocMeta[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [openKeys, setOpenKeys] = useState<string[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => loadSidebarCollapsed());
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importTarget, setImportTarget] = useState<{ folderId: string; folderName: string } | null>(null);
  const [dragFiles, setDragFiles] = useState<File[] | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [newDocOpen, setNewDocOpen] = useState(false);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [newKbOpen, setNewKbOpen] = useState(false);
  const [editingKb, setEditingKb] = useState<Kb | null>(null);
  const [loadingDoc, setLoadingDoc] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  // 全文搜索
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  /** 后端实际参与匹配的词（供高亮；与搜索结果为同一次请求的产物） */
  const [searchTerms, setSearchTerms] = useState<string[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchType, setSearchType] = useState<string>("");
  const [searchTag, setSearchTag] = useState<string>("");
  const [searchSort, setSearchSort] = useState<string>("relevance");
  const [highlight, setHighlight] = useState("");
  const [sortBy, setSortBy] = useState<SortBy>(() => loadSortBy());

  // 登录态
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // 视图路由 + 当前知识库
  // `view` 仍是渲染分支的依据（home/kb/users/trash/settings），
  // 但**层级由 hash 驱动**（阶段 3）：viewStack.path 变化时同步 view，
  // 从而支持 3~4 级深链与浏览器后退。见 hooks/useViewStack.ts。
  const [view, setView] = useState<"home" | "kb" | "users" | "trash" | "settings">("home");
  const viewStack = useViewStack();
  /** 层级信息：viewStack.path[0] 是顶层段（users/trash/settings），后续段是子级 id。 */
  const subPath = viewStack.path;
  const [profileOpen, setProfileOpen] = useState(false);
  const [shareKb, setShareKb] = useState<Kb | null>(null);
  const [shareDoc, setShareDoc] = useState<{ id: string; title: string } | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  /** 标签对话框的目标文档：从文件树菜单打开时是非当前文档，
   *  从编辑器顶栏打开时为 null（回退到 activeKey）。 */
  const [tagsDocId, setTagsDocId] = useState<string | null>(null);
  const [versionOpen, setVersionOpen] = useState(false);
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  // 文档树批量展开/折叠：null=未控制（用户自由态，每个节点按自身默认）；
  // true=全部展开；false=全部折叠。每次切换 +1 timestamp 让 FileTree useEffect 重跑。
  // 默认折叠所有节点（截图所示：所有节点都是「>」折叠状态，一行不展开）。
  // 注：此处不用 localStorage 持久化——「折叠/展开」是临时的视线状态，不该污染
  // 知识库的结构；切 KB / 切标签 / 拖动重排等都需要重置。
  const [batchedAll, setBatchedAll] = useState<boolean | null>(null);
  const [batchedAt, setBatchedAt] = useState(0);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [annotateQuote, setAnnotateQuote] = useState<string | null>(null);
  /** 划词批注的锚点（随引用文本一起产生，用于正文回定位） */
  const [annotateAnchor, setAnnotateAnchor] = useState<CommentAnchor | null>(null);
  /** 当前文档评论：正文锚点高亮的数据源（面板未打开也要有） */
  const [docComments, setDocComments] = useState<DocComment[]>([]);
  const [commentsVersion, setCommentsVersion] = useState(0);
  /** 正文中定位失败的评论 id —— 面板上降级显示「未锚定」 */
  const [orphanIds, setOrphanIds] = useState<string[]>([]);
  /** 需要闪烁定位的评论 id（点评论 → 定位正文，由 Editor 闪烁） */
  const [focusCommentId, setFocusCommentId] = useState<string | null>(null);
  /** 面板里需要高亮的评论 id（点正文标记 → 定位评论） */
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [moveToKbTarget, setMoveToKbTarget] = useState<{
    ids: string[];
    title: string;
  } | null>(null);
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  const [currentKbId, setCurrentKbId] = useState<string | null>(null);
  const [kbs, setKbs] = useState<Kb[]>([]);
  const [recent, setRecent] = useState<RecentDoc[]>([]);
  const [favorites, setFavorites] = useState<DocMeta[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [favIds, setFavIds] = useState<Set<string>>(new Set());
  const [kbsLoading, setKbsLoading] = useState(false);
  const [kbsError, setKbsError] = useState<string | null>(null);
  const restoredRef = useRef(false);
  const kbsFetchedRef = useRef(false);

  // 公开分享视图：检测 URL ?share=token（无需登录）
  //
  // ⚠️ 必须在**挂载后**读 URL，不能放在 useState 初始化函数里。
  // 静态导出时服务端渲染的这个页面没有查询串 → server 渲染出 `authLoading` 的骨架
  // （`page.tsx` 里的 `loading-row`）；而客户端首次渲染若立刻读到 `?share=`，
  // 就会直接渲染 `ShareView` → **两边 HTML 不一致 → React 水合失败**。
  // （该缺陷此前一直存在：React 会回退到客户端重渲染，所以肉眼看不出来，
  //   但每次打开分享页都会多一次完整重渲染，且控制台始终报 Hydration failed。）
  const [shareToken, setShareToken] = useState<string | null>(null);
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("share");
    if (t) setShareToken(t);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // 侧栏折叠状态持久化
  useEffect(() => {
    saveSidebarCollapsed(sidebarCollapsed);
  }, [sidebarCollapsed]);

  // 文件树排序偏好持久化（跨会话保留用户选择）
  useEffect(() => {
    saveSortBy(sortBy);
  }, [sortBy]);

  // 启动时校验登录态：有 token 则拉取当前用户，失败则清除
  useEffect(() => {
    (async () => {
      const token = getToken();
      if (!token) {
        setAuthLoading(false);
        return;
      }
      try {
        setUser(await getMe());
      } catch {
        setToken(null);
      } finally {
        setAuthLoading(false);
      }
    })();
  }, []);

  const handleAuthed = useCallback((u: User) => setUser(u), []);

  const handleLogout = useCallback(async () => {
    await logout();
    setToken(null);
    setUser(null);
    clearSessionKbId();
    setView("home");
    setCurrentKbId(null);
    setActiveKey(null);
    setOpenKeys([]);
  }, []);

  const handleOpenProfile = useCallback(() => setProfileOpen(true), []);

  /**
   * 把 hash 层级同步到 `view`（阶段 3：3~4 级可到达导航）。
   *
   * 顶层段 → view；后续段由各页面自己消费（如 settings/ai、users/u_123）。
   * 首页（空路径）也走这里，因此「后退到根」能正确回到 home。
   */
  useEffect(() => {
    const top = subPath[0];
    if (!top) {
      setView("home");
      setActiveKey(null);
      setOpenKeys([]);
      return;
    }
    if (top === "users" || top === "trash" || top === "settings") {
      setView(top);
      setActiveKey(null);
      setOpenKeys([]);
      return;
    }
    if (top === "kb") {
      setView("kb");
      return;
    }
    // 未知段（用户手改地址栏）→ 回首页，不让应用卡在空白状态
    setView("home");
  }, [subPath]);

  const handleOpenUsers = useCallback(() => {
    viewStack.go(["users"]);
  }, [viewStack]);

  const handleOpenTrash = useCallback(() => {
    viewStack.go(["trash"]);
  }, [viewStack]);

  const handleOpenSettings = useCallback(() => {
    viewStack.go(["settings"]);
  }, [viewStack]);

  // 侧栏切换：小屏开抽屉，大屏折叠
  const handleToggleSidebar = useCallback(() => {
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches) {
      setMobileSidebarOpen((v) => !v);
    } else {
      setSidebarCollapsed((v) => !v);
    }
  }, []);

  // 打开普通导入（导入到知识库根目录）
  const openImport = useCallback(() => {
    setImportTarget(null);
    setImportOpen(true);
  }, []);

  // 从目录右键「导入到此处」：导入到指定目录
  const handleImportToFolder = useCallback((folderId: string, folderName: string) => {
    setImportTarget({ folderId, folderName });
    setImportOpen(true);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && key === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      // 全局快捷键面板：⌘/ 或 ?（Shift+/）
      if ((mod && e.key === "/") || (!mod && e.key === "?")) {
        // 输入框聚焦时不抢占（如搜索框、编辑器）
        const el = e.target as HTMLElement | null;
        const tag = el?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable) return;
        e.preventDefault();
        setShortcutsOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 拉取知识库列表 + 最近浏览
  const refreshKbs = useCallback(async () => {
    try {
      setKbsError(null);
      setKbsLoading(true);
      setKbs(await listKbs());
    } catch (e) {
      setKbsError(e instanceof Error ? e.message : "加载知识库失败");
    } finally {
      setKbsLoading(false);
      kbsFetchedRef.current = true;
    }
  }, []);

  const refreshRecent = useCallback(async () => {
    try {
      setRecent(await listRecent(20));
    } catch {
      /* 最近浏览加载失败不影响首页 */
    }
  }, []);

  const refreshFavorites = useCallback(async () => {
    try {
      setFavorites(await listFavorites());
    } catch {
      /* 收藏加载失败不影响首页 */
    }
  }, []);

  const refreshStats = useCallback(async () => {
    try {
      setStats(await getStats());
    } catch {
      /* 统计加载失败不影响首页 */
    }
  }, []);

  const refreshUnread = useCallback(async () => {
    try {
      setUnreadCount(await getUnreadCount());
    } catch {
      /* 未读数加载失败不影响 */
    }
  }, []);

  // 登录后才加载首页数据（避免未登录时带旧 token 请求 401，导致错误残留）
  useEffect(() => {
    if (!user) return;
    refreshKbs();
    refreshRecent();
    refreshFavorites();
    refreshStats();
    refreshUnread();
  }, [user, refreshKbs, refreshRecent, refreshFavorites, refreshStats, refreshUnread]);

  // 实时推送：订阅通知事件，收到新通知时实时刷新未读数
  useEffect(() => {
    if (!user) return;
    const sub = subscribeSSE("/events/notifications", (event) => {
      if (event.type === "notification") refreshUnread();
    });
    return () => sub.close();
  }, [user, refreshUnread]);

  // 知识库加载完成后，尝试恢复上次打开的知识库
  useEffect(() => {
    if (restoredRef.current || !kbsFetchedRef.current) return;
    restoredRef.current = true;
    const saved = loadSessionKbId();
    if (saved && kbs.some((k) => k.id === saved)) {
      setCurrentKbId(saved);
      setView("kb");
    }
  }, [kbs]);

  // 拉取文档列表 + 文件夹列表（带 kb_id 过滤）
  const refreshList = useCallback(async () => {
    try {
      setListError(null);
      const [list, folderList] = await Promise.all([
        listDocuments(currentKbId),
        listFolders(currentKbId),
      ]);
      setMetas(list);
      setFolders(folderList);
      setFavIds(new Set(list.filter((d) => d.is_favorite).map((d) => d.id)));
    } catch (e) {
      setListError(e instanceof Error ? e.message : "加载文档列表失败");
    }
  }, [currentKbId]);

  useEffect(() => {
    if (view === "kb") refreshList();
  }, [view, refreshList]);

  // 全局拖拽文件导入：在知识库视图拖入文件时显示遮罩，释放后打开导入对话框。
  // 例外（两种）：
  //  1) 落在编辑器正文内的文件 —— 交给富文本编辑器自己处理（图片插图 / 其他文件作附件），
  //     拖到正文里却弹出「导入为文档」是反直觉的；用落点判断比 stopPropagation 更稳，
  //     也不会把遮罩的 depth 计数搞乱导致遮罩卡住。
  //  2) 纯图片拖放（落在编辑器外）—— 图片作为独立文档导入没有意义，直接忽略。
  useEffect(() => {
    const isFileDrag = (e: DragEvent) => {
      return Array.from(e.dataTransfer?.types ?? []).includes("Files");
    };
    const isOverEditor = (e: DragEvent) => {
      const t = e.target as HTMLElement | null;
      return !!t?.closest?.(".rich-editor");
    };
    const isImageOnlyDrag = (e: DragEvent) => {
      const items = Array.from(e.dataTransfer?.items ?? []);
      if (items.length === 0) return false;
      // 只有「所有条目都是图片」才算图片拖放；混合拖入仍走导入流程
      if (!items.every((it) => it.kind === "file")) return false;
      return items.every((it) => it.type.startsWith("image/"));
    };
    let depth = 0;
    const onDragEnter = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      if (view !== "kb") return;
      if (isOverEditor(e) || isImageOnlyDrag(e)) return;
      e.preventDefault();
      depth++;
      setDragOver(true);
    };
    const onDragOver = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      if (view !== "kb") return;
      if (isOverEditor(e) || isImageOnlyDrag(e)) return;
      e.preventDefault();
    };
    const onDragLeave = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragOver(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      if (view !== "kb") return;
      depth = 0;
      setDragOver(false);
      if (isOverEditor(e) || isImageOnlyDrag(e)) return; // 交给编辑器
      e.preventDefault();
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length > 0) {
        setDragFiles(files);
        openImport();
      }
    };
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [view]);

  // 打开文档：设置 active，若未加载全文则拉取，并记录最近浏览
  const openDoc = useCallback(
    async (key: string) => {
      setOpenKeys((prev) => (prev.includes(key) ? prev : [...prev, key]));
      setActiveKey(key);
      setHighlight("");
      if (!docs[key]) {
        setLoadingDoc(true);
        try {
          const detail = await getDocument(key);
          setDocs((prev) => ({
            ...prev,
            [key]: {
              key: detail.id,
              title: detail.title,
              path: detail.source,
              updated: formatTime(detail.created_at),
              body: detail.text,
              type: detail.type ?? "doc",
              // 打开文档即记下版本号，供后续保存做乐观锁基线
              revision: detail.revision ?? 0,
              // 供「插入卡片」选择器在本知识库内筛选候选文档
              kbId: detail.kb_id ?? null,
            },
          }));
          void recordRecent(detail.id);
          refreshRecent();
        } catch {
          // 加载失败，保持空
        } finally {
          setLoadingDoc(false);
        }
      } else {
        void recordRecent(key);
        refreshRecent();
      }
    },
    [docs, refreshRecent],
  );

  const closeDoc = useCallback(
    (key: string) => {
      setOpenKeys((prev) => {
        const next = prev.filter((k) => k !== key);
        if (key === activeKey && next.length > 0) {
          setActiveKey(next[next.length - 1]);
        } else if (next.length === 0) {
          setActiveKey(null);
        }
        return next;
      });
    },
    [activeKey],
  );

  /**
   * 正文里的「文档卡片」点击跳转到来源文档。
   *
   * 为什么走自定义事件而不是把 openDoc 层层透传：卡片渲染在 TipTap 的
   * NodeView 里，该组件由 ProseMirror 管理、实例生命周期不受 React 树控制；
   * 透传回调要穿过 RichEditor → Node 扩展 → NodeView 三层，任一层重渲染
   * 都可能丢引用。事件桥接解耦干净，也不会因编辑器重挂载而失效。
   *
   * 必须放在 openDoc 声明之后 —— 放在前面会触发 TS2448
   * （Block-scoped variable used before its declaration）。
   */
  useEffect(() => {
    const onOpen = (e: Event) => {
      const id = (e as CustomEvent<{ id?: string }>).detail?.id;
      if (!id) return;
      // 必须清空搜索态再打开：
      // `openDoc` 本身不动 searchQuery（这是有意的 —— 从搜索结果点开文档时要
      // 保留关键词并高亮命中，见 handleOpenSearchResult）。但卡片跳转是
      // 「跳去另一篇」，若不清空，侧栏仍显示搜索结果、正文区不切到文档，
      // 用户看到的就是「点了没反应」。实测确认过：事件派发了、标签页也开了，
      // 但界面停在搜索结果页。
      setSearchQuery("");
      setSearchType("");
      setSearchTag("");
      setHighlight("");
      void openDoc(id);
    };
    window.addEventListener("sunnydoc:open-doc", onOpen);
    return () => window.removeEventListener("sunnydoc:open-doc", onOpen);
  }, [openDoc]);

  /**
   * 搜索框输入：消费 `tag:xxx` 语法（见 lib/tagQuery.ts）。
   *
   * 只在「token 后跟空白」（用户已打完标签名、刚敲了空格）时提取——
   * 边打边清会把正在输入的内容吃掉（敲到 "tag:f" 框就空了，再也打不出 "foo"）。
   * 没打完时 token 留在框里，由搜索 effect 与侧栏 activeTag 兜底。
   */
  const handleSearchInput = useCallback((q: string) => {
    const { q: bare, tag } = parseTagQuery(q);
    if (tag && /\s$/.test(q)) {
      setSearchTag(tag);
      setSearchQuery(bare);
    } else {
      setSearchQuery(q);
    }
  }, []);

  // 全文搜索（防抖 300ms，支持类型/标签过滤 + 排序）
  //
  // `tag:xxx` 语法在此落地：剥离标签 token 后用剩下的词检索。
  // 两段式同步（先 setSearchTag、effect 因依赖变化重跑再搜）不会循环：
  // 第二跑时 tagFromQuery === searchTag，不再 set。
  useEffect(() => {
    const { q, tag: tagFromQuery } = parseTagQuery(searchQuery);
    if (tagFromQuery && tagFromQuery !== searchTag) {
      setSearchTag(tagFromQuery);
      return;
    }
    if (!q) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const { results, terms } = await searchDocumentsFull(
          q,
          currentKbId,
          searchType || null,
          searchTag || null,
          searchSort,
        );
        setSearchResults(results);
        // 高亮词用后端实际匹配的词（中文分词后「虚拟机怎么开机」命中的是
        // 「虚拟机」「开机」，文档里根本没有整串），否则会「有结果但零高亮」
        setSearchTerms(terms);
      } catch {
        setSearchResults([]);
        setSearchTerms([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, currentKbId, searchType, searchTag, searchSort]);

  // 点击搜索结果：打开文档并高亮关键词
  // 高亮串优先用「后端实际匹配的词」（空格拼接，渲染层本就支持多关键词），
  // 后端未返回时回退到原始查询串（保持对旧后端的兼容）。
  const handleOpenSearchResult = useCallback(
    (docId: string) => {
      openDoc(docId);
      setHighlight(searchTerms.length > 0 ? searchTerms.join(" ") : searchQuery.trim());
    },
    [openDoc, searchQuery, searchTerms],
  );

  // 点击 AI 引用：打开对应文档并高亮片段。
  // 定位词优先用后端下发的 `citation.terms`（已清洗、内部无空白的连续词，
  // 必然能在正文里搜到）；缺失时（旧后端）才回退到「snippet 前 20 字」——
  // 那条路实测只有 50% 命中（snippet 是裸分片，含换行/表格对齐空格）。
  const handleOpenCitation = useCallback(
    (docId: string, citation: Citation) => {
      openDoc(docId);
      const kw =
        citation.terms?.trim() ||
        citation.snippet.replace(/\s+/g, " ").trim().slice(0, 20);
      setHighlight(kw);
      setAiOpen(false);
    },
    [openDoc],
  );

  // 智能体要求界面动作（阶段 4）：复用现有的 openDoc 与导航栈。
  // 这是「基于对话操作整个系统」的界面侧 —— 模型说「打开那篇文档」，
  // 落到用户眼前就是文档真的打开了（而不是只在回答里贴一个 id）。
  const handleAgentUi = useCallback(
    (a: AgentUiAction) => {
      if (a.kind === "open_document") {
        openDoc(a.docId);
        setAiOpen(false);
      } else if (a.kind === "goto_view") {
        viewStack.go([a.view]);
        setAiOpen(false);
      }
    },
    [openDoc, viewStack],
  );

  // 保存文档：更新本地缓存并刷新列表（让预览与侧栏立即反映新标题/内容）
  const handleSaved = useCallback(
    (doc: Doc, newTitle: string, newBody: string) => {
      setDocs((prev) => {
        const existing = prev[doc.key];
        if (!existing) return prev;
        return {
          ...prev,
          [doc.key]: {
            ...existing,
            title: newTitle,
            body: newBody,
            updated: formatTime(Date.now() / 1000),
            // 乐观锁基线必须跟着服务端走：Editor 保存成功后把新版本号放在 doc 上传来，
            // 这里漏掉的话基线永远停在旧值 → 第二次自动保存立刻误判为冲突。
            revision: doc.revision ?? existing.revision,
          },
        };
      });
      refreshList();
    },
    [refreshList],
  );

  // 多人协作：他人保存后重拉文档内容（供 Editor 收到 doc_updated 事件时调用）
  const refreshDoc = useCallback(async (docId: string) => {
    try {
      const detail = await getDocument(docId);
      setDocs((prev) => {
        const existing = prev[docId];
        if (!existing) return prev;
        return {
          ...prev,
          [docId]: {
            ...existing,
            title: detail.title,
            body: detail.text,
            type: detail.type ?? "doc",
            updated: formatTime(detail.created_at),
            // 必须同步新版号：这是「采用对方」之后的新基线，
            // 不同步的话下次保存仍带旧值 → 立刻又 409。
            revision: detail.revision ?? existing.revision,
          },
        };
      });
    } catch {
      /* 拉取失败静默忽略 */
    }
  }, []);

  /**
   * 卡片就地编辑保存后，刷新对应的来源文档。
   *
   * 为什么必须做：来源文档可能正开在另一个标签页里。用户刚在卡片里改完，
   * 切过去却看到旧内容 —— 更糟的是接着编辑保存会把刚存的内容覆盖掉。
   * 复用协作场景的 `refreshDoc`（它已同步 revision 基线，避免下次保存 409）。
   *
   * ⚠️ 必须放在 `refreshDoc` 声明之后：放在前面会触发 TS2448
   * （Block-scoped variable used before its declaration）—— 实测踩过。
   */
  useEffect(() => {
    const onSaved = (e: Event) => {
      const id = (e as CustomEvent<{ id?: string }>).detail?.id;
      if (id) void refreshDoc(id);
    };
    window.addEventListener("sunnydoc:doc-saved", onSaved);
    return () => window.removeEventListener("sunnydoc:doc-saved", onSaved);
  }, [refreshDoc]);

  // 删除文档
  const handleDelete = useCallback(
    async (key: string) => {
      try {
        await deleteDocument(key);
        setDocs((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        closeDoc(key);
        refreshList();
        refreshRecent();
        toast.success("文档已删除");
      } catch (e) {
        toast.error(`删除失败：${e instanceof Error ? e.message : "未知错误"}`);
      }
    },
    [closeDoc, refreshList, refreshRecent, toast],
  );

  // 删除文件夹
  const handleDeleteFolder = useCallback(
    async (id: string) => {
      try {
        await deleteFolder(id);
        refreshList();
      } catch (e) {
        toast.error(`删除文件夹失败：${e instanceof Error ? e.message : "未知错误"}`);
      }
    },
    [refreshList],
  );

  // 批量删除（多选）：走一次请求，后端逐个校验权限并跳过无权限项
  const handleDeleteSelected = useCallback(
    async (docIds: string[], folderIds: string[]): Promise<number> => {
      try {
        const res = await batchDeleteDocuments({ doc_ids: docIds, folder_ids: folderIds });
        // 关掉已被删除文档的编辑器，避免停留在已删内容上
        await Promise.all(docIds.map((id) => closeDoc(id)));
        setDocs((prev) => {
          const next = { ...prev };
          for (const id of docIds) delete next[id];
          return next;
        });
        refreshList();
        refreshRecent();

        if (res.skipped.length > 0) {
          toast.error(`已删除 ${res.count} 项，${res.skipped.length} 项被跳过（无权限或不存在）`);
        } else {
          toast.success(`已删除 ${res.count} 项`);
        }
        return res.count;
      } catch (e) {
        toast.error(`批量删除失败：${e instanceof Error ? e.message : "未知错误"}`);
        return 0;
      }
    },
    [closeDoc, refreshList, refreshRecent, toast],
  );

  // 移动文档到文件夹
  const handleMoveDoc = useCallback(
    async (docId: string, folderId: string | null, sortOrder?: number | null) => {
      try {
        await moveDocument(docId, folderId, sortOrder ?? undefined);
        setSortBy("manual");
        refreshList();
      } catch (e) {
        toast.error(`移动文档失败：${e instanceof Error ? e.message : "未知错误"}`);
      }
    },
    [refreshList],
  );

  // 移动文件夹
  const handleMoveFolder = useCallback(
    async (folderId: string, parentId: string | null, sortOrder?: number | null) => {
      try {
        await moveFolder(folderId, parentId, sortOrder ?? undefined);
        setSortBy("manual");
        refreshList();
      } catch (e) {
        toast.error(`移动文件夹失败：${e instanceof Error ? e.message : "未知错误"}`);
      }
    },
    [refreshList],
  );

  // 语雀式「+」快速新建（默认标题）
  const handleNew = useCallback(
    async (type: NodeType, parentFolderId: string | null) => {
      try {
        // 新建后必须让用户「看得见结果」：命令面板（⌘K）可在首页直接触发新建，
        // 而首页没有文档树 —— 只建不切视图的话，用户点了「新建流程图」却
        // 停留在首页，会以为没成功（D4 发现性问题的延续）。
        // 这里在打开文档前先切到知识库视图。
        const openInKb = (docId: string) => {
          setView("kb");
          refreshList();
          openDoc(docId);
        };
        if (type === "folder") {
          await createFolder("未命名文件夹", parentFolderId, currentKbId);
          refreshList();
        } else if (type === "table") {
          const doc = await createDocument(
            "未命名表格",
            JSON.stringify([["", "", ""], ["", "", ""], ["", "", ""]]),
            currentKbId,
            parentFolderId,
            "table",
          );
          openInKb(doc.id);
        } else if (type === "board") {
          const doc = await createDocument(
            "未命名画板",
            JSON.stringify([]),
            currentKbId,
            parentFolderId,
            "board",
          );
          openInKb(doc.id);
        } else if (type === "datasheet") {
          const doc = await createDocument(
            "未命名数据表",
            JSON.stringify({ columns: ["字段 1", "字段 2"], rows: [["", ""], ["", ""]] }),
            currentKbId,
            parentFolderId,
            "datasheet",
          );
          openInKb(doc.id);
        } else if (type === "mindmap") {
          const doc = await createDocument(
            "未命名思维导图",
            JSON.stringify({ nodes: [{ id: "1", text: "中心主题", parent: null }] }),
            currentKbId,
            parentFolderId,
            "mindmap",
          );
          openInKb(doc.id);
        } else if (type === "flowchart") {
          const doc = await createDocument(
            "未命名流程图",
            JSON.stringify({ nodes: [], edges: [] }),
            currentKbId,
            parentFolderId,
            "flowchart",
          );
          openInKb(doc.id);
        } else {
          const doc = await createDocument("未命名文档", "", currentKbId, parentFolderId);
          openInKb(doc.id);
        }
      } catch (e) {
        toast.error(`新建失败：${e instanceof Error ? e.message : "未知错误"}`);
      }
    },
    [currentKbId, refreshList, openDoc],
  );

  // 重命名文档
  const handleRenameDoc = useCallback(
    async (docId: string, name: string) => {
      try {
        await renameDocument(docId, name);
        refreshList();
      } catch (e) {
        toast.error(`重命名失败：${e instanceof Error ? e.message : "未知错误"}`);
      }
    },
    [refreshList],
  );

  // 重命名文件夹
  const handleRenameFolder = useCallback(
    async (folderId: string, name: string) => {
      try {
        await renameFolder(folderId, name);
        refreshList();
      } catch (e) {
        toast.error(`重命名失败：${e instanceof Error ? e.message : "未知错误"}`);
      }
    },
    [refreshList],
  );

  // 复制文档
  const handleDuplicateDoc = useCallback(
    async (docId: string) => {
      try {
        await duplicateDocument(docId);
        refreshList();
        toast.success("已复制文档");
      } catch (e) {
        toast.error(`复制失败：${e instanceof Error ? e.message : "未知错误"}`);
      }
    },
    [refreshList, toast],
  );

  // 导出单文档（markdown）
  const handleExportDoc = useCallback(async (docId: string) => {
    try {
      const { filename, blob } = await exportDocuments("md", [docId]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(`导出失败：${e instanceof Error ? e.message : "未知错误"}`);
    }
  }, []);

  // 进入知识库
  const enterKb = useCallback(
    (id: string) => {
      saveSessionKbId(id);
      setCurrentKbId(id);
      setView("kb");
      setActiveKey(null);
      setOpenKeys([]);
      // 刷新知识库列表：`kbs` state 原来只在登录时加载一次，
      // 导致用户在会话中**新建的知识库不会出现在「移动到知识库」对话框**里
      // （对话框的 targets 来自这个 state）—— 只能刷新整页才能看到，属真实缺陷。
      // 进 KB 是低频动作，顺手刷一次的代价可忽略。
      refreshKbs();
    },
    [refreshKbs],
  );

  // 返回首页
  const goHome = useCallback(() => {
    clearSessionKbId();
    setView("home");
    setActiveKey(null);
    setOpenKeys([]);
    refreshKbs();
    refreshRecent();
    refreshFavorites();
    refreshStats();
  }, [refreshKbs, refreshRecent, refreshFavorites, refreshStats]);

  /**
   * 文档树「全部展开 / 全部折叠」。
   *
   * 三态循环：null（未控制，默认折叠）→ true（全部展开）→ false（全部折叠）→ …
   * 但按钮语义更简单：**点一下就在「展开」与「折叠」间切换**。
   * batchedAt 每次都 +1，因为 true→false 时 batchedAll 变化已足够触发 effect，
   * 但 false→true 再 false 时 React 会做浅比较；用 timestamp 保证每次都真正应用。
   */
  const handleToggleBatchedAll = useCallback(() => {
    setBatchedAll((v) => (v === true ? false : true));
    setBatchedAt((t) => t + 1);
  }, []);

  // 切换知识库 / 回到首页时重置批量态 —— 避免上一个 KB 的展开偏好「串味」到下一个。
  useEffect(() => {
    setBatchedAll(null);
    setBatchedAt((t) => t + 1);
  }, [currentKbId]);

  // 从最近浏览打开文档
  const openRecent = useCallback(
    (docId: string, kbId: string | null) => {
      if (kbId) saveSessionKbId(kbId);
      else clearSessionKbId();
      setCurrentKbId(kbId);
      setView("kb");
      setActiveKey(null);
      setOpenKeys([]);
      openDoc(docId);
    },
    [openDoc],
  );

  // 双向链接跳转：按标题精确查找文档并打开
  const handleOpenWikilink = useCallback(
    async (title: string) => {
      const hit = await lookupDocumentByTitle(title);
      if (hit) {
        openRecent(hit.id, hit.kb_id ?? null);
      } else {
        toast.error(`未找到文档「${title}」，请确认标题是否正确`);
      }
    },
    [openRecent],
  );

  // 加载反向链接（当前文档切换时）
  useEffect(() => {
    if (!activeKey) {
      setBacklinks([]);
      return;
    }
    let cancelled = false;
    listBacklinks(activeKey)
      .then((b) => {
        if (!cancelled) setBacklinks(b);
      })
      .catch(() => {
        if (!cancelled) setBacklinks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [activeKey]);

  /**
   * 加载当前文档的评论 —— 正文锚点高亮的数据源。
   *
   * 为什么不由 CommentPanel 提供：面板只在打开时才加载，而批注高亮应该
   * 「打开文档就看得见」，否则用户根本不知道哪段被批注过。
   */
  useEffect(() => {
    if (!activeKey) {
      setDocComments([]);
      return;
    }
    let cancelled = false;
    listComments(activeKey)
      .then((cs) => {
        if (!cancelled) setDocComments(cs);
      })
      .catch(() => {
        if (!cancelled) setDocComments([]);
      });
    return () => {
      cancelled = true;
    };
  }, [activeKey, commentsVersion]);

  // 编辑知识库
  const handleEditKb = useCallback((kb: Kb) => {
    setEditingKb(kb);
    setNewKbOpen(true);
  }, []);

  // 删除知识库
  const handleDeleteKb = useCallback(
    async (id: string) => {
      try {
        await deleteKb(id);
        if (currentKbId === id) {
          clearSessionKbId();
          setCurrentKbId(null);
          setView("home");
          setActiveKey(null);
          setOpenKeys([]);
        }
        refreshKbs();
        refreshRecent();
        toast.success("知识库已删除");
      } catch (e) {
        toast.error(`删除知识库失败：${e instanceof Error ? e.message : "未知错误"}`);
      }
    },
    [currentKbId, refreshKbs, refreshRecent, toast],
  );

  // 切换收藏
  const handleToggleFavorite = useCallback(
    async (docId: string) => {
      const isFav = favIds.has(docId);
      // 乐观更新
      setFavIds((prev) => {
        const next = new Set(prev);
        if (isFav) next.delete(docId);
        else next.add(docId);
        return next;
      });
      try {
        if (isFav) await removeFavorite(docId);
        else await addFavorite(docId);
        refreshFavorites();
      } catch (e) {
        toast.error(`收藏操作失败：${e instanceof Error ? e.message : "未知错误"}`);
        // 失败回滚
        setFavIds((prev) => {
          const next = new Set(prev);
          if (isFav) next.add(docId);
          else next.delete(docId);
          return next;
        });
      }
    },
    [favIds, refreshFavorites],
  );

  // 打开文档分享
  const handleShareDoc = useCallback((docId: string, title: string) => {
    setShareDoc({ id: docId, title });
  }, []);

  // 置顶/取消置顶
  // 约定：第二个参数是「目标状态」而非「当前状态」—— 调用方直接给出希望变成的样子。
  // （历史写法把它当「当前状态」再取反，但 FileTree 传的是 !node.pinned，
  //   两边约定相反，导致文件树里的置顶菜单实际从未生效；因置顶数为 0 而长期未被发现。）
  const handleTogglePin = useCallback(
    async (docId: string, nextPinned: boolean) => {
      try {
        if (nextPinned) await pinDocument(docId);
        else await unpinDocument(docId);
        refreshList();
      } catch (e) {
        toast.error(`置顶操作失败：${e instanceof Error ? e.message : "未知错误"}`);
      }
    },
    [refreshList],
  );

  // 置顶/取消置顶文件夹（与文档置顶能力对齐，约定同上）
  const handleTogglePinFolder = useCallback(
    async (folderId: string, nextPinned: boolean) => {
      try {
        if (nextPinned) await pinFolder(folderId);
        else await unpinFolder(folderId);
        refreshList();
      } catch (e) {
        toast.error(`文件夹置顶失败：${e instanceof Error ? e.message : "未知错误"}`);
      }
    },
    [refreshList],
  );

  // 生成 AI 摘要
  const handleGenerateSummary = useCallback(
    async (docId: string) => {
      try {
        await generateSummary(docId);
        refreshList();
      } catch (e) {
        toast.error(`生成摘要失败：${e instanceof Error ? e.message : "未知错误"}`);
      }
    },
    [refreshList],
  );

  // 从收藏打开文档
  const openFavorite = useCallback(
    (doc: DocMeta) => {
      openRecent(doc.id, doc.kb_id ?? null);
    },
    [openRecent],
  );

  // 构建多级文件树
  const tree: TreeNode[] = buildTree(metas, folders, sortBy);

  // 标签浏览数据：从已加载的 metas 现算，不新增任何请求。
  // （后端 GET /tags 只被标签对话框的自动补全用；侧栏要的是「标签 + 计数」，
  //   现算比多一次请求更稳，也不会与 metas 出现时间差。）
  const tagList = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of metas) {
      for (const t of m.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [metas]);

  // 当前选中标签下的文档（侧栏「标签浏览视图」用；空标签 = 空列表）
  const tagDocs = useMemo(
    () => (searchTag ? metas.filter((m) => (m.tags ?? []).includes(searchTag)) : []),
    [metas, searchTag],
  );

  /**
   * 需要在正文里打标的批注。
   *
   * 必须 useMemo：Editor 的重放 effect 把它列入依赖，若每次渲染都产生新数组，
   * effect 会被反复触发（配合 MutationObserver 就是持续重排 DOM）。
   */
  const commentAnchors = useMemo<AnchorTarget[]>(
    () =>
      docComments
        .filter((c) => c.quote && c.anchor)
        .map((c) => ({
          commentId: c.id,
          quote: c.quote ?? "",
          anchor: c.anchor ?? null,
        })),
    [docComments],
  );

  const activeDoc = activeKey ? docs[activeKey] ?? null : null;
  const wordCount = activeDoc ? countWords(activeDoc.body) : 0;
  const currentKb = kbs.find((k) => k.id === currentKbId) ?? null;
  const readOnly = currentKb?.permission === "read";
  const activeMeta = activeKey ? metas.find((m) => m.id === activeKey) ?? null : null;

  // 命令面板全文搜索
  const paletteSearch = useCallback(
    async (q: string) => {
      try {
        return await searchDocuments(q, currentKbId);
      } catch {
        return [];
      }
    },
    [currentKbId],
  );

  const commands: Command[] = [
    {
      icon: <ImportIcon size={15} />,
      label: "导入文档",
      hint: "Ctrl+I",
      action: openImport,
    },
    // ---- 新建各类节点（D4 修复：非文档类型发现性差） ----
    // 原来只有「进知识库 → 点 ⨁ 新建」一条极深路径，导致 5 个非文档编辑器
    // （流程图/思维导图/表格/数据表/画板）写了 3000+ 行、生产数据 0 条。
    // 命令面板（⌘K）是既有高频入口，这里补上「新建 X」直达通道。
    // 类型清单取自 NODE_TYPES —— 与 ⨁ 菜单**同源**，避免两处文案不一致（D3 教训）。
    // 排除 folder：目录走下方独立的「新建文件夹」项（可先命名）。
    ...NODE_TYPES.filter((t) => t.available && t.type !== "folder").map((t) => ({
      icon: <NodeTypeIcon d={t.icon} color={t.color} size={15} />,
      // hint 位是 font-mono 的快捷键位（如 ⌘K），中文 desc 放那里会被当成快捷键，
      // 因此 desc 并入 label；两段之间用「·」分隔，与 ⨁ 菜单的 desc 措辞同源。
      label: `新建${t.label} · ${t.desc}`,
      action: () => handleNew(t.type, null),
    })),
    {
      // 「目录」单独列出：走对话框可**先命名**，这是侧栏「新建文件夹」的既有行为，
      // 不能退化成「先建个『未命名文件夹』再让用户改名」。
      icon: <FolderIcon size={15} />,
      label: "新建文件夹",
      hint: "",
      action: () => setNewFolderOpen(true),
    },
    {
      icon: <RefreshIcon size={15} />,
      label: "刷新文档列表",
      hint: "",
      action: () => refreshList(),
    },
    { icon: <SearchIcon size={15} />, label: "全文搜索", hint: "Ctrl+F" },
    {
      icon: theme === "light" ? <MoonIcon size={15} /> : <SunIcon size={15} />,
      label: "切换主题",
      hint: "Ctrl+Shift+T",
      action: () => setTheme((t) => (t === "light" ? "dark" : "light")),
    },
    { icon: <SettingsIcon size={15} />, label: "系统设置", hint: "Ctrl+," },
  ];

  // 公开分享视图（优先，无需登录）
  if (shareToken) {
    return <ShareView token={shareToken} />;
  }

  // 登录态守卫：校验中 / 未登录
  if (authLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-background text-muted">
        <div className="loading-row">
          <span className="spinner" />
          加载中…
        </div>
      </div>
    );
  }
  if (!user) {
    return <LoginView onAuthed={handleAuthed} />;
  }

  // Sidebar 共享 props（桌面版与移动抽屉复用）
  const sidebarProps = {
    data: tree,
    activeKey,
    onSelect: openDoc,
    folders,
    onImport: openImport,
    onImportToFolder: handleImportToFolder,
    onExport: () => setExportOpen(true),
    onRefresh: refreshList,
    onDeleteDoc: handleDelete,
    onDeleteFolder: handleDeleteFolder,
    onDeleteSelected: handleDeleteSelected,
    onRenameFolder: handleRenameFolder,
    onMoveDoc: handleMoveDoc,
    onMoveFolder: handleMoveFolder,
    onMoveToKb: (docId: string) => {
      const meta = metas.find((m) => m.id === docId);
      setMoveToKbTarget({ ids: [docId], title: meta?.title ?? docId });
    },
    onNew: handleNew,
    onRenameDoc: handleRenameDoc,
    onDuplicateDoc: handleDuplicateDoc,
    onPinDoc: handleTogglePin,
    onPinFolder: handleTogglePinFolder,
    onExportDoc: handleExportDoc,
    listError,
    kbName: currentKb?.name,
    searchQuery,
    onSearchChange: handleSearchInput,
    searchType,
    onSearchTypeChange: setSearchType,
    searchTag,
    onSearchTagChange: setSearchTag,
    tagList,
    tagDocs,
    onEditTags: (docId: string) => {
      setTagsDocId(docId);
      setTagsOpen(true);
    },
    onGenerateSummary: handleGenerateSummary,
    onTagSelect: setSearchTag,
    searchSort,
    onSearchSortChange: setSearchSort,
    searchResults,
    searchTerms,
    searching,
    onOpenSearchResult: handleOpenSearchResult,
    sortBy,
    onSortChange: setSortBy,
    readOnly,
    onOpenTrash: handleOpenTrash,
    // 文档树批量展开/折叠（用户要求：默认折叠，支持一键展开/折叠）
    batchedAll,
    batchedAt,
    onToggleBatchedAll: handleToggleBatchedAll,
    // 批量移动：多选工具条「移动」→ 打开既有的 MoveToKbDialog（传多 id）
    onMoveSelected: (docIds: string[]) => {
      setMoveToKbTarget({ ids: docIds, title: "" });
    },
    // 标签管理（重命名 / 合并 / 删除）
    onManageTags: () => setTagManagerOpen(true),
  };

  return (
    <div className="flex h-full flex-col bg-background">
      <div key={view} className="anim-fade-in flex min-h-0 flex-1 flex-col">
        <ErrorBoundary key={`view-${view}`} title="页面加载失败">
        {view === "kb" ? (
        <>
          <TitleBar
            openDocs={openKeys
              .map((k) => ({ key: k, title: docs[k]?.title ?? k }))
              .filter((d) => d.title)}
            activeKey={activeKey}
            onSelect={openDoc}
            onClose={closeDoc}
            onToggleSidebar={handleToggleSidebar}
            onOpenPalette={() => setPaletteOpen(true)}
            theme={theme}
            onToggleTheme={() =>
              setTheme((t) => (t === "light" ? "dark" : "light"))
            }
            onBackHome={goHome}
            onToggleAi={() => setAiOpen((v) => !v)}
            aiOpen={aiOpen}
            onOpenFavorites={() => setFavoritesOpen(true)}
            onOpenNotifications={() => setNotificationsOpen((v) => !v)}
            unreadCount={unreadCount}
            user={user}
            onOpenProfile={handleOpenProfile}
            onOpenUsers={handleOpenUsers}
            onOpenSettings={handleOpenSettings}
            onLogout={handleLogout}
          />

          <div className="flex min-h-0 flex-1">
            <Sidebar
              {...sidebarProps}
              collapsed={sidebarCollapsed}
              onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
            />
            <Editor
              doc={activeDoc}
              loading={loadingDoc}
              onSaved={handleSaved}
              highlight={highlight}
              theme={theme}
              readOnly={readOnly}
              isFavorite={activeKey ? favIds.has(activeKey) : false}
              onToggleFavorite={
                activeKey ? () => handleToggleFavorite(activeKey) : undefined
              }
              onShare={
                activeDoc
                  ? () => handleShareDoc(activeDoc.key, activeDoc.title)
                  : undefined
              }
              recent={recent}
              onOpenRecent={openRecent}
              pinned={activeMeta?.pinned ?? false}
              tags={activeMeta?.tags ?? []}
              summary={activeMeta?.summary ?? null}
              onTogglePin={
                activeKey && !readOnly
                  ? () => handleTogglePin(activeKey, !(activeMeta?.pinned ?? false))
                  : undefined
              }
              onEditTags={
                activeKey && !readOnly ? () => setTagsOpen(true) : undefined
              }
              onGenerateSummary={
                activeKey && !readOnly
                  ? () => handleGenerateSummary(activeKey)
                  : undefined
              }
              onOpenHistory={
                activeKey ? () => setVersionOpen(true) : undefined
              }
              onOpenComments={
                activeKey ? () => setCommentsOpen(true) : undefined
              }
              onAnnotate={
                activeKey
                  ? (payload) => {
                      setAnnotateQuote(payload.quote);
                      setAnnotateAnchor({
                        prefix: payload.prefix,
                        suffix: payload.suffix,
                        index: payload.index,
                      });
                      setCommentsOpen(true);
                    }
                  : undefined
              }
              commentAnchors={commentAnchors}
              // 点正文标记 → 打开面板并高亮那一条评论（方向：正文 → 评论）
              onAnchorClick={(id) => {
                setCommentsOpen(true);
                setActiveCommentId(id);
              }}
              onOrphansChange={setOrphanIds}
              focusAnchorId={focusCommentId}
              onAnchorFocused={() => setFocusCommentId(null)}
              onOpenWikilink={handleOpenWikilink}
              backlinks={activeKey ? backlinks : []}
              currentUserId={user?.id}
              isAdmin={user?.role === "admin"}
              onRemoteUpdate={
                activeKey ? () => refreshDoc(activeKey) : undefined
              }
            />
          </div>

          {/* 移动端侧栏抽屉 */}
          {mobileSidebarOpen && (
            <>
              <div
                className="fixed inset-0 z-30 bg-black/30 md:hidden"
                onClick={() => setMobileSidebarOpen(false)}
              />
              <Sidebar
                {...sidebarProps}
                onSelect={(key) => {
                  openDoc(key);
                  setMobileSidebarOpen(false);
                }}
                collapsed={false}
                onToggleCollapse={() => setMobileSidebarOpen(false)}
                mobile
                onCloseMobile={() => setMobileSidebarOpen(false)}
              />
            </>
          )}

          <StatusBar
            wordCount={wordCount}
            openCount={openKeys.length}
          />
        </>
      ) : view === "users" ? (
        <UserManagementView
          currentUserId={user.id}
          onBack={() => viewStack.back()}
          // L3：`#/users/<id>` → 用户详情页
          detailUserId={subPath[1] ?? null}
          onOpenUser={(uid) => viewStack.push(uid)}
          onCloseDetail={() => viewStack.back()}
          onBackToList={() => viewStack.upTo(1)}
        />
      ) : view === "trash" ? (
        <TrashView onBack={() => viewStack.back()} />
      ) : (
        <HomeView
          kbs={kbs}
          recent={recent}
          loadingKbs={kbsLoading}
          error={kbsError}
          theme={theme}
          onToggleTheme={() =>
            setTheme((t) => (t === "light" ? "dark" : "light"))
          }
          onOpenPalette={() => setPaletteOpen(true)}
          onOpenKb={enterKb}
          onCreateKb={() => setNewKbOpen(true)}
          onEditKb={handleEditKb}
          onDeleteKb={handleDeleteKb}
          onShareKb={(kb) => setShareKb(kb)}
          onOpenRecent={openRecent}
          favorites={favorites}
          onOpenFavorite={openFavorite}
          stats={stats}
          user={user}
          onOpenProfile={handleOpenProfile}
          onOpenUsers={handleOpenUsers}
          onLogout={handleLogout}
          onOpenSettings={handleOpenSettings}
        />
        )}
        </ErrorBoundary>
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        commands={commands}
        onSearch={paletteSearch}
        onOpenResult={(docId) => {
          setPaletteOpen(false);
          openDoc(docId);
        }}
      />

      <ShortcutPanel open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      <ImportDialog
        open={importOpen}
        onClose={() => {
          setImportOpen(false);
          setDragFiles(null);
          setImportTarget(null);
        }}
        onImported={() => {
          refreshList();
        }}
        kbId={currentKbId}
        folderId={importTarget?.folderId ?? null}
        folderName={importTarget?.folderName ?? null}
        autoFiles={dragFiles}
      />

      <NewDocDialog
        open={newDocOpen}
        onClose={() => setNewDocOpen(false)}
        onCreated={() => {
          refreshList();
        }}
        kbId={currentKbId}
      />

      <NewFolderDialog
        open={newFolderOpen}
        onClose={() => setNewFolderOpen(false)}
        onCreated={() => {
          refreshList();
        }}
        folders={folders}
        kbId={currentKbId}
      />

      <ExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        activeDocId={activeKey}
        kbId={currentKbId}
      />

      <NewKbDialog
        open={newKbOpen}
        onClose={() => {
          setNewKbOpen(false);
          setEditingKb(null);
        }}
        onSaved={() => {
          refreshKbs();
          setEditingKb(null);
        }}
        kb={editingKb}
      />

      <ProfileDialog
        open={profileOpen}
        user={user}
        onClose={() => setProfileOpen(false)}
        onUpdated={(u) => setUser(u)}
      />

      <ShareDialog
        open={shareKb !== null}
        kb={shareKb}
        onClose={() => setShareKb(null)}
        onChanged={() => refreshKbs()}
      />

      <ShareDocDialog
        open={shareDoc !== null}
        doc={shareDoc}
        onClose={() => setShareDoc(null)}
      />

      <TagsDialog
        open={tagsOpen}
        docId={tagsDocId ?? activeKey}
        initialTags={
          metas.find((m) => m.id === (tagsDocId ?? activeKey))?.tags ?? []
        }
        onClose={() => {
          setTagsOpen(false);
          setTagsDocId(null);
        }}
        onSaved={() => refreshList()}
      />

      <VersionHistoryDialog
        open={versionOpen}
        docId={activeKey}
        currentText={activeDoc?.body ?? ""}
        theme={theme}
        onClose={() => setVersionOpen(false)}
        onRolledBack={refreshList}
      />

      <FavoritesPopover
        open={favoritesOpen}
        onClose={() => setFavoritesOpen(false)}
        favorites={favorites}
        onOpen={openFavorite}
      />

      {/* 设置（阶段 3：提升为可深链的 L2 页面 `#/settings`）
          为什么直接渲染而不套 `view === "settings" ?` 分支：
          层级同步已由上面的 useEffect 保证（hash 顶层段 → view），
          这里只在确实处于设置层时渲染，条件是同一份判断。
          组件仍支持 `variant="dialog"`（保留能力，供未来「快速设置」浮层复用）。 */}
      {view === "settings" && (
        <SettingsDialog
          open
          variant="page"
          onClose={() => viewStack.upTo(0)}
          theme={theme}
          onToggleTheme={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
          isAdmin={user?.role === "admin"}
          pageHeader={(title, subtitle) => (
            <PageHeader
              title={title}
              subtitle={subtitle}
              crumbs={[
                { label: "首页", onClick: () => viewStack.upTo(0) },
                { label: "系统设置" },
              ]}
              onBack={() => viewStack.back()}
            />
          )}
        />
      )}

      <AiPanel
        theme={theme}
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        onOpenCitation={handleOpenCitation}
        kbs={kbs}
        currentKbId={currentKbId}
        currentDocId={activeKey}
        onAgentUi={handleAgentUi}
        // 确认执行后刷新左侧数据（新建/删除/移动都会影响树）
        onAgentDone={refreshList}
      />

      <CommentPanel
        docId={activeKey}
        open={commentsOpen && view === "kb"}
        onClose={() => {
          setCommentsOpen(false);
          setAnnotateQuote(null);
          setAnnotateAnchor(null);
          setActiveCommentId(null);
        }}
        currentUserId={user.id}
        isAdmin={user.role === "admin"}
        readOnly={readOnly}
        initialQuote={annotateQuote}
        initialAnchor={annotateAnchor}
        onConsumedQuote={() => setAnnotateQuote(null)}
        // 评论增删 → 重拉列表 → 正文高亮跟着重放
        onChanged={() => setCommentsVersion((v) => v + 1)}
        // 点引用块 → 定位正文锚点
        onLocate={setFocusCommentId}
        orphanIds={orphanIds}
        highlightId={activeCommentId}
      />

      <NotificationPanel
        open={notificationsOpen}
        onClose={() => setNotificationsOpen(false)}
        onOpenDoc={openRecent}
        onRead={setUnreadCount}
      />

      <MoveToKbDialog
        open={moveToKbTarget !== null}
        onClose={() => setMoveToKbTarget(null)}
        onMoved={refreshList}
        docIds={moveToKbTarget?.ids ?? []}
        docTitle={moveToKbTarget?.title ?? ""}
        kbs={kbs}
        currentKbId={currentKbId}
      />

      <TagManagerDialog
        open={tagManagerOpen}
        onClose={() => setTagManagerOpen(false)}
        onChanged={refreshList}
      />

      {/* 全局拖拽导入遮罩 */}
      {dragOver && (
        <div className="pointer-events-none fixed inset-0 z-[100] flex items-center justify-center bg-accent/10">
          <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-accent bg-background px-12 py-10 shadow-xl">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-accent">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
            </svg>
            <div className="text-base font-semibold text-text">释放以导入文档</div>
            <div className="text-xs text-faint">支持 .md .txt .json .csv .zip .pdf .docx .xlsx</div>
          </div>
        </div>
      )}
    </div>
  );
}
