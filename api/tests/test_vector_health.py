"""向量健康治理（缺向量分片的补算）测试。

背景（2026-10-14）：`store._build_chunks` 在 embedding 失败时静默写入无向量
分片，实测 2 篇文档 460 个分片如此躺了数周，AI 语义检索完全缺席而无人知晓。
修复分三层，本测试逐层钉住：

  1. `db.set_chunk_vectors` 的**只写 NULL 行**语义 —— 这是「方向安全」的
     代码级保证（重复执行不得覆盖已有向量）。假 cursor **真解析 WHERE 条件**，
     不是无论如何都写（否则把 `vector IS NULL` 删掉测试仍会绿）。
  2. `store.repair_missing_vectors` 的编排：10 条一批、失败批次计数且不写、
     JSON 降级后端明确不支持。
  3. `_build_chunks` 降级时的**可观测告警** —— 静默降级是本缺陷的根因。
  4. 路由层：不支持的后端返回 400（不假装成功），正常路径透传结果并记审计。
"""
from __future__ import annotations

import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402

from app.api import routes  # noqa: E402
from app.services import db, store as store_mod  # noqa: E402


# ---------- 假实现：真解析语义的 cursor ----------

class FakeConn:
    """带事务与 cursor 的假连接。cursor 按 SQL 文本里的 WHERE 条件决定行为。"""

    def __init__(self, chunks: dict[tuple[str, int], str | None]) -> None:
        self.chunks = chunks  # (doc_id, segment_index) -> vector 字面量或 None
        self.executed: list[tuple[str, tuple]] = []

    def transaction(self):
        return _NullCtx()

    def cursor(self):
        return self

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def commit(self):
        pass

    def execute(self, sql: str, params=None):
        self.executed.append((sql, params or ()))
        self.rowcount = 0
        if "UPDATE chunks SET vector" not in sql:
            return
        vec_s, doc_id, seg = params
        key = (doc_id, seg)
        # 真解析：WHERE 里带 `vector IS NULL` 时，已有向量的行不得被写
        only_null = "vector IS NULL" in sql
        if only_null and self.chunks.get(key) is not None:
            self.rowcount = 0
            return
        self.chunks[key] = vec_s
        self.rowcount = 1


class _NullCtx:
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class FakeDb:
    """只实现向量治理用到的三个函数，其余属性不存在（误用会立刻炸）。"""

    def __init__(self, conn: FakeConn, missing: list[dict] | None = None) -> None:
        self._conn = conn
        self._missing = missing or []

    def _connect(self):
        return self._conn

    def missing_vector_chunks(self, limit: int = 2000):
        return list(self._missing[:limit])

    def set_chunk_vectors(self, rows):
        conn = self._conn
        n = 0
        with conn.transaction(), conn.cursor() as cur:
            for doc_id, seg, vec in rows:
                cur.execute(
                    "UPDATE chunks SET vector = %s"
                    " WHERE doc_id = %s AND segment_index = %s AND vector IS NULL",
                    (db._vec_to_str(vec), doc_id, seg),
                )
                n += cur.rowcount
        return n

    def count_missing_vectors(self) -> int:
        return sum(1 for v in self._conn.chunks.values() if v is None)


class FakeEmbedding:
    """available 与 embed 失败是两个独立开关：

    available=False → 「未配置」，`_build_chunks` 直接跳过（既有行为）；
    available=True 但 embed 返回 None → 「调用失败」，必须告警（本次修复的行为）。
    """

    def __init__(self, available: bool = True, embed_fails: bool = False) -> None:
        self._available = available
        self._embed_fails = embed_fails
        self.calls: list[list[str]] = []

    def available(self) -> bool:
        return self._available

    def embed(self, texts):
        if self._embed_fails:
            return None
        self.calls.append(list(texts))
        return [[float(len(t)), 1.0, 0.0] for t in texts]


def _st(backend: str = "db"):
    st = store_mod.DocStore.__new__(store_mod.DocStore)
    st._backend = backend
    return st


# ---------- 1. db 层：只写 NULL 行 ----------

def test_set_chunk_vectors_skips_existing_vectors(monkeypatch):
    """已有向量的行必须被跳过（重复执行不得覆盖 —— 方向安全的代码级保证）。

    直接驱动真实的 `db.set_chunk_vectors`，只把 `_connect` 换成假连接。
    """
    conn = FakeConn({("d1", 0): "[1.0,2.0]", ("d1", 1): None})
    monkeypatch.setattr(db, "_connect", lambda: conn)

    n = db.set_chunk_vectors([("d1", 0, [9.0, 9.0]), ("d1", 1, [3.0, 4.0])])

    assert n == 1, "只有 NULL 行应被写入"
    assert conn.chunks[("d1", 0)] == "[1.0,2.0]", "已有向量不得被覆盖"
    assert conn.chunks[("d1", 1)] == db._vec_to_str([3.0, 4.0])


def test_fake_cursor_detects_missing_null_guard():
    """对抗性自检：把 WHERE 里的 `vector IS NULL` 删掉，假实现必须放行覆盖。

    若这条失败，说明上面的假 cursor 没有真解析语义，测试 1 可能恒真。
    """
    conn = FakeConn({("d1", 0): "[1.0,2.0]"})
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE chunks SET vector = %s WHERE doc_id = %s AND segment_index = %s",  # 无守卫
            ("[9.0,9.0]", "d1", 0),
        )
        assert cur.rowcount == 1
    assert conn.chunks[("d1", 0)] == "[9.0,9.0]"


# ---------- 2. store 层：编排 ----------

