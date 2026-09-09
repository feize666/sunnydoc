"""认证服务：密码哈希 + JWT（HMAC-SHA256）token 会话管理。

token 采用无状态 JWT（签名 + 过期时间），密钥持久化到 data/secret.key，
因此后端重启后 token 依然有效，无需重新登录。
吊销（登出/改密/禁用/删除）用进程内黑名单实现：重启后黑名单清空，
但 JWT 本身有 7 天过期，属可接受的折中。
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time

from app.core.config import DATA_DIR

_PBKDF2_ITERATIONS = 100_000

# token 有效期（秒）
TOKEN_TTL = 7 * 24 * 3600

# JWT 签名密钥（持久化，重启不变）
_SECRET_FILE = DATA_DIR / "secret.key"

# 进程内吊销黑名单
_REVOKED_TOKENS: set[str] = set()  # 单个 token（登出）
_REVOKED_USERS: dict[str, int] = {}  # user_id -> 吊销时间戳（改密/禁用/删除）


def _load_secret() -> bytes:
    if _SECRET_FILE.exists():
        return _SECRET_FILE.read_bytes()
    secret = secrets.token_bytes(32)
    _SECRET_FILE.parent.mkdir(parents=True, exist_ok=True)
    _SECRET_FILE.write_bytes(secret)
    return secret


_SECRET = _load_secret()


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _b64url_decode(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


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


def _sign(msg: str) -> str:
    return _b64url_encode(hmac.new(_SECRET, msg.encode(), hashlib.sha256).digest())


def issue_token(user_id: str) -> str:
    now = int(time.time())
    header = _b64url_encode(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    payload = _b64url_encode(
        json.dumps({"sub": user_id, "iat": now, "exp": now + TOKEN_TTL}, separators=(",", ":")).encode()
    )
    return f"{header}.{payload}.{_sign(f'{header}.{payload}')}"


def resolve_token(token: str) -> str | None:
    try:
        header, payload, sig = token.split(".")
        if not hmac.compare_digest(_sign(f"{header}.{payload}"), sig):
            return None
        data = json.loads(_b64url_decode(payload))
        if data.get("exp", 0) < time.time():
            return None
        user_id = data["sub"]
        # 单个 token 已吊销（登出）
        if token in _REVOKED_TOKENS:
            return None
        # 该用户在 iat 之后被全量吊销（改密/禁用/删除）
        revoked_at = _REVOKED_USERS.get(user_id)
        if revoked_at is not None and data.get("iat", 0) <= revoked_at:
            return None
        return user_id
    except Exception:  # noqa: BLE001
        return None


def revoke_token(token: str) -> None:
    _REVOKED_TOKENS.add(token)


def revoke_all_for_user(user_id: str) -> None:
    """吊销某用户所有已签发 token（禁用/删除/改密/重置密码后调用）。"""
    _REVOKED_USERS[user_id] = int(time.time())
