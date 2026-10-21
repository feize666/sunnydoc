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


# ---------------------------------------------------------------------------
# 登录节流（防在线暴力破解）
# ---------------------------------------------------------------------------
#
# 背景（2026-10-21 审计实测）：登录接口此前**没有任何节流** ——
# 连打 12 次错误密码全部返回 401、总耗时 127ms（约 6000 次/分钟），
# 而密码下限仅 6 位且无复杂度要求 → 弱口令可被高速枚举。
#
# 设计取舍：
# - **指数退避 + 临时锁定**，而不是固定窗口计数器：正常用户偶尔输错不受影响
#   （前 5 次完全放行），只有连续失败才逐步拉长等待。
# - **按「用户名 + 客户端 IP」双键计数**：只按用户名会被拿来**锁死别人账号**
#   （攻击者故意打错密码即可把受害者锁在门外，是典型的「可用性反被利用」）；
#   加上 IP 后，攻击者只能耗尽自己那条键。
# - 进程内 dict，与 `_REVOKED_TOKENS` 同风格，不引入新依赖。
#   ⚠️ 与吊销黑名单同一局限：**多 worker 部署下不共享**，重启即清空。
#   单机自用场景可接受；要上多实例应换成共享存储（Redis）。
#
# 参数（5 次以内完全无感，之后逐级退避）：
#   ≤5   次失败 → 放行
#   6-7  次     → 等 5s
#   8-9  次     → 等 15s
#   10-11 次    → 等 60s
#   ≥12  次     → 锁定 300s
FAIL_FREE_ATTEMPTS = 5
"""低于此次数的连续失败不触发任何等待（正常用户打错密码无感）。"""

FAIL_WINDOW_SECONDS = 900
"""失败计数窗口（15 分钟）。窗口内无新失败则计数自然过期，不必手工清理。"""

_BACKOFF_STEPS: tuple[tuple[int, int], ...] = (
    (6, 5),
    (8, 15),
    (10, 60),
    (12, 300),
)
"""达到指定失败次数后需要等待的秒数（取满足条件的最后一档）。"""

# key -> {fails: 连续失败次数, first: 首次失败时间戳, until: 解锁时间戳}
# 不加锁：与同文件的 `_REVOKED_TOKENS` / `_REVOKED_USERS` 保持一致 ——
# 读改写都在单次 dict 操作内完成，CPython 下足够；此处仅为「节流」，
# 极端并发下多算/少算一次失败不影响安全性（不能变成放行即可）。
_LOGIN_FAILURES: dict[str, dict] = {}


def _backoff_seconds(fails: int) -> int:
    """按连续失败次数返回需要等待的秒数（0 = 放行）。"""
    wait = 0
    for threshold, secs in _BACKOFF_STEPS:
        if fails >= threshold:
            wait = secs
    return wait


def login_throttle_check(key: str) -> int:
    """返回该键还需等待的秒数（0 = 可尝试）。不改变计数。"""
    now = time.time()
    rec = _LOGIN_FAILURES.get(key)
    if not rec:
        return 0
    if now - rec["first"] > FAIL_WINDOW_SECONDS:
        return 0
    until = rec.get("until", 0)
    return max(0, int(until - now)) if until > now else 0


def login_throttle_record_failure(key: str) -> int:
    """记一次失败，返回下次需要等待的秒数。"""
    now = time.time()
    rec = _LOGIN_FAILURES.get(key)
    if not rec or now - rec["first"] > FAIL_WINDOW_SECONDS:
        rec = {"fails": 0, "first": now, "until": 0}
        _LOGIN_FAILURES[key] = rec
    rec["fails"] += 1
    wait = _backoff_seconds(rec["fails"])
    rec["until"] = now + wait if wait else 0
    # 顺手清理过期记录，避免 dict 无限增长（攻击者可用随机用户名刷内存）
    if len(_LOGIN_FAILURES) > 5000:
        dead = [k for k, v in _LOGIN_FAILURES.items() if now - v["first"] > FAIL_WINDOW_SECONDS]
        for k in dead:
            _LOGIN_FAILURES.pop(k, None)
    return wait


def login_throttle_reset(key: str) -> None:
    """登录成功后清除该键的失败记录。"""
    _LOGIN_FAILURES.pop(key, None)
