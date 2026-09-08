"""Embedding 服务：OpenAI 兼容接口，未配置时降级为 None"""
from __future__ import annotations

import json
from typing import Any

import httpx

from app.core.config import EMBEDDING_API_KEY, EMBEDDING_BASE_URL, EMBEDDING_MODEL


def available() -> bool:
    return bool(EMBEDDING_API_KEY)


def embed(texts: list[str]) -> list[list[float]] | None:
    """批量向量化；未配置或失败时返回 None"""
    if not available():
        return None
    if not texts:
        return None

    payload = {"model": EMBEDDING_MODEL, "input": texts}
    try:
        resp = httpx.post(
            f"{EMBEDDING_BASE_URL.rstrip('/')}/embeddings",
            headers={"Authorization": f"Bearer {EMBEDDING_API_KEY}"},
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
