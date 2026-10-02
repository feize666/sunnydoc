"""分享接口（route 层）的密码行为 —— P0-2 的关键闭环。

纯函数测试（`test_share_password.py`）只证明「校验逻辑对」；
但验收标准要求的是**端到端的行为**：
  「新旧两种记录均能正常校验通过，且**旧记录在校验后被升级**」。

这里直接驱动 `routes.get_shared_doc` / `routes.create_share`，
用一个假的 store 记录调用 —— 明确断言「升级动作真的发生了」，而不是只看「返回 200」。
"""
import pytest
from fastapi import HTTPException

from app.api import routes
from app.services import share_password


class FakeStore:
    """记录调用的假 store。"""

    def __init__(self, share, doc=None):
        self._share = share
        self._doc = doc if doc is not None else {
            "id": "d1", "title": "文档", "text": "正文", "created_at": 1.79e9,
        }
        self.set_password_calls: list[tuple[str, str | None]] = []
        self.created: list[tuple] = []

    def get_share_by_token(self, token):
        if self._share and self._share["token"] == token:
            return dict(self._share)
        return None

    def get_share_by_doc(self, doc_id):
        return None

    def get(self, doc_id, user_id=None):
        return self._doc

    def set_share_password(self, token, password):
        self.set_password_calls.append((token, password))
        self._share["password"] = password

    def create_share(self, doc_id, token, password, expires_at):
        self.created.append((doc_id, token, password, expires_at))


def _legacy_share(password="old-pass"):
    return {"token": "t1", "doc_id": "d1", "password": password, "expires_at": None}


# ---------- 存量明文：校验通过 + 就地升级 ----------

def test_legacy_plaintext_verifies_and_is_upgraded(monkeypatch):
    """核心验收：旧明文记录能访问，**并且被升级成哈希**。"""
    fake = FakeStore(_legacy_share())
    monkeypatch.setattr(routes, "store", fake)

    out = routes.get_shared_doc("t1", password="old-pass")

    assert out["id"] == "d1"
    # 升级动作必须真的发生
    assert len(fake.set_password_calls) == 1
    token, new_value = fake.set_password_calls[0]
    assert token == "t1"
    assert share_password.is_hashed(new_value)
    assert "old-pass" not in new_value
    # 升级后原密码仍可用
    assert share_password.check("old-pass", new_value)


def test_legacy_plaintext_wrong_password_is_rejected_without_upgrade(monkeypatch):
    """密码错误 → 401，且**不得**触发升级（否则会把错的密码哈希进去，永久锁死链接）。"""
    fake = FakeStore(_legacy_share())
    monkeypatch.setattr(routes, "store", fake)

    with pytest.raises(HTTPException) as ei:
        routes.get_shared_doc("t1", password="wrong")
    assert ei.value.status_code == 401
    assert fake.set_password_calls == []
    assert fake._share["password"] == "old-pass"


def test_legacy_plaintext_missing_password_is_rejected(monkeypatch):
    fake = FakeStore(_legacy_share())
    monkeypatch.setattr(routes, "store", fake)
    with pytest.raises(HTTPException) as ei:
        routes.get_shared_doc("t1")
    assert ei.value.status_code == 401
    assert fake.set_password_calls == []


def test_upgrade_failure_does_not_block_access(monkeypatch):
    """升级是内部维护动作：DB 抖动不得表现成「密码错误」。"""
    fake = FakeStore(_legacy_share())

    def boom(token, password):
        raise RuntimeError("db down")

    monkeypatch.setattr(fake, "set_share_password", boom)
    monkeypatch.setattr(routes, "store", fake)

    out = routes.get_shared_doc("t1", password="old-pass")
    assert out["id"] == "d1"


# ---------- 已哈希记录：不再重复升级 ----------

def test_hashed_share_verifies_without_reupgrade(monkeypatch):
    """已是哈希的记录：校验通过，且**不应**再写一次库（避免每次访问都重算 pbkdf2）。"""
    h = share_password.hash_for_storage("new-pass")
    fake = FakeStore({"token": "t2", "doc_id": "d1", "password": h, "expires_at": None})
    monkeypatch.setattr(routes, "store", fake)

    out = routes.get_shared_doc("t2", password="new-pass")
    assert out["id"] == "d1"
    assert fake.set_password_calls == []


def test_hashed_share_wrong_password_401(monkeypatch):
    h = share_password.hash_for_storage("new-pass")
    fake = FakeStore({"token": "t2", "doc_id": "d1", "password": h, "expires_at": None})
    monkeypatch.setattr(routes, "store", fake)
    with pytest.raises(HTTPException) as ei:
        routes.get_shared_doc("t2", password="nope")
    assert ei.value.status_code == 401


# ---------- 无密码 / 过期 / 不存在 ----------

