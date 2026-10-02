"""分享链接密码的哈希化存取。

**背景（D1 安全缺陷）**：`share_links.password` 原先**明文存储、明文比对**。
两个问题：① 数据库泄露 = 所有分享链接同时失守；② `password != share["password"]`
是短路比较，存在时序侧信道。

**为什么不直接改字段名**：想让新库一眼看出是哈希，看似该把列改名为 `password_hash`。
但那样存量行会被当成 NULL（旧列被废弃），**所有已发出的分享链接会立刻变成无密码**，
属于"修安全问题反而先造成越权"。所以保留列名 `password`，靠**值前缀**判别：
`pbkdf2$...` = 哈希，其余 = 存量明文。
"""
from __future__ import annotations

import secrets

from app.services.auth import hash_password, verify_password

# 哈希格式的标识前缀。auth.hash_password 产出的是 `pbkdf2$salt$dk`。
# 故意不在本模块硬编码完整格式，只认前缀 —— 格式细节归 auth 管，避免两处各写一份。
_PREFIX = "pbkdf2$"


def is_hashed(stored: str | None) -> bool:
    """判断库里的值是不是哈希（而非存量明文）。"""
    return bool(stored) and stored.startswith(_PREFIX)


def hash_for_storage(plain: str) -> str:
    """入库前把明文密码转成哈希。"""
    return hash_password(plain)


def check(plain: str | None, stored: str | None) -> bool:
    """校验密码。返回 True 表示通过。

    - 无密码的分享（stored 为空）→ 调用方不该走到这里，返回 False 以免误放行。
    - 存量明文 → 走**常量时间**比较（`secrets.compare_digest`），补上原来的时序侧信道。
    - 哈希 → 交给 auth.verify_password（其内部已是 compare_digest）。
    """
    if not stored:
        return False
    if not plain:
        return False
    if is_hashed(stored):
        return verify_password(plain, stored)
    # 存量明文分支。注意这里**故意**不把明文当"未设置密码"处理 ——
    # 那会让旧链接全部敞开，是比原缺陷更严重的越权。
    return secrets.compare_digest(plain, stored)