"""JSON 降级后端下 DocStore.update() 的行为契约。

背景（真 bug，由 P0 提交 9fa1d10 引入）：
`updated_at` 只在 content_changed 时刷新，判定式写在 `if self._backend == "db"`
分支内；但同一个名字又在 JSON 分支里被引用 → **JSON 降级路径每次 update 都抛
UnboundLocalError**。而 `PUT /documents/{id}` 正是走 store.update()，
所以数据库不可用时「改标题/改正文/拖拽」会全线 500。

为什么没被发现：conftest.py 里 pop 掉 DATABASE_URL 后，测试只覆盖了
_tokenize/_segment/_cosine 这些纯函数，没有任何用例真正构造过 DocStore 的
JSON 实例并调 update()。
"""
import json
import pathlib

import pytest

from app.services import store as store_mod


@pytest.fixture()
def json_store(monkeypatch, tmp_path):
    """构造一个走 JSON 降级后端的 DocStore（不碰真实 store.json）。"""
    monkeypatch.setattr(store_mod.db, "available", lambda: False)
    path = tmp_path / "store.json"
    now = 1.79e9  # created_at 级量纲，模拟真实冷备份
    path.write_text(
        json.dumps(
            {
                "documents": [
                    {"id": "d1", "title": "最早", "created_at": now - 3000, "text": "a", "chunks": []},
                    {"id": "d2", "title": "居中", "created_at": now - 2000, "text": "b", "chunks": []},
                    {"id": "d3", "title": "最新", "created_at": now - 1000, "text": "c", "chunks": []},
                ],
                "folders": [],
                "kbs": [],
                "recent": [],
                "users": [],
                "shares": [],
                "favorites": [],
                "share_links": [],
                "comments": [],
                "notifications": [],
                "audit_logs": [],
                "templates": [],
            }
        )
    )
    monkeypatch.setattr(store_mod, "STORE_FILE", path)
    s = store_mod.DocStore()
    assert s._backend == "json"
    return s


def _by_id(s, doc_id):
    return next(d for d in s._docs if d["id"] == doc_id)


def test_update_sort_order_only_does_not_raise(json_store):
    """只改 sort_order（拖拽落点）不得抛异常 —— 这正是曾经崩掉的那条路径。"""
    got = json_store.update("d1", sort_order=1234.0)
    assert got is not None
    assert _by_id(json_store, "d1")["sort_order"] == 1234.0


def test_update_title_only_does_not_raise(json_store):
    got = json_store.update("d2", title="改名了")
    assert got is not None
    assert _by_id(json_store, "d2")["title"] == "改名了"


def test_update_with_no_content_change_keeps_updated_at(json_store):
    """拖拽排序不该改变「最后修改时间」，否则「按更新时间排序」会被一次拖动打乱。"""
    before = _by_id(json_store, "d2").get("updated_at")
    json_store.update("d2", sort_order=999.0, folder_id="fx")
    assert _by_id(json_store, "d2").get("updated_at") == before


def test_update_with_content_change_refreshes_updated_at(json_store):
    """真正改了正文才刷新 updated_at。"""
    before = _by_id(json_store, "d2").get("updated_at")
    json_store.update("d2", text="换了一段完全不同的正文")
    after = _by_id(json_store, "d2").get("updated_at")
    assert after is not None and after != before


def test_update_title_change_counts_as_content_change(json_store):
    """改标题也算内容变化（与 db 分支的判定保持一致）。"""
    before = _by_id(json_store, "d2").get("updated_at")
    json_store.update("d2", title="标题也变了")
    after = _by_id(json_store, "d2").get("updated_at")
    assert after is not None and after != before


def test_update_unknown_doc_returns_none(json_store):
    assert json_store.update("nope", title="x") is None


def test_json_load_falls_back_to_created_at_magnitude(json_store):
    """JSON 冷备份的坐标空间是 legacy（created_at）。

    兜底必须是 created_at 本身，而不是 0.0 —— 因为该文件里**所有**行都是
    legacy 量纲，兜底只要留在同一坐标空间，相对顺序就正确。
    （DB 表则相反：那里已被重播种成 1024 网格，兜底必须是 0.0。
     同一句兜底，在两个后端正确的答案相反。）
    """
    for d in json_store._docs:
        assert d["sort_order"] == d["created_at"]
    order = [d["title"] for d in sorted(json_store._docs, key=lambda d: d["sort_order"])]
    assert order == ["最早", "居中", "最新"]