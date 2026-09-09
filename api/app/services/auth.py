"""认证服务：密码哈希 + 内存 token 会话管理。

MVP 采用进程内 token（单 worker 部署），服务重启后需重新登录；
后续可升级为 JWT 或数据库会话表。
"""
from __future__ import annotations

import base64
import hashlib
import secrets
import uuid

# token -> user_id（进程内）
_TOKENS: dict[str, str] = {}

_PBKDF2_ITERATIONS = 100_000


def hash_password(password: str) -> str:
    """生成 pbkdf2(sha256) 密码哈希，格式：pbkdf2$salt_b64$dk_b64"""
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, _PBKDF2_ITERATIONS
    )
    return (
        "pbkdf2$"
        + base64.b64encode(salt).decode()
        + "$"
        + base64.b64encode(dk).decode()
    )


def verify_password(password: str, stored: str) -> bool:
    try:
        _, salt_b64, dk_b64 = stored.split("$")
        salt = base64.b64decode(salt_b64)
        dk = base64.b64decode(dk_b64)
        dk2 = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), salt, _PBKDF2_ITERATIONS
        )
        return secrets.compare_digest(dk, dk2)
    except Exception:  # noqa: BLE001
        return False


def issue_token(user_id: str) -> str:
    token = uuid.uuid4().hex
    _TOKENS[token] = user_id
    return token


def resolve_token(token: str) -> str | None:
    return _TOKENS.get(token)


def revoke_token(token: str) -> None:
    _TOKENS.pop(token, None)


def revoke_all_for_user(user_id: str) -> None:
    """吊销某用户的所有 token（禁用/删除/改密/重置密码后调用）。"""
    for token in [t for t, u in _TOKENS.items() if u == user_id]:
        _TOKENS.pop(token, None)
