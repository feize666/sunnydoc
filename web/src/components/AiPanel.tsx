"use client";

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  SendIcon,
  LinkIcon,
  CopyIcon,
  CheckIcon,
  TrashIcon,
  PlusIcon,
  HistoryIcon,
} from "./icons";
import { renderMarkdown } from "@/lib/markdown";
import { handleCodeBlockCopy } from "./CodeBlock";
import { Tooltip } from "./Tooltip";
import { ConfirmDialog } from "./ConfirmDialog";
import { chatStream, type Citation, type ChatMessage, type WebSource } from "@/lib/api";
import {
  createSession,
  deriveTitle,
  loadCurrentId,
  loadSessions,
  saveCurrentId,
  saveSessions,
  uid,
  type ChatSession,
  type Message,
} from "@/lib/chatHistory";

const initialMessages: Message[] = [
  {
    role: "ai",
    content:
      "你好，我可以基于知识库文档回答，也能联网搜索实时信息。试试问我关于「部署」或「今天天气」相关的内容。",
  },
];

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const time = d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return time;
  return `${d.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })} ${time}`;
}

/** AI 回答正文：随流式内容增量异步渲染 markdown。 */
function AiMarkdown({
  content,
  theme,
}: {
  content: string;
  theme: "light" | "dark";
}) {
  const [html, setHtml] = useState("");
  const renderId = useRef(0);

  useEffect(() => {
    const id = ++renderId.current;
    let cancelled = false;
    renderMarkdown(content, undefined, theme).then((h) => {
      if (!cancelled && id === renderId.current) setHtml(h);
    });
    return () => {
      cancelled = true;
    };
  }, [content, theme]);

  return (
    <div
      className="md-body"
      onClick={handleCodeBlockCopy}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export function AiPanel({
  theme,
  open,
  onClose,
}: {
  theme: "light" | "dark";
  open: boolean;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [enableWeb, setEnableWeb] = useState(true);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  // 浮窗位置（null 表示用默认右下角定位）
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const panelRef = useRef<HTMLElement>(null);

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  const chatRef = useRef<HTMLDivElement>(null);
  const initedRef = useRef(false);
  const skipSyncRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 供 debounce 回调读取最新值，避免闭包过期
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const currentIdRef = useRef(currentId);
  currentIdRef.current = currentId;

  // 首次挂载：从 localStorage 恢复当前会话
  useEffect(() => {
    if (initedRef.current) return;
    initedRef.current = true;

    const loaded = loadSessions();
    const curId = loadCurrentId();
    const active = loaded.find((s) => s.id === curId) ?? loaded[0] ?? null;

    if (active) {
      sessionsRef.current = loaded;
      setSessions(loaded);
      currentIdRef.current = active.id;
      setCurrentId(active.id);
      saveCurrentId(active.id);
      skipSyncRef.current = true;
      setMessages([...initialMessages.map((m) => ({ ...m })), ...(active.messages ?? [])]);
    } else {
      const fresh = createSession();
      const list = [fresh];
      sessionsRef.current = list;
      setSessions(list);
      currentIdRef.current = fresh.id;
      setCurrentId(fresh.id);
      saveCurrentId(fresh.id);
      saveSessions(list);
      skipSyncRef.current = true;
      setMessages(initialMessages.map((m) => ({ ...m })));
    }
  }, []);

  // 立即把当前会话写回 state + localStorage（同步标题与更新时间）
  const flushSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const id = currentIdRef.current;
    if (!id) return;
    const real = messagesRef.current.slice(1);
    const list = sessionsRef.current;
    const idx = list.findIndex((s) => s.id === id);
    if (idx === -1) return;
    const next = [...list];
    next[idx] = {
      ...next[idx],
      messages: real,
      title: deriveTitle(real),
      updatedAt: Date.now(),
    };
    sessionsRef.current = next;
    setSessions(next);
    saveSessions(next);
  }, []);

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(flushSave, 300);
  }, [flushSave]);

  // messages 变化时 debounce 保存（跳过恢复/切换会话引起的首次变化）
  useEffect(() => {
    if (!initedRef.current || currentId == null) return;
    if (skipSyncRef.current) {
      skipSyncRef.current = false;
      return;
    }
    scheduleSave();
  }, [messages, currentId, scheduleSave]);

  // 组件卸载时立即落盘
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        flushSave();
      }
    };
  }, [flushSave]);

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight });
  }, [messages, loading]);

  // 从消息列表构建对话历史（排除第一条欢迎语，只取最近 8 条）
  const buildHistory = (msgs: Message[]): ChatMessage[] => {
    const real = msgs.slice(1).filter((m) => m.content && !m.error);
    return real.slice(-8).map((m) => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.content,
    }));
  };

  const copyMessage = async (index: number) => {
    const msg = messages[index];
    if (!msg || !msg.content) return;
    try {
      await navigator.clipboard.writeText(msg.content);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex((c) => (c === index ? null : c)), 2000);
    } catch {
      // 剪贴板不可用时静默降级
    }
  };

  const clearChat = () => {
    if (loading) return;
    setConfirmClear(true);
  };

  const doClearChat = () => {
    setMessages(initialMessages.map((m) => ({ ...m })));
    setCopiedIndex(null);
    setConfirmClear(false);
  };

  const switchSession = (id: string) => {
    setShowHistory(false);
    if (loading || id === currentId) return;
    const target = sessions.find((s) => s.id === id);
    if (!target) return;
    flushSave();
    skipSyncRef.current = true;
    currentIdRef.current = id;
    setCurrentId(id);
    saveCurrentId(id);
    setMessages([...initialMessages.map((m) => ({ ...m })), ...(target.messages ?? [])]);
    setCopiedIndex(null);
  };

  const newSession = () => {
    if (loading) return;
    flushSave();
    const cur = sessions.find((s) => s.id === currentId);
    let next: ChatSession[];
    let fresh: ChatSession;
    if (cur && cur.messages.length === 0) {
      // 当前会话为空：复用该条目，避免堆积空会话
      fresh = { ...cur, id: uid(), createdAt: Date.now(), updatedAt: Date.now() };
      next = sessions.map((s) => (s.id === cur.id ? fresh : s));
    } else {
      fresh = createSession();
      next = [fresh, ...sessions];
    }
    sessionsRef.current = next;
    setSessions(next);
    currentIdRef.current = fresh.id;
    setCurrentId(fresh.id);
    saveCurrentId(fresh.id);
    saveSessions(next);
    skipSyncRef.current = true;
    setMessages(initialMessages.map((m) => ({ ...m })));
    setCopiedIndex(null);
    setShowHistory(false);
  };

  const requestDelete = (id: string) => {
    if (loading && id === currentId) return;
    setDeleteTargetId(id);
  };

  const confirmDelete = () => {
    const id = deleteTargetId;
    setDeleteTargetId(null);
    if (!id) return;

    const remaining = sessions.filter((s) => s.id !== id);

    if (id === currentId) {
      if (remaining.length === 0) {
        const fresh = createSession();
        const list = [fresh];
        sessionsRef.current = list;
        setSessions(list);
        currentIdRef.current = fresh.id;
        setCurrentId(fresh.id);
        saveCurrentId(fresh.id);
        saveSessions(list);
        setMessages(initialMessages.map((m) => ({ ...m })));
      } else {
        const target = remaining.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a));
        sessionsRef.current = remaining;
        setSessions(remaining);
        currentIdRef.current = target.id;
        setCurrentId(target.id);
        saveCurrentId(target.id);
        saveSessions(remaining);
        setMessages([...initialMessages.map((m) => ({ ...m })), ...(target.messages ?? [])]);
      }
    } else {
      sessionsRef.current = remaining;
      setSessions(remaining);
      saveSessions(remaining);
    }
    setCopiedIndex(null);
  };

  const ask = async () => {
    const q = input.trim();
    if (!q || loading) return;
    setInput("");
    setLoading(true);

    // 先加用户消息，再加空的 AI 占位消息
    setMessages((m) => [...m, { role: "user", content: q }, { role: "ai", content: "" }]);
    const aiIndex = messages.length + 1; // user 在 index=len，ai 在 len+1

    const history = buildHistory(messages);

    const updateAi = (updater: (msg: Message) => Message) => {
      setMessages((m) => m.map((msg, i) => (i === aiIndex ? updater(msg) : msg)));
    };

    try {
      await chatStream(q, 5, history, enableWeb, (e) => {
        if (e.type === "citations") {
          updateAi((msg) => ({ ...msg, citations: e.citations ?? [] }));
        } else if (e.type === "sources") {
          updateAi((msg) => ({ ...msg, webSources: e.sources ?? [] }));
        } else if (e.type === "delta") {
          updateAi((msg) => ({ ...msg, content: msg.content + (e.content ?? "") }));
        }
      });
    } catch (e) {
      updateAi((msg) => ({
        ...msg,
        content: `请求失败：${e instanceof Error ? e.message : "未知错误"}，请确认后端服务已启动。`,
        error: true,
      }));
    } finally {
      setLoading(false);
    }
  };

  const sortedSessions = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);

  const startDrag = (e: ReactMouseEvent<HTMLElement>) => {
    // 仅左键拖动，且忽略 header 内按钮的点击
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    const rect = panelRef.current?.getBoundingClientRect();
    const baseX = pos?.x ?? rect?.left ?? 0;
    const baseY = pos?.y ?? rect?.top ?? 0;
    const offsetX = e.clientX - baseX;
    const offsetY = e.clientY - baseY;

    const onMove = (ev: MouseEvent) => {
      const x = Math.min(
        Math.max(0, ev.clientX - offsetX),
        window.innerWidth - 120,
      );
      const y = Math.min(
        Math.max(0, ev.clientY - offsetY),
        window.innerHeight - 48,
      );
      setPos({ x, y });
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  if (!open) return null;

  return (
    <aside
      ref={panelRef}
      style={pos ? { left: pos.x, top: pos.y } : { right: 24, bottom: 24 }}
      className="fixed z-50 flex h-[78vh] max-h-[820px] min-h-[480px] w-[460px] max-w-[92vw] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-glow"
    >
      <div
        className="relative z-30 flex cursor-move items-center justify-between gap-2 border-b border-line px-3 py-2.5 select-none"
        onMouseDown={startDrag}
      >
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-text">AI 问答</span>
          <Tooltip content={enableWeb ? "联网搜索已开启（点击关闭）" : "联网搜索已关闭（点击开启）"}>
            <button
              onClick={() => setEnableWeb((v) => !v)}
              className={`flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-medium transition-colors ${
                enableWeb
                  ? "border-accent/40 bg-accent-soft text-accent"
                  : "border-line bg-background text-faint"
              }`}
            >
              <span
                className={`relative inline-block h-3.5 w-6 shrink-0 rounded-full transition-colors ${
                  enableWeb ? "bg-accent" : "bg-line-strong"
                }`}
              >
                <span
                  className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white shadow-sm transition-all ${
                    enableWeb ? "left-3" : "left-0.5"
                  }`}
                />
              </span>
              {enableWeb ? "联网" : "离线"}
            </button>
          </Tooltip>
        </div>

        <div className="flex items-center gap-1">
          <Tooltip content="历史会话">
            <button
              onClick={() => setShowHistory((v) => !v)}
              className={`flex items-center gap-1 rounded-md px-2 py-1.5 text-xs transition-colors ${
                showHistory ? "bg-active text-accent" : "text-muted hover:bg-hover hover:text-text"
              }`}
            >
              <HistoryIcon size={14} />
              历史
            </button>
          </Tooltip>
          <Tooltip content="清空对话">
            <button
              onClick={clearChat}
              disabled={loading}
              className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-muted transition-colors hover:bg-danger-soft hover:text-danger disabled:cursor-not-allowed disabled:opacity-40"
            >
              <TrashIcon size={14} />
              清空
            </button>
          </Tooltip>
          <Tooltip content="关闭 AI 问答">
            <button
              onClick={onClose}
              className="grid h-7 w-7 place-items-center rounded-md border border-line text-faint transition-colors hover:bg-hover hover:text-text"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
          </Tooltip>
        </div>
      </div>

      {showHistory && (
        <>
          <div className="absolute inset-0 z-10" onClick={() => setShowHistory(false)} />
          <div className="absolute left-3 right-3 top-11 z-20 overflow-hidden rounded-xl border border-line bg-background shadow-lg">
            <div className="flex items-center justify-between border-b border-line px-3 py-2">
              <span className="text-[12px] font-semibold text-text">历史会话</span>
              <button
                onClick={newSession}
                disabled={loading}
                className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-accent transition-colors hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-40"
              >
                <PlusIcon size={12} />
                新建
              </button>
            </div>
            {sortedSessions.length === 0 ? (
              <div className="px-3 py-5 text-center text-[12px] text-faint">暂无历史会话</div>
            ) : (
              <ul className="max-h-[260px] overflow-y-auto p-1">
                {sortedSessions.map((s) => (
                  <li
                    key={s.id}
                    className={`group flex items-center gap-1 rounded-lg px-2 py-1.5 ${
                      s.id === currentId ? "bg-accent-soft" : "hover:bg-hover"
                    }`}
                  >
                    <button
                      onClick={() => switchSession(s.id)}
                      disabled={loading}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div
                        className={`truncate text-[13px] ${
                          s.id === currentId ? "text-accent" : "text-text"
                        }`}
                      >
                        {s.title}
                      </div>
                      <div className="text-[11px] text-faint">{formatTime(s.updatedAt)}</div>
                    </button>
                    <Tooltip content="删除会话" className="shrink-0">
                      <button
                        onClick={() => requestDelete(s.id)}
                        disabled={loading && s.id === currentId}
                        className="grid h-6 w-6 place-items-center rounded-md text-faint opacity-0 transition-opacity hover:bg-danger-soft hover:text-danger group-hover:opacity-100 disabled:opacity-0"
                      >
                        <TrashIcon size={12} />
                      </button>
                    </Tooltip>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      <div ref={chatRef} className="flex flex-1 flex-col gap-3 overflow-y-auto p-3.5">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`group flex flex-col gap-1 text-[13px] leading-relaxed ${
              msg.role === "user" ? "items-end" : ""
            }`}
          >
            {msg.role === "ai" && (
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-faint">知库助手</span>
                {msg.content && !msg.error && (
                  <Tooltip content={copiedIndex === i ? "已复制" : "复制回答"}>
                    <button
                      onClick={() => copyMessage(i)}
                      className={`flex items-center gap-0.5 rounded px-1 py-0.5 text-[11px] text-faint transition-opacity hover:text-muted ${
                        copiedIndex === i
                          ? "text-accent opacity-100"
                          : "opacity-0 group-hover:opacity-100"
                      }`}
                    >
                      {copiedIndex === i ? <CheckIcon size={11} /> : <CopyIcon size={11} />}
                      {copiedIndex === i ? "已复制" : "复制"}
                    </button>
                  </Tooltip>
                )}
              </div>
            )}
            <div
              className={
                msg.role === "user"
                  ? "bubble-accent max-w-[90%] rounded-xl rounded-br-sm px-3 py-2 text-white"
                  : `max-w-full rounded-xl rounded-bl-sm border px-3 py-2.5 ${
                      msg.error ? "border-danger/40 bg-danger-soft text-danger" : "border-line bg-background"
                    }`
              }
            >
              {msg.role === "user" ? (
                msg.content
              ) : (
                <AiMarkdown content={msg.content} theme={theme} />
              )}
              {Array.isArray(msg.citations) && msg.citations.length > 0 && (
                <div className="mt-1.5 space-y-0.5 border-t border-line pt-1.5 text-[11px]">
                  <div className="mb-0.5 text-[10px] text-faint">知识库引用</div>
                  {msg.citations.map((c, j) => (
                    <a
                      key={j}
                      href="#"
                      className="flex items-center gap-1 text-accent hover:underline"
                    >
                      <LinkIcon size={11} />
                      {c.title} · 片段 {c.segment_index + 1}
                    </a>
                  ))}
                </div>
              )}
              {Array.isArray(msg.webSources) && msg.webSources.length > 0 && (
                <div className="mt-1.5 space-y-0.5 border-t border-line pt-1.5 text-[11px]">
                  <div className="mb-0.5 text-[10px] text-faint">联网搜索来源</div>
                  {msg.webSources.map((s, j) => (
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
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex items-center gap-1.5 text-[12px] text-faint">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
            正在生成回答…
          </div>
        )}
      </div>

      <div className="flex gap-2 border-t border-line p-2.5">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              ask();
            }
          }}
          rows={1}
          placeholder="向知识库提问…（Enter 发送）"
          className="max-h-[120px] flex-1 resize-none rounded-lg border border-line bg-background px-3 py-2 text-[13px] outline-none placeholder:text-faint focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
        <Tooltip content="发送" className="shrink-0">
          <button
            onClick={ask}
            disabled={loading}
            className="btn-accent grid h-[38px] w-[38px] place-items-center rounded-lg text-white disabled:opacity-50"
          >
            <SendIcon size={16} />
          </button>
        </Tooltip>
      </div>

      <ConfirmDialog
        open={deleteTargetId !== null}
        title="删除会话"
        message="删除后该会话的对话记录将无法恢复，确定删除吗？"
        confirmText="删除"
        cancelText="取消"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTargetId(null)}
      />

      <ConfirmDialog
        open={confirmClear}
        title="清空对话"
        message="确定清空当前对话的全部内容吗？此操作不可恢复。"
        confirmText="清空"
        cancelText="取消"
        onConfirm={doClearChat}
        onCancel={() => setConfirmClear(false)}
      />
    </aside>
  );
}
