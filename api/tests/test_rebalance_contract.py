"""rebalance_if_needed 的行为契约。

这个函数会**静默改写整层坐标**（把同级节点重编号为 1024 的整数倍）。
它被调用的时机是「中点插入逼近 double 极限、算出并列值」——也就是说，
用户每次拖拽到极窄间隙附近，都可能触发一次全层重写。

因此它必须满足一条不变式：**重编号不得改变相对顺序**。
否则「拖拽落点」这类依赖坐标顺序的功能会集体错位，而且因为没有任何报错，
只会表现为「偶尔顺序不对」。

用假 cursor 驱动，不依赖真实数据库。
"""
from __future__ import annotations

from app.services import db


class FakeCursor:
    """复现 rebalance_if_needed 用到的两条 SQL 语义。

    - SELECT id, sort_order ... ORDER BY <clause>
    - UPDATE {table} SET sort_order = %s WHERE id = %s

    ⚠️ 必须**真的解析 ORDER BY 子句**，否则「保序」这条断言形同虚设：
    曾用「无论如何都按 sort_order 排序」的假实现，结果把生产代码里的
    `ORDER BY sort_order ASC, id` 变异成 `ORDER BY id ASC` 后测试依然全绿
    —— 假实现的宽容吞掉了被测缺陷。
    """

    def __init__(self, rows: list[tuple[str, float | None]], table: str = "documents"):
        # rows 传入顺序即「期望的当前顺序」，本类按 SQL 里的 ORDER BY 复现数据库排序
        self._store: dict[str, float | None] = dict(rows)
        self._table = table
        self._result: list[tuple[str, float | None]] = []
        self.updates: list[tuple[str, float]] = []
        self._order_by = ""

    def _sorted(self) -> list[tuple[str, float | None]]:
        items = list(self._store.items())
        # 按 SQL 实际声明的列排序，让「ORDER BY 被改坏」能被测试抓到
        keys: list[tuple] = []
        clause = self._order_by.lower()
        if "sort_order" in clause:
            asc = "desc" not in clause.split("sort_order")[1].split(",")[0]
            keys.append(
                lambda kv: (float("inf") if kv[1] is None else float(kv[1])),
            )
            if not asc:
                keys[-1] = lambda kv: -(float("inf") if kv[1] is None else float(kv[1]))
        if "id" in clause:
            keys.append(lambda kv: kv[0])
        if not keys:
            return items
        for k in reversed(keys):
            items.sort(key=k)
        return items

    def execute(self, sql: str, params: tuple = ()) -> None:
        head = sql.strip().split()[0].upper()
        if head == "SELECT":
            self._order_by = sql.split("ORDER BY", 1)[1] if "ORDER BY" in sql else ""
            self._result = self._sorted()
            return
        if head == "UPDATE":
            new_val, rid = params
            self._store[rid] = new_val
            self.updates.append((rid, new_val))
            return
        raise AssertionError(f"未预期的 SQL: {sql}")

    def fetchall(self):
        return list(self._result)

    def order(self) -> list[str]:
        """当前实际顺序（同样尊重 SQL 声明的 ORDER BY）。"""
        return [rid for rid, _ in self._sorted()]


def test_rebalance_preserves_relative_order():
    """间距过近触发重排后，相对顺序必须完全不变。

    ⚠️ 夹具的 id 字典序必须与坐标序**不一致**（z→m→a 对 1024→2048→3072）。
    首版让 id 恰好与坐标同序，于是把生产代码的 `ORDER BY sort_order ASC, id`
    变异成 `ORDER BY id ASC` 后测试依然全绿 —— 「两个顺序一致」的夹具无法
    分辨到底按哪个序在走，等于没测。
    """
    cur = FakeCursor(
        [
            ("z", 1024.0),
            ("m", 1024.0 + 1e-9),  # 与 z 间距 < REBALANCE_GAP
            ("a", 3072.0),
            ("k", 4096.0),
        ]
    )
    before = cur.order()
    assert before == ["z", "m", "a", "k"], f"夹具坐标序应为 z,m,a,k，实际 {before}"
    assert before != sorted(before), "夹具 id 序与坐标序相同，无法分辨排序依据"

    changed = db.rebalance_if_needed(cur, "documents", None)
    assert changed is True, "间距过近却未触发重排"
    assert cur.order() == before, "重排改变了相对顺序"


def test_rebalance_renumbers_to_grid_multiples():
    """重排后的值必须是 SORT_STEP 的整数倍且从 1 开始连续编号。"""
    cur = FakeCursor([("a", 5.0), ("b", 5.0), ("c", 6.0)])
    assert db.rebalance_if_needed(cur, "documents", None) is True
    vals = sorted(v for v in cur._store.values() if v is not None)
    assert vals == [db.SORT_STEP, 2 * db.SORT_STEP, 3 * db.SORT_STEP]


def test_rebalance_does_not_trigger_on_healthy_spacing():
    """间距正常时不得改动任何坐标（避免无谓的全层重写）。"""
    cur = FakeCursor([("a", 1024.0), ("b", 2048.0), ("c", 3072.0)])
    before = dict(cur._store)
    assert db.rebalance_if_needed(cur, "documents", None) is False
    assert cur._store == before, "间距健康却改写了坐标"


def test_rebalance_triggers_on_null_sort_order():
    """存在 NULL 必须触发重排（NULL 会在升序里排到最前，打乱用户顺序）。"""
    cur = FakeCursor([("a", None), ("b", 2048.0)])
    assert db.rebalance_if_needed(cur, "documents", None) is True
    assert all(v is not None for v in cur._store.values())


def test_rebalance_noop_for_single_row():
    """同级只有一行时不做任何事。"""
    cur = FakeCursor([("a", None)])
    assert db.rebalance_if_needed(cur, "documents", None) is False


def test_rebalance_ignores_unknown_table():
    """未登记的表直接返回 False，不得抛异常。"""
    cur = FakeCursor([("a", 1.0), ("b", 1.0)])
    assert db.rebalance_if_needed(cur, "not_a_table", None) is False


def test_rebalance_for_folders_preserves_order():
    """folders 表同契约（与 documents 是两条独立调用路径）。

    同样要求 id 序 ≠ 坐标序。
    """
    cur = FakeCursor([("f9", 1024.0), ("f3", 1024.0 + 1e-9), ("f1", 2048.0)])
    before = cur.order()
    assert before == ["f9", "f3", "f1"], f"夹具坐标序应为 f9,f3,f1，实际 {before}"
    assert before != sorted(before), "夹具 id 序与坐标序相同，无法分辨排序依据"

    assert db.rebalance_if_needed(cur, "folders", None) is True
    assert cur.order() == before