"""PostgreSQL + pgvector 存储层。

在 DATABASE_URL 未配置或连接失败时优雅降级（available() 返回 False），
调用方（store.py）应据此回退到 JSON 文件存储。本模块不 import psycopg 到
模块顶层，避免未安装驱动时影响启动。
"""
from __future__ import annotations

import json
from typing import Any

from app.core.config import DATABASE_URL

# 连接与可用性缓存（进程内复用单连接）
_conn: Any = None
_available: bool | None = None


def _connect() -> Any:
    """惰性建立 psycopg 连接（同步驱动）。"""
    global _conn
    if _conn is not None and not _conn.closed:
        return _conn
    import psycopg  # 延迟 import，未安装驱动时不影响其它路径

    _conn = psycopg.connect(DATABASE_URL)
    return _conn


def _close() -> None:
    global _conn
    if _conn is not None:
        try:
            _conn.close()
        except Exception:
            pass
        _conn = None


def _vec_to_str(vec: list[float] | None) -> str | None:
    """把向量列表转成 pgvector 可识别的字符串字面量 [x,y,z]；None 保持 NULL。"""
    if vec is None:
        return None
    return "[" + ",".join(repr(float(x)) for x in vec) + "]"


def _str_to_vec(s: str | None) -> list[float] | None:
    """把 pgvector 返回的字符串 [x,y,z] 解析回 float 列表。"""
    if s is None:
        return None
    try:
        return [float(x) for x in json.loads(s)]
    except (json.JSONDecodeError, TypeError, ValueError):
        return None


def init() -> None:
    """创建扩展与表结构（幂等）。"""
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute("CREATE EXTENSION IF NOT EXISTS vector")
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS documents (
                id varchar PRIMARY KEY,
                title text,
                text text,
                source text,
                ext text,
                created_at double precision
            )
            """
        )
        # vector 不固定维度，维度由实际 embedding 决定
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS chunks (
                id serial PRIMARY KEY,
                doc_id varchar REFERENCES documents(id) ON DELETE CASCADE,
                segment_index integer,
                text text,
                vector vector
            )
            """
        )
    conn.commit()


def available() -> bool:
    """DATABASE_URL 是否配置 + 连接是否成功。失败返回 False，不影响启动。"""
    global _available
    if _available is not None:
        return _available
    if not DATABASE_URL:
        _available = False
        return False
    try:
        conn = _connect()
        with conn.cursor() as cur:
            cur.execute("SELECT 1")
        init()
        _available = True
    except Exception:
        _available = False
        _close()
    return _available


def _doc_from_row(row: Any) -> dict[str, Any]:
    return {
        "id": row[0],
        "title": row[1],
        "text": row[2],
        "source": row[3],
        "ext": row[4],
        "created_at": row[5],
    }


def _load_chunks(cur: Any, doc_id: str) -> list[dict[str, Any]]:
    cur.execute(
        "SELECT segment_index, text, vector FROM chunks WHERE doc_id = %s ORDER BY segment_index",
        (doc_id,),
    )
    return [
        {"text": text, "vector": _str_to_vec(vec)}
        for _idx, text, vec in cur.fetchall()
    ]


def add_document(doc: dict[str, Any]) -> dict[str, Any]:
    """写入文档及其 chunks（含向量）。"""
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO documents (id, title, text, source, ext, created_at)"
            " VALUES (%s, %s, %s, %s, %s, %s)",
            (
                doc["id"],
                doc["title"],
                doc["text"],
                doc["source"],
                doc["ext"],
                doc["created_at"],
            ),
        )
        for i, chunk in enumerate(doc["chunks"]):
            cur.execute(
                "INSERT INTO chunks (doc_id, segment_index, text, vector)"
                " VALUES (%s, %s, %s, %s)",
                (doc["id"], i, chunk["text"], _vec_to_str(chunk.get("vector"))),
            )
    conn.commit()
    return doc


def all_documents() -> list[dict[str, Any]]:
    """返回全部文档（含 chunks 与向量），结构与 JSON 存储保持一致。"""
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, title, text, source, ext, created_at"
            " FROM documents ORDER BY created_at DESC"
        )
        docs = [_doc_from_row(r) for r in cur.fetchall()]
        for doc in docs:
            doc["chunks"] = _load_chunks(cur, doc["id"])
    return docs


def get_document(doc_id: str) -> dict[str, Any] | None:
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, title, text, source, ext, created_at FROM documents WHERE id = %s",
            (doc_id,),
        )
        row = cur.fetchone()
        if row is None:
            return None
        doc = _doc_from_row(row)
        doc["chunks"] = _load_chunks(cur, doc_id)
    return doc


def update_document(doc_id: str, doc: dict[str, Any]) -> dict[str, Any] | None:
    """更新 documents 表并重建 chunks（含向量）。文档不存在返回 None。"""
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE documents SET title = %s, text = %s WHERE id = %s",
            (doc["title"], doc["text"], doc_id),
        )
        if cur.rowcount == 0:
            return None
        # 重建 chunks：先删旧分片，再写入新分片（含重新计算的向量）
        cur.execute("DELETE FROM chunks WHERE doc_id = %s", (doc_id,))
        for i, chunk in enumerate(doc["chunks"]):
            cur.execute(
                "INSERT INTO chunks (doc_id, segment_index, text, vector)"
                " VALUES (%s, %s, %s, %s)",
                (doc_id, i, chunk["text"], _vec_to_str(chunk.get("vector"))),
            )
    conn.commit()
    return doc


def delete_document(doc_id: str) -> bool:
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute("DELETE FROM documents WHERE id = %s", (doc_id,))
        deleted = cur.rowcount > 0
    conn.commit()
    return deleted


def search_chunks(query_vec: list[float], top_n: int) -> list[dict[str, Any]]:
    """用 pgvector 余弦距离（<=>）做 top 候选召回，返回 chunk 级候选。

    返回结构与 JSON 路径的候选一致，便于在 Python 层继续做混合打分。
    """
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT d.id, d.title, d.source, c.segment_index, c.text, c.vector
            FROM chunks c
            JOIN documents d ON d.id = c.doc_id
            WHERE c.vector IS NOT NULL
            ORDER BY c.vector <=> %s::vector
            LIMIT %s
            """,
            (_vec_to_str(query_vec), top_n),
        )
        rows = cur.fetchall()
    return [
        {
            "doc_id": r[0],
            "title": r[1],
            "source": r[2],
            "segment_index": r[3],
            "text": r[4],
            "vector": _str_to_vec(r[5]),
        }
        for r in rows
    ]
