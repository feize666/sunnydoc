"use client";

import { LinkIcon, CopyIcon, CheckIcon } from "../icons";
import { Tooltip } from "../Tooltip";
import { AiLogo } from "./AiLogo";
import { AiToolTrace } from "./AiToolTrace";
import { AiMarkdown } from "./AiMarkdown";
import { AttachmentBadge } from "./AttachmentBadge";
import { AI_NAME } from "./aiBrand";
import type { Citation, WebSource, PendingAction } from "@/lib/api";
import type { Message, MessageAttachment } from "@/lib/chatHistory";

/**
 * AI 消息的渲染。从 `AiPanel` 抽出（原文件 1346 行，渲染逻辑混在状态里）。
 *
 * ## 抽出的边界怎么划的
 *
 * 只搬「纯展示 + 局部回调」，**不搬状态**：`copiedIndex` 留在父组件
 * （复制成功的反馈是跨消息全局唯一的，只可能有一条消息显示「已复制」）。
 * 待确认操作（`pendings`）的执行也留在父组件 —— 它要 `setMessages`
 * 和 `onAgentDone` 联动刷新左侧树。
 *
 * 这里只负责：头像行、工具轨迹、气泡形态、引用、联网来源、Markdown。
 */
export function AiMessageBubble({
  msg,
  index,
  prevUserText,
  theme,
  copied,
  onCopy,
  onOpenCitation,
  onRetryWeb,
  onDismissWeb,
  onResolvePending,
}: {
  msg: Message;
  index: number;
  /** 上一条用户消息的文本（联网建议卡片要引用原问题）。 */
  prevUserText: string;
  theme: "light" | "dark";
  copied: boolean;
  onCopy: () => void;
  onOpenCitation?: (docId: string, citation: Citation) => void;
  onRetryWeb: (text: string) => void;
  onDismissWeb: () => void;
  onResolvePending: (action: PendingAction, kind: "confirm" | "cancel") => Promise<void>;
}) {
  const isUser = msg.role === "user";

  if (isUser) {
    return (
      <div className="group flex flex-col gap-1 text-[14px] leading-relaxed items-end">
        <div className="bubble-accent max-w-[90%] rounded-xl rounded-br-sm px-3 py-2 text-white">
          <div className="flex flex-col gap-1.5">
            <span>{msg.content}</span>
            {Array.isArray(msg.attachments) && msg.attachments.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {msg.attachments.map((att: MessageAttachment) => (
                  <AttachmentChip key={att.id} att={att} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex flex-col gap-1 text-[14px] leading-relaxed">
      <div className="flex items-center gap-1.5">
        <AiLogo variant="avatar" />
        <span className="text-[12px] font-medium text-text">{AI_NAME}</span>
        {msg.content && !msg.error && (
          <Tooltip content={copied ? "已复制" : "复制回答"}>
            <button
              onClick={onCopy}
              className={`flex items-center gap-0.5 rounded px-1 py-0.5 text-[12px] text-faint transition-opacity hover:text-muted ${
                copied ? "text-accent opacity-100" : "reveal-on-hover"
              }`}
            >
              {copied ? <CheckIcon size={11} /> : <CopyIcon size={11} />}
              {copied ? "已复制" : "复制"}
            </button>
          </Tooltip>
        )}
      </div>

      {(msg.toolTrace?.length ?? 0) > 0 && <AiToolTrace items={msg.toolTrace!} />}

      <div
        className={`max-w-full rounded-xl rounded-bl-sm border px-3 py-2.5 shadow-sm ${
          msg.error ? "border-danger/40 bg-danger-soft text-danger" : "border-line bg-background"
        }`}
      >
        {msg.suggestWeb ? (
          <div className="flex flex-col gap-2.5">
            <p className="text-text">
              本地知识库中<span className="font-medium text-text">未找到</span>与「
              {prevUserText}」相关的内容。
            </p>
            <p className="text-[13px] text-muted">
              我可以联网搜索实时信息来回答，是否为你联网搜索？
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onRetryWeb(prevUserText)}
                className="btn-accent flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium text-white"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
                联网搜索
              </button>
              <button
                type="button"
                onClick={onDismissWeb}
                className="rounded-lg border border-line px-3 py-1.5 text-[13px] text-muted transition-colors hover:bg-hover hover:text-text"
              >
                暂不
              </button>
            </div>
          </div>
        ) : (
          <AiMarkdown content={msg.content} theme={theme} />
        )}

        {Array.isArray(msg.citations) && msg.citations.length > 0 && (
          <CitationList citations={msg.citations} onOpen={onOpenCitation} />
        )}

        {Array.isArray(msg.pendings) &&
          msg.pendings.length > 0 &&
          msg.pendings.map((pa, j) => (
            <PendingCard
              key={j}
              action={pa}
              onResolve={(kind) => onResolvePending(pa, kind)}
            />
          ))}

        {Array.isArray(msg.webSources) && msg.webSources.length > 0 && (
          <WebSourceList sources={msg.webSources} />
        )}
      </div>
    </div>
  );
}

function AttachmentChip({ att }: { att: MessageAttachment }) {
  return <AttachmentBadge att={att} preview />;
}

function CitationList({
  citations,
  onOpen,
}: {
  citations: Citation[];
  onOpen?: (docId: string, citation: Citation) => void;
}) {
  return (
    <div className="mt-1.5 space-y-0.5 border-t border-line pt-1.5 text-[12px]">
      <div className="mb-0.5 text-[11px] text-faint">知识库引用（点击定位）</div>
      {citations.map((c, j) => (
        <button
          key={j}
          type="button"
          onClick={() => onOpen?.(c.doc_id, c)}
          className="flex w-full items-center gap-1 text-left text-accent hover:underline"
        >
          <LinkIcon size={11} />
          <span className="truncate">{c.title}</span>
          <span className="shrink-0 text-faint">· 片段 {c.segment_index + 1}</span>
        </button>
      ))}
    </div>
  );
}

function WebSourceList({ sources }: { sources: WebSource[] }) {
  return (
    <div className="mt-1.5 space-y-0.5 border-t border-line pt-1.5 text-[12px]">
      <div className="mb-0.5 text-[11px] text-faint">联网搜索来源</div>
      {sources.map((s, j) => (
        <a
          key={j}
          href={s.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 truncate text-accent hover:underline"
        >
          <LinkIcon size={11} />
          <Tooltip content={s.title} className="min-w-0 flex-1">
            <span className="block truncate">{s.title}</span>
          </Tooltip>
        </a>
      ))}
    </div>
  );
}

function PendingCard({
  action,
  onResolve,
}: {
  action: PendingAction;
  onResolve: (kind: "confirm" | "cancel") => Promise<void>;
}) {
  return (
    <div
      data-pending-card="1"
      className="mt-1.5 rounded-lg border border-danger/40 bg-danger-soft px-3 py-2.5"
    >
      <div className="flex items-start gap-1.5">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0 text-danger">
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          <path d="M12 9v4M12 17h.01" />
        </svg>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-danger">需要你确认</div>
          <div className="mt-0.5 text-[13px] text-text">{action.summary}</div>
          <div className="mt-0.5 text-[12px] text-muted">
            此操作尚未执行，点击下方按钮后才会生效。
          </div>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              disabled={action._busy}
              onClick={() => onResolve("confirm")}
              className="rounded-lg bg-danger-solid px-3 py-1.5 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {action._busy ? "执行中…" : "确认执行"}
            </button>
            <button
              type="button"
              disabled={action._busy}
              onClick={() => onResolve("cancel")}
              className="rounded-lg border border-line px-3 py-1.5 text-[13px] text-muted transition-colors hover:bg-hover hover:text-text disabled:opacity-50"
            >
              取消
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}