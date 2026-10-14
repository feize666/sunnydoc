"""补算 chunks 表中「缺向量」（vector IS NULL）的分片。

背景（2026-10-14 发现）：

    `store._build_chunks` 在 embedding 失败时静默写入无向量分片，
    实测 2 篇文档 460 个分片如此躺了数周 —— AI 问答对这 2 篇只剩关键词
    检索，语义召回完全缺席，且没有任何入口能发现（本脚本即修复入口之一，
    另一入口是 admin 端点 POST /admin/repair-embeddings）。

    注意与 `repair_vector_mismatch.py` 的分工：那个修「向量与文本错配」
    （vector IS NOT NULL 但 cos < 阈值）；本脚本修「根本没有向量」
    （vector IS NULL）。两者互补，覆盖向量治理的两种残缺形态。

安全纪律（对齐 oneshot-migration-safety）：

  · **方向安全**：只把 NULL 写成向量，绝不覆盖已有向量
    （db.set_chunk_vectors 的 WHERE 带 `vector IS NULL`）→ 重复执行零写入。
  · **状态感知守卫**：目标状态特征是「缺向量分片数 == 0」，为 0 即中止，
    不是「值有没有变」。
  · **外部基准**：修复后以数据库直查的计数 + 每篇文档的功能性检索验证，
    不在脚本自己的坐标系里自证。
  · **编排复用**：实际补算走 `store.repair_missing_vectors()`（与 admin
    端点同一份实现），本脚本只负责守卫、基线导出与复核 —— 不第三次分叉。

用法：
    # 1) 体检（只读）：缺向量分片数与分布
    .venv/bin/python scripts/repair_missing_vectors.py --scan

    # 2) 修复（默认上限 2000 个分片）
    .venv/bin/python scripts/repair_missing_vectors.py --fix
"""
from __future__ import annotations

import argparse
import csv
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import db, embedding  # noqa: E402
from app.services.store import store  # noqa: E402  # 单例（不是同名模块）

BACKUP_DIR = Path("/tmp/sd_repair")


def _scan() -> tuple[int, dict[str, int]]:
    """返回 (缺向量分片总数, {doc_id: 分片数})。"""
    if store._backend != "db":
        print("⛔ 当前存储后端不是 PostgreSQL（db.available()=False），无 chunks 表可治理。")
        return -1, {}
    conn = db._connect()
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM chunks WHERE vector IS NULL")
        total = int(cur.fetchone()[0])
        cur.execute(
            "SELECT doc_id, count(*) FROM chunks WHERE vector IS NULL"
            " GROUP BY doc_id ORDER BY count(*) DESC"
        )
        by_doc = {r[0]: int(r[1]) for r in cur.fetchall()}
    return total, by_doc


def _export_baseline(rows: list[dict]) -> Path:
    """把待修复的分片键与文本导出为 CSV（回滚基准 + 行数核对）。"""
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    path = BACKUP_DIR / "missing_before.csv"
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["doc_id", "segment_index", "text"])
        for r in rows:
            w.writerow([r["doc_id"], r["segment_index"], r["text"]])
    # 备份的验收标准是「能数出与源一致的行数」，不是「文件生成了」。
    # ⚠️ 必须按 **CSV 记录**数，不能数物理行 —— 分片文本含换行符，
    # 一个记录可占多个物理行（实测 460 条记录 = 1520 物理行）。
    with path.open(encoding="utf-8", newline="") as f:
        n = sum(1 for _ in csv.reader(f)) - 1
    if n != len(rows):
        raise SystemExit(
            f"⛔ 已中止：基线 CSV 行数 {n} 与待修复分片数 {len(rows)} 不一致，备份不可用。"
        )
    return path


