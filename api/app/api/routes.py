"""API 路由"""
from __future__ import annotations

import io
import json
import os
import tempfile
import threading
import uuid
import zipfile
from urllib.parse import quote

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from app.core.config import DEFAULT_TOP_K, MEDIA_DIR, DATA_DIR, TEXT_EXTS
from app.services import media, parser, qa, llm, web_search, exporter
from app.services.store import store

router = APIRouter(prefix="/api/v1")

# 上传文件落盘临时目录（避免整读进内存）
TMP_DIR = DATA_DIR / "tmp"
TMP_DIR.mkdir(parents=True, exist_ok=True)

# 异步导入任务状态（进程内全局，线程安全）
_import_tasks: dict[str, dict] = {}
_import_lock = threading.Lock()


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
    folder_id: str | None = None


class CreateFolderRequest(BaseModel):
    name: str
    parent_id: str | None = None


class ExportRequest(BaseModel):
    format: str
    doc_ids: list[str] | None = None


def _dedupe_title(store, title: str) -> str:
    """若 title 已存在则自动追加「(2)」「(3)」…后缀，直到不重名"""
    existing = {d["title"] for d in store.all()}
    if title not in existing:
        return title
    i = 2
    while f"{title}({i})" in existing:
        i += 1
    return f"{title}({i})"


# ---------- 异步导入任务 ----------

def _new_task(task_id: str) -> dict:
    return {
        "task_id": task_id,
        "status": "queued",
        "progress": 0,
        "total": 0,
        "done": 0,
        "current": "",
        "message": "",
        "imported": [],
        "media_count": 0,
    }


def _set_task(task_id: str, **fields) -> None:
    """线程安全地更新任务状态（只覆盖传入字段）。"""
    with _import_lock:
        task = _import_tasks.setdefault(task_id, _new_task(task_id))
        for k, v in fields.items():
            task[k] = v


def _get_task(task_id: str) -> dict | None:
    with _import_lock:
        task = _import_tasks.get(task_id)
        return dict(task) if task else None


def _iter_parse_zip(data: bytes, progress_cb):
    """逐文件解析 zip（复用 parser 的单文件解析能力），每处理一个文件回调一次进度。

    返回 (parsed, media_files)。与 parser.parse_zip + parser.extract_media 等效，
    区别是这里边解析边更新进度，并只遍历一次 zip。
    """
    parsed: list[dict] = []
    media_files: list[parser.MediaFile] = []
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        infos = [i for i in zf.infolist() if not i.is_dir()]
        total = len(infos)
        for idx, info in enumerate(infos, 1):
            name = parser._decode_zip_filename(info)
            ext = parser.ext_of(name)
            raw = zf.read(info)
            if ext in TEXT_EXTS:
                text = raw.decode("utf-8", errors="replace")
                parsed.append({"name": name, "ext": ext, "text": text})
            elif ext == ".pdf":
                parsed.append({"name": name, "ext": ext, "text": parser.parse_pdf(raw)})
            elif ext == ".docx":
                parsed.append({"name": name, "ext": ext, "text": parser.parse_docx(raw)})
            elif ext == ".xlsx":
                parsed.append({"name": name, "ext": ext, "text": parser.parse_xlsx(raw)})
            elif ext in parser.MEDIA_EXTS:
                zip_path = name.lstrip("/")
                media_files.append(
                    parser.MediaFile(
                        zip_path=zip_path,
                        filename=name.rsplit("/", 1)[-1],
                        ext=ext,
                        content_type=media.content_type(ext),
                        data=raw,
                    )
                )
            progress_cb(idx, total, name)
    return parsed, media_files


def _run_import_task(task_id: str, tmp_path: str, filename: str) -> None:
    """后台线程：读临时文件 → 解析 + 提取媒体 → 保存媒体 → 逐文档入库 + 向量化。

    进度分配：解析 0-40（按 zip 文件数）、媒体保存 40-50、入库 + 向量化 50-100。
    异常统一捕获并置 failed，线程自身不崩溃；临时文件在 finally 中删除。
    """
    try:
        _set_task(task_id, status="running", current="读取文件")
        data = open(tmp_path, "rb").read()

        if parser.ext_of(filename) == ".zip":
            with zipfile.ZipFile(io.BytesIO(data)) as zf:
                total_files = sum(1 for i in zf.infolist() if not i.is_dir())
        else:
            total_files = 1
        _set_task(task_id, total=total_files, current="解析文件")

        def parse_progress(done_files: int, total: int, current_name: str) -> None:
            progress = int(40 * done_files / max(1, total))
            _set_task(
                task_id, progress=progress, done=done_files, current=current_name
            )

        if parser.ext_of(filename) == ".zip":
            parsed, media_files = _iter_parse_zip(data, parse_progress)
        else:
            parsed = parser.parse_file(filename, data)
            media_files = parser.extract_media(filename, data)
            parse_progress(1, 1, filename)

        if not parsed and not media_files:
            raise ValueError("不支持的文件类型")

        # 保存媒体文件，建立 zip 内路径 -> 存储文件名 映射
        path_map: dict[str, str] = {}
        for mf in media_files:
            stored = media.save(mf.data, mf.ext)
            path_map[mf.zip_path] = stored
        _set_task(
            task_id, progress=50, current="保存媒体", media_count=len(media_files)
        )

        imported: list[dict] = []
        n = len(parsed)
        for i, p in enumerate(parsed, 1):
            text = p["text"]
            # 仅对 markdown 做图片引用路径替换
            if path_map and p["ext"] in {".md", ".markdown"}:
                text = parser.replace_md_image_refs(text, p["name"], path_map)
            # 用文件名（去扩展名）作为标题
            title = p["name"].rsplit("/", 1)[-1]
            title = title.rsplit(".", 1)[0] if "." in title else title
            title = _dedupe_title(store, title)
            doc = store.add(title=title, text=text, source=filename, ext=p["ext"])
            imported.append({"id": doc["id"], "title": doc["title"]})
            progress = 50 + int(50 * i / n) if n else 100
            _set_task(
                task_id,
                progress=progress,
                done=total_files,
                current=title,
                imported=imported,
                media_count=len(media_files),
            )

        _set_task(
            task_id,
            status="done",
            progress=100,
            total=total_files,
            done=total_files,
            current="",
            imported=imported,
            media_count=len(media_files),
        )
    except Exception as e:  # noqa: BLE001
        _set_task(task_id, status="failed", message=str(e))
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


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
                "folder_id": d.get("folder_id"),
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
        "folder_id": doc.get("folder_id"),
    }


