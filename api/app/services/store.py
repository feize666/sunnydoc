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

# 用于区分「未传参」与「显式传 None」的哨兵值
_UNSET = object()

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
        self._folders: list[dict[str, Any]] = []
        self._kbs: list[dict[str, Any]] = []
        self._recent: list[dict[str, Any]] = []
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
                data = json.loads(STORE_FILE.read_text("utf-8"))
            except (json.JSONDecodeError, OSError):
                data = []
            # 兼容旧版「纯文档数组」结构
            if isinstance(data, list):
                self._docs = data
                self._folders = []
                self._kbs = []
                self._recent = []
            else:
                self._docs = data.get("documents", [])
                self._folders = data.get("folders", [])
                self._kbs = data.get("kbs", [])
                self._recent = data.get("recent", [])
        # 补齐旧数据缺失的 folder_id/kb_id 字段，保证 all() 返回结构一致
        for d in self._docs:
            d.setdefault("folder_id", None)
            d.setdefault("kb_id", None)
        for f in self._folders:
            f.setdefault("kb_id", None)

    def _save(self) -> None:
        STORE_FILE.parent.mkdir(parents=True, exist_ok=True)
        STORE_FILE.write_text(
            json.dumps(
                {
                    "documents": self._docs,
                    "folders": self._folders,
                    "kbs": self._kbs,
                    "recent": self._recent,
                },
                ensure_ascii=False,
                indent=2,
            ),
            "utf-8",
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

    def add(
        self,
        title: str,
        text: str,
        source: str,
        ext: str,
        folder_id: str | None = None,
        kb_id: str | None = None,
    ) -> dict[str, Any]:
        doc = {
            "id": uuid.uuid4().hex,
            "title": title,
            "text": text,
            "source": source,
            "ext": ext,
            "created_at": time.time(),
            "folder_id": folder_id,
            "kb_id": kb_id,
            "chunks": self._build_chunks(text),
        }
        if self._backend == "db":
            db.add_document(doc)
        else:
            self._docs.append(doc)
            self._save()
        return doc

    def update(
        self,
        doc_id: str,
        title: Any = _UNSET,
        text: Any = _UNSET,
        folder_id: Any = _UNSET,
        kb_id: Any = _UNSET,
    ) -> dict[str, Any] | None:
        """更新文档字段。title/text 提供时更新并重建分片 + 向量；folder_id/kb_id 提供时移动。找不到返回 None。"""
        if self._backend == "db":
            doc = db.get_document(doc_id)
            if doc is None:
                return None
            if title is not _UNSET:
                doc["title"] = title
            if text is not _UNSET:
                doc["text"] = text
                doc["chunks"] = self._build_chunks(text)
            if folder_id is not _UNSET:
                doc["folder_id"] = folder_id
            if kb_id is not _UNSET:
                doc["kb_id"] = kb_id
            return db.update_document(doc_id, doc)
        for d in self._docs:
            if d["id"] == doc_id:
                if title is not _UNSET:
                    d["title"] = title
                if text is not _UNSET:
                    d["text"] = text
                    d["chunks"] = self._build_chunks(text)
                if folder_id is not _UNSET:
                    d["folder_id"] = folder_id
                if kb_id is not _UNSET:
                    d["kb_id"] = kb_id
                self._save()
                return d
        return None

    def add_many(self, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        docs: list[dict[str, Any]] = []
        for item in items:
            docs.append(
                self.add(
                    item["title"],
                    item["text"],
                    item["source"],
                    item["ext"],
                    item.get("folder_id"),
                    item.get("kb_id"),
                )
            )
        return docs

    def all(self, kb_id: str | None = None) -> list[dict[str, Any]]:
        """返回全部文档；kb_id 提供时仅返回该知识库下的文档。"""
        if self._backend == "db":
            return db.all_documents(kb_id)
        if kb_id is None:
            return list(self._docs)
        return [d for d in self._docs if d.get("kb_id") == kb_id]

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

    # ---------- 文件夹 ----------

    def list_folders(self, kb_id: str | None = None) -> list[dict[str, Any]]:
        """返回全部文件夹（扁平列表，含 parent_id，供前端组装树）。

        kb_id 提供时仅返回该知识库下的文件夹。
        """
        if self._backend == "db":
            return db.list_folders(kb_id)
        if kb_id is None:
            return list(self._folders)
        return [f for f in self._folders if f.get("kb_id") == kb_id]

    def create_folder(
        self, name: str, parent_id: str | None = None, kb_id: str | None = None
    ) -> dict[str, Any]:
        folder = {
            "id": uuid.uuid4().hex,
            "name": name,
            "parent_id": parent_id,
            "created_at": time.time(),
            "kb_id": kb_id,
        }
        if self._backend == "db":
            db.create_folder(folder)
        else:
            self._folders.append(folder)
            self._save()
        return folder

    def rename_folder(self, folder_id: str, name: str) -> dict[str, Any] | None:
        """重命名文件夹，不存在返回 None。"""
        if self._backend == "db":
            return db.rename_folder(folder_id, name)
        for f in self._folders:
            if f["id"] == folder_id:
                f["name"] = name
                self._save()
                return dict(f)
        return None

    def delete_folder(self, folder_id: str) -> bool:
        """删除文件夹：级联删除子文件夹，其下文档 folder_id 置空（移回根目录）。"""
        if self._backend == "db":
            return db.delete_folder(folder_id)
        # 收集自身 + 所有后代文件夹 id
        ids = [folder_id]
        idx = 0
        while idx < len(ids):
            for f in self._folders:
                if f["parent_id"] == ids[idx] and f["id"] not in ids:
                    ids.append(f["id"])
            idx += 1

        existed = any(f["id"] == folder_id for f in self._folders)
        if not existed:
            return False

        self._folders = [f for f in self._folders if f["id"] not in ids]
        # 文档移回根目录
        for d in self._docs:
            if d.get("folder_id") in ids:
                d["folder_id"] = None
        self._save()
        return True

    # ---------- 知识库 ----------

    def list_kbs(self) -> list[dict[str, Any]]:
        """返回全部知识库（不含 doc_count，由调用方补齐）。"""
        if self._backend == "db":
            return db.list_kbs()
        return [dict(k) for k in self._kbs]

    def create_kb(self, name: str, description: str | None = None) -> dict[str, Any]:
        kb = {
            "id": uuid.uuid4().hex,
            "name": name,
            "description": description,
            "created_at": time.time(),
        }
        if self._backend == "db":
            db.create_kb(kb)
        else:
            self._kbs.append(kb)
            self._save()
        return kb

    def get_kb(self, kb_id: str) -> dict[str, Any] | None:
        if self._backend == "db":
            return db.get_kb(kb_id)
        for k in self._kbs:
            if k["id"] == kb_id:
                return dict(k)
        return None

    def update_kb(
        self,
        kb_id: str,
        name: Any = _UNSET,
        description: Any = _UNSET,
    ) -> dict[str, Any] | None:
        """更新知识库字段，_UNSET 表示不修改。不存在返回 None。"""
        if self._backend == "db":
            return db.update_kb(kb_id, name, description)
        for k in self._kbs:
            if k["id"] == kb_id:
                if name is not _UNSET:
                    k["name"] = name
                if description is not _UNSET:
                    k["description"] = description
                self._save()
                return dict(k)
        return None

    def count_docs(self, kb_id: str) -> int:
        if self._backend == "db":
            return db.count_docs(kb_id)
        return sum(1 for d in self._docs if d.get("kb_id") == kb_id)

    def delete_kb(self, kb_id: str) -> bool:
        """级联删除知识库：删除其下所有文档、文件夹与最近浏览记录。

        媒体文件采用内容寻址去重（可能被其它知识库/文档共享），此处不物理删除。
        """
        if self._backend == "db":
            return db.delete_kb(kb_id)
        existed = any(k["id"] == kb_id for k in self._kbs)
        if not existed:
            return False
        self._kbs = [k for k in self._kbs if k["id"] != kb_id]
        self._docs = [d for d in self._docs if d.get("kb_id") != kb_id]
        self._folders = [f for f in self._folders if f.get("kb_id") != kb_id]
        self._recent = [r for r in self._recent if r.get("kb_id") != kb_id]
        self._save()
        return True

    # ---------- 最近浏览 ----------

    def record_recent(self, doc_id: str) -> dict[str, Any] | None:
        """记录一次浏览（同 doc_id 去重只保留最新）。文档不存在返回 None。"""
        doc = self.get(doc_id)
        if doc is None:
            return None
        kb_id = doc.get("kb_id")
        if self._backend == "db":
            return db.record_recent(doc_id, kb_id)
        self._recent = [r for r in self._recent if r.get("doc_id") != doc_id]
        rec = {
            "id": uuid.uuid4().hex,
            "doc_id": doc_id,
            "kb_id": kb_id,
            "viewed_at": time.time(),
        }
        self._recent.append(rec)
        self._save()
        return rec

    def list_recent(self, limit: int = 20) -> list[dict[str, Any]]:
        """按 viewed_at 倒序返回最近浏览，join 文档 title/source。"""
        if self._backend == "db":
            return db.list_recent(limit)
        # 按 viewed_at 倒序
        recs = sorted(self._recent, key=lambda r: r.get("viewed_at", 0), reverse=True)
        out: list[dict[str, Any]] = []
        for r in recs[:limit]:
            doc = next((d for d in self._docs if d["id"] == r["doc_id"]), None)
            out.append(
                {
                    "doc_id": r["doc_id"],
                    "kb_id": r.get("kb_id"),
                    "viewed_at": r["viewed_at"],
                    "title": doc["title"] if doc else None,
                    "source": doc["source"] if doc else None,
                }
            )
        return out


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
