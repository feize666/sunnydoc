"""文档解析服务：多格式提取文本"""
from __future__ import annotations

import io
import zipfile
from pathlib import Path

from app.core.config import TEXT_EXTS


def ext_of(name: str) -> str:
    i = name.rfind(".")
    return name[i:].lower() if i >= 0 else ""


def parse_pdf(data: bytes) -> str:
    """用 PyMuPDF 提取 PDF 文本"""
    import pymupdf

    doc = pymupdf.open(stream=data, filetype="pdf")
    parts: list[str] = []
    for page in doc:
        parts.append(page.get_text("text"))
    doc.close()
    return "\n\n".join(parts)


def parse_docx(data: bytes) -> str:
    """用 python-docx 提取 Word 文本"""
    from docx import Document

    doc = Document(io.BytesIO(data))
    parts: list[str] = []
    for para in doc.paragraphs:
        if para.text.strip():
            parts.append(para.text)
    # 表格
    for table in doc.tables:
        for row in table.rows:
            cells = [c.text.strip() for c in row.cells]
            parts.append(" | ".join(cells))
    return "\n".join(parts)


def parse_xlsx(data: bytes) -> str:
    """用 openpyxl 提取 Excel 文本"""
    from openpyxl import load_workbook

    wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    parts: list[str] = []
    for ws in wb.worksheets:
        parts.append(f"## 工作表：{ws.title}")
        for row in ws.iter_rows(values_only=True):
            cells = ["" if c is None else str(c) for c in row]
            if any(cells):
                parts.append(" | ".join(cells))
    wb.close()
    return "\n".join(parts)


def parse_zip(data: bytes) -> list[dict]:
    """解压 zip，返回其中可解析的文档列表 [{name, ext, text}]"""
    results: list[dict] = []
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        for info in zf.infolist():
            if info.is_dir():
                continue
            ext = ext_of(info.filename)
            raw = zf.read(info.filename)
            if ext in TEXT_EXTS:
                text = raw.decode("utf-8", errors="replace")
                results.append({"name": info.filename, "ext": ext, "text": text})
            elif ext == ".pdf":
                results.append({"name": info.filename, "ext": ext, "text": parse_pdf(raw)})
            elif ext == ".docx":
                results.append({"name": info.filename, "ext": ext, "text": parse_docx(raw)})
            elif ext == ".xlsx":
                results.append({"name": info.filename, "ext": ext, "text": parse_xlsx(raw)})
    return results


def parse_file(filename: str, data: bytes) -> list[dict]:
    """解析单个文件，返回文档列表 [{name, ext, text}]"""
    ext = ext_of(filename)
    if ext == ".zip":
        return parse_zip(data)
    if ext in TEXT_EXTS:
        text = data.decode("utf-8", errors="replace")
        return [{"name": filename, "ext": ext, "text": text}]
    if ext == ".pdf":
        return [{"name": filename, "ext": ext, "text": parse_pdf(data)}]
    if ext == ".docx":
        return [{"name": filename, "ext": ext, "text": parse_docx(data)}]
    if ext == ".xlsx":
        return [{"name": filename, "ext": ext, "text": parse_xlsx(data)}]
    return []
