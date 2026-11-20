"""多格式导出服务：md / docx / pdf / html / json / zip。

PDF 中文方案：reportlab 内置 CID 字体 STSong-Light（UnicodeCIDFont），
无需下载/依赖系统字体即可正确渲染中文，避免乱码或方块。
"""
from __future__ import annotations

import io
import json
import re
import zipfile
from typing import Any
from xml.sax.saxutils import escape as _xml_escape

from app.core.config import MEDIA_DIR

# markdown 标题层级 -> 正文/标题
_MD_H_RE = re.compile(r"^(#{1,6})\s+(.*)$")
_MD_LINK_RE = re.compile(r"!\[([^\]]*)\]\([^)]+\)|\[([^\]]+)\]\([^)]+\)")
_MD_LIST_RE = re.compile(r"^\s*(?:[-*+]|\d+\.)\s+")

# 正文里的媒体引用。实测形式：`![alt](/api/v1/media/ef0b78da1ea4d8ac.png)`
# 也要兼容可能的 `<img src="/media/x.png">` 与相对写法，所以前缀可省。
_MEDIA_REF_RE = re.compile(r"(?:/api/v1)?/media/([A-Za-z0-9._-]+)")


def _collect_media_refs(docs: list[dict[str, Any]]) -> set[str]:
    """从这批文档的正文里抽出被引用的媒体文件名（去重）。

    只导出**被引用**的媒体，理由见 `build_kb_zip` 里媒体段的注释：
    无差别打包整个 MEDIA_DIR 会把别的知识库的图片一起带走（权限隔离失效），
    而且实测 524 MB 让每次导出都慢到不可用。
    """
    refs: set[str] = set()
    for d in docs:
        text = d.get("text") or ""
        if not text:
            continue
        refs.update(_MEDIA_REF_RE.findall(text))
    return refs


def build(fmt: str, docs: list[dict[str, Any]]) -> tuple[Any, str, str]:
    """按格式导出文档列表，返回 (内容流, 文件名, Content-Type)。"""
    fmt = (fmt or "").strip().lower()
    handlers = {
        "md": _export_md,
        "markdown": _export_md,
        "docx": _export_docx,
        "pdf": _export_pdf,
        "html": _export_html,
        "json": _export_json,
        "zip": _export_zip,
    }
    handler = handlers.get(fmt)
    if handler is None:
        raise ValueError(f"不支持的导出格式：{fmt}")
    return handler(docs)


# ---------- 公共工具 ----------

def _safe_filename(name: str) -> str:
    """去除文件名中的非法字符。"""
    name = re.sub(r'[\\/:*?"<>|]', "_", name).strip()
    return name or "export"


def _export_filename(docs: list[dict[str, Any]], ext: str) -> str:
    if len(docs) == 1:
        return f"{_safe_filename(docs[0]['title'])}.{ext}"
    return f"export.{ext}"


def _md_plain(text: str) -> str:
    """把 markdown 语法尽量去掉，保留可读文本（用于 PDF 等纯文本渲染）。"""
    text = _MD_LINK_RE.sub(lambda m: m.group(1) or m.group(2) or "", text)
    text = _MD_LIST_RE.sub("", text)
    text = text.replace("**", "").replace("__", "").replace("`", "")
    text = text.replace("~~", "").replace(">", "")
    return text.strip()


def _md_level(text: str) -> tuple[int, str]:
    """识别标题层级，返回 (level, 去掉 # 后的文本)。"""
    m = _MD_H_RE.match(text)
    if m:
        return min(len(m.group(1)), 3), m.group(2).strip()
    return 0, text


# ---------- markdown ----------

def _export_md(docs: list[dict[str, Any]]) -> tuple[Any, str, str]:
    if len(docs) == 1:
        content = docs[0]["text"].encode("utf-8")
        filename = f"{_safe_filename(docs[0]['title'])}.md"
    else:
        parts = [f"# {d['title']}\n\n{d['text']}" for d in docs]
        content = "\n\n---\n\n".join(parts).encode("utf-8")
        filename = "export.md"
    return content, filename, "text/markdown; charset=utf-8"


# ---------- docx ----------

