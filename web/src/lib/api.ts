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
  updated_at?: number | null;
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
  pinned?: boolean;
}

export interface DocDetail extends DocMeta {
  text: string;
  is_favorite?: boolean;
  /** 乐观锁版本号（保存时原样带回做冲突判定）。 */
  revision?: number;
}

/**
 * 保存冲突（HTTP 409）：他人已修改该文档。
 *
 * 单列一个错误类型，让调用方能与「网络失败」「无权限」区分开 ——
 * 只有这个错误需要弹「保留我的 / 采用对方」，其余一律走普通报错。
 */
export class RevisionConflictError extends Error {
  currentRevision: number;
  currentTitle?: string;
  currentUpdatedAt?: number;

  constructor(detail: {
    message?: string;
    current_revision?: number;
    current_title?: string;
    current_updated_at?: number;
  }) {
    super(detail.message || "该文档已被他人修改");
    this.name = "RevisionConflictError";
    this.currentRevision = detail.current_revision ?? 0;
    this.currentTitle = detail.current_title;
    this.currentUpdatedAt = detail.current_updated_at;
  }
}

export interface Citation {
  doc_id: string;
  title: string;
  source: string;
  segment_index: number;
  snippet: string;
  /**
   * 定位词（后端下发）：点引用后用它去正文里高亮。
   *
   * **为什么不能自己从 snippet 拼**：`snippet` 是分片的**裸原文**，
   * 前 20 字符常含换行/制表/表格对齐空格，压缩成单行后与原文不再匹配 ——
   * 实测 12 条引用里只有 6 条（50%）能定位到。后端已清洗并给出
   * 「内部无空白的连续词」，必然可搜到。缺失时（旧后端）回退旧逻辑。
   */
  terms?: string;
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
    let detail: unknown = `请求失败（${res.status}）`;
    try {
      const body = await res.json();
      if (body.detail) detail = body.detail;
    } catch {
      /* ignore */
    }
    // 409 的 detail 是对象（含服务端最新状态），需单独识别 ——
    // 否则 `new Error(obj)` 只会得到 "[object Object]"，调用方拿不到任何有用信息。
    if (res.status === 409 && detail && typeof detail === "object" && !Array.isArray(detail)) {
      throw new RevisionConflictError(detail as Record<string, never>);
    }
    throw new Error(_describeDetail(detail, res.status));
  }
  return res.json() as Promise<T>;
}

/**
 * 把 FastAPI 的 detail 转成可读字符串。
 *
 * detail 可能是字符串（HTTPException）、对象（含 message）或数组
 * （422 校验错误，形如 [{loc, msg}]）。一律直接 String() 会得到
 * "[object Object]" —— 用户看到的报错毫无信息量。
 */
function _describeDetail(detail: unknown, status: number): string {
  if (typeof detail === "string") return detail;
  if (detail && typeof detail === "object") {
    if (Array.isArray(detail)) {
      const msgs = detail
        .map((d) => (d && typeof d === "object" && "msg" in d ? String((d as { msg: unknown }).msg) : String(d)))
        .filter(Boolean);
      if (msgs.length > 0) return msgs.join("；");
    } else if ("message" in detail) {
      return String((detail as { message: unknown }).message);
    }
  }
  return `请求失败（${status}）`;
}

export async function listDocuments(kbId?: string | null, tag?: string | null): Promise<DocMeta[]> {
  const params = new URLSearchParams();
  if (kbId) params.set("kb_id", kbId);
  if (tag) params.set("tag", tag);
  const qs = params.toString();
  const data = await request<{ total: number; documents: DocMeta[] }>(
    `/documents${qs ? `?${qs}` : ""}`,
  );
  return Array.isArray(data?.documents) ? data.documents : [];
}

export interface SearchResult {
  doc_id: string;
  title: string;
  snippet: string;
  match_in_title: boolean;
  match_count?: number;
  folder_id?: string | null;
  kb_id?: string | null;
  source?: string;
  type?: string;
  tags?: string[];
  /** AI 摘要（2026-10-14 起随搜索下发；未生成时为 null） */
  summary?: string | null;
  created_at?: number;
}

