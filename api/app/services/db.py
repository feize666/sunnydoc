"""PostgreSQL + pgvector 存储层。

在 DATABASE_URL 未配置或连接失败时优雅降级（available() 返回 False），
调用方（store.py）应据此回退到 JSON 文件存储。本模块不 import psycopg 到
模块顶层，避免未安装驱动时影响启动。
"""
from __future__ import annotations

import json
import threading
import time
import uuid
from typing import Any

from app.core.config import DATABASE_URL

# 每线程独立连接：避免多线程共享单连接导致的并发冲突与锁竞争。
# autocommit 模式：SELECT 不再残留 idle-in-transaction 事务（否则会持有
# ACCESS SHARE 锁，阻塞 ALTER TABLE 等 DDL），单条写操作立即提交。
_local = threading.local()
_available: bool | None = None

# 用于区分「未传参」与「显式传 None」的哨兵值
_UNSET = object()


def _connect() -> Any:
    """取当前线程的 psycopg 连接（惰性建立，autocommit 模式）。"""
    conn = getattr(_local, "conn", None)
    if conn is not None and not conn.closed:
        return conn
    import psycopg  # 延迟 import，未安装驱动时不影响其它路径

    conn = psycopg.connect(DATABASE_URL)
    conn.autocommit = True
    _local.conn = conn
    return conn


def _close() -> None:
    """关闭当前线程的连接（进程退出/连接失败时清理）。"""
    conn = getattr(_local, "conn", None)
    if conn is not None:
        try:
            conn.close()
        except Exception:
            pass
        _local.conn = None


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
        # 回收站（软删除） / 标签 / 置顶 / AI 摘要
        cur.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS deleted_at double precision")
        cur.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS tags varchar")
        cur.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS pinned boolean DEFAULT false")
        cur.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS summary text")
        # 节点类型（doc/table/board/... 预留）
        cur.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS type varchar DEFAULT 'doc'")
        # 手动排序（拖拽用）
        cur.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS sort_order double precision")
        cur.execute("UPDATE documents SET sort_order = created_at WHERE sort_order IS NULL")
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
        cur.execute("ALTER TABLE folders ADD COLUMN IF NOT EXISTS deleted_at double precision")
        cur.execute("ALTER TABLE folders ADD COLUMN IF NOT EXISTS sort_order double precision")
        cur.execute("UPDATE folders SET sort_order = created_at WHERE sort_order IS NULL")
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
        cur.execute("ALTER TABLE knowledge_bases ADD COLUMN IF NOT EXISTS deleted_at double precision")
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
        # 知识库共享（kb_id + user_id + permission: read/write）
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS kb_shares (
                id varchar PRIMARY KEY,
                kb_id varchar,
                user_id varchar,
                permission varchar,
                created_at double precision
            )
            """
        )
        # 文档收藏（user_id + doc_id，同一用户同一文档只收藏一次）
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS favorites (
                id varchar PRIMARY KEY,
                user_id varchar,
                doc_id varchar,
                created_at double precision
            )
            """
        )
        # 文档分享链接（token 唯一，公开只读访问）
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS share_links (
                id varchar PRIMARY KEY,
                token varchar UNIQUE,
                doc_id varchar,
                created_at double precision
            )
            """
        )
        # 分享链接密码/有效期（老库迁移补列）
        cur.execute("ALTER TABLE share_links ADD COLUMN IF NOT EXISTS password varchar")
        cur.execute("ALTER TABLE share_links ADD COLUMN IF NOT EXISTS expires_at double precision")
        # 文档版本历史
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS document_versions (
                id varchar PRIMARY KEY,
                doc_id varchar,
                title text,
                text text,
                created_at double precision
            )
            """
        )
        cur.execute("CREATE INDEX IF NOT EXISTS idx_doc_versions_doc ON document_versions (doc_id)")
        # 系统设置（键值存储，如 AI 配置）
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS settings (
                key varchar PRIMARY KEY,
                value text,
                updated_at double precision
            )
            """
        )
        # 文档评论/批注
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS comments (
                id varchar PRIMARY KEY,
                doc_id varchar,
                user_id varchar,
                content text,
                quote text,
                created_at double precision
            )
            """
        )
        # 评论回复（嵌套一层）+ 提及的用户 id 列表（JSON 字符串）
        cur.execute("ALTER TABLE comments ADD COLUMN IF NOT EXISTS parent_id varchar")
        cur.execute("ALTER TABLE comments ADD COLUMN IF NOT EXISTS mentions text")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_comments_doc ON comments (doc_id)")
        # 通知（被 @ 提及 / 评论被回复 / 知识库共享）
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS notifications (
                id varchar PRIMARY KEY,
                user_id varchar,
                type varchar,
                actor_id varchar,
                doc_id varchar,
                kb_id varchar,
                content text,
                read boolean DEFAULT false,
                created_at double precision
            )
            """
        )
        cur.execute("CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id, read)")
        # 操作审计日志
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS audit_logs (
                id varchar PRIMARY KEY,
                user_id varchar,
                action varchar,
                target_type varchar,
                target_id varchar,
                detail text,
                created_at double precision
            )
            """
        )
        cur.execute("CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs (created_at)")
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
    tags_raw = row[10] if len(row) > 10 else None
    try:
        tags = json.loads(tags_raw) if tags_raw else []
    except Exception:  # noqa: BLE001
        tags = []
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
        "deleted_at": row[9] if len(row) > 9 else None,
        "tags": tags,
        "pinned": bool(row[11]) if len(row) > 11 else False,
        "summary": row[12] if len(row) > 12 else None,
        "type": row[13] if len(row) > 13 else "doc",
        "sort_order": row[14] if len(row) > 14 else None,
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


