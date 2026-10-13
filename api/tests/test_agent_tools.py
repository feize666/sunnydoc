"""智能体工具编排（services 层）—— 分级执行、权限、错误处理的回归测试。

## 为什么这些断言必须存在

工具编排的三条核心约束都是**行为约束**，代码评审看不出来：

1. **`execute()` 对破坏性工具绝不落库**（只校验）。
   只要哪天有人在 handler 里顺手调了一次 `store.delete_*`，
   就会出现「用户还没点确认，东西已经没了」——而这个 bug 在代码里
   **完全看不出来**（一行 `store.delete` 看着很自然）。
2. **越权必须返回 `denied`**，且与「参数错误」区分开。
   否则模型会换个说法反复重试同一件无权做的事。
3. **非法 JSON / 未知工具要可反馈**，不能抛异常中断整轮对话
   （模型需要机会改正参数）。

## 用 FakeStore 而非真实数据库

`monkeypatch.setattr(agent_tools, "store", fake)` —— 理由同 `test_search_ranking.py`：
真实库会让测试依赖数据现状（本次跑完就删掉的对象，下次跑就不在了），
而且**测不出「没调用 delete」**这类断言（真实库删了就真没了）。
"""
from __future__ import annotations

import json

import pytest

from app.services import agent_tools
from app.services.agent_tools import ToolContext, ToolDenied, ToolError


class FakeStore:
    """最小可用的假 store：记录调用、返回可控结果。

    `deleted` 列表是**关键**：破坏性断言就靠「它有没有被碰过」。
    """

    def __init__(self, *, role: str = "admin"):
        self.role = role
        self.deleted: list[tuple[str, str]] = []
        self._docs = {
            "d1": {"id": "d1", "title": "测试文档", "text": "内容", "user_id": "u1", "type": "doc"},
        }
        self._folders = {"f1": {"id": "f1", "name": "测试文件夹", "parent_id": None}}
        self._kbs = {"k1": {"id": "k1", "name": "测试库", "user_id": "u1"}}
        self._users = {
            "u1": {"id": "u1", "username": "me", "nickname": "我", "role": role, "status": "active"},
            "u2": {"id": "u2", "username": "other", "nickname": "别人", "role": "user", "status": "active"},
        }

    # ---- 读 ----
    def get(self, doc_id, user_id=None):
        return self._docs.get(doc_id)

    def all(self, kb_id=None, user_id=None, with_chunks=True):
        return list(self._docs.values())

    def get_kb(self, kb_id, user_id=None):
        return self._kbs.get(kb_id)

    def kb_permission(self, kb_id, user_id):
        return "owner" if kb_id in self._kbs else None

    def count_docs(self, kb_id, user_id=None):
        return 1

    def list_kbs(self, user_id=None):
        return list(self._kbs.values())

    def list_folders(self, kb_id=None, user_id=None):
        return list(self._folders.values())

    def list_users(self):
        return list(self._users.values())

    def get_user_by_id(self, user_id):
        return self._users.get(user_id)

    def list_all_tags(self, user_id=None):
        return []

    def list_trash(self, user_id=None):
        return {"documents": [], "folders": [], "kbs": []}

    def list_recent(self, limit=20, user_id=None):
        return []

    def list_versions(self, doc_id, user_id=None):
        return []

    # ---- 写（破坏性：记录但不真删）----
    def delete(self, doc_id, user_id=None):
        self.deleted.append(("document", doc_id))
        return True

    def delete_folder(self, folder_id, user_id=None):
        self.deleted.append(("folder", folder_id))
        return True

    def delete_kb(self, kb_id, user_id=None):
        self.deleted.append(("kb", kb_id))
        return True

    def delete_user(self, user_id):
        self.deleted.append(("user", user_id))
        return True

    def purge(self, kind, obj_id, user_id=None):
        self.deleted.append(("purge", obj_id))
        return True

    def restore(self, kind, obj_id, user_id=None):
        return True

    # ---- 写（非破坏性）----
    def update(self, doc_id, **kw):
        d = self._docs.get(doc_id)
        if d and "title" in kw:
            d = {**d, "title": kw["title"]}
            self._docs[doc_id] = d
        return d

    def set_tags(self, doc_id, tags):
        return doc_id in self._docs

    def set_pinned(self, doc_id, pinned):
        return doc_id in self._docs

    def add(self, **kw):
        return {"id": "new1", "title": kw.get("title"), "kb_id": kw.get("kb_id")}

    def create_folder(self, name, parent_id=None, kb_id=None, user_id=None):
        return {"id": "nf1", "name": name}

    def rename_folder(self, folder_id, name, user_id=None):
        return {"id": folder_id, "name": name} if folder_id in self._folders else None

    def create_kb(self, name, description=None, user_id=None):
        return {"id": "nk1", "name": name}

    def update_user(self, user_id, **kw):
        u = self._users.get(user_id)
        return {**u, **kw} if u else None


