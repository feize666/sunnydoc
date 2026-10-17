"""图片上传的两个核心不变量：大小闸门 + 内容寻址去重。

**为什么单独测这两条**：它们都是「看起来有、实际没有」的高危项 ——
2026-10-17 实测发现 `/upload/image` **完全没有大小校验**（35MB 文件直接存盘），
且用 `uuid4().hex` 命名**绕开了内容寻址**（同一张图粘贴两次存两份）。
两者都不会抛异常、不会报错，只会静静地把磁盘吃掉，因此必须有测试钉住。

测的是 `routes.upload_image` 这个**端点函数本身**（直接 await 调用），
不走 TestClient：本项目的测试不启 HTTP 服务，且端点的逻辑只有
「校验 → media.save → 返回 URL」三步，直接调用即可覆盖真实分支。
"""
from __future__ import annotations

import asyncio
import io
import os
import shutil
from pathlib import Path

import pytest
from fastapi import HTTPException, UploadFile

from app.api import routes
from app.services import media

USER = {"id": "u-test", "username": "tester", "role": "user"}


@pytest.fixture()
def media_dir():
    """项目内的隔离媒体目录（与 test_zip_html_media 同因：沙箱拦系统临时目录）。"""
    root = Path(__file__).resolve().parent / "_media_tmp"
    root.mkdir(parents=True, exist_ok=True)
    made = root / f"upload-{os.urandom(4).hex()}"
    made.mkdir()
    try:
        yield made
    finally:
        shutil.rmtree(made, ignore_errors=True)


def _upload(data: bytes, filename: str) -> UploadFile:
    """构造一个最小可用的 UploadFile。"""
    return UploadFile(filename=filename, file=io.BytesIO(data))


def _call(data: bytes, filename: str, media_dir: Path) -> dict:
    """以隔离的 MEDIA_DIR 调用上传端点，返回结果 dict（异常原样抛出）。"""
    return asyncio.run(routes.upload_image(_upload(data, filename), current_user=USER))


# 一个真实的 1x1 PNG（69 字节，红色）。由 Python zlib 生成并解压校验过 ——
# 别手写/手抄 PNG 字节：曾因只看文件头就当成有效图，IDAT 其实是坏数据。
PNG_1PX = bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753"
    "de0000000c4944415478da63f8cfc0000003010100f70341430000000049454e"
    "44ae426082"
)


@pytest.fixture(autouse=True)
def _patch_media_dir(monkeypatch, media_dir):
    """所有用例都把媒体目录指向隔离区，绝不写进真实 data/media。"""
    monkeypatch.setattr(media, "MEDIA_DIR", media_dir)
    monkeypatch.setattr(routes, "MEDIA_DIR", media_dir, raising=False)
    yield


def test_oversized_image_rejected():
    """超过上限的图片必须抛 413，且**不得落盘**。

    这是本轮修的核心缺陷：修前该文件会被直接写入磁盘（实测 35MB 通过）。
    """
    too_big = b"\x89PNG\r\n\x1a\n" + b"\x00" * (routes.MAX_IMAGE_BYTES + 1)
    with pytest.raises(HTTPException) as ei:
        _call(too_big, "big.png", None)
    assert ei.value.status_code == 413
    assert "上限" in ei.value.detail


def test_oversized_image_not_written_to_disk(media_dir):
    """拒绝必须是「真的没落盘」，而不只是返回了 4xx。"""
    too_big = b"\x89PNG\r\n\x1a\n" + b"\x00" * (routes.MAX_IMAGE_BYTES + 1)
    with pytest.raises(HTTPException):
        _call(too_big, "big.png", None)
    files = [p for p in media_dir.rglob("*") if p.is_file()]
    assert files == [], f"被拒的上传不应留下文件，实际: {files}"


def test_empty_image_rejected():
    """空文件必须拒绝（否则会写入 0 字节的“图片”）。"""
    with pytest.raises(HTTPException) as ei:
        _call(b"", "empty.png", None)
    assert ei.value.status_code == 400


def test_bad_extension_rejected():
    """非图片扩展名必须拒绝（白名单，不是黑名单）。"""
    with pytest.raises(HTTPException) as ei:
        _call(PNG_1PX, "evil.txt", None)
    assert ei.value.status_code == 400


def test_duplicate_upload_returns_same_url():
    """同一张图重复上传 → URL 完全相同（内容寻址去重）。

    修前用 uuid 命名，两次上传是两个不同的 URL 与两份文件。
    """
    r1 = _call(PNG_1PX, "a.png", None)
    r2 = _call(PNG_1PX, "b.png", None)
    assert r1["url"] == r2["url"]
    assert r1["url"].startswith("/api/v1/media/")


def test_duplicate_upload_writes_one_file(media_dir):
    """去重的**实质证据**：磁盘上只应有一个文件，而不只是 URL 字符串相同。"""
    _call(PNG_1PX, "a.png", None)
    _call(PNG_1PX, "b.png", None)
    files = [p for p in media_dir.rglob("*") if p.is_file()]
    assert len(files) == 1, f"同内容应只落一份盘，实际 {len(files)}: {files}"


def test_different_content_writes_two_files(media_dir):
    """反向断言：不同内容必须各存一份（别把「去重」实现成「总返回同一个」）。"""
    other = PNG_1PX[:-1] + b"\x00"  # 改一个字节 → 内容不同
    _call(PNG_1PX, "a.png", None)
    _call(other, "b.png", None)
    files = [p for p in media_dir.rglob("*") if p.is_file()]
    assert len(files) == 2, f"不同内容应各存一份，实际 {len(files)}"


def test_returned_url_matches_stored_filename(media_dir):
    """返回的 URL 必须与实际落盘文件名一致（否则前端拿到的是死链）。"""
    r = _call(PNG_1PX, "a.png", None)
    name = r["url"].rsplit("/", 1)[-1]
    assert (media_dir / name).is_file(), f"{name} 不在 {media_dir}"


def test_url_uses_content_hash_not_uuid():
    """URL 里的文件名必须是内容哈希（sha1 前 16 位），不是 uuid。"""
    r = _call(PNG_1PX, "a.png", None)
    name = r["url"].rsplit("/", 1)[-1]
    stem = name.rsplit(".", 1)[0]
    assert len(stem) == 16 and all(c in "0123456789abcdef" for c in stem), stem
    # uuid4().hex 也是 32 位 hex，但长度不同；这里额外确认与内容哈希相等
    import hashlib

    assert stem == hashlib.sha1(PNG_1PX).hexdigest()[:16]