"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { TitleBar } from "@/components/TitleBar";
import { Sidebar } from "@/components/Sidebar";
import { Editor } from "@/components/Editor";
import { AiPanel } from "@/components/AiPanel";
import { StatusBar } from "@/components/StatusBar";
import { CommandPalette, type Command } from "@/components/CommandPalette";
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
import { TagsDialog } from "@/components/TagsDialog";
import { VersionHistoryDialog } from "@/components/VersionHistoryDialog";
import { SettingsDialog } from "@/components/SettingsDialog";
import type { NodeType } from "@/components/NewNodeMenu";
import type { Doc, TreeNode, SortBy } from "@/data/docs";
import { countWords } from "@/lib/markdown";
import { buildTree } from "@/lib/buildTree";
import {
  listDocuments,
  listFolders,
  getDocument,
  deleteDocument,
  deleteFolder,
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
  searchDocuments,
  getMe,
  logout,
  getToken,
  setToken,
  addFavorite,
  removeFavorite,
  listFavorites,
  pinDocument,
  unpinDocument,
  generateSummary,
  type DocMeta,
  type Folder,
  type Kb,
  type RecentDoc,
  type SearchResult,
  type User,
} from "@/lib/api";

function formatTime(ts: number): string {
  const d = new Date(ts * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const SESSION_KEY = "sunnydoc.currentKbId";
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
  const [docs, setDocs] = useState<Record<string, Doc>>({});
  const [metas, setMetas] = useState<DocMeta[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [openKeys, setOpenKeys] = useState<string[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
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
  const [searching, setSearching] = useState(false);
  const [searchType, setSearchType] = useState<string>("");
  const [searchTag, setSearchTag] = useState<string>("");
  const [searchSort, setSearchSort] = useState<string>("relevance");
  const [highlight, setHighlight] = useState("");
  const [sortBy, setSortBy] = useState<SortBy>("numeric");

  // 登录态
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // 视图路由 + 当前知识库
  const [view, setView] = useState<"home" | "kb" | "users" | "trash">("home");
  const [profileOpen, setProfileOpen] = useState(false);
  const [shareKb, setShareKb] = useState<Kb | null>(null);
  const [shareDoc, setShareDoc] = useState<{ id: string; title: string } | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [versionOpen, setVersionOpen] = useState(false);
  const [currentKbId, setCurrentKbId] = useState<string | null>(null);
  const [kbs, setKbs] = useState<Kb[]>([]);
  const [recent, setRecent] = useState<RecentDoc[]>([]);
  const [favorites, setFavorites] = useState<DocMeta[]>([]);
  const [favIds, setFavIds] = useState<Set<string>>(new Set());
  const [kbsLoading, setKbsLoading] = useState(false);
  const [kbsError, setKbsError] = useState<string | null>(null);
  const restoredRef = useRef(false);
  const kbsFetchedRef = useRef(false);

  // 公开分享视图：检测 URL ?share=token（无需登录）
  const [shareToken] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("share");
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

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

  const handleOpenUsers = useCallback(() => {
    setView("users");
    setActiveKey(null);
    setOpenKeys([]);
  }, []);

  const handleOpenTrash = useCallback(() => {
    setView("trash");
    setActiveKey(null);
    setOpenKeys([]);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
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

  // 登录后才加载首页数据（避免未登录时带旧 token 请求 401，导致错误残留）
  useEffect(() => {
    if (!user) return;
    refreshKbs();
    refreshRecent();
    refreshFavorites();
  }, [user, refreshKbs, refreshRecent, refreshFavorites]);

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

  // 全局拖拽文件导入：在知识库视图拖入文件时显示遮罩，释放后打开导入对话框
  useEffect(() => {
    const isFileDrag = (e: DragEvent) => {
      return Array.from(e.dataTransfer?.types ?? []).includes("Files");
    };
    let depth = 0;
    const onDragEnter = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      if (view !== "kb") return;
      e.preventDefault();
      depth++;
      setDragOver(true);
    };
    const onDragOver = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      if (view !== "kb") return;
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
      e.preventDefault();
      depth = 0;
      setDragOver(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length > 0) {
        setDragFiles(files);
        setImportOpen(true);
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

  // 全文搜索（防抖 300ms，支持类型/标签过滤 + 排序）
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        setSearchResults(
          await searchDocuments(q, currentKbId, searchType || null, searchTag || null, searchSort),
        );
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, currentKbId, searchType, searchTag, searchSort]);

  // 点击搜索结果：打开文档并高亮关键词
  const handleOpenSearchResult = useCallback(
    (docId: string) => {
      openDoc(docId);
      setHighlight(searchQuery.trim());
    },
    [openDoc, searchQuery],
  );

  // 点击 AI 引用：打开对应文档并高亮片段（取片段开头作为关键词定位）
  const handleOpenCitation = useCallback(
    (docId: string, snippet: string) => {
      openDoc(docId);
      const kw = snippet.replace(/\s+/g, " ").trim().slice(0, 20);
      setHighlight(kw);
      setAiOpen(false);
    },
    [openDoc],
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
          },
        };
      });
      refreshList();
    },
    [refreshList],
  );

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
      } catch (e) {
        alert(`删除失败：${e instanceof Error ? e.message : "未知错误"}`);
      }
    },
    [closeDoc, refreshList],
  );

  // 删除文件夹
  const handleDeleteFolder = useCallback(
    async (id: string) => {
      try {
        await deleteFolder(id);
        refreshList();
      } catch (e) {
        alert(`删除文件夹失败：${e instanceof Error ? e.message : "未知错误"}`);
      }
    },
    [refreshList],
  );

  // 移动文档到文件夹
  const handleMoveDoc = useCallback(
    async (docId: string, folderId: string | null, sortOrder?: number | null) => {
      try {
        await moveDocument(docId, folderId, sortOrder ?? undefined);
        setSortBy("manual");
        refreshList();
      } catch (e) {
        alert(`移动文档失败：${e instanceof Error ? e.message : "未知错误"}`);
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
        alert(`移动文件夹失败：${e instanceof Error ? e.message : "未知错误"}`);
      }
    },
    [refreshList],
  );

  // 语雀式「+」快速新建（默认标题）
  const handleNew = useCallback(
    async (type: NodeType, parentFolderId: string | null) => {
      try {
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
          refreshList();
          openDoc(doc.id);
        } else if (type === "board") {
          const doc = await createDocument(
            "未命名画板",
            JSON.stringify([]),
            currentKbId,
            parentFolderId,
            "board",
          );
          refreshList();
          openDoc(doc.id);
        } else if (type === "datasheet") {
          const doc = await createDocument(
            "未命名数据表",
            JSON.stringify({ columns: ["字段 1", "字段 2"], rows: [["", ""], ["", ""]] }),
            currentKbId,
            parentFolderId,
            "datasheet",
          );
          refreshList();
          openDoc(doc.id);
        } else {
          const doc = await createDocument("未命名文档", "", currentKbId, parentFolderId);
          refreshList();
          openDoc(doc.id);
        }
      } catch (e) {
        alert(`新建失败：${e instanceof Error ? e.message : "未知错误"}`);
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
        alert(`重命名失败：${e instanceof Error ? e.message : "未知错误"}`);
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
        alert(`重命名失败：${e instanceof Error ? e.message : "未知错误"}`);
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
      } catch (e) {
        alert(`复制失败：${e instanceof Error ? e.message : "未知错误"}`);
      }
    },
    [refreshList],
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
      alert(`导出失败：${e instanceof Error ? e.message : "未知错误"}`);
    }
  }, []);

  // 进入知识库
  const enterKb = useCallback((id: string) => {
    saveSessionKbId(id);
    setCurrentKbId(id);
    setView("kb");
    setActiveKey(null);
    setOpenKeys([]);
  }, []);

  // 返回首页
  const goHome = useCallback(() => {
    clearSessionKbId();
    setView("home");
    setActiveKey(null);
    setOpenKeys([]);
    refreshKbs();
    refreshRecent();
  }, [refreshKbs, refreshRecent]);

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
      } catch (e) {
        alert(`删除知识库失败：${e instanceof Error ? e.message : "未知错误"}`);
      }
    },
    [currentKbId, refreshKbs, refreshRecent],
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
        alert(`收藏操作失败：${e instanceof Error ? e.message : "未知错误"}`);
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
  const handleTogglePin = useCallback(
    async (docId: string, pinned: boolean) => {
      try {
        if (pinned) await unpinDocument(docId);
        else await pinDocument(docId);
        refreshList();
      } catch (e) {
        alert(`置顶操作失败：${e instanceof Error ? e.message : "未知错误"}`);
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
        alert(`生成摘要失败：${e instanceof Error ? e.message : "未知错误"}`);
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
      icon: "📥",
      label: "导入文档",
      hint: "Ctrl+I",
      action: () => setImportOpen(true),
    },
    {
      icon: "📁",
      label: "新建文件夹",
      hint: "",
      action: () => setNewFolderOpen(true),
    },
    {
      icon: "🔄",
      label: "刷新文档列表",
      hint: "",
      action: () => refreshList(),
    },
    { icon: "🔍", label: "全文搜索", hint: "Ctrl+F" },
    {
      icon: theme === "light" ? "🌙" : "☀️",
      label: "切换主题",
      hint: "Ctrl+Shift+T",
      action: () => setTheme((t) => (t === "light" ? "dark" : "light")),
    },
    { icon: "⚙️", label: "设置", hint: "Ctrl+," },
  ];

  // 公开分享视图（优先，无需登录）
  if (shareToken) {
    return <ShareView token={shareToken} />;
  }

  // 登录态守卫：校验中 / 未登录
  if (authLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-background text-muted">
        <p className="text-sm">加载中…</p>
      </div>
    );
  }
  if (!user) {
    return <LoginView onAuthed={handleAuthed} />;
  }

  return (
    <div className="flex h-full flex-col bg-background">
      {view === "kb" ? (
        <>
          <TitleBar
            openDocs={openKeys
              .map((k) => ({ key: k, title: docs[k]?.title ?? k }))
              .filter((d) => d.title)}
            activeKey={activeKey}
            onSelect={openDoc}
            onClose={closeDoc}
            onToggleSidebar={() => setSidebarCollapsed((v) => !v)}
            onOpenPalette={() => setPaletteOpen(true)}
            theme={theme}
            onToggleTheme={() =>
              setTheme((t) => (t === "light" ? "dark" : "light"))
            }
            onBackHome={goHome}
            onToggleAi={() => setAiOpen((v) => !v)}
            aiOpen={aiOpen}
            onOpenFavorites={() => setFavoritesOpen(true)}
          />

          <div className="flex min-h-0 flex-1">
            <Sidebar
              data={tree}
              activeKey={activeKey}
              onSelect={openDoc}
              collapsed={sidebarCollapsed}
              onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
              folders={folders}
              onImport={() => setImportOpen(true)}
              onNewDoc={() => setNewDocOpen(true)}
              onNewFolder={() => setNewFolderOpen(true)}
              onExport={() => setExportOpen(true)}
              onRefresh={refreshList}
              onDeleteDoc={handleDelete}
              onDeleteFolder={handleDeleteFolder}
              onRenameFolder={handleRenameFolder}
              onMoveDoc={handleMoveDoc}
              onMoveFolder={handleMoveFolder}
              onNew={handleNew}
              onRenameDoc={handleRenameDoc}
              onDuplicateDoc={handleDuplicateDoc}
              onPinDoc={handleTogglePin}
              onExportDoc={handleExportDoc}
              listError={listError}
              kbName={currentKb?.name}
              onBackHome={goHome}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              searchType={searchType}
              onSearchTypeChange={setSearchType}
              searchTag={searchTag}
              onSearchTagChange={setSearchTag}
              searchSort={searchSort}
              onSearchSortChange={setSearchSort}
              searchResults={searchResults}
              searching={searching}
              onOpenSearchResult={handleOpenSearchResult}
              sortBy={sortBy}
              onSortChange={setSortBy}
              readOnly={readOnly}
              onOpenTrash={handleOpenTrash}
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
                  ? () => handleTogglePin(activeKey, activeMeta?.pinned ?? false)
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
            />
          </div>

          <StatusBar
            wordCount={wordCount}
            openCount={openKeys.length}
            user={user}
            onOpenProfile={handleOpenProfile}
            onOpenUsers={handleOpenUsers}
            onLogout={handleLogout}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        </>
      ) : view === "users" ? (
        <UserManagementView currentUserId={user.id} onBack={goHome} />
      ) : view === "trash" ? (
        <TrashView onBack={goHome} />
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
          user={user}
          onOpenProfile={handleOpenProfile}
          onOpenUsers={handleOpenUsers}
          onLogout={handleLogout}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      )}

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

      <ImportDialog
        open={importOpen}
        onClose={() => {
          setImportOpen(false);
          setDragFiles(null);
        }}
        onImported={() => {
          refreshList();
        }}
        kbId={currentKbId}
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
        docId={activeKey}
        initialTags={activeMeta?.tags ?? []}
        onClose={() => setTagsOpen(false)}
        onSaved={() => refreshList()}
      />

      <VersionHistoryDialog
        open={versionOpen}
        docId={activeKey}
        onClose={() => setVersionOpen(false)}
        onRolledBack={refreshList}
      />

      <FavoritesPopover
        open={favoritesOpen}
        onClose={() => setFavoritesOpen(false)}
        favorites={favorites}
        onOpen={openFavorite}
      />

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
      />

      <AiPanel theme={theme} open={aiOpen} onClose={() => setAiOpen(false)} onOpenCitation={handleOpenCitation} />

      {/* 全局拖拽导入遮罩 */}
      {dragOver && (
        <div className="pointer-events-none fixed inset-0 z-[100] flex items-center justify-center bg-accent/10 backdrop-blur-[2px]">
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
