"use client";

import { type RefObject } from "react";
import { SendIcon, PaperclipIcon, ImportIcon, CloseIcon } from "../icons";
import { Tooltip } from "../Tooltip";
import { mediaUrl } from "@/lib/markdown";
import type { ChatAttachment } from "@/lib/api";

/**
 * AI 助理的输入区：待发送附件 chip + 上传按钮 + 输入框 + 发送/暂停。
 *
 * 从 `AiPanel` 抽出（原文件 1346 行）。**状态全部留在父组件** ——
 * 这个组件只接收值与回调，不持有任何 state，这样父组件的
 * 发送/中止/上传逻辑一行都不用改。
 */
function attachmentEmoji(kind: string): string {
  if (kind === "image") return "🖼";
  if (kind === "zip") return "📦";
  return "📄";
}

export function AiComposer({
  input,
  setInput,
  onSend,
  loading,
  onAbort,
  attachments,
  onRemoveAttachment,
  onOpenImport,
  importing,
  uploading,
  onPickFiles,
  fileInputRef,
  inputRef,
}: {
  input: string;
  setInput: (v: string) => void;
  onSend: () => void;
  loading: boolean;
  onAbort: () => void;
  attachments: ChatAttachment[];
  onRemoveAttachment: (id: string) => void;
  onOpenImport: (att: ChatAttachment) => void;
  importing: boolean;
  uploading: boolean;
  onPickFiles: (files: FileList | null) => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}) {
  return (
    <div className="border-t border-line p-2.5">
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5" data-ai-pending-attachments="1">
          {attachments.map((att) => (
            <span
              key={att.id}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-background px-2 py-1"
            >
              {att.kind === "image" && att.preview_url ? (
                <img
                  src={mediaUrl(att.preview_url)}
                  className="h-7 w-7 rounded object-cover"
                  alt={att.filename}
                />
              ) : (
                <span className="text-[14px] leading-none">{attachmentEmoji(att.kind)}</span>
              )}
              <span className="max-w-[140px] truncate text-[12px] text-text">{att.filename}</span>
              <Tooltip content="导入到知识库">
                <button
                  onClick={() => onOpenImport(att)}
                  disabled={importing}
                  className="grid h-5 w-5 place-items-center rounded text-faint transition-colors hover:text-accent disabled:opacity-40"
                >
                  <ImportIcon size={13} />
                </button>
              </Tooltip>
              <Tooltip content="移除附件">
                <button
                  onClick={() => onRemoveAttachment(att.id)}
                  className="grid h-5 w-5 place-items-center rounded text-faint transition-colors hover:text-danger"
                >
                  <CloseIcon size={13} />
                </button>
              </Tooltip>
            </span>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <Tooltip content="上传附件（图片/文档/压缩包）" className="shrink-0">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={loading || uploading}
            aria-label={uploading ? "正在上传附件" : "添加附件"}
            className="icon-btn border border-line bg-background text-muted disabled:opacity-50"
          >
            {uploading ? <span className="spinner spinner-sm" /> : <PaperclipIcon size={16} />}
          </button>
        </Tooltip>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={(e) => onPickFiles(e.target.files)}
          className="hidden"
          accept=".png,.jpg,.jpeg,.gif,.webp,.bmp,.md,.markdown,.txt,.text,.json,.csv,.tsv,.pdf,.docx,.xlsx,.zip"
        />
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          rows={1}
          placeholder="问点什么，或让我帮你改文档…"
          aria-label="输入问题"
          className="textarea max-h-[120px] min-h-0 flex-1 resize-none"
        />
        <Tooltip content={loading ? "暂停" : "发送"} className="shrink-0">
          <button
            onClick={() => (loading ? onAbort() : onSend())}
            aria-label={loading ? "暂停生成" : "发送"}
            className="btn-accent icon-btn text-white"
          >
            {loading ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            ) : (
              <SendIcon size={16} />
            )}
          </button>
        </Tooltip>
      </div>
    </div>
  );
}