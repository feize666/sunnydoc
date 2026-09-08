"""PostgreSQL + pgvector 存储层。

在 DATABASE_URL 未配置或连接失败时优雅降级（available() 返回 False），
调用方（store.py）应据此回退到 JSON 文件存储。本模块不 import psycopg 到
模块顶层，避免未安装驱动时影响启动。
"""
from __future__ import annotations

import json
import time
import uuid
from typing import Any

from app.core.config import DATABASE_URL

# 连接与可用性缓存（进程内复用单连接）
_conn: Any = None
_available: bool | None = None

# 用于区分「未传参」与「显式传 None」的哨兵值
_UNSET = object()


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
        # 兼容已有生产数据：为 documents 表补充 folder_id / kb_id 列
        cur.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS folder_id varchar")
        cur.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS kb_id varchar")
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS folders (
                id varchar PRIMARY KEY,
                name text,
                parent_id varchar,
                created_at double precision
            )
            """
        )
        # 兼容已有生产数据：为 folders 表补充 kb_id 列
        cur.execute("ALTER TABLE folders ADD COLUMN IF NOT EXISTS kb_id varchar")
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
        # 知识库
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS knowledge_bases (
                id varchar PRIMARY KEY,
                name text,
                description text,
                created_at double precision
            )
            """
        )
        # 最近浏览（同一 doc_id 只保留最新一条）
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS recent_views (
                id varchar PRIMARY KEY,
                doc_id varchar,
                kb_id varchar,
                viewed_at double precision
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
        "folder_id": row[6],
        "kb_id": row[7],
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
            "INSERT INTO documents (id, title, text, source, ext, created_at, folder_id, kb_id)"
            " VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
            (
                doc["id"],
                doc["title"],
                doc["text"],
                doc["source"],
                doc["ext"],
                doc["created_at"],
                doc.get("folder_id"),
                doc.get("kb_id"),
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


def all_documents(kb_id: str | None = None) -> list[dict[str, Any]]:
    """返回全部文档（含 chunks 与向量），结构与 JSON 存储保持一致。

    kb_id 提供时仅返回该知识库下的文档。
    """
    conn = _connect()
    with conn.cursor() as cur:
        if kb_id is None:
            cur.execute(
                "SELECT id, title, text, source, ext, created_at, folder_id, kb_id"
                " FROM documents ORDER BY created_at DESC"
            )
        else:
            cur.execute(
                "SELECT id, title, text, source, ext, created_at, folder_id, kb_id"
                " FROM documents WHERE kb_id = %s ORDER BY created_at DESC",
                (kb_id,),
            )
        docs = [_doc_from_row(r) for r in cur.fetchall()]
        for doc in docs:
            doc["chunks"] = _load_chunks(cur, doc["id"])
    return docs


def get_document(doc_id: str) -> dict[str, Any] | None:
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, title, text, source, ext, created_at, folder_id, kb_id FROM documents WHERE id = %s",
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
            "UPDATE documents SET title = %s, text = %s, folder_id = %s, kb_id = %s WHERE id = %s",
            (doc["title"], doc["text"], doc.get("folder_id"), doc.get("kb_id"), doc_id),
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


def create_folder(folder: dict[str, Any]) -> dict[str, Any]:
    """写入文件夹记录。"""
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO folders (id, name, parent_id, created_at, kb_id)"
            " VALUES (%s, %s, %s, %s, %s)",
            (
                folder["id"],
                folder["name"],
                folder["parent_id"],
                folder["created_at"],
                folder.get("kb_id"),
            ),
        )
    conn.commit()
    return folder


def list_folders(kb_id: str | None = None) -> list[dict[str, Any]]:
    """返回全部文件夹（扁平列表，含 parent_id，供前端组装树）。

    kb_id 提供时仅返回该知识库下的文件夹。
    """
    conn = _connect()
    with conn.cursor() as cur:
        if kb_id is None:
            cur.execute(
                "SELECT id, name, parent_id, created_at, kb_id FROM folders ORDER BY created_at"
            )
        else:
            cur.execute(
                "SELECT id, name, parent_id, created_at, kb_id FROM folders WHERE kb_id = %s ORDER BY created_at",
                (kb_id,),
            )
        return [
            {
                "id": r[0],
                "name": r[1],
                "parent_id": r[2],
                "created_at": r[3],
                "kb_id": r[4],
            }
            for r in cur.fetchall()
        ]


def rename_folder(folder_id: str, name: str) -> dict[str, Any] | None:
    """重命名文件夹，不存在返回 None。"""
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute("UPDATE folders SET name = %s WHERE id = %s", (name, folder_id))
        if cur.rowcount == 0:
            return None
        cur.execute(
            "SELECT id, name, parent_id, created_at, kb_id FROM folders WHERE id = %s",
            (folder_id,),
        )
        row = cur.fetchone()
    conn.commit()
    return {
        "id": row[0],
        "name": row[1],
        "parent_id": row[2],
        "created_at": row[3],
        "kb_id": row[4],
    }


def delete_folder(folder_id: str) -> bool:
    """删除文件夹：级联删除其子文件夹，子级/本级文档 folder_id 置空（移回根目录）。"""
    conn = _connect()
    with conn.cursor() as cur:
        # 收集自身 + 所有后代文件夹 id
        ids = [folder_id]
        idx = 0
        while idx < len(ids):
            cur.execute(
                "SELECT id FROM folders WHERE parent_id = %s", (ids[idx],)
            )
            for (child_id,) in cur.fetchall():
                if child_id not in ids:
                    ids.append(child_id)
            idx += 1

        placeholders = ",".join(["%s"] * len(ids))
        cur.execute(
            f"UPDATE documents SET folder_id = NULL WHERE folder_id IN ({placeholders})",
            ids,
        )
        cur.execute(
            f"DELETE FROM folders WHERE id IN ({placeholders})", ids
        )
        deleted = cur.rowcount > 0
    conn.commit()
    return deleted


# ---------- 知识库 ----------

def create_kb(kb: dict[str, Any]) -> dict[str, Any]:
    """写入知识库记录。"""
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO knowledge_bases (id, name, description, created_at)"
            " VALUES (%s, %s, %s, %s)",
            (kb["id"], kb["name"], kb.get("description"), kb["created_at"]),
        )
    conn.commit()
    return kb


