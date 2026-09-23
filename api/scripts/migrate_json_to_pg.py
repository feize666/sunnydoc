#!/usr/bin/env python3
"""data/store.json → PostgreSQL + pgvector 全量迁移（流式、幂等、保真）。

设计要点
--------
1. **流式读取**：store.json 约 1.34 GB（其中 ~99% 是 chunk 向量），
   绝不能 json.loads 整文件。用 ijson 的低阶 parse 事件流 + 手工栈
   还原对象，一次遍历同时取出所有分区。
2. **保真写入**：直接执行 SQL，而不是调用 db.py 的 writer 函数。
   原因：add_comment / create_share / add_notification 等会重新生成
   uuid 与时间戳，会破坏 comments.parent_id 回复链、share token、
   audit 时间线。这里原样保留 id / created_at / password_hash 等。
3. **幂等**：documents 走 ON CONFLICT DO UPDATE，chunks 先删后插，
   其余分区先 TRUNCATE 再插入，重复执行结果一致。

用法（在 api 目录下）：
    .venv/bin/python scripts/migrate_json_to_pg.py
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path
from typing import Any, Iterator

import ijson

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core.config import DATA_DIR, DATABASE_URL  # noqa: E402
from app.services import db  # noqa: E402

STORE_FILE = DATA_DIR / "store.json"

# 顶层分区 → 目标表
SECTIONS = [
    "documents", "folders", "kbs", "recent", "users", "shares",
    "favorites", "share_links", "comments", "notifications",
    "audit_logs", "templates",
]

# ---------- 流式解析：一次遍历取出所有顶层分区 ----------

_SCALAR_EVENTS = {"string", "number", "boolean", "null"}


def _attach(stack: list[Any], key: str | None, value: Any) -> None:
    """把 value 挂到当前容器：list 就 append，dict 就按 key 存。"""
    if not stack:
        return  # 根对象本身，无需挂载
    parent = stack[-1]
    if isinstance(parent, list):
        parent.append(value)
    else:
        parent[key] = value


def _scalar(event: str, value: Any) -> Any:
    if event == "null":
        return None
    return value


def iter_section_items(fh, wanted: set[str]) -> Iterator[tuple[str, dict]]:
    """单次遍历，产出 (分区名, 元素) —— 仅限「顶层分区是对象数组」的结构。"""
    stack: list[Any] = []
    pending_key: str | None = None
    section: str | None = None

    for _prefix, event, value in ijson.parse(fh, use_float=True):
        if event == "start_map":
            obj: dict[str, Any] = {}
            _attach(stack, pending_key, obj)
            pending_key = None
            stack.append(obj)
        elif event == "end_map":
            obj = stack.pop()
            pending_key = None
            # 弹出一个 map 后，若栈顶就是顶层那个数组，说明它是分区元素
            if len(stack) == 2 and isinstance(stack[-1], list):
                if section in wanted:
                    yield section, obj
        elif event == "start_array":
            arr: list[Any] = []
            _attach(stack, pending_key, arr)
            pending_key = None
            stack.append(arr)
            if len(stack) == 2 and section is None:
                # 顶层 map 的直接子数组（理论上不会发生）
                pass
        elif event == "end_array":
            stack.pop()
            pending_key = None
        elif event == "map_key":
            if len(stack) == 1:
                section = value  # 顶层 key：切换当前分区
            pending_key = value
        elif event in _SCALAR_EVENTS:
            _attach(stack, pending_key, _scalar(event, value))
            pending_key = None


# ---------- 各分区的目标表与取值映射 ----------

def _doc_row(d: dict) -> tuple:
    return (
        d["id"], d.get("title"), d.get("text"), d.get("source"), d.get("ext"),
        d.get("created_at"), d.get("folder_id"), d.get("kb_id"), d.get("user_id"),
        d.get("deleted_at"),
        json.dumps(d.get("tags") or [], ensure_ascii=False),
        bool(d.get("pinned")),
        d.get("summary"),
        d.get("type") or "doc",
        d.get("sort_order", d.get("created_at")),
    )


DOC_SQL = (
    "INSERT INTO documents (id, title, text, source, ext, created_at, folder_id,"
    " kb_id, user_id, deleted_at, tags, pinned, summary, type, sort_order)"
    " VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)"
    " ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, text=EXCLUDED.text,"
    " source=EXCLUDED.source, ext=EXCLUDED.ext, created_at=EXCLUDED.created_at,"
    " folder_id=EXCLUDED.folder_id, kb_id=EXCLUDED.kb_id, user_id=EXCLUDED.user_id,"
    " deleted_at=EXCLUDED.deleted_at, tags=EXCLUDED.tags, pinned=EXCLUDED.pinned,"
    " summary=EXCLUDED.summary, type=EXCLUDED.type, sort_order=EXCLUDED.sort_order"
)

# 分区 → (表名, 列, 取值函数, 主键列)
SIMPLE_MAP: dict[str, tuple[str, list[str], Any]] = {
    "folders": (
        "folders",
        ["id", "name", "parent_id", "created_at", "kb_id", "user_id", "deleted_at", "sort_order"],
        lambda d: (
            d["id"], d.get("name"), d.get("parent_id"), d.get("created_at"),
            d.get("kb_id"), d.get("user_id"), d.get("deleted_at"),
            d.get("sort_order", d.get("created_at")),
        ),
    ),
    "kbs": (
        "knowledge_bases",
        ["id", "name", "description", "created_at", "user_id", "deleted_at"],
        lambda d: (
            d["id"], d.get("name"), d.get("description"), d.get("created_at"),
            d.get("user_id"), d.get("deleted_at"),
        ),
    ),
    "recent": (
        "recent_views",
        ["id", "doc_id", "kb_id", "viewed_at", "user_id"],
        lambda d: (d["id"], d.get("doc_id"), d.get("kb_id"), d.get("viewed_at"), d.get("user_id")),
    ),
    "users": (
        "users",
        ["id", "username", "password_hash", "role", "nickname", "email", "avatar",
         "status", "created_at", "updated_at"],
        lambda d: (
            d["id"], d.get("username"), d.get("password_hash"), d.get("role"),
            d.get("nickname"), d.get("email"), d.get("avatar"), d.get("status"),
            d.get("created_at"), d.get("updated_at", d.get("created_at")),
        ),
    ),
    "shares": (
        "kb_shares",
        ["id", "kb_id", "user_id", "permission", "created_at"],
        lambda d: (
            d["id"], d.get("kb_id"), d.get("user_id"), d.get("permission"), d.get("created_at"),
        ),
    ),
    "favorites": (
        "favorites",
        ["id", "user_id", "doc_id", "created_at"],
        lambda d: (d["id"], d.get("user_id"), d.get("doc_id"), d.get("created_at")),
    ),
    "share_links": (
        "share_links",
        ["id", "token", "doc_id", "created_at", "password", "expires_at"],
        lambda d: (
            d["id"], d.get("token"), d.get("doc_id"), d.get("created_at"),
            d.get("password"), d.get("expires_at"),
        ),
    ),
    "comments": (
        "comments",
        ["id", "doc_id", "user_id", "content", "quote", "created_at", "parent_id", "mentions"],
        lambda d: (
            d["id"], d.get("doc_id"), d.get("user_id"), d.get("content"), d.get("quote"),
            d.get("created_at"), d.get("parent_id"),
            json.dumps(d.get("mentions") or [], ensure_ascii=False),
        ),
    ),
    "notifications": (
        "notifications",
        ["id", "user_id", "type", "actor_id", "doc_id", "kb_id", "content", "read", "created_at"],
        lambda d: (
            d["id"], d.get("user_id"), d.get("type"), d.get("actor_id"), d.get("doc_id"),
            d.get("kb_id"), d.get("content"), bool(d.get("read")), d.get("created_at"),
        ),
    ),
    "audit_logs": (
        "audit_logs",
        ["id", "user_id", "action", "target_type", "target_id", "detail", "created_at"],
        lambda d: (
            d["id"], d.get("user_id"), d.get("action"), d.get("target_type"),
            d.get("target_id"), d.get("detail"), d.get("created_at"),
        ),
    ),
    "templates": (
        "templates",
        ["id", "name", "type", "data", "description", "category", "author_id",
         "author_name", "use_count", "created_at"],
        lambda d: (
            d["id"], d.get("name"), d.get("type"), d.get("data"), d.get("description"),
            d.get("category"), d.get("author_id"), d.get("author_name"),
            d.get("use_count", 0), d.get("created_at"),
        ),
    ),
}


def main() -> int:
    t0 = time.time()
    if not STORE_FILE.exists():
        print(f"[错误] 未找到数据文件：{STORE_FILE}")
        return 1
    if not DATABASE_URL:
        print("[错误] 未配置 DATABASE_URL（应写在 api/.env 中）。")
        return 1

    print(f"源文件：{STORE_FILE}  ({STORE_FILE.stat().st_size / 1024 / 1024:.1f} MB)")
    print("初始化数据库结构 ...")
    db.init()

    conn = db._connect()
    stats: dict[str, int] = {s: 0 for s in SECTIONS}

    # 目标表先清空，保证幂等（documents 的 chunks 由 FK CASCADE 连带清掉）
    truncate_order = [
        "chunks", "documents", "folders", "knowledge_bases", "recent_views",
        "users", "kb_shares", "favorites", "share_links", "comments",
        "notifications", "audit_logs", "templates",
    ]
    print("清空目标表（幂等准备）...")
    with conn.cursor() as cur:
        for t in truncate_order:
            cur.execute(f"TRUNCATE TABLE {t} CASCADE")

    print("开始流式迁移（一次遍历）...")
    with open(STORE_FILE, "rb") as fh, conn.cursor() as cur:
        for section, item in iter_section_items(fh, set(SECTIONS)):
            if section == "documents":
                cur.execute(DOC_SQL, _doc_row(item))
                chunks = item.get("chunks") or []
                if chunks:
                    cur.executemany(
                        "INSERT INTO chunks (doc_id, segment_index, text, vector)"
                        " VALUES (%s, %s, %s, %s)",
                        [
                            (item["id"], i, c.get("text"), db._vec_to_str(c.get("vector")))
                            for i, c in enumerate(chunks)
                        ],
                    )
            elif section in SIMPLE_MAP:
                table, cols, extract = SIMPLE_MAP[section]
                cur.execute(
                    f"INSERT INTO {table} ({','.join(cols)})"
                    f" VALUES ({','.join(['%s'] * len(cols))})",
                    extract(item),
                )
            else:
                continue
            stats[section] += 1
            if section == "documents" and stats[section] % 25 == 0:
                print(f"  已迁移文档 {stats[section]} 个 ... ({time.time() - t0:.1f}s)")

    print("-" * 60)
    print("迁移统计：")
    for s in SECTIONS:
        print(f"  {s:<16} {stats[s]}")

    # 校验
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM chunks")
        n_chunks = cur.fetchone()[0]
        cur.execute("SELECT count(*) FROM chunks WHERE vector IS NOT NULL")
        n_vec = cur.fetchone()[0]
        cur.execute("SELECT count(*) FROM documents WHERE deleted_at IS NOT NULL")
        n_trash = cur.fetchone()[0]
    print("-" * 60)
    print(f"[校验] chunks 总数          : {n_chunks}")
    print(f"[校验] 含向量的 chunk       : {n_vec}")
    print(f"[校验] 回收站中文档         : {n_trash}")
    print(f"完成，用时 {time.time() - t0:.1f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())