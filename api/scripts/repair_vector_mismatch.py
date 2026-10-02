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


def _preflight_already_fixed() -> str | None:
    """幂等预检：抽样判定「是否已经修过」。返回中止提示，或 None 表示可以执行。

    为什么需要它：本脚本**方向安全**（只覆盖判定为错配的分片），重复执行不会破坏数据，
    但会白白花几小时重新嵌入 4 万个分片 —— 而用户可能正是因为「不确定上次跑完没有」
    才再跑一次。

    判据用**目标状态的特征值**（迁移安全守则铁律 1）：目标状态是「抽样分片的 cos 全部
    ≥ 阈值」。随机抽一篇多分片文档，若其向量与重嵌入结果全部吻合 → 判定已修过。

    ⚠️ 这只是**抽样**：它可能因为恰好抽到一篇本来就正确的文档而误判「已完成」
    （假阳性中止）。所以提示里给出 `--force`，而不是把门焊死。
    """
    if not embedding.available():
        return None
    conn = db._connect()
    with conn.cursor() as cur:
        # 刻意取**最小**的合格文档（>10 分片 ⇒ 一定跨过批次，错配检测才有意义）。
        # 不要取最大那篇：那是几千分片、几百个批次，预检本身就要跑一分钟，
        # 而预检的意义是「快速判断要不要动手」。
        cur.execute(
            "SELECT doc_id FROM chunks WHERE vector IS NOT NULL"
            " GROUP BY doc_id HAVING count(*) > 10 ORDER BY count(*) ASC LIMIT 1"
        )
        row = cur.fetchone()
    if row is None:
        return None
    did = row[0]
    rows = _load_chunks(did)
    if len(rows) < 2:
        return None
    fresh = embedding.embed([t for _i, t, _v in rows])
    if fresh is None:
        # 嵌入不可用时不该在这里挡住流程，交给 fix() 自己报错
        return None
    sims = [_cos(fresh[k], rows[k][2]) for k in range(len(rows))]
    if min(sims) >= COS_THRESHOLD:
        return (
            f"⛔ 已中止：抽样文档 {did[:8]}…（{len(rows)} 分片）的向量**全部吻合**，"
            f"看起来错配已经修过了。\n"
            f"   重复执行不会破坏数据（本脚本只覆盖错配分片），但会平白重算数万次嵌入。\n"
            f"   若确需重跑全部：加 --force。\n"
            f"   若只是想复验：用 --scan --limit 20"
        )
    return None


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
    """重新嵌入并覆盖错配向量。返回修复的分片数；-1 前置失败，-2 中止或有未达标。

    幂等性（对状态敏感，但方向安全）：本函数只覆盖「重嵌入后 cos < 阈值」的分片。
    修好之后再跑一次，所有分片都会判定为「无需修复」→ **零写入**。
    （这与「排序键重播种」那类脚本不同 —— 那类脚本重复执行会再次翻转顺序。）
    """
    if not embedding.available():
        print("⛔ embedding 未配置，无法修复。")
        return -1

    ids = _doc_ids(limit, doc_id)
    print(f"待修复文档：{len(ids)} 篇\n")

    fixed = 0
    skipped = 0
    failed: list[tuple[str, float]] = []
    for di, did in enumerate(ids, 1):
        rows = _load_chunks(did)
        if len(rows) < 2:
            continue
        texts = [t for _i, t, _v in rows]
        fresh = embedding.embed(texts)
        if fresh is None:
            print(f"  [{di}/{len(ids)}] {did[:8]}… 嵌入失败，跳过")
            failed.append((did, -1.0))
            continue

        # 先判定是否真错配，避免无谓写库
        sims = [_cos(fresh[k], rows[k][2]) for k in range(len(rows))]
        n_bad = sum(1 for s in sims if s < COS_THRESHOLD)
        if not n_bad:
            skipped += 1
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

        # 复核：写库后读回，确认落库值与刚算出的向量一致（捕获序列化/精度问题）。
        #
        # ⚠️ 下方的比对**按位置**进行（rows[k] ↔ fresh[k] ↔ after[k]），这依赖三点前提：
        #    ① 两次查询都 `ORDER BY segment_index`；② 每篇的 segment_index 唯一（已实测：
        #    40432 行 = 40432 个 (doc_id, segment_index) 组合，无重复无 NULL）；
        #    ③ **分片条数在读写之间不变**。
        #    第 ③ 点最容易被忽略 —— 若条数变了（分段逻辑改动、或向量串被再次切分），
        #    位置就会整体串位，而 cos 仍可能碰巧偏高，于是「假通过」。
        #    所以这里先硬性校验条数，不等即**中止**（继续写后面的文档是有害的）。
        after = _load_chunks(did)
        if len(after) != len(fresh):
            print(
                f"\n⛔ 已中止：{did[:8]}… 写库后分片数由 {len(rows)} 变为 {len(after)}，"
                f"按位置比对的前提已被破坏。\n"
                f"   请先回滚（备份：/tmp/sd_repair/chunks_before.sql）再排查。"
            )
            return -2
        verify_min = min(
            (_cos(fresh[k], after[k][2]) for k in range(len(fresh))),
            default=0.0,
        )

        if verify_min < COS_THRESHOLD:
            failed.append((did, verify_min))
            print(
                f"  [{di}/{len(ids)}] {did[:8]}… ⚠️ 写库后复核未达标 "
                f"cos={verify_min:.6f} < {COS_THRESHOLD}"
            )
            continue

        fixed += n_bad
        print(
            f"  [{di}/{len(ids)}] {did[:8]}… 🔧 修复 {n_bad}/{len(rows)} 个分片"
            f"  修复前最低 cos={min(sims):.4f}  写库后复核 cos={verify_min:.6f}"
        )

    print("\n" + "=" * 64)
    print(f"✅ 完成：修复 {fixed} 个分片；{skipped} 篇本就正确；{len(failed)} 篇未达标")
    if failed:
        print("未达标的文档（需人工排查，不掩盖）：")
        for did, v in failed[:10]:
            print(f"  {did}  cos={v:.6f}")
    print("=" * 64)
    print("请随后复验（应报「未发现错配」）：")
    print("   .venv/bin/python scripts/repair_vector_mismatch.py --scan --limit 20")
    return fixed if not failed else -2


def main() -> int:
    ap = argparse.ArgumentParser(description="检测/修复 chunks 向量与文本错配")
    ap.add_argument("--scan", action="store_true", help="只体检，不写库（默认）")
    ap.add_argument("--fix", action="store_true", help="重新嵌入并覆盖错配向量")
    ap.add_argument("--limit", type=int, default=None, help="只处理前 N 篇（按分片数降序）")
    ap.add_argument("--doc-id", default=None, help="只处理指定文档")
    ap.add_argument("--force", action="store_true", help="跳过幂等预检，强制重跑（一般不需要）")
    args = ap.parse_args()

    t0 = time.perf_counter()
    if args.fix:
        if not args.force and args.doc_id is None:
            preflight = _preflight_already_fixed()
            if preflight is not None:
                print(preflight)
                return 1
        n = fix(args.limit, args.doc_id)
    else:
        n = scan(args.limit, args.doc_id)
    print(f"耗时 {time.perf_counter()-t0:.1f}s")
    return 0 if n >= 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())