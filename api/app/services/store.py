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
from app.services import embedding

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
        chunks = _segment(text)
        # 尝试向量化（无 embedding 服务时为 None）
        vectors = embedding.embed(chunks) if embedding.available() else None

        doc = {
            "id": uuid.uuid4().hex,
            "title": title,
            "text": text,
            "source": source,
            "ext": ext,
            "created_at": time.time(),
            "chunks": [
                {"text": c, "vector": vectors[i] if vectors else None}
                for i, c in enumerate(chunks)
            ],
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


def _cosine(a: list[float], b: list[float]) -> float:
    """余弦相似度"""
    dot = sum(x * y for x, y in zip(a, b))
    na = sum(x * x for x in a) ** 0.5
    nb = sum(x * x for x in b) ** 0.5
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def search(query: str, top_k: int = 5) -> list[dict[str, Any]]:
    """混合检索（MVP 版）：jieba 关键词打分 + 向量相似度（若可用）"""
    keywords = _tokenize(query)
    if not keywords:
        keywords = [query.strip().lower()]

    # query 向量（若 embedding 可用）
    query_vec = embedding.embed([query])[0] if embedding.available() else None

    results: list[dict[str, Any]] = []
    for doc in store.all():
        # 优先用入库时存的分片，兼容旧数据（无 chunks 则重新分片）
        chunks = doc.get("chunks")
        if not chunks:
            chunks = [{"text": c, "vector": None} for c in _segment(doc["text"])]

        for i, chunk in enumerate(chunks):
            text = chunk["text"]
            lower_text = text.lower()

            # 关键词分数
            kw_score = 0.0
            for kw in keywords:
                if kw in lower_text:
                    kw_score += 1.0 + (0.5 if kw in _tokenize(text) else 0.0)

            # 向量相似度
            vec_score = 0.0
            if query_vec is not None and chunk.get("vector"):
                vec_score = _cosine(query_vec, chunk["vector"])

            # 混合：关键词归一 + 向量加权（向量权重 0.7）
            score = kw_score / max(1, len(keywords)) * 0.3 + vec_score * 0.7

            if kw_score > 0 or vec_score > 0.3:
                results.append(
                    {
                        "doc_id": doc["id"],
                        "title": doc["title"],
                        "source": doc["source"],
                        "text": text[:500],
                        "segment_index": i,
                        "score": score,
                    }
                )
    results.sort(key=lambda x: x["score"], reverse=True)
    return results[:top_k]
