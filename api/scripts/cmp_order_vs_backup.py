#!/usr/bin/env python3
"""把当前库的分组顺序与「改造前备份」逐一比对，量化两者差异。

用途：确认某次实验/操作是否改动了顺序数据。
注意：备份是「改造前（旧语义 DESC）」导出的，其 CSV 行序即当时的视觉顺序；
     与当前「升序」语义下的视觉序同向，因此可以直接比对名称序列。

用法：.venv/bin/python /tmp/cmp_backup.py
"""
from __future__ import annotations
import csv, os, sys, collections, pathlib

ROOT = pathlib.Path("/Users/beidou/WorkBuddy/2026-09-08-08-54-36")
sys.path.insert(0, str(ROOT / "api"))
for line in open(ROOT / "api/.env"):
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())

from app.services import db  # noqa: E402


def load_backup(path: pathlib.Path, name_col: str):
    """→ {parent: [name, ...]}，按 CSV 行序（= 当时的视觉顺序）。"""
    out: dict[str, list[str]] = collections.OrderedDict()
    for r in csv.DictReader(open(path)):
        p = r.get("parent") or "__root__"
        out.setdefault(p, []).append(r.get(name_col) or "")
    return out


def live_groups(table: str):
    """→ {parent: [name, ...]}，按当前 sort_order 升序。"""
    parent_col, name_col = ("folder_id", "title") if table == "documents" else ("parent_id", "name")
    conn = db._connect()
    with conn.cursor() as cur:
        cur.execute(
            f"SELECT COALESCE({parent_col},'__root__') AS p, {name_col}, sort_order, pinned"
            f" FROM {table} WHERE deleted_at IS NULL"
            f" ORDER BY p, pinned DESC, sort_order ASC NULLS LAST, id"
        )
        out: dict[str, list[str]] = {}
        for p, nm, _so, _pin in cur.fetchall():
            out.setdefault(p, []).append(nm)
    return out


def compare(label: str, backup_path: pathlib.Path, table: str, name_col: str):
    want = load_backup(backup_path, name_col)
    got = live_groups(table)

    exact = diff = 0
    details = []
    for p, wseq in want.items():
        gseq = got.get(p)
        if gseq is None:
            continue
        if wseq == gseq:
            exact += 1
        else:
            diff += 1
            details.append((p, wseq, gseq))

    print(f"\n{'='*66}")
    print(f"{label}: 分组 {len(want)} 个 → 完全一致 {exact} / 有差异 {diff}")
    print(f"{'='*66}")
    for p, w, g in details:
        print(f"\n  父级 {p[:16]}…")
        print(f"    备份序: {' → '.join(x[:18] for x in w)}")
        print(f"    当前序: {' → '.join(x[:18] for x in g)}")
        # 判断是否「整体反转」
        if w == g[::-1]:
            print("    ⚠️ 完全反转")
    return exact, diff


if __name__ == "__main__":
    bk = ROOT / ".workbuddy/backup"
    docs_csv = sorted(bk.glob("docs_order_*.csv"))[-1]
    folders_csv = sorted(bk.glob("folders_order_*.csv"))[-1]
    print(f"基准备份: {docs_csv.name} / {folders_csv.name}")
    e1, d1 = compare("文档分组", docs_csv, "documents", "title")
    e2, d2 = compare("文件夹分组", folders_csv, "folders", "name")
    print(f"\n合计: 完全一致 {e1+e2} / 有差异 {d1+d2}")