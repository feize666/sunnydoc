"""搜索排序（route 层）—— 修复「字典序挤掉高相关」的回归测试。

**缺陷背景（实测发现，非推测）**

原排序键是 `(not match_in_title, title.lower())` —— 第二级用了**标题字典序**，
而 `match_count`（正文命中次数）早在结果里算出来了，却从未参与排序。

实测搜「磁盘」命中 57 篇，标题里含「磁盘」的只有 1 篇，于是第 2~10 位
**清一色是 `01-` 开头的低相关文档**（正文只命中 1~3 次），
而真正最相关的（命中 19 / 12 / 11 次）被字典序挤到十名之外。

**为什么断言要打在排序结果上**

只断言「能搜到」是**恒真**的：改前改后都搜得到，测试无法区分。
必须断言**顺序**，且要构造能区分两种实现的数据 ——
即「字典序靠前但相关性低」与「字典序靠后但相关性高」并存。
"""
from __future__ import annotations

from app.api import routes


class FakeStore:
    """返回固定文档集，避免依赖真实数据库。"""

    def __init__(self, docs: list[dict]):
        self._docs = docs

    def all(self, kb_id=None, user_id=None, with_chunks=False):
        return list(self._docs)


def _doc(doc_id: str, title: str, text: str) -> dict:
    return {
        "id": doc_id,
        "title": title,
        "text": text,
        "type": "doc",
        "tags": [],
        "created_at": 1.79e9,
        "folder_id": None,
        "kb_id": "kb1",
        "source": "t.md",
    }


def _titles(results: dict) -> list[str]:
    return [r["title"] for r in results["results"]]


# 三个文档刻意构造成「字典序」与「相关性」相反的形态：
#   - "01-杂项"     标题字典序最靠前，但正文只命中 1 次
#   - "50-高相关"   字典序最靠后，正文命中 30 次
#   - "25-中相关"   字典序居中，正文命中 10 次
# 旧实现（字典序）会得到 01 → 25 → 50；
# 新实现（命中量降序）应得到 50 → 25 → 01。
_DOCS = [
    _doc("d1", "01-杂项", "磁盘 " + "填充 " * 200),
    _doc("d2", "50-高相关", "磁盘 " * 30),
    _doc("d3", "25-中相关", "磁盘 " * 10),
]


def test_body_hit_count_beats_title_alphabetical_order(monkeypatch):
    """核心回归：正文命中多的必须排在字典序靠前但命中少的前面。"""
    monkeypatch.setattr(routes, "store", FakeStore(_DOCS))

    out = routes.search_documents(q="磁盘", current_user={"id": "u1"})

    titles = _titles(out)
    assert titles == ["50-高相关", "25-中相关", "01-杂项"], titles


def test_title_hit_still_outranks_body_hit(monkeypatch):
    """保留原实现的合理内核：标题命中仍是第一优先级。

    标题命中是强信号（几乎必然是用户要找的那篇），不能被「大杂烩长文档」
    的高命中次数挤掉 —— 实测搜 docker 时标题叫「01-常用命令」的杂烩文档
    正文命中 451 次，但该给用户的是标题带 Docker 的那几篇。
    """
    docs = [
        _doc("d1", "无关标题", "磁盘 " * 500),          # 正文命中极多但标题无关
        _doc("d2", "磁盘管理入门", "磁盘 一次"),         # 标题命中，正文命中少
    ]
    monkeypatch.setattr(routes, "store", FakeStore(docs))

    out = routes.search_documents(q="磁盘", current_user={"id": "u1"})
    assert _titles(out) == ["磁盘管理入门", "无关标题"]


def test_match_count_exposed_in_response(monkeypatch):
    """match_count 必须出现在响应里（前端契约 + 排序依据，不可丢）。"""
    monkeypatch.setattr(routes, "store", FakeStore(_DOCS))

    out = routes.search_documents(q="磁盘", current_user={"id": "u1"})
    counts = {r["title"]: r["match_count"] for r in out["results"]}
    assert counts["50-高相关"] == 30
    assert counts["25-中相关"] == 10
    # 排序依据不得泄漏内部字段
    for r in out["results"]:
        assert "_length" not in r, r


def test_sort_created_ignores_relevance(monkeypatch):
    """sort=created 仍按时间倒序（不能被相关性排序污染）。"""
    docs = [
        {**_doc("d1", "01-旧", "磁盘 " * 50), "created_at": 100.0},
        {**_doc("d2", "02-新", "磁盘"), "created_at": 900.0},
    ]
    monkeypatch.setattr(routes, "store", FakeStore(docs))

    out = routes.search_documents(q="磁盘", sort="created", current_user={"id": "u1"})
    assert _titles(out) == ["02-新", "01-旧"]


def test_multi_keyword_requires_all(monkeypatch):
    """多关键词是 AND 语义：任一未命中即排除（保持既有行为）。"""
    docs = [
        _doc("d1", "kvm 磁盘", "两者都有"),
        _doc("d2", "只有kvm", "没有第二个词"),
    ]
    monkeypatch.setattr(routes, "store", FakeStore(docs))

    out = routes.search_documents(q="kvm 磁盘", current_user={"id": "u1"})
    assert _titles(out) == ["kvm 磁盘"]