_DOC_COLS = "id, title, text, source, ext, created_at, folder_id, kb_id, user_id, deleted_at, tags, pinned, summary, type, sort_order"


def add_document(doc: dict[str, Any]) -> dict[str, Any]:
    """写入文档及其 chunks（含向量）。"""
    conn = _connect()
    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO documents (id, title, text, source, ext, created_at, folder_id, kb_id, user_id, type, sort_order)"
                " VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
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
                    doc.get("type", "doc"),
                    doc.get("sort_order", doc["created_at"]),
                ),
            )
            for i, chunk in enumerate(doc["chunks"]):
                cur.execute(
                    "INSERT INTO chunks (doc_id, segment_index, text, vector)"
                    " VALUES (%s, %s, %s, %s)",
                    (doc["id"], i, chunk["text"], _vec_to_str(chunk.get("vector"))),
                )
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
        conds: list[str] = ["deleted_at IS NULL"]
        params: list[Any] = []
        if kb_id is not None:
            conds.append("kb_id = %s")
            params.append(kb_id)
        if user_id is not None:
            conds.append("user_id = %s")
            params.append(user_id)
        if conds:
            sql += " WHERE " + " AND ".join(conds)
        sql += " ORDER BY pinned DESC, COALESCE(sort_order, created_at) DESC"
        cur.execute(sql, params)
        docs = [_doc_from_row(r) for r in cur.fetchall()]
        for doc in docs:
            doc["chunks"] = _load_chunks(cur, doc["id"])
    return docs


def all_documents_for_user(
    user_id: str, kb_ids: set[str] | None
) -> list[dict[str, Any]]:
    """返回用户可见的文档：可访问知识库（kb_id 集合）下的所有文档 + 其自有且未归属 kb 的文档。"""
    conn = _connect()
    with conn.cursor() as cur:
        if kb_ids:
            placeholders = ",".join(["%s"] * len(kb_ids))
            sql = (
                f"SELECT {_DOC_COLS} FROM documents WHERE deleted_at IS NULL AND"
                f" (kb_id IN ({placeholders})"
                " OR (user_id = %s AND kb_id IS NULL)) ORDER BY pinned DESC, COALESCE(sort_order, created_at) DESC"
            )
            params = list(kb_ids) + [user_id]
        else:
            sql = (
                f"SELECT {_DOC_COLS} FROM documents"
                " WHERE deleted_at IS NULL AND user_id = %s AND kb_id IS NULL ORDER BY pinned DESC, COALESCE(sort_order, created_at) DESC"
            )
            params = [user_id]
        cur.execute(sql, params)
        docs = [_doc_from_row(r) for r in cur.fetchall()]
        for doc in docs:
            doc["chunks"] = _load_chunks(cur, doc["id"])
    return docs


def get_document(doc_id: str) -> dict[str, Any] | None:
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute(
            f"SELECT {_DOC_COLS} FROM documents WHERE id = %s AND deleted_at IS NULL",
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
    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE documents SET title = %s, text = %s, folder_id = %s, kb_id = %s,"
                " sort_order = COALESCE(%s, sort_order) WHERE id = %s",
                (
                    doc["title"],
                    doc["text"],
                    doc.get("folder_id"),
                    doc.get("kb_id"),
                    doc.get("sort_order"),
                    doc_id,
                ),
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
    return doc


def delete_document(doc_id: str) -> bool:
    """软删除：标记 deleted_at，进入回收站。"""
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE documents SET deleted_at = %s WHERE id = %s AND deleted_at IS NULL",
            (time.time(), doc_id),
        )
        deleted = cur.rowcount > 0
    conn.commit()
    return deleted


def restore_document(doc_id: str) -> bool:
    """从回收站恢复。"""
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE documents SET deleted_at = NULL WHERE id = %s AND deleted_at IS NOT NULL",
            (doc_id,),
        )
        restored = cur.rowcount > 0
    conn.commit()
    return restored


