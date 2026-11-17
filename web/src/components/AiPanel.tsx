"use client";

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  LinkIcon,
  CopyIcon,
  CheckIcon,
  TrashIcon,
  PlusIcon,
  HistoryIcon,
  CloseIcon,
} from "./icons";
import { AiLogo } from "./ai/AiLogo";
import { AiEmptyState } from "./ai/AiEmptyState";
import { AiMessageBubble } from "./ai/AiMessageBubble";
import { AiComposer } from "./ai/AiComposer";
import { AI_NAME, AI_TAGLINE } from "./ai/aiBrand";
import { Tooltip } from "./Tooltip";
import { useToast } from "./Toast";
import { ConfirmDialog } from "./ConfirmDialog";
import { useResizable } from "@/hooks/useResizable";
import { copyText } from "@/lib/clipboard";
import { chatStream, agentConfirm, uploadChatAttachment, importChatAttachment, type Citation, type ChatMessage, type WebSource, type ChatAttachment, type Kb, type PendingAction } from "@/lib/api";
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
  type ToolTraceItem,
} from "@/lib/chatHistory";

/**
 * 智能体要求界面执行的动作（阶段 3 的 viewStack 由上层承接）。
 *
 * `view` 用联合类型（而非 string）：后端 `goto_view` 工具只允许这 5 个值，
 * 收窄成联合类型能让上层 `go([view])` 直接编译通过，
 * 也避免「后端加了新视图但前端没接」时静默走到空路径。
 */
export type AgentUiAction =
  | { kind: "open_document"; docId: string }
  | { kind: "goto_view"; view: "home" | "kb" | "settings" | "users" | "trash" };

const KNOWN_VIEWS = ["home", "kb", "settings", "users", "trash"] as const;

/** 类型守卫：把后端下发的 view 字符串收窄成联合类型。 */
function isKnownView(v: unknown): v is AgentUiAction extends { view: infer V } ? V : never {
  return typeof v === "string" && (KNOWN_VIEWS as readonly string[]).includes(v);
}

/**
 * 工具名 → 中文动作标签。
 *
 * ⚠️ **只用于展示**。不要在别处用工具名做判断分支（如「这个名字就要确认」）——
 * 分级判定以后端返回的 `level` 为准。这里写死中文名只是因为
 * 「正在调用 create_document…」对用户毫无意义。
 */
function toolLabel(name: string): string {
  const m: Record<string, string> = {
    search_documents: "搜索文档",
    get_document: "读取文档",
    list_documents: "列出文档",
    list_knowledge_bases: "列出知识库",
    list_folders: "列出文件夹",
    list_tags: "列出标签",
    get_document_versions: "查看历史版本",
    list_trash: "查看回收站",
    system_overview: "查看系统概览",
    create_document: "新建文档",
    update_document: "修改文档",
    move_document: "移动文档",
    set_document_tags: "设置标签",
    set_document_pinned: "置顶文档",
    create_folder: "新建文件夹",
    rename_folder: "重命名文件夹",
    create_knowledge_base: "新建知识库",
    list_users: "查看用户列表",
    update_user: "修改用户",
    get_ai_settings: "读取 AI 配置",
    delete_document: "删除文档",
    delete_folder: "删除文件夹",
    delete_knowledge_base: "删除知识库",
    purge_trash_item: "彻底删除",
    delete_user: "删除用户",
    restore_trash_item: "恢复内容",
    open_document: "打开文档",
    goto_view: "切换视图",
  };
  return m[name] ?? name;
}

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

