"""系统设置存储（键值）：PostgreSQL 优先，JSON 文件降级。

独立于 store.py，仅依赖 db + config，避免与 embedding/rerank/llm 形成循环导入。
value 统一存 JSON 字符串；db 后端走 settings 表，JSON 后端走 DATA_DIR/settings.json。
"""
from __future__ import annotations

import json
import threading
from typing import Any

from app.core.config import DATA_DIR
from app.services import db

_SETTINGS_FILE = DATA_DIR / "settings.json"
_lock = threading.Lock()

# 进程内缓存（db 与 json 后端共用，减少重复读盘/查库）
_cache: dict[str, str] | None = None


def _json_all() -> dict[str, str]:
    if _SETTINGS_FILE.exists():
        try:
            data = json.loads(_SETTINGS_FILE.read_text("utf-8"))
            if isinstance(data, dict):
                return data
        except (json.JSONDecodeError, OSError):
            pass
    return {}


def _load_cache() -> dict[str, str]:
    global _cache
    if _cache is not None:
        return _cache
    if db.available():
        _cache = {}
    else:
        _cache = _json_all()
    return _cache


def get(key: str) -> str | None:
    """读取单个设置项（返回 JSON 字符串），无则 None。"""
    with _lock:
        if db.available():
            return db.get_setting(key)
        return _load_cache().get(key)


def set(key: str, value: str) -> None:
    """写入/覆盖单个设置项。"""
    with _lock:
        if db.available():
            db.set_setting(key, value)
        else:
            _load_cache()[key] = value
            _SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
            _SETTINGS_FILE.write_text(
                json.dumps(_load_cache(), ensure_ascii=False, indent=2), "utf-8"
            )


def get_json(key: str, default: Any = None) -> Any:
    """读取并反序列化 JSON 设置项。"""
    raw = get(key)
    if raw is None:
        return default
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return default


def set_json(key: str, value: Any) -> None:
    """序列化并写入 JSON 设置项。"""
    set(key, json.dumps(value, ensure_ascii=False))
