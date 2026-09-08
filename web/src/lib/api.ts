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

export async function listDocuments(): Promise<DocMeta[]> {
  const data = await request<{ total: number; documents: DocMeta[] }>("/documents");
  return data.documents;
}

export async function getDocument(id: string): Promise<DocDetail> {
  return request<DocDetail>(`/documents/${id}`);
}

export async function createDocument(
  title: string,
  content: string,
): Promise<{ id: string; title: string }> {
  return request("/documents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, content }),
  });
}

export async function importDocument(
  file: File,
): Promise<{ imported: number; documents: { id: string; title: string }[] }> {
  const form = new FormData();
  form.append("file", file);
  return request("/documents/import", { method: "POST", body: form });
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

