"""乐观锁（revision）写入契约测试。

背景：P0-1 引入自动保存时，必须能判断「我保存时别人是否已改过」。
做法是 documents.revision + 条件更新。本文件锁住四条不变式：

1. 条件更新必须原子：校验与自增在同一条 UPDATE 里，不能「先查后写」；
2. 冲突时**绝不写入**——这是冲突保护的全部意义，只返回 409 不够；
3. 仅移动/排序不得递增 revision（否则拖拽一次就会把别人的保存变成假冲突）；
4. 「文档不存在」与「版本冲突」必须区分（都返回 0 行，但语义相反）。

用假 cursor 真解析 SQL 的方式验证：若只断言「调用了 update_document」，
把条件更新改回无条件更新后测试仍会通过 —— 假实现太宽容会吞掉变异。
"""
from __future__ import annotations

import re
from typing import Any

import pytest


class FakeCursor:
    """真解析 UPDATE 语句的假 cursor。

    刻意解析出 SET 子句与 WHERE 条件，而不是「无论什么都返回成功」——
    后者无法区分「条件更新」与「无条件更新」，测不出真正的回归。
    """

    def __init__(self, rowcount: int = 1, select_row: Any = None) -> None:
        self.rowcount = rowcount
        self.select_row = select_row
        self.executed: list[tuple[str, Any]] = []
        self._last_sql = ""

    def execute(self, sql: str, params: Any = None) -> None:
        self.executed.append((sql, params))
        self._last_sql = sql

    def fetchone(self) -> Any:
        return self.select_row

    def fetchall(self) -> list[Any]:
        return []

    def __enter__(self) -> "FakeCursor":
        return self

    def __exit__(self, *_: Any) -> None:
        return None

    # ---- 供断言用的解析辅助 ----

    def last_update_sql(self) -> str:
        for sql, _ in reversed(self.executed):
            if sql.strip().upper().startswith("UPDATE"):
                return sql
        raise AssertionError("没有执行过 UPDATE")

    def last_update_params(self) -> Any:
        for sql, params in reversed(self.executed):
            if sql.strip().upper().startswith("UPDATE"):
                return params
        raise AssertionError("没有执行过 UPDATE")


class FakeConn:
    def __init__(self, cur: FakeCursor) -> None:
        self._cur = cur

    def cursor(self) -> FakeCursor:
        return self._cur

    def transaction(self) -> "FakeConn":
        return self

    def __enter__(self) -> "FakeConn":
        return self

    def __exit__(self, *_: Any) -> None:
        return None


def _doc(**over: Any) -> dict[str, Any]:
    base = {
        "id": "d1",
        "title": "标题",
        "text": "正文",
        "folder_id": None,
        "kb_id": None,
        "sort_order": 1024.0,
        "updated_at": 1.0,
        "revision": 3,
        "chunks": [],
    }
    base.update(over)
    return base


def test_expected_revision_adds_where_condition() -> None:
    """传 expected_revision 时，WHERE 里必须有 revision 条件。"""
    from app.services import db

    cur = FakeCursor(rowcount=1)
    orig = db._connect
    db._connect = lambda: FakeConn(cur)  # type: ignore[assignment]
    try:
        db.update_document("d1", _doc(), expected_revision=3, touch_revision=True)
    finally:
        db._connect = orig  # type: ignore[assignment]

    sql = cur.last_update_sql()
    assert re.search(r"WHERE\s+id\s*=\s*%s\s+AND\s+revision\s*=\s*%s", sql, re.I), (
        f"WHERE 子句未包含 revision 条件，实际 SQL：{sql}"
    )
    # 参数尾部应是 (..., doc_id, expected_revision)
    params = cur.last_update_params()
    assert params[-2] == "d1"
    assert params[-1] == 3


def test_no_expected_revision_omits_condition() -> None:
    """不传 expected_revision（旧客户端）时不得带 revision 条件，保持向后兼容。"""
    from app.services import db

    cur = FakeCursor(rowcount=1)
    orig = db._connect
    db._connect = lambda: FakeConn(cur)  # type: ignore[assignment]
    try:
        db.update_document("d1", _doc(), expected_revision=None, touch_revision=True)
    finally:
        db._connect = orig  # type: ignore[assignment]

    sql = cur.last_update_sql()
    assert "revision = %s" not in sql.split("WHERE")[-1], (
        f"未传 expected_revision 却带了 revision 条件：{sql}"
    )