def test_repair_batches_by_ten_and_counts(monkeypatch):
    """25 个缺失分片 → 3 批（10/10/5），全部写入，remaining 归零。"""
    missing = [{"doc_id": "d1", "segment_index": i, "text": f"片段{i}"} for i in range(25)]
    conn = FakeConn({("d1", i): None for i in range(25)})
    fake_db = FakeDb(conn, missing)
    fe = FakeEmbedding()
    monkeypatch.setattr(store_mod, "db", fake_db)
    monkeypatch.setattr(store_mod, "embedding", fe)

    out = _st().repair_missing_vectors()

    assert out["supported"] is True
    assert out["scanned"] == 25
    assert out["repaired"] == 25
    assert out["failed"] == 0
    assert out["remaining"] == 0
    assert out["docs"] == ["d1"]
    assert [len(c) for c in fe.calls] == [10, 10, 5], "必须按 10 条一批"
    assert all(v is not None for v in conn.chunks.values())


def test_repair_embed_failure_counts_failed_and_writes_nothing(monkeypatch):
    """整体失败：计 failed、不写库、不谎报 repaired。"""
    missing = [{"doc_id": "d1", "segment_index": i, "text": f"片段{i}"} for i in range(12)]
    conn = FakeConn({("d1", i): None for i in range(12)})
    fe = FakeEmbedding(embed_fails=True)
    monkeypatch.setattr(store_mod, "db", FakeDb(conn, missing))
    monkeypatch.setattr(store_mod, "embedding", fe)

    out = _st().repair_missing_vectors()

    assert out["repaired"] == 0
    assert out["failed"] == 12
    assert all(v is None for v in conn.chunks.values()), "失败批次不得写库"


def test_repair_json_backend_not_supported():
    """JSON 降级后端没有 chunks 表概念，必须明确说不支持（不静默空跑）。"""
    out = _st(backend="json").repair_missing_vectors()
    assert out["supported"] is False
    assert out["scanned"] == 0 and out["repaired"] == 0


def test_repair_limit_is_respected(monkeypatch):
    """limit 参数必须真的限制扫描量（大批量时防一次跑太久）。"""
    missing = [{"doc_id": "d1", "segment_index": i, "text": f"片段{i}"} for i in range(50)]
    conn = FakeConn({("d1", i): None for i in range(50)})
    monkeypatch.setattr(store_mod, "db", FakeDb(conn, missing))
    monkeypatch.setattr(store_mod, "embedding", FakeEmbedding())

    out = _st().repair_missing_vectors(limit=15)

    assert out["scanned"] == 15
    assert out["repaired"] == 15


# ---------- 3. 可观测性：降级必须响 ----------

def test_build_chunks_warns_when_embedding_fails(st_stub, monkeypatch, caplog):
    """embed() 返回 None 时必须打告警（静默无向量入库是本缺陷的根因）。

    注意与「未配置」区分：available()=True 但调用失败才是本路径。
    """
    fe = FakeEmbedding(available=True, embed_fails=True)
    monkeypatch.setattr(store_mod, "embedding", fe)
    with caplog.at_level(logging.WARNING, logger="app.services.store"):
        chunks = st_stub._build_chunks("第一段内容，长度足够。\n\n第二段内容，长度足够。")

    assert all(c["vector"] is None for c in chunks)
    warnings = [r for r in caplog.records if r.levelno >= logging.WARNING]
    assert warnings, "embedding 失败必须产生告警，不得静默"
    assert "repair-embeddings" in warnings[0].getMessage(), "告警须给出修复入口"


@pytest.fixture()
def st_stub():
    return _st()


# ---------- 4. 路由层 ----------

class _FakeStoreForRoute:
    def __init__(self, result):
        self._backend = "db"
        self._result = result
        self.calls: list[int] = []

    def repair_missing_vectors(self, limit: int = 2000):
        self.calls.append(limit)
        return self._result


def test_repair_endpoint_passes_result_and_audits(monkeypatch):
    fake = _FakeStoreForRoute(
        {"supported": True, "scanned": 460, "repaired": 460, "remaining": 0, "failed": 0,
         "docs": ["af1c5d24", "8c50e69c"]}
    )
    audited: list[tuple] = []
    monkeypatch.setattr(routes, "store", fake)
    monkeypatch.setattr(routes, "_audit", lambda *a: audited.append(a))

    out = routes.repair_embeddings({"id": "u1", "role": "admin"})

    assert out["repaired"] == 460
    assert fake.calls == [2000], "应使用默认上限 2000"
    assert audited and audited[0][1] == "embedding_repair"
    assert "460" in audited[0][4]


def test_repair_endpoint_400_when_backend_unsupported(monkeypatch):
    """JSON 后端不得假装成功 —— 明确 400。"""
    fake = _FakeStoreForRoute({"supported": False, "scanned": 0, "repaired": 0,
                               "remaining": 0, "failed": 0, "docs": []})
    monkeypatch.setattr(routes, "store", fake)

    from fastapi import HTTPException

    with pytest.raises(HTTPException) as ei:
        routes.repair_embeddings({"id": "u1", "role": "admin"})
    assert ei.value.status_code == 400


def test_embedding_health_reports_missing(monkeypatch):
    fake = _FakeStoreForRoute({"supported": True})
    monkeypatch.setattr(routes, "store", fake)
    monkeypatch.setattr(db, "count_missing_vectors", lambda: 42)
    monkeypatch.setattr("app.services.embedding.available", lambda: True)

    out = routes.embedding_health({"id": "u1", "role": "admin"})

    assert out["backend"] == "db"
    assert out["supported"] is True
    assert out["missing"] == 42
    assert out["embedding_available"] is True
