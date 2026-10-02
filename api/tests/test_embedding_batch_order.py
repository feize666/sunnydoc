"""embedding.embed 的分批顺序对齐测试。

背景（真实缺陷，2026-10-01 实测发现）：

    该服务端返回的 `index` 是**批内局部**索引 —— 每批都从 0 开始。
    原实现对所有批次做 `items.sort(key=index)`，于是各批次的「第 0 项」被排到一起、
    「第 1 项」排到一起……向量与文本整体错配。

    影响面：>10 个分片（约 4000 字以上）的文档全部中招，实测 234/246 篇、
    40365 个分片。而且**不会报错** —— 搜索照常返回结果，只是指向错误位置。

    所以这些测试只关心一件事：**第 i 个输入必须拿回第 i 个输出**。
    为了让断言有意义，假客户端返回的向量编码了「它属于哪条文本」。
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402

from app.services import embedding as emb_mod  # noqa: E402


class FakeResponse:
    def __init__(self, payload: dict[str, Any]) -> None:
        self._payload = payload

    def raise_for_status(self) -> None:
        pass

    def json(self) -> dict[str, Any]:
        return self._payload


class BatchIndexClient:
    """模拟真实服务：**批内** index 从 0 开始，且向量可反查其来源文本。

    向量内容 = [该文本在**本批内**的位置] 重复 3 次。若实现正确地按批次拼接，
    第 i 条输入必拿到「批内偏移 i%10」；若错误地全局排序，就会被后一批的 0 覆盖。
    """

    def __init__(self) -> None:
        self.calls: list[list[str]] = []

    @property
    def is_closed(self) -> bool:
        return False

    def post(self, url: str, headers=None, json=None, **kw) -> FakeResponse:  # noqa: A002
        batch: list[str] = json["input"]
        self.calls.append(list(batch))
        return FakeResponse(
            {
                "data": [
                    {"index": j, "embedding": [float(j)] * 3}
                    for j in range(len(batch))
                ]
            }
        )


@pytest.fixture()
def client(monkeypatch):
    c = BatchIndexClient()
    monkeypatch.setattr(emb_mod, "_get_client", lambda: c)
    monkeypatch.setattr(
        emb_mod,
        "_cfg",
        lambda: {
            "embedding_api_key": "k",
            "embedding_base_url": "https://example.invalid/v1",
            "embedding_model": "m",
        },
    )
    # 让 _client 缓存不干扰
    monkeypatch.setattr(emb_mod, "_client", None, raising=False)
    return c


def test_short_input_single_batch(client):
    texts = [f"t{i}" for i in range(7)]
    out = emb_mod.embed(texts)
    assert out is not None
    assert [v[0] for v in out] == [float(i) for i in range(7)]


def test_order_with_length_fingerprint(monkeypatch):
    """用「长度指纹」验证跨批次对齐：全局排序必然把指纹打乱。

    ⚠️ 断言用**精确指纹**（假客户端的向量首维 = 真实文本长度），不用余弦相似度 ——
    真实服务的浮点噪声约 5e-4，会让「相似但不等」的实现蒙混过关。假客户端没有噪声，
    因此这里可以要求严格相等，判定力更强。
    """

    class LenClient:
        def __init__(self) -> None:
            self.calls = []

        @property
        def is_closed(self):
            return False

        def post(self, url, headers=None, json=None, **kw):  # noqa: A002
            batch = json["input"]
            self.calls.append(list(batch))
            # 向量首维 = 真实文本长度（唯一指纹），index 用批内局部值模拟真实服务
            return FakeResponse(
                {
                    "data": [
                        {"index": j, "embedding": [float(len(t)), float(j), 0.0]}
                        for j, t in enumerate(batch)
                    ]
                }
            )

    c = LenClient()
    monkeypatch.setattr(emb_mod, "_get_client", lambda: c)
    monkeypatch.setattr(
        emb_mod,
        "_cfg",
        lambda: {
            "embedding_api_key": "k",
            "embedding_base_url": "https://example.invalid/v1",
            "embedding_model": "m",
        },
    )

    texts = [f"文本{i}" + "。" * i for i in range(25)]  # 长度 3..27，互不相同
    out = emb_mod.embed(texts)
    assert out is not None
    assert len(out) == 25

    mismatch = [i for i, t in enumerate(texts) if out[i][0] != float(len(t))]
    assert mismatch == [], (
        f"第 {mismatch[:8]} 条的向量不属于对应文本 —— 分批顺序错位（跨批次 index 重复所致）"
    )
    assert len(c.calls) == 3, "25 条应分 3 批"


def test_count_mismatch_degrades_to_none(monkeypatch):
    """服务端少返回条数时必须降级为 None，而不是错位拼接。"""

    class ShortClient:
        @property
        def is_closed(self):
            return False

        def post(self, url, headers=None, json=None, **kw):  # noqa: A002
            batch = json["input"]
            # 故意少返回一条
            return FakeResponse(
                {"data": [{"index": j, "embedding": [0.0]} for j in range(len(batch) - 1)]}
            )

    monkeypatch.setattr(emb_mod, "_get_client", lambda: ShortClient())
    monkeypatch.setattr(
        emb_mod,
        "_cfg",
        lambda: {
            "embedding_api_key": "k",
            "embedding_base_url": "https://example.invalid/v1",
            "embedding_model": "m",
        },
    )
    assert emb_mod.embed([f"t{i}" for i in range(15)]) is None