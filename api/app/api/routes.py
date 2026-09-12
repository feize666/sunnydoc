"""API 路由"""
from __future__ import annotations

import asyncio
import io
import json
import os
import shutil
import tempfile
import threading
import time
import uuid
import zipfile
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from app.core.config import DEFAULT_TOP_K, MEDIA_DIR, DATA_DIR, TEXT_EXTS, ai_config
from app.services import media, parser, qa, llm, web_search, exporter, auth, settings
from app.services.store import store

router = APIRouter(prefix="/api/v1")

# ---------- SSE 实时推送：订阅者管理 ----------
# 单进程内存订阅表：user_id / doc_id -> {(asyncio.Queue, event_loop)}
# 同步端点运行在线程池，推送时用 loop.call_soon_threadsafe 安全跨线程入队。
_notify_subscribers: dict[str, set[tuple[asyncio.Queue, asyncio.AbstractEventLoop]]] = {}
_doc_subscribers: dict[str, set[tuple[asyncio.Queue, asyncio.AbstractEventLoop]]] = {}
_subs_lock = threading.Lock()


def _safe_put(q: asyncio.Queue, event: dict) -> None:
    try:
        q.put_nowait(event)
    except asyncio.QueueFull:
        pass


def publish_notification(user_id: str, event: dict) -> None:
    """向某用户的 SSE 订阅者推送事件（非阻塞，跨线程安全）。"""
    for q, loop in list(_notify_subscribers.get(user_id, ())):
        try:
            loop.call_soon_threadsafe(_safe_put, q, event)
        except RuntimeError:
            pass


def publish_comment(doc_id: str, event: dict) -> None:
    """向某文档的 SSE 订阅者推送事件。"""
    for q, loop in list(_doc_subscribers.get(doc_id, ())):
        try:
            loop.call_soon_threadsafe(_safe_put, q, event)
        except RuntimeError:
            pass

# ---------- AI 对话附件（会话内临时） ----------
# attachment_id -> {filename, ext, kind, size, text, tmp_path, preview_url, user_id, created_at}
_attachments: dict[str, dict] = {}
_attachments_lock = threading.Lock()
_ATTACHMENT_TTL = 24 * 3600  # 24 小时过期自动清理
_ATTACHMENT_TEXT_MAX = 20000  # 附件文本注入上限（字符）


def _get_attachment(attachment_id: str, user_id: str) -> dict | None:
    """取附件（校验归属），顺带清理过期附件及其临时文件。"""
    with _attachments_lock:
        now = time.time()
        stale = [k for k, v in _attachments.items() if now - v["created_at"] > _ATTACHMENT_TTL]
        for k in stale:
            try:
                os.unlink(_attachments[k]["tmp_path"])
            except OSError:
                pass
            _attachments.pop(k, None)
        att = _attachments.get(attachment_id)
        if not att or att["user_id"] != user_id:
            return None
        return att

# 上传文件落盘临时目录（避免整读进内存）
TMP_DIR = DATA_DIR / "tmp"
TMP_DIR.mkdir(parents=True, exist_ok=True)

# 图片上传目录（编辑器粘贴上传）
UPLOAD_DIR = MEDIA_DIR / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
ALLOWED_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp"}

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


def _audit(user: dict, action: str, target_type: str, target_id: str | None, detail: str) -> None:
    """写入审计日志（失败静默，不影响主流程）。"""
    try:
        store.add_audit_log(user.get("id"), action, target_type, target_id, detail)
    except Exception:  # noqa: BLE001
        pass


class ChatRequest(BaseModel):
    query: str
    top_k: int = DEFAULT_TOP_K
    history: list[dict[str, str]] | None = None
    enable_web: bool = True
    attachments: list[str] | None = None  # 附件 id 列表（AI 对话上传的附件）


class DeleteRequest(BaseModel):
    doc_id: str


class CreateDocumentRequest(BaseModel):
    title: str
    content: str = ""
    kb_id: str | None = None
    folder_id: str | None = None
    type: str = "doc"


class UpdateDocumentRequest(BaseModel):
    title: str | None = None
    content: str | None = None
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
    kb_id: str | None = None


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


class CreateCommentRequest(BaseModel):
    content: str
    quote: str | None = None
    parent_id: str | None = None
    mentions: list[str] | None = None


class AIAssistRequest(BaseModel):
    action: str  # polish / translate_en / translate_zh / summarize / continue / explain
    text: str


class AISettingsRequest(BaseModel):
    """AI 功能配置（供应商 + 自定义 base_url / key / model）。"""

    provider: str = "custom"  # openai / qwen / deepseek / zhipu / moonshot / siliconflow / ollama / custom
    llm_base_url: str = ""
    llm_api_key: str = ""
    llm_model: str = ""
    embedding_base_url: str = ""
    embedding_api_key: str = ""
    embedding_model: str = ""
    rerank_base_url: str = ""
    rerank_model: str = ""


class AITestRequest(BaseModel):
    """测试连通性 / 拉模型列表的入参：可指定当前编辑中的 base_url/key/model，
    也可传 saved=true 表示读取已保存配置。
    """

    base_url: str = ""
    api_key: str = ""
    model: str = ""
    saved: bool = False  # true 时使用当前已保存配置


