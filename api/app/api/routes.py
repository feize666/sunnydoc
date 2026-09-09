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

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from app.core.config import DEFAULT_TOP_K, MEDIA_DIR, DATA_DIR, TEXT_EXTS
from app.services import media, parser, qa, llm, web_search, exporter, auth
from app.services.store import store

router = APIRouter(prefix="/api/v1")

# 上传文件落盘临时目录（避免整读进内存）
TMP_DIR = DATA_DIR / "tmp"
TMP_DIR.mkdir(parents=True, exist_ok=True)

# 异步导入任务状态（进程内全局，线程安全）
_import_tasks: dict[str, dict] = {}
_import_lock = threading.Lock()


def _bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None
    parts = authorization.split()
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1]
    return authorization.strip() or None


def get_current_user(authorization: str | None = Header(None)) -> dict:
    """解析 Bearer token → 校验存在且未禁用 → 返回用户。"""
    token = _bearer_token(authorization)
    user_id = auth.resolve_token(token) if token else None
    if not user_id:
        raise HTTPException(status_code=401, detail="未登录或登录已过期")
    user = store.get_user_by_id(user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="用户不存在")
    if user.get("status") != "active":
        raise HTTPException(status_code=403, detail="账号已被禁用")
    return user


def require_admin(current_user: dict = Depends(get_current_user)) -> dict:
    """管理员权限校验。"""
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="需要管理员权限")
    return current_user


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
    kb_id: str | None = None
    folder_id: str | None = None
    type: str = "doc"


class UpdateDocumentRequest(BaseModel):
    title: str
    content: str = ""
    folder_id: str | None = None
    kb_id: str | None = None
    sort_order: float | None = None


class CreateFolderRequest(BaseModel):
    name: str
    parent_id: str | None = None
    kb_id: str | None = None


class UpdateFolderRequest(BaseModel):
    name: str


class CreateKBRequest(BaseModel):
    name: str
    description: str | None = None


class UpdateKBRequest(BaseModel):
    name: str | None = None
    description: str | None = None


class RecordRecentRequest(BaseModel):
    doc_id: str


class ExportRequest(BaseModel):
    format: str
    doc_ids: list[str] | None = None


class RegisterRequest(BaseModel):
    username: str
    password: str


class LoginRequest(BaseModel):
    username: str
    password: str


class UpdateMeRequest(BaseModel):
    nickname: str | None = None
    email: str | None = None
    avatar: str | None = None


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str


class CreateUserRequest(BaseModel):
    username: str
    password: str
    nickname: str | None = None
    email: str | None = None
    role: str = "user"


class UpdateUserRequest(BaseModel):
    nickname: str | None = None
    email: str | None = None
    role: str | None = None
    status: str | None = None


class ResetPasswordRequest(BaseModel):
    new_password: str


class AddShareRequest(BaseModel):
    username: str
    permission: str  # read / write


def _kb_permission(kb_id: str, user: dict) -> str:
    """返回用户对知识库的权限（owner/read/write），无权限或不存在时抛异常。"""
    kb = store.get_kb(kb_id)
    if kb is None:
        raise HTTPException(status_code=404, detail="知识库不存在")
    perm = store.kb_permission(kb_id, user["id"])
    if perm is None:
        raise HTTPException(status_code=404, detail="知识库不存在")
    return perm


def _require_kb_owner(kb_id: str, user: dict) -> dict:
    """仅属主/管理员可访问（用于共享管理与知识库编辑/删除）。"""
    kb = store.get_kb(kb_id)
    if kb is None:
        raise HTTPException(status_code=404, detail="知识库不存在")
    if store.kb_permission(kb_id, user["id"]) != "owner":
        raise HTTPException(status_code=403, detail="仅知识库所有者可执行此操作")
    return kb


def _require_kb_write(kb_id: str, user: dict) -> None:
    """要求对该知识库有 write/owner 权限，否则 403。"""
    perm = _kb_permission(kb_id, user)
    if perm not in ("write", "owner"):
        raise HTTPException(status_code=403, detail="没有权限修改该知识库的内容")


def _dedupe_title(store, title: str, user_id: str | None = None) -> str:
    """若 title 已存在则自动追加「(2)」「(3)」…后缀，直到不重名（按 user 范围去重）"""
    existing = {d["title"] for d in store.all(user_id=user_id)}
    if title not in existing:
        return title
    i = 2
    while f"{title}({i})" in existing:
        i += 1
    return f"{title}({i})"


