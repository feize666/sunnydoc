"""Embedding 服务：OpenAI 兼容接口，未配置时降级为 None"""
from __future__ import annotations

import json
from typing import Any

import httpx

from app.core.config import ai_config


def _cfg() -> dict:
    """每次调用时动态读取配置。"""
    return ai_config()


def available() -> bool:
    return bool(_cfg().get("embedding_api_key"))


def embed(texts: list[str]) -> list[list[float]] | None:
    """批量向量化；未配置或失败时返回 None"""
    if not available():
        return None
    if not texts:
        return None

    payload = {"model": _cfg().get("embedding_model"), "input": texts}
    try:
        resp = httpx.post(
            f"{_cfg().get('embedding_base_url', '').rstrip('/')}/embeddings",
            headers={"Authorization": f"Bearer {_cfg().get('embedding_api_key')}"},
            json=payload,
            timeout=30.0,
        )
        resp.raise_for_status()
        data: dict[str, Any] = resp.json()
        # 按 index 排序，确保顺序与输入一致
        items = sorted(data["data"], key=lambda x: x["index"])
        return [item["embedding"] for item in items]
    except (httpx.HTTPError, KeyError, IndexError, json.JSONDecodeError):
        return None