def list_kbs() -> list[dict[str, Any]]:
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, name, description, created_at FROM knowledge_bases ORDER BY created_at"
        )
        return [
            {
                "id": r[0],
                "name": r[1],
                "description": r[2],
                "created_at": r[3],
            }
            for r in cur.fetchall()
        ]


def get_kb(kb_id: str) -> dict[str, Any] | None:
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, name, description, created_at FROM knowledge_bases WHERE id = %s",
            (kb_id,),
        )
        row = cur.fetchone()
        if row is None:
            return None
        return {
            "id": row[0],
            "name": row[1],
            "description": row[2],
            "created_at": row[3],
        }


def update_kb(
    kb_id: str, name: Any = _UNSET, description: Any = _UNSET
) -> dict[str, Any] | None:
    """更新知识库字段，_UNSET 表示不修改。不存在返回 None。"""
    kb = get_kb(kb_id)
    if kb is None:
        return None
    if name is not _UNSET:
        kb["name"] = name
    if description is not _UNSET:
        kb["description"] = description
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE knowledge_bases SET name = %s, description = %s WHERE id = %s",
            (kb["name"], kb["description"], kb_id),
        )
    conn.commit()
    return kb


def count_docs(kb_id: str) -> int:
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM documents WHERE kb_id = %s", (kb_id,))
        row = cur.fetchone()
        return int(row[0]) if row else 0


def delete_kb(kb_id: str) -> bool:
    """级联删除知识库：删除其下文档（chunks 随外键级联）、文件夹与最近浏览记录。"""
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute("DELETE FROM documents WHERE kb_id = %s", (kb_id,))
        cur.execute("DELETE FROM folders WHERE kb_id = %s", (kb_id,))
        cur.execute("DELETE FROM recent_views WHERE kb_id = %s", (kb_id,))
        cur.execute("DELETE FROM knowledge_bases WHERE id = %s", (kb_id,))
        deleted = cur.rowcount > 0
    conn.commit()
    return deleted


# ---------- 最近浏览 ----------

def record_recent(doc_id: str, kb_id: str | None) -> dict[str, Any]:
    """记录一次浏览：同一 doc_id 只保留最新一条（DELETE + INSERT）。"""
    rec_id = uuid.uuid4().hex
    viewed_at = time.time()
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute("DELETE FROM recent_views WHERE doc_id = %s", (doc_id,))
        cur.execute(
            "INSERT INTO recent_views (id, doc_id, kb_id, viewed_at)"
            " VALUES (%s, %s, %s, %s)",
            (rec_id, doc_id, kb_id, viewed_at),
        )
    conn.commit()
    return {"id": rec_id, "doc_id": doc_id, "kb_id": kb_id, "viewed_at": viewed_at}


def list_recent(limit: int = 20) -> list[dict[str, Any]]:
    """按 viewed_at 倒序返回最近浏览（join documents 取 title/source）。"""
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT r.doc_id, r.kb_id, r.viewed_at, d.title, d.source
            FROM recent_views r
            LEFT JOIN documents d ON d.id = r.doc_id
            ORDER BY r.viewed_at DESC
            LIMIT %s
            """,
            (limit,),
        )
        return [
            {
                "doc_id": r[0],
                "kb_id": r[1],
                "viewed_at": r[2],
                "title": r[3],
                "source": r[4],
            }
            for r in cur.fetchall()
        ]


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
