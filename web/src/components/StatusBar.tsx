"use client";

import { useEffect, useState } from "react";
import { SunIcon, MoonIcon } from "./icons";
import { Tooltip } from "./Tooltip";

type BackendStatus = "online" | "offline" | "checking";

const backendMeta: Record<BackendStatus, { label: string; dot: string }> = {
  online: { label: "后端已连接", dot: "bg-success" },
  offline: { label: "后端未连接", dot: "bg-danger" },
  checking: { label: "检测中…", dot: "bg-warning animate-pulse" },
};

export function StatusBar({
  wordCount,
  openCount,
  backendStatus = "online",
}: {
  wordCount: number;
  openCount: number;
  backendStatus?: BackendStatus;
}) {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const el = document.documentElement;
    const read = () =>
      setTheme(el.dataset.theme === "dark" ? "dark" : "light");
    read();
    const observer = new MutationObserver(read);
    observer.observe(el, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  const { label, dot } = backendMeta[backendStatus];

  return (
    <footer className="flex h-8 items-center gap-2 border-t border-line bg-surface pl-3.5 pr-3.5 text-[12px] text-faint select-none">
      <span>{wordCount.toLocaleString()} 字</span>
      <span>{openCount} 篇已打开</span>
      <span className="flex items-center gap-1.5">
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${dot}`} />
        {label}
      </span>
      <div className="ml-auto flex items-center gap-3.5">
        <Tooltip content="当前主题">
          <span className="flex items-center gap-1">
            {theme === "light" ? <SunIcon size={11} /> : <MoonIcon size={11} />}
            {theme === "light" ? "浅色" : "深色"}
          </span>
        </Tooltip>
        <span>Markdown</span>
        <span>UTF-8</span>
      </div>
    </footer>
  );
}