export function AiPanel({
  theme,
  open,
  onClose,
  onOpenCitation,
  kbs,
  currentKbId,
  currentDocId,
  onAgentUi,
  onAgentDone,
}: {
  theme: "light" | "dark";
  open: boolean;
  onClose: () => void;
  /**
   * 点击引用：打开来源文档并定位高亮。
   *
   * 第二个参数是 `Citation`（不只是 snippet）—— 因为定位词应由后端下发
   * （`c.terms`，已清洗、必然可搜到），而不是前端从裸分片里拼
   * （实测那样只有 50% 能定位到）。传整个 citation 让上层自己取。
   */
  onOpenCitation?: (docId: string, citation: Citation) => void;
  kbs?: Kb[];
  /** 当前所在知识库 / 文档：作为智能体的上下文，让「这个知识库」有依据 */
  currentKbId?: string | null;
  currentDocId?: string | null;
  /** 智能体要求界面动作（打开文档 / 切换视图）时回调上层执行 */
  onAgentUi?: (action: AgentUiAction) => void;
  /** 智能体确认执行了破坏性操作后回调（让上层刷新文档树/列表） */
  onAgentDone?: () => void;
}) {
  const toast = useToast();
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
  // 输入框引用：能力卡点击后要聚焦（填了字但光标不在里面，用户会以为没反应）
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const chatRef = useRef<HTMLDivElement>(null);
  // 当前流式请求的 AbortController（用于暂停）
  const abortRef = useRef<AbortController | null>(null);
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
    const ok = await copyText(msg.content);
    if (ok) {
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex((c) => (c === index ? null : c)), 2000);
    }
  };

  const clearChat = () => {
    if (loading) return;
    setConfirmClear(true);
  };

  /**
   * 处置一条待确认的破坏性操作。
   *
   * 从原内联 JSX 抽出（原逻辑在 map 里套了 60 行闭包，读不动）。
   * 行为不变：
   *   - confirm：先标 busy 防重复点击 → 调 agentConfirm → 成功才移除卡片
   *     （失败时保留，用户可重试 —— 静默移除会让用户以为执行过了）
   *   - cancel：直接移除 + toast 说明「未做任何改动」
   */
  const resolvePending = async (
    msgIndex: number,
    pa: PendingAction,
    kind: "confirm" | "cancel",
  ) => {
    const patch = (fn: (p: PendingAction) => PendingAction | null) =>
      setMessages((all) =>
        all.map((mm, k) =>
          k === msgIndex
            ? {
                ...mm,
                pendings: (mm.pendings ?? [])
                  .map((x) => (x === pa ? fn(x) : x))
                  .filter((x): x is PendingAction => x !== null),
              }
            : mm,
        ),
      );

    if (kind === "cancel") {
      patch(() => null);
      toast.success("已取消，未做任何改动");
      return;
    }

    patch((x) => ({ ...x, _busy: true }));
    try {
      await agentConfirm(pa.tool, pa.arguments);
      toast.success(`已执行：${pa.summary}`);
      // 成功后才移除卡片 —— 失败时保留，用户可重试
      patch(() => null);
      onAgentDone?.();
    } catch (err) {
      toast.error(`执行失败：${err instanceof Error ? err.message : "未知错误"}`);
      patch((x) => ({ ...x, _busy: false }));
    }
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
    const controller = new AbortController();
    abortRef.current = controller;
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
      await chatStream(
        q,
        5,
        history,
        webEnabled,
        (e) => {
          if (e.type === "citations") {
            const hitsEmpty = e.hits_empty === true;
            const webAvailable = e.web_available === true;
            updateAi((msg) => ({ ...msg, citations: e.citations ?? [] }));
            // 本地未命中 + 未开联网 + 联网搜索可用 → 提示用户是否联网
            // 智能体开启时不做这个拦截：模型可以直接调用工具，或自行说明
            if (hitsEmpty && !webEnabled && webAvailable && !e.agent_enabled) {
              ignoreDelta = true;
              updateAi((msg) => ({ ...msg, suggestWeb: true, content: "" }));
            }
          } else if (e.type === "sources") {
            updateAi((msg) => ({ ...msg, webSources: e.sources ?? [] }));
          } else if (e.type === "delta") {
            if (!ignoreDelta) {
              updateAi((msg) => ({ ...msg, content: msg.content + (e.content ?? "") }));
            }
          } else if (e.type === "tool_call") {
            // 展示「它在做什么」——没有这个，用户面对的是几秒静默
            const item: ToolTraceItem = {
              name: e.name ?? "",
              level: e.level ?? "read",
              label: toolLabel(e.name ?? ""),
            };
            updateAi((msg) => ({
              ...msg,
              toolTrace: [...(msg.toolTrace ?? []), item],
            }));
          } else if (e.type === "tool_result") {
            updateAi((msg) => {
              const trace = [...(msg.toolTrace ?? [])];
              // 回填最后一次同名调用的结果
              for (let i = trace.length - 1; i >= 0; i--) {
                if (trace[i].name === e.name && trace[i].ok === undefined) {
                  trace[i] = { ...trace[i], ok: e.ok, error: e.error };
                  break;
                }
              }
              return { ...msg, toolTrace: trace };
            });
          } else if (e.type === "pending" && e.tool) {
            const pa: PendingAction = {
              tool: e.tool,
              arguments: (e.arguments as Record<string, unknown>) ?? {},
              summary: e.summary ?? toolLabel(e.tool),
            };
            updateAi((msg) => ({ ...msg, pendings: [...(msg.pendings ?? []), pa] }));
          } else if (e.type === "ui_action") {
            // 界面指令交给上层执行（打开文档 / 切换视图）。
            // 用白名单收窄：后端理论上只发这 5 个值，但前端不该依赖「理论上」——
            // 收到未知 view 时忽略比走到空路径更好（空路径 = 回首页，会让用户困惑）。
            if (e.ui_action === "open_document" && e.doc_id) {
              onAgentUi?.({ kind: "open_document", docId: e.doc_id });
            } else if (e.ui_action === "goto_view" && isKnownView(e.view)) {
              onAgentUi?.({ kind: "goto_view", view: e.view });
            }
          } else if (e.type === "error") {
            gotError = { status: e.status ?? 0, detail: e.detail ?? "" };
          }
        },
        sendIds,
        controller.signal,
        // 智能体上下文：让「这个知识库」等指代有依据
        { currentKbId, currentDocId },
      );
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        // 用户主动暂停：保留已生成内容；为空时给个提示
        updateAi((msg) => ({
          ...msg,
          content: msg.content || "（已停止生成）",
        }));
        abortRef.current = null;
        setLoading(false);
        return;
      }
      gotError = {
        status: 0,
        detail: e instanceof Error ? e.message : "未知错误",
      };
    }
    abortRef.current = null;
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
        toast.error(`附件「${file.name}」上传失败：${e instanceof Error ? e.message : "未知错误"}`);
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
          <AiLogo variant="title" />
          <span className="text-[14px] font-semibold text-text" title={AI_TAGLINE}>
            {AI_NAME}
          </span>
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
              className="btn-ghost text-accent hover:bg-accent-soft"
            >
              <PlusIcon size={14} />
              新建
            </button>
          </Tooltip>
          <Tooltip content="历史会话">
            <button
              onClick={() => setShowHistory((v) => !v)}
              className={`btn-ghost ${showHistory ? "bg-accent-soft text-accent" : "text-muted"}`}
            >
              <HistoryIcon size={14} />
              历史
            </button>
          </Tooltip>
          <Tooltip content={expanded ? "还原大小" : "扩大"}>
            <button
              onClick={() => setExpanded((v) => !v)}
              className="btn-ghost text-muted"
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
              className="btn-ghost text-muted hover:bg-danger-soft hover:text-danger"
            >
              <TrashIcon size={14} />
              清空
            </button>
          </Tooltip>
          <Tooltip content="关闭 AI 助理">
            <button
              onClick={onClose}
              className="icon-btn border border-line text-faint"
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
                        className="reveal-on-hover grid h-6 w-6 place-items-center rounded-md text-faint hover:bg-danger-soft hover:text-danger disabled:opacity-0"
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
          <AiEmptyState
            logo={<AiLogo variant="hero" />}
            onPick={(text) => {
              // 只填入输入框，不直接发送 —— 用户通常想改一改（换成自己的文档名）
              setInput(text);
              inputRef.current?.focus();
            }}
          />
        )}
        {messages.map((msg, i) => (
          <AiMessageBubble
            key={i}
            msg={msg}
            index={i}
            prevUserText={messages[i - 1]?.content ?? ""}
            theme={theme}
            copied={copiedIndex === i}
            onCopy={() => copyMessage(i)}
            onOpenCitation={onOpenCitation}
            onRetryWeb={retryWithWeb}
            onDismissWeb={() =>
              setMessages((all) =>
                all.map((mm) =>
                  mm === msg
                    ? {
                        ...mm,
                        suggestWeb: false,
                        content: "已取消联网搜索。你可以换个问法，或补充相关文档后再试。",
                      }
                    : mm,
                ),
              )
            }
            onResolvePending={(pa, kind) => resolvePending(i, pa, kind)}
          />
        ))}
        {loading && (
          <div className="flex items-center gap-2 text-[13px] text-faint">
            <span className="typing-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            正在生成回答…
          </div>
        )}
      </div>

      <AiComposer
        input={input}
        setInput={setInput}
        onSend={ask}
        loading={loading}
        onAbort={() => abortRef.current?.abort()}
        attachments={attachments}
        onRemoveAttachment={removeAttachment}
        onOpenImport={openImport}
        importing={importing}
        uploading={uploading}
        onPickFiles={handlePickFiles}
        fileInputRef={fileInputRef}
        inputRef={inputRef}
      />

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
                        {(kb.name || "S").slice(0, 1)}
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