def _make_snippet(text: str, idx: int, qlen: int, radius: int = 60) -> str:
    """截取命中位置前后各 radius 字符的片段，首尾补省略号、换行压成空格。"""
    start = max(0, idx - radius)
    end = min(len(text), idx + qlen + radius)
    prefix = "…" if start > 0 else ""
    suffix = "…" if end < len(text) else ""
    return prefix + text[start:end].replace("\n", " ") + suffix


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


def _ensure_folder_path(
    store, path_parts: list[str], kb_id: str | None = None, user_id: str | None = None
) -> str | None:
    """按目录层级逐级查找/创建文件夹，返回最深层 folder_id；空路径返回 None。

    逐级匹配：在现有 list_folders() 中按 parent_id + name 找同名子文件夹，
    找不到才 create_folder（避免 create_folder 无去重导致重复创建）。
    kb_id / user_id 提供时，查找与创建均限定在该范围内。
    """
    if not path_parts:
        return None
    parent_id: str | None = None
    for name in path_parts:
        child = next(
            (
                f
                for f in store.list_folders(kb_id, user_id)
                if f["parent_id"] == parent_id and f["name"] == name
            ),
            None,
        )
        if child is None:
            child = store.create_folder(
                name=name, parent_id=parent_id, kb_id=kb_id, user_id=user_id
            )
        parent_id = child["id"]
    return parent_id


def _run_import_task(
    task_id: str,
    tmp_path: str,
    filename: str,
    kb_id: str | None = None,
    user_id: str | None = None,
) -> None:
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
            # 归一化 zip 内路径分隔符，去掉前导斜杠
            name = p["name"].replace("\\", "/").lstrip("/")
            # 拆出目录层级与文件名，逐级创建/复用文件夹
            dir_part, _, file_part = name.rpartition("/")
            path_parts = [s for s in dir_part.split("/") if s] if dir_part else []
            folder_id = _ensure_folder_path(store, path_parts, kb_id, user_id)
            # 用文件名（去扩展名）作为标题
            title = file_part
            title = title.rsplit(".", 1)[0] if "." in title else title
            title = _dedupe_title(store, title, user_id)
            doc = store.add(
                title=title, text=text, source=filename, ext=p["ext"], folder_id=folder_id, kb_id=kb_id, user_id=user_id
            )
            imported.append({"id": doc["id"], "title": doc["title"]})
            progress = 50 + int(50 * i / n) if n else 100
            _set_task(
                task_id,
                progress=progress,
                done=total_files,
                current=name,
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


@router.get("/search")
def search_documents(
    q: str,
    kb_id: str | None = None,
    limit: int = 50,
    current_user: dict = Depends(get_current_user),
):
    """全文搜索：在文档标题/正文中大小写不敏感地匹配关键词，返回带片段的命中列表。

    kb_id 提供时仅在指定知识库内搜索；结果按「标题命中优先 → 标题字典序」排序。
    """
    query = q.strip()
    if not query:
        return {"query": q, "total": 0, "results": []}

    ql = query.lower()
    results: list[dict] = []
    for d in store.all(kb_id, current_user["id"]):
        title = d.get("title") or ""
        text = d.get("text") or ""
        title_idx = title.lower().find(ql)
        text_idx = text.lower().find(ql)
        if title_idx == -1 and text_idx == -1:
            continue
        if text_idx >= 0:
            snippet = _make_snippet(text, text_idx, len(query))
        else:
            snippet = text[:120].replace("\n", " ")
        results.append(
            {
                "doc_id": d["id"],
                "title": title,
                "snippet": snippet,
                "match_in_title": title_idx >= 0,
                "folder_id": d.get("folder_id"),
                "kb_id": d.get("kb_id"),
                "source": d.get("source"),
            }
        )

    results.sort(key=lambda r: (not r["match_in_title"], r["title"].lower()))
    return {"query": q, "total": len(results), "results": results[:limit]}


@router.get("/documents")
def list_documents(
    kb_id: str | None = None,
    tag: str | None = None,
    current_user: dict = Depends(get_current_user),
):
    docs = store.all(kb_id, current_user["id"])
    if tag:
        docs = [d for d in docs if tag in (d.get("tags") or [])]
    fav_ids = set(store.list_favorites(current_user["id"]))
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
                "kb_id": d.get("kb_id"),
                "is_favorite": d["id"] in fav_ids,
                "pinned": bool(d.get("pinned")),
                "tags": d.get("tags") or [],
                "summary": d.get("summary"),
                "sort_order": d.get("sort_order"),
                "type": d.get("type", "doc"),
            }
            for d in docs
        ],
    }


