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
import type { Doc, TreeNode } from "@/data/docs";
import { countWords } from "@/lib/markdown";
import { buildTree } from "@/lib/buildTree";
import {
  listDocuments,
  listFolders,
  getDocument,
  deleteDocument,
  deleteFolder,
  moveDocument,
  listKbs,
  deleteKb,
  listRecent,
  recordRecent,
  type DocMeta,
  type Folder,
  type Kb,
  type RecentDoc,
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
  const [newDocOpen, setNewDocOpen] = useState(false);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [newKbOpen, setNewKbOpen] = useState(false);
  const [loadingDoc, setLoadingDoc] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  // 视图路由 + 当前知识库
  const [view, setView] = useState<"home" | "kb">("home");
  const [currentKbId, setCurrentKbId] = useState<string | null>(null);
  const [kbs, setKbs] = useState<Kb[]>([]);
  const [recent, setRecent] = useState<RecentDoc[]>([]);
  const [kbsLoading, setKbsLoading] = useState(false);
  const [kbsError, setKbsError] = useState<string | null>(null);
  const restoredRef = useRef(false);
  const kbsFetchedRef = useRef(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

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

  useEffect(() => {
    refreshKbs();
    refreshRecent();
  }, [refreshKbs, refreshRecent]);

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
    } catch (e) {
      setListError(e instanceof Error ? e.message : "加载文档列表失败");
    }
  }, [currentKbId]);

  useEffect(() => {
    if (view === "kb") refreshList();
  }, [view, refreshList]);

  // 打开文档：设置 active，若未加载全文则拉取，并记录最近浏览
  const openDoc = useCallback(
    async (key: string) => {
      setOpenKeys((prev) => (prev.includes(key) ? prev : [...prev, key]));
      setActiveKey(key);
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
            },
          }));
          void recordRecent(detail.id);
        } catch {
          // 加载失败，保持空
        } finally {
          setLoadingDoc(false);
        }
      } else {
        void recordRecent(key);
      }
    },
    [docs],
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
    async (docId: string, folderId: string | null) => {
      try {
        await moveDocument(docId, folderId);
        refreshList();
      } catch (e) {
        alert(`移动文档失败：${e instanceof Error ? e.message : "未知错误"}`);
      }
    },
    [refreshList],
  );

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

  // 构建多级文件树
  const tree: TreeNode[] = buildTree(metas, folders);

  const activeDoc = activeKey ? docs[activeKey] ?? null : null;
  const wordCount = activeDoc ? countWords(activeDoc.body) : 0;
  const currentKb = kbs.find((k) => k.id === currentKbId) ?? null;

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
          />

          <div className="flex min-h-0 flex-1">
            <Sidebar
              data={tree}
              activeKey={activeKey}
              onSelect={openDoc}
              collapsed={sidebarCollapsed}
              onToggleCollapse={() => setSidebarCollapsed(false)}
              folders={folders}
              onImport={() => setImportOpen(true)}
              onNewDoc={() => setNewDocOpen(true)}
              onNewFolder={() => setNewFolderOpen(true)}
              onExport={() => setExportOpen(true)}
              onRefresh={refreshList}
              onDeleteDoc={handleDelete}
              onDeleteFolder={handleDeleteFolder}
              onMoveDoc={handleMoveDoc}
              listError={listError}
              kbName={currentKb?.name}
              onBackHome={goHome}
            />
            <Editor doc={activeDoc} loading={loadingDoc} onSaved={handleSaved} />
            <AiPanel />
          </div>

          <StatusBar wordCount={wordCount} openCount={openKeys.length} />
        </>
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
          onDeleteKb={handleDeleteKb}
          onOpenRecent={openRecent}
        />
      )}

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        commands={commands}
      />

      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => {
          refreshList();
        }}
        kbId={currentKbId}
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
        onClose={() => setNewKbOpen(false)}
        onCreated={() => {
          refreshKbs();
        }}
      />
    </div>
  );
}
