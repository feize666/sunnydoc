"use client";

import { useState } from "react";
import { exportDocuments, type ExportFormat } from "@/lib/api";
import { CloseIcon } from "./icons";

const FORMATS: {
  id: ExportFormat;
  label: string;
  desc: string;
  icon: string;
}[] = [
  {
    id: "md",
    label: "Markdown",
    desc: "导出为 .md 纯文本",
    icon: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6",
  },
  {
    id: "docx",
    label: "Word",
    desc: "导出为 .docx 文档",
    icon: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h8",
  },
  {
    id: "pdf",
    label: "PDF",
    desc: "导出为 .pdf 文件",
    icon: "M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM15 2v6h6M9 13h6M9 17h4",
  },
  {
    id: "html",
    label: "HTML",
    desc: "导出为 .html 网页",
    icon: "M4 4l8 16 8-16M4 4h16M12 20v0",
  },
  {
    id: "json",
    label: "JSON",
    desc: "导出为 .json 数据",
    icon: "M8 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h2M16 3h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-2",
  },
  {
    id: "zip",
    label: "ZIP",
    desc: "打包为 .zip 压缩包",
    icon: "M21 8v13H3V8M1 3h22v5H1zM10 12h4",
  },
];

export function ExportDialog({
  open,
  onClose,
  activeDocId,
  kbId,
}: {
  open: boolean;
  onClose: () => void;
  activeDocId: string | null;
  kbId?: string | null;
}) {
  const [format, setFormat] = useState<ExportFormat>("md");
  const [scope, setScope] = useState<"current" | "all" | "kb">("current");
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleExport = async () => {
    if (scope === "current" && !activeDocId) {
      setError("当前没有打开的文档，请先选择一篇文档或切换到「导出全部」");
      return;
    }
    if (scope === "kb" && !kbId) {
      setError("当前不在知识库中，无法导出整个知识库");
      return;
    }
    setExporting(true);
    setError(null);
    try {
      if (scope === "kb") {
        // 整个知识库导出：固定 zip，保留目录结构
        const { filename, blob } = await exportDocuments("zip", undefined, kbId);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        onClose();
        return;
      }
      const docIds = scope === "current" && activeDocId ? [activeDocId] : undefined;
      const { filename, blob } = await exportDocuments(format, docIds, kbId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "导出失败");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog-panel w-[560px] max-w-[92vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <span className="text-sm font-semibold">导出文档</span>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-hover"
          >
            <CloseIcon size={16} />
          </button>
        </div>

        <div className="p-4">
          <label className="mb-1.5 block text-xs text-muted">导出范围</label>
          <div className="flex gap-2">
            <button
              onClick={() => setScope("current")}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${
                scope === "current"
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-line text-muted hover:bg-hover"
              }`}
            >
              当前文档
            </button>
            <button
              onClick={() => setScope("all")}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${
                scope === "all"
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-line text-muted hover:bg-hover"
              }`}
            >
              全部文档
            </button>
            <button
              onClick={() => {
                setScope("kb");
                setFormat("zip");
              }}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${
                scope === "kb"
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-line text-muted hover:bg-hover"
              }`}
            >
              整个知识库
            </button>
          </div>
          {scope === "kb" && (
            <p className="mt-2 rounded-md bg-surface-2 px-2.5 py-1.5 text-[12px] text-muted">
              以 ZIP 压缩包导出整个知识库，保留文件夹目录结构，含媒体文件与清单 manifest.json
            </p>
          )}

          {scope !== "kb" && (
            <>
              <label className="mb-1.5 mt-4 block text-xs text-muted">导出格式</label>
              <div className="grid grid-cols-3 gap-2">
                {FORMATS.map((f) => {
                  const active = format === f.id;
                  return (
                    <button
                      key={f.id}
                      onClick={() => setFormat(f.id)}
                      className={`flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors ${
                        active
                          ? "border-accent bg-accent-soft"
                          : "border-line hover:bg-hover"
                      }`}
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        className={active ? "text-accent" : "text-muted"}
                      >
                        <path d={f.icon} />
                      </svg>
                      <span
                        className={`text-[14px] font-medium ${
                          active ? "text-accent" : "text-text"
                        }`}
                      >
                        {f.label}
                      </span>
                      <span className="text-[12px] text-faint">{f.desc}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {error && (
            <div className="mt-3 rounded-md border border-danger/40 bg-danger-soft px-2 py-1.5 text-xs text-danger">
              {error}
            </div>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <button
              onClick={onClose}
              className="btn btn-secondary"
            >
              取消
            </button>
            <button
              onClick={handleExport}
              disabled={exporting}
              className="btn btn-accent text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {exporting ? "导出中…" : "导出"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