@router.post("/documents")
def create_document(req: CreateDocumentRequest, current_user: dict = Depends(get_current_user)):
    """新建文档（markdown 文本）"""
    title = req.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="标题不能为空")
    if req.kb_id:
        _require_kb_write(req.kb_id, current_user)

    title = _dedupe_title(store, title, current_user["id"])
    doc = store.add(
        title=title,
        text=req.content,
        source="手动创建",
        ext=".md",
        folder_id=req.folder_id,
        kb_id=req.kb_id,
        user_id=current_user["id"],
        type=req.type,
    )
    return {"id": doc["id"], "title": doc["title"], "kb_id": doc.get("kb_id")}


@router.get("/documents/{doc_id}")
def get_document(doc_id: str, current_user: dict = Depends(get_current_user)):
    doc = store.get(doc_id, current_user["id"])
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
        "kb_id": doc.get("kb_id"),
        "is_favorite": store.is_favorite(current_user["id"], doc_id),
        "pinned": bool(doc.get("pinned")),
        "tags": doc.get("tags") or [],
        "summary": doc.get("summary"),
        "type": doc.get("type", "doc"),
    }


# ---------- 收藏 / 分享 ----------

@router.post("/documents/{doc_id}/favorite")
def add_favorite(doc_id: str, current_user: dict = Depends(get_current_user)):
    """收藏文档。"""
    if store.get(doc_id, current_user["id"]) is None:
        raise HTTPException(status_code=404, detail="文档不存在")
    store.add_favorite(current_user["id"], doc_id)
    return {"ok": True, "favorited": True}


@router.delete("/documents/{doc_id}/favorite")
def remove_favorite(doc_id: str, current_user: dict = Depends(get_current_user)):
    """取消收藏。"""
    store.remove_favorite(current_user["id"], doc_id)
    return {"ok": True, "favorited": False}


@router.get("/favorites")
def list_favorites(current_user: dict = Depends(get_current_user)):
    """收藏列表（返回收藏的文档 meta）。"""
    doc_ids = store.list_favorites(current_user["id"])
    docs = [store.get(did, current_user["id"]) for did in doc_ids]
    return {
        "documents": [
            {
                "id": d["id"],
                "title": d["title"],
                "source": d["source"],
                "kb_id": d.get("kb_id"),
                "created_at": d["created_at"],
                "is_favorite": True,
            }
            for d in docs
            if d is not None
        ]
    }


@router.post("/documents/{doc_id}/share")
def create_share(doc_id: str, current_user: dict = Depends(get_current_user)):
    """生成/复用文档分享链接，返回 token（前端拼接 URL）。"""
    if store.get(doc_id, current_user["id"]) is None:
        raise HTTPException(status_code=404, detail="文档不存在")
    existing = store.get_share_by_doc(doc_id)
    if existing is not None:
        return {"token": existing["token"], "url": None}
    token = uuid.uuid4().hex
    store.create_share(doc_id, token)
    return {"token": token, "url": None}


@router.delete("/documents/{doc_id}/share")
def revoke_share(doc_id: str, current_user: dict = Depends(get_current_user)):
    """撤销文档分享链接。"""
    store.delete_share(doc_id)
    return {"ok": True}


@router.get("/share/{token}")
def get_shared_doc(token: str):
    """公开只读访问：通过分享链接查看文档（无需登录）。"""
    share = store.get_share_by_token(token)
    if share is None:
        raise HTTPException(status_code=404, detail="分享链接不存在或已失效")
    doc = store.get(share["doc_id"])
    if doc is None:
        raise HTTPException(status_code=404, detail="文档不存在")
    return {
        "id": doc["id"],
        "title": doc["title"],
        "text": doc["text"],
        "created_at": doc["created_at"],
    }


@router.post("/documents/import")
async def import_documents(
    file: UploadFile = File(...),
    kb_id: str | None = Form(None),
    current_user: dict = Depends(get_current_user),
):
    """上传文件（支持 md/txt/json/csv/pdf/docx/xlsx/zip），异步解析并入库。

    文件先流式写入临时文件（避免整读进内存），随后返回 task_id，
    后台线程执行解析 + 媒体保存 + 逐文档向量化入库，进度经
    GET /documents/import/{task_id} 查询。
    """
    filename = file.filename or "untitled"

    if kb_id:
        _require_kb_write(kb_id, current_user)

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
        target=_run_import_task,
        args=(task_id, tmp_path, filename, kb_id, current_user["id"]),
        daemon=True,
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
def chat(req: ChatRequest, current_user: dict = Depends(get_current_user)):
    if not req.query.strip():
        raise HTTPException(status_code=400, detail="问题不能为空")
    return qa.answer(req.query, req.top_k, req.history, current_user["id"])