def purge_document(doc_id: str) -> bool:
    """彻底删除（物理删除文档及其 chunks）。"""
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute("DELETE FROM documents WHERE id = %s", (doc_id,))
        deleted = cur.rowcount > 0
    conn.commit()
    return deleted


def list_trash_documents(user_id: str | None = None) -> list[dict[str, Any]]:
    """回收站中的文档列表（deleted_at 非空）。"""
    conn = _connect()
    with conn.cursor() as cur:
        sql = f"SELECT {_DOC_COLS} FROM documents WHERE deleted_at IS NOT NULL"
        params: list[Any] = []
        if user_id is not None:
            sql += " AND user_id = %s"
            params.append(user_id)
        sql += " ORDER BY deleted_at DESC"
        cur.execute(sql, params)
        return [_doc_from_row(r) for r in cur.fetchall()]


def set_document_tags(doc_id: str, tags: list[str]) -> bool:
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE documents SET tags = %s WHERE id = %s",
            (json.dumps(tags, ensure_ascii=False), doc_id),
        )
        updated = cur.rowcount > 0
    conn.commit()
    return updated


def set_document_pinned(doc_id: str, pinned: bool) -> bool:
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE documents SET pinned = %s WHERE id = %s",
            (pinned, doc_id),
        )
        updated = cur.rowcount > 0
    conn.commit()
    return updated


def set_document_summary(doc_id: str, summary: str) -> bool:
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE documents SET summary = %s WHERE id = %s",
            (summary, doc_id),
        )
        updated = cur.rowcount > 0
    conn.commit()
    return updated


def list_all_tags(user_id: str | None = None) -> list[str]:
    """聚合所有文档标签（去重）。"""
    conn = _connect()
    with conn.cursor() as cur:
        sql = "SELECT tags FROM documents WHERE deleted_at IS NULL AND tags IS NOT NULL"
        params: list[Any] = []
        if user_id is not None:
            sql += " AND user_id = %s"
            params.append(user_id)
        cur.execute(sql, params)
        all_tags: set[str] = set()
        for (tags_raw,) in cur.fetchall():
            try:
                for t in json.loads(tags_raw) if tags_raw else []:
                    all_tags.add(t)
            except Exception:  # noqa: BLE001
                continue
    return sorted(all_tags)


