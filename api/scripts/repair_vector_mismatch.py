"""检测并修复 chunks 表中「向量与文本错配」的存量数据。

背景（2026-10-01 发现）：

    `embedding.embed` 曾对所有批次做一次 `items.sort(key=index)`，而服务端返回的
    index 是**批内局部**索引（每批 0..9）。于是各批次的「第 0 项」被排到一起、
    「第 1 项」排到一起……导致向量与文本整体错配。

    实测影响：234/246 篇文档、40365 个分片（>10 分片即中招）。
    且**不报错**：搜索照常返回结果，只是指向错误位置，极难察觉。

判定方法（关键 —— 不能靠「严格相等」）：

    重新嵌入该分片的文本，与库中向量算**余弦相似度**。
      · 正确：cos ≈ 1.0（实测 min 0.999997，浮点噪声约 5e-4）
      · 错配：cos 显著更低（实测 min 0.759，均值 0.898）
    阈值取 0.999，两个分布的间隔很宽，不存在模糊地带。

用法：
    # 1) 先体检（默认，只读，不写库）
    .venv/bin/python scripts/repair_vector_mismatch.py --scan

    # 2) 抽样体检（只查前 N 篇，速度快）
    .venv/bin/python scripts/repair_vector_mismatch.py --scan --limit 20

    # 3) 修复（重新嵌入，覆盖错配向量）
    .venv/bin/python scripts/repair_vector_mismatch.py --fix

    # 4) 只修某篇
    .venv/bin/python scripts/repair_vector_mismatch.py --fix --doc-id <id>
"""
from __future__ import annotations

import argparse
import math
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import db, embedding  # noqa: E402

# 余弦相似度阈值。正确向量实测 ≥0.999997，错配实测 ≤0.93（均值 0.90），
# 取 0.999 落在两簇之间且离两边都远。
COS_THRESHOLD = 0.999

# 重嵌入的批大小（embedding 服务单次上限 10，这里用 10 正好一批）
EMBED_BATCH = 10


def _cos(a: list[float], b: list[float]) -> float:
    d = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if not na or not nb:
        return 0.0
    return d / (na * nb)


def _doc_ids(limit: int | None = None, doc_id: str | None = None) -> list[str]:
    conn = db._connect()
    with conn.cursor() as cur:
        if doc_id:
            return [doc_id]
        sql = (
            "SELECT doc_id, count(*) AS n FROM chunks"
            " WHERE vector IS NOT NULL GROUP BY doc_id HAVING count(*) > 1"
            " ORDER BY n DESC"
        )
        if limit:
            sql += f" LIMIT {int(limit)}"
        cur.execute(sql)
        return [r[0] for r in cur.fetchall()]


def _load_chunks(doc_id: str) -> list[tuple[int, str, list[float]]]:
    conn = db._connect()
    with conn.cursor() as cur:
        cur.execute(
            "SELECT segment_index, text, vector FROM chunks"
            " WHERE doc_id = %s AND vector IS NOT NULL ORDER BY segment_index",
            (doc_id,),
        )
        return [
            (idx, text, db._str_to_vec(vec) or [])
            for idx, text, vec in cur.fetchall()
        ]


