"use client";

import { mediaUrl } from "@/lib/markdown";

/**
 * 单条附件展示（图片缩略图 / 文件图标 + 文件名 + 大小）。
 *
 * 从 `AiPanel` 抽出，供消息气泡与待发送 chip 共用。
 * 注意 `preview` 只对图片且**有 `preview_url`** 时生效 ——
 * 上传失败或非图片时退回 emoji 图标，不会出现空 img。
 */
function formatSize(bytes: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function attachmentEmoji(kind: string): string {
  if (kind === "image") return "🖼";
  if (kind === "zip") return "📦";
  return "📄";
}

export function AttachmentBadge({
  att,
  preview,
}: {
  att: { filename: string; kind: string; size: number; preview_url?: string | null };
  preview?: boolean;
}) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-lg bg-[var(--hero-chip)] px-2 py-1">
      {att.kind === "image" && preview && att.preview_url ? (
        <img
          src={mediaUrl(att.preview_url)}
          alt={att.filename}
          className="h-8 w-8 shrink-0 rounded object-cover"
        />
      ) : (
        <span className="text-[14px] leading-none">{attachmentEmoji(att.kind)}</span>
      )}
      <span className="min-w-0">
        <span className="block max-w-[200px] truncate text-[12px] font-medium">{att.filename}</span>
        <span className="block text-[11px] opacity-90">{formatSize(att.size)}</span>
      </span>
    </span>
  );
}