def create_folder(folder: dict[str, Any]) -> dict[str, Any]:
    """写入文件夹记录。"""
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO folders (id, name, parent_id, created_at, kb_id, user_id, sort_order)"
            " VALUES (%s, %s, %s, %s, %s, %s, %s)",
            (
                folder["id"],
                folder["name"],
                folder["parent_id"],
                folder["created_at"],
                folder.get("kb_id"),
                folder.get("user_id"),
                folder.get("sort_order", folder["created_at"]),
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
        sql = "SELECT id, name, parent_id, created_at, kb_id, user_id, sort_order FROM folders"
        conds: list[str] = ["deleted_at IS NULL"]
        params: list[Any] = []
        if kb_id is not None:
            conds.append("kb_id = %s")
            params.append(kb_id)
        if user_id is not None:
            conds.append("user_id = %s")
            params.append(user_id)
        if conds:
            sql += " WHERE " + " AND ".join(conds)
        sql += " ORDER BY COALESCE(sort_order, created_at)"
        cur.execute(sql, params)
        return [
            {
                "id": r[0],
                "name": r[1],
                "parent_id": r[2],
                "created_at": r[3],
                "kb_id": r[4],
                "user_id": r[5],
                "sort_order": r[6],
            }
            for r in cur.fetchall()
        ]


def list_folders_for_user(
    user_id: str, kb_ids: set[str] | None
) -> list[dict[str, Any]]:
    """返回用户可见的文件夹：可访问知识库下的所有文件夹 + 其自有且未归属 kb 的文件夹。"""
    conn = _connect()
    with conn.cursor() as cur:
        if kb_ids:
            placeholders = ",".join(["%s"] * len(kb_ids))
            sql = (
                "SELECT id, name, parent_id, created_at, kb_id, user_id, sort_order FROM folders"
                f" WHERE deleted_at IS NULL AND (kb_id IN ({placeholders}) OR (user_id = %s AND kb_id IS NULL))"
                " ORDER BY COALESCE(sort_order, created_at)"
            )
            params = list(kb_ids) + [user_id]
        else:
            sql = (
                "SELECT id, name, parent_id, created_at, kb_id, user_id, sort_order FROM folders"
                " WHERE deleted_at IS NULL AND user_id = %s AND kb_id IS NULL ORDER BY COALESCE(sort_order, created_at)"
            )
            params = [user_id]
        cur.execute(sql, params)
        return [
            {
                "id": r[0],
                "name": r[1],
                "parent_id": r[2],
                "created_at": r[3],
                "kb_id": r[4],
                "user_id": r[5],
                "sort_order": r[6],
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


def update_folder_parent(folder_id: str, parent_id: str | None, sort_order: float | None = None) -> bool:
    """移动文件夹（改 parent_id + 可选 sort_order），不存在返回 False。"""
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE folders SET parent_id = %s, sort_order = COALESCE(%s, sort_order) WHERE id = %s",
            (parent_id, sort_order, folder_id),
        )
        updated = cur.rowcount > 0
    conn.commit()
    return updated


def folder_descendant_ids(folder_id: str) -> set[str]:
    """返回某文件夹的所有后代 id（不含自身）。"""
    conn = _connect()
    with conn.cursor() as cur:
        ids: set[str] = set()
        frontier = [folder_id]
        while frontier:
            placeholders = ",".join(["%s"] * len(frontier))
            cur.execute(
                f"SELECT id FROM folders WHERE parent_id IN ({placeholders})",
                frontier,
            )
            children = [r[0] for r in cur.fetchall()]
            new_children = [c for c in children if c not in ids]
            ids.update(new_children)
            frontier = new_children
    return ids


def delete_folder(folder_id: str) -> bool:
    """软删除文件夹：标记自身 + 后代文件夹 deleted_at，子级/本级文档 folder_id 置空。"""
    conn = _connect()
    with conn.transaction():
        with conn.cursor() as cur:
            # 收集自身 + 所有后代文件夹 id
            ids = [folder_id]
            idx = 0
            while idx < len(ids):
                cur.execute(
                    "SELECT id FROM folders WHERE parent_id = %s AND deleted_at IS NULL",
                    (ids[idx],),
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
                f"UPDATE folders SET deleted_at = %s WHERE id IN ({placeholders})",
                [time.time()] + ids,
            )
            deleted = cur.rowcount > 0
    return deleted


def restore_folder(folder_id: str) -> bool:
    """从回收站恢复文件夹（仅自身；文档已移回根目录，不自动归位）。"""
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE folders SET deleted_at = NULL WHERE id = %s AND deleted_at IS NOT NULL",
            (folder_id,),
        )
        restored = cur.rowcount > 0
    conn.commit()
    return restored


def purge_folder(folder_id: str) -> bool:
    """彻底删除文件夹（物理删除）。"""
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute("DELETE FROM folders WHERE id = %s", (folder_id,))
        deleted = cur.rowcount > 0
    conn.commit()
    return deleted


def list_trash_folders(user_id: str | None = None) -> list[dict[str, Any]]:
    conn = _connect()
    with conn.cursor() as cur:
        sql = (
            "SELECT id, name, parent_id, created_at, kb_id, user_id, deleted_at"
            " FROM folders WHERE deleted_at IS NOT NULL"
        )
        params: list[Any] = []
        if user_id is not None:
            sql += " AND user_id = %s"
            params.append(user_id)
        sql += " ORDER BY deleted_at DESC"
        cur.execute(sql, params)
        return [
            {
                "id": r[0],
                "name": r[1],
                "parent_id": r[2],
                "created_at": r[3],
                "kb_id": r[4],
                "user_id": r[5],
                "deleted_at": r[6],
            }
            for r in cur.fetchall()
        ]


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
                "SELECT id, name, description, created_at, user_id FROM knowledge_bases WHERE deleted_at IS NULL ORDER BY created_at"
            )
        else:
            cur.execute(
                "SELECT id, name, description, created_at, user_id FROM knowledge_bases WHERE deleted_at IS NULL AND user_id = %s ORDER BY created_at",
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
            "SELECT id, name, description, created_at, user_id FROM knowledge_bases WHERE id = %s AND deleted_at IS NULL",
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
    """软删除知识库：标记 kb + 其下文档/文件夹 deleted_at。"""
    conn = _connect()
    with conn.transaction():
        with conn.cursor() as cur:
            now = time.time()
            cur.execute(
                "UPDATE documents SET deleted_at = %s WHERE kb_id = %s AND deleted_at IS NULL",
                (now, kb_id),
            )
            cur.execute(
                "UPDATE folders SET deleted_at = %s WHERE kb_id = %s AND deleted_at IS NULL",
                (now, kb_id),
            )
            cur.execute(
                "UPDATE knowledge_bases SET deleted_at = %s WHERE id = %s AND deleted_at IS NULL",
                (now, kb_id),
            )
            deleted = cur.rowcount > 0
    return deleted


def restore_kb(kb_id: str) -> bool:
    """从回收站恢复知识库及其下文档/文件夹。"""
    conn = _connect()
    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE knowledge_bases SET deleted_at = NULL WHERE id = %s AND deleted_at IS NOT NULL",
                (kb_id,),
            )
            restored = cur.rowcount > 0
            if restored:
                cur.execute(
                    "UPDATE documents SET deleted_at = NULL WHERE kb_id = %s",
                    (kb_id,),
                )
                cur.execute(
                    "UPDATE folders SET deleted_at = NULL WHERE kb_id = %s",
                    (kb_id,),
                )
    return restored


