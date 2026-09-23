#!/usr/bin/env python3
"""流式勘察 data/store.json 的结构与规模（只读，不加载整个文件到内存）。

用法：.venv/bin/python scripts/survey_store.py
"""
from __future__ import annotations

import sys
from collections import Counter
from pathlib import Path

import ijson

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core.config import DATA_DIR  # noqa: E402

STORE_FILE = DATA_DIR / "store.json"

# documents 之外的分区：整段都很小，可以整段读出来统计
SMALL_SECTIONS = [
    "documents", "folders", "kbs", "recent", "users", "shares",
    "favorites", "share_links", "comments", "notifications",
    "audit_logs", "templates",
]


def main() -> int:
    if not STORE_FILE.exists():
        print(f"[错误] 未找到 {STORE_FILE}")
        return 1
    print(f"文件：{STORE_FILE}")
    print(f"大小：{STORE_FILE.stat().st_size / 1024 / 1024:.1f} MB")
    print("-" * 60)

    first_of: dict[str, object] = {}
    count: Counter[str] = Counter()
    chunk_total = 0
    vec_total = 0
    null_vec = 0
    max_chunks = 0
    max_chunks_title = ""
    types: Counter[str] = Counter()
    deleted_docs = 0
    pinned_docs = 0
    tagged_docs = 0
    summarized_docs = 0

    with open(STORE_FILE, "rb") as fh:
        # 顶层各分区的元素逐个流式读取
        for section in SMALL_SECTIONS:
            for item in ijson.items(fh, f"{section}.item"):
                count[section] += 1
                if section not in first_of:
                    first_of[section] = item
                if section == "documents":
                    chunks = item.get("chunks") or []
                    n = len(chunks)
                    chunk_total += n
                    if n > max_chunks:
                        max_chunks = n
                        max_chunks_title = item.get("title") or item.get("id") or "?"
                    for c in chunks:
                        vec_total += 1
                        if c.get("vector") is None:
                            null_vec += 1
                    types[item.get("type") or "doc"] += 1
                    if item.get("deleted_at"):
                        deleted_docs += 1
                    if item.get("pinned"):
                        pinned_docs += 1
                    if item.get("tags"):
                        tagged_docs += 1
                    if item.get("summary"):
                        summarized_docs += 1
            # 每个分区读完需要重新打开文件（ijson 是单向流）
            fh.seek(0)

    print("分区条目数：")
    for s in SMALL_SECTIONS:
        print(f"  {s:<16} {count[s]}")

    print("-" * 60)
    print("每个分区的首条记录字段：")
    for s in SMALL_SECTIONS:
        item = first_of.get(s)
        if isinstance(item, dict):
            fields = ", ".join(f"{k}={type(v).__name__}" for k, v in item.items() if k != "chunks")
            print(f"  [{s}] {fields}")
            if s == "documents":
                print(f"         chunks: list len={len(item.get('chunks') or [])}")
        else:
            print(f"  [{s}] {item!r}")

    print("-" * 60)
    print(f"文档 chunk 总数     : {chunk_total}")
    print(f"含 vector 的 chunk  : {vec_total}")
    print(f"vector 为 null 的   : {null_vec}")
    print(f"单文档最大 chunk 数 : {max_chunks}  ({max_chunks_title})")
    print(f"文档类型分布        : {dict(types)}")
    print(f"已软删除文档        : {deleted_docs}")
    print(f"置顶文档            : {pinned_docs}")
    print(f"带标签文档          : {tagged_docs}")
    print(f"带摘要文档          : {summarized_docs}")
    return 0


if __name__ == "__main__":
    sys.exit(main())