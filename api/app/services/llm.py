"""LLM 服务：OpenAI 兼容接口，未配置 API key 时降级为 None"""
from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any

import httpx

from app.core.config import LLM_API_KEY, LLM_BASE_URL, LLM_MODEL

RAG_SYSTEM_PROMPT = (
    "你是 sunnydoc 知识库问答助手。请严格根据提供的文档片段回答问题。\n"
    "要求：\n"
    "1. 只依据给定片段作答，不要编造片段中没有的信息；\n"
    "2. 回答简洁、准确，使用中文；\n"
    "3. 如果片段不足以回答，请明确说明「知识库中未找到相关内容」。"
)

CHAT_SYSTEM_PROMPT = (
    "你是 sunnydoc 知识库助手，可以回答用户的各类问题。"
    "回答简洁、友好，使用中文。"
)


def available() -> bool:
    return bool(LLM_API_KEY)


def _build_messages(
    query: str, contexts: list[str], history: list[dict[str, str]]
) -> list[dict[str, str]]:
    """构建 messages：有上下文走 RAG 模式，无上下文走普通对话模式"""
    messages: list[dict[str, str]] = []

    if contexts:
        context_text = "\n\n---\n\n".join(
            f"[{i + 1}] {c}" for i, c in enumerate(contexts)
        )
        messages.append({"role": "system", "content": RAG_SYSTEM_PROMPT})
        # 追加历史（role 已是 user/assistant）
        messages.extend(history)
        messages.append(
            {"role": "user", "content": f"文档片段：\n{context_text}\n\n问题：{query}"}
        )
    else:
        messages.append({"role": "system", "content": CHAT_SYSTEM_PROMPT})
        messages.extend(history)
        messages.append({"role": "user", "content": query})

    return messages


def _build_payload(
    query: str,
    contexts: list[str],
    history: list[dict[str, str]],
    stream: bool,
) -> dict[str, Any]:
    return {
        "model": LLM_MODEL,
        "messages": _build_messages(query, contexts, history),
        "temperature": 0.3,
        "max_tokens": 800,
        "stream": stream,
    }


def generate(
    query: str,
    contexts: list[str],
    history: list[dict[str, str]] | None = None,
) -> str | None:
    """基于检索上下文用 LLM 生成回答；未配置时返回 None"""
    if not available():
        return None
    history = history or []

    try:
        resp = httpx.post(
            f"{LLM_BASE_URL.rstrip('/')}/chat/completions",
            headers={"Authorization": f"Bearer {LLM_API_KEY}"},
            json=_build_payload(query, contexts, history, stream=False),
            timeout=60.0,
        )
        resp.raise_for_status()
        data: dict[str, Any] = resp.json()
        content = data["choices"][0]["message"]["content"]
        return content.strip() or None
    except (httpx.HTTPError, KeyError, IndexError, json.JSONDecodeError):
        # 任何异常都降级，不影响主流程
        return None


def generate_stream(
    query: str,
    contexts: list[str],
    history: list[dict[str, str]] | None = None,
) -> Iterator[str]:
    """流式生成，逐段 yield 文本增量；失败时 yield 空（由调用方降级）"""
    if not available():
        return
    history = history or []

    try:
        with httpx.stream(
            "POST",
            f"{LLM_BASE_URL.rstrip('/')}/chat/completions",
            headers={"Authorization": f"Bearer {LLM_API_KEY}"},
            json=_build_payload(query, contexts, history, stream=True),
            timeout=60.0,
        ) as resp:
            resp.raise_for_status()
            for line in resp.iter_lines():
                if not line or not line.startswith("data:"):
                    continue
                data_str = line[5:].strip()
                if data_str == "[DONE]":
                    break
                try:
                    chunk = json.loads(data_str)
                    delta = chunk["choices"][0].get("delta", {})
                    content = delta.get("content")
                    if content:
                        yield content
                except (json.JSONDecodeError, KeyError, IndexError):
                    continue
    except (httpx.HTTPError, json.JSONDecodeError):
        return
