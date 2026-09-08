"use client";

import { useState, useRef, useCallback } from "react";
import { importFiles, type ImportedDoc, type SkippedFile } from "@/lib/importer";
import { CloseIcon } from "./icons";

export function ImportDialog({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: (docs: ImportedDoc[]) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<{
    imported: ImportedDoc[];
    skipped: SkippedFile[];
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      if (files.length === 0) return;
      setProcessing(true);
      setResult(null);
      const res = await importFiles(Array.from(files));
      setResult(res);
      setProcessing(false);
      if (res.imported.length > 0) {
        onImported(res.imported);
      }
    },
    [onImported],
  );

  if (!open) return null;

  const reset = () => {
    setResult(null);
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

        {!result ? (
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
                支持 .md .txt .json .csv .zip · PDF/Word/Excel 待后端解析
              </div>
            </div>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept=".md,.markdown,.txt,.text,.json,.csv,.tsv,.zip,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
              className="hidden"
              onChange={(e) => e.target.files && handleFiles(e.target.files)}
            />
            {processing && (
              <div className="mt-3 text-center text-xs text-faint">
                正在解析文件…
              </div>
            )}
          </div>
        ) : (
          <div className="p-4">
            <div className="space-y-3">
              <div className="rounded-lg bg-accent-soft px-3 py-2.5 text-sm text-accent">
                ✅ 成功导入 {result.imported.length} 篇文档
              </div>
              {result.imported.length > 0 && (
                <div className="max-h-40 overflow-y-auto rounded-lg border border-line">
                  {result.imported.map((d, i) => (
                    <div
                      key={i}
                      className="border-b border-line px-3 py-1.5 text-[13px] last:border-0"
                    >
                      {d.title}
                      <span className="ml-2 text-[11px] text-faint">
                        {d.ext}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {result.skipped.length > 0 && (
                <div>
                  <div className="mb-1 text-xs font-medium text-muted">
                    已跳过 {result.skipped.length} 个文件：
                  </div>
                  <div className="max-h-32 overflow-y-auto rounded-lg border border-line">
                    {result.skipped.map((s, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between border-b border-line px-3 py-1.5 text-[12px] last:border-0"
                      >
                        <span className="truncate">{s.name}</span>
                        <span className="ml-2 shrink-0 text-faint">{s.reason}</span>
                      </div>
                    ))}
                  </div>
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
                className="rounded-lg bg-accent px-4 py-2 text-sm text-white hover:bg-accent-hover"
              >
                完成
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