@router.post("/chat/stream")
def chat_stream(req: ChatRequest, current_user: dict = Depends(get_current_user)):
    """流式问答（SSE）：citations → delta/sources → done
    路由：知识库命中→RAG；未命中+联网→联网搜索；未命中+无联网→通用对话
    """
    if not req.query.strip():
        raise HTTPException(status_code=400, detail="问题不能为空")

    from app.services.store import search

    history = req.history or []
    hits = search(req.query, req.top_k, current_user["id"])
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
                answer = qa.answer(req.query, req.top_k, history, current_user["id"])["answer"]
                yield f"data: {json.dumps({'type': 'delta', 'content': answer}, ensure_ascii=False)}\n\n"
        elif req.enable_web and web_search.available():
            # 未命中 + 联网开 → 联网搜索（流式，含来源）
            got = False
            for ev in web_search.search_stream(req.query, history):
                got = True
                yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
            if not got:
                answer = qa.answer(req.query, req.top_k, history, current_user["id"])["answer"]
                yield f"data: {json.dumps({'type': 'delta', 'content': answer}, ensure_ascii=False)}\n\n"
        else:
            # 未命中 + 无联网/未开 → 通用对话
            if llm.available():
                got = False
                for piece in llm.generate_stream(req.query, [], history):
                    got = True
                    yield f"data: {json.dumps({'type': 'delta', 'content': piece}, ensure_ascii=False)}\n\n"
                if not got:
                    answer = qa.answer(req.query, req.top_k, history, current_user["id"])["answer"]
                    yield f"data: {json.dumps({'type': 'delta', 'content': answer}, ensure_ascii=False)}\n\n"
            else:
                answer = qa.answer(req.query, req.top_k, history, current_user["id"])["answer"]
                yield f"data: {json.dumps({'type': 'delta', 'content': answer}, ensure_ascii=False)}\n\n"

        # 3. 结束标记
        yield f"data: {json.dumps({'type': 'done'})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.put("/documents/{doc_id}")
def update_document(
    doc_id: str, req: UpdateDocumentRequest, current_user: dict = Depends(get_current_user)
):
    """更新文档标题与正文（重新分片 + 向量化），可选移动文件夹/知识库。"""
    title = req.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="标题不能为空")

    kwargs: dict = {"title": title, "text": req.content}
    # 仅当请求体显式携带 folder_id 时才移动（null 表示移回根目录）
    if "folder_id" in req.model_fields_set:
        kwargs["folder_id"] = req.folder_id
    if "kb_id" in req.model_fields_set:
        kwargs["kb_id"] = req.kb_id
    if "sort_order" in req.model_fields_set:
        kwargs["sort_order"] = req.sort_order

    doc = store.update(doc_id, user_id=current_user["id"], **kwargs)
    if not doc:
        raise HTTPException(status_code=404, detail="文档不存在")
    return {
        "id": doc["id"],
        "title": doc["title"],
        "folder_id": doc.get("folder_id"),
        "kb_id": doc.get("kb_id"),
    }


@router.delete("/documents/{doc_id}")
def delete_document(doc_id: str, current_user: dict = Depends(get_current_user)):
    if store.delete(doc_id, current_user["id"]):
        return {"deleted": doc_id}
    raise HTTPException(status_code=404, detail="文档不存在")


# ---------- 文件夹 ----------

@router.get("/folders")
def list_folders(
    kb_id: str | None = None, current_user: dict = Depends(get_current_user)
):
    """文件夹列表（扁平，含 parent_id，供前端组装树）。"""
    return {"folders": store.list_folders(kb_id, current_user["id"])}


@router.post("/folders")
def create_folder(
    req: CreateFolderRequest, current_user: dict = Depends(get_current_user)
):
    name = req.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="文件夹名称不能为空")
    if req.kb_id:
        _require_kb_write(req.kb_id, current_user)
    folder = store.create_folder(
        name=name, parent_id=req.parent_id, kb_id=req.kb_id, user_id=current_user["id"]
    )
    return folder


@router.put("/folders/{folder_id}")
def rename_folder(
    folder_id: str,
    req: UpdateFolderRequest,
    current_user: dict = Depends(get_current_user),
):
    """重命名文件夹。"""
    name = req.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="文件夹名称不能为空")
    folder = store.rename_folder(folder_id, name, current_user["id"])
    if not folder:
        raise HTTPException(status_code=404, detail="文件夹不存在")
    return folder


