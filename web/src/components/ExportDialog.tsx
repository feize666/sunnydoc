"use client";

import { useState, useEffect } from "react";
import { exportDocuments, type ExportFormat } from "@/lib/api";
import { useModalFocus } from "@/lib/useModalFocus";
import { useToast } from "./Toast";
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
  folderId,
  folderName,
}: {
  open: boolean;
  onClose: () => void;
  activeDocId: string | null;
  kbId?: string | null;
  /** 当前选中的目录（可选）。提供时多一个「当前目录」范围。 */
  folderId?: string | null;
  folderName?: string | null;
}) {
  const toast = useToast();
  const [format, setFormat] = useState<ExportFormat>("md");
  const [scope, setScope] = useState<"current" | "folder" | "all" | "kb">("current");
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 用户是否自己改过格式。没改过时，切到「整个知识库」会自动变 zip 并说明。 */
  const [formatTouched, setFormatTouched] = useState(false);

  const panelRef = useModalFocus<HTMLDivElement>(open, onClose, "导出文档");

  // 打开时重置：上次选了「整个知识库」、这次从某篇文档点进来，
  // 不该还停在 zip 上（会导出一整个库，用户完全没预期）。
  useEffect(() => {
    if (!open) return;
    setError(null);
    setFormatTouched(false);
    setScope((s) => {
      // 没有打开的文档就别默认「当前文档」——先拦住，别让用户点了才知道不行
      if (s === "current" && !activeDocId) return folderId ? "folder" : "all";
      return s;
    });
  }, [open, activeDocId, folderId]);

  if (!open) return null;

  const download = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleExport = async () => {
    if (scope === "current" && !activeDocId) {
      setError("当前没有打开的文档，请先选择一篇文档或切换到其它范围");
      return;
    }
    if (scope === "folder" && !folderId) {
      setError("当前没有选中的目录");
      return;
    }
    if (scope === "kb" && !kbId) {
      setError("当前不在知识库中，无法导出整个知识库");
      return;
    }
    setExporting(true);
    setError(null);
    try {
      let filename: string;
      let blob: Blob;
      if (scope === "kb") {
        // 整个知识库：固定 zip，保留目录结构
        ({ filename, blob } = await exportDocuments("zip", undefined, kbId));
      } else {
        const docIds = scope === "current" && activeDocId ? [activeDocId] : undefined;
        ({ filename, blob } = await exportDocuments(
          format,
          docIds,
          kbId,
          scope === "folder" ? folderId : undefined,
        ));
      }
      download(blob, filename);
      // 之前是「下载完直接 onClose」，用户不知道成没成 —— 全库 docx 要 2.6s，
      // 大 zip 更久，框一闪就没会让人怀疑白点了一次。
      toast.success(`已导出 ${filename}`);
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
        ref={panelRef}
        className="dialog-panel w-[560px] max-w-[92vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <span className="text-sm font-semibold">导出文档</span>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="icon-btn text-muted hover:text-text"
          >
            <CloseIcon size={16} />
          </button>
        </div>

        <div className="p-4">
          <label className="mb-1.5 block text-xs text-muted">导出范围</label>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setScope("current")}
              disabled={!activeDocId}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${
                scope === "current"
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-line text-muted hover:bg-hover"
              } disabled:cursor-not-allowed disabled:opacity-40`}
              title={activeDocId ? "只导出当前打开的这一篇" : "当前没有打开的文档"}
            >
              当前文档
            </button>
            {folderId && (
              <button
                onClick={() => setScope("folder")}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${
                  scope === "folder"
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-line text-muted hover:bg-hover"
                }`}
                title={`导出目录「${folderName || "当前目录"}」及其所有子目录`}
              >
                当前目录
              </button>
            )}
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
                // 只在用户没自己选过格式时自动切 zip。
                // 原来无条件 setFormat("zip")：用户明明选了 Markdown，
                // 点一下「整个知识库」格式就被静默改掉，滑回去还以为还是 md。
                if (!formatTouched) setFormat("zip");
              }}
              disabled={!kbId}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${
                scope === "kb"
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-line text-muted hover:bg-hover"
              } disabled:cursor-not-allowed disabled:opacity-40`}
              title={kbId ? "导出整个知识库（保留目录结构）" : "当前不在知识库中"}
            >
              整个知识库
            </button>
          </div>
          {scope === "folder" && (
            <p className="mt-2 rounded-md bg-surface-2 px-2.5 py-1.5 text-[12px] text-muted">
              导出「{folderName || "当前目录"}」及其全部子目录下的文档
            </p>
          )}
          {scope === "kb" && (
            <p className="mt-2 rounded-md bg-surface-2 px-2.5 py-1.5 text-[12px] text-muted">
              以 ZIP 压缩包导出整个知识库，保留文件夹目录结构，含媒体文件与清单 manifest.json
              {!formatTouched && "（格式已自动切换为 ZIP）"}
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
                      onClick={() => {
                        setFormat(f.id);
                        // 记下「用户亲自选过格式」，之后切到「整个知识库」
                        // 就不再自动覆盖他的选择。
                        setFormatTouched(true);
                      }}
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