def test_touch_revision_increments_in_sql() -> None:
    """内容变化时，revision 的递增必须发生在 SQL 内（原子），而非先查后写。"""
    from app.services import db

    cur = FakeCursor(rowcount=1)
    orig = db._connect
    db._connect = lambda: FakeConn(cur)  # type: ignore[assignment]
    try:
        db.update_document("d1", _doc(), expected_revision=3, touch_revision=True)
    finally:
        db._connect = orig  # type: ignore[assignment]

    sql = cur.last_update_sql()
    set_clause = sql.split("WHERE")[0]
    assert re.search(r"revision\s*=\s*revision\s*\+\s*1", set_clause, re.I), (
        f"SET 子句未包含 revision = revision + 1：{set_clause}"
    )


def test_move_only_does_not_touch_revision() -> None:
    """仅移动/排序（touch_revision=False）不得递增 revision。

    否则拖拽一次排序就会让所有在线编辑者的下一次保存变成假冲突。
    """
    from app.services import db

    cur = FakeCursor(rowcount=1)
    orig = db._connect
    db._connect = lambda: FakeConn(cur)  # type: ignore[assignment]
    try:
        db.update_document("d1", _doc(), expected_revision=None, touch_revision=False)
    finally:
        db._connect = orig  # type: ignore[assignment]

    sql = cur.last_update_sql()
    assert "revision = revision + 1" not in sql, f"仅排序却递增了 revision：{sql}"


def test_conflict_raises_and_does_not_write_chunks() -> None:
    """冲突（rowcount=0 且文档存在）必须抛 RevisionConflict，且不写 chunks。

    只返回 409 是不够的 —— 必须证明「冲突时一个字都没写进去」。
    """
    from app.services import db

    # select_row 非 None → 文档存在 → 是版本冲突而非「不存在」
    cur = FakeCursor(rowcount=0, select_row=("d1", "对方标题", "对方正文", None, None,
                                             1.0, None, None, None, None, None, False,
                                             None, "doc", 1024.0, 2.0, 9))
    orig = db._connect
    db._connect = lambda: FakeConn(cur)  # type: ignore[assignment]
    try:
        with pytest.raises(db.RevisionConflict) as ei:
            db.update_document("d1", _doc(), expected_revision=3, touch_revision=True)
    finally:
        db._connect = orig  # type: ignore[assignment]

    # 异常要携带服务端最新状态，供路由返回 409 时附给前端
    assert ei.value.current["revision"] == 9
    assert ei.value.current["title"] == "对方标题"

    # 冲突后不得重建 chunks
    assert not any("DELETE FROM chunks" in sql for sql, _ in cur.executed), (
        "冲突时不应触碰 chunks"
    )


def test_missing_document_returns_none_not_conflict() -> None:
    """文档不存在（rowcount=0 且 select 为空）应返回 None，而非误报冲突。"""
    from app.services import db

    cur = FakeCursor(rowcount=0, select_row=None)
    orig = db._connect
    db._connect = lambda: FakeConn(cur)  # type: ignore[assignment]
    try:
        result = db.update_document("gone", _doc(), expected_revision=3, touch_revision=True)
    finally:
        db._connect = orig  # type: ignore[assignment]

    assert result is None


def test_doc_cols_includes_revision() -> None:
    """_DOC_COLS 必须含 revision —— 否则读取路径拿不到基线，乐观锁失效。"""
    from app.services import db

    assert "revision" in db._DOC_COLS.split(", ")


def test_doc_from_row_maps_revision() -> None:
    """_doc_from_row 必须把第 17 列（revision）映射出来。"""
    from app.services import db

    row = ("d1", "t", "x", None, None, 1.0, None, None, None, None, None, False,
           None, "doc", 1024.0, 2.0, 7)
    doc = db._doc_from_row(row)
    assert doc["revision"] == 7


def test_doc_from_row_revision_defaults_to_zero() -> None:
    """旧行（列数不足或 NULL）兜底 0，不得抛异常。"""
    from app.services import db

    row = ("d1", "t", "x", None, None, 1.0, None, None, None, None, None, False,
           None, "doc", 1024.0, 2.0, None)
    assert db._doc_from_row(row)["revision"] == 0

    short = ("d1", "t", "x", None, None, 1.0, None, None, None, None, None, False,
             None, "doc", 1024.0)
    assert db._doc_from_row(short)["revision"] == 0