export interface SearchResponse {
  results: SearchResult[];
  /**
   * 实际参与匹配的词表（后端按分词/精确规则算出）。
   *
   * **为什么必须用它而不是原始查询串做高亮**：后端已改为「空白分组 AND +
   * 组内按中文分词 OR」，所以「虚拟机怎么开机」命中的词是 `虚拟机` / `开机`，
   * 文档里**并不存在**「虚拟机怎么开机」这个整串。前端若继续用原始串高亮，
   * 会出现「有结果但零高亮」的怪异表现。旧后端没有该字段 → 回退到档案行为。
   */
  terms: string[];
}

export async function searchDocumentsFull(
  q: string,
  kbId?: string | null,
  type?: string | null,
  tag?: string | null,
  sort?: string | null,
): Promise<SearchResponse> {
  const params = new URLSearchParams({ q });
  if (kbId) params.set("kb_id", kbId);
  if (type) params.set("type", type);
  if (tag) params.set("tag", tag);
  if (sort) params.set("sort", sort);
  const data = await request<{ total: number; results: SearchResult[]; terms?: string[] }>(
    `/search?${params.toString()}`,
  );
  return {
    results: Array.isArray(data?.results) ? data.results : [],
    terms: Array.isArray(data?.terms) ? data.terms : [],
  };
}

export async function searchDocuments(
  q: string,
  kbId?: string | null,
  type?: string | null,
  tag?: string | null,
  sort?: string | null,
): Promise<SearchResult[]> {
  return (await searchDocumentsFull(q, kbId, type, tag, sort)).results;
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
  expectedRevision?: number | null,
): Promise<{ id: string; title: string; revision?: number }> {
  return request(`/documents/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title,
      content,
      // 仅在调用方明确持有版本号时才带 —— 不传则服务端跳过校验（向后兼容）。
      ...(expectedRevision == null ? {} : { expected_revision: expectedRevision }),
    }),
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
  folderId?: string | null,
): Promise<{ task_id: string; status: string }> {
  const form = new FormData();
  form.append("file", file);
  if (kbId) form.append("kb_id", kbId);
  if (folderId) form.append("folder_id", folderId);

  const doUpload = (): Promise<{ task_id: string; status: string }> =>
    new Promise<{ task_id: string; status: string }>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${BASE}/documents/import`);

      // 关键：XHR 不会自动带 cookie/authorization，需手动附加 token
      const token = getToken();
      if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);

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
          reject(Object.assign(new Error(`请求失败（${xhr.status}）`), { status: xhr.status }));
          return;
        }

        if (xhr.status >= 200 && xhr.status < 300) {
          if (data.task_id) {
            resolve({ task_id: data.task_id, status: data.status ?? "" });
          } else {
            reject(new Error("服务器未返回 task_id"));
          }
        } else {
          reject(Object.assign(new Error(data.detail || `请求失败（${xhr.status}）`), { status: xhr.status }));
        }
      };

      xhr.onerror = () => reject(new Error("上传失败，请检查网络后重试"));
      xhr.send(form);
    });

  // 网关错误（502/503/504）或网络错误时自动重试（服务重启窗口 / 瞬时抖动）
  for (let attempt = 0; ; attempt++) {
    try {
      return await doUpload();
    } catch (e) {
      const status = (e as { status?: number }).status;
      const retriable = status ? status >= 500 : true; // 无 status 的网络错误也可重试
      if (retriable && attempt < 2) {
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        continue;
      }
      if (status === 502 || status === 503 || status === 504) {
        throw new Error("服务暂时繁忙，请稍后重试");
      }
      throw e;
    }
  }
}

export async function getImportTask(taskId: string): Promise<ImportTaskStatus> {
  return request(`/documents/import/${taskId}`);
}

export async function importFromUrl(
  url: string,
  kbId?: string | null,
  folderId?: string | null,
): Promise<{ id: string; title: string }> {
  return request("/import/url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, kb_id: kbId ?? undefined, folder_id: folderId ?? undefined }),
  });
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

export type BatchDeleteResult = {
  deleted: string[];
  skipped: { id: string; reason: string }[];
  count: number;
};

/** 批量软删除文档 / 文件夹（进回收站）。无权限或不存在的项会被跳过而非整批失败。 */
export async function batchDeleteDocuments(payload: {
  doc_ids?: string[];
  folder_ids?: string[];
}): Promise<BatchDeleteResult> {
  return request<BatchDeleteResult>("/documents/batch-delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      doc_ids: payload.doc_ids ?? [],
      folder_ids: payload.folder_ids ?? [],
    }),
  });
}

export type BatchMoveResult = {
  moved: string[];
  skipped: { id: string; reason: string }[];
  count: number;
};