def _export_docx(docs: list[dict[str, Any]]) -> tuple[Any, str, str]:
    """导出 docx。

    ## 🔴 为什么用底层 XML 而不是 `add_paragraph`（2026-11-19 实测）

    `python-docx` 的 `add_paragraph()` **不是 O(1)** —— 每建一段都要在
    不断变大的 XML 树上做定位/样式解析。实测单文档累积后逐段变慢：

        累计  1,000 段 → 0.07 ms/段
        累计 20,000 段 → 0.18 ms/段
        累计 40,000 段 → 0.29 ms/段

    全库 253 篇约 **17.5 万行**，外推 ≈125s，实测直接超 180s 超时
    （前端表现为"导出中…"一直转，用户以为卡死）。

    改成直接构造 `w:p` / `w:r` / `w:rPr` 的 OXML 节点后，实测 **20 倍**：
        40,000 段：11.52s → 0.57s（0.288 → 0.014 ms/段）
    全库导出回落到 **约 3 秒**。

    ⚠️ 代价：拿不到 `run.font.name = x` 那种便利写法，必须自己拼
    `w:rFonts`（中文字体要**同时**设 `w:eastAsia` 与 `w:ascii`，
    否则 Word 里中文会退回默认字体）。
    """
    from docx import Document
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn

    document = Document()
    body = document.element.body

    # 字号 → w:sz 的 half-point 值（Word 用 1/2 pt 为单位）
    def add_para(text: str, size: int, bold: bool) -> None:
        p = OxmlElement("w:p")
        r = OxmlElement("w:r")
        rPr = OxmlElement("w:rPr")

        # 字体：中文必须设 eastAsia，西文设 ascii/hAnsi
        rFonts = OxmlElement("w:rFonts")
        for attr in ("w:ascii", "w:hAnsi", "w:eastAsia"):
            rFonts.set(qn(attr), "宋体")
        rPr.append(rFonts)

        if bold:
            rPr.append(OxmlElement("w:b"))

        sz = OxmlElement("w:sz")
        sz.set(qn("w:val"), str(int(size * 2)))
        rPr.append(sz)
        szCs = OxmlElement("w:szCs")
        szCs.set(qn("w:val"), str(int(size * 2)))
        rPr.append(szCs)

        r.append(rPr)

        t = OxmlElement("w:t")
        t.text = text
        # 保留首尾空格（否则 Word 会吃掉缩进）
        t.set(qn("xml:space"), "preserve")
        r.append(t)
        p.append(r)
        body.append(p)

    for d in docs:
        add_para(d["title"], 18, True)
        for line in d["text"].split("\n"):
            stripped = line.strip()
            if not stripped:
                continue
            level, txt = _md_level(stripped)
            txt = _md_plain(txt)
            if not txt:
                continue
            if level == 1:
                add_para(txt, 16, True)
            elif level == 2:
                add_para(txt, 14, True)
            elif level == 3:
                add_para(txt, 12, True)
            else:
                add_para(txt, 11, False)

    buf = io.BytesIO()
    document.save(buf)
    return (
        buf.getvalue(),
        _export_filename(docs, "docx"),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )


# ---------- pdf ----------

def _export_pdf(docs: list[dict[str, Any]]) -> tuple[Any, str, str]:
    from reportlab.lib.enums import TA_LEFT
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.cidfonts import UnicodeCIDFont
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

    # 内置中文 CID 字体，无需外部字体文件
    pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))

    styles = {
        0: ParagraphStyle(
            "body", fontName="STSong-Light", fontSize=11, leading=18,
            alignment=TA_LEFT,
        ),
        1: ParagraphStyle(
            "h1", fontName="STSong-Light", fontSize=20, leading=28, spaceAfter=12,
        ),
        2: ParagraphStyle(
            "h2", fontName="STSong-Light", fontSize=16, leading=24, spaceAfter=8,
        ),
        3: ParagraphStyle(
            "h3", fontName="STSong-Light", fontSize=13, leading=20, spaceAfter=6,
        ),
    }

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4)
    story: list[Any] = []
    for d in docs:
        story.append(Paragraph(_xml_escape(_md_plain(d["title"])), styles[1]))
        for line in d["text"].split("\n"):
            stripped = line.rstrip()
            if not stripped.strip():
                continue
            level, txt = _md_level(stripped)
            txt = _md_plain(txt)
            if not txt:
                continue
            story.append(Paragraph(_xml_escape(txt), styles[level]))
            story.append(Spacer(1, 4))
    doc.build(story)

    return buf.getvalue(), _export_filename(docs, "pdf"), "application/pdf"


# ---------- html ----------

_CSS = """
body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
       max-width: 860px; margin: 40px auto; padding: 0 24px; line-height: 1.7; color: #24292f; }
h1, h2, h3 { border-bottom: 1px solid #eaecef; padding-bottom: .3em; }
pre { background: #f6f8fa; padding: 16px; border-radius: 6px; overflow: auto; }
code { background: #f6f8fa; padding: .2em .4em; border-radius: 3px; }
blockquote { border-left: 4px solid #dfe2e5; margin: 0; padding: 0 1em; color: #6a737d; }
img { max-width: 100%; }
table { border-collapse: collapse; }
th, td { border: 1px solid #dfe2e5; padding: 6px 13px; }
"""


def _export_html(docs: list[dict[str, Any]]) -> tuple[Any, str, str]:
    import markdown as md

    parts = [
        f"<h1>{_xml_escape(d['title'])}</h1>\n{md.markdown(d['text'], extensions=['tables', 'fenced_code'])}"
        for d in docs
    ]
    html = (
        "<!DOCTYPE html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\">"
        f"<title>导出</title><style>{_CSS}</style></head><body>"
        + "\n".join(parts)
        + "</body></html>"
    )
    return html.encode("utf-8"), _export_filename(docs, "html"), "text/html; charset=utf-8"


# ---------- json ----------