def purge_kb(kb_id: str) -> bool:
    """彻底删除知识库（物理删除其下文档/文件夹/共享/最近浏览）。"""
    conn = _connect()
    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute("DELETE FROM documents WHERE kb_id = %s", (kb_id,))
            cur.execute("DELETE FROM folders WHERE kb_id = %s", (kb_id,))
            cur.execute("DELETE FROM recent_views WHERE kb_id = %s", (kb_id,))
            cur.execute("DELETE FROM kb_shares WHERE kb_id = %s", (kb_id,))
            cur.execute("DELETE FROM knowledge_bases WHERE id = %s", (kb_id,))
            deleted = cur.rowcount > 0
    return deleted


def list_trash_kbs(user_id: str | None = None) -> list[dict[str, Any]]:
    conn = _connect()
    with conn.cursor() as cur:
        sql = (
            "SELECT id, name, description, created_at, user_id, deleted_at"
            " FROM knowledge_bases WHERE deleted_at IS NOT NULL"
        )
        params: list[Any] = []
        if user_id is not None:
            sql += " AND user_id = %s"
            params.append(user_id)
        sql += " ORDER BY deleted_at DESC"
        cur.execute(sql, params)
        return [
            {
                "id": r[0],
                "name": r[1],
                "description": r[2],
                "created_at": r[3],
                "user_id": r[4],
                "deleted_at": r[5],
            }
            for r in cur.fetchall()
        ]


def purge_expired_trash(before_ts: float) -> None:
    """物理删除回收站中超过 30 天（deleted_at < before_ts）的文档/文件夹/知识库。"""
    conn = _connect()
    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM documents WHERE deleted_at IS NOT NULL AND deleted_at < %s",
                (before_ts,),
            )
            cur.execute(
                "DELETE FROM folders WHERE deleted_at IS NOT NULL AND deleted_at < %s",
                (before_ts,),
            )
            cur.execute(
                "DELETE FROM knowledge_bases WHERE deleted_at IS NOT NULL AND deleted_at < %s",
                (before_ts,),
            )


def add_version(doc_id: str, title: str, text: str, created_at: float) -> dict[str, Any]:
    conn = _connect()
    version_id = uuid.uuid4().hex
    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO document_versions (id, doc_id, title, text, created_at)"
                " VALUES (%s, %s, %s, %s, %s)",
                (version_id, doc_id, title, text, created_at),
            )
            # 每文档最多保留 50 个版本
            cur.execute(
                "DELETE FROM document_versions WHERE doc_id = %s AND id IN ("
                " SELECT id FROM document_versions WHERE doc_id = %s"
                " ORDER BY created_at DESC OFFSET 50)",
                (doc_id, doc_id),
            )
    return {"id": version_id, "doc_id": doc_id, "title": title, "created_at": created_at}


def list_versions(doc_id: str) -> list[dict[str, Any]]:
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, doc_id, title, text, created_at FROM document_versions"
            " WHERE doc_id = %s ORDER BY created_at DESC",
            (doc_id,),
        )
        return [
            {"id": r[0], "doc_id": r[1], "title": r[2], "text": r[3], "created_at": r[4]}
            for r in cur.fetchall()
        ]


def get_version(version_id: str) -> dict[str, Any] | None:
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, doc_id, title, text, created_at FROM document_versions WHERE id = %s",
            (version_id,),
        )
        row = cur.fetchone()
        if row is None:
            return None
        return {"id": row[0], "doc_id": row[1], "title": row[2], "text": row[3], "created_at": row[4]}


# ---------- 知识库共享 ----------

def add_share(kb_id: str, user_id: str, permission: str) -> dict[str, Any]:
    """新增/更新共享（upsert）。permission: read/write。"""
    share_id = uuid.uuid4().hex
    created_at = time.time()
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute(
            "DELETE FROM kb_shares WHERE kb_id = %s AND user_id = %s",
            (kb_id, user_id),
        )
        cur.execute(
            "INSERT INTO kb_shares (id, kb_id, user_id, permission, created_at)"
            " VALUES (%s, %s, %s, %s, %s)",
            (share_id, kb_id, user_id, permission, created_at),
        )
    conn.commit()
    return {
        "id": share_id,
        "kb_id": kb_id,
        "user_id": user_id,
        "permission": permission,
        "created_at": created_at,
    }


