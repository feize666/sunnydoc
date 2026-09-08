"use client";

import { useState, useEffect, useCallback } from "react";
import { TitleBar } from "@/components/TitleBar";
import { Sidebar } from "@/components/Sidebar";
import { Editor } from "@/components/Editor";
import { AiPanel } from "@/components/AiPanel";
import { StatusBar } from "@/components/StatusBar";
import { CommandPalette, type Command } from "@/components/CommandPalette";
import { ImportDialog } from "@/components/ImportDialog";
import type { Doc, TreeNode } from "@/data/docs";
import { countWords } from "@/lib/markdown";
import {
  listDocuments,
  getDocument,
  type DocMeta,
} from "@/lib/api";

function formatTime(ts: number): string {
  const d = new Date(ts * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function Home() {
  const [docs, setDocs] = useState<Record<string, Doc>>({});
  const [metas, setMetas] = useState<DocMeta[]>([]);
  const [openKeys, setOpenKeys] = useState<string[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [loadingDoc, setLoadingDoc] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

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

  // 拉取文档列表
  const refreshList = useCallback(async () => {
    try {
      setListError(null);
      const list = await listDocuments();
      setMetas(list);
    } catch (e) {
      setListError(e instanceof Error ? e.message : "加载文档列表失败");
    }
  }, []);

  useEffect(() => {
    refreshList();
  }, [refreshList]);

  // 打开文档：设置 active，若未加载全文则拉取
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
        } catch {
          // 加载失败，保持空
        } finally {
          setLoadingDoc(false);
        }
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

  // 构建文件树：按 source 的文件名分组
  const tree: TreeNode[] = metas.map((m) => ({
    type: "file",
    name: m.title,
    key: m.id,
  }));

  const activeDoc = activeKey ? docs[activeKey] ?? null : null;
  const wordCount = activeDoc ? countWords(activeDoc.body) : 0;
  const allDocs = Object.values(docs);

  const commands: Command[] = [
    {
      icon: "📥",
      label: "导入文档",
      hint: "Ctrl+I",
      action: () => setImportOpen(true),
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
        onToggleTheme={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
      />

      <div className="flex min-h-0 flex-1">
        <Sidebar
          data={tree}
          activeKey={activeKey}
          onSelect={openDoc}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(false)}
          docs={allDocs}
          activeDoc={activeDoc}
          onImport={() => setImportOpen(true)}
          onRefresh={refreshList}
          listError={listError}
        />
        <Editor doc={activeDoc} loading={loadingDoc} />
        <AiPanel />
      </div>

      <StatusBar wordCount={wordCount} openCount={openKeys.length} />

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
      />
    </div>
  );
}
