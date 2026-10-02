"""增量向量化（_build_chunks 的 previous 复用）单元测试。

设计动机：自动保存每 1.5s 就可能触发一次，若每次都全量重算向量，长文档保存
会慢到不可用（实测 13k 字文档 12.6s）。但「复用」有正确性风险 —— 复用错了会让
检索指向错误位置。所以这里不只测「快」，更测「对」：

  1. 内容未变时必须复用（不发网络调用）；
  2. 只改一处时，未受影响的分片向量必须原样保留（逐个比对，不是抽查）；
  3. 新插入的分片必须拿到新向量，不能是 None 或被错配成别人的向量；
  4. 模糊复用不能张冠李戴 —— 语义明显不同的文本绝不能被复用。
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402

from app.services import store as store_mod  # noqa: E402


class FakeEmbedding:
    """假 embedding：记录每次被要求嵌入的文本，返回可预测的确定性向量。

    向量 = [文本长度] 的 3 维扩展，便于断言「这个分片拿到的是它自己的向量」。
    关键在于它**记录调用**，否则「复用生效」无法与「碰巧重算得一样」区分开。
    """

    def __init__(self, available: bool = True) -> None:
        self._available = available
        self.calls: list[list[str]] = []

    def available(self) -> bool:
        return self._available

    def embed(self, texts):
        self.calls.append(list(texts))
        return [[float(len(t)), 1.0, 0.0] for t in texts]


@pytest.fixture()
def fake_emb(monkeypatch):
    fe = FakeEmbedding()
    monkeypatch.setattr(store_mod, "embedding", fe)
    return fe


@pytest.fixture()
def st():
    return store_mod.DocStore.__new__(store_mod.DocStore)


def _text(n: int) -> str:
    """生成 n 个独立段落（每段都 >0 且互不相同）。"""
    return "\n\n".join(f"段落 {i} 的内容，长度足够。" for i in range(n))


# ---------- 基线：不传 previous 时行为不变 ----------

def test_without_previous_embeds_everything(st, fake_emb):
    chunks = st._build_chunks(_text(5))
    assert len(chunks) == 5
    assert len(fake_emb.calls) == 1
    assert len(fake_emb.calls[0]) == 5, "无 previous 时应全量嵌入"
    assert all(c["vector"] for c in chunks)


# ---------- 核心：内容未变 → 零调用 ----------

def test_unchanged_text_makes_no_embedding_call(st, fake_emb):
    """传了相同文本的 previous：应该一次网络调用都不发。"""
    text = _text(5)
    first = st._build_chunks(text)
    fake_emb.calls.clear()

    second = st._build_chunks(text, previous=first)

    assert fake_emb.calls == [], f"内容未变却调用了 embedding：{fake_emb.calls}"
    assert [c["vector"] for c in second] == [c["vector"] for c in first], "向量应原样保留"


# ---------- 核心：局部编辑 → 只嵌变更片段，其余逐个保真 ----------

def test_local_edit_only_embeds_changed_chunk(st, fake_emb):
    """改最后一段：前面 4 段的向量必须逐字节保留，只嵌第 5 段。"""
    text = _text(5)
    first = st._build_chunks(text)
    fake_emb.calls.clear()

    edited = text + "\n\n这是新追加的一段内容，之前不存在。"
    second = st._build_chunks(edited, previous=first)

    assert len(second) == 6, "应多出一个分片"
    # 前 5 段文本未变 → 向量必须与原来完全相同
    for i in range(5):
        assert second[i]["vector"] == first[i]["vector"], f"第 {i} 段向量被无谓重算"
    # 只应该嵌新的那一段
    embedded_texts = [t for call in fake_emb.calls for t in call]
    assert len(embedded_texts) == 1, f"应只嵌 1 条，实际 {len(embedded_texts)}"
    assert "新追加的一段内容" in embedded_texts[0]
    assert second[5]["vector"] is not None, "新分片必须拿到向量"


def test_new_chunk_gets_its_own_vector_not_mismatched(st, fake_emb):
    """新分片的向量必须来自它自己的文本 —— 防止按位置错配。"""
    text = _text(3)
    first = st._build_chunks(text)
    fake_emb.calls.clear()

    new_para = "独一无二的新段落" * 3
    second = st._build_chunks(text + "\n\n" + new_para, previous=first)

    new_chunk = second[-1]
    assert new_chunk["text"] == new_para
    # 假 embedding 的向量首维 = 文本长度，所以能验证「是它自己的」
    assert new_chunk["vector"][0] == float(len(new_para)), (
        f"新分片拿到了别的分片的向量：{new_chunk['vector']}"
    )


# ---------- 安全边界：模糊复用不得张冠李戴 ----------

def test_fuzzy_reuse_rejects_unrelated_text(st, fake_emb):
    """语义完全不同、长度也差很多的新文本，绝不能被复用旧向量。"""
    old_text = "这是一段关于数据库索引的说明文字。" * 5
    first = st._build_chunks(old_text)
    fake_emb.calls.clear()

    # 全新内容，与旧文本无子串关系
    totally_new = "Kubernetes 集群的网络插件选型与调优实践分享。"
    second = st._build_chunks(totally_new, previous=first)

    embedded = [t for call in fake_emb.calls for t in call]
    assert totally_new in embedded, "全新文本必须重新嵌入，不能复用旧向量"
    assert second[0]["vector"][0] == float(len(totally_new))


def test_fuzzy_reuse_accepts_small_shift(st, fake_emb):
    """段落只剩头尾小幅差异（顺移现象）时应复用，省掉重算。"""
    # 构造：新文本 = 旧分片去掉末尾 4 字（长度差在阈值内，且互为子串关系）
    old = "一段足够长的说明文字，用于验证顺移场景下的向量复用。" * 3
    first = st._build_chunks(old)
    assert first, "夹具应产出分片"
    fake_emb.calls.clear()

    # 在开头插入少量文字 → 分片文本变了，但仍是旧文本的超集
    shifted = "补充：" + first[0]["text"]
    second = st._build_chunks(shifted, previous=first)

    embedded = [t for call in fake_emb.calls for t in call]
    assert second[0]["vector"] == first[0]["vector"], "小幅顺移应复用旧向量"
    assert second[0]["text"] not in embedded, "已复用的分片不该再被嵌入"


# ---------- 降级：embedding 不可用时不该崩 ----------

def test_embedding_unavailable_yields_none_vectors(st, monkeypatch):
    fe = FakeEmbedding(available=False)
    monkeypatch.setattr(store_mod, "embedding", fe)

    first = st._build_chunks(_text(3))
    assert all(c["vector"] is None for c in first)

    second = st._build_chunks(_text(3) + "\n\n新增", previous=first)
    assert all(c["vector"] is None for c in second[:3])
    assert fe.calls == [], "不可用时不该发起调用"


def test_previous_without_vectors_is_safe(st, fake_emb):
    """上一版向量为 None（曾降级）时，不能把它当成有效向量复用。"""
    prev = [{"text": "段落 A 的内容，长度足够。", "vector": None}]
    fake_emb.calls.clear()

    out = st._build_chunks("段落 A 的内容，长度足够。", previous=prev)

    embedded = [t for call in fake_emb.calls for t in call]
    assert embedded, "旧向量为 None 时必须重新嵌入，不能复用空向量"
    assert out[0]["vector"] is not None