def remove_share(kb_id: str, user_id: str) -> bool:
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute(
            "DELETE FROM kb_shares WHERE kb_id = %s AND user_id = %s",
            (kb_id, user_id),
        )
        deleted = cur.rowcount > 0
    conn.commit()
    return deleted


def list_shares(kb_id: str) -> list[dict[str, Any]]:
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute(
            "SELECT kb_id, user_id, permission, created_at FROM kb_shares WHERE kb_id = %s ORDER BY created_at",
            (kb_id,),
        )
        return [
            {
                "kb_id": r[0],
                "user_id": r[1],
                "permission": r[2],
                "created_at": r[3],
            }
            for r in cur.fetchall()
        ]


def get_share_permission(kb_id: str, user_id: str) -> str | None:
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute(
            "SELECT permission FROM kb_shares WHERE kb_id = %s AND user_id = %s",
            (kb_id, user_id),
        )
        row = cur.fetchone()
    return row[0] if row else None


def list_shared_kbs(user_id: str) -> list[dict[str, Any]]:
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute(
            "SELECT kb_id, permission FROM kb_shares WHERE user_id = %s",
            (user_id,),
        )
        return [
            {"kb_id": r[0], "permission": r[1]} for r in cur.fetchall()
        ]


# ---------- 最近浏览 ----------

def record_recent(doc_id: str, kb_id: str | None, user_id: str | None) -> dict[str, Any]:
    """记录一次浏览：同一 doc_id 只保留最新一条（DELETE + INSERT）。"""
    rec_id = uuid.uuid4().hex
    viewed_at = time.time()
    conn = _connect()
    with conn.transaction():
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
    query_vec: list[float],
    top_n: int,
    user_id: str | None = None,
    kb_ids: set[str] | None = None,
) -> list[dict[str, Any]]:
    """用 pgvector 余弦距离（<=>）做 top 候选召回，返回 chunk 级候选。

    kb_ids 提供时按「知识库可见性」召回（该 kb 集合内的所有文档 + 用户自有未归属 kb 的文档）；
    否则 user_id 提供时按文档属主召回。返回结构与 JSON 路径的候选一致。
    """
    conn = _connect()
    with conn.cursor() as cur:
        if kb_ids is not None:
            placeholders = ",".join(["%s"] * len(kb_ids))
            sql = (
                "SELECT d.id, d.title, d.source, c.segment_index, c.text, c.vector"
                " FROM chunks c"
                " JOIN documents d ON d.id = c.doc_id"
                f" WHERE c.vector IS NOT NULL AND (d.kb_id IN ({placeholders})"
                " OR (d.user_id = %s AND d.kb_id IS NULL))"
                " ORDER BY c.vector <=> %s::vector"
                " LIMIT %s"
            )
            params = list(kb_ids) + [user_id, _vec_to_str(query_vec), top_n]
        elif user_id is None:
            sql = (
                "SELECT d.id, d.title, d.source, c.segment_index, c.text, c.vector"
                " FROM chunks c"
                " JOIN documents d ON d.id = c.doc_id"
                " WHERE c.vector IS NOT NULL"
                " ORDER BY c.vector <=> %s::vector"
                " LIMIT %s"
            )
            params = [_vec_to_str(query_vec), top_n]
        else:
            sql = (
                "SELECT d.id, d.title, d.source, c.segment_index, c.text, c.vector"
                " FROM chunks c"
                " JOIN documents d ON d.id = c.doc_id"
                " WHERE c.vector IS NOT NULL AND d.user_id = %s"
                " ORDER BY c.vector <=> %s::vector"
                " LIMIT %s"
            )
            params = [user_id, _vec_to_str(query_vec), top_n]
        cur.execute(sql, params)
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


# ---------- 文档收藏 ----------

def add_favorite(user_id: str, doc_id: str) -> dict[str, Any] | None:
    """收藏文档（幂等：已收藏返回已有记录）。"""
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id FROM favorites WHERE user_id = %s AND doc_id = %s",
            (user_id, doc_id),
        )
        row = cur.fetchone()
        if row is None:
            fav_id = uuid.uuid4().hex
            created_at = time.time()
            cur.execute(
                "INSERT INTO favorites (id, user_id, doc_id, created_at)"
                " VALUES (%s, %s, %s, %s)",
                (fav_id, user_id, doc_id, created_at),
            )
        else:
            fav_id = row[0]
            created_at = None
    conn.commit()
    return {"id": fav_id, "user_id": user_id, "doc_id": doc_id, "created_at": created_at}


def remove_favorite(user_id: str, doc_id: str) -> bool:
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute(
            "DELETE FROM favorites WHERE user_id = %s AND doc_id = %s",
            (user_id, doc_id),
        )
        deleted = cur.rowcount > 0
    conn.commit()
    return deleted