def test_empty_query_returns_empty(monkeypatch):
    """空查询直接返回空，不遍历文档。"""
    monkeypatch.setattr(routes, "store", FakeStore(_DOCS))
    out = routes.search_documents(q="   ", current_user={"id": "u1"})
    assert out["total"] == 0
    assert out["results"] == []


# ---------------------------------------------------------------------------
# 中文自然语言查询（2026-10-12 新增）
#
# **缺陷背景（实测，非推测）**：`/search` 原先把**整个查询串**当一个词做子串匹配，
# 而中文书写习惯不加空格 → 「虚拟机怎么开机」要求文档里原样出现这 7 个连续汉字
# → 实测返回 **0 条**；仅插入一个空格（「虚拟机 开机」）就返回 11 条。
# 同一知识库同一问题：侧栏搜索 0 条，AI 问答却有 5 条引用
# （`store.search` 用了 jieba 分词，`/search` 没用 —— 又一个「算好了没用上」）。
#
# **断言为什么这样设计**：只断「能搜到」会被历史数据满足（恒真风险）；
# 必须构造**只有分词匹配才能命中**的数据 —— 文档里刻意**不出现**整串，
# 只出现两个词。这样旧实现（整串匹配）必然 0 条、新实现必然命中，可区分。
# ---------------------------------------------------------------------------

_CJK_DOCS = [
    # 文档里**没有**「虚拟机怎么开机」这个整串，只有分开的「虚拟机」和「开机」
    _doc("c1", "运维手册", "虚拟机 的日常维护：开机 前检查磁盘，关机 后清理缓存。" * 3),
    _doc("c2", "无关文档", "这里没有任何相关词汇，只有一点别的记录。"),
]


def test_cjk_query_without_spaces_matches_tokenized_words(monkeypatch):
    """核心回归：无空格中文查询必须能命中（旧实现此处恒为 0 条）。"""
    monkeypatch.setattr(routes, "store", FakeStore(_CJK_DOCS))
    out = routes.search_documents(q="虚拟机怎么开机", current_user={"id": "u1"})
    titles = _titles(out)
    assert titles == ["运维手册"], titles


def test_cjk_query_returns_terms_for_highlight(monkeypatch):
    """必须回传 terms —— 前端用它高亮，否则会「有结果但零高亮」。

    文档里不存在整串，所以用原始查询串高亮必然高亮不到任何东西。
    """
    monkeypatch.setattr(routes, "store", FakeStore(_CJK_DOCS))
    out = routes.search_documents(q="虚拟机怎么开机", current_user={"id": "u1"})
    assert "terms" in out, "响应必须带 terms（前端高亮契约）"
    terms = out["terms"]
    assert "虚拟机" in terms and "开机" in terms, terms
    # 整串不应作为高亮词出现（它在文档里根本不存在）
    assert "虚拟机怎么开机" not in terms, terms


def test_spaced_and_unspaced_cjk_agree(monkeypatch):
    """带空格与不带空格的同义查询应得到一致结果（这正是原先的最大怪异点）。"""
    monkeypatch.setattr(routes, "store", FakeStore(_CJK_DOCS))
    a = _titles(routes.search_documents(q="虚拟机怎么开机", current_user={"id": "u1"}))
    b = _titles(routes.search_documents(q="虚拟机 开机", current_user={"id": "u1"}))
    assert a == b == ["运维手册"], (a, b)


def test_ascii_identifier_not_shredded(monkeypatch):
    """英文标识符必须精确匹配，不能被 jieba 切成碎片做 OR。

    修复过程中一度对所有片段都分词 OR → 实测 `/dev/sda` 从精确匹配膨胀到 **124 条**
    （`dev` 命中 development 之类）、`vt-x` 涨到 **20 条**（`vt`）。
    这里构造「只有碎片、没有完整标识符」的文档，确保它**不被命中**。
    """
    docs = [
        _doc("d1", "含完整标识符", "执行 vt-x 检查虚拟化支持"),
        _doc("d2", "只有碎片", "development 环境里有 vt 两个字但无完整标识符"),
    ]
    monkeypatch.setattr(routes, "store", FakeStore(docs))
    out = routes.search_documents(q="vt-x", current_user={"id": "u1"})
    assert _titles(out) == ["含完整标识符"], _titles(out)
    assert out["terms"] == ["vt-x"], out["terms"]


def test_quoted_phrase_stays_exact(monkeypatch):
    """引号包裹的片段整段作为一个词（原样匹配的显式途径）。"""
    monkeypatch.setattr(routes, "store", FakeStore(_CJK_DOCS))
    out = routes.search_documents(q='"虚拟机 的日常"', current_user={"id": "u1"})
    assert _titles(out) == ["运维手册"], _titles(out)