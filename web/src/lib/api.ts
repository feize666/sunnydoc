// 后端 API 客户端
// 生产环境：静态导出 + nginx 同域反代 /api/ → 用相对路径
// 本地开发：可设置 NEXT_PUBLIC_API_BASE=http://localhost:8000/api/v1

const BASE = process.env.NEXT_PUBLIC_API_BASE || "/api/v1";

export interface DocMeta {
  id: string;
  title: string;
  source: string;
  ext: string;
  created_at: number;
  folder_id?: string | null;
  kb_id?: string | null;
  is_favorite?: boolean;
  pinned?: boolean;
  tags?: string[];
  summary?: string | null;
  sort_order?: number | null;
  type?: string;
}

export interface Kb {
  id: string;
  name: string;
  description?: string;
  created_at?: number;
  doc_count?: number;
  permission?: "owner" | "read" | "write";
  owner_id?: string;
}

export interface RecentDoc {
  doc_id: string;
  kb_id: string | null;
  title: string;
  source?: string;
  viewed_at: number;
}

export interface Folder {
  id: string;
  name: string;
  parent_id: string | null;
  created_at?: number;
  sort_order?: number | null;
}

export interface DocDetail extends DocMeta {
  text: string;
  is_favorite?: boolean;
}

export interface Citation {
  doc_id: string;
  title: string;
  source: string;
  segment_index: number;
  snippet: string;
}

export interface ChatResponse {
  answer: string;
  citations: Citation[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // 自动携带登录态（有 token 时附加 Authorization 头）
  const headers = new Headers(init?.headers);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    let detail = `请求失败（${res.status}）`;
    try {
      const body = await res.json();
      if (body.detail) detail = body.detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export async function listDocuments(kbId?: string | null): Promise<DocMeta[]> {
  const qs = kbId ? `?kb_id=${encodeURIComponent(kbId)}` : "";
  const data = await request<{ total: number; documents: DocMeta[] }>(
    `/documents${qs}`,
  );
  return Array.isArray(data?.documents) ? data.documents : [];
}

export interface SearchResult {
  doc_id: string;
  title: string;
  snippet: string;
  match_in_title: boolean;
  folder_id?: string | null;
  kb_id?: string | null;
  source?: string;
  type?: string;
  tags?: string[];
  created_at?: number;
}

export async function searchDocuments(
  q: string,
  kbId?: string | null,
  type?: string | null,
  tag?: string | null,
  sort?: string | null,
): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q });
  if (kbId) params.set("kb_id", kbId);
  if (type) params.set("type", type);
  if (tag) params.set("tag", tag);
  if (sort) params.set("sort", sort);
  const data = await request<{ total: number; results: SearchResult[] }>(
    `/search?${params.toString()}`,
  );
  return Array.isArray(data?.results) ? data.results : [];
}

export async function listFolders(kbId?: string | null): Promise<Folder[]> {
  const qs = kbId ? `?kb_id=${encodeURIComponent(kbId)}` : "";
  const data = await request<unknown>(`/folders${qs}`);
  if (Array.isArray(data)) return data as Folder[];
  if (
    data &&
    typeof data === "object" &&
    Array.isArray((data as { folders?: Folder[] }).folders)
  ) {
    return (data as { folders: Folder[] }).folders;
  }
  return [];
}

export async function getDocument(id: string): Promise<DocDetail> {
  return request<DocDetail>(`/documents/${id}`);
}

export async function createDocument(
  title: string,
  content: string,
  kbId?: string | null,
  folderId?: string | null,
  type?: string,
): Promise<{ id: string; title: string }> {
  return request("/documents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, content, kb_id: kbId ?? undefined, folder_id: folderId ?? null, type: type ?? "doc" }),
  });
}

export async function updateDocument(
  id: string,
  title: string,
  content: string,
): Promise<{ id: string; title: string }> {
  return request(`/documents/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, content }),
  });
}

export async function moveDocument(
  id: string,
  folderId: string | null,
  sortOrder?: number | null,
): Promise<{ id: string; title: string }> {
  return request(`/documents/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folder_id: folderId, sort_order: sortOrder ?? undefined }),
  });
}

