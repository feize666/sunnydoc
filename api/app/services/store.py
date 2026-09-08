"""文档存储服务：内存 + JSON 文件持久化（MVP 不依赖数据库）"""
from __future__ import annotations

import json
import re
import time
import uuid
from pathlib import Path
from typing import Any

import jieba

from app.core.config import DATA_DIR

STORE_FILE = DATA_DIR / "store.json"

# 检索时的停用词（常见疑问词/虚词，避免干扰打分）
STOPWORDS = {
    "如何", "怎么", "什么", "哪些", "哪里", "为什么", "请问", "一下",
    "的", "了", "是", "在", "和", "与", "或", "吗", "呢", "吧", "这个", "那个",
    "一个", "我", "你", "他", "它", "我们", "请", "帮我", "给出", "告诉我",
}


def _tokenize(text: str) -> list[str]:
    """中文分词 + 去停用词 + 过滤单字"""
    words = []
    for w in jieba.cut(text):
        w = w.strip()
        if not w:
            continue
        if w in STOPWORDS:
            continue
        # 保留中文词、英文单词、数字
        if re.match(r"^[\u4e00-\u9fa5a-zA-Z0-9]+$", w):
            words.append(w.lower())
    return words


class DocStore:
    def __init__(self) -> None:
        self._docs: list[dict[str, Any]] = []
        self._load()

    def _load(self) -> None:
        if STORE_FILE.exists():
            try:
                self._docs = json.loads(STORE_FILE.read_text("utf-8"))
            except (json.JSONDecodeError, OSError):
                self._docs = []

    def _save(self) -> None:
        STORE_FILE.parent.mkdir(parents=True, exist_ok=True)
        STORE_FILE.write_text(
            json.dumps(self._docs, ensure_ascii=False, indent=2), "utf-8"
        )

    def add(self, title: str, text: str, source: str, ext: str) -> dict[str, Any]:
        doc = {
            "id": uuid.uuid4().hex,
            "title": title,
            "text": text,
            "source": source,
            "ext": ext,
            "created_at": time.time(),
        }
        self._docs.append(doc)
        self._save()
        return doc

    def add_many(self, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        docs: list[dict[str, Any]] = []
        for item in items:
            docs.append(self.add(item["title"], item["text"], item["source"], item["ext"]))
        return docs

    def all(self) -> list[dict[str, Any]]:
        return list(self._docs)

    def get(self, doc_id: str) -> dict[str, Any] | None:
        for d in self._docs:
            if d["id"] == doc_id:
                return d
        return None

    def delete(self, doc_id: str) -> bool:
        before = len(self._docs)
        self._docs = [d for d in self._docs if d["id"] != doc_id]
        if len(self._docs) != before:
            self._save()
            return True
        return False


store = DocStore()


def _segment(text: str, size: int = 400) -> list[str]:
    """简单分片：按段落/句子切分，控制每片长度"""
    # 先按空行分段
    paras = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    chunks: list[str] = []
    for para in paras:
        if len(para) <= size:
            chunks.append(para)
        else:
            # 长段落按句子切
            sentences = re.split(r"(?<=[。！？.!?])\s*", para)
            buf = ""
            for s in sentences:
                if len(buf) + len(s) <= size:
                    buf += s
                else:
                    if buf:
                        chunks.append(buf)
                    buf = s
            if buf:
                chunks.append(buf)
    return chunks


def search(query: str, top_k: int = 5) -> list[dict[str, Any]]:
    """关键词检索（MVP 版）：jieba 分词 + 命中打分，返回带来源片段的结果"""
    keywords = _tokenize(query)
    if not keywords:
        # 分词后无有效词，退化为整句子串匹配
        keywords = [query.strip().lower()]

    results: list[dict[str, Any]] = []
    for doc in store.all():
        chunks = _segment(doc["text"])
        for i, chunk in enumerate(chunks):
            lower_chunk = chunk.lower()
            score = 0
            for kw in keywords:
                if kw in lower_chunk:
                    score += 1 + (0.5 if kw in _tokenize(chunk) else 0)
            if score > 0:
                results.append(
                    {
                        "doc_id": doc["id"],
                        "title": doc["title"],
                        "source": doc["source"],
                        "text": chunk[:500],
                        "segment_index": i,
                        "score": score,
                    }
                )
    results.sort(key=lambda x: x["score"], reverse=True)
    return results[:top_k]
