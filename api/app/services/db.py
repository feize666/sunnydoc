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
        # 兼容已有生产数据：为 documents 表补充 folder_id / kb_id / user_id 列
        cur.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS folder_id varchar")
        cur.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS kb_id varchar")
        cur.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS user_id varchar")
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
        # 兼容已有生产数据：为 folders 表补充 kb_id / user_id 列
        cur.execute("ALTER TABLE folders ADD COLUMN IF NOT EXISTS kb_id varchar")
        cur.execute("ALTER TABLE folders ADD COLUMN IF NOT EXISTS user_id varchar")
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
        cur.execute("ALTER TABLE knowledge_bases ADD COLUMN IF NOT EXISTS user_id varchar")
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
        cur.execute("ALTER TABLE recent_views ADD COLUMN IF NOT EXISTS user_id varchar")
        # 用户
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id varchar PRIMARY KEY,
                username varchar UNIQUE,
                password_hash text,
                created_at double precision
            )
            """
        )
        for col, ddl in [
            ("role", "varchar"),
            ("nickname", "varchar"),
            ("email", "varchar"),
            ("avatar", "varchar"),
            ("status", "varchar"),
            ("updated_at", "double precision"),
        ]:
            cur.execute(f"ALTER TABLE users ADD COLUMN IF NOT EXISTS {col} {ddl}")
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
        "user_id": row[8],
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


_DOC_COLS = "id, title, text, source, ext, created_at, folder_id, kb_id, user_id"


def add_document(doc: dict[str, Any]) -> dict[str, Any]:
    """写入文档及其 chunks（含向量）。"""
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO documents (id, title, text, source, ext, created_at, folder_id, kb_id, user_id)"
            " VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
            (
                doc["id"],
                doc["title"],
                doc["text"],
                doc["source"],
                doc["ext"],
                doc["created_at"],
                doc.get("folder_id"),
                doc.get("kb_id"),
                doc.get("user_id"),
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


def all_documents(
    kb_id: str | None = None, user_id: str | None = None
) -> list[dict[str, Any]]:
    """返回全部文档（含 chunks 与向量），结构与 JSON 存储保持一致。

    kb_id / user_id 提供时按对应维度过滤。
    """
    conn = _connect()
    with conn.cursor() as cur:
        sql = f"SELECT {_DOC_COLS} FROM documents"
        conds: list[str] = []
        params: list[Any] = []
        if kb_id is not None:
            conds.append("kb_id = %s")
            params.append(kb_id)
        if user_id is not None:
            conds.append("user_id = %s")
            params.append(user_id)
        if conds:
            sql += " WHERE " + " AND ".join(conds)
        sql += " ORDER BY created_at DESC"
        cur.execute(sql, params)
        docs = [_doc_from_row(r) for r in cur.fetchall()]
        for doc in docs:
            doc["chunks"] = _load_chunks(cur, doc["id"])
    return docs


def get_document(doc_id: str) -> dict[str, Any] | None:
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute(
            f"SELECT {_DOC_COLS} FROM documents WHERE id = %s",
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
            "INSERT INTO folders (id, name, parent_id, created_at, kb_id, user_id)"
            " VALUES (%s, %s, %s, %s, %s, %s)",
            (
                folder["id"],
                folder["name"],
                folder["parent_id"],
                folder["created_at"],
                folder.get("kb_id"),
                folder.get("user_id"),
            ),
        )
    conn.commit()
    return folder


def list_folders(
    kb_id: str | None = None, user_id: str | None = None
) -> list[dict[str, Any]]:
    """返回全部文件夹（扁平列表，含 parent_id，供前端组装树）。

    kb_id / user_id 提供时按对应维度过滤。
    """
    conn = _connect()
    with conn.cursor() as cur:
        sql = "SELECT id, name, parent_id, created_at, kb_id, user_id FROM folders"
        conds: list[str] = []
        params: list[Any] = []
        if kb_id is not None:
            conds.append("kb_id = %s")
            params.append(kb_id)
        if user_id is not None:
            conds.append("user_id = %s")
            params.append(user_id)
        if conds:
            sql += " WHERE " + " AND ".join(conds)
        sql += " ORDER BY created_at"
        cur.execute(sql, params)
        return [
            {
                "id": r[0],
                "name": r[1],
                "parent_id": r[2],
                "created_at": r[3],
                "kb_id": r[4],
                "user_id": r[5],
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
            "SELECT id, name, parent_id, created_at, kb_id, user_id FROM folders WHERE id = %s",
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
        "user_id": row[5],
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
            "INSERT INTO knowledge_bases (id, name, description, created_at, user_id)"
            " VALUES (%s, %s, %s, %s, %s)",
            (kb["id"], kb["name"], kb.get("description"), kb["created_at"], kb.get("user_id")),
        )
    conn.commit()
    return kb


def list_kbs(user_id: str | None = None) -> list[dict[str, Any]]:
    conn = _connect()
    with conn.cursor() as cur:
        if user_id is None:
            cur.execute(
                "SELECT id, name, description, created_at, user_id FROM knowledge_bases ORDER BY created_at"
            )
        else:
            cur.execute(
                "SELECT id, name, description, created_at, user_id FROM knowledge_bases WHERE user_id = %s ORDER BY created_at",
                (user_id,),
            )
        return [
            {
                "id": r[0],
                "name": r[1],
                "description": r[2],
                "created_at": r[3],
                "user_id": r[4],
            }
            for r in cur.fetchall()
        ]


def get_kb(kb_id: str) -> dict[str, Any] | None:
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, name, description, created_at, user_id FROM knowledge_bases WHERE id = %s",
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
            "user_id": row[4],
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

def record_recent(doc_id: str, kb_id: str | None, user_id: str | None) -> dict[str, Any]:
    """记录一次浏览：同一 doc_id 只保留最新一条（DELETE + INSERT）。"""
    rec_id = uuid.uuid4().hex
    viewed_at = time.time()
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute(
            "DELETE FROM recent_views WHERE doc_id = %s AND user_id IS NOT DISTINCT FROM %s",
            (doc_id, user_id),
        )
        cur.execute(
            "INSERT INTO recent_views (id, doc_id, kb_id, viewed_at, user_id)"
            " VALUES (%s, %s, %s, %s, %s)",
            (rec_id, doc_id, kb_id, viewed_at, user_id),
        )
    conn.commit()
    return {
        "id": rec_id,
        "doc_id": doc_id,
        "kb_id": kb_id,
        "viewed_at": viewed_at,
        "user_id": user_id,
    }


def list_recent(limit: int = 20, user_id: str | None = None) -> list[dict[str, Any]]:
    """按 viewed_at 倒序返回最近浏览（join documents 取 title/source）。"""
    conn = _connect()
    with conn.cursor() as cur:
        if user_id is None:
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
        else:
            cur.execute(
                """
                SELECT r.doc_id, r.kb_id, r.viewed_at, d.title, d.source
                FROM recent_views r
                LEFT JOIN documents d ON d.id = r.doc_id
                WHERE r.user_id = %s
                ORDER BY r.viewed_at DESC
                LIMIT %s
                """,
                (user_id, limit),
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


def search_chunks(
    query_vec: list[float], top_n: int, user_id: str | None = None
) -> list[dict[str, Any]]:
    """用 pgvector 余弦距离（<=>）做 top 候选召回，返回 chunk 级候选。

    user_id 提供时仅在该用户文档内召回。返回结构与 JSON 路径的候选一致。
    """
    conn = _connect()
    with conn.cursor() as cur:
        if user_id is None:
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
        else:
            cur.execute(
                """
                SELECT d.id, d.title, d.source, c.segment_index, c.text, c.vector
                FROM chunks c
                JOIN documents d ON d.id = c.doc_id
                WHERE c.vector IS NOT NULL AND d.user_id = %s
                ORDER BY c.vector <=> %s::vector
                LIMIT %s
                """,
                (user_id, _vec_to_str(query_vec), top_n),
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


# ---------- 用户 ----------

_USER_COLS = "id, username, password_hash, role, nickname, email, avatar, status, created_at, updated_at"


def _user_from_row(row: Any) -> dict[str, Any]:
    return {
        "id": row[0],
        "username": row[1],
        "password_hash": row[2],
        "role": row[3] or "user",
        "nickname": row[4],
        "email": row[5],
        "avatar": row[6],
        "status": row[7] or "active",
        "created_at": row[8],
        "updated_at": row[9],
    }


def create_user(
    username: str,
    password_hash: str,
    role: str = "user",
    nickname: str | None = None,
    email: str | None = None,
    avatar: str | None = None,
) -> dict[str, Any] | None:
    """创建用户；用户名已存在返回 None。"""
    import time as _time

    conn = _connect()
    user_id = uuid.uuid4().hex
    now = _time.time()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO users (id, username, password_hash, role, nickname, email, avatar, status, created_at, updated_at)"
                " VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                (
                    user_id,
                    username,
                    password_hash,
                    role,
                    nickname or username,
                    email,
                    avatar,
                    "active",
                    now,
                    now,
                ),
            )
        conn.commit()
    except Exception:
        conn.rollback()
        return None
    return {
        "id": user_id,
        "username": username,
        "password_hash": password_hash,
        "role": role,
        "nickname": nickname or username,
        "email": email,
        "avatar": avatar,
        "status": "active",
        "created_at": now,
        "updated_at": now,
    }


def get_user_by_username(username: str) -> dict[str, Any] | None:
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute(
            f"SELECT {_USER_COLS} FROM users WHERE username = %s",
            (username,),
        )
        row = cur.fetchone()
    return _user_from_row(row) if row else None


def get_user_by_id(user_id: str) -> dict[str, Any] | None:
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute(
            f"SELECT {_USER_COLS} FROM users WHERE id = %s",
            (user_id,),
        )
        row = cur.fetchone()
    return _user_from_row(row) if row else None


def list_users() -> list[dict[str, Any]]:
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute(
            f"SELECT {_USER_COLS} FROM users ORDER BY created_at"
        )
        rows = cur.fetchall()
    return [_user_from_row(r) for r in rows]


def update_user(
    user_id: str,
    password_hash: Any = _UNSET,
    role: Any = _UNSET,
    nickname: Any = _UNSET,
    email: Any = _UNSET,
    avatar: Any = _UNSET,
    status: Any = _UNSET,
) -> dict[str, Any] | None:
    """更新用户字段，_UNSET 表示不修改。不存在返回 None。"""
    import time as _time

    user = get_user_by_id(user_id)
    if user is None:
        return None
    if password_hash is not _UNSET:
        user["password_hash"] = password_hash
    if role is not _UNSET:
        user["role"] = role
    if nickname is not _UNSET:
        user["nickname"] = nickname
    if email is not _UNSET:
        user["email"] = email
    if avatar is not _UNSET:
        user["avatar"] = avatar
    if status is not _UNSET:
        user["status"] = status
    user["updated_at"] = _time.time()
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE users SET password_hash = %s, role = %s, nickname = %s, email = %s,"
            " avatar = %s, status = %s, updated_at = %s WHERE id = %s",
            (
                user["password_hash"],
                user["role"],
                user["nickname"],
                user["email"],
                user["avatar"],
                user["status"],
                user["updated_at"],
                user_id,
            ),
        )
    conn.commit()
    return user


def delete_user(user_id: str) -> bool:
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute("DELETE FROM users WHERE id = %s", (user_id,))
        deleted = cur.rowcount > 0
    conn.commit()
    return deleted
