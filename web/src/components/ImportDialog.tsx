"use client";

import { useState, useRef, useCallback } from "react";
import { importDocument } from "@/lib/api";
import { CloseIcon } from "./icons";

interface ImportResult {
  success: string[];
  failed: { name: string; reason: string }[];
}

export function ImportDialog({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      if (files.length === 0) return;
      setProcessing(true);
      setResult(null);

      const success: string[] = [];
      const failed: { name: string; reason: string }[] = [];

      for (const file of Array.from(files)) {
        try {
          const res = await importDocument(file);
          success.push(...res.documents.map((d) => d.title));
        } catch (e) {
          failed.push({
            name: file.name,
            reason: e instanceof Error ? e.message : "上传失败",
          });
        }
      }

      setResult({ success, failed });
      setProcessing(false);
      if (success.length > 0) onImported();
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
                支持 .md .txt .json .csv .zip .pdf .docx .xlsx
              </div>
            </div>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept=".md,.markdown,.txt,.text,.json,.csv,.tsv,.zip,.pdf,.doc,.docx,.xls,.xlsx"
              className="hidden"
              onChange={(e) => e.target.files && handleFiles(e.target.files)}
            />
            {processing && (
              <div className="mt-3 text-center text-xs text-faint">
                正在上传并解析文件…
              </div>
            )}
          </div>
        ) : (
          <div className="p-4">
            <div className="space-y-3">
              <div className="rounded-lg bg-accent-soft px-3 py-2.5 text-sm text-accent">
                成功导入 {result.success.length} 篇文档
              </div>
              {result.success.length > 0 && (
                <div className="max-h-40 overflow-y-auto rounded-lg border border-line">
                  {result.success.map((t, i) => (
                    <div
                      key={i}
                      className="border-b border-line px-3 py-1.5 text-[13px] last:border-0"
                    >
                      {t}
                    </div>
                  ))}
                </div>
              )}
              {result.failed.length > 0 && (
                <div>
                  <div className="mb-1 text-xs font-medium text-muted">
                    导入失败 {result.failed.length} 个文件：
                  </div>
                  <div className="max-h-32 overflow-y-auto rounded-lg border border-line">
                    {result.failed.map((f, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between border-b border-line px-3 py-1.5 text-[12px] last:border-0"
                      >
                        <span className="truncate">{f.name}</span>
                        <span className="ml-2 shrink-0 text-faint">{f.reason}</span>
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
