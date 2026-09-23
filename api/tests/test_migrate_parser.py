"""迁移脚本流式解析器测试。

store.json 在启用库存储前可达 GB 级，必须流式解析、不能整文件加载。
这里用内存 JSON 片段验证 iter_section_items 的事件栈逻辑：
分区识别、嵌套数组/对象、标量与 null 的还原。
"""
import io
import json

from scripts.migrate_json_to_pg import iter_section_items


def _collect(raw: dict, wanted: set[str]) -> dict[str, list]:
    """把 JSON 对象编码后交给解析器，按分区聚合结果。"""
    data = json.dumps(raw).encode()
    out: dict[str, list] = {}
    for section, item in iter_section_items(io.BytesIO(data), wanted):
        out.setdefault(section, []).append(item)
    return out


ALL = {"documents", "folders", "kbs", "users", "audit_logs", "templates"}


def test_parses_multiple_sections_in_one_pass():
    raw = {
        "documents": [{"id": "d1", "title": "A", "chunks": []}],
        "folders": [{"id": "f1", "name": "F", "parent_id": None}],
        "kbs": [{"id": "k1", "name": "K", "description": "D"}],
        "users": [{"id": "u1", "username": "x"}],
        "audit_logs": [{"id": "a1", "action": "login"}],
        "templates": [],
    }
    out = _collect(raw, ALL)
    assert len(out["documents"]) == 1
    assert len(out["folders"]) == 1
    assert len(out["kbs"]) == 1
    assert len(out["users"]) == 1
    assert len(out["audit_logs"]) == 1
    assert "templates" not in out  # 空数组不产出元素


def test_preserves_nested_chunks_and_vectors():
    raw = {
        "documents": [
            {
                "id": "d1",
                "title": "T",
                "chunks": [
                    {"text": "a", "vector": [1.0, 2.0, 3.0]},
                    {"text": "b", "vector": None},
                ],
            }
        ]
    }
    out = _collect(raw, ALL)
    chunks = out["documents"][0]["chunks"]
    assert len(chunks) == 2
    assert chunks[0]["text"] == "a"
    assert chunks[0]["vector"] == [1.0, 2.0, 3.0]
    assert chunks[1]["vector"] is None  # None 不能被丢掉或变成字符串


def test_none_values_survive():
    """迁移要保真：null 必须还原成 None，否则写库会变成字符串 'None'。"""
    raw = {"documents": [{"id": "d1", "title": "T", "folder_id": None,
                          "kb_id": None, "summary": None, "chunks": []}]}
    doc = _collect(raw, ALL)["documents"][0]
    assert doc["folder_id"] is None
    assert doc["kb_id"] is None
    assert doc["summary"] is None


def test_nested_objects_preserved():
    raw = {"documents": [{"id": "d1", "meta": {"a": 1, "b": {"c": 2}}, "chunks": []}]}
    doc = _collect(raw, ALL)["documents"][0]
    assert doc["meta"] == {"a": 1, "b": {"c": 2}}


def test_various_scalar_types():
    raw = {"documents": [{"id": "d1", "title": "T", "pinned": True,
                          "sort_order": 1.5, "tags": ["x", "y"], "chunks": []}]}
    doc = _collect(raw, ALL)["documents"][0]
    assert doc["pinned"] is True
    assert doc["sort_order"] == 1.5
    assert doc["tags"] == ["x", "y"]


def test_unwanted_sections_are_skipped():
    raw = {
        "documents": [{"id": "d1", "chunks": []}],
        "settings": {"a": 1},
        "some_other": [{"id": "z"}],
    }
    out = _collect(raw, {"documents"})
    assert list(out.keys()) == ["documents"]


def test_many_items_streamed_in_order():
    raw = {"documents": [{"id": f"d{i}", "chunks": []} for i in range(50)]}
    out = _collect(raw, ALL)
    assert [d["id"] for d in out["documents"]] == [f"d{i}" for i in range(50)]