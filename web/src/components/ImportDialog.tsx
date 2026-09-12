"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { importDocumentAsync, getImportTask, importFromUrl } from "@/lib/api";
import { CloseIcon } from "./icons";

type Phase = "idle" | "uploading" | "parsing" | "done" | "failed";

interface ImportResult {
  count: number;
  media: number;
  titles: string[];
}

export function ImportDialog({
  open,
  onClose,
  onImported,
  kbId,
  autoFiles,
}: {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
  kbId?: string | null;
  autoFiles?: File[] | null;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [current, setCurrent] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [importingUrl, setImportingUrl] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  // 外部注入文件（全局拖拽）时，自动开始导入
  useEffect(() => {
    if (open && autoFiles && autoFiles.length > 0 && phase === "idle") {
      handleFiles(autoFiles);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, autoFiles]);

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const arr = Array.from(files);
      if (arr.length === 0) return;
      const file = arr[0];

      setPhase("uploading");
      setProgress(0);
      setCurrent(file.name);
      setResult(null);
      setErrorMsg(null);

      try {
        const { task_id } = await importDocumentAsync(file, kbId, (p) => setProgress(p));
        setPhase("parsing");
        pollRef.current = window.setInterval(async () => {
          try {
            const s = await getImportTask(task_id);
            setProgress(Math.max(0, Math.min(100, s.progress)));
            if (s.current) setCurrent(s.current);
            if (s.status === "done") {
              stopPolling();
              setProgress(100);
              setPhase("done");
              setResult({
                count: s.imported?.length ?? s.done ?? 0,
                media: s.media_count ?? 0,
                titles: s.imported?.map((i) => i.title) ?? [],
              });
              onImported();
            } else if (s.status === "failed") {
              stopPolling();
              setPhase("failed");
              setErrorMsg(s.message || "导入失败");
            }
          } catch (e) {
            stopPolling();
            setPhase("failed");
            setErrorMsg(e instanceof Error ? e.message : "查询任务状态失败");
          }
        }, 900);
      } catch (e) {
        setPhase("failed");
        setErrorMsg(e instanceof Error ? e.message : "上传失败");
      }
    },
    [onImported, stopPolling, kbId],
  );

  const handleUrlImport = useCallback(async () => {
    const url = urlInput.trim();
    if (!url || importingUrl) return;
    setImportingUrl(true);
    setErrorMsg(null);
    try {
      const r = await importFromUrl(url, kbId);
      setPhase("done");
      setResult({ count: 1, media: 0, titles: [r.title] });
      onImported();
      setUrlInput("");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "导入失败");
    } finally {
      setImportingUrl(false);
    }
  }, [urlInput, importingUrl, kbId, onImported]);

  if (!open) return null;

  const reset = () => {
    stopPolling();
    setPhase("idle");
    setProgress(0);
    setCurrent("");
    setResult(null);
    setErrorMsg(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog-panel w-[560px] max-w-[92vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <span className="text-sm font-semibold">导入文档</span>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-hover"
          >
            <CloseIcon size={16} />
          </button>
        </div>

        {phase === "idle" && (
          <div className="p-4">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                handleFiles(e.dataTransfer.files);
              }}
              onClick={() => inputRef.current?.click()}
              className={`grid cursor-pointer place-items-center gap-2 rounded-lg border-2 border-dashed py-12 text-center transition-colors ${
                dragOver
                  ? "border-accent bg-accent-soft"
                  : "border-line hover:border-accent"
              }`}
            >
              <svg
                width="36"
                height="36"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className="text-muted"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
              </svg>
              <div className="text-sm text-text">
                {dragOver ? "松开以导入文件" : "拖拽文件到此处，或点击选择"}
              </div>
              <div className="text-xs text-faint">
                支持 .md .txt .json .csv .zip .pdf .docx .xlsx
              </div>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept=".md,.markdown,.txt,.text,.json,.csv,.tsv,.zip,.pdf,.doc,.docx,.xls,.xlsx"
              className="hidden"
              onChange={(e) => e.target.files && handleFiles(e.target.files)}
            />

            <div className="mt-3">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                    </svg>
                  </span>
                  <input
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleUrlImport();
                    }}
                    placeholder="或粘贴网页链接导入（http/https）"
                    className="h-9 w-full rounded-lg border border-line bg-background pl-9 pr-2 text-[13px] text-text outline-none placeholder:text-faint focus:border-accent focus:ring-2 focus:ring-accent/20"
                  />
                </div>
                <button
                  onClick={handleUrlImport}
                  disabled={importingUrl || !urlInput.trim()}
                  className="btn btn-secondary h-9 shrink-0 disabled:opacity-50"
                >
                  {importingUrl ? "导入中…" : "导入"}
                </button>
              </div>
              {errorMsg && (
                <div className="mt-2 rounded-md bg-danger-soft px-3 py-1.5 text-xs text-danger">
                  {errorMsg}
                </div>
              )}
            </div>
          </div>
        )}

        {phase === "uploading" && (
          <div className="p-6">
            <div className="mb-2 flex items-center justify-between gap-3 text-xs">
              <span className="shrink-0 text-muted">上传中 {progress.toFixed(2)}%</span>
              <span className="truncate text-faint">{current}</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full bg-accent transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {phase === "parsing" && (
          <div className="p-6">
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="text-muted">解析中…</span>
              <span className="font-medium text-accent">{progress.toFixed(2)}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full bg-accent transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="mt-2 truncate text-xs text-faint">
              {current || "正在解析…"}
            </div>
          </div>
        )}

        {phase === "done" && result && (
          <div className="p-4">
            <div className="space-y-3">
              <div className="flex items-center gap-2 rounded-lg bg-accent-soft px-3 py-2.5 text-sm text-accent">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M20 6L9 17l-5-5" />
                </svg>
                导入完成：共 {result.count} 篇文档
                {result.media > 0 && `、媒体 ${result.media} 个`}
              </div>
              {result.titles.length > 0 && (
                <div className="max-h-40 overflow-y-auto rounded-lg border border-line">
                  {(result.titles ?? []).map((t, i) => (
                    <div
                      key={i}
                      className="border-b border-line px-3 py-1.5 text-[14px] last:border-0"
                    >
                      {t}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={reset}
                className="btn btn-secondary"
              >
                继续导入
              </button>
              <button
                onClick={onClose}
                className="btn btn-accent text-white"
              >
                完成
              </button>
            </div>
          </div>
        )}

        {phase === "failed" && (
          <div className="p-4">
            <div className="rounded-lg border border-danger/40 bg-danger-soft px-3 py-2.5 text-sm text-danger">
              {errorMsg || "导入失败"}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={reset}
                className="btn btn-secondary"
              >
                重新导入
              </button>
              <button
                onClick={onClose}
                className="btn btn-accent text-white"
              >
                关闭
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