/**
 * 批量移动文档到目标知识库/文件夹（与 batchDeleteDocuments 对称）。
 * `kb_id: null` = 移出知识库（进「个人空间」）；`folder_id: null` = 目标库根目录。
 * 无权限或不存在的项会被跳过而非整批失败。
 */
export async function batchMoveDocuments(payload: {
  doc_ids: string[];
  kb_id: string | null;
  folder_id?: string | null;
}): Promise<BatchMoveResult> {
  return request<BatchMoveResult>("/documents/batch-move", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      doc_ids: payload.doc_ids ?? [],
      kb_id: payload.kb_id,
      folder_id: payload.folder_id ?? null,
    }),
  });
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

export async function pinFolder(folderId: string): Promise<void> {
  await request(`/folders/${folderId}/pin`, { method: "POST" });
}

export async function unpinFolder(folderId: string): Promise<void> {
  await request(`/folders/${folderId}/unpin`, { method: "POST" });
}

export async function generateSummary(docId: string): Promise<string> {
  const data = await request<{ summary: string }>(`/documents/${docId}/summary`, {
    method: "POST",
  });
  return data.summary;
}

/** 向量健康（admin）：缺向量分片数 = AI 语义检索的盲区。 */
export interface EmbeddingHealth {
  embedding_available: boolean;
  backend: string;
  supported: boolean;
  missing: number;
}

export async function getEmbeddingHealth(): Promise<EmbeddingHealth> {
  return request<EmbeddingHealth>("/admin/embedding-health");
}

/** 补算缺向量分片（admin）。只写 vector IS NULL 的行，重复执行安全。 */
export interface RepairEmbeddingsResult {
  supported: boolean;
  scanned: number;
  repaired: number;
  remaining: number;
  failed: number;
  docs: string[];
}

export async function repairEmbeddings(): Promise<RepairEmbeddingsResult> {
  return request<RepairEmbeddingsResult>("/admin/repair-embeddings", {
    method: "POST",
  });
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

export async function generateDiagram(
  kind: "flowchart" | "mindmap",
  text: string,
): Promise<{ nodes: unknown[]; edges?: unknown[] }> {
  return request("/ai/generate-diagram", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, text }),
  });
}

/** 联网检索到的单个图标：来源集合 + 名称 + 原始 viewBox 尺寸 + 已净化的 SVG 正文 */
export interface SearchedIcon {
  prefix: string;
  name: string;
  w: number;
  h: number;
  body: string;
}

/**
 * 联网搜索图形（图标）。
 *
 * 走后端 `/icons/search` 而不是前端直连 Iconify：一屏图标需先检索再逐个取正文，
 * 前端直连要几十次往返；后端合并成一次并统一做超时降级与安全净化。
 */
export async function searchIcons(query: string, limit = 36): Promise<SearchedIcon[]> {
  const q = query.trim();
  if (!q) return [];
  const data = await request<{ icons: SearchedIcon[] }>(
    `/icons/search?q=${encodeURIComponent(q)}&limit=${limit}`,
  );
  return Array.isArray(data?.icons) ? data.icons : [];
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
  text?: string;
}

export async function listDocVersions(docId: string): Promise<DocVersion[]> {
  const data = await request<{ versions: DocVersion[] }>(`/documents/${docId}/versions`);
  return Array.isArray(data?.versions) ? data.versions : [];
}

export async function rollbackDocument(docId: string, versionId: string): Promise<void> {
  await request(`/documents/${docId}/rollback/${versionId}`, { method: "POST" });
}

export interface Backlink {
  id: string;
  title: string;
  kb_id: string | null;
  folder_id: string | null;
  source?: string | null;
}

export async function listBacklinks(docId: string): Promise<Backlink[]> {
  const data = await request<{ backlinks: Backlink[] }>(`/documents/${docId}/backlinks`);
  return Array.isArray(data?.backlinks) ? data.backlinks : [];
}

export async function lookupDocumentByTitle(title: string): Promise<Backlink | null> {
  try {
    const data = await request<Backlink>(
      `/documents/lookup?title=${encodeURIComponent(title)}`,
    );
    return data && data.id ? data : null;
  } catch {
    return null;
  }
}

// —— 文档评论/批注 ——

export interface CommentUser {
  id: string;
  nickname: string;
  avatar?: string | null;
}

/** 划词批注锚点：上下文快照 + 第几次出现（不存绝对偏移，正文可编辑） */
export interface CommentAnchor {
  prefix: string;
  suffix: string;
  index: number;
}

