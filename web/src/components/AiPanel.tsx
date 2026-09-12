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
  PaperclipIcon,
  ImportIcon,
  CloseIcon,
} from "./icons";
import { renderMarkdown } from "@/lib/markdown";
import { handleCodeBlockCopy } from "./CodeBlock";
import { Tooltip } from "./Tooltip";
import { ConfirmDialog } from "./ConfirmDialog";
import { useResizable } from "@/hooks/useResizable";
import { chatStream, uploadChatAttachment, importChatAttachment, type Citation, type ChatMessage, type WebSource, type ChatAttachment, type Kb } from "@/lib/api";
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
  type MessageAttachment,
} from "@/lib/chatHistory";

const initialMessages: Message[] = [];

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const time = d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return time;
  return `${d.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })} ${time}`;
}

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

/** 单条附件展示（含图片缩略图/文件图标 + 文件名 + 大小） */
function AttachmentBadge({ att, preview }: { att: { filename: string; kind: string; size: number; preview_url?: string | null }; preview?: boolean }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-lg bg-white/20 px-2 py-1">
      {att.kind === "image" && preview && att.preview_url ? (
        <img src={att.preview_url} alt={att.filename} className="h-8 w-8 shrink-0 rounded object-cover" />
      ) : (
        <span className="text-[14px] leading-none">{attachmentEmoji(att.kind)}</span>
      )}
      <span className="min-w-0">
        <span className="block max-w-[200px] truncate text-[12px] font-medium">{att.filename}</span>
        <span className="block text-[10px] opacity-70">{formatSize(att.size)}</span>
      </span>
    </span>
  );
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
  onOpenCitation,
  kbs,
}: {
  theme: "light" | "dark";
  open: boolean;
  onClose: () => void;
  onOpenCitation?: (docId: string, snippet: string) => void;
  kbs?: Kb[];
}) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [enableWeb, setEnableWeb] = useState(true);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  // 浮窗位置（null 表示用默认右下角定位）
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  // 扩大/缩小（扩大时面板占据更大的区域）
  const [expanded, setExpanded] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const { width: panelWidth, onMouseDown: onPanelResize } = useResizable(460, 380, 720, "ai_panel_width", -1);

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  // 附件相关
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [importTarget, setImportTarget] = useState<{ atts: ChatAttachment[]; kbs: Kb[] } | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // 从消息列表构建对话历史（只取最近 8 条有效消息）
  const buildHistory = (msgs: Message[]): ChatMessage[] => {
    const real = msgs.filter((m) => m.content && !m.error);
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

  const ask = async (questionOverride?: string, forceWeb?: boolean) => {
    const q = (questionOverride ?? input).trim();
    if (!q || loading) return;

    // AI 指令导入：消息含「导入」意图且有待发送附件 → 打开导入对话框（而非问答）
    if (
      !questionOverride &&
      attachments.length > 0 &&
      /导入|入库|收进/.test(q) &&
      /附件|文件|这个|这些|文档|图片|压缩包|它们|它|全部/.test(q)
    ) {
      setInput("");
      openImportAll();
      return;
    }

    if (!questionOverride) setInput("");
    setLoading(true);
    const webEnabled = forceWeb ?? enableWeb;

    // 本次发送携带的附件（元数据 + id）
    const sendAtts: MessageAttachment[] = attachments.map((a) => ({
      id: a.id,
      filename: a.filename,
      kind: a.kind,
      size: a.size,
      preview_url: a.preview_url,
      vision: a.vision,
    }));
    const sendIds = sendAtts.map((a) => a.id);

    // 先加用户消息（带附件），再加空的 AI 占位消息
    setMessages((m) => [...m, { role: "user", content: q, attachments: sendAtts }, { role: "ai", content: "" }]);
    const aiIndex = messages.length + 1; // user 在 index=len，ai 在 len+1

    const history = buildHistory(messages);

    // 发送后清空待发送附件
    setAttachments([]);

    const updateAi = (updater: (msg: Message) => Message) => {
      setMessages((m) => m.map((msg, i) => (i === aiIndex ? updater(msg) : msg)));
    };

    let gotError: { status: number; detail: string } | null = null;
    // 本次请求是否命中本地知识库；命中为空且未开联网时，前端智能提示「是否联网搜索」
    let ignoreDelta = false;
    try {
      await chatStream(q, 5, history, webEnabled, (e) => {
        if (e.type === "citations") {
          const hitsEmpty = e.hits_empty === true;
          const webAvailable = e.web_available === true;
          updateAi((msg) => ({ ...msg, citations: e.citations ?? [] }));
          // 本地未命中 + 未开联网 + 联网搜索可用 → 提示用户是否联网
          if (hitsEmpty && !webEnabled && webAvailable) {
            ignoreDelta = true;
            updateAi((msg) => ({ ...msg, suggestWeb: true, content: "" }));
          }
        } else if (e.type === "sources") {
          updateAi((msg) => ({ ...msg, webSources: e.sources ?? [] }));
        } else if (e.type === "delta") {
          if (!ignoreDelta) {
            updateAi((msg) => ({ ...msg, content: msg.content + (e.content ?? "") }));
          }
        } else if (e.type === "error") {
          gotError = { status: e.status ?? 0, detail: e.detail ?? "" };
        }
      }, sendIds);
    } catch (e) {
      gotError = {
        status: 0,
        detail: e instanceof Error ? e.message : "未知错误",
      };
    }
    if (gotError) {
      const tip =
        gotError.status === 0
          ? "请确认后端服务已启动"
          : gotError.status === 401
            ? "请检查 API Key 是否正确或已过期"
            : gotError.status === 403
              ? "API Key 无访问权限"
              : gotError.status === 404
                ? "Base URL 或模型名不存在"
                : gotError.status === 429
                  ? "请求频率超限，稍后重试"
                  : "请检查后端日志";
      updateAi((msg) => ({
        ...msg,
        content: `请求失败（${gotError!.status}）${gotError!.detail ? `：${gotError!.detail}` : ""}\n\n${tip}`,
        error: true,
        suggestWeb: false,
      }));
    }
    setLoading(false);
  };

  // 用户点击「联网搜索」按钮：开启联网并重发该问题
  const retryWithWeb = (question: string) => {
    if (!question.trim() || loading) return;
    setEnableWeb(true);
    // 删除上一条 suggestWeb 占位消息，重新提问
    setMessages((m) => {
      const next = [...m];
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].role === "ai" && next[i].suggestWeb) {
          next.splice(i, 1);
          break;
        }
      }
      return next;
    });
    // 直接以指定问题重发（强制开启联网，绕过 enableWeb 闭包旧值）
    setTimeout(() => ask(question, true), 0);
  };

  // 选择文件并上传为对话附件
  const handlePickFiles = async (files: FileList | null) => {
    if (!files || files.length === 0 || loading) return;
    setUploading(true);
    const next = [...attachments];
    for (const file of Array.from(files)) {
      try {
        next.push(await uploadChatAttachment(file));
      } catch (e) {
        alert(`附件「${file.name}」上传失败：${e instanceof Error ? e.message : "未知错误"}`);
      }
    }
    setAttachments(next);
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeAttachment = (id: string) => {
    setAttachments((a) => a.filter((x) => x.id !== id));
  };

  // 打开导入对话框（单个附件按钮）
  const openImport = (att: ChatAttachment) => {
    setImportTarget({ atts: [att], kbs: kbs ?? [] });
  };

  // 打开导入对话框（AI 指令：导入全部待发送附件）
  const openImportAll = () => {
    if (attachments.length === 0) return;
    setImportTarget({ atts: [...attachments], kbs: kbs ?? [] });
  };

  // 执行导入
  const doImport = async (kbId: string | null) => {
    if (!importTarget || importTarget.atts.length === 0) return;
    const names = importTarget.atts.map((a) => a.filename).join("、");
    setImporting(true);
    setImportResult(null);
    try {
      for (const att of importTarget.atts) {
        await importChatAttachment(att.id, kbId);
      }
      setImportResult(`附件「${names}」已提交导入${kbId ? "到目标知识库" : ""}，后台解析入库中。`);
      setAttachments((a) => a.filter((x) => !importTarget.atts.some((t) => t.id === x.id)));
    } catch (e) {
      setImportResult(`导入失败：${e instanceof Error ? e.message : "未知错误"}`);
    } finally {
      setImporting(false);
      setImportTarget(null);
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
      style={
        expanded
          ? { right: 16, top: 16, width: "min(1000px, 94vw)" }
          : pos
            ? { left: pos.x, top: pos.y, width: panelWidth }
            : { right: 24, bottom: 24, width: panelWidth }
      }
      className={`fixed z-50 flex flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-lg ${
        expanded ? "h-[92vh] max-h-[92vh]" : "h-[78vh] max-h-[820px] min-h-[480px]"
      } max-w-[94vw]`}
    >
      <div
        onMouseDown={onPanelResize}
        className="absolute -left-1 top-0 z-30 h-full w-2 cursor-col-resize transition-colors hover:bg-accent/25"
      />
      <div
        className="relative z-30 flex cursor-move items-center justify-between gap-2 border-b border-line px-3 py-2.5 select-none"
        onMouseDown={startDrag}
      >
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-semibold text-text">AI 问答</span>
          <Tooltip content={enableWeb ? "联网搜索已开启（点击关闭）" : "联网搜索已关闭（点击开启）"}>
            <button
              onClick={() => setEnableWeb((v) => !v)}
              className={`flex items-center gap-1.5 rounded-full border px-2 py-1 text-[12px] font-medium transition-colors ${
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
          <Tooltip content="新建会话">
            <button
              onClick={newSession}
              disabled={loading}
              className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-accent transition-colors hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-40"
            >
              <PlusIcon size={14} />
              新建
            </button>
          </Tooltip>
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
          <Tooltip content={expanded ? "还原大小" : "扩大"}>
            <button
              onClick={() => setExpanded((v) => !v)}
              className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-muted transition-colors hover:bg-hover hover:text-text"
            >
              {expanded ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" />
                </svg>
              )}
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
              <span className="text-[13px] font-semibold text-text">历史会话</span>
            </div>
            {sortedSessions.length === 0 ? (
              <div className="px-3 py-5 text-center text-[13px] text-faint">暂无历史会话</div>
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
                        className={`truncate text-[14px] ${
                          s.id === currentId ? "text-accent" : "text-text"
                        }`}
                      >
                        {s.title}
                      </div>
                      <div className="text-[12px] text-faint">{formatTime(s.updatedAt)}</div>
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
        {messages.length === 0 && !loading && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-accent-soft text-accent">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <div className="text-[14px] font-medium text-text">开始新的对话</div>
            <div className="text-[12px] text-faint">
              基于知识库问答，或上传附件后提问
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`group flex flex-col gap-1 text-[14px] leading-relaxed ${
              msg.role === "user" ? "items-end" : ""
            }`}
          >
            {msg.role === "ai" && (
              <div className="flex items-center gap-1.5">
                <span className="text-[12px] text-faint">知库助手</span>
                {msg.content && !msg.error && (
                  <Tooltip content={copiedIndex === i ? "已复制" : "复制回答"}>
                    <button
                      onClick={() => copyMessage(i)}
                      className={`flex items-center gap-0.5 rounded px-1 py-0.5 text-[12px] text-faint transition-opacity hover:text-muted ${
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
                <div className="flex flex-col gap-1.5">
                  <span>{msg.content}</span>
                  {Array.isArray(msg.attachments) && msg.attachments.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {msg.attachments.map((att) => (
                        <AttachmentBadge key={att.id} att={att} preview />
                      ))}
                    </div>
                  )}
                </div>
              ) : msg.suggestWeb ? (
                <div className="flex flex-col gap-2.5">
                  <p className="text-text">
                    本地知识库中<span className="font-medium text-text">未找到</span>与「{messages[i - 1]?.content ?? ""}」相关的内容。
                  </p>
                  <p className="text-[13px] text-muted">我可以联网搜索实时信息来回答，是否为你联网搜索？</p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => retryWithWeb(messages[i - 1]?.content ?? "")}
                      className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white transition-opacity hover:opacity-90"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                      </svg>
                      联网搜索
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        // 用户拒绝：移除提示卡片，改为普通提示
                        setMessages((m) =>
                          m.map((mm) =>
                            mm === msg ? { ...mm, suggestWeb: false, content: "已取消联网搜索。你可以换个问法，或补充相关文档后再试。" } : mm,
                          ),
                        );
                      }}
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
                <div className="mt-1.5 space-y-0.5 border-t border-line pt-1.5 text-[12px]">
                  <div className="mb-0.5 text-[10px] text-faint">知识库引用（点击定位）</div>
                  {msg.citations.map((c, j) => (
                    <button
                      key={j}
                      type="button"
                      onClick={() => onOpenCitation?.(c.doc_id, c.snippet)}
                      className="flex w-full items-center gap-1 text-left text-accent hover:underline"
                    >
                      <LinkIcon size={11} />
                      <span className="truncate">{c.title}</span>
                      <span className="shrink-0 text-faint">· 片段 {c.segment_index + 1}</span>
                    </button>
                  ))}
                </div>
              )}
              {Array.isArray(msg.webSources) && msg.webSources.length > 0 && (
                <div className="mt-1.5 space-y-0.5 border-t border-line pt-1.5 text-[12px]">
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
          <div className="flex items-center gap-1.5 text-[13px] text-faint">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
            正在生成回答…
          </div>
        )}
      </div>

      <div className="border-t border-line p-2.5">
        {/* 待发送附件 chip 列表 */}
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {attachments.map((att) => (
              <span
                key={att.id}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-background px-2 py-1"
              >
                {att.kind === "image" && att.preview_url ? (
                  <img src={att.preview_url} className="h-7 w-7 rounded object-cover" alt={att.filename} />
                ) : (
                  <span className="text-[14px] leading-none">{attachmentEmoji(att.kind)}</span>
                )}
                <span className="max-w-[140px] truncate text-[12px] text-text">{att.filename}</span>
                <Tooltip content="导入到知识库">
                  <button
                    onClick={() => openImport(att)}
                    disabled={importing}
                    className="grid h-5 w-5 place-items-center rounded text-faint transition-colors hover:text-accent disabled:opacity-40"
                  >
                    <ImportIcon size={13} />
                  </button>
                </Tooltip>
                <Tooltip content="移除附件">
                  <button
                    onClick={() => removeAttachment(att.id)}
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
              className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-lg border border-line bg-background text-muted transition-colors hover:bg-hover hover:text-text disabled:opacity-50"
            >
              {uploading ? (
                <span className="animate-pulse text-[12px] leading-none">…</span>
              ) : (
                <PaperclipIcon size={16} />
              )}
            </button>
          </Tooltip>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={(e) => handlePickFiles(e.target.files)}
            className="hidden"
            accept=".png,.jpg,.jpeg,.gif,.webp,.bmp,.md,.markdown,.txt,.text,.json,.csv,.tsv,.pdf,.docx,.xlsx,.zip"
          />
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
            placeholder="向知识库提问，或上传附件后提问 / 说「导入」…（Enter 发送）"
            className="max-h-[120px] flex-1 resize-none rounded-lg border border-line bg-background px-3 py-2 text-[14px] outline-none placeholder:text-faint focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
          <Tooltip content="发送" className="shrink-0">
            <button
              onClick={() => ask()}
              disabled={loading}
              className="btn-accent grid h-[38px] w-[38px] shrink-0 place-items-center rounded-lg text-white disabled:opacity-50"
            >
              <SendIcon size={16} />
            </button>
          </Tooltip>
        </div>
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

      {/* 导入到知识库对话框 */}
      {importTarget && (
        <>
          <div className="fixed inset-0 z-[60] bg-black/30" onClick={() => !importing && setImportTarget(null)} />
          <div className="fixed left-1/2 top-1/2 z-[61] w-[420px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-line bg-background shadow-xl">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <span className="text-[14px] font-semibold text-text">导入到知识库</span>
              <button
                onClick={() => !importing && setImportTarget(null)}
                className="grid h-6 w-6 place-items-center rounded text-faint hover:bg-hover hover:text-text"
              >
                <CloseIcon size={14} />
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto px-4 py-3">
              <div className="mb-2 text-[12px] text-muted">将导入以下附件：</div>
              <div className="mb-3 flex flex-wrap gap-1.5">
                {importTarget.atts.map((att) => (
                  <span
                    key={att.id}
                    className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[12px] text-text"
                  >
                    <span>{attachmentEmoji(att.kind)}</span>
                    {att.filename}
                  </span>
                ))}
              </div>
              <div className="mb-1.5 text-[12px] text-muted">选择目标知识库：</div>
              <div className="space-y-1">
                <button
                  onClick={() => doImport(null)}
                  disabled={importing}
                  className="flex w-full items-center gap-2 rounded-lg border border-line px-3 py-2 text-left text-[13px] text-text transition-colors hover:bg-hover disabled:opacity-50"
                >
                  默认（不指定知识库）
                </button>
                {(importTarget.kbs || [])
                  .filter((k) => k.permission !== "read")
                  .map((kb) => (
                    <button
                      key={kb.id}
                      onClick={() => doImport(kb.id)}
                      disabled={importing}
                      className="flex w-full items-center gap-2 rounded-lg border border-line px-3 py-2 text-left text-[13px] text-text transition-colors hover:bg-hover disabled:opacity-50"
                    >
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded bg-accent-soft text-[12px] font-semibold text-accent">
                        {(kb.name || "知").slice(0, 1)}
                      </span>
                      <span className="truncate">{kb.name}</span>
                    </button>
                  ))}
              </div>
              {importResult && (
                <div className="mt-3 rounded-md border border-accent/30 bg-accent-soft px-3 py-2 text-[12px] text-text">
                  {importResult}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-line px-4 py-2.5">
              <button
                onClick={() => !importing && setImportTarget(null)}
                disabled={importing}
                className="btn btn-secondary btn-sm"
              >
                {importResult ? "完成" : "取消"}
              </button>
            </div>
          </div>
        </>
      )}
    </aside>
  );
}