@pytest.fixture
def fake(monkeypatch):
    f = FakeStore()
    monkeypatch.setattr(agent_tools, "store", f)
    return f


def _ctx(role: str = "admin") -> ToolContext:
    return ToolContext(
        user={
            "id": "u1",
            "username": "me",
            "nickname": "我",
            "role": role,
            "status": "active",
        }
    )


# ---------------------------------------------------------------------------
# 分级：read / write 立即执行
# ---------------------------------------------------------------------------


def test_read_tool_executes_immediately(fake):
    r = agent_tools.execute("list_documents", "{}", _ctx())
    assert r["ok"] is True
    assert r["level"] == "read"


def test_write_tool_executes_immediately(fake):
    r = agent_tools.execute("update_document", json.dumps({"doc_id": "d1", "title": "改名"}), _ctx())
    assert r["ok"] is True
    assert r["level"] == "write"
    # write 是**真的落库**（区别于 destructive）
    assert fake._docs["d1"]["title"] == "改名"


# ---------------------------------------------------------------------------
# 🔴 破坏性：execute 绝不落库
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "name,args",
    [
        ("delete_document", {"doc_id": "d1"}),
        ("delete_folder", {"folder_id": "f1"}),
        ("delete_knowledge_base", {"kb_id": "k1"}),
        ("delete_user", {"user_id": "u2"}),
    ],
)
def test_destructive_execute_never_touches_store(fake, name, args):
    """**本文件最重要的一条**：execute 阶段不得调用任何删除方法。

    只要有人在 handler 里写了 `store.delete(...)`，这条立即失败 ——
    而那种写法在代码评审里完全看不出来。
    """
    r = agent_tools.execute(name, json.dumps(args), _ctx())
    assert r["ok"] is True
    assert r["level"] == "destructive"
    assert r.get("pending") is True, "破坏性工具必须返回 pending 标记"
    assert fake.deleted == [], f"execute 阶段不应有任何删除调用，实际：{fake.deleted}"


def test_destructive_result_has_no_done_semantics(fake):
    """返回值里不得含「已完成」语义。

    实测踩过：返回 `action: "已移入回收站"` → 回灌给模型后它告诉用户
    「已将文档移入回收站」，而库里文档还在 —— 高危误导。
    """
    r = agent_tools.execute("delete_document", json.dumps({"doc_id": "d1"}), _ctx())
    blob = json.dumps(r, ensure_ascii=False)
    for bad in ("已删除", "已完成", "已移入", "已彻底"):
        assert bad not in blob, f"返回值含完成语义「{bad}」：{blob}"


def test_commit_actually_deletes(fake):
    """用户确认后才真正落库 —— 与上面的「不落库」成对。"""
    r = agent_tools.commit("delete_document", {"doc_id": "d1"}, _ctx())
    assert r["ok"] is True
    assert ("document", "d1") in fake.deleted


def test_commit_rejects_non_destructive_tool(fake):
    """非破坏性工具不得走 confirm 通道（否则等于多了一条绕过通道）。"""
    with pytest.raises(ToolError):
        agent_tools.commit("update_document", {"doc_id": "d1"}, _ctx())


