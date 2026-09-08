"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { importDocumentAsync, getImportTask } from "@/lib/api";
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
}: {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
  kbId?: string | null;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [current, setCurrent] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

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
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/30"
      onClick={onClose}
    >
      <div
        className="w-[560px] max-w-[92vw] overflow-hidden rounded-xl border border-line bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <span className="text-sm font-semibold">导入文档</span>
          <button
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-hover"
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
          </div>
        )}

        {phase === "uploading" && (
          <div className="p-6">
            <div className="mb-2 flex items-center justify-between gap-3 text-xs">
              <span className="shrink-0 text-muted">上传中 {progress}%</span>
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
              <span className="font-medium text-accent">{progress}%</span>
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
                      className="border-b border-line px-3 py-1.5 text-[13px] last:border-0"
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
                className="rounded-lg border border-line px-4 py-2 text-sm text-text hover:bg-hover"
              >
                继续导入
              </button>
              <button
                onClick={onClose}
                className="btn-accent rounded-lg px-4 py-2 text-sm text-white"
              >
                完成
              </button>
            </div>
          </div>
        )}

        {phase === "failed" && (
          <div className="p-4">
            <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2.5 text-sm text-red-600">
              {errorMsg || "导入失败"}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={reset}
                className="rounded-lg border border-line px-4 py-2 text-sm text-text hover:bg-hover"
              >
                重新导入
              </button>
              <button
                onClick={onClose}
                className="btn-accent rounded-lg px-4 py-2 text-sm text-white"
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
