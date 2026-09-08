"""媒体文件存储服务：内容寻址去重 + Content-Type 映射"""
from __future__ import annotations

import hashlib

from app.core.config import MEDIA_DIR

# 扩展名 -> MIME 类型
CONTENT_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".avi": "video/x-msvideo",
    ".mkv": "video/x-matroska",
    ".m4v": "video/x-m4v",
}


def content_type(ext: str) -> str:
    """根据扩展名返回 MIME 类型，未知类型回退为二进制流"""
    return CONTENT_TYPES.get(ext.lower(), "application/octet-stream")


def save(data: bytes, ext: str) -> str:
    """内容寻址保存：sha1 前 16 位 hex + 原扩展名，相同内容只存一份。

    返回存储文件名（不含目录），供 /api/v1/media/{filename} 访问。
    """
    digest = hashlib.sha1(data).hexdigest()[:16]
    ext = ext.lower() if ext else ""
    filename = f"{digest}{ext}"

    MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    path = MEDIA_DIR / filename
    if not path.exists():
        path.write_bytes(data)
    return filename