export interface DocComment {
  id: string;
  doc_id: string;
  content: string;
  quote?: string | null;
  created_at: number;
  parent_id?: string | null;
  mentions?: string[];
  /** 仅划词批注有；为 null 表示普通评论 */
  anchor?: CommentAnchor | null;
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
  options?: {
    quote?: string;
    parentId?: string;
    mentions?: string[];
    anchor?: CommentAnchor | null;
  },
): Promise<DocComment> {
  const anchor = options?.anchor;
  return request(`/documents/${docId}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content,
      quote: options?.quote?.trim() || undefined,
      parent_id: options?.parentId || undefined,
      mentions: options?.mentions?.length ? options.mentions : undefined,
      // 锚点只在「确实划了词」时带上，纯评论不写
      anchor_prefix: anchor ? anchor.prefix : undefined,
      anchor_suffix: anchor ? anchor.suffix : undefined,
      anchor_index: anchor ? anchor.index : undefined,
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

/** 按标题前缀/子串查文档（P2-2 [[ 唤起用）。 */
export interface DocPick {
  id: string;
  title: string;
  kb_id?: string | null;
  folder_id?: string | null;
}
export async function searchDocumentsByTitle(q: string, limit = 20): Promise<DocPick[]> {
  const data = await request<DocPick[]>(
    `/documents/search-by-title?q=${encodeURIComponent(q)}&limit=${limit}`,
  );
  return Array.isArray(data) ? data : [];
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

/** 智能体待确认的破坏性操作（后端**尚未执行**，需用户点确认）。 */
export interface PendingAction {
  /** 工具名，如 delete_document */
  tool: string;
  /** 调用参数，确认时原样回传 */
  arguments: Record<string, unknown>;
  /** 人类可读摘要，直接展示给用户 */
  summary: string;
  /** 仅前端使用：确认请求进行中（防重复点击）。不参与持久化语义。 */
  _busy?: boolean;
}

export interface StreamEvent {
  type:
    | "citations"
    | "delta"
    | "sources"
    | "done"
    | "error"
    // 智能体工具编排（阶段 4）
    | "tool_call"
    | "tool_result"
    | "pending"
    | "pending_all"
    | "ui_action";
  citations?: Citation[];
  content?: string;
  sources?: WebSource[];
  status?: number;
  detail?: string;
  hits_empty?: boolean;
  web_available?: boolean;
  llm_available?: boolean;
  /** 后端是否启用了智能体（模型支持工具且已配置） */
  agent_enabled?: boolean;
  // ---- 工具编排字段 ----
  id?: string;
  name?: string;
  level?: "read" | "write" | "destructive";
  arguments?: string | Record<string, unknown>;
  ok?: boolean;
  pending?: boolean;
  /** 工具执行失败时的可读原因（tool_result 事件） */
  error?: string;
  /** 待确认项（pending / pending_all 事件） */
  tool?: string;
  summary?: string;
  pendings?: PendingAction[];
  /** 界面指令（ui_action 事件） */
  ui_action?: string;
  view?: string;
  doc_id?: string;
  title?: string;
}

/** AI 面板开启智能体时需要的界面上下文（让「这个知识库」有依据）。 */
export interface AgentUiContext {
  currentKbId?: string | null;
  currentDocId?: string | null;
  /** 关闭后行为与改造前一致（只做 RAG 问答，不调工具） */
  enableAgent?: boolean;
}

/**
 * 流式问答（SSE）。回调接收事件：
 * - citations: 携带知识库引用列表
 * - sources: 携带联网搜索来源
 * - delta: 携带增量文本
 * - tool_call / tool_result: 智能体正在调用工具
 * - pending: 破坏性操作待用户确认（**尚未执行**）
 * - ui_action: 让界面打开文档/切换视图
 * - done: 结束
 */
export async function chatStream(
  query: string,
  topK: number,
  history: ChatMessage[],
  enableWeb: boolean,
  onEvent: (e: StreamEvent) => void,
  attachments?: string[],
  signal?: AbortSignal,
  ui?: AgentUiContext,
): Promise<void> {
  const res = await fetch(`${BASE}/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      query,
      top_k: topK,
      history,
      enable_web: enableWeb,
      attachments: attachments ?? [],
      // 智能体上下文：让「这个知识库」「那篇文档」等指代有依据
      current_kb_id: ui?.currentKbId ?? null,
      current_doc_id: ui?.currentDocId ?? null,
      enable_agent: ui?.enableAgent ?? true,
    }),
    signal,
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

