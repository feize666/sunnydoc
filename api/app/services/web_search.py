"""联网搜索服务：DashScope 原生接口（enable_search），返回答案 + 来源链接"""
from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any

import httpx

from app.core.config import LLM_API_KEY, LLM_MODEL

# DashScope 原生 text-generation 接口（联网搜索 + 来源需走这个，不走 OpenAI 兼容）
WEB_SEARCH_URL = "https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation"


def available() -> bool:
    return bool(LLM_API_KEY)


def _build_payload(query: str, history: list[dict[str, str]]) -> dict[str, Any]:
    messages: list[dict[str, str]] = []
    messages.append(
        {"role": "system", "content": "你是 sunnydoc 知识库助手，可以联网搜索实时信息回答用户问题。"}
    )
    messages.extend(history)
    messages.append({"role": "user", "content": query})
    return {
        "model": LLM_MODEL,
        "input": {"messages": messages},
        "parameters": {
            "enable_search": True,
            "search_options": {"search_strategy": "agent", "enable_source": True},
            "result_format": "message",
            "incremental_output": True,
        },
    }


def _headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {LLM_API_KEY}",
        "X-DashScope-SSE": "enable",
    }


def search_stream(
    query: str, history: list[dict[str, str]]
) -> Iterator[dict[str, Any]]:
    """流式联网搜索，逐段 yield {'type': 'delta'|'sources', ...}"""
    if not available():
        return

    emitted_sources = False
    try:
        with httpx.stream(
            "POST",
            WEB_SEARCH_URL,
            headers=_headers(),
            json=_build_payload(query, history),
            timeout=60.0,
        ) as resp:
            resp.raise_for_status()
            for line in resp.iter_lines():
                if not line or not line.startswith("data:"):
                    continue
                data_str = line[5:].strip()
                try:
                    d = json.loads(data_str)
                except json.JSONDecodeError:
                    continue
                out = d.get("output", {}) if isinstance(d, dict) else {}

                # 来源（可能出现在任意 chunk，发一次即可）
                if not emitted_sources:
                    si = out.get("search_info", {})
                    results = si.get("search_results", [])
                    if results:
                        sources = [
                            {"title": r.get("title", ""), "url": r.get("url", "")}
                            for r in results
                            if r.get("url")
                        ]
                        if sources:
                            emitted_sources = True
                            yield {"type": "sources", "sources": sources}

                # 增量文本
                choices = out.get("choices", [])
                if choices:
                    content = choices[0].get("message", {}).get("content", "")
                    if content:
                        yield {"type": "delta", "content": content}
    except (httpx.HTTPError, json.JSONDecodeError):
        return
