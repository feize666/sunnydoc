"""LLM 服务：OpenAI 兼容接口，未配置 API key 时降级为 None"""
from __future__ import annotations

import json
from typing import Any

import httpx

from app.core.config import LLM_API_KEY, LLM_BASE_URL, LLM_MODEL


def available() -> bool:
    return bool(LLM_API_KEY)


def generate(query: str, contexts: list[str]) -> str | None:
    """基于检索上下文用 LLM 生成回答；未配置或无结果时返回 None"""
    if not available():
        return None
    if not contexts:
        return None

    context_text = "\n\n---\n\n".join(
        f"[{i + 1}] {c}" for i, c in enumerate(contexts)
    )

    system_prompt = (
        "你是一个知识库问答助手。请严格根据提供的文档片段回答问题。\n"
        "要求：\n"
        "1. 只依据给定片段作答，不要编造片段中没有的信息；\n"
        "2. 回答简洁、准确，使用中文；\n"
        "3. 如果片段不足以回答，请明确说明「知识库中未找到相关内容」。"
    )

    user_prompt = f"文档片段：\n{context_text}\n\n问题：{query}"

    payload = {
        "model": LLM_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.3,
        "max_tokens": 800,
    }

    try:
        resp = httpx.post(
            f"{LLM_BASE_URL.rstrip('/')}/chat/completions",
            headers={"Authorization": f"Bearer {LLM_API_KEY}"},
            json=payload,
            timeout=30.0,
        )
        resp.raise_for_status()
        data: dict[str, Any] = resp.json()
        content = data["choices"][0]["message"]["content"]
        return content.strip() or None
    except (httpx.HTTPError, KeyError, IndexError, json.JSONDecodeError):
        # 任何异常都降级，不影响主流程
        return None
