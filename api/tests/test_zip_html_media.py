"""zip 导入的【端到端】集成测试：HTML 文档里的图片引用必须被改写。

这是本次「导入压缩包图片不显示」缺陷的核心回归测试：

- `replace_html_media_refs` 单独的单测只能证明函数本身正确，**证明不了它被接进了
  导入流程**。真正会「坏」的地方是 `_iter_parse_zip`（收集媒体）与 `_run_import_task`
  （建映射 + 调用改写）这两处接线，所以这里跑完整的 zip 解析 → 媒体落盘 →
  改写，断言最终文档正文里是 `/api/v1/media/…` 而不是原始的相对路径。

刻意不 mock：用真实的 `parser` + `media` 模块与真实 zip 字节，
只有存储层（store）与向量化被绕开（不参与本次缺陷）。
"""
from __future__ import annotations

import io
import os
import shutil
import struct
import zlib
import zipfile
from pathlib import Path

import pytest

from app.api import routes
from app.services import media, parser
from app.services.parser import replace_html_media_refs, replace_md_image_refs
from app.services.store import store


def _png(rgb: tuple[int, int, int]) -> bytes:
    """生成一个 1x1 的真实 PNG（有合法 IHDR/IDAT/IEND）。"""

    def chunk(tag: bytes, data: bytes) -> bytes:
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(b"\x00" + bytes(rgb)))
        + chunk(b"IEND", b"")
    )


@pytest.fixture()
def media_dir():
    """项目内的隔离媒体目录。

    刻意不用 pytest 的 `tmp_path`：本机沙箱会拦截系统临时目录（`/private/tmp/...`）
    下的 mkdir，报 `PermissionError`，让「断言失败」与「环境不可用」混在一起，
    失去回归价值。放在项目内 cwd 下则不受影响。
    """
    root = Path(__file__).resolve().parent / "_media_tmp"
    root.mkdir(parents=True, exist_ok=True)
    made = root / f"case-{os.urandom(4).hex()}"
    made.mkdir()
    try:
        yield made
    finally:
        shutil.rmtree(made, ignore_errors=True)


PAGE_HTML = """<!doctype html><html><head><title>测试页</title></head><body>
<article>
<h1>HTML 图片改写</h1>
<img src="pics/red.png" alt="相对路径">
<img data-src="pics/blue.png" alt="懒加载">
<img src="https://example.com/keep.png" alt="外链不改">
<img src="pics/missing.png" alt="缺失保持原样">
</article></body></html>"""


def _build_zip() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("page.html", PAGE_HTML)
        zf.writestr("note.md", "![对照](pics/red.png)\n")
        zf.writestr("pics/red.png", _png((255, 0, 0)))
        zf.writestr("pics/blue.png", _png((0, 0, 255)))
    return buf.getvalue()


def test_iter_parse_zip_collects_html_and_media():
    """HTML 应以 type=html 产出，且 png 被收进媒体列表（带正确 zip_path）。"""
    parsed, media_files = _iter_parse_zip_raw(_build_zip())

    htmls = [p for p in parsed if p.get("type") == "html"]
    assert len(htmls) == 1, f"应有 1 个 html 文档，实际 {len(htmls)}"
    assert htmls[0]["name"] == "page.html"
    assert htmls[0]["ext"] == ".html"

    paths = sorted(m.zip_path for m in media_files)
    assert paths == ["pics/blue.png", "pics/red.png"], paths
    for m in media_files:
        assert m.content_type.startswith("image/")
        assert m.data.startswith(b"\x89PNG")