// —— 智能体（阶段 4）——

export interface AgentToolInfo {
  name: string;
  description: string;
  level: "read" | "write" | "destructive";
}

/** 列出智能体可用工具（用于「它能做什么」展示与调试）。 */
export async function fetchAgentTools(): Promise<AgentToolInfo[]> {
  const data = await request<{ tools: AgentToolInfo[] }>("/agent/tools");
  return Array.isArray(data?.tools) ? data.tools : [];
}

/**
 * 用户确认后执行破坏性操作。
 *
 * 🔴 **参数必须原样回传后端下发的 `arguments`**。
 * 后端不缓存「待确认队列」（无状态设计，多标签页/刷新后确认都成立），
 * 所以这次请求携带的参数就是最终执行的内容 —— 前端不要自作主张改写。
 */
export async function agentConfirm(
  tool: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; result?: Record<string, unknown> }> {
  return request<{ ok: boolean; result?: Record<string, unknown> }>("/agent/confirm", {
    method: "POST",
    // ⚠️ 必须显式设 Content-Type。`request()` 只加 Authorization 头、
    // **不设 Content-Type 也不序列化 body** —— 少了这一行，FastAPI 会把
    // 请求体当成字符串，pydantic 校验失败返回 422
    // （报错形如 Input should be a valid dictionary... input: "{\"tool\":...}"）。
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tool, arguments: args }),
  });
}

// —— 认证 / 用户 ——

export interface ChatAttachment {
  id: string;
  filename: string;
  kind: "image" | "doc" | "zip";
  size: number;
  text_preview?: string;
  preview_url?: string | null;
  vision?: boolean;
}

/** 上传对话附件（图片/文档/压缩包），后端解析提取文字。 */
export async function uploadChatAttachment(file: File): Promise<ChatAttachment> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(`${BASE}/chat/attachments`, {
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
  return res.json();
}

/** 把对话附件导入指定知识库（复用异步导入任务）。 */
export async function importChatAttachment(
  id: string,
  kbId: string | null,
): Promise<{ task_id: string; status: string }> {
  return request(`/chat/attachments/${id}/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kb_id: kbId }),
  });
}

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

/** 正文附件上传（pdf/docx/xlsx/zip 等非图片文件）。返回可访问 URL 与原始文件名。 */
export async function uploadAttachment(
  file: File,
): Promise<{ url: string; name: string; size: number }> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(`${BASE}/upload/attachment`, {
    method: "POST",
    headers: authHeaders(),
    body: fd,
  });
  if (!res.ok) {
    let detail = `附件上传失败（${res.status}）`;
    try {
      const body = await res.json();
      if (body.detail) detail = body.detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return res.json();
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

// ---------- 社区模板 ----------

export interface CommunityTemplate {
  id: string;
  name: string;
  type: string;
  data: string;
  description?: string;
  category?: string;
  author_id?: string;
  author_name?: string;
  use_count?: number;
  created_at?: number;
}

export async function listCommunityTemplates(
  type?: string,
  q?: string,
): Promise<CommunityTemplate[]> {
  const params = new URLSearchParams();
  if (type) params.set("type", type);
  if (q) params.set("q", q);
  const qs = params.toString();
  const res = await request<{ templates: CommunityTemplate[] }>(`/templates${qs ? `?${qs}` : ""}`);
  return res.templates ?? [];
}

export async function publishCommunityTemplate(input: {
  name: string;
  type: string;
  data: string;
  description?: string;
  category?: string;
}): Promise<CommunityTemplate> {
  return request<CommunityTemplate>("/templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function deleteCommunityTemplate(id: string): Promise<void> {
  await request(`/templates/${id}`, { method: "DELETE" });
}

/**
 * 记一次社区模板的使用（后端把 use_count +1）。
 *
 * 注意：这是个**普通 async 函数，不是 React Hook**。刻意不以 `use` 开头 ——
 * 原名 `useCommunityTemplate` 会被 eslint-plugin-react-hooks 误判为 Hook 调用，
 * 在 handleApplyCommunity 里报 rules-of-hooks 违规，噪声会掩盖真实违规。
 */
export async function trackTemplateUse(id: string): Promise<void> {
  await request(`/templates/${id}/use`, { method: "POST" });
}

