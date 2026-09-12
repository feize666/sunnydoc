import type { Citation, WebSource } from "./api";

export interface MessageAttachment {
  id: string;
  filename: string;
  kind: "image" | "doc" | "zip";
  size: number;
  preview_url?: string | null;
  vision?: boolean;
}

export interface Message {
  role: "user" | "ai";
  content: string;
  citations?: Citation[];
  webSources?: WebSource[];
  error?: boolean;
  /** 是否展示「本地未命中，是否联网搜索」的智能提示卡片 */
  suggestWeb?: boolean;
  /** 用户消息携带的附件 */
  attachments?: MessageAttachment[];
}

export interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

const SESSIONS_KEY = "sunnydoc_chat_sessions";
const CURRENT_KEY = "sunnydoc_chat_current";
const TITLE_MAX = 20;

export function uid(): string {
  if (
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.randomUUID === "function"
  ) {
    return globalThis.crypto.randomUUID();
  }
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function createSession(): ChatSession {
  const now = Date.now();
  return { id: uid(), title: "新对话", messages: [], createdAt: now, updatedAt: now };
}

/** 取第一条用户消息的前 N 个字符作为标题，无用户消息时返回「新对话」 */
export function deriveTitle(messages: Message[]): string {
  const first = messages.find((m) => m.role === "user" && m.content.trim());
  if (!first) return "新对话";
  const text = first.content.trim().replace(/\s+/g, " ");
  return text.length > TITLE_MAX ? `${text.slice(0, TITLE_MAX)}…` : text;
}

function isSession(value: unknown): value is ChatSession {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.title === "string" &&
    Array.isArray(o.messages) &&
    typeof o.createdAt === "number" &&
    typeof o.updatedAt === "number"
  );
}

function isMessage(value: unknown): value is Message {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  return (
    (o.role === "user" || o.role === "ai") &&
    typeof o.content === "string"
  );
}

export function loadSessions(): ChatSession[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isSession)
      .map((s) => ({ ...s, messages: s.messages.filter(isMessage) }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export function saveSessions(sessions: ChatSession[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  } catch {
    // 存储已满或隐私模式时静默降级
  }
}

export function loadCurrentId(): string | null {
  if (typeof localStorage === "undefined") return null;
  try {
    return localStorage.getItem(CURRENT_KEY);
  } catch {
    return null;
  }
}

export function saveCurrentId(id: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(CURRENT_KEY, id);
  } catch {
    // ignore
  }
}
