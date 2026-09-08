#!/usr/bin/env python3
"""JSON → PostgreSQL 数据迁移脚本。

把 `data/store.json` 中的文档（含 chunks 向量）写入 PostgreSQL + pgvector，
为启用 PostgreSQL 存储做准备。可重复执行（幂等）。

用法（在 api 目录下）：
    .venv/bin/python3 scripts/migrate_json_to_pg.py
    或
    .venv/bin/python3 /绝对路径/scripts/migrate_json_to_pg.py

依赖：
    - 环境变量 DATABASE_URL（也可写在 api/.env 中，由 app.core.config 加载）
    - psycopg v3（requirements.txt 已包含）
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

# 确保能从项目根（api/）import app 模块
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import DATA_DIR, DATABASE_URL  # noqa: E402
from app.services import db  # noqa: E402

STORE_FILE = DATA_DIR / "store.json"


def load_json_docs() -> list[dict] | None:
    """读取 store.json，返回文档列表；文件缺失或解析失败返回 None。"""
    if not STORE_FILE.exists():
        print(f"[错误] 未找到数据文件：{STORE_FILE}")
        print("       请先运行应用生成 JSON 数据，或确认路径是否正确。")
        return None
    try:
        docs = json.loads(STORE_FILE.read_text("utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        print(f"[错误] 读取 {STORE_FILE} 失败：{exc}")
        return None
    if not isinstance(docs, list):
        print(f"[错误] {STORE_FILE} 顶层结构应为 list，实际为 {type(docs).__name__}")
        return None
    return docs


def main() -> int:
    # 1. 读取 JSON
    docs = load_json_docs()
    if docs is None:
        return 1
    if not docs:
        print("[提示] store.json 为空，无需迁移。")
        return 0

    # 2. 校验 DATABASE_URL
    if not DATABASE_URL:
        print("[错误] 未配置 DATABASE_URL，请在 api/.env 或环境变量中设置。")
        return 1

    # 3. 确保扩展与表存在（复用 db.init，幂等）
    try:
        db.init()
    except Exception as exc:
        print(f"[错误] 连接 / 初始化 PostgreSQL 失败：{exc}")
        return 1

    # 4. 写入文档与 chunks（幂等：先按 id 删除旧记录，再插入）
    doc_count = 0
    chunk_count = 0
    null_vec_count = 0
    skipped = 0

    for doc in docs:
        doc_id = doc.get("id")
        if not doc_id:
            print(f"[警告] 跳过缺少 id 的文档：{doc.get('title') or '<无标题>'}")
            skipped += 1
            continue

        chunks = doc.get("chunks") or []
        for chunk in chunks:
            chunk_count += 1
            if chunk.get("vector") is None:
                null_vec_count += 1

        try:
            db.delete_document(doc_id)  # 幂等：先删除同名文档及其 chunks
            db.add_document(doc)
        except Exception as exc:
            print(f"[错误] 写入文档 {doc_id} 失败：{exc}")
            return 1
        doc_count += 1

    # 5. 打印迁移统计
    print("-" * 40)
    print(f"迁移完成：文档 {doc_count} 个，chunks {chunk_count} 个")
    print(f"向量为 null 的 chunk：{null_vec_count} 个")
    if skipped:
        print(f"跳过无效文档：{skipped} 个")

    # 6. 可选验证：读取 PostgreSQL 中的条数
    try:
        migrated = db.all_documents()
        pg_docs = len(migrated)
        pg_chunks = sum(len(d.get("chunks", [])) for d in migrated)
        print(f"[验证] PostgreSQL 现有文档 {pg_docs} 个、chunks {pg_chunks} 个")
    except Exception as exc:
        print(f"[警告] 验证读取失败（可忽略）：{exc}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
