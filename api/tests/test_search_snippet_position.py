"""搜索片段的**选位** —— 应落在「命中最密集」处，而不是第一个命中点。

**缺陷背景（2026-10-13 实测，非推测）**

原实现取「正文里**最早**出现的命中词」作为 snippet 中心。实测 464 条结果，
**293 条（63%）的密集窗口命中数明显高于首命中所在窗口**。极端例：

    20 万字符的「openEuler安全配置基线」搜「日志」：
        首命中在 @13063（全文 6% 处），周围仅 1 次命中；密集窗口有 14 次
    「故障处理」搜 nginx：
        首命中在 @10441/17081（61% 处），周围 1 次；密集窗 11 次

→ **首命中常常落在目录 / 引言 / 顺带提及处**，不是真正讨论该主题的地方。

**断言为什么这样设计**

只断「snippet 非空 / 含命中词」是**恒真**的（改前改后都成立）。
必须构造「稀疏在前、密集在后」的文档，断言 snippet **落在密集区** ——
两种实现（取首个 / 取最密集）会产出**可区分**的结果。断言基于
`snippet 在原文中的位置`，而不是文本内容相似度。
"""

from __future__ import annotations

from app.api.routes import _make_snippet

# ---------------------------------------------------------------- 夹具
# 刻意构造：关键词「磁盘」在开头稀疏出现（像目录/引言），在结尾密集出现（像正题）
_HEAD = "目录\n磁盘概述\n其他章节\n磁盘简介\n"  # 2 次，位置很靠前
_BODY = "无关内容。" * 60  # 把两段拉开
_DENSE = "磁盘分区 磁盘格式化 磁盘挂载 磁盘配额 磁盘修复 " * 12  # 密集区

_FIXTURE = _HEAD + _BODY + _DENSE


def _first_hit_index(text: str, term: str) -> int:
    return text.find(term)


def _densest_window_first_index(text: str, term: str, window: int = 200) -> int:
    """独立复算「最密集窗口内的首个命中」（不复用被测实现，避免自证）。"""
    pos, start = [], 0
    while True:
        i = text.find(term, start)
        if i < 0:
            break
        pos.append(i)
        start = i + 1
    if not pos:
        return -1
    best_count, best_first, left = 0, pos[0], 0
    for right in range(len(pos)):
        while pos[right] - pos[left] >= window:
            left += 1
        if right - left + 1 > best_count:
            best_count = right - left + 1
            best_first = pos[left]
    return best_first


class _FakeStore:
    def __init__(self, docs):
        self._docs = docs

    def all(self, kb_id=None, user_id=None, with_chunks=False):
        return list(self._docs)


def _doc(text: str, title: str = "测试文档") -> dict:
    return {
        "id": "d1",
        "title": title,
        "text": text,
        "type": "doc",
        "tags": [],
        "created_at": 1.79e9,
        "folder_id": None,
        "kb_id": "kb1",
        "source": "t.md",
    }


def test_snippet_lands_in_densest_region(monkeypatch):
    """核心回归：snippet 必须落在密集区，而不是开头那次稀疏命中。"""
    from app.api import routes

    monkeypatch.setattr(routes, "store", _FakeStore([_doc(_FIXTURE)]))
    out = routes.search_documents(q="磁盘", current_user={"id": "u1"})
    assert out["total"] == 1, out["total"]
    snippet = out["results"][0]["snippet"]

    dense_idx = _densest_window_first_index(_FIXTURE, "磁盘")
    first_idx = _first_hit_index(_FIXTURE, "磁盘")
    assert dense_idx > first_idx + 200, "夹具失效：密集区没有远离首次命中"

    # snippet 的正文部分应能在原文的密集区附近找到（取摘要片段做定位）
    core = snippet.strip("… ").split(" ")[0]
    found = _FIXTURE.find(core)
    assert found >= 0, f"snippet 内容在原文中找不到：{snippet!r}"
    assert found > first_idx + 200, (
        f"snippet 落在开头稀疏区（{found}），应落在密集区（{dense_idx}）：{snippet!r}"
    )


def test_first_hit_not_chosen_when_dense_region_exists(monkeypatch):
    """反向断言：snippet 不得等于「首个命中点起的窗口」内容。

    这条与上一条互补 —— 上一条查「在密集区」，这条明确排除「在首个命中点」。
    """
    from app.api import routes

    monkeypatch.setattr(routes, "store", _FakeStore([_doc(_FIXTURE)]))
    out = routes.search_documents(q="磁盘", current_user={"id": "u1"})
    snippet = out["results"][0]["snippet"]

    idx = _first_hit_index(_FIXTURE, "磁盘")
    assert idx >= 0
    # 首个命中点处的窗口内容（旧实现的产物）
    old_like = _FIXTURE[max(0, idx - 70) : idx + 140]
    # 旧实现产物里的独特词（「目录」「概述」）不应主导新 snippet
    assert not snippet.startswith("…目录"), f"仍在用首个命中点：{snippet!r}"
    assert "磁盘概述" not in snippet, f"仍在用首个命中点：{snippet!r}"


def test_no_hit_in_body_falls_back_to_lead(monkeypatch):
    """正文完全无命中（词只在标题里）→ 走开头兜底分支，不应报错。"""
    from app.api import routes

    monkeypatch.setattr(routes, "store", _FakeStore([_doc("正文没有那个词。", title="磁盘管理")]))
    out = routes.search_documents(q="磁盘", current_user={"id": "u1"})
    assert out["total"] == 1
    assert out["results"][0]["snippet"], "兜底分支不应给出空片段"


def test_dense_selection_handles_overlapping_hits(monkeypatch):
    """重叠命中（如 `aaaa` 里找 `aa`）不应导致死循环或错位。"""
    from app.api.routes import search_documents

    from app.api import routes

    text = "aa" * 300 + "填充" * 200
    monkeypatch.setattr(routes, "store", _FakeStore([_doc(text)]))
    out = search_documents(q="aa", current_user={"id": "u1"})
    assert out["total"] == 1
    assert out["results"][0]["snippet"]


def test_very_frequent_term_is_capped(monkeypatch):
    """极高频词（长文档里上万次命中）不应拖慢或撑爆 —— 实现里有 cap 保护。"""
    import time

    from app.api import routes

    text = "x" * 20_000 + "".join("目标 " for _ in range(8000)) + "x" * 20_000
    monkeypatch.setattr(routes, "store", _FakeStore([_doc(text)]))
    t0 = time.time()
    out = routes.search_documents(q="目标", current_user={"id": "u1"})
    elapsed = time.time() - t0
    assert out["total"] == 1
    assert elapsed < 2.0, f"选位过慢：{elapsed:.2f}s"


def test_snippet_still_clean_after_position_change():
    """选位改动不得破坏上一轮的清洗（两处逻辑耦合，必须一起验）。"""
    import re

    noisy_dense = "```\n## 标题\n| a | b |\n| --- | --- |\n" + "磁盘 " * 30
    text = "磁盘 简介\n" + "无关。" * 100 + noisy_dense
    out = _make_snippet(text, text.index("磁盘", 100), 2)
    assert "```" not in out, out
    assert not re.search(r"-{3,}", out), out
    assert "磁盘" in out, out