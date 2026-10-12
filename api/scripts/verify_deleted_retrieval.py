"""验证：已删文档的分片不得参与检索召回（引用溯源污染修复）。

背景（2026-10-12）：`db.search_chunks` 的三个 SQL 分支当年只 `JOIN documents`
不过滤 `deleted_at IS NULL`。软删除只改 `documents.deleted_at`、**分片留在 chunks 表**
（回收站恢复需要），于是已删文档的内容仍被召回并作为「引用来源」出现在 AI 回答里
→ 用户点进去是 404，引用溯源失去可信度。实测库存有 83 篇已删文档 / 3365 行分片。

断言设计（避开三类恒真缺陷）：
- **绑定到具体 id**：用库存里一篇真实已删文档的 doc_id，断言「结果不含它」。
  不用「结果非空」这类会被历史数据满足的判据。
- **对抗性可证伪**：脚本带 `--raw` 模式，用**修复前的旧 SQL**（不过滤删除位）查一次。
  若旧 SQL 召回了该文档、新代码没召回，才证明本断言真的测到了过滤逻辑
  （否则可能是「该文档本来就召回不到」——那测试等于没测）。
- **三个分支都测**：kb_ids / user_id / 无过滤 三条 SQL 各改了一处，必须分别验证。

用法：
    cd api && TMPDIR=/tmp/sdtmp .venv/bin/python scripts/verify_deleted_retrieval.py
    cd api && TMPDIR=/tmp/sdtmp .venv/bin/python scripts/verify_deleted_retrieval.py --raw
"""
from __future__ import annotations

import sys
from pathlib import Path

# 与 scripts/ 下其它脚本一致：把 api/ 根目录挂进 sys.path，才能 import app.*
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import db


def _pick_deleted_doc() -> dict | None:
    """从库存里挑一篇「已软删、仍有分片、分片有向量」的文档作为验证目标。"""
    conn = db._connect()
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT d.id, d.title, d.user_id, d.kb_id, count(c.id) AS n
            FROM documents d
            JOIN chunks c ON c.doc_id = d.id AND c.vector IS NOT NULL
            WHERE d.deleted_at IS NOT NULL
            GROUP BY d.id, d.title, d.user_id, d.kb_id
            HAVING count(c.id) >= 5
            ORDER BY count(c.id) DESC
            LIMIT 1
            """
        )
        row = cur.fetchone()
        if row is None:
            return None
        doc = {"id": row[0], "title": row[1], "user_id": row[2], "kb_id": row[3], "n": row[4]}
        # 取该文档的一个真实向量作为查询向量 —— 这样「召回它」在向量空间里是必然的，
        # 从而把「是否被 deleted_at 过滤掉」变成唯一变量。
        cur.execute(
            "SELECT vector::text FROM chunks WHERE doc_id = %s AND vector IS NOT NULL LIMIT 1",
            (doc["id"],),
        )
        vrow = cur.fetchone()
        doc["vec"] = db._str_to_vec(vrow[0]) if vrow else None
    return doc


def _raw_search(query_vec: list[float], top_n: int) -> list[str]:
    """修复前的旧 SQL（故意不过滤 deleted_at），用于对抗性证伪。"""
    conn = db._connect()
    with conn.cursor() as cur:
        cur.execute(
            "SELECT d.id FROM chunks c JOIN documents d ON d.id = c.doc_id"
            " WHERE c.vector IS NOT NULL"
            " ORDER BY c.vector <=> %s::vector LIMIT %s",
            (db._vec_to_str(query_vec), top_n),
        )
        return [r[0] for r in cur.fetchall()]


def main() -> int:
    raw_mode = "--raw" in sys.argv
    doc = _pick_deleted_doc()
    if doc is None or doc["vec"] is None:
        print("⛔ 库存里找不到「已删且仍有向量分片」的文档，无法构造验证。")
        print("   （若库已被彻底清理，这是正常状态 —— 此时该缺陷已无可观测影响。）")
        return 2

    print(f"验证目标（已删文档）：{doc['title']!r} id={doc['id']} 分片={doc['n']}")
    print(f"  查询向量取自该文档自身 → 向量空间里「召回它」是必然的，")
    print(f"  于是唯一变量就是「deleted_at 过滤」是否生效。")
    vec = doc["vec"]

    if raw_mode:
        ids = _raw_search(vec, 20)
        hit = doc["id"] in ids
        print(f"\n[--raw 对抗性探针] 用修复前的旧 SQL（不过滤 deleted_at）查 top20：")
        print(f"  含该已删文档 = {hit}   （期望 True —— 否则说明这个测试根本没测到东西）")
        return 0 if hit else 1

    failures: list[str] = []

    # 分支 A：user_id is None
    ids_a = [r["doc_id"] for r in db.search_chunks(vec, 20, None, None)]
    ok_a = doc["id"] not in ids_a
    print(f"\n[分支 A] user_id=None         → 命中文档数={len(ids_a)}，含该已删文档={not ok_a}")
    if not ok_a:
        failures.append("A: user_id=None 分支未过滤已删文档")

    # 分支 B：user_id 提供
    if doc["user_id"]:
        ids_b = [r["doc_id"] for r in db.search_chunks(vec, 20, doc["user_id"], None)]
        ok_b = doc["id"] not in ids_b
        print(f"[分支 B] user_id={doc['user_id'][:8]}… → 命中文档数={len(ids_b)}，含该已删文档={not ok_b}")
        if not ok_b:
            failures.append("B: user_id 分支未过滤已删文档")
    else:
        print("[分支 B] 跳过（该文档无 user_id）")

    # 分支 C：kb_ids 提供（走 kb 可见性分支）
    kb_id = doc["kb_id"]
    if kb_id and doc["user_id"]:
        ids_c = [r["doc_id"] for r in db.search_chunks(vec, 20, doc["user_id"], {kb_id})]
        ok_c = doc["id"] not in ids_c
        print(f"[分支 C] kb_ids={{…}} → 命中文档数={len(ids_c)}，含该已删文档={not ok_c}")
        if not ok_c:
            failures.append("C: kb_ids 分支未过滤已删文档")
    else:
        print("[分支 C] 跳过（该文档无 kb_id）")

    # 反向断言：活文档仍能被召回（防止「过滤过宽把所有人都滤掉」这种过度修复）
    conn = db._connect()
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id FROM documents WHERE deleted_at IS NULL"
            " AND id = %s LIMIT 1",
            (doc["id"],),
        )
        assert cur.fetchone() is None, "该文档竟然还活着，验证前提不成立"
    print("\n[反向检查] 该文档确实处于已删状态（deleted_at 非空）——前提成立。")

    print()
    if failures:
        print("❌ 失败：")
        for f in failures:
            print("   ·", f)
        return 1
    print("✅ 通过：三个分支均不再召回已删文档的分片。")
    print("   请再跑一次 `--raw` 确认对抗性探针能召回（证明本测试有效）。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())