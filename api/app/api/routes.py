"""API 路由"""
from __future__ import annotations

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel

from app.core.config import DEFAULT_TOP_K
from app.services import parser, qa
from app.services.store import store

router = APIRouter(prefix="/api/v1")


class ChatRequest(BaseModel):
    query: str
    top_k: int = DEFAULT_TOP_K


class DeleteRequest(BaseModel):
    doc_id: str


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
        doc = store.add(title=title, text=p["text"], source=filename, ext=p["ext"])
        imported.append({"id": doc["id"], "title": doc["title"]})

    return {"imported": len(imported), "documents": imported}


@router.post("/chat")
def chat(req: ChatRequest):
    if not req.query.strip():
        raise HTTPException(status_code=400, detail="问题不能为空")
    return qa.answer(req.query, req.top_k)


@router.delete("/documents/{doc_id}")
def delete_document(doc_id: str):
    if store.delete(doc_id):
        return {"deleted": doc_id}
    raise HTTPException(status_code=404, detail="文档不存在")