def list_favorites(user_id: str) -> list[str]:
    """返回用户收藏的 doc_id 列表（按收藏时间倒序）。"""
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute(
            "SELECT doc_id FROM favorites WHERE user_id = %s ORDER BY created_at DESC",
            (user_id,),
        )
        return [r[0] for r in cur.fetchall()]


def is_favorite(user_id: str, doc_id: str) -> bool:
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute(
            "SELECT 1 FROM favorites WHERE user_id = %s AND doc_id = %s",
            (user_id, doc_id),
        )
        return cur.fetchone() is not None


# ---------- 文档分享链接 ----------

def create_share(doc_id: str, token: str, password: str | None = None, expires_at: float | None = None) -> dict[str, Any]:
    """创建分享链接（可选密码与有效期）。"""
    share_id = uuid.uuid4().hex
    created_at = time.time()
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO share_links (id, token, doc_id, created_at, password, expires_at)"
            " VALUES (%s, %s, %s, %s, %s, %s)",
            (share_id, token, doc_id, created_at, password, expires_at),
        )
    conn.commit()
    return {
        "id": share_id,
        "token": token,
        "doc_id": doc_id,
        "created_at": created_at,
        "password": password,
        "expires_at": expires_at,
    }


def get_share_by_token(token: str) -> dict[str, Any] | None:
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute(
            "SELECT doc_id, token, created_at, password, expires_at FROM share_links WHERE token = %s",
            (token,),
        )
        row = cur.fetchone()
        if row is None:
            return None
        return {
            "doc_id": row[0],
            "token": row[1],
            "created_at": row[2],
            "password": row[3],
            "expires_at": row[4],
        }


def get_share_by_doc(doc_id: str) -> dict[str, Any] | None:
    """返回某文档的分享记录（用于幂等/复用），无则 None。"""
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute(
            "SELECT doc_id, token, created_at, password, expires_at FROM share_links WHERE doc_id = %s",
            (doc_id,),
        )
        row = cur.fetchone()
        if row is None:
            return None
        return {
            "doc_id": row[0],
            "token": row[1],
            "created_at": row[2],
            "password": row[3],
            "expires_at": row[4],
        }


def delete_share(doc_id: str) -> bool:
    """撤销某文档的分享链接。"""
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute("DELETE FROM share_links WHERE doc_id = %s", (doc_id,))
        deleted = cur.rowcount > 0
    conn.commit()
    return deleted


# ---------- 系统设置（键值存储） ----------

def get_setting(key: str) -> str | None:
    """读取单个设置项（value 存 JSON 字符串），无则 None。"""
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute("SELECT value FROM settings WHERE key = %s", (key,))
        row = cur.fetchone()
        return row[0] if row else None


def set_setting(key: str, value: str) -> None:
    """写入/覆盖单个设置项。"""
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO settings (key, value, updated_at) VALUES (%s, %s, %s)"
            " ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at",
            (key, value, time.time()),
        )
    conn.commit()


# ---------- 文档评论/批注 ----------

def _comment_from_row(row: Any) -> dict[str, Any]:
    mentions_raw = row[6] if len(row) > 6 else None
    try:
        mentions = json.loads(mentions_raw) if mentions_raw else []
    except Exception:  # noqa: BLE001
        mentions = []
    return {
        "id": row[0],
        "doc_id": row[1],
        "user_id": row[2],
        "content": row[3],
        "quote": row[4],
        "created_at": row[5],
        "parent_id": row[6] if len(row) > 6 else None,
        "mentions": mentions,
    }


_COMMENT_COLS = "id, doc_id, user_id, content, quote, created_at, parent_id, mentions"


def add_comment(
    doc_id: str,
    user_id: str,
    content: str,
    quote: str | None = None,
    parent_id: str | None = None,
    mentions: list[str] | None = None,
) -> dict[str, Any]:
    """新增评论/批注。mentions 为被 @ 提及的用户 id 列表。"""
    comment_id = uuid.uuid4().hex
    created_at = time.time()
    mentions_json = json.dumps(mentions or [], ensure_ascii=False)
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO comments (id, doc_id, user_id, content, quote, created_at, parent_id, mentions)"
            " VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
            (comment_id, doc_id, user_id, content, quote, created_at, parent_id, mentions_json),
        )
    conn.commit()
    return {
        "id": comment_id,
        "doc_id": doc_id,
        "user_id": user_id,
        "content": content,
        "quote": quote,
        "created_at": created_at,
        "parent_id": parent_id,
        "mentions": mentions or [],
    }


def list_comments(doc_id: str) -> list[dict[str, Any]]:
    """按创建时间正序返回文档全部评论。"""
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute(
            f"SELECT {_COMMENT_COLS} FROM comments WHERE doc_id = %s ORDER BY created_at",
            (doc_id,),
        )
        return [_comment_from_row(r) for r in cur.fetchall()]


