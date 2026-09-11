"""LLM 服务：OpenAI 兼容接口，未配置 API key 时降级为 None"""
from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any

import httpx

from app.core.config import ai_config

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


def _cfg() -> dict:
    """每次调用时动态读取配置（支持运行时更换 key/供应商）。"""
    return ai_config()


def available() -> bool:
    return bool(_cfg().get("llm_api_key"))


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
        "model": _cfg().get("llm_model"),
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
            f"{_cfg().get('llm_base_url', '').rstrip('/')}/chat/completions",
            headers={"Authorization": f"Bearer {_cfg().get('llm_api_key')}"},
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


def summarize(text: str) -> str | None:
    """用 LLM 生成文档摘要；未配置时返回 None。"""
    if not available():
        return None
    prompt = (
        "请用 2~3 句简洁的中文总结下面文档的核心内容，"
        "不要出现「本文」「该文档」等指代词，直接输出摘要：\n\n"
        f"{text[:4000]}"
    )
    try:
        resp = httpx.post(
            f"{_cfg().get('llm_base_url', '').rstrip('/')}/chat/completions",
            headers={"Authorization": f"Bearer {_cfg().get('llm_api_key')}"},
            json={
                "model": _cfg().get("llm_model"),
                "messages": [
                    {"role": "system", "content": "你是文档摘要助手，只输出简洁准确的中文摘要。"},
                    {"role": "user", "content": prompt},
                ],
                "temperature": 0.3,
                "max_tokens": 200,
                "stream": False,
            },
            timeout=60.0,
        )
        resp.raise_for_status()
        data: dict[str, Any] = resp.json()
        return (data["choices"][0]["message"]["content"] or "").strip() or None
    except (httpx.HTTPError, KeyError, IndexError, json.JSONDecodeError):
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
            f"{_cfg().get('llm_base_url', '').rstrip('/')}/chat/completions",
            headers={"Authorization": f"Bearer {_cfg().get('llm_api_key')}"},
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