@router.post("/documents/import")
async def import_documents(file: UploadFile = File(...)):
    """上传文件（支持 md/txt/json/csv/pdf/docx/xlsx/zip），异步解析并入库。

    文件先流式写入临时文件（避免整读进内存），随后返回 task_id，
    后台线程执行解析 + 媒体保存 + 逐文档向量化入库，进度经
    GET /documents/import/{task_id} 查询。
    """
    filename = file.filename or "untitled"

    # 流式落盘，不 await file.read() 整读内存
    fd, tmp_path = tempfile.mkstemp(dir=str(TMP_DIR))
    try:
        with os.fdopen(fd, "wb") as out:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                out.write(chunk)
    except Exception:  # noqa: BLE001
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise HTTPException(status_code=400, detail="文件接收失败")

    if os.path.getsize(tmp_path) == 0:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise HTTPException(status_code=400, detail="文件为空")

    task_id = uuid.uuid4().hex
    _set_task(task_id, status="queued")
    thread = threading.Thread(
        target=_run_import_task, args=(task_id, tmp_path, filename), daemon=True
    )
    thread.start()

    return {"task_id": task_id, "status": "queued"}


@router.get("/documents/import/{task_id}")
def get_import_progress(task_id: str):
    """查询异步导入进度。"""
    task = _get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    return task


@router.get("/media/{filename}")
def get_media(filename: str):
    """返回媒体文件（图片/动图/视频），带路径穿越防护"""
    if not filename or "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=404, detail="文件不存在")

    path = (MEDIA_DIR / filename).resolve()
    media_root = MEDIA_DIR.resolve()
    if path.parent != media_root:
        raise HTTPException(status_code=404, detail="文件不存在")

    if not path.is_file():
        raise HTTPException(status_code=404, detail="文件不存在")

    return FileResponse(path, media_type=media.content_type(parser.ext_of(filename)))


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
    """更新文档标题与正文（重新分片 + 向量化），可选移动文件夹。"""
    title = req.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="标题不能为空")

    kwargs: dict = {"title": title, "text": req.content}
    # 仅当请求体显式携带 folder_id 时才移动（null 表示移回根目录）
    if "folder_id" in req.model_fields_set:
        kwargs["folder_id"] = req.folder_id

    doc = store.update(doc_id, **kwargs)
    if not doc:
        raise HTTPException(status_code=404, detail="文档不存在")
    return {"id": doc["id"], "title": doc["title"], "folder_id": doc.get("folder_id")}


@router.delete("/documents/{doc_id}")
def delete_document(doc_id: str):
    if store.delete(doc_id):
        return {"deleted": doc_id}
    raise HTTPException(status_code=404, detail="文档不存在")


# ---------- 文件夹 ----------

@router.get("/folders")
def list_folders():
    """文件夹列表（扁平，含 parent_id，供前端组装树）。"""
    return {"folders": store.list_folders()}


@router.post("/folders")
def create_folder(req: CreateFolderRequest):
    name = req.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="文件夹名称不能为空")
    folder = store.create_folder(name=name, parent_id=req.parent_id)
    return folder


@router.delete("/folders/{folder_id}")
def delete_folder(folder_id: str):
    if store.delete_folder(folder_id):
        return {"deleted": folder_id}
    raise HTTPException(status_code=404, detail="文件夹不存在")


# ---------- 导出 ----------

@router.post("/export")
def export_documents(req: ExportRequest):
    """多格式导出：md/docx/pdf/html/json/zip。doc_ids 为空导出全部。"""
    docs = store.all()
    if req.doc_ids:
        idset = set(req.doc_ids)
        docs = [d for d in docs if d["id"] in idset]
    if not docs:
        raise HTTPException(status_code=404, detail="无文档可导出")

    try:
        content, filename, content_type = exporter.build(req.format, docs)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    cd = f"attachment; filename*=UTF-8''{quote(filename)}"
    # content 是 bytes（或 str），用 Response 直接返回；避免 StreamingResponse 把 bytes 当逐字节迭代器
    from fastapi.responses import Response

    return Response(
        content=content,
        media_type=content_type,
        headers={"Content-Disposition": cd},
    )