export async function moveDocumentToKb(id: string, kbId: string): Promise<void> {
  await request(`/documents/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kb_id: kbId, folder_id: null }),
  });
}

export async function createFolder(
  name: string,
  parentId?: string | null,
  kbId?: string | null,
): Promise<Folder> {
  return request("/folders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, parent_id: parentId ?? null, kb_id: kbId ?? undefined }),
  });
}

export async function renameFolder(id: string, name: string): Promise<Folder> {
  return request(`/folders/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

export async function moveFolder(
  id: string,
  parentId: string | null,
  sortOrder?: number | null,
): Promise<void> {
  await request(`/folders/${id}/move`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ parent_id: parentId, sort_order: sortOrder ?? undefined }),
  });
}

export async function deleteFolder(id: string): Promise<void> {
  await request(`/folders/${id}`, { method: "DELETE" });
}

export async function importDocument(
  file: File,
  kbId?: string | null,
): Promise<{ imported: number; documents: { id: string; title: string }[] }> {
  const form = new FormData();
  form.append("file", file);
  if (kbId) form.append("kb_id", kbId);
  return request("/documents/import", { method: "POST", body: form });
}

export interface ImportTaskStatus {
  status: "queued" | "running" | "done" | "failed";
  progress: number;
  total: number;
  done: number;
  current: string;
  message?: string;
  imported?: { id: string; title: string }[];
  media_count?: number;
}

export async function importDocumentAsync(
  file: File,
  kbId?: string | null,
  onUploadProgress?: (percent: number) => void,
): Promise<{ task_id: string; status: string }> {
  const form = new FormData();
  form.append("file", file);
  if (kbId) form.append("kb_id", kbId);

  return new Promise<{ task_id: string; status: string }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BASE}/documents/import`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) {
        const percent = (e.loaded / e.total) * 100;
        onUploadProgress?.(Math.max(0, Math.min(100, percent)));
      }
    };

    xhr.onload = () => {
      let data: { task_id?: string; status?: string; detail?: string };
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        reject(new Error(`请求失败（${xhr.status}）`));
        return;
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        if (data.task_id) {
          resolve({ task_id: data.task_id, status: data.status ?? "" });
        } else {
          reject(new Error("服务器未返回 task_id"));
        }
      } else {
        reject(new Error(data.detail || `请求失败（${xhr.status}）`));
      }
    };

    xhr.onerror = () => reject(new Error("上传失败"));
    xhr.send(form);
  });
}

export async function getImportTask(taskId: string): Promise<ImportTaskStatus> {
  return request(`/documents/import/${taskId}`);
}

export type ExportFormat = "md" | "docx" | "pdf" | "html" | "json" | "zip";

export async function exportDocuments(
  format: ExportFormat,
  docIds?: string[],
  kbId?: string | null,
): Promise<{ filename: string; blob: Blob }> {
  const res = await fetch(`${BASE}/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ format, doc_ids: docIds, kb_id: kbId ?? undefined }),
  });

  if (!res.ok) {
    let detail = `导出失败（${res.status}）`;
    try {
      const body = await res.json();
      if (body.detail) detail = body.detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }

  const blob = await res.blob();
  const cd = res.headers.get("Content-Disposition") ?? "";
  let filename = "";
  const m = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(cd);
  if (m) {
    try {
      filename = decodeURIComponent(m[1]);
    } catch {
      filename = m[1];
    }
  }
  if (!filename) filename = `export.${format === "md" ? "md" : format}`;

  return { filename, blob };
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export async function chat(
  query: string,
  topK = 5,
  history: ChatMessage[] = [],
): Promise<ChatResponse> {
  return request("/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, top_k: topK, history }),
  });
}

export async function deleteDocument(id: string): Promise<void> {
  await request(`/documents/${id}`, { method: "DELETE" });
}

// —— 收藏 / 分享 ——

export async function addFavorite(docId: string): Promise<void> {
  await request(`/documents/${docId}/favorite`, { method: "POST" });
}

export async function removeFavorite(docId: string): Promise<void> {
  await request(`/documents/${docId}/favorite`, { method: "DELETE" });
}

