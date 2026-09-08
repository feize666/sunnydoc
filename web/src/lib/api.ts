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
}

export interface Kb {
  id: string;
  name: string;
  description?: string;
  created_at?: number;
  doc_count?: number;
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
}

export interface DocDetail extends DocMeta {
  text: string;
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
  const res = await fetch(`${BASE}${path}`, init);
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
}

export async function searchDocuments(
  q: string,
  kbId?: string | null,
): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q });
  if (kbId) params.set("kb_id", kbId);
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
): Promise<{ id: string; title: string }> {
  return request("/documents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, content, kb_id: kbId ?? undefined }),
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
): Promise<{ id: string; title: string }> {
  return request(`/documents/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folder_id: folderId }),
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

export interface WebSource {
  title: string;
  url: string;
}

export interface StreamEvent {
  type: "citations" | "delta" | "sources" | "done";
  citations?: Citation[];
  content?: string;
  sources?: WebSource[];
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
    headers: { "Content-Type": "application/json" },
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