def test_delete_self_is_blocked(fake):
    """不能删除当前登录账号（会把系统锁死）。"""
    r = agent_tools.execute("delete_user", json.dumps({"user_id": "u1"}), _ctx())
    assert r["ok"] is False
    assert "当前登录账号" in (r.get("error") or "")


# ---------------------------------------------------------------------------
# 权限
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "name,args",
    [
        ("list_users", {}),
        ("get_ai_settings", {}),
        ("delete_user", {"user_id": "u2"}),
    ],
)
def test_admin_tools_denied_for_normal_user(fake, name, args):
    r = agent_tools.execute(name, json.dumps(args), _ctx(role="user"))
    assert r["ok"] is False
    assert r.get("denied") is True, "越权必须标记 denied（不能只靠 error 文案）"
    assert fake.deleted == []


def test_goto_view_settings_denied_for_normal_user(fake):
    r = agent_tools.execute("goto_view", json.dumps({"view": "settings"}), _ctx(role="user"))
    assert r["ok"] is False
    assert r.get("denied") is True


def test_admin_tool_ok_for_admin(fake):
    r = agent_tools.execute("list_users", "{}", _ctx(role="admin"))
    assert r["ok"] is True
    assert r["count"] == 2


def test_update_user_cannot_downgrade_self(fake):
    """不能把自己降级（同样的锁死风险）。"""
    r = agent_tools.execute(
        "update_user", json.dumps({"user_id": "u1", "role": "user"}), _ctx()
    )
    assert r["ok"] is False


def test_update_user_validates_enum(fake):
    r = agent_tools.execute(
        "update_user", json.dumps({"user_id": "u2", "role": "superadmin"}), _ctx()
    )
    assert r["ok"] is False
    assert "admin 或 user" in (r.get("error") or "")


# ---------------------------------------------------------------------------
# 错误处理：必须「可反馈」而非中断
# ---------------------------------------------------------------------------


def test_unknown_tool_returns_error_not_raise(fake):
    r = agent_tools.execute("nonexistent_tool", "{}", _ctx())
    assert r["ok"] is False
    assert "未知工具" in r["error"]


def test_invalid_json_returns_error_not_raise(fake):
    """模型给了坏 JSON 时要能改正重试，不能抛异常炸掉整轮对话。"""
    r = agent_tools.execute("search_documents", "{not json", _ctx())
    assert r["ok"] is False
    assert "JSON" in r["error"]


def test_missing_required_arg_returns_error(fake):
    r = agent_tools.execute("search_documents", "{}", _ctx())
    assert r["ok"] is False
    assert "query" in r["error"]


def test_nonexistent_target_returns_error(fake):
    r = agent_tools.execute("delete_document", json.dumps({"doc_id": "nope"}), _ctx())
    assert r["ok"] is False
    assert "不存在" in r["error"]


def test_invalid_view_rejected(fake):
    r = agent_tools.execute("goto_view", json.dumps({"view": "hack"}), _ctx())
    assert r["ok"] is False


# ---------------------------------------------------------------------------
# 工具目录本身
# ---------------------------------------------------------------------------


def test_registry_levels_are_only_three():
    levels = {t.level for t in agent_tools.all_tools()}
    assert levels <= {"read", "write", "destructive"}


def test_specs_are_openai_compatible():
    for spec in agent_tools.specs():
        assert spec["type"] == "function"
        fn = spec["function"]
        assert fn["name"] and fn["description"]
        assert fn["parameters"]["type"] == "object"


def test_tool_names_unique():
    names = [t.name for t in agent_tools.all_tools()]
    assert len(names) == len(set(names))


def test_ui_tools_return_action_not_mutate(fake):
    """界面工具只返回指令，不改数据。"""
    r = agent_tools.execute("open_document", json.dumps({"doc_id": "d1"}), _ctx())
    assert r["ok"] is True
    assert r.get("ui_action") == "open_document"
    assert fake.deleted == []