export async function listFavorites(): Promise<DocMeta[]> {
  const data = await request<{ documents: DocMeta[] }>("/favorites");
  return Array.isArray(data?.documents) ? data.documents : [];
}

export async function createShare(
  docId: string,
  options?: { password?: string; expiresIn?: number },
): Promise<{ token: string; password?: string | null; expires_at?: number | null }> {
  return request(`/documents/${docId}/share`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      password: options?.password || undefined,
      expires_in: options?.expiresIn || undefined,
    }),
  });
}

export async function revokeShare(docId: string): Promise<void> {
  await request(`/documents/${docId}/share`, { method: "DELETE" });
}

export interface SharedDoc {
  id: string;
  title: string;
  text: string;
  created_at: number;
}

export async function getSharedDoc(token: string, password?: string): Promise<SharedDoc> {
  const query = password ? `?password=${encodeURIComponent(password)}` : "";
  return request(`/share/${token}${query}`);
}

// —— 回收站 / 标签 / 置顶 / 摘要 ——

export type TrashKind = "document" | "folder" | "kb";

export interface TrashItem {
  id: string;
  name: string;
  title?: string;
  deleted_at?: number;
}

export async function listTrash(): Promise<{
  documents: TrashItem[];
  folders: TrashItem[];
  kbs: TrashItem[];
}> {
  const data = await request<{
    documents: TrashItem[];
    folders: TrashItem[];
    kbs: TrashItem[];
  }>("/trash");
  return {
    documents: data?.documents ?? [],
    folders: data?.folders ?? [],
    kbs: data?.kbs ?? [],
  };
}

export async function restoreTrash(kind: TrashKind, id: string): Promise<void> {
  await request(`/trash/${kind}/${id}/restore`, { method: "POST" });
}

export async function purgeTrash(kind: TrashKind, id: string): Promise<void> {
  await request(`/trash/${kind}/${id}`, { method: "DELETE" });
}

export async function setDocTags(docId: string, tags: string[]): Promise<void> {
  await request(`/documents/${docId}/tags`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tags }),
  });
}

export async function listTags(): Promise<string[]> {
  const data = await request<{ tags: string[] }>("/tags");
  return Array.isArray(data?.tags) ? data.tags : [];
}

export async function pinDocument(docId: string): Promise<void> {
  await request(`/documents/${docId}/pin`, { method: "POST" });
}

export async function unpinDocument(docId: string): Promise<void> {
  await request(`/documents/${docId}/unpin`, { method: "POST" });
}

export async function generateSummary(docId: string): Promise<string> {
  const data = await request<{ summary: string }>(`/documents/${docId}/summary`, {
    method: "POST",
  });
  return data.summary;
}

export type AIAssistAction =
  | "polish"
  | "translate_en"
  | "translate_zh"
  | "summarize"
  | "continue"
  | "explain";

export async function aiAssist(action: AIAssistAction, text: string): Promise<string> {
  const data = await request<{ result: string }>("/ai/assist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, text }),
  });
  return data.result;
}

export async function duplicateDocument(docId: string): Promise<{ id: string; title: string }> {
  return request(`/documents/${docId}/duplicate`, { method: "POST" });
}

