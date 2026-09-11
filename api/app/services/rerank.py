"""Rerank 服务：qwen3-rerank 精排（OpenAI 兼容接口，未配置时降级为 None）"""
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


def rerank(
    query: str, documents: list[str], top_n: int
) -> list[tuple[int, float]] | None:
    """对候选文档精排，返回 [(原索引, 相关分数)] 按分数降序；未配置或失败返回 None"""
    if not available():
        return None
    if not documents:
        return None

    payload = {
        "model": _cfg().get("rerank_model"),
        "query": query,
        "documents": documents,
        "top_n": min(top_n, len(documents)),
    }

    try:
        resp = httpx.post(
            f"{_cfg().get('rerank_base_url', '').rstrip('/')}/reranks",
            headers={"Authorization": f"Bearer {_cfg().get('embedding_api_key')}"},
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
