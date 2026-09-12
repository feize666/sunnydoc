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
    c = _cfg()
    return bool(c.get("embedding_api_key") and c.get("embedding_base_url") and c.get("embedding_model"))


def embed(texts: list[str]) -> list[list[float]] | None:
    """批量向量化；未配置或失败时返回 None。

    部分 embedding 服务（如阿里云百炼 text-embedding-v4）限制单次批量 ≤10 条，
    这里按 10 条一批拆分调用，再按 index 合并，保证顺序与输入一致。
    """
    if not available():
        return None
    if not texts:
        return None

    cfg = _cfg()
    url = f"{cfg.get('embedding_base_url', '').rstrip('/')}/embeddings"
    headers = {"Authorization": f"Bearer {cfg.get('embedding_api_key')}"}
    model = cfg.get("embedding_model")

    BATCH_SIZE = 10
    items: list[dict[str, Any]] = []
    try:
        for i in range(0, len(texts), BATCH_SIZE):
            batch = texts[i : i + BATCH_SIZE]
            resp = httpx.post(
                url,
                headers=headers,
                json={"model": model, "input": batch},
                timeout=60.0,
            )
            resp.raise_for_status()
            data: dict[str, Any] = resp.json()
            items.extend(data["data"])
    except (httpx.HTTPError, KeyError, IndexError, json.JSONDecodeError):
        return None

    # 按 index 排序，确保顺序与输入一致
    items.sort(key=lambda x: x["index"])
    return [item["embedding"] for item in items]
