"""分享链接密码的哈希化（P0-2 / 安全缺陷 D1）。

原实现：`share_links.password` **明文存储、明文比对**（`password != share["password"]`）。
两个问题：① 库泄露 = 所有分享链接同时失守；② 短路比较有**时序侧信道**。

这组测试锁三件事：
1. 新写入的密码必须是哈希（**不能出现明文**）；
2. 存量明文记录仍能校验通过（不能为了修安全把老链接全废掉）；
3. 存量明文在校验通过后**被升级为哈希**，且升级不重建记录（token 不变）。
"""
import json

import pytest

from app.services import share_password, store as store_mod


# ---------- 纯函数：格式判别与校验 ----------

def test_hashed_value_is_recognized():
    h = share_password.hash_for_storage("s3cret")
    assert share_password.is_hashed(h)
    # 明文绝不能被误判为哈希，否则会走 verify_password 而永远失败
    assert not share_password.is_hashed("s3cret")
    assert not share_password.is_hashed("")
    assert not share_password.is_hashed(None)


def test_hash_is_salted_so_same_password_differs():
    """加盐：同一密码两次哈希必须不同，否则库泄露后彩虹表仍然有效。"""
    a = share_password.hash_for_storage("same-pass")
    b = share_password.hash_for_storage("same-pass")
    assert a != b
    assert share_password.check("same-pass", a)
    assert share_password.check("same-pass", b)


def test_stored_hash_never_contains_plaintext():
    """最核心的断言：库里存的值不得包含明文片段。"""
    plain = "MySuperSecret123"
    h = share_password.hash_for_storage(plain)
    assert plain not in h
    assert h.startswith("pbkdf2$")


def test_check_accepts_correct_and_rejects_wrong():
    h = share_password.hash_for_storage("correct-horse")
    assert share_password.check("correct-horse", h)
    assert not share_password.check("wrong-horse", h)
    assert not share_password.check("", h)
    assert not share_password.check(None, h)


def test_check_rejects_everything_when_no_password_set():
    """没有设置密码的分享，check 必须返回 False（由调用方决定是否放行）。"""
    assert not share_password.check("anything", None)
    assert not share_password.check("anything", "")


# ---------- 存量明文兼容 ----------

def test_legacy_plaintext_still_verifies():
    """兼容分支：旧记录是明文，必须仍能校验通过，否则已发出的链接集体失效。"""
    assert not share_password.is_hashed("legacy-pass")
    assert share_password.check("legacy-pass", "legacy-pass")
    assert not share_password.check("legacy-pass-x", "legacy-pass")


def test_empty_password_on_legacy_is_not_a_pass():
    """⚠️ 关键越权防线：存量明文行**不能**被当成「未设置密码」而放行。"""
    assert not share_password.check("", "legacy-pass")
    assert not share_password.check(None, "legacy-pass")


# ---------- store 层：定向更新密码，不重建记录 ----------

@pytest.fixture()
def json_store(monkeypatch, tmp_path):
    monkeypatch.setattr(store_mod.db, "available", lambda: False)
    path = tmp_path / "store.json"
    path.write_text(json.dumps({
        "documents": [{"id": "d1", "title": "文档", "created_at": 1.79e9, "text": "x", "chunks": []}],
        "folders": [], "kbs": [], "recent": [], "users": [], "shares": [],
        "favorites": [], "share_links": [], "comments": [], "notifications": [],
        "audit_logs": [], "templates": [],
    }))
    monkeypatch.setattr(store_mod, "STORE_FILE", path)
    s = store_mod.DocStore()
    assert s._backend == "json"
    return s


def test_set_share_password_only_touches_password(json_store):
    """就地升级必须只改 password：token/created_at/expires_at 都不能变。

    否则「修安全问题」会顺手把所有已发出的分享链接作废 —— 比原缺陷更糟。
    """
    json_store.create_share("d1", "tok-abc", "plain-pass", 1.79e9 + 86400)
    before = json_store.get_share_by_token("tok-abc")

    json_store.set_share_password("tok-abc", share_password.hash_for_storage("plain-pass"))
    after = json_store.get_share_by_token("tok-abc")

    assert after["token"] == before["token"]
    assert after["created_at"] == before["created_at"]
    assert after["expires_at"] == before["expires_at"]
    assert after["doc_id"] == before["doc_id"]
    # 密码变了，且是哈希
    assert after["password"] != before["password"]
    assert share_password.is_hashed(after["password"])


def test_upgraded_password_still_verifies(json_store):
    """升级后，原密码仍能通过（升级不得破坏可用性）。"""
    json_store.create_share("d1", "tok-abc", "plain-pass")
    json_store.set_share_password("tok-abc", share_password.hash_for_storage("plain-pass"))
    s = json_store.get_share_by_token("tok-abc")
    assert share_password.check("plain-pass", s["password"])
    assert not share_password.check("other", s["password"])


def test_set_share_password_unknown_token_is_noop(json_store):
    json_store.set_share_password("nope", share_password.hash_for_storage("x"))
    assert json_store.get_share_by_token("nope") is None