class CustomProvider(BaseModel):
    """用户命名的自定义供应商预设。"""

    id: str = ""
    name: str = ""
    provider: str = "custom"
    llm_base_url: str = ""
    llm_api_key: str = ""
    llm_model: str = ""
    embedding_base_url: str = ""
    embedding_api_key: str = ""
    embedding_model: str = ""
    rerank_base_url: str = ""
    rerank_model: str = ""


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
    额外支持知识库导出包（含 manifest.json）：跳过清单、去掉顶层知识库目录、跳过 media 目录。
    """
    parsed: list[dict] = []
    media_files: list[parser.MediaFile] = []
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        infos = [i for i in zf.infolist() if not i.is_dir()]
        total = len(infos)

        # 检测知识库导出包：含 manifest.json，其父目录即知识库名
        top_prefix = ""
        is_kb_export = False
        for info in infos:
            nm = parser._decode_zip_filename(info).replace("\\", "/").lstrip("/")
            if nm.endswith("manifest.json"):
                is_kb_export = True
                top_prefix = nm.rsplit("/", 1)[0]
                break

        for idx, info in enumerate(infos, 1):
            name = parser._decode_zip_filename(info)
            ext = parser.ext_of(name)
            raw = zf.read(info)
            norm = name.replace("\\", "/").lstrip("/")

            # 跳过 manifest.json 清单
            if norm.endswith("manifest.json"):
                progress_cb(idx, total, name)
                continue

            # 导出包：去掉顶层知识库目录前缀
            if is_kb_export and top_prefix:
                if norm == top_prefix:
                    norm = ""
                elif norm.startswith(top_prefix + "/"):
                    norm = norm[len(top_prefix) + 1 :]

            # 导出包的 media 目录：跳过（md 内 /api/v1/media 引用保持原样）
            if is_kb_export and (norm == "media" or norm.startswith("media/")):
                progress_cb(idx, total, name)
                continue

            if ext in TEXT_EXTS:
                text = raw.decode("utf-8", errors="replace")
                parsed.append({"name": norm, "ext": ext, "text": text})
            elif ext == ".pdf":
                parsed.append({"name": norm, "ext": ext, "text": parser.parse_pdf(raw)})
            elif ext == ".docx":
                parsed.append({"name": norm, "ext": ext, "text": parser.parse_docx(raw)})
            elif ext == ".xlsx":
                parsed.append({"name": norm, "ext": ext, "text": parser.parse_xlsx(raw)})
            elif ext in parser.MEDIA_EXTS:
                zip_path = norm.lstrip("/")
                media_files.append(
                    parser.MediaFile(
                        zip_path=zip_path,
                        filename=norm.rsplit("/", 1)[-1],
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


# ---------- AI 功能配置 ----------

def _mask_secret(s: str) -> str:
    """脱敏：保留前 4 后 4，中间打码；过短则全打码。"""
    if not s:
        return ""
    if len(s) <= 8:
        return "*" * len(s)
    return s[:4] + "*" * (len(s) - 8) + s[-4:]


@router.get("/settings/ai")
def get_ai_settings(admin: dict = Depends(require_admin)):
    """读取 AI 配置（key 脱敏）。"""
    cfg = ai_config()
    return {
        "provider": cfg.get("provider", "custom"),
        "llm_base_url": cfg.get("llm_base_url", ""),
        "llm_api_key": _mask_secret(cfg.get("llm_api_key", "")),
        "llm_model": cfg.get("llm_model", ""),
        "embedding_base_url": cfg.get("embedding_base_url", ""),
        "embedding_api_key": _mask_secret(cfg.get("embedding_api_key", "")),
        "embedding_model": cfg.get("embedding_model", ""),
        "rerank_base_url": cfg.get("rerank_base_url", ""),
        "rerank_model": cfg.get("rerank_model", ""),
        "llm_configured": bool(cfg.get("llm_api_key")),
        "embedding_configured": bool(cfg.get("embedding_api_key")),
    }


@router.put("/settings/ai")
def update_ai_settings(req: AISettingsRequest, admin: dict = Depends(require_admin)):
    """保存 AI 配置。key 未传（空串）表示不修改，原样保留已有 key。"""
    existing = ai_config()
    payload = {
        "provider": req.provider or "custom",
        "llm_base_url": req.llm_base_url.strip(),
        "llm_model": req.llm_model.strip(),
        "embedding_base_url": req.embedding_base_url.strip(),
        "embedding_model": req.embedding_model.strip(),
        "rerank_base_url": req.rerank_base_url.strip(),
        "rerank_model": req.rerank_model.strip(),
    }
    # api key：仅当用户传入了非空新 key 时才覆盖；空串表示保持原样（不清空）
    if req.llm_api_key.strip():
        payload["llm_api_key"] = req.llm_api_key.strip()
    else:
        payload["llm_api_key"] = existing.get("llm_api_key", "")
    if req.embedding_api_key.strip():
        payload["embedding_api_key"] = req.embedding_api_key.strip()
    else:
        payload["embedding_api_key"] = existing.get("embedding_api_key", "")

    settings.set_json("ai_config", payload)
    return {"ok": True, "provider": payload["provider"]}


def _resolve_test_params(req: AITestRequest) -> tuple[str, str, str]:
    """从请求 + 已保存配置中解析 base_url/api_key/model。"""
    saved = ai_config() if req.saved else {}
    base = (req.base_url or saved.get("llm_base_url") or "").strip()
    # api_key: 请求中空时使用已保存的（GET 时已脱敏，不能直接当真实 key 用 —— 仅允许 saved=true）
    if req.api_key:
        key = req.api_key.strip()
    elif req.saved:
        key = (saved.get("llm_api_key") or "").strip()
    else:
        key = ""
    model = (req.model or saved.get("llm_model") or "").strip()
    return base, key, model


@router.post("/settings/ai/test")
def test_ai_settings(req: AITestRequest, admin: dict = Depends(require_admin)):
    """连通性测试：用 ping 调一次 chat/completions，返回 ok/status/detail。"""
    base, key, model = _resolve_test_params(req)
    if not base:
        return {"ok": False, "status": -1, "detail": "请填写 Base URL", "content": ""}
    if not key:
        return {"ok": False, "status": -1, "detail": "请填写 API Key（已保存的密钥不会回显，无法用于测试）", "content": ""}
    if not model:
        return {"ok": False, "status": -1, "detail": "请填写模型名（或先点「获取模型列表」）", "content": ""}
    return llm.test_connection(base, key, model)


@router.post("/settings/ai/models")
def list_ai_models(req: AITestRequest, admin: dict = Depends(require_admin)):
    """拉取 {base_url}/models 的模型列表。"""
    saved = ai_config() if req.saved else {}
    base = (req.base_url or saved.get("llm_base_url") or "").strip()
    if req.api_key:
        key = req.api_key.strip()
    elif req.saved:
        key = (saved.get("llm_api_key") or "").strip()
    else:
        key = ""
    if not base:
        return {"ok": False, "status": -1, "models": [], "detail": "请填写 Base URL"}
    if not key:
        return {"ok": False, "status": -1, "models": [], "detail": "请填写 API Key（已保存的密钥不会回显，需重新填入）"}
    return llm.fetch_models(base, key)


CUSTOM_PROVIDERS_KEY = "custom_providers"


def _load_custom_providers() -> list[dict]:
    return settings.get_json(CUSTOM_PROVIDERS_KEY, []) or []


def _save_custom_providers(items: list[dict]) -> None:
    settings.set_json(CUSTOM_PROVIDERS_KEY, items)


def _mask_custom(p: dict) -> dict:
    """对自定义预设的 key 做脱敏。"""
    out = dict(p)
    if out.get("llm_api_key"):
        out["llm_api_key"] = _mask_secret(out["llm_api_key"])
    if out.get("embedding_api_key"):
        out["embedding_api_key"] = _mask_secret(out["embedding_api_key"])
    return out


@router.get("/settings/ai/custom-providers")
def list_custom_providers(admin: dict = Depends(require_admin)):
    items = _load_custom_providers()
    return {"providers": [_mask_custom(p) for p in items]}


@router.post("/settings/ai/custom-providers")
def upsert_custom_provider(req: CustomProvider, admin: dict = Depends(require_admin)):
    """新增/更新用户命名的供应商预设。空 id 自动生成。"""
    items = _load_custom_providers()
    name = (req.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="请填写预设名称")
    new_id = (req.id or "").strip() or f"cp-{int(time.time() * 1000)}"
    # 已存在 id 则覆盖，否则追加
    existing_idx = next((i for i, p in enumerate(items) if p.get("id") == new_id), -1)
    # key 处理：传了非空 key 才覆盖（空串视为保留原 key）
    llm_key = req.llm_api_key.strip()
    emb_key = req.embedding_api_key.strip()
    if existing_idx >= 0:
        old = items[existing_idx]
        if not llm_key:
            llm_key = old.get("llm_api_key", "")
        if not emb_key:
            emb_key = old.get("embedding_api_key", "")
    payload = {
        "id": new_id,
        "name": name,
        "provider": req.provider or "custom",
        "llm_base_url": req.llm_base_url.strip(),
        "llm_api_key": llm_key,
        "llm_model": req.llm_model.strip(),
        "embedding_base_url": req.embedding_base_url.strip(),
        "embedding_api_key": emb_key,
        "embedding_model": req.embedding_model.strip(),
        "rerank_base_url": req.rerank_base_url.strip(),
        "rerank_model": req.rerank_model.strip(),
    }
    if existing_idx >= 0:
        items[existing_idx] = payload
    else:
        items.append(payload)
    _save_custom_providers(items)
    return {"ok": True, "id": new_id, "provider": _mask_custom(payload)}


@router.delete("/settings/ai/custom-providers/{cp_id}")
def delete_custom_provider(cp_id: str, admin: dict = Depends(require_admin)):
    items = _load_custom_providers()
    new_items = [p for p in items if p.get("id") != cp_id]
    if len(new_items) == len(items):
        return {"ok": False, "not_found": True}
    _save_custom_providers(new_items)
    return {"ok": True}


@router.get("/search")
def search_documents(
    q: str,
    kb_id: str | None = None,
    limit: int = 50,
    type: str | None = None,
    tag: str | None = None,
    sort: str = "relevance",
    current_user: dict = Depends(get_current_user),
):
    """全文搜索：在文档标题/正文中大小写不敏感地匹配关键词，返回带片段的命中列表。

    kb_id 提供时仅在指定知识库内搜索；type 按节点类型过滤；tag 按标签过滤；
    sort=relevance（标题命中优先）/ created（按更新时间倒序）。
    """
    query = q.strip()
    if not query:
        return {"query": q, "total": 0, "results": []}

    ql = query.lower()
    results: list[dict] = []
    for d in store.all(kb_id, current_user["id"]):
        if type and d.get("type", "doc") != type:
            continue
        if tag and tag not in (d.get("tags") or []):
            continue
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
                "type": d.get("type", "doc"),
                "tags": d.get("tags") or [],
                "created_at": d.get("created_at"),
            }
        )

    if sort == "created":
        results.sort(key=lambda r: r.get("created_at") or 0, reverse=True)
    else:
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
    _audit(current_user, "create", "doc", doc["id"], f"创建文档「{doc['title']}」")
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
        "sort_order": doc.get("sort_order"),
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
def create_share(doc_id: str, payload: dict | None = None, current_user: dict = Depends(get_current_user)):
    """生成/复用文档分享链接，返回 token（前端拼接 URL）。

    可选 payload：{"password": "...", "expires_in": 秒}（0/缺省表示永久）。
    """
    if store.get(doc_id, current_user["id"]) is None:
        raise HTTPException(status_code=404, detail="文档不存在")
    existing = store.get_share_by_doc(doc_id)
    if existing is not None:
        return {"token": existing["token"], "url": None, "password": existing.get("password"), "expires_at": existing.get("expires_at")}
    payload = payload or {}
    password = (payload.get("password") or "").strip() or None
    expires_in = payload.get("expires_in")
    expires_at = None
    if expires_in:
        try:
            expires_at = time.time() + float(expires_in)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="有效期格式不正确")
    token = uuid.uuid4().hex
    store.create_share(doc_id, token, password, expires_at)
    return {"token": token, "url": None, "password": password, "expires_at": expires_at}


@router.delete("/documents/{doc_id}/share")
def revoke_share(doc_id: str, current_user: dict = Depends(get_current_user)):
    """撤销文档分享链接。"""
    store.delete_share(doc_id)
    return {"ok": True}


@router.get("/share/{token}")
def get_shared_doc(token: str, password: str | None = None):
    """公开只读访问：通过分享链接查看文档（无需登录）。

    若分享设置了密码，需通过 ?password= 提供正确密码；
    若设置了有效期，过期后返回 410 Gone。
    """
    share = store.get_share_by_token(token)
    if share is None:
        raise HTTPException(status_code=404, detail="分享链接不存在或已失效")
    # 有效期校验
    expires_at = share.get("expires_at")
    if expires_at and time.time() > expires_at:
        raise HTTPException(status_code=410, detail="分享链接已过期")
    # 密码校验
    if share.get("password"):
        if not password or password != share["password"]:
            raise HTTPException(status_code=401, detail="需要密码访问")
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

    # 读取附件：提取文字（文档/zip/图片 OCR）与图片（vision）
    attach_texts: list[str] = []
    attach_images: list[str] = []
    for aid in req.attachments or []:
        att = _get_attachment(aid, current_user["id"])
        if att is None:
            continue
        if att.get("text"):
            attach_texts.append(f"[附件：{att['filename']}]\n{att['text']}")
        if att["kind"] == "image" and llm.supports_vision():
            try:
                import base64

                img_bytes = open(att["tmp_path"], "rb").read()
                mime = media.content_type(att["ext"])
                attach_images.append(f"data:{mime};base64,{base64.b64encode(img_bytes).decode()}")
            except OSError:
                pass
    attachment_context = "\n\n".join(attach_texts)

    def _fallback_answer() -> str:
        """LLM 不可用或失败时，基于知识库命中片段给出降级回答。"""
        if not hits:
            return "未命中知识库片段，且当前大模型服务暂不可用，无法生成回答。请检查 AI 配置或补充相关文档。"
        top = hits[0]
        body = top["text"][:300]
        extra = f"\n\n（共命中 {len(hits)} 个相关片段）" if len(hits) > 1 else ""
        return f"根据知识库中的「{top['title']}」，找到以下相关内容：\n\n{body}{extra}"

    def event_stream():
        # 1. 先发引用（含状态：是否本地命中、联网搜索是否可用）
        meta = {
            "type": "citations",
            "citations": citations,
            "hits_empty": len(hits) == 0,
            "web_available": bool(web_search.available()),
            "llm_available": bool(llm.available()),
        }
        yield f"data: {json.dumps(meta, ensure_ascii=False)}\n\n"

        # 2. 生成回答
        if hits or attachment_context or attach_images:
            # 知识库命中 或 带附件 → RAG/附件模式（附件文字拼到上下文，图片走 vision）
            contexts = [h["text"] for h in hits]
            if attachment_context:
                contexts = [attachment_context] + contexts
            try:
                got = False
                for piece in llm.generate_stream(req.query, contexts, history, attach_images or None):
                    got = True
                    yield f"data: {json.dumps({'type': 'delta', 'content': piece}, ensure_ascii=False)}\n\n"
                if not got:
                    yield f"data: {json.dumps({'type': 'delta', 'content': _fallback_answer()}, ensure_ascii=False)}\n\n"
            except llm.LLMError as e:
                # 大模型出错 → 降级为规则式回答 + 透传错误提示
                yield f"data: {json.dumps({'type': 'delta', 'content': _fallback_answer() + f'\\n\\n（大模型错误 {e.status}：已自动降级使用知识库片段）'}, ensure_ascii=False)}\n\n"
        elif req.enable_web and web_search.available():
            # 未命中 + 联网开 → 联网搜索（流式，含来源）
            try:
                got = False
                for ev in web_search.search_stream(req.query, history):
                    got = True
                    yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
                if not got:
                    yield f"data: {json.dumps({'type': 'delta', 'content': _fallback_answer()}, ensure_ascii=False)}\n\n"
            except llm.LLMError as e:
                yield f"data: {json.dumps({'type': 'delta', 'content': _fallback_answer() + f'\\n\\n（大模型错误 {e.status}：已自动降级使用知识库片段）'}, ensure_ascii=False)}\n\n"
        else:
            # 未命中 + 无联网/未开 → 通用对话
            try:
                if llm.available():
                    got = False
                    for piece in llm.generate_stream(req.query, [], history):
                        got = True
                        yield f"data: {json.dumps({'type': 'delta', 'content': piece}, ensure_ascii=False)}\n\n"
                    if not got:
                        yield f"data: {json.dumps({'type': 'delta', 'content': _fallback_answer()}, ensure_ascii=False)}\n\n"
                else:
                    yield f"data: {json.dumps({'type': 'delta', 'content': _fallback_answer()}, ensure_ascii=False)}\n\n"
            except llm.LLMError as e:
                yield f"data: {json.dumps({'type': 'delta', 'content': _fallback_answer() + f'\\n\\n（大模型错误 {e.status}：已自动降级使用知识库片段）'}, ensure_ascii=False)}\n\n"

        # 3. 结束标记
        yield f"data: {json.dumps({'type': 'done'})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


class ImportAttachmentRequest(BaseModel):
    kb_id: str | None = None


@router.post("/chat/attachments")
async def upload_chat_attachment(
    file: UploadFile = File(...), current_user: dict = Depends(get_current_user)
):
    """上传对话附件（图片/文档/压缩包），解析提取文字，返回附件元数据。

    附件存于临时目录（会话内临时，24h 过期）；图片额外生成可访问预览 URL，
    并 OCR 提取文字；文档/zip 复用 parser 提取文字。
    """
    filename = file.filename or "untitled"
    ext = parser.ext_of(filename)

    if ext in parser.IMAGE_EXTS:
        kind = "image"
    elif ext == ".zip":
        kind = "zip"
    elif ext in TEXT_EXTS or ext in {".pdf", ".docx", ".xlsx"}:
        kind = "doc"
    else:
        raise HTTPException(
            status_code=400,
            detail="仅支持图片（png/jpg/gif/webp）、文档（md/txt/pdf/docx/xlsx/csv/json）、压缩包（zip）",
        )

    fd, tmp_path = tempfile.mkstemp(dir=str(TMP_DIR), suffix=ext)
    try:
        with os.fdopen(fd, "wb") as out:
            shutil.copyfileobj(file.file, out)
    except Exception:  # noqa: BLE001
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise HTTPException(status_code=400, detail="文件接收失败")

    size = os.path.getsize(tmp_path)
    if size == 0:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise HTTPException(status_code=400, detail="文件为空")

    try:
        data = open(tmp_path, "rb").read()
    except OSError:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise HTTPException(status_code=400, detail="文件读取失败")

    text = ""
    preview_url = None
    if kind == "image":
        text = parser.parse_image(data)
        name = f"{uuid.uuid4().hex}{ext}"
        shutil.copyfile(tmp_path, UPLOAD_DIR / name)
        preview_url = f"/uploads/{name}"
    elif kind == "zip":
        try:
            parsed = parser.parse_zip(data)
        except (zipfile.BadZipFile, OSError):
            parsed = []
        text = "\n\n".join(f"### {p['name']}\n{p['text']}" for p in parsed if p.get("text"))
    else:
        parsed = parser.parse_file(filename, data)
        text = "\n\n".join(p.get("text", "") for p in parsed)

    text = (text or "").strip()[:_ATTACHMENT_TEXT_MAX]

    attachment_id = uuid.uuid4().hex
    with _attachments_lock:
        _attachments[attachment_id] = {
            "id": attachment_id,
            "filename": filename,
            "ext": ext,
            "kind": kind,
            "size": size,
            "text": text,
            "tmp_path": tmp_path,
            "preview_url": preview_url,
            "user_id": current_user["id"],
            "created_at": time.time(),
        }

    return {
        "id": attachment_id,
        "filename": filename,
        "kind": kind,
        "size": size,
        "text_preview": text[:200],
        "preview_url": preview_url,
        "vision": kind == "image" and llm.supports_vision(),
    }


@router.post("/chat/attachments/{attachment_id}/import")
def import_chat_attachment(
    attachment_id: str,
    req: ImportAttachmentRequest,
    current_user: dict = Depends(get_current_user),
):
    """把已上传的对话附件导入知识库（复用异步导入任务）。"""
    att = _get_attachment(attachment_id, current_user["id"])
    if att is None:
        raise HTTPException(status_code=404, detail="附件不存在或已过期")
    if req.kb_id:
        _require_kb_write(req.kb_id, current_user)

    task_id = uuid.uuid4().hex
    _set_task(task_id, status="queued")
    thread = threading.Thread(
        target=_run_import_task,
        args=(task_id, att["tmp_path"], att["filename"], req.kb_id, current_user["id"]),
        daemon=True,
    )
    thread.start()
    # 附件临时文件已移交导入任务（任务结束会删除），从附件表移除
    with _attachments_lock:
        _attachments.pop(attachment_id, None)
    return {"task_id": task_id, "status": "queued"}


@router.put("/documents/{doc_id}")
def update_document(
    doc_id: str, req: UpdateDocumentRequest, current_user: dict = Depends(get_current_user)
):
    """更新文档（按需更新字段）。title/content 提供时更新并重建分片；folder_id/kb_id/sort_order 提供时移动/排序。"""
    kwargs: dict = {}
    if "title" in req.model_fields_set and req.title is not None:
        title = req.title.strip()
        if not title:
            raise HTTPException(status_code=400, detail="标题不能为空")
        kwargs["title"] = title
    if "content" in req.model_fields_set and req.content is not None:
        kwargs["text"] = req.content
    if "folder_id" in req.model_fields_set:
        kwargs["folder_id"] = req.folder_id
    if "kb_id" in req.model_fields_set:
        # 跨知识库移动：校验目标知识库写权限
        if req.kb_id:
            _require_kb_write(req.kb_id, current_user)
        kwargs["kb_id"] = req.kb_id
    if "sort_order" in req.model_fields_set:
        kwargs["sort_order"] = req.sort_order

    doc = store.update(doc_id, user_id=current_user["id"], **kwargs)
    if not doc:
        raise HTTPException(status_code=404, detail="文档不存在")
    _audit(current_user, "update", "doc", doc["id"], f"更新文档「{doc['title']}」")
    return {
        "id": doc["id"],
        "title": doc["title"],
        "folder_id": doc.get("folder_id"),
        "kb_id": doc.get("kb_id"),
    }


@router.delete("/documents/{doc_id}")
def delete_document(doc_id: str, current_user: dict = Depends(get_current_user)):
    doc = store.get(doc_id, current_user["id"])
    if store.delete(doc_id, current_user["id"]):
        _audit(current_user, "delete", "doc", doc_id, f"删除文档「{(doc or {}).get('title', doc_id)}」")
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
    _audit(current_user, "create", "kb", kb["id"], f"创建知识库「{kb['name']}」")
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
    kb = store.get_kb(kb_id, current_user["id"])
    if store.delete_kb(kb_id, current_user["id"]):
        _audit(current_user, "delete", "kb", kb_id, f"删除知识库「{(kb or {}).get('name', kb_id)}」")
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
    # 通知被共享用户
    kb = store.get_kb(kb_id, current_user["id"])
    kb_name = (kb or {}).get("name") or "知识库"
    actor_name = current_user.get("nickname") or current_user.get("username")
    perm_label = "可编辑" if permission == "write" else "只读"
    store.add_notification(
        target["id"],
        "share",
        current_user["id"],
        None,
        kb_id,
        f"将知识库「{kb_name}」共享给了你（{perm_label}）",
    )
    publish_notification(target["id"], {"type": "notification", "kb_id": kb_id})
    _audit(current_user, "share", "kb", kb_id, f"将知识库「{kb_name}」共享给 {target['username']}（{perm_label}）")
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


# ---------- 数据统计（仪表盘） ----------

@router.get("/stats")
def get_stats(current_user: dict = Depends(get_current_user)):
    """首页仪表盘统计：文档数 / 知识库数 / 收藏数 / 最近浏览数 + 趋势与分布。"""
    from collections import defaultdict
    import datetime

    docs = store.all(user_id=current_user["id"])
    kbs = store.list_kbs(current_user["id"])
    favorites = store.list_favorites(current_user["id"])
    recent = store.list_recent(limit=200, user_id=current_user["id"])

    # 文档创建趋势（最近 14 天，按天聚合）
    today = datetime.date.today()
    trend_buckets: dict[int, int] = defaultdict(int)
    for d in docs:
        ts = d.get("created_at")
        if not ts:
            continue
        try:
            days_ago = (today - datetime.date.fromtimestamp(ts)).days
        except (ValueError, OSError, OverflowError):
            continue
        if 0 <= days_ago < 14:
            trend_buckets[days_ago] += 1
    doc_trend = [
        {
            "date": (today - datetime.timedelta(days=i)).strftime("%m-%d"),
            "count": trend_buckets.get(i, 0),
        }
        for i in range(13, -1, -1)
    ]

    # 按知识库分布（top 8）
    kb_names = {kb["id"]: kb["name"] for kb in kbs}
    kb_counts: dict[str | None, int] = defaultdict(int)
    for d in docs:
        kb_counts[d.get("kb_id")] += 1
    docs_by_kb = [
        {"name": kb_names.get(kid, "未分类"), "count": c}
        for kid, c in sorted(kb_counts.items(), key=lambda kv: -kv[1])[:8]
    ]

    # 热门标签（top 12）
    tag_counts: dict[str, int] = defaultdict(int)
    for d in docs:
        for t in d.get("tags") or []:
            if t:
                tag_counts[t] += 1
    top_tags = [
        {"name": t, "count": c}
        for t, c in sorted(tag_counts.items(), key=lambda kv: -kv[1])[:12]
    ]

    return {
        "total_docs": len(docs),
        "total_kbs": len(kbs),
        "total_favorites": len(favorites),
        "recent_count": len(recent),
        "doc_trend": doc_trend,
        "docs_by_kb": docs_by_kb,
        "top_tags": top_tags,
    }


# ---------- 操作审计日志 ----------

@router.get("/audit-logs")
def list_audit_logs(
    limit: int = 200,
    offset: int = 0,
    current_user: dict = Depends(get_current_user),
):
    """操作审计日志（仅管理员）。"""
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="需要管理员权限")
    logs = store.list_audit_logs(limit, offset)
    items = []
    for lg in logs:
        u = store.get_user_by_id(lg.get("user_id") or "") if lg.get("user_id") else None
        items.append(
            {
                "id": lg["id"],
                "action": lg["action"],
                "target_type": lg["target_type"],
                "target_id": lg.get("target_id"),
                "detail": lg["detail"],
                "created_at": lg["created_at"],
                "user": {
                    "id": lg.get("user_id"),
                    "nickname": (u or {}).get("nickname") or (u or {}).get("username") or "系统",
                },
            }
        )
    return {"logs": items}


# ---------- 导出 ----------

@router.post("/export")
def export_documents(req: ExportRequest, current_user: dict = Depends(get_current_user)):
    """多格式导出：md/docx/pdf/html/json/zip。doc_ids 为空导出当前用户全部。
    知识库整体导出：kb_id 提供且 format=zip 时，按文件夹层级打包整个知识库。"""
    if req.kb_id and req.format == "zip":
        kb = store.get_kb(req.kb_id, current_user["id"])
        if kb is None:
            raise HTTPException(status_code=404, detail="知识库不存在")
        docs = store.all(kb_id=req.kb_id, user_id=current_user["id"])
        folders = store.list_folders(req.kb_id, current_user["id"])
        if not docs:
            raise HTTPException(status_code=404, detail="知识库内无文档")
        content, filename, content_type = exporter.build_kb_zip(
            kb.get("name") or "知识库", docs, folders
        )
    else:
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
    _audit(current_user, "duplicate", "doc", new_doc["id"], f"复制文档「{new_doc['title']}」")
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


@router.post("/ai/assist")
def ai_assist(req: AIAssistRequest, current_user: dict = Depends(get_current_user)):
    """AI 写作辅助（润色/翻译/总结/续写/解释）。"""
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="文本不能为空")
    try:
        result = llm.assist(req.action, text)
    except llm.LLMError as e:
        raise HTTPException(status_code=e.status if e.status and e.status > 0 else 502, detail=e.detail)
    if result is None:
        if not llm.available():
            raise HTTPException(status_code=503, detail="AI 服务未配置，请在系统设置中配置")
        raise HTTPException(status_code=400, detail="不支持的操作类型")
    return {"result": result}


@router.get("/documents/{doc_id}/versions")
def list_document_versions(doc_id: str, current_user: dict = Depends(get_current_user)):
    """文档版本历史列表。"""
    if store.get(doc_id, current_user["id"]) is None:
        raise HTTPException(status_code=404, detail="文档不存在")
    versions = store.list_versions(doc_id, current_user["id"])
    return {
        "versions": [
            {"id": v["id"], "title": v["title"], "created_at": v["created_at"]}
            for v in versions
        ]
    }


@router.post("/documents/{doc_id}/rollback/{version_id}")
def rollback_document(
    doc_id: str, version_id: str, current_user: dict = Depends(get_current_user)
):
    """回滚文档到指定版本。"""
    doc = store.rollback(doc_id, version_id, current_user["id"])
    if doc is None:
        raise HTTPException(status_code=404, detail="版本不存在或无权限")
    return {"id": doc["id"], "title": doc["title"]}


@router.get("/documents/{doc_id}/comments")
def list_document_comments(doc_id: str, current_user: dict = Depends(get_current_user)):
    """文档评论列表（附评论者昵称/头像 + 回复关系）。"""
    if store.get(doc_id, current_user["id"]) is None:
        raise HTTPException(status_code=404, detail="文档不存在")
    comments = store.list_comments(doc_id)
    by_id = {c["id"]: c for c in comments}

    def _user_info(uid: str | None) -> dict:
        u = store.get_user_by_id(uid or "") if uid else None
        return {
            "id": uid,
            "nickname": (u or {}).get("nickname") or (u or {}).get("username") or "已注销用户",
            "avatar": (u or {}).get("avatar"),
        }

    items = []
    for c in comments:
        parent = by_id.get(c.get("parent_id")) if c.get("parent_id") else None
        items.append(
            {
                "id": c["id"],
                "doc_id": c["doc_id"],
                "content": c["content"],
                "quote": c.get("quote"),
                "created_at": c["created_at"],
                "parent_id": c.get("parent_id"),
                "mentions": c.get("mentions") or [],
                "user": _user_info(c.get("user_id")),
                "reply_to": _user_info(parent.get("user_id")) if parent else None,
            }
        )
    return {"comments": items}


@router.post("/documents/{doc_id}/comments")
def add_document_comment(
    doc_id: str,
    req: CreateCommentRequest,
    current_user: dict = Depends(get_current_user),
):
    """新增评论/批注（支持回复 parent_id 与 @ 提及）。"""
    content = (req.content or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="评论内容不能为空")
    doc = store.get(doc_id, current_user["id"])
    if doc is None:
        raise HTTPException(status_code=404, detail="文档不存在")
    quote = (req.quote or "").strip() or None
    parent_id = (req.parent_id or "").strip() or None
    mentions = [m for m in (req.mentions or []) if m and m != current_user["id"]]
    # 回复目标不存在时，退化为普通评论
    if parent_id and store.get_comment(parent_id) is None:
        parent_id = None

    c = store.add_comment(doc_id, current_user["id"], content, quote, parent_id, mentions)

    actor_name = current_user.get("nickname") or current_user.get("username")
    kb_id = doc.get("kb_id")
    # 通知：@ 提及
    for mid in mentions:
        store.add_notification(mid, "mention", current_user["id"], doc_id, kb_id, "在评论中提到了你")
    # 通知：评论被回复
    parent = store.get_comment(parent_id) if parent_id else None
    if parent and parent.get("user_id") != current_user["id"]:
        store.add_notification(parent["user_id"], "reply", current_user["id"], doc_id, kb_id, "回复了你的评论")

    # SSE 实时推送：评论事件给该文档的订阅者
    publish_comment(doc_id, {"type": "comment", "doc_id": doc_id, "comment_id": c["id"]})
    # SSE 实时推送：通知事件给被 @ / 被回复的用户
    for mid in mentions:
        publish_notification(mid, {"type": "notification", "doc_id": doc_id})
    if parent and parent.get("user_id") != current_user["id"]:
        publish_notification(parent["user_id"], {"type": "notification", "doc_id": doc_id})

    _audit(current_user, "comment", "doc", doc_id, f"评论文档「{(doc or {}).get('title', doc_id)}」")
    return {
        "id": c["id"],
        "doc_id": c["doc_id"],
        "content": c["content"],
        "quote": c.get("quote"),
        "created_at": c["created_at"],
        "parent_id": c.get("parent_id"),
        "mentions": c.get("mentions") or [],
        "user": {
            "id": current_user["id"],
            "nickname": actor_name,
            "avatar": current_user.get("avatar"),
        },
        "reply_to": None,
    }


@router.delete("/comments/{comment_id}")
def delete_document_comment(comment_id: str, current_user: dict = Depends(get_current_user)):
    """删除评论（仅评论作者或管理员）。"""
    c = store.get_comment(comment_id)
    if c is None:
        raise HTTPException(status_code=404, detail="评论不存在")
    if c.get("user_id") != current_user["id"] and current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="无权删除他人评论")
    store.delete_comment(comment_id)
    _audit(current_user, "comment_delete", "doc", c.get("doc_id"), "删除评论")
    return {"ok": True}


# ---------- 通知中心 ----------

@router.get("/events/notifications")
async def notifications_stream(request: Request, current_user: dict = Depends(get_current_user)):
    """SSE 事件流：实时推送当前用户的新通知。"""
    q: asyncio.Queue = asyncio.Queue(maxsize=100)
    uid = current_user["id"]
    loop = asyncio.get_running_loop()
    with _subs_lock:
        _notify_subscribers.setdefault(uid, set()).add((q, loop))

    async def gen():
        yield f"data: {json.dumps({'type': 'connected'}, ensure_ascii=False)}\n\n"
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(q.get(), timeout=15.0)
                    yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
        finally:
            with _subs_lock:
                s = _notify_subscribers.get(uid)
                if s:
                    s.discard((q, loop))
                    if not s:
                        _notify_subscribers.pop(uid, None)

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


@router.get("/events/comments/{doc_id}")
async def comments_stream(doc_id: str, request: Request, current_user: dict = Depends(get_current_user)):
    """SSE 事件流：实时推送某文档的新评论。"""
    if store.get(doc_id, current_user["id"]) is None:
        raise HTTPException(status_code=404, detail="文档不存在")
    q: asyncio.Queue = asyncio.Queue(maxsize=100)
    loop = asyncio.get_running_loop()
    with _subs_lock:
        _doc_subscribers.setdefault(doc_id, set()).add((q, loop))

    async def gen():
        yield f"data: {json.dumps({'type': 'connected'}, ensure_ascii=False)}\n\n"
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(q.get(), timeout=15.0)
                    yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
        finally:
            with _subs_lock:
                s = _doc_subscribers.get(doc_id)
                if s:
                    s.discard((q, loop))
                    if not s:
                        _doc_subscribers.pop(doc_id, None)

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


@router.get("/notifications")
def list_notifications(limit: int = 50, current_user: dict = Depends(get_current_user)):
    """当前用户的通知列表（附触发者昵称/头像）。"""
    notifications = store.list_notifications(current_user["id"], limit)
    items = []
    for n in notifications:
        u = store.get_user_by_id(n.get("actor_id") or "") if n.get("actor_id") else None
        items.append(
            {
                "id": n["id"],
                "type": n["type"],
                "doc_id": n.get("doc_id"),
                "kb_id": n.get("kb_id"),
                "content": n["content"],
                "read": bool(n.get("read")),
                "created_at": n["created_at"],
                "actor": {
                    "id": n.get("actor_id"),
                    "nickname": (u or {}).get("nickname") or (u or {}).get("username") or "系统",
                    "avatar": (u or {}).get("avatar"),
                },
            }
        )
    return {"notifications": items, "unread": store.unread_count(current_user["id"])}


@router.get("/notifications/unread-count")
def notification_unread_count(current_user: dict = Depends(get_current_user)):
    """未读通知数。"""
    return {"unread": store.unread_count(current_user["id"])}


@router.post("/notifications/{notification_id}/read")
def mark_notification_read(
    notification_id: str, current_user: dict = Depends(get_current_user)
):
    """标记单条通知已读。"""
    store.mark_notification_read(notification_id, current_user["id"])
    return {"ok": True}


@router.post("/notifications/read-all")
def mark_all_notifications_read(current_user: dict = Depends(get_current_user)):
    """全部标记已读。"""
    store.mark_all_notifications_read(current_user["id"])
    return {"ok": True}


@router.post("/upload/image")
async def upload_image(
    file: UploadFile = File(...), current_user: dict = Depends(get_current_user)
):
    """编辑器粘贴上传图片：保存到 media/uploads，返回可访问 URL。"""
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_IMAGE_EXTS:
        raise HTTPException(status_code=400, detail="仅支持图片格式（png/jpg/gif/webp/svg）")
    name = f"{uuid.uuid4().hex}{ext}"
    dest = UPLOAD_DIR / name
    with dest.open("wb") as f:
        shutil.copyfileobj(file.file, f)
    return {"url": f"/uploads/{name}"}
