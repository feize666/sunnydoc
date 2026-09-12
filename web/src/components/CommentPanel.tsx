"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  listComments,
  addComment,
  deleteComment,
  searchUsers,
  subscribeSSE,
  type DocComment,
  type UserBrief,
} from "@/lib/api";

function formatCommentTime(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.toDateString() === now.toDateString()) return hm;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

function Avatar({ name, avatar }: { name: string; avatar?: string | null }) {
  const text = avatar?.trim() || name.slice(0, 1);
  return (
    <span className="avatar-ring grid h-7 w-7 shrink-0 place-items-center rounded-full text-[13px] font-semibold">
      {text}
    </span>
  );
}

export function CommentPanel({
  docId,
  open,
  onClose,
  currentUserId,
  isAdmin,
  readOnly,
  initialQuote,
  onConsumedQuote,
}: {
  docId: string | null;
  open: boolean;
  onClose: () => void;
  currentUserId: string;
  isAdmin: boolean;
  readOnly?: boolean;
  initialQuote?: string | null;
  onConsumedQuote?: () => void;
}) {
  const [comments, setComments] = useState<DocComment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [quote, setQuote] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 回复目标（嵌套一层）
  const [replyTo, setReplyTo] = useState<{ id: string; nickname: string } | null>(null);

  // @ 提及
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionResults, setMentionResults] = useState<UserBrief[]>([]);
  const [mentions, setMentions] = useState<Record<string, string>>({});
  const mentionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!docId) return;
    if (!silent) setLoading(true);
    setError(null);
    try {
      setComments(await listComments(docId));
    } catch (e) {
      if (!silent) setError(e instanceof Error ? e.message : "加载评论失败");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [docId]);

  useEffect(() => {
    if (open && docId) load();
  }, [open, docId, load]);

  // 评论实时推送：面板打开时订阅该文档的评论事件（SSE，替代轮询）
  useEffect(() => {
    if (!open || !docId) return;
    const sub = subscribeSSE(`/events/comments/${docId}`, (event) => {
      if (event.type === "comment") load(true);
    });
    return () => sub.close();
  }, [open, docId, load]);

  useEffect(() => {
    if (open && initialQuote) {
      setQuote(initialQuote);
      onConsumedQuote?.();
    }
  }, [open, initialQuote, onConsumedQuote]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [comments.length, open]);

  // 检测 @ 提及
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setInput(value);
    const cursor = e.target.selectionStart ?? value.length;
    const before = value.slice(0, cursor);
    const atIdx = before.lastIndexOf("@");
    if (atIdx !== -1) {
      const after = before.slice(atIdx + 1);
      const prevChar = atIdx === 0 ? "" : before[atIdx - 1];
      if ((prevChar === "" || /\s/.test(prevChar)) && after && !/\s/.test(after)) {
        setMentionQuery(after);
        setMentionOpen(true);
        if (mentionTimer.current) clearTimeout(mentionTimer.current);
        mentionTimer.current = setTimeout(async () => {
          try {
            setMentionResults(await searchUsers(after));
          } catch {
            setMentionResults([]);
          }
        }, 150);
        return;
      }
    }
    setMentionOpen(false);
    setMentionQuery("");
  };

  const pickMention = (u: UserBrief) => {
    const cursor = textareaRef.current?.selectionStart ?? input.length;
    const before = input.slice(0, cursor);
    const atIdx = before.lastIndexOf("@");
    if (atIdx === -1) return;
    const beforeAt = before.slice(0, atIdx);
    const afterCursor = input.slice(cursor);
    setInput(`${beforeAt}@${u.nickname} ${afterCursor}`);
    setMentions((m) => ({ ...m, [u.id]: u.nickname || u.username }));
    setMentionOpen(false);
    setMentionQuery("");
    textareaRef.current?.focus();
  };

  const submit = async () => {
    const content = input.trim();
    if (!content || !docId || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const c = await addComment(docId, content, {
        quote: quote ?? undefined,
        parentId: replyTo?.id,
        mentions: Object.keys(mentions),
      });
      setComments((prev) => [...prev, c]);
      setInput("");
      setQuote(null);
      setReplyTo(null);
      setMentions({});
      setMentionOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "发布评论失败");
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (id: string) => {
    if (deletingId) return;
    setDeletingId(id);
    setError(null);
    try {
      await deleteComment(id);
      setComments((prev) => prev.filter((c) => c.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除评论失败");
    } finally {
      setDeletingId(null);
    }
  };

  if (!open) return null;

  const canComment = !readOnly;

  return (
    <aside className="fixed top-12 bottom-6 right-0 z-40 flex w-[340px] max-w-[92vw] flex-col border-l border-line bg-surface shadow-lg">
      <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3">
        <span className="text-[15px] font-semibold text-text">
          评论
          {comments.length > 0 && (
            <span className="ml-1.5 text-[13px] font-normal text-faint">{comments.length}</span>
          )}
        </span>
        <button
          onClick={onClose}
          className="grid h-7 w-7 place-items-center rounded-md text-faint transition-colors hover:bg-hover hover:text-text"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-3">
        {loading ? (
          <div className="py-8 text-center text-[13px] text-faint">加载中…</div>
        ) : comments.length === 0 ? (
          <div className="py-8 text-center text-[13px] text-faint">
            暂无评论{canComment ? "，来发表第一条吧" : ""}
          </div>
        ) : (
          <ul className="space-y-4">
            {comments.map((c) => {
              const isMine = c.user.id === currentUserId;
              const canDelete = isMine || isAdmin;
              const isReply = !!c.parent_id;
              return (
                <li key={c.id} className={`group ${isReply ? "ml-7" : ""}`}>
                  {c.quote && (
                    <div className="mb-1.5 rounded-md border-l-2 border-accent/50 bg-accent-soft px-2.5 py-1.5 text-[12px] leading-relaxed text-muted">
                      {c.quote}
                    </div>
                  )}
                  <div className="flex items-start gap-2">
                    <Avatar name={c.user.nickname} avatar={c.user.avatar} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-1.5">
                        <span className="truncate text-[13px] font-medium text-text">
                          {c.user.nickname}
                        </span>
                        {isReply && c.reply_to && (
                          <span className="shrink-0 text-[11px] text-faint">
                            回复 @{c.reply_to.nickname}
                          </span>
                        )}
                        <span className="shrink-0 text-[11px] text-faint">
                          {formatCommentTime(c.created_at)}
                        </span>
                      </div>
                      <p className="mt-0.5 whitespace-pre-wrap break-words text-[14px] leading-relaxed text-text">
                        {c.content}
                      </p>
                      <div className="mt-1 flex items-center gap-3 opacity-0 transition-opacity group-hover:opacity-100">
                        {canComment && (
                          <button
                            onClick={() =>
                              setReplyTo({ id: c.id, nickname: c.user.nickname })
                            }
                            className="text-[12px] text-faint hover:text-accent"
                          >
                            回复
                          </button>
                        )}
                        {canDelete && (
                          <button
                            onClick={() => remove(c.id)}
                            disabled={deletingId === c.id}
                            className="text-[12px] text-faint hover:text-danger disabled:opacity-40"
                          >
                            删除
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {error && <p className="mt-3 text-center text-[12px] text-danger">{error}</p>}
      </div>

      <div className="shrink-0 border-t border-line p-3">
        {quote && (
          <div className="mb-2 flex items-start gap-1.5 rounded-md border border-accent/30 bg-accent-soft px-2.5 py-1.5">
            <span className="min-w-0 flex-1 break-words text-[12px] leading-snug text-muted">
              {quote}
            </span>
            <button
              onClick={() => setQuote(null)}
              className="shrink-0 text-faint hover:text-text"
              title="取消引用"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
        {replyTo && (
          <div className="mb-2 flex items-center justify-between rounded-md bg-surface-2 px-2.5 py-1.5 text-[12px] text-muted">
            <span>
              回复 <span className="font-medium text-text">@{replyTo.nickname}</span>
            </span>
            <button
              onClick={() => setReplyTo(null)}
              className="text-faint hover:text-text"
              title="取消回复"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
        {canComment ? (
          <div className="relative">
            {mentionOpen && (
              <div className="absolute bottom-full left-0 right-0 z-10 mb-1 max-h-[180px] overflow-y-auto rounded-lg border border-line bg-background shadow-lg">
                {mentionResults.length === 0 ? (
                  <div className="px-3 py-2 text-[12px] text-faint">
                    {mentionQuery ? "无匹配用户" : "搜索成员…"}
                  </div>
                ) : (
                  mentionResults.map((u) => (
                    <button
                      key={u.id}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pickMention(u)}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-hover"
                    >
                      <Avatar name={u.nickname || u.username} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] text-text">
                          {u.nickname || u.username}
                        </span>
                        <span className="block truncate text-[11px] text-faint">
                          @{u.username}
                        </span>
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  submit();
                }
              }}
              rows={2}
              placeholder="写下评论…（输入 @ 提及成员，⌘+Enter 发送）"
              className="w-full resize-none rounded-lg border border-line bg-background px-3 py-2 text-[14px] leading-relaxed text-text outline-none placeholder:text-faint focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
            <div className="mt-2 flex justify-end">
              <button
                onClick={submit}
                disabled={submitting || !input.trim()}
                className="btn-accent rounded-lg px-3.5 py-1.5 text-[13px] font-medium text-white disabled:opacity-50"
              >
                {submitting ? "发布中…" : "发布"}
              </button>
            </div>
          </div>
        ) : (
          <p className="py-1 text-center text-[12px] text-faint">只读权限，无法评论</p>
        )}
      </div>
    </aside>
  );
}
