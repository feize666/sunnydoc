"""store 纯函数单元测试：分词、分段、余弦相似度。"""
from app.services.store import _tokenize, _segment, _cosine


def test_tokenize_basic():
    tokens = _tokenize("Redis 是内存数据库")
    assert "redis" in tokens
    assert any(t in tokens for t in ("内存", "数据库", "内存数据库"))


def test_tokenize_filters_stopwords():
    # 「的」「是」等停用词应被过滤
    tokens = _tokenize("这是的")
    assert "的" not in tokens
    assert "是" not in tokens


def test_tokenize_lowercase():
    tokens = _tokenize("Redis")
    assert "redis" in tokens


def test_segment_short_paras():
    chunks = _segment("第一段\n\n第二段")
    assert chunks == ["第一段", "第二段"]


def test_segment_long_para_splits():
    # 超长段落应被切成多片（按句子边界）
    long_text = "。" * 500 + "结束"
    chunks = _segment(long_text, size=100)
    assert len(chunks) > 1
    # 每片不超过 size + 一定余量
    assert all(len(c) <= 200 for c in chunks)


def test_segment_empty():
    assert _segment("") == []
    assert _segment("   \n\n  ") == []


def test_cosine_identical():
    assert abs(_cosine([1, 2, 3], [1, 2, 3]) - 1.0) < 1e-9


def test_cosine_orthogonal():
    assert abs(_cosine([1, 0], [0, 1])) < 1e-9


def test_cosine_zero_vector():
    assert _cosine([0, 0], [1, 1]) == 0.0
