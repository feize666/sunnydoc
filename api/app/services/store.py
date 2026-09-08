"""文档存储服务：PostgreSQL + pgvector 优先，JSON 文件降级。

对外接口保持不变（DocStore 的 add/add_many/all/get/delete、模块级
search/_segment/_tokenize/_cosine、模块级 store 单例）。内部按 db.available()
分流：可用走 PostgreSQL，否则回退到 JSON 文件。
"""
from __future__ import annotations

import json
import re
import time
import uuid
from pathlib import Path
from typing import Any

import jieba

from app.core.config import DATA_DIR
from app.services import db, embedding, rerank

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
        # 启动时判定存储后端：PostgreSQL 可用则用库，否则 JSON 降级
        if db.available():
            self._backend = "db"
            db.init()
        else:
            self._backend = "json"
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

    def _build_chunks(self, text: str) -> list[dict[str, Any]]:
        """分片 + 向量化，供 add / update 共用。"""
        chunks = _segment(text)
        # 尝试向量化（无 embedding 服务时为 None）
        vectors = embedding.embed(chunks) if embedding.available() else None
        return [
            {"text": c, "vector": vectors[i] if vectors else None}
            for i, c in enumerate(chunks)
        ]

    def add(self, title: str, text: str, source: str, ext: str) -> dict[str, Any]:
        doc = {
            "id": uuid.uuid4().hex,
            "title": title,
            "text": text,
            "source": source,
            "ext": ext,
            "created_at": time.time(),
            "chunks": self._build_chunks(text),
        }
        if self._backend == "db":
            db.add_document(doc)
        else:
            self._docs.append(doc)
            self._save()
        return doc

    def update(self, doc_id: str, title: str, text: str) -> dict[str, Any] | None:
        """更新文档标题与正文，并重建分片 + 向量。找不到返回 None。"""
        if self._backend == "db":
            doc = db.get_document(doc_id)
            if doc is None:
                return None
            doc["title"] = title
            doc["text"] = text
            doc["chunks"] = self._build_chunks(text)
            return db.update_document(doc_id, doc)
        for d in self._docs:
            if d["id"] == doc_id:
                d["title"] = title
                d["text"] = text
                d["chunks"] = self._build_chunks(text)
                self._save()
                return d
        return None

    def add_many(self, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        docs: list[dict[str, Any]] = []
        for item in items:
            docs.append(self.add(item["title"], item["text"], item["source"], item["ext"]))
        return docs

    def all(self) -> list[dict[str, Any]]:
        if self._backend == "db":
            return db.all_documents()
        return list(self._docs)

    def get(self, doc_id: str) -> dict[str, Any] | None:
        if self._backend == "db":
            return db.get_document(doc_id)
        for d in self._docs:
            if d["id"] == doc_id:
                return d
        return None

    def delete(self, doc_id: str) -> bool:
        if self._backend == "db":
            return db.delete_document(doc_id)
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


def _candidates_from_docs(docs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """把「文档 + chunks」结构拍平成 chunk 级候选（JSON 全量扫描用）。"""
    candidates: list[dict[str, Any]] = []
    for doc in docs:
        chunks = doc.get("chunks")
        if not chunks:
            chunks = [{"text": c, "vector": None} for c in _segment(doc["text"])]
        for i, chunk in enumerate(chunks):
            candidates.append(
                {
                    "doc_id": doc["id"],
                    "title": doc["title"],
                    "source": doc["source"],
                    "segment_index": i,
                    "text": chunk["text"],
                    "vector": chunk.get("vector"),
                }
            )
    return candidates


def _score_candidates(
    candidates: list[dict[str, Any]],
    keywords: list[str],
    query_vec: list[float] | None,
) -> list[dict[str, Any]]:
    """在候选 chunk 上做关键词 + 向量加权打分（保留在 Python 层）。"""
    results: list[dict[str, Any]] = []
    for chunk in candidates:
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
                    "doc_id": chunk["doc_id"],
                    "title": chunk["title"],
                    "source": chunk["source"],
                    "text": text[:500],
                    "segment_index": chunk["segment_index"],
                    "score": score,
                }
            )
    results.sort(key=lambda x: x["score"], reverse=True)
    return results


def search(query: str, top_k: int = 5) -> list[dict[str, Any]]:
    """混合检索：jieba 关键词 + 向量相似度粗召回，再用 rerank 精排（若可用）"""
    keywords = _tokenize(query)
    if not keywords:
        keywords = [query.strip().lower()]

    # query 向量（若 embedding 可用）
    query_vec = embedding.embed([query])[0] if embedding.available() else None

    # 候选召回：DB 路径用 pgvector <=> 召回；JSON 路径全量扫描
    if db.available():
        if query_vec is not None:
            candidates = db.search_chunks(query_vec, max(20, top_k * 4))
        else:
            candidates = _candidates_from_docs(store.all())
    else:
        candidates = _candidates_from_docs(store.all())

    results = _score_candidates(candidates, keywords, query_vec)

    # Rerank 精排：粗召回取 top_k*4 候选，rerank 后取 top_k
    if rerank.available() and len(results) > top_k:
        candidates = results[: top_k * 4]
        ranked = rerank.rerank(query, [c["text"] for c in candidates], top_k)
        if ranked:
            reranked = []
            for idx, rel in ranked:
                item = dict(candidates[idx])
                item["score"] = rel  # 用相关分数覆盖，便于排序
                reranked.append(item)
            return reranked

    return results[:top_k]