def test_html_media_refs_rewritten_in_full_import_pipeline(media_dir, monkeypatch):
    """核心回归断言：走完 `_run_import_task` 整条导入链路，落库的 HTML 正文只剩 media URL。

    为什么必须打到 `_run_import_task`，而不是只调 `replace_html_media_refs`：
    实测证明函数级测试有**假通过**——把 routes.py 里的接线整段删掉后，函数级测试
    依然全绿（因为测试自己手工调用了函数）。真正会「坏」的是路由层是否记得调用，
    所以断言必须落在真实链路的产物上。
    """
    monkeypatch.setattr(media, "MEDIA_DIR", media_dir)

    captured: list[dict] = []

    def spy_add(**kwargs):
        captured.append(kwargs)
        return {"id": f"fake-{len(captured)}", "title": kwargs.get("title", "")}

    # 存储层不参与本次缺陷：stub 掉入库与建目录/改名，只观察交给 add 的正文
    monkeypatch.setattr(store, "add", spy_add)
    monkeypatch.setattr(routes, "_ensure_folder_path", lambda *a, **k: None)
    monkeypatch.setattr(routes, "_dedupe_title", lambda s, t, u: t)

    zip_path = media_dir / "import.zip"
    zip_path.write_bytes(_build_zip())

    routes._run_import_task("task-test", str(zip_path), "import.zip", user_id="u1")

    assert captured, "导入流程没有任何文档入库"
    html_doc = next((c for c in captured if c.get("type") == "html"), None)
    assert html_doc is not None, f"未产出 type=html 的文档：{[c.get('type') for c in captured]}"
    body = html_doc["text"]

    # 命中映射的相对路径必须已改写
    assert 'src="/api/v1/media/' in body, body
    assert "pics/red.png" not in body, body
    assert "pics/blue.png" not in body, body
    assert 'data-src="/api/v1/media/' in body, body
    # 外链与缺失引用保持原样
    assert 'src="https://example.com/keep.png"' in body, body
    assert 'src="pics/missing.png"' in body, body

    # 红/蓝两图内容不同 → 两个不同的存储名，且都已落盘
    import re

    stored = re.findall(r'/api/v1/media/([0-9a-f]+\.png)', body)
    assert len(stored) == 2, stored
    assert stored[0] != stored[1], "红蓝两图不应映射到同一存储文件"
    for name in stored:
        assert (media_dir / name).exists(), f"{name} 未落盘"

    # md 对照文档同样被改写（两条路径共用 path_map）
    md_doc = next((c for c in captured if c.get("ext") == ".md"), None)
    assert md_doc is not None, "md 文档未入库"
    assert "/api/v1/media/" in md_doc["text"], md_doc["text"]
    assert "pics/red.png" not in md_doc["text"], md_doc["text"]


def test_md_and_html_use_same_path_map(media_dir, monkeypatch):
    """md 与 html 共用同一份 path_map，同一张图指向同一存储名（对称性断言）。"""
    monkeypatch.setattr(media, "MEDIA_DIR", media_dir)
    parsed, media_files = _iter_parse_zip_raw(_build_zip())
    path_map = {m.zip_path: media.save(m.data, m.ext) for m in media_files}

    md_doc = next(p for p in parsed if p["ext"] == ".md")
    html_doc = next(p for p in parsed if p.get("type") == "html")
    md_out = replace_md_image_refs(md_doc["text"], md_doc["name"], path_map)
    html_out = replace_html_media_refs(html_doc["text"], html_doc["name"], path_map)

    md_red = md_out.split("(")[1].split(")")[0]
    assert md_red.startswith("/api/v1/media/")
    assert md_red.split("/")[-1] in html_out


def test_html_inside_subdir_resolves_relative_path(media_dir, monkeypatch):
    """子目录里的 HTML 用 `../pics/` 引用时也要能解析（基于 HTML 自身所在目录）。"""
    monkeypatch.setattr(media, "MEDIA_DIR", media_dir)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("docs/sub/page.html", '<img src="../../pics/red.png">')
        zf.writestr("pics/red.png", _png((255, 0, 0)))
    parsed, media_files = _iter_parse_zip_raw(buf.getvalue())
    path_map = {m.zip_path: media.save(m.data, m.ext) for m in media_files}

    html_doc = next(p for p in parsed if p.get("type") == "html")
    out = replace_html_media_refs(html_doc["text"], html_doc["name"], path_map)
    assert 'src="/api/v1/media/' in out
    assert "../../pics/red.png" not in out


# ---------------------------------------------------------------------------
# 辅助：直接调用路由层的 zip 解析（含 kb 导出包识别等真实逻辑）
# ---------------------------------------------------------------------------


def _iter_parse_zip_raw(data: bytes):
    from app.api.routes import _iter_parse_zip

    return _iter_parse_zip(data, lambda *a, **k: None)