def _verify(docs: list[str]) -> bool:
    """修复后复核（外部基准：数据库直查 + 功能性检索，不自证）。"""
    ok = True

    # ① 计数基准：缺向量应归零
    total, _ = _scan()
    if total != 0:
        print(f"⛔ 复核失败：仍有 {total} 个分片缺向量。")
        ok = False
    else:
        print("✅ 复核 1/3：缺向量分片数 = 0")

    # ② 量纲基准：新向量维度必须与存量一致（混合维度会让 pgvector 距离查询直接报错）
    conn = db._connect()
    with conn.cursor() as cur:
        cur.execute("SELECT DISTINCT vector_dims(vector) FROM chunks WHERE vector IS NOT NULL")
        dims = sorted(int(r[0]) for r in cur.fetchall())
    if len(dims) == 1:
        print(f"✅ 复核 2/3：全库向量维度一致（{dims[0]} 维）")
    else:
        print(f"⛔ 复核失败：向量维度混乱 {dims} —— 距离查询会报错，需排查。")
        ok = False

    # ③ 功能基准：每篇修复文档抽首个分片，用其原文做向量检索，该文档必须被召回
    #    （证明新向量「可被检索」，而不只是「非 NULL」）
    for did in docs:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT text FROM chunks WHERE doc_id = %s ORDER BY segment_index LIMIT 1",
                (did,),
            )
            row = cur.fetchone()
        if row is None:
            continue
        qv = embedding.embed([row[0][:2000]])
        if not qv:
            print(f"⛔ 复核失败：{did[:8]}… 查询向量化失败。")
            ok = False
            continue
        hits = db.search_chunks(qv[0], top_n=20)
        hit_ids = {h.get("doc_id") or h.get("id") for h in hits}
        if did in hit_ids:
            print(f"✅ 复核 3/3：{did[:8]}… 分片原文可被向量检索召回（top 20 内）")
        else:
            print(f"⛔ 复核失败：{did[:8]}… 用其分片原文检索未召回该文档（top 20）。")
            ok = False
    return ok


def main() -> int:
    ap = argparse.ArgumentParser(description="补算缺向量（vector IS NULL）的分片")
    ap.add_argument("--scan", action="store_true", help="只体检，不写库（默认）")
    ap.add_argument("--fix", action="store_true", help="导出基线并补算向量")
    ap.add_argument("--limit", type=int, default=2000, help="单次最多处理的分片数")
    args = ap.parse_args()

    t0 = time.perf_counter()

    if not args.fix:
        total, by_doc = _scan()
        if total < 0:
            return 1
        print(f"缺向量分片：{total} 个，涉及 {len(by_doc)} 篇文档")
        for did, n in list(by_doc.items())[:10]:
            print(f"  {did}  {n} 个")
        if total:
            print("\n→ 修复命令：")
            print("   .venv/bin/python scripts/repair_missing_vectors.py --fix")
        else:
            print("\n✅ 没有缺向量的分片，无需修复。")
        print(f"耗时 {time.perf_counter()-t0:.1f}s")
        return 0

    # ---- 修复 ----
    if not embedding.available():
        print("⛔ embedding 未配置，无法补算。请先配置 embedding_* 后再跑。")
        return 1

    total, _by_doc = _scan()
    if total < 0:
        return 1
    if total == 0:
        print("✅ 没有缺向量的分片（目标状态已达成），无需修复。")
        print(f"耗时 {time.perf_counter()-t0:.1f}s")
        return 0

    # 幂等预检（软）：已经为 0 的情况上面拦了；这里防的是「跑了一半中断后重跑」
    # —— 那种情况剩余量会变小，属于正常的断点续跑，不该拦。
    missing = db.missing_vector_chunks(args.limit)
    baseline = _export_baseline(missing)
    print(f"待修复：{len(missing)} 个分片；基线已导出 {baseline}")

    result = store.repair_missing_vectors(args.limit)
    print(
        f"\n补算结果：扫描 {result['scanned']}，写入 {result['repaired']}，"
        f"失败 {result['failed']}，剩余 {result['remaining']}"
    )
    if result["failed"]:
        print("⛔ 有失败批次（不掩盖）：可重跑本脚本续补（只写仍为 NULL 的行）。")
    if not result["docs"]:
        print(f"耗时 {time.perf_counter()-t0:.1f}s")
        return 1

    ok = _verify(result["docs"])
    print(
        "\n回滚路径（如需）：基线 CSV 里记录了每个 (doc_id, segment_index)，"
        "对其中成功的行执行\n"
        f"  UPDATE chunks SET vector = NULL WHERE (doc_id, segment_index) IN"
        f"（{baseline} 中的键）；\n"
        "本脚本只把 NULL 写成向量，未改动任何已有向量。"
    )
    print(f"耗时 {time.perf_counter()-t0:.1f}s")
    return 0 if ok and not result["failed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