export async function renameDocument(docId: string, title: string): Promise<void> {
  await request(`/documents/${docId}/rename`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
}

export interface DocVersion {
  id: string;
  title: string;
  created_at: number;
}

export async function listDocVersions(docId: string): Promise<DocVersion[]> {
  const data = await request<{ versions: DocVersion[] }>(`/documents/${docId}/versions`);
  return Array.isArray(data?.versions) ? data.versions : [];
}

export async function rollbackDocument(docId: string, versionId: string): Promise<void> {
  await request(`/documents/${docId}/rollback/${versionId}`, { method: "POST" });
}

// —— 文档评论/批注 ——

export interface CommentUser {
  id: string;
  nickname: string;
  avatar?: string | null;
}

export interface DocComment {
  id: string;
  doc_id: string;
  content: string;
  quote?: string | null;
  created_at: number;
  parent_id?: string | null;
  mentions?: string[];
  user: CommentUser;
  reply_to?: CommentUser | null;
}

export async function listComments(docId: string): Promise<DocComment[]> {
  const data = await request<{ comments: DocComment[] }>(`/documents/${docId}/comments`);
  return Array.isArray(data?.comments) ? data.comments : [];
}

export async function addComment(
  docId: string,
  content: string,
  options?: { quote?: string; parentId?: string; mentions?: string[] },
): Promise<DocComment> {
  return request(`/documents/${docId}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content,
      quote: options?.quote?.trim() || undefined,
      parent_id: options?.parentId || undefined,
      mentions: options?.mentions?.length ? options.mentions : undefined,
    }),
  });
}

export async function deleteComment(commentId: string): Promise<void> {
  await request(`/comments/${commentId}`, { method: "DELETE" });
}

// —— 通知中心 ——

export interface Notification {
  id: string;
  type: "mention" | "reply" | "share";
  doc_id?: string | null;
  kb_id?: string | null;
  content: string;
  read: boolean;
  created_at: number;
  actor: CommentUser;
}

export async function listNotifications(limit = 50): Promise<{
  notifications: Notification[];
  unread: number;
}> {
  const data = await request<{ notifications: Notification[]; unread: number }>(
    `/notifications?limit=${limit}`,
  );
  return {
    notifications: Array.isArray(data?.notifications) ? data.notifications : [],
    unread: data?.unread ?? 0,
  };
}

export async function getUnreadCount(): Promise<number> {
  const data = await request<{ unread: number }>("/notifications/unread-count");
  return data?.unread ?? 0;
}

export async function markNotificationRead(id: string): Promise<void> {
  await request(`/notifications/${id}/read`, { method: "POST" });
}

export async function markAllNotificationsRead(): Promise<void> {
  await request("/notifications/read-all", { method: "POST" });
}

// —— 知识库 ——

export async function listKbs(): Promise<Kb[]> {
  const data = await request<{ kbs?: Kb[] }>("/kbs");
  return Array.isArray(data?.kbs) ? data.kbs : [];
}

export async function createKb(name: string, description?: string): Promise<Kb> {
  return request("/kbs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, description: description?.trim() || undefined }),
  });
}

export async function updateKb(
  id: string,
  patch: { name?: string; description?: string },
): Promise<Kb> {
  return request(`/kbs/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function deleteKb(id: string): Promise<void> {
  await request(`/kbs/${id}`, { method: "DELETE" });
}

// —— 知识库共享 ——

export interface KbShare {
  user_id: string;
  username?: string;
  nickname?: string;
  permission: "read" | "write";
  created_at?: number;
}

export async function listShares(kbId: string): Promise<KbShare[]> {
  const data = await request<{ shares: KbShare[] }>(`/kbs/${kbId}/shares`);
  return Array.isArray(data?.shares) ? data.shares : [];
}

export async function addShare(
  kbId: string,
  username: string,
  permission: "read" | "write",
): Promise<KbShare> {
  return request(`/kbs/${kbId}/shares`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, permission }),
  });
}

export async function removeShare(kbId: string, userId: string): Promise<void> {
  await request(`/kbs/${kbId}/shares/${userId}`, { method: "DELETE" });
}

export interface UserBrief {
  id: string;
  username: string;
  nickname?: string;
}

export async function searchUsers(q: string): Promise<UserBrief[]> {
  const data = await request<{ users: UserBrief[] }>(
    `/users/search?q=${encodeURIComponent(q)}`,
  );
  return Array.isArray(data?.users) ? data.users : [];
}

// —— 最近浏览 ——

export async function recordRecent(docId: string): Promise<void> {
  try {
    await request("/recent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ doc_id: docId }),
    });
  } catch {
    /* 最近浏览记录失败不阻塞打开文档 */
  }
}

export async function listRecent(limit = 20): Promise<RecentDoc[]> {
  const data = await request<{ recent?: RecentDoc[] }>(`/recent?limit=${limit}`);
  return Array.isArray(data?.recent) ? data.recent : [];
}

export interface Stats {
  total_docs: number;
  total_kbs: number;
  total_favorites: number;
  recent_count: number;
  doc_trend?: { date: string; count: number }[];
  docs_by_kb?: { name: string; count: number }[];
  top_tags?: { name: string; count: number }[];
}

