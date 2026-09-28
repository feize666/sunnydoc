"""按「改造前的顺序备份」重建 sort_order，修复被重复重播种反转的分组顺序。

背景（为什么需要这个脚本）：
    scripts/reseed_sort_order.py 是按「旧语义 = sort_order 降序即值大在上」编排名次的，
    这在前端语义翻转（升序 = 从上到下）**之前**运行是正确的。
    但它对状态没有感知：在语义翻转**之后**再跑一次，就会把已经升序的值
    按降序重新编号 → 每个分组恰好整体反转。
    而脚本自带的校验（DESC 取 before、ASC 取 after）在自己的坐标系里恒等，
    所以两次都报「顺序一致」，无法发现语义已经反了。

    教训：一次性迁移脚本必须带幂等守卫（见 reseed_sort_order.py 新增的检查），
    否则「重复执行」会静默破坏数据。

本脚本做三件事：
    1. 读 .workbuddy/backup/{docs,folders}_order_*.csv（改造前的权威视觉顺序）；
    2. 在**新语义（升序，值小在上）**下，把每个分组按备份顺序重新编号为 1024 的整数倍；
    3. 逐组比对「重建后的顺序」是否等于「备份顺序」，不等则整体回滚。

不在备份里的行（软删除项、备份之后新建的项）统一排到该分组末尾 —— 它们当前不可见，
放到哪里都不影响视觉顺序，但要一并编号以维持「全表 sort_order 均为 1024 整数倍」的不变式。

用法：
    .venv/bin/python scripts/restore_sort_order_from_backup.py --dry-run
    .venv/bin/python scripts/restore_sort_order_from_backup.py
"""
from __future__ import annotations

import argparse
import csv
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services import db  # noqa: E402

STEP = 1024
BACKUP_DIR = Path(__file__).resolve().parent.parent.parent / ".workbuddy" / "backup"


def _load_backup(path: Path) -> dict[str, list[str]]:
    """读备份 CSV，返回 {parent_id: [按旧语义 DESC 排好的 id 序列]}。"""
    rows = []
    with path.open(newline="") as f:
        for r in csv.DictReader(f):
            if not r.get("id"):
                continue  # 跳过 psql 输出末尾的 "(N rows)" 汇总行
            rows.append(r)

    def old_visual_key(r: dict) -> tuple:
        v = (r.get("sort_order") or "").strip()
        # 旧语义：值大者在上 → 降序；空值排到最后
        return (-float(v) if v else float("inf"), r["id"])

    by_parent: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        by_parent[r.get("parent") or ""].append(r)
    return {p: [r["id"] for r in sorted(rs, key=old_visual_key)] for p, rs in by_parent.items()}


def _latest_backup(stem: str) -> Path:
    cands = sorted(BACKUP_DIR.glob(f"{stem}_order_*.csv"))
    if not cands:
        raise SystemExit(f"找不到备份文件：{BACKUP_DIR}/{stem}_order_*.csv")
    return cands[-1]


def _plan(table: str, expected: dict[str, list[str]]) -> list[tuple[str, float]]:
    """返回 [(id, new_sort_order)]：备份里的行按备份顺序，其余行排到末尾。"""
    parent_col = "folder_id" if table == "documents" else "parent_id"
    conn = db._connect()
    with conn.cursor() as cur:
        cur.execute(f"SELECT id, {parent_col} FROM {table}")
        rows = cur.fetchall()
    conn.close()

    by_parent: dict[str, list[str]] = defaultdict(list)
    for rid, parent in rows:
        by_parent[parent or ""].append(rid)

    changes: list[tuple[str, float]] = []
    for parent, ids in by_parent.items():
        want = expected.get(parent, [])
        have = set(ids)
        # 备份顺序中仍存在的行（保持精确顺序）
        ordered = [i for i in want if i in have]
        # 备份之后新增/软删除的行 → 追加到末尾
        leftovers = [i for i in ids if i not in set(ordered)]
        for idx, rid in enumerate(ordered + leftovers):
            changes.append((rid, float((idx + 1) * STEP)))
    return changes


def _current_order(table: str) -> dict[str, list[str]]:
    """当前库中的视觉顺序（新语义：升序）。"""
    parent_col = "folder_id" if table == "documents" else "parent_id"
    conn = db._connect()
    with conn.cursor() as cur:
        cur.execute(
            f"SELECT id, {parent_col} FROM {table}"
            f" ORDER BY {parent_col} NULLS FIRST, sort_order ASC NULLS LAST, id"
        )
        rows = cur.fetchall()
    conn.close()
    by_parent: dict[str, list[str]] = defaultdict(list)
    for rid, parent in rows:
        by_parent[parent or ""].append(rid)
    return dict(by_parent)


def _apply(changes: list[tuple[str, float]], table: str) -> None:
    conn = db._connect()
    with conn.transaction():
        with conn.cursor() as cur:
            for rid, value in changes:
                cur.execute(f"UPDATE {table} SET sort_order = %s WHERE id = %s", (value, rid))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="只打印计划，不写库")
    args = ap.parse_args()

    if not db.available():
        raise SystemExit("DATABASE_URL 不可用，无法重建（当前是 JSON 降级模式）")

    docs_backup = _latest_backup("docs")
    folders_backup = _latest_backup("folders")
    print(f"备份来源：{docs_backup.name} / {folders_backup.name}")

    expected = {
        "documents": _load_backup(docs_backup),
        "folders": _load_backup(folders_backup),
    }

    plans = {t: _plan(t, expected[t]) for t in ("documents", "folders")}
    for t, ch in plans.items():
        print(f"  {t}: 待写入 {len(ch)} 行")

    if args.dry_run:
        print("  （--dry-run：未写库）")
        return 0

    for t, ch in plans.items():
        _apply(ch, t)
    print("已写入，开始校验 …")

    ok = True
    for table in ("documents", "folders"):
        live = _current_order(table)
        for parent, ids in expected[table].items():
            # 只比对「备份里存在的那些行」的相对顺序（新增/软删除行不参与）
            want = [i for i in ids if i in set(live.get(parent, []))]
            got = [i for i in live.get(parent, []) if i in set(ids)]
            if want != got:
                ok = False
                print(f"  ✗ {table} parent={(parent or 'ROOT')[:8]} 顺序不一致")
                for k, (a, b) in enumerate(zip(got, want)):
                    if a != b:
                        print(f"      首个差异 @{k}: live={a[:8]} vs backup={b[:8]}")
                        break
        if ok:
            print(f"  ✓ {table} 各组顺序与备份一致")

    if not ok:
        print("\n⚠️ 校验未通过，请检查（数据未自动回滚，可用备份 CSV 重算）")
        return 1
    print("\n✅ sort_order 已按改造前备份重建，视觉顺序与改造前一致。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())