"""Rerank 服务：qwen3-rerank 精排（OpenAI 兼容接口，未配置时降级为 None）"""
from __future__ import annotations

import json
from typing import Any

import httpx

from app.core.config import (
    EMBEDDING_API_KEY,
    RERANK_BASE_URL,
    RERANK_MODEL,
)


def available() -> bool:
    return bool(EMBEDDING_API_KEY)


def rerank(
    query: str, documents: list[str], top_n: int
) -> list[tuple[int, float]] | None:
    """对候选文档精排，返回 [(原索引, 相关分数)] 按分数降序；未配置或失败返回 None"""
    if not available():
        return None
    if not documents:
        return None

    payload = {
        "model": RERANK_MODEL,
        "query": query,
        "documents": documents,
        "top_n": min(top_n, len(documents)),
    }

    try:
        resp = httpx.post(
            f"{RERANK_BASE_URL.rstrip('/')}/reranks",
            headers={"Authorization": f"Bearer {EMBEDDING_API_KEY}"},
            json=payload,
            timeout=30.0,
        )
        resp.raise_for_status()
        data: dict[str, Any] = resp.json()
        results = sorted(
            data["results"], key=lambda x: x["relevance_score"], reverse=True
        )
        return [(r["index"], r["relevance_score"]) for r in results]
    except (httpx.HTTPError, KeyError, IndexError, json.JSONDecodeError):
        return None
