"""API 路由"""
from __future__ import annotations

import json

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.core.config import DEFAULT_TOP_K
from app.services import parser, qa, llm, web_search
from app.services.store import store

router = APIRouter(prefix="/api/v1")


class ChatRequest(BaseModel):
    query: str
    top_k: int = DEFAULT_TOP_K
    history: list[dict[str, str]] | None = None
    enable_web: bool = True


class DeleteRequest(BaseModel):
    doc_id: str


class CreateDocumentRequest(BaseModel):
    title: str
    content: str = ""


class UpdateDocumentRequest(BaseModel):
    title: str
    content: str = ""


def _dedupe_title(store, title: str) -> str:
    """若 title 已存在则自动追加「(2)」「(3)」…后缀，直到不重名"""
    existing = {d["title"] for d in store.all()}
    if title not in existing:
        return title
    i = 2
    while f"{title}({i})" in existing:
        i += 1
    return f"{title}({i})"


@router.get("/health")
def health():
    return {"status": "ok"}


@router.get("/documents")
def list_documents():
    docs = store.all()
    return {
        "total": len(docs),
        "documents": [
            {
                "id": d["id"],
                "title": d["title"],
                "source": d["source"],
                "ext": d["ext"],
                "created_at": d["created_at"],
            }
            for d in docs
        ],
    }


@router.post("/documents")
def create_document(req: CreateDocumentRequest):
    """新建文档（markdown 文本）"""
    title = req.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="标题不能为空")

    title = _dedupe_title(store, title)
    doc = store.add(title=title, text=req.content, source="手动创建", ext=".md")
    return {"id": doc["id"], "title": doc["title"]}


@router.get("/documents/{doc_id}")
def get_document(doc_id: str):
    doc = store.get(doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="文档不存在")
    return {
        "id": doc["id"],
        "title": doc["title"],
        "text": doc["text"],
        "source": doc["source"],
        "ext": doc["ext"],
        "created_at": doc["created_at"],
    }


@router.post("/documents/import")
async def import_documents(file: UploadFile = File(...)):
    """上传文件（支持 md/txt/json/csv/pdf/docx/xlsx/zip），解析并入库"""
    filename = file.filename or "untitled"
    data = await file.read()

    if not data:
        raise HTTPException(status_code=400, detail="文件为空")

    try:
        parsed = parser.parse_file(filename, data)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=f"解析失败：{e}") from e

    if not parsed:
        raise HTTPException(status_code=415, detail="不支持的文件类型")

    imported = []
    for p in parsed:
        # 用文件名（去扩展名）作为标题
        title = p["name"].rsplit("/", 1)[-1]
        title = title.rsplit(".", 1)[0] if "." in title else title
        title = _dedupe_title(store, title)
        doc = store.add(title=title, text=p["text"], source=filename, ext=p["ext"])
        imported.append({"id": doc["id"], "title": doc["title"]})

    return {"imported": len(imported), "documents": imported}


@router.post("/chat")
def chat(req: ChatRequest):
    if not req.query.strip():
        raise HTTPException(status_code=400, detail="问题不能为空")
    return qa.answer(req.query, req.top_k, req.history)


@router.post("/chat/stream")
def chat_stream(req: ChatRequest):
    """流式问答（SSE）：citations → delta/sources → done
    路由：知识库命中→RAG；未命中+联网→联网搜索；未命中+无联网→通用对话
    """
    if not req.query.strip():
        raise HTTPException(status_code=400, detail="问题不能为空")

    from app.services.store import search

    history = req.history or []
    hits = search(req.query, req.top_k)
    citations = [
        {
            "doc_id": h["doc_id"],
            "title": h["title"],
            "source": h["source"],
            "segment_index": h["segment_index"],
            "snippet": h["text"][:200],
        }
        for h in hits
    ]

    def event_stream():
        # 1. 先发引用（可能为空）
        yield f"data: {json.dumps({'type': 'citations', 'citations': citations}, ensure_ascii=False)}\n\n"

        # 2. 生成回答
        if hits:
            # 知识库命中 → RAG
            contexts = [h["text"] for h in hits]
            got = False
            for piece in llm.generate_stream(req.query, contexts, history):
                got = True
                yield f"data: {json.dumps({'type': 'delta', 'content': piece}, ensure_ascii=False)}\n\n"
            if not got:
                answer = qa.answer(req.query, req.top_k, history)["answer"]
                yield f"data: {json.dumps({'type': 'delta', 'content': answer}, ensure_ascii=False)}\n\n"
        elif req.enable_web and web_search.available():
            # 未命中 + 联网开 → 联网搜索（流式，含来源）
            got = False
            for ev in web_search.search_stream(req.query, history):
                got = True
                yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
            if not got:
                answer = qa.answer(req.query, req.top_k, history)["answer"]
                yield f"data: {json.dumps({'type': 'delta', 'content': answer}, ensure_ascii=False)}\n\n"
        else:
            # 未命中 + 无联网/未开 → 通用对话
            if llm.available():
                got = False
                for piece in llm.generate_stream(req.query, [], history):
                    got = True
                    yield f"data: {json.dumps({'type': 'delta', 'content': piece}, ensure_ascii=False)}\n\n"
                if not got:
                    answer = qa.answer(req.query, req.top_k, history)["answer"]
                    yield f"data: {json.dumps({'type': 'delta', 'content': answer}, ensure_ascii=False)}\n\n"
            else:
                answer = qa.answer(req.query, req.top_k, history)["answer"]
                yield f"data: {json.dumps({'type': 'delta', 'content': answer}, ensure_ascii=False)}\n\n"

        # 3. 结束标记
        yield f"data: {json.dumps({'type': 'done'})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.put("/documents/{doc_id}")
def update_document(doc_id: str, req: UpdateDocumentRequest):
    """更新文档标题与正文（重新分片 + 向量化）"""
    title = req.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="标题不能为空")

    doc = store.update(doc_id, title=title, text=req.content)
    if not doc:
        raise HTTPException(status_code=404, detail="文档不存在")
    return {"id": doc["id"], "title": doc["title"]}


@router.delete("/documents/{doc_id}")
def delete_document(doc_id: str):
    if store.delete(doc_id):
        return {"deleted": doc_id}
    raise HTTPException(status_code=404, detail="文档不存在")
