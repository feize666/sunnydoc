"use client";

import { useState, useRef, useEffect } from "react";
import type { Doc } from "@/data/docs";
import {
  exportDocAsMarkdown,
  exportAllAsJson,
  exportAllAsZip,
} from "@/lib/exporter";

export function ExportMenu({
  docs,
  activeDoc,
}: {
  docs: Doc[];
  activeDoc: Doc | null;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const items = [
    {
      label: "导出当前文档 (.md)",
      disabled: !activeDoc,
      action: () => activeDoc && exportDocAsMarkdown(activeDoc),
    },
    {
      label: "导出全部文档 (.json)",
      disabled: docs.length === 0,
      action: () => exportAllAsJson(docs),
    },
    {
      label: "导出全部文档 (.zip)",
      disabled: docs.length === 0,
      action: () => exportAllAsZip(docs),
    },
  ];

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs text-muted hover:bg-hover hover:text-text"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
        </svg>
        导出
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-lg border border-line bg-background py-1 shadow-xl">
          {items.map((item, i) => (
            <button
              key={i}
              disabled={item.disabled}
              onClick={() => {
                item.action();
                setOpen(false);
              }}
              className="block w-full px-3 py-2 text-left text-[13px] text-text hover:bg-hover disabled:cursor-not-allowed disabled:text-faint"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