def test_share_without_password_is_open(monkeypatch):
    fake = FakeStore({"token": "t3", "doc_id": "d1", "password": None, "expires_at": None})
    monkeypatch.setattr(routes, "store", fake)
    assert routes.get_shared_doc("t3")["id"] == "d1"
    assert fake.set_password_calls == []


def test_expired_share_returns_410(monkeypatch):
    fake = FakeStore({"token": "t4", "doc_id": "d1", "password": None, "expires_at": 1.0})
    monkeypatch.setattr(routes, "store", fake)
    with pytest.raises(HTTPException) as ei:
        routes.get_shared_doc("t4")
    assert ei.value.status_code == 410


def test_unknown_token_returns_404(monkeypatch):
    fake = FakeStore(None)
    monkeypatch.setattr(routes, "store", fake)
    with pytest.raises(HTTPException) as ei:
        routes.get_shared_doc("nope")
    assert ei.value.status_code == 404


# ---------- 创建路径：入库必为哈希 ----------

def test_create_share_stores_hash_not_plaintext(monkeypatch):
    """创建时入参是明文，但**入库值必须是哈希**。"""
    fake = FakeStore(None)
    monkeypatch.setattr(routes, "store", fake)

    out = routes.create_share(
        "d1", {"password": "plain-123"}, current_user={"id": "u1"}
    )
    assert out["token"]
    # 响应回传明文（创建者要发给对方），但库里存的不是明文
    assert out["password"] == "plain-123"
    assert len(fake.created) == 1
    _, _token, stored, _exp = fake.created[0]
    assert stored != "plain-123"
    assert share_password.is_hashed(stored)
    assert share_password.check("plain-123", stored)


def test_create_share_without_password_stores_none(monkeypatch):
    fake = FakeStore(None)
    monkeypatch.setattr(routes, "store", fake)
    routes.create_share("d1", {}, current_user={"id": "u1"})
    assert fake.created[0][2] is None


# ---------- 复用已有链接时不得泄露哈希 ----------

def test_reusing_existing_share_does_not_leak_hash(monkeypatch):
    """复用分支若回传 existing["password"]，等于把可离线爆破的哈希送到浏览器。"""
    h = share_password.hash_for_storage("secret")
    fake = FakeStore({"token": "t9", "doc_id": "d1", "password": h, "expires_at": None})
    monkeypatch.setattr(fake, "get_share_by_doc", lambda doc_id: dict(fake._share))
    monkeypatch.setattr(routes, "store", fake)

    out = routes.create_share("d1", {}, current_user={"id": "u1"})
    assert out["token"] == "t9"
    assert out["password"] is None
    assert h not in str(out)


# ---------- 撤销分享的所有权校验（原为越权漏洞） ----------

class RevokeStore:
    """`store.get` 按 user_id 决定可见性，模拟真实的所有权/知识库权限模型。"""

    def __init__(self, visible_to: set[str]):
        self.visible_to = visible_to
        self.deleted: list[str] = []

    def get(self, doc_id, user_id=None):
        if user_id is None:
            return None
        if user_id in self.visible_to:
            return {"id": doc_id, "title": "文档", "text": "", "created_at": 1.0}
        return None

    def delete_share(self, doc_id):
        self.deleted.append(doc_id)
        return True


def test_revoke_share_rejects_non_owner(monkeypatch):
    """核心断言：读不到该文档的用户**不得**撤销它的分享链接。

    实测过真机越权：用户 B 的 `GET /documents/{id}` 返回 404（完全隔离），
    但 `DELETE /documents/{id}/share` 却返回 200 且记录真的被删。
    """
    fake = RevokeStore(visible_to={"owner"})
    monkeypatch.setattr(routes, "store", fake)

    with pytest.raises(HTTPException) as ei:
        routes.revoke_share("d1", current_user={"id": "intruder", "role": "user"})
    assert ei.value.status_code == 404
    # 必须**没有**发生任何删除
    assert fake.deleted == []


def test_revoke_share_allows_owner(monkeypatch):
    fake = RevokeStore(visible_to={"owner"})
    monkeypatch.setattr(routes, "store", fake)
    assert routes.revoke_share("d1", current_user={"id": "owner", "role": "user"})["ok"] is True
    assert fake.deleted == ["d1"]


def test_revoke_share_allows_admin(monkeypatch):
    """管理员可撤销任意分享（管理场景需要）。"""
    fake = RevokeStore(visible_to=set())
    monkeypatch.setattr(routes, "store", fake)
    out = routes.revoke_share("d1", current_user={"id": "boss", "role": "admin"})
    assert out["ok"] is True
    assert fake.deleted == ["d1"]


def test_revoke_share_allows_kb_collaborator(monkeypatch):
    """对所在知识库有权限的协作者也应可撤销（与 create_share 的判定保持一致）。"""
    fake = RevokeStore(visible_to={"collab"})
    monkeypatch.setattr(routes, "store", fake)
    routes.revoke_share("d1", current_user={"id": "collab", "role": "user"})
    assert fake.deleted == ["d1"]