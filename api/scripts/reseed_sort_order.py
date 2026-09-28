"""重播种 sort_order：把「以 created_at 为种子的大数值」洗成「间隔 1024 的小整数」。

为什么需要：created_at 是秒级时间戳（约 1.79e9），double 在该量级的 ulp ≈ 4.8e-7，
前端中点插入约 20 次就会算出相同值 → 排序静默失效（表现为「怎么拖都不动」且不报错）。
重播种后值域约 2^16，ulp ≈ 2.9e-11，同一位置可连续中点插入约 45 次，配合前端
重平衡守卫即可无上限。

保序规则：旧语义是「值大者在上」（DESC），新语义是「值小者在上」（ASC）。
因此按 ORDER BY sort_order DESC 编排名次，再乘以步长，视觉顺序完全不变。

覆盖范围包含软删除（回收站）的行：它们虽然当前不可见，但「恢复」后会重新参与排序，
若保留 created_at 级大数值，等于把精度隐患留在库里。纳入统一编号让不变式
「所有行的 sort_order 都是 1024 的整数倍」在全表成立；软删除行与可见行同组编号，
可见行之间的相对顺序不受影响（快照比对依然有效）。

用法：
    .venv/bin/python scripts/reseed_sort_order.py --dry-run   # 只打印计划
    .venv/bin/python scripts/reseed_sort_order.py             # 真正执行

⚠️ 本脚本是一次性迁移，只应在「语义翻转之前」运行一次。它对状态没有感知：
   语义翻转后再跑，会把已升序的值按降序重编 → 每个分组恰好整体反转；
   而脚本自带的校验（DESC 取 before、ASC 取 after）在自己的坐标系里恒等，
   所以两次都会报「顺序一致」，无法发现语义已经反了。（本项目真实踩过。）
   现在已加幂等守卫：检测到「全表 sort_order 均已是 STEP 整数倍」即判定
   重播种已执行过，直接拒绝运行（确需强行重播种用 --force，但请先想清楚语义方向）。

幂等：已是「间隔 1024 小整数」时会被守卫拦下（除非 --force）。
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services import db  # noqa: E402

STEP = 1024


def _plan() -> list[tuple[str, str, int]]:
    """返回 [(table, id, new_value), ...] 形式的变更计划（不写库）。"""
    if not db.available():
        raise SystemExit("DATABASE_URL 不可用，无法重播种（当前是 JSON 降级模式）")

    conn = db._connect()
    changes: list[tuple[str, str, int]] = []
    with conn.cursor() as cur:
        # documents：按 folder_id 分组，组内按旧 sort_order 降序编名次
        # 不加 deleted_at 过滤：回收站里的行恢复后仍要参与排序，必须一并洗成小数值
        cur.execute(
            """
            SELECT id, row_number() OVER (PARTITION BY folder_id ORDER BY sort_order DESC, id) AS rn
            FROM documents
            """
        )
        changes += [("documents", rid, int(rn) * STEP) for rid, rn in cur.fetchall()]
        # folders：按 parent_id 分组
        cur.execute(
            """
            SELECT id, row_number() OVER (PARTITION BY parent_id ORDER BY sort_order DESC, id) AS rn
            FROM folders
            """
        )
        changes += [("folders", rid, int(rn) * STEP) for rid, rn in cur.fetchall()]
    return changes


def _apply(changes: list[tuple[str, str, int]]) -> None:
    conn = db._connect()
    with conn.transaction():
        with conn.cursor() as cur:
            for table, rid, value in changes:
                cur.execute(
                    f"UPDATE {table} SET sort_order = %s WHERE id = %s",
                    (float(value), rid),
                )


def _snapshot(table: str, order_dir: str) -> list[str]:
    """取某表的「视觉顺序」ID 序列，用于迁移前后比对。"""
    parent_col = "folder_id" if table == "documents" else "parent_id"
    conn = db._connect()
    with conn.cursor() as cur:
        cur.execute(
            f"SELECT id FROM {table} WHERE deleted_at IS NULL"
            f" ORDER BY {parent_col} NULLS FIRST, sort_order {order_dir}, id"
        )
        return [r[0] for r in cur.fetchall()]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="只打印计划，不写库")
    ap.add_argument(
        "--force",
        action="store_true",
        help="跳过「已重播种」守卫，强制重播种（语义翻转后再跑会反转分组顺序，慎用）",
    )
    args = ap.parse_args()

    if not args.force:
        # 幂等守卫：全表都已是 STEP 的整数倍 → 说明重播种已经跑过。
        # 此时再跑必然是「语义翻转之后」的重复执行，会反转每个分组的顺序。
        conn = db._connect()
        with conn.cursor() as cur:
            already = 0
            total = 0
            for table in ("documents", "folders"):
                cur.execute(f"SELECT count(*) FROM {table}")
                total += cur.fetchone()[0]
                cur.execute(
                    f"SELECT count(*) FROM {table}"
                    f" WHERE sort_order::numeric % {STEP} = 0"
                )
                already += cur.fetchone()[0]
        conn.close()
        if total and already == total:
            print(
                f"⛔ 已中止：全表 {total} 行的 sort_order 均为 {STEP} 的整数倍，"
                "说明重播种已执行过。\n"
                "   重复执行会把已升序的值按旧语义降序重编 → 每个分组整体反转。\n"
                "   若顺序已因此反转，请改用：\n"
                "     .venv/bin/python scripts/restore_sort_order_from_backup.py\n"
                "   确需强行重播种：加 --force（请先确认语义方向）。"
            )
            return 1

    print("[1/4] 采集迁移前的视觉顺序 …")
    before_docs = _snapshot("documents", "DESC")
    before_folders = _snapshot("folders", "DESC")

    print("[2/4] 计算重播种计划 …")
    changes = _plan()
    print(f"      待写入 {len(changes)} 行（documents + folders）")

    if args.dry_run:
        for table, rid, value in changes[:8]:
            print(f"      {table:10s} {rid[:12]}… -> {value}")
        print("      （--dry-run：未写库）")
        return 0

    print("[3/4] 执行重播种 …")
    _apply(changes)

    print("[4/4] 校验视觉顺序是否保持不变 …")
    after_docs = _snapshot("documents", "ASC")
    after_folders = _snapshot("folders", "ASC")

    ok = True
    if before_docs != after_docs:
        ok = False
        print(f"      ✗ documents 顺序变化！前 {len(before_docs)} 行 / 后 {len(after_docs)} 行")
        for i, (a, b) in enumerate(zip(before_docs, after_docs)):
            if a != b:
                print(f"        首个差异 @{i}: {a[:12]}… != {b[:12]}…")
                break
    else:
        print(f"      ✓ documents 顺序一致（{len(after_docs)} 行）")

    if before_folders != after_folders:
        ok = False
        print("      ✗ folders 顺序变化！")
    else:
        print(f"      ✓ folders 顺序一致（{len(after_folders)} 行）")

    # 不变式：全表（含回收站）的 sort_order 都应是 1024 的整数倍。
    # 若这里不为 0，说明有行绕过了重播种，恢复后会把大数值带回排序。
    conn = db._connect()
    with conn.cursor() as cur:
        for table in ("documents", "folders"):
            cur.execute(
                f"SELECT count(*) FROM {table}"
                f" WHERE sort_order IS NULL OR (sort_order::numeric % {STEP}) <> 0"
            )
            bad = cur.fetchone()[0]
            if bad:
                ok = False
                print(f"      ✗ {table} 有 {bad} 行 sort_order 不是 {STEP} 的整数倍")
            else:
                cur.execute(f"SELECT count(*) FROM {table}")
                print(f"      ✓ {table} 全表 {cur.fetchone()[0]} 行均为 {STEP} 的整数倍")

    if not ok:
        print("\n⚠️ 顺序发生变化，请用备份回滚：.workbuddy/backup/*_order_*.csv")
        return 1
    print("\n✅ 重播种完成，视觉顺序保持不变。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())