def delete_comment(comment_id: str) -> bool:
    """删除单条评论，返回是否删除成功。"""
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute("DELETE FROM comments WHERE id = %s", (comment_id,))
        deleted = cur.rowcount > 0
    conn.commit()
    return deleted


def get_comment(comment_id: str) -> dict[str, Any] | None:
    """按 id 取单条评论，无则 None。"""
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute(f"SELECT {_COMMENT_COLS} FROM comments WHERE id = %s", (comment_id,))
        row = cur.fetchone()
    return _comment_from_row(row) if row else None


# ---------- 通知 ----------

def _notification_from_row(row: Any) -> dict[str, Any]:
    return {
        "id": row[0],
        "user_id": row[1],
        "type": row[2],
        "actor_id": row[3],
        "doc_id": row[4],
        "kb_id": row[5],
        "content": row[6],
        "read": bool(row[7]),
        "created_at": row[8],
    }


_NOTIFICATION_COLS = "id, user_id, type, actor_id, doc_id, kb_id, content, read, created_at"


def add_notification(
    user_id: str,
    type_: str,
    actor_id: str | None,
    doc_id: str | None,
    kb_id: str | None,
    content: str,
) -> dict[str, Any]:
    """新增一条通知。"""
    nid = uuid.uuid4().hex
    created_at = time.time()
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO notifications (id, user_id, type, actor_id, doc_id, kb_id, content, read, created_at)"
            " VALUES (%s, %s, %s, %s, %s, %s, %s, false, %s)",
            (nid, user_id, type_, actor_id, doc_id, kb_id, content, created_at),
        )
    conn.commit()
    return {
        "id": nid,
        "user_id": user_id,
        "type": type_,
        "actor_id": actor_id,
        "doc_id": doc_id,
        "kb_id": kb_id,
        "content": content,
        "read": False,
        "created_at": created_at,
    }


def list_notifications(user_id: str, limit: int = 50) -> list[dict[str, Any]]:
    """返回用户通知（按时间倒序）。"""
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute(
            f"SELECT {_NOTIFICATION_COLS} FROM notifications WHERE user_id = %s ORDER BY created_at DESC LIMIT %s",
            (user_id, limit),
        )
        return [_notification_from_row(r) for r in cur.fetchall()]


def unread_count(user_id: str) -> int:
    """用户未读通知数。"""
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute(
            "SELECT COUNT(*) FROM notifications WHERE user_id = %s AND read = false",
            (user_id,),
        )
        row = cur.fetchone()
        return int(row[0]) if row else 0


def mark_notification_read(notification_id: str, user_id: str) -> bool:
    """标记单条通知为已读。"""
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE notifications SET read = true WHERE id = %s AND user_id = %s",
            (notification_id, user_id),
        )
        updated = cur.rowcount > 0
    conn.commit()
    return updated


def mark_all_notifications_read(user_id: str) -> int:
    """标记用户全部通知为已读，返回更新条数。"""
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE notifications SET read = true WHERE user_id = %s AND read = false",
            (user_id,),
        )
        updated = cur.rowcount
    conn.commit()
    return updated


# ---------- 操作审计日志 ----------

def _audit_from_row(row: Any) -> dict[str, Any]:
    return {
        "id": row[0],
        "user_id": row[1],
        "action": row[2],
        "target_type": row[3],
        "target_id": row[4],
        "detail": row[5],
        "created_at": row[6],
    }


_AUDIT_COLS = "id, user_id, action, target_type, target_id, detail, created_at"


def add_audit_log(
    user_id: str | None,
    action: str,
    target_type: str,
    target_id: str | None,
    detail: str,
) -> dict[str, Any]:
    """写入一条审计日志。"""
    aid = uuid.uuid4().hex
    created_at = time.time()
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO audit_logs (id, user_id, action, target_type, target_id, detail, created_at)"
            " VALUES (%s, %s, %s, %s, %s, %s, %s)",
            (aid, user_id, action, target_type, target_id, detail, created_at),
        )
    conn.commit()
    return {
        "id": aid,
        "user_id": user_id,
        "action": action,
        "target_type": target_type,
        "target_id": target_id,
        "detail": detail,
        "created_at": created_at,
    }


def list_audit_logs(limit: int = 200, offset: int = 0) -> list[dict[str, Any]]:
    """按时间倒序返回审计日志。"""
    conn = _connect()
    with conn.cursor() as cur:
        cur.execute(
            f"SELECT {_AUDIT_COLS} FROM audit_logs ORDER BY created_at DESC LIMIT %s OFFSET %s",
            (limit, offset),
        )
        return [_audit_from_row(r) for r in cur.fetchall()]
