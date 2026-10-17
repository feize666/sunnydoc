"""标签重命名/合并/删除的契约测试（P4-2）。

只测 **JSON 降级后端**分支（conftest 已 unset DATABASE_URL）——这条分支
在真机验证里走不到（线上用 db 后端），属于典型「写了但零覆盖」的风险区：
两条分支行为不一致时，只有降级环境下才会暴露，而那时更难排查。

钉住三条不变量：
  1. **合并去重**：文档同时含 旧/新 标签时，结果只有一个（不产生重复徽标）；
  2. **删除不留空串**：`new` 为空串表示删除，文档上不能留下 `[""]`
     （否则前端渲染空徽标、统计里多出一个空标签）；
  3. **不越权**：只改 user_id 自己的文档，不动别人的。
"""
import pytest

from app.services.store import DocStore


class _FakeDB:
    """最小 db 替身：让 DocStore 走 db 分支的判定逻辑返回 False 即可。"""


def _mk_store(docs: list[dict]) -> DocStore:
    """构造一个只含给定文档的 JSON 后端 store（不落盘）。"""
    s = DocStore.__new__(DocStore)
    s._backend = "json"
    s._docs = docs
    s._kbs = []
    s._shares = []
    s._folders = []
    # _accessible_kb_ids → _is_admin 会读 _users；本测试的文档都无 kb_id，
    # 走「自己的个人空间」分支，因此空用户表即可（非管理员）。
    s._users = []
    s._saved = 0

    def _noop_save() -> None:
        s._saved += 1

    s._save = _noop_save  # type: ignore[method-assign]
    return s


def _doc(doc_id: str, tags: list[str], user_id: str = "u1", kb_id=None) -> dict:
    return {
        "id": doc_id,
        "title": doc_id,
        "text": "",
        "tags": list(tags),
        "user_id": user_id,
        "kb_id": kb_id,
        "deleted_at": None,
    }


def test_rename_tag_basic():
    s = _mk_store([_doc("a", ["旧"]), _doc("b", ["旧", "其它"])])
    res = s.rename_tag("旧", "新", "u1")
    assert res["scanned"] == 2 and res["updated"] == 2
    assert s._docs[0]["tags"] == ["新"]
    assert s._docs[1]["tags"] == ["新", "其它"]


def test_merge_dedupes_within_same_doc():
    """文档同时含 旧 与新 时，合并后只能有一个「新」——这是去重的核心断言。"""
    s = _mk_store([_doc("a", ["旧", "新"]), _doc("b", ["旧"])])
    s.rename_tag("旧", "新", "u1")
    assert s._docs[0]["tags"] == ["新"], "合并后不应出现重复标签"
    assert s._docs[1]["tags"] == ["新"]


def test_delete_tag_leaves_no_empty_string():
    """删除（new 为空串）后不能残留 ''，否则前端会渲染一个空徽标。"""
    s = _mk_store([_doc("a", ["待删"]), _doc("b", ["待删", "保留"])])
    res = s.rename_tag("待删", "", "u1")
    assert res["updated"] == 2
    assert s._docs[0]["tags"] == [], "删除后应为空数组，而非 ['']"
    assert s._docs[1]["tags"] == ["保留"]


def test_rename_preserves_order_of_other_tags():
    """非目标标签的相对顺序不能被打乱（避免标签顺序无故跳动）。"""
    s = _mk_store([_doc("a", ["甲", "旧", "乙"])])
    s.rename_tag("旧", "新", "u1")
    assert s._docs[0]["tags"] == ["甲", "新", "乙"]


def test_rename_scoped_to_owner():
    """只改自己的文档，不动他人的。"""
    s = _mk_store([_doc("mine", ["旧"], user_id="u1"), _doc("other", ["旧"], user_id="u2")])
    res = s.rename_tag("旧", "新", "u1")
    assert res["updated"] == 1
    assert s._docs[0]["tags"] == ["新"]
    assert s._docs[1]["tags"] == ["旧"], "他人文档不应被改动"


def test_rename_skips_soft_deleted():
    s = _mk_store([_doc("a", ["旧"]), {**_doc("b", ["旧"]), "deleted_at": 123.0}])
    res = s.rename_tag("旧", "新", "u1")
    assert res["scanned"] == 1
    assert s._docs[1]["tags"] == ["旧"], "已删除文档不应被改写"


def test_rename_noop_when_tag_absent():
    s = _mk_store([_doc("a", ["别的"])])
    res = s.rename_tag("不存在", "新", "u1")
    assert res == {"scanned": 0, "updated": 0, "skipped": 0}
    assert s._saved == 0, "无改动时不应触发落盘"


def test_list_tags_with_count_sorted_desc_then_name():
    """排序约定：篇数降序，篇数相同按名升序（保证结果稳定可测）。"""
    s = _mk_store(
        [
            _doc("a", ["多", "b名"]),
            _doc("b", ["多", "a名"]),
            _doc("c", ["多"]),
        ]
    )
    out = s.list_tags_with_count("u1")
    assert out[0] == {"tag": "多", "count": 3}
    # 篇数相同（都是 1）时按名升序：a名 < b名
    assert [x["tag"] for x in out[1:]] == ["a名", "b名"]