@router.delete("/folders/{folder_id}")
def delete_folder(folder_id: str, current_user: dict = Depends(get_current_user)):
    if store.delete_folder(folder_id, current_user["id"]):
        return {"deleted": folder_id}
    raise HTTPException(status_code=404, detail="文件夹不存在")


class MoveFolderRequest(BaseModel):
    parent_id: str | None = None
    sort_order: float | None = None


@router.put("/folders/{folder_id}/move")
def move_folder(
    folder_id: str, req: MoveFolderRequest, current_user: dict = Depends(get_current_user)
):
    """移动文件夹（parent_id=None 表示移到根目录）。"""
    if store.move_folder(folder_id, req.parent_id, current_user["id"], req.sort_order):
        return {"moved": folder_id}
    raise HTTPException(status_code=400, detail="无法移动（目标位置非法或无权限）")


# ---------- 知识库 ----------

@router.get("/kbs")
def list_kbs(current_user: dict = Depends(get_current_user)):
    """知识库列表，含各自文档数与权限（owner/read/write）。"""
    kbs = store.list_kbs(current_user["id"])
    return {
        "kbs": [
            {
                "id": k["id"],
                "name": k["name"],
                "description": k.get("description"),
                "created_at": k["created_at"],
                "doc_count": store.count_docs(k["id"], current_user["id"]),
                "permission": k.get("permission", "owner"),
                "owner_id": k.get("user_id"),
            }
            for k in kbs
        ]
    }


@router.post("/kbs")
def create_kb(req: CreateKBRequest, current_user: dict = Depends(get_current_user)):
    name = req.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="名称不能为空")
    kb = store.create_kb(name=name, description=req.description, user_id=current_user["id"])
    return {
        "id": kb["id"],
        "name": kb["name"],
        "description": kb.get("description"),
        "created_at": kb["created_at"],
    }


@router.get("/kbs/{kb_id}")
def get_kb(kb_id: str, current_user: dict = Depends(get_current_user)):
    kb = store.get_kb(kb_id, current_user["id"])
    if not kb:
        raise HTTPException(status_code=404, detail="知识库不存在")
    return {
        "id": kb["id"],
        "name": kb["name"],
        "description": kb.get("description"),
        "created_at": kb["created_at"],
        "permission": _kb_permission(kb_id, current_user),
        "owner_id": kb.get("user_id"),
    }


@router.put("/kbs/{kb_id}")
def update_kb(
    kb_id: str, req: UpdateKBRequest, current_user: dict = Depends(get_current_user)
):
    kwargs: dict = {}
    if "name" in req.model_fields_set:
        name = (req.name or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="名称不能为空")
        kwargs["name"] = name
    if "description" in req.model_fields_set:
        kwargs["description"] = req.description
    kb = store.update_kb(kb_id, user_id=current_user["id"], **kwargs)
    if not kb:
        raise HTTPException(status_code=404, detail="知识库不存在")
    return kb


@router.delete("/kbs/{kb_id}")
def delete_kb(kb_id: str, current_user: dict = Depends(get_current_user)):
    if store.delete_kb(kb_id, current_user["id"]):
        return {"deleted": kb_id}
    raise HTTPException(status_code=404, detail="知识库不存在")


# ---------- 知识库共享（属主/管理员） ----------

@router.get("/kbs/{kb_id}/shares")
def list_shares(kb_id: str, current_user: dict = Depends(get_current_user)):
    """列出该知识库的共享成员（附用户信息）。"""
    _require_kb_owner(kb_id, current_user)
    shares = store.list_shares(kb_id)
    result = []
    for s in shares:
        u = store.get_user_by_id(s["user_id"])
        result.append(
            {
                "user_id": s["user_id"],
                "username": u["username"] if u else None,
                "nickname": (u.get("nickname") if u else None),
                "permission": s["permission"],
                "created_at": s["created_at"],
            }
        )
    return {"shares": result}


@router.post("/kbs/{kb_id}/shares")
def add_share(
    kb_id: str, req: AddShareRequest, current_user: dict = Depends(get_current_user)
):
    """把知识库共享给某用户（read/write）。属主/管理员可调。"""
    _require_kb_owner(kb_id, current_user)
    username = (req.username or "").strip()
    if not username:
        raise HTTPException(status_code=400, detail="用户名不能为空")
    permission = req.permission if req.permission in ("read", "write") else "read"
    target = store.get_user_by_username(username)
    if target is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    if target["id"] == current_user["id"]:
        raise HTTPException(status_code=400, detail="无需共享给自己")
    share = store.add_share(kb_id, target["id"], permission)
    return {
        "user_id": target["id"],
        "username": target["username"],
        "nickname": target.get("nickname"),
        "permission": share["permission"],
    }