def scan(limit: int | None, doc_id: str | None) -> int:
    """只读体检。返回错配分片总数。"""
    if not embedding.available():
        print("⛔ embedding 未配置，无法判定向量是否错配。请先配置 embedding_* 后再跑。")
        return -1

    ids = _doc_ids(limit, doc_id)
    print(f"待检查文档：{len(ids)} 篇\n")

    total_bad = 0
    total_checked = 0
    bad_docs: list[tuple[str, int, int, float]] = []

    for di, did in enumerate(ids, 1):
        rows = _load_chunks(did)
        if len(rows) < 2:
            continue
        # 只查前 20 个分片即可判定整篇是否错配（错配是系统性的，不会只坏几个）
        sample = rows[:20]
        texts = [t for _i, t, _v in sample]
        fresh = embedding.embed(texts)
        if fresh is None:
            print(f"  [{di}/{len(ids)}] {did[:8]}… 嵌入失败，跳过")
            continue

        sims = [_cos(fresh[k], sample[k][2]) for k in range(len(sample))]
        worst = min(sims)
        n_bad = sum(1 for s in sims if s < COS_THRESHOLD)
        total_checked += len(sample)
        total_bad += n_bad
        if n_bad:
            bad_docs.append((did, n_bad, len(sample), worst))
        mark = "❌" if n_bad else "✅"
        print(
            f"  [{di}/{len(ids)}] {did[:8]}… 分片 {len(rows):4d}  "
            f"抽查 {len(sample):2d}  {mark} 错配 {n_bad:2d}  最低 cos={worst:.4f}"
        )

    print("\n" + "=" * 64)
    print(f"抽查分片：{total_checked}  错配：{total_bad}  ({total_bad/max(1,total_checked)*100:.1f}%)")
    print(f"错配文档：{len(bad_docs)} / {len(ids)}")
    if bad_docs:
        print("\n错配最严重的 10 篇：")
        for did, nb, ns, worst in sorted(bad_docs, key=lambda x: x[3])[:10]:
            print(f"  {did}  错配 {nb}/{ns}  最低 cos={worst:.4f}")
    print("=" * 64)
    if total_bad:
        print("\n→ 修复命令（会重新嵌入并覆盖错配向量）：")
        print("   .venv/bin/python scripts/repair_vector_mismatch.py --fix")
    else:
        print("\n✅ 未发现错配，无需修复。")
    return total_bad


def fix(limit: int | None, doc_id: str | None) -> int:
    """重新嵌入并覆盖错配向量。返回修复的分片数。"""
    if not embedding.available():
        print("⛔ embedding 未配置，无法修复。")
        return -1

    ids = _doc_ids(limit, doc_id)
    print(f"待修复文档：{len(ids)} 篇\n")

    fixed = 0
    for di, did in enumerate(ids, 1):
        rows = _load_chunks(did)
        if len(rows) < 2:
            continue
        texts = [t for _i, t, _v in rows]
        fresh = embedding.embed(texts)
        if fresh is None:
            print(f"  [{di}/{len(ids)}] {did[:8]}… 嵌入失败，跳过")
            continue

        # 先判定是否真错配，避免无谓写库
        sims = [_cos(fresh[k], rows[k][2]) for k in range(len(rows))]
        n_bad = sum(1 for s in sims if s < COS_THRESHOLD)
        if not n_bad:
            print(f"  [{di}/{len(ids)}] {did[:8]}… ✅ 无需修复（{len(rows)} 分片）")
            continue

        conn = db._connect()
        with conn.cursor() as cur:
            for k, (idx, _t, _v) in enumerate(rows):
                cur.execute(
                    "UPDATE chunks SET vector = %s WHERE doc_id = %s AND segment_index = %s",
                    (db._vec_to_str(fresh[k]), did, idx),
                )
        conn.commit()
        fixed += n_bad
        # 复核：写库后读回，确认落库值与刚算出的向量一致（捕获序列化/精度问题）
        after = _load_chunks(did)
        verify_min = min(
            (_cos(fresh[k], after[k][2]) for k in range(min(len(fresh), len(after)))),
            default=0.0,
        )
        print(
            f"  [{di}/{len(ids)}] {did[:8]}… 🔧 修复 {n_bad}/{len(rows)} 个分片"
            f"  修复前最低 cos={min(sims):.4f}  写库后复核 cos={verify_min:.6f}"
        )

    print(f"\n✅ 完成，共修复 {fixed} 个分片。")
    print("建议随后跑一次体检确认：")
    print("   .venv/bin/python scripts/repair_vector_mismatch.py --scan --limit 20")
    return fixed


def main() -> int:
    ap = argparse.ArgumentParser(description="检测/修复 chunks 向量与文本错配")
    ap.add_argument("--scan", action="store_true", help="只体检，不写库（默认）")
    ap.add_argument("--fix", action="store_true", help="重新嵌入并覆盖错配向量")
    ap.add_argument("--limit", type=int, default=None, help="只处理前 N 篇（按分片数降序）")
    ap.add_argument("--doc-id", default=None, help="只处理指定文档")
    args = ap.parse_args()

    t0 = time.perf_counter()
    if args.fix:
        n = fix(args.limit, args.doc_id)
    else:
        n = scan(args.limit, args.doc_id)
    print(f"耗时 {time.perf_counter()-t0:.1f}s")
    return 0 if n >= 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())