export async function getStats(): Promise<Stats> {
  return request<Stats>("/stats");
}

export interface WebSource {
  title: string;
  url: string;
}

export interface StreamEvent {
  type: "citations" | "delta" | "sources" | "done" | "error";
  citations?: Citation[];
  content?: string;
  sources?: WebSource[];
  status?: number;
  detail?: string;
  hits_empty?: boolean;
  web_available?: boolean;
  llm_available?: boolean;
}

/**
 * 流式问答（SSE）。回调接收事件：
 * - citations: 携带知识库引用列表
 * - sources: 携带联网搜索来源
 * - delta: 携带增量文本
 * - done: 结束
 */
export async function chatStream(
  query: string,
  topK: number,
  history: ChatMessage[],
  enableWeb: boolean,
  onEvent: (e: StreamEvent) => void,
): Promise<void> {
  const res = await fetch(`${BASE}/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ query, top_k: topK, history, enable_web: enableWeb }),
  });

  if (!res.ok || !res.body) {
    throw new Error(`请求失败（${res.status}）`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE 事件以 \n\n 分隔
    let idx;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const rawEvent = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const line of rawEvent.split("\n")) {
        if (line.startsWith("data: ")) {
          try {
            const event = JSON.parse(line.slice(6)) as StreamEvent;
            onEvent(event);
          } catch {
            /* ignore malformed */
          }
        }
      }
    }
  }
}

// —— 认证 / 用户 ——

export interface User {
  id: string;
  username: string;
  role: "admin" | "user";
  nickname?: string;
  email?: string | null;
  avatar?: string | null;
  status?: "active" | "disabled";
  created_at?: number;
}

export interface AuthResponse {
  token: string;
  user: User;
}

const TOKEN_KEY = "sunnydoc.token";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function uploadImage(file: File): Promise<string> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(`${BASE}/upload/image`, {
    method: "POST",
    headers: authHeaders(),
    body: fd,
  });
  if (!res.ok) {
    let detail = `上传失败（${res.status}）`;
    try {
      const body = await res.json();
      if (body.detail) detail = body.detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  const data = await res.json();
  return data.url;
}

export async function register(
  username: string,
  password: string,
): Promise<AuthResponse> {
  return request("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
}

export async function login(
  username: string,
  password: string,
): Promise<AuthResponse> {
  return request("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
}

export async function getMe(): Promise<User> {
  const data = await request<{ user: User }>("/auth/me", {
    headers: authHeaders(),
  });
  return data.user;
}

export async function updateMe(patch: {
  nickname?: string;
  email?: string;
  avatar?: string;
}): Promise<User> {
  const data = await request<{ user: User }>("/auth/me", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return data.user;
}

export async function changePassword(
  oldPassword: string,
  newPassword: string,
): Promise<{ token: string }> {
  return request("/auth/me/password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      old_password: oldPassword,
      new_password: newPassword,
    }),
  });
}

export async function logout(): Promise<void> {
  try {
    await request("/auth/logout", { method: "POST", headers: authHeaders() });
  } catch {
    /* 忽略登出失败 */
  }
}

// —— 用户管理（仅管理员） ——

export async function listUsers(): Promise<User[]> {
  const data = await request<{ users: User[] }>("/users");
  return Array.isArray(data?.users) ? data.users : [];
}

export async function createUser(payload: {
  username: string;
  password: string;
  nickname?: string;
  email?: string;
  role?: "admin" | "user";
}): Promise<User> {
  const data = await request<{ user: User }>("/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return data.user;
}

export async function updateUser(
  id: string,
  patch: { nickname?: string; email?: string; role?: "admin" | "user"; status?: "active" | "disabled" },
): Promise<User> {
  const data = await request<{ user: User }>(`/users/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return data.user;
}

export async function deleteUser(id: string): Promise<void> {
  await request(`/users/${id}`, { method: "DELETE" });
}

// —— 操作审计日志（仅管理员） ——

export interface AuditLog {
  id: string;
  action: string;
  target_type: string;
  target_id?: string | null;
  detail: string;
  created_at: number;
  user: { id: string | null; nickname: string };
}

export async function listAuditLogs(limit = 200, offset = 0): Promise<AuditLog[]> {
  const data = await request<{ logs: AuditLog[] }>(
    `/audit-logs?limit=${limit}&offset=${offset}`,
  );
  return Array.isArray(data?.logs) ? data.logs : [];
}

export async function resetUserPassword(
  id: string,
  newPassword: string,
): Promise<void> {
  await request(`/users/${id}/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ new_password: newPassword }),
  });
}

export interface AISettings {
  provider: string;
  llm_base_url: string;
  llm_api_key: string; // 脱敏后的 key
  llm_model: string;
  embedding_base_url: string;
  embedding_api_key: string; // 脱敏后的 key
  embedding_model: string;
  rerank_base_url: string;
  rerank_model: string;
  llm_configured: boolean;
  embedding_configured: boolean;
}

export async function getAISettings(): Promise<AISettings> {
  return request<AISettings>(`/settings/ai`);
}

export async function updateAISettings(patch: {
  provider?: string;
  llm_base_url?: string;
  llm_api_key?: string;
  llm_model?: string;
  embedding_base_url?: string;
  embedding_api_key?: string;
  embedding_model?: string;
  rerank_base_url?: string;
  rerank_model?: string;
}): Promise<{ ok: boolean }> {
  return request(`/settings/ai`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export interface CustomProvider {
  id: string;
  name: string;
  provider: string;
  llm_base_url: string;
  llm_api_key: string; // 脱敏
  llm_model: string;
  embedding_base_url: string;
  embedding_api_key: string; // 脱敏
  embedding_model: string;
  rerank_base_url: string;
  rerank_model: string;
}

export interface AITestResult {
  ok: boolean;
  status: number;
  detail: string;
  content?: string;
  models?: string[];
}

export async function testAISettings(payload: {
  base_url?: string;
  api_key?: string;
  model?: string;
  saved?: boolean;
}): Promise<AITestResult> {
  return request(`/settings/ai/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function fetchAIModels(payload: {
  base_url?: string;
  api_key?: string;
  saved?: boolean;
}): Promise<AITestResult> {
  return request(`/settings/ai/models`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function listCustomProviders(): Promise<CustomProvider[]> {
  const data = await request<{ providers: CustomProvider[] }>(`/settings/ai/custom-providers`);
  return Array.isArray(data?.providers) ? data.providers : [];
}

export async function upsertCustomProvider(cp: Partial<CustomProvider>): Promise<{
  ok: boolean;
  id: string;
  provider: CustomProvider;
}> {
  return request(`/settings/ai/custom-providers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cp),
  });
}

export async function deleteCustomProvider(id: string): Promise<{ ok: boolean }> {
  return request(`/settings/ai/custom-providers/${id}`, { method: "DELETE" });
}

/**
 * 建立 SSE 订阅（用 fetch + ReadableStream，支持 Authorization header）。
 * onEvent 收到解析后的 JSON 事件；断线自动重连（3s）。返回 { close } 用于取消。
 */
export function subscribeSSE(
  path: string,
  onEvent: (event: Record<string, unknown>) => void,
  onError?: () => void,
): { close: () => void } {
  const controller = new AbortController();
  let closed = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleReconnect = () => {
    if (closed) return;
    reconnectTimer = setTimeout(run, 3000);
  };

  const run = async () => {
    if (closed) return;
    try {
      const res = await fetch(`${BASE}${path}`, {
        headers: { ...authHeaders(), Accept: "text/event-stream" },
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        onError?.();
        scheduleReconnect();
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const chunk = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const dataLine = chunk.split("\n").find((l) => l.startsWith("data: "));
          if (!dataLine) continue;
          try {
            onEvent(JSON.parse(dataLine.slice(6)));
          } catch {
            /* 忽略解析失败 */
          }
        }
      }
      // 服务器断开流 → 自动重连
      scheduleReconnect();
    } catch {
      if (!closed) scheduleReconnect();
    }
  };

  run();

  return {
    close: () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      controller.abort();
    },
  };
}

