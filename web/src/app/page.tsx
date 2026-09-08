"use client";

import { useState, useEffect, useCallback } from "react";
import { TitleBar } from "@/components/TitleBar";
import { Sidebar } from "@/components/Sidebar";
import { Editor } from "@/components/Editor";
import { AiPanel } from "@/components/AiPanel";
import { StatusBar } from "@/components/StatusBar";
import { CommandPalette, type Command } from "@/components/CommandPalette";
import { ImportDialog } from "@/components/ImportDialog";
import { docs as seedDocs, treeData as seedTree, type Doc, type TreeNode } from "@/data/docs";
import { countWords } from "@/lib/markdown";
import type { ImportedDoc } from "@/lib/importer";

function buildDocKey(): string {
  return `doc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export default function Home() {
  const [docs, setDocs] = useState<Record<string, Doc>>(seedDocs);
  const [tree, setTree] = useState<TreeNode[]>(seedTree);
  const [openKeys, setOpenKeys] = useState<string[]>(["quickstart"]);
  const [activeKey, setActiveKey] = useState<string | null>("quickstart");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

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

  const openDoc = useCallback((key: string) => {
    setOpenKeys((prev) => (prev.includes(key) ? prev : [...prev, key]));
    setActiveKey(key);
  }, []);

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

  // 导入回调：把新文档加入 docs 和树（归入「导入的文档」文件夹）
  const handleImported = useCallback((imported: ImportedDoc[]) => {
    const newKeys: string[] = [];
    const addedDocs: Record<string, Doc> = {};
    const addedNodes: TreeNode[] = [];

    for (const d of imported) {
      const key = buildDocKey();
      newKeys.push(key);
      addedDocs[key] = {
        key,
        title: d.title,
        path: `导入的文档 / ${d.title}`,
        updated: new Date().toLocaleString("zh-CN", { hour12: false }),
        body: d.body,
      };
      addedNodes.push({ type: "file", name: d.title, key });
    }

    setDocs((prev) => ({ ...prev, ...addedDocs }));
    setTree((prev) => {
      const folderName = "导入的文档";
      const existing = prev.find((n) => n.type === "folder" && n.name === folderName);
      if (existing && existing.children) {
        return prev.map((n) =>
          n.name === folderName
            ? { ...n, children: [...(n.children ?? []), ...addedNodes] }
            : n,
        );
      }
      return [...prev, { type: "folder", name: folderName, children: addedNodes }];
    });
    if (newKeys.length > 0) openDoc(newKeys[0]);
  }, [openDoc]);

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
      icon: "📄",
      label: "新建文档",
      hint: "Ctrl+N",
      action: () => setImportOpen(true),
    },
    { icon: "🔍", label: "全文搜索", hint: "Ctrl+F" },
    { icon: "💬", label: "打开 AI 问答", hint: "Ctrl+J" },
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
        />
        <Editor doc={activeDoc} />
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
        onImported={handleImported}
      />
    </div>
  );
}