@router.delete("/kbs/{kb_id}/shares/{user_id}")
def remove_share(
    kb_id: str, user_id: str, current_user: dict = Depends(get_current_user)
):
    """移除共享成员。属主/管理员可调。"""
    _require_kb_owner(kb_id, current_user)
    if store.remove_share(kb_id, user_id):
        return {"removed": user_id}
    raise HTTPException(status_code=404, detail="共享记录不存在")


@router.get("/users/search")
def search_users(q: str = "", current_user: dict = Depends(get_current_user)):
    """按用户名/昵称搜索用户（供共享对话框选择协作者，仅返回基本信息）。"""
    query = (q or "").strip().lower()
    users = store.list_users()
    matched = [
        u
        for u in users
        if query
        and (
            query in (u.get("username") or "").lower()
            or query in (u.get("nickname") or "").lower()
        )
    ]
    return {
        "users": [
            {
                "id": u["id"],
                "username": u["username"],
                "nickname": u.get("nickname") or u["username"],
            }
            for u in matched[:20]
        ]
    }


# ---------- 最近浏览 ----------

@router.post("/recent")
def record_recent(
    req: RecordRecentRequest, current_user: dict = Depends(get_current_user)
):
    rec = store.record_recent(req.doc_id, current_user["id"])
    if rec is None:
        raise HTTPException(status_code=404, detail="文档不存在")
    return rec


@router.get("/recent")
def list_recent(limit: int = 20, current_user: dict = Depends(get_current_user)):
    return {"recent": store.list_recent(limit, current_user["id"])}


# ---------- 导出 ----------

@router.post("/export")
def export_documents(req: ExportRequest, current_user: dict = Depends(get_current_user)):
    """多格式导出：md/docx/pdf/html/json/zip。doc_ids 为空导出当前用户全部。"""
    docs = store.all(user_id=current_user["id"])
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


# ---------- 认证 / 用户 ----------

def _public_user(user: dict) -> dict:
    """剔除 password_hash 后的用户信息。"""
    return {
        "id": user["id"],
        "username": user["username"],
        "role": user.get("role", "user"),
        "nickname": user.get("nickname") or user["username"],
        "email": user.get("email"),
        "avatar": user.get("avatar"),
        "status": user.get("status", "active"),
        "created_at": user.get("created_at"),
    }


def _validate_credentials(username: str, password: str) -> tuple[str, str]:
    username = (username or "").strip()
    if not username:
        raise HTTPException(status_code=400, detail="用户名不能为空")
    if len(username) > 32:
        raise HTTPException(status_code=400, detail="用户名过长（最多 32 字符）")
    if not password or len(password) < 6:
        raise HTTPException(status_code=400, detail="密码至少 6 位")
    return username, password


def _validate_new_password(password: str) -> str:
    if not password or len(password) < 6:
        raise HTTPException(status_code=400, detail="密码至少 6 位")
    return password


@router.post("/auth/register")
def register(req: RegisterRequest, admin: dict = Depends(require_admin)):
    """创建用户（仅管理员；开放注册已关闭）。"""
    username, password = _validate_credentials(req.username, req.password)
    if store.get_user_by_username(username):
        raise HTTPException(status_code=409, detail="用户名已存在")
    user = store.create_user(username, auth.hash_password(password))
    if user is None:
        raise HTTPException(status_code=409, detail="用户名已存在")
    return {"user": _public_user(user)}


