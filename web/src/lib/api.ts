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

export async function importDocument(
  file: File,
): Promise<{ imported: number; documents: { id: string; title: string }[] }> {
  const form = new FormData();
  form.append("file", file);
  return request("/documents/import", { method: "POST", body: form });
}

export async function chat(query: string, topK = 5): Promise<ChatResponse> {
  return request("/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, top_k: topK }),
  });
}

export async function deleteDocument(id: string): Promise<void> {
  await request(`/documents/${id}`, { method: "DELETE" });
}