def _export_json(docs: list[dict[str, Any]]) -> tuple[Any, str, str]:
    data = [
        {
            "id": d["id"],
            "title": d["title"],
            "text": d["text"],
            "source": d["source"],
            "ext": d["ext"],
            "folder_id": d.get("folder_id"),
            "created_at": d["created_at"],
        }
        for d in docs
    ]
    content = json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8")
    return content, "export.json", "application/json; charset=utf-8"


# ---------- zip ----------

def _export_zip(docs: list[dict[str, Any]]) -> tuple[Any, str, str]:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        seen: set[str] = set()
        for d in docs:
            base = _safe_filename(d["title"])
            name = f"{base}.md"
            i = 1
            while name in seen:
                i += 1
                name = f"{base}({i}).md"
            seen.add(name)
            zf.writestr(name, d["text"])
        # 只打包**本次导出的文档实际引用**的媒体。
        #
        # 🔴 2026-11-21 实测：这里原来是无条件 `for f in MEDIA_DIR.iterdir()`，
        #    按目录导出 21 篇文档却打出 **515 MB / 2144 个条目**（整个实例的图片）。
        #    上一轮只修了 `build_kb_zip` 的同类问题，**漏了这条路径** ——
        #    「按目录导出」刚好走 `build()` → `_export_zip`，把这个坑又踩了一遍。
        #    判据也因此改成绝对阈值（见 verify_export_perf），不写「省多少 %」。
        needed = _collect_media_refs(docs)
        for name in sorted(needed):
            # 路径穿越防护：_collect_media_refs 已过滤，这里再挡一层。
            if "/" in name or "\\" in name or name.startswith("."):
                continue
            f = MEDIA_DIR / name
            if f.is_file():
                try:
                    zf.write(f, f"media/{name}")
                except OSError:
                    continue  # 单个文件读失败不该让整次导出失败
    return buf.getvalue(), "export.zip", "application/zip"


# ---------- 知识库整体导出（zip，保留目录结构） ----------

def build_kb_zip(
    kb_name: str,
    docs: list[dict[str, Any]],
    folders: list[dict[str, Any]],
) -> tuple[Any, str, str]:
    """把整个知识库导出为 zip，按文件夹层级组织，含 media 与 manifest。"""
    import posixpath as _pp

    base = _safe_filename(kb_name or "knowledge_base")

    # 构建 folder id -> 相对路径 的映射（递归，防御循环引用）
    folder_paths: dict[str, str] = {}
    _resolving: set[str] = set()

    def resolve(fid: str) -> str:
        if fid in folder_paths:
            return folder_paths[fid]
        if fid in _resolving:  # 防御循环引用
            return ""
        _resolving.add(fid)
        f = next((x for x in folders if x.get("id") == fid), None)
        path = ""
        if f:
            parent = f.get("parent_id")
            parent_path = resolve(parent) if parent else ""
            name = _safe_filename(f.get("name") or "未命名文件夹")
            path = _pp.join(parent_path, name) if parent_path else name
        _resolving.discard(fid)
        folder_paths[fid] = path
        return path

    for f in folders:
        resolve(f.get("id") or "")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        seen: set[str] = set()
        manifest: list[dict[str, Any]] = []
        for d in docs:
            subdir = folder_paths.get(d.get("folder_id") or "", "")
            stem = _safe_filename(d["title"])
            name = f"{stem}.md"
            full = _pp.join(base, subdir, name) if subdir else _pp.join(base, name)
            i = 1
            while full in seen:
                i += 1
                alt = f"{stem}({i}).md"
                full = _pp.join(base, subdir, alt) if subdir else _pp.join(base, alt)
            seen.add(full)
            zf.writestr(full, d["text"])
            manifest.append(
                {
                    "title": d["title"],
                    "path": full,
                    "source": d.get("source"),
                    "ext": d.get("ext"),
                }
            )

        # 媒体文件：只打**本文档集实际引用**的，不是全站所有图片。
        #
        # 🔴 2026-11-17 实测：原来无条件 `for f in MEDIA_DIR.iterdir()` 会把
        #    整个 media 目录（实测 **524 MB**）塞进每一份导出 zip ——
        #    哪怕这个知识库只有 1 篇文档、一张图都没有。
        #    两个后果：
        #      ① 性能：任何一次知识库导出都要读 524 MB 并压缩，慢到不可用
        #      ② 泄露：导出者拿到的是**整个实例**所有知识库的图片，
        #         等于绕过了按知识库的权限隔离
        #    修法：从正文里抽出 media 引用（`/media/<name>`），只打这些。
        needed = _collect_media_refs(docs)
        packed = 0
        for fname in sorted(needed):
            f = MEDIA_DIR / fname
            # 防路径穿越：只允许 MEDIA_DIR 下的直接文件名
            if not fname or "/" in fname or "\\" in fname or fname.startswith("."):
                continue
            try:
                if f.is_file():
                    zf.write(f, _pp.join(base, "media", f.name))
                    packed += 1
            except OSError:
                continue  # 单个文件读失败不该让整次导出失败

        # 清单
        zf.writestr(
            _pp.join(base, "manifest.json"),
            json.dumps(manifest, ensure_ascii=False, indent=2),
        )

    return buf.getvalue(), f"{base}.zip", "application/zip"