@router.post("/auth/login")
def login(req: LoginRequest):
    username = (req.username or "").strip()
    if not username or not req.password:
        raise HTTPException(status_code=400, detail="用户名和密码不能为空")
    user = store.get_user_by_username(username)
    if user is None or not auth.verify_password(req.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    if user.get("status") != "active":
        raise HTTPException(status_code=403, detail="账号已被禁用")
    token = auth.issue_token(user["id"])
    return {"token": token, "user": _public_user(user)}


@router.get("/auth/me")
def me(current_user: dict = Depends(get_current_user)):
    return {"user": _public_user(current_user)}


@router.put("/auth/me")
def update_me(req: UpdateMeRequest, current_user: dict = Depends(get_current_user)):
    """更新自己的昵称/邮箱/头像。"""
    kwargs: dict = {}
    if "nickname" in req.model_fields_set and req.nickname is not None:
        kwargs["nickname"] = req.nickname.strip()
    if "email" in req.model_fields_set:
        kwargs["email"] = req.email
    if "avatar" in req.model_fields_set:
        kwargs["avatar"] = req.avatar
    user = store.update_user(current_user["id"], **kwargs)
    return {"user": _public_user(user)}


@router.post("/auth/me/password")
def change_password(
    req: ChangePasswordRequest, current_user: dict = Depends(get_current_user)
):
    """修改密码：校验旧密码，吊销旧 token，返回新 token。"""
    if not auth.verify_password(req.old_password, current_user["password_hash"]):
        raise HTTPException(status_code=400, detail="旧密码错误")
    new_password = _validate_new_password(req.new_password)
    store.update_user(
        current_user["id"], password_hash=auth.hash_password(new_password)
    )
    auth.revoke_all_for_user(current_user["id"])
    token = auth.issue_token(current_user["id"])
    return {"ok": True, "token": token}


@router.post("/auth/logout")
def logout(authorization: str | None = Header(None)):
    token = _bearer_token(authorization)
    if token:
        auth.revoke_token(token)
    return {"ok": True}


# ---------- 用户管理（仅管理员） ----------

def _admin_count_excluding(user_id: str | None = None) -> int:
    """统计除某用户外的「有效管理员」数量（用于保护最后一个 admin）。"""
    return sum(
        1
        for u in store.list_users()
        if u.get("role") == "admin"
        and u.get("status") == "active"
        and u["id"] != user_id
    )


@router.get("/users")
def list_users(admin: dict = Depends(require_admin)):
    return {"users": [_public_user(u) for u in store.list_users()]}


@router.post("/users")
def create_user(req: CreateUserRequest, admin: dict = Depends(require_admin)):
    username, password = _validate_credentials(req.username, req.password)
    if store.get_user_by_username(username):
        raise HTTPException(status_code=409, detail="用户名已存在")
    role = req.role if req.role in ("admin", "user") else "user"
    user = store.create_user(
        username,
        auth.hash_password(password),
        role=role,
        nickname=req.nickname,
        email=req.email,
    )
    if user is None:
        raise HTTPException(status_code=409, detail="用户名已存在")
    return {"user": _public_user(user)}


@router.put("/users/{user_id}")
def update_user(
    user_id: str, req: UpdateUserRequest, admin: dict = Depends(require_admin)
):
    target = store.get_user_by_id(user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="用户不存在")

    kwargs: dict = {}
    if "nickname" in req.model_fields_set and req.nickname is not None:
        kwargs["nickname"] = req.nickname.strip()
    if "email" in req.model_fields_set:
        kwargs["email"] = req.email
    if "role" in req.model_fields_set and req.role in ("admin", "user"):
        kwargs["role"] = req.role
    if "status" in req.model_fields_set and req.status in ("active", "disabled"):
        kwargs["status"] = req.status

    # 保护最后一个管理员：降级 / 禁用时保证仍有至少一个有效 admin
    demoting = kwargs.get("role") == "user" and target.get("role") == "admin"
    disabling = kwargs.get("status") == "disabled" and target.get("status") == "active"
    if demoting and _admin_count_excluding(user_id) == 0:
        raise HTTPException(status_code=400, detail="不能降级最后一个管理员")
    if disabling and target.get("role") == "admin" and _admin_count_excluding(user_id) == 0:
        raise HTTPException(status_code=400, detail="不能禁用最后一个管理员")
    if user_id == admin["id"] and kwargs.get("status") == "disabled":
        raise HTTPException(status_code=400, detail="不能禁用自己的账号")

    user = store.update_user(user_id, **kwargs)
    if user is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    # 角色/状态变更后强制该用户下线
    if "role" in kwargs or "status" in kwargs:
        auth.revoke_all_for_user(user_id)
    return {"user": _public_user(user)}


@router.delete("/users/{user_id}")
def delete_user(user_id: str, admin: dict = Depends(require_admin)):
    target = store.get_user_by_id(user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    if user_id == admin["id"]:
        raise HTTPException(status_code=400, detail="不能删除自己的账号")
    if target.get("role") == "admin" and _admin_count_excluding(user_id) == 0:
        raise HTTPException(status_code=400, detail="不能删除最后一个管理员")
    if store.delete_user(user_id):
        auth.revoke_all_for_user(user_id)
        return {"deleted": user_id}
    raise HTTPException(status_code=404, detail="用户不存在")


@router.post("/users/{user_id}/reset-password")
def reset_password(
    user_id: str, req: ResetPasswordRequest, admin: dict = Depends(require_admin)
):
    target = store.get_user_by_id(user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    new_password = _validate_new_password(req.new_password)
    store.update_user(user_id, password_hash=auth.hash_password(new_password))
    auth.revoke_all_for_user(user_id)
    return {"ok": True}


# ---------- 回收站 / 标签 / 置顶 / AI 摘要 ----------

class SetTagsRequest(BaseModel):
    tags: list[str]


class RenameDocumentRequest(BaseModel):
    title: str


@router.post("/documents/{doc_id}/duplicate")
def duplicate_document(doc_id: str, current_user: dict = Depends(get_current_user)):
    """复制文档（标题加「（副本）」）。"""
    new_doc = store.duplicate(doc_id, current_user["id"])
    if new_doc is None:
        raise HTTPException(status_code=404, detail="文档不存在")
    return {"id": new_doc["id"], "title": new_doc["title"], "kb_id": new_doc.get("kb_id")}


@router.put("/documents/{doc_id}/rename")
def rename_document(
    doc_id: str, req: RenameDocumentRequest, current_user: dict = Depends(get_current_user)
):
    """目录树内直接重命名文档。"""
    title = req.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="标题不能为空")
    doc = store.update(doc_id, title=title, user_id=current_user["id"])
    if doc is None:
        raise HTTPException(status_code=404, detail="文档不存在或无权限")
    return {"id": doc_id, "title": title}


@router.get("/trash")
def list_trash(current_user: dict = Depends(get_current_user)):
    """回收站列表（文档/文件夹/知识库）。"""
    return store.list_trash(current_user["id"])


@router.post("/trash/{kind}/{obj_id}/restore")
def restore_trash(kind: str, obj_id: str, current_user: dict = Depends(get_current_user)):
    """从回收站恢复。kind: document/folder/kb。"""
    if kind not in ("document", "folder", "kb"):
        raise HTTPException(status_code=400, detail="无效的对象类型")
    if store.restore(kind, obj_id, current_user["id"]):
        return {"restored": obj_id}
    raise HTTPException(status_code=404, detail="对象不存在或不在回收站")


@router.delete("/trash/{kind}/{obj_id}")
def purge_trash(kind: str, obj_id: str, current_user: dict = Depends(get_current_user)):
    """彻底删除回收站对象。kind: document/folder/kb。"""
    if kind not in ("document", "folder", "kb"):
        raise HTTPException(status_code=400, detail="无效的对象类型")
    if store.purge(kind, obj_id, current_user["id"]):
        return {"purged": obj_id}
    raise HTTPException(status_code=404, detail="对象不存在")


@router.put("/documents/{doc_id}/tags")
def set_document_tags(
    doc_id: str, req: SetTagsRequest, current_user: dict = Depends(get_current_user)
):
    """设置文档标签。"""
    if store.get(doc_id, current_user["id"]) is None:
        raise HTTPException(status_code=404, detail="文档不存在")
    tags = [t.strip() for t in req.tags if t and t.strip()][:10]
    store.set_tags(doc_id, tags)
    return {"tags": tags}


@router.get("/tags")
def list_tags(current_user: dict = Depends(get_current_user)):
    """列出当前用户可见的所有标签。"""
    return {"tags": store.list_all_tags(current_user["id"])}


@router.post("/documents/{doc_id}/pin")
def pin_document(doc_id: str, current_user: dict = Depends(get_current_user)):
    """置顶文档。"""
    if store.get(doc_id, current_user["id"]) is None:
        raise HTTPException(status_code=404, detail="文档不存在")
    store.set_pinned(doc_id, True)
    return {"pinned": True}


@router.post("/documents/{doc_id}/unpin")
def unpin_document(doc_id: str, current_user: dict = Depends(get_current_user)):
    """取消置顶。"""
    store.set_pinned(doc_id, False)
    return {"pinned": False}


@router.post("/documents/{doc_id}/summary")
def generate_summary(doc_id: str, current_user: dict = Depends(get_current_user)):
    """用 AI 生成文档摘要并保存。"""
    doc = store.get(doc_id, current_user["id"])
    if doc is None:
        raise HTTPException(status_code=404, detail="文档不存在")
    summary = llm.summarize(doc["text"])
    if summary is None:
        raise HTTPException(status_code=503, detail="AI 服务不可用，请稍后再试")
    store.set_summary(doc_id, summary)
    return {"summary": summary}
