"""LLM 服务：OpenAI 兼容接口，未配置 API key 时降级为 None
失败时抛出 LLMError（含 status + 错误体），供上层透传给前端。"""
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


class LLMError(Exception):
    """LLM 调用失败（HTTP 非 2xx 或网络异常），status=-1 表示网络异常。"""

    def __init__(self, status: int, detail: str):
        self.status = status
        self.detail = detail
        super().__init__(f"LLM {status}: {detail}")


def _cfg() -> dict:
    """每次调用时动态读取配置（支持运行时更换 key/供应商）。"""
    return ai_config()


def available() -> bool:
    return bool(_cfg().get("llm_api_key"))


# 视觉（图片理解）能力判断：按模型名关键词粗略识别
_VISION_KEYWORDS = (
    "vision", "-vl", "gpt-4o", "gpt-4.1", "gpt-4.5", "gpt-5", "o1", "o3", "o4",
    "gemini", "claude", "glm-4v", "glm-4.1v", "glm-4.5v", "qwen2-vl",
    "qwen2.5-vl", "qwen3-vl", "doubao", "hunyuan-vision", "minimax",
)


def supports_vision() -> bool:
    """判断当前配置的模型是否支持视觉（图片）输入。"""
    m = (_cfg().get("llm_model") or "").lower()
    return any(k in m for k in _VISION_KEYWORDS)


def _url() -> str:
    base = (_cfg().get("llm_base_url") or "").rstrip("/")
    if not base:
        raise LLMError(-1, "Base URL 未配置")
    return f"{base}/chat/completions"


def _auth_header() -> dict:
    key = _cfg().get("llm_api_key") or ""
    if not key:
        raise LLMError(-1, "API Key 未配置")
    return {"Authorization": f"Bearer {key}"}


def _model_or_err() -> str:
    m = _cfg().get("llm_model") or ""
    if not m:
        raise LLMError(-1, "模型名未配置")
    return m


def _build_messages(
    query: str,
    contexts: list[str],
    history: list[dict[str, str]],
    images: list[str] | None = None,
) -> list[dict[str, Any]]:
    """构建 messages：有上下文走 RAG 模式，无上下文走普通对话模式；images 提供时走多模态。"""
    images = images or []
    messages: list[dict[str, Any]] = []

    if contexts:
        context_text = "\n\n---\n\n".join(
            f"[{i + 1}] {c}" for i, c in enumerate(contexts)
        )
        messages.append({"role": "system", "content": RAG_SYSTEM_PROMPT})
        messages.extend(history)
        user_text = f"文档片段：\n{context_text}\n\n问题：{query}"
    else:
        messages.append({"role": "system", "content": CHAT_SYSTEM_PROMPT})
        messages.extend(history)
        user_text = query

    if images:
        content: list[dict[str, Any]] = [{"type": "text", "text": user_text}]
        for img in images:
            content.append({"type": "image_url", "image_url": {"url": img}})
        messages.append({"role": "user", "content": content})
    else:
        messages.append({"role": "user", "content": user_text})

    return messages


def _check_response(resp: httpx.Response) -> None:
    if resp.status_code >= 400:
        # 尝试解析 JSON 中的 error.message；否则取前 200 字 body
        detail = ""
        try:
            j = resp.json()
            err = j.get("error") or {}
            detail = err.get("message") or j.get("message") or resp.text
        except Exception:  # noqa: BLE001
            detail = resp.text
        raise LLMError(resp.status_code, (detail or "")[:400])


def generate(
    query: str,
    contexts: list[str],
    history: list[dict[str, str]] | None = None,
) -> str | None:
    """基于检索上下文用 LLM 生成回答；未配置时返回 None；错误时抛出 LLMError。"""
    if not available():
        return None
    history = history or []
    try:
        resp = httpx.post(
            _url(),
            headers=_auth_header(),
            json={
                "model": _model_or_err(),
                "messages": _build_messages(query, contexts, history),
                "temperature": 0.3,
                "max_tokens": 800,
                "stream": False,
            },
            timeout=60.0,
        )
        _check_response(resp)
        data: dict[str, Any] = resp.json()
        content = data["choices"][0]["message"]["content"]
        return content.strip() or None
    except LLMError:
        raise
    except httpx.HTTPError as e:
        raise LLMError(-1, f"网络异常: {e}") from e
    except (KeyError, IndexError, json.JSONDecodeError) as e:
        raise LLMError(-1, f"响应解析失败: {e}") from e


def summarize(text: str) -> str | None:
    """用 LLM 生成文档摘要；未配置时返回 None；错误时抛出 LLMError。"""
    if not available():
        return None
    prompt = (
        "请用 2~3 句简洁的中文总结下面文档的核心内容，"
        "不要出现「本文」「该文档」等指代词，直接输出摘要：\n\n"
        f"{text[:4000]}"
    )
    try:
        resp = httpx.post(
            _url(),
            headers=_auth_header(),
            json={
                "model": _model_or_err(),
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
        _check_response(resp)
        data: dict[str, Any] = resp.json()
        return (data["choices"][0]["message"]["content"] or "").strip() or None
    except LLMError:
        raise
    except httpx.HTTPError as e:
        raise LLMError(-1, f"网络异常: {e}") from e
    except (KeyError, IndexError, json.JSONDecodeError) as e:
        raise LLMError(-1, f"响应解析失败: {e}") from e


# AI 写作辅助：action → (system prompt, user prompt 模板)
_ASSIST_ACTIONS: dict[str, dict[str, str]] = {
    "polish": {
        "system": "你是中文写作润色助手，只输出润色后的文本，不要解释。",
        "user": "请润色下面的文字，使其更通顺、专业、表达更清晰，保持原意不变，直接输出润色结果：\n\n{text}",
    },
    "translate_en": {
        "system": "你是专业翻译助手，只输出译文，不要解释。",
        "user": "请把下面的中文翻译成地道的英文，直接输出译文：\n\n{text}",
    },
    "translate_zh": {
        "system": "你是专业翻译助手，只输出译文，不要解释。",
        "user": "请把下面的英文（或其他语言）翻译成地道、自然的中文，直接输出译文：\n\n{text}",
    },
    "summarize": {
        "system": "你是总结助手，只输出总结内容，不要解释。",
        "user": "请用简洁的中文总结下面的内容，直接输出总结：\n\n{text}",
    },
    "continue": {
        "system": "你是写作续写助手，只输出续写内容，不要解释。",
        "user": "请自然地续写下面的文字，保持语气和风格一致，直接输出续写内容（不要重复原文）：\n\n{text}",
    },
    "explain": {
        "system": "你是通俗解释助手，用通俗易懂的中文解释概念。",
        "user": "请用通俗易懂的语言解释下面这段内容，让非专业人士也能看懂，直接输出解释：\n\n{text}",
    },
}


def assist(action: str, text: str) -> str | None:
    """AI 写作辅助（润色/翻译/总结/续写/解释）；未配置或未知 action 返回 None；错误抛 LLMError。"""
    if not available():
        return None
    spec = _ASSIST_ACTIONS.get(action)
    if not spec:
        return None
    text = (text or "").strip()
    if not text:
        return None
    try:
        resp = httpx.post(
            _url(),
            headers=_auth_header(),
            json={
                "model": _model_or_err(),
                "messages": [
                    {"role": "system", "content": spec["system"]},
                    {"role": "user", "content": spec["user"].format(text=text[:8000])},
                ],
                "temperature": 0.5,
                "max_tokens": 1200,
                "stream": False,
            },
            timeout=60.0,
        )
        _check_response(resp)
        data: dict[str, Any] = resp.json()
        return (data["choices"][0]["message"]["content"] or "").strip() or None
    except LLMError:
        raise
    except httpx.HTTPError as e:
        raise LLMError(-1, f"网络异常: {e}") from e
    except (KeyError, IndexError, json.JSONDecodeError) as e:
        raise LLMError(-1, f"响应解析失败: {e}") from e


def generate_stream(
    query: str,
    contexts: list[str],
    history: list[dict[str, str]] | None = None,
    images: list[str] | None = None,
) -> Iterator[str]:
    """流式生成，逐段 yield 文本增量；失败时抛 LLMError。"""
    if not available():
        return
    history = history or []

    # 先打开请求；调用方在外层 try/except 接收 LLMError
    try:
        with httpx.stream(
            "POST",
            _url(),
            headers=_auth_header(),
            json={
                "model": _model_or_err(),
                "messages": _build_messages(query, contexts, history, images),
                "temperature": 0.3,
                "max_tokens": 800,
                "stream": True,
            },
            timeout=60.0,
        ) as resp:
            if resp.status_code >= 400:
                detail = ""
                try:
                    j = resp.json()
                    err = j.get("error") or {}
                    detail = err.get("message") or j.get("message") or resp.read().decode("utf-8", errors="ignore")
                except Exception:  # noqa: BLE001
                    detail = resp.read().decode("utf-8", errors="ignore")
                raise LLMError(resp.status_code, (detail or "")[:400])
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
    except LLMError:
        raise
    except (httpx.HTTPError, json.JSONDecodeError) as e:
        raise LLMError(-1, f"流式请求失败: {e}") from e


# ---------- 独立测试 / 拉模型 ----------

def fetch_models(
    base_url: str, api_key: str, timeout: float = 15.0
) -> dict[str, Any]:
    """请求 {base_url}/models，返回 {ok, status, models, detail}。"""
    base = (base_url or "").rstrip("/")
    if not base:
        return {"ok": False, "status": -1, "models": [], "detail": "Base URL 不能为空"}
    if not api_key:
        return {"ok": False, "status": -1, "models": [], "detail": "API Key 不能为空"}
    try:
        resp = httpx.get(
            f"{base}/models",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=timeout,
        )
    except httpx.HTTPError as e:
        return {"ok": False, "status": -1, "models": [], "detail": f"网络异常: {e}"}
    if resp.status_code >= 400:
        detail = ""
        try:
            j = resp.json()
            err = j.get("error") or {}
            detail = err.get("message") or j.get("message") or resp.text
        except Exception:  # noqa: BLE001
            detail = resp.text
        return {
            "ok": False,
            "status": resp.status_code,
            "models": [],
            "detail": (detail or "")[:400],
        }
    try:
        j = resp.json()
        items = j.get("data") or j.get("models") or []
        models = [
            (m.get("id") if isinstance(m, dict) else str(m))
            for m in items
            if (isinstance(m, dict) and m.get("id")) or m
        ]
        return {"ok": True, "status": resp.status_code, "models": models, "detail": ""}
    except Exception as e:  # noqa: BLE001
        return {
            "ok": False,
            "status": resp.status_code,
            "models": [],
            "detail": f"响应解析失败: {e}",
        }


def test_connection(
    base_url: str,
    api_key: str,
    model: str = "",
    timeout: float = 30.0,
) -> dict[str, Any]:
    """用一个小对话请求测试连通性，返回 {ok, status, detail, content}。"""
    base = (base_url or "").rstrip("/")
    if not base:
        return {"ok": False, "status": -1, "detail": "Base URL 不能为空", "content": ""}
    if not api_key:
        return {"ok": False, "status": -1, "detail": "API Key 不能为空", "content": ""}
    if not model:
        model = _model_or_err() if available() else ""
    if not model:
        return {
            "ok": False,
            "status": -1,
            "detail": "模型名必填（先填模型，或点「获取模型列表」选择）",
            "content": "",
        }
    try:
        resp = httpx.post(
            f"{base}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}"},
            json={
                "model": model,
                "messages": [{"role": "user", "content": "ping"}],
                "max_tokens": 8,
                "temperature": 0,
                "stream": False,
            },
            timeout=timeout,
        )
    except httpx.HTTPError as e:
        return {"ok": False, "status": -1, "detail": f"网络异常: {e}", "content": ""}
    if resp.status_code >= 400:
        detail = ""
        try:
            j = resp.json()
            err = j.get("error") or {}
            detail = err.get("message") or j.get("message") or resp.text
        except Exception:  # noqa: BLE001
            detail = resp.text
        return {
            "ok": False,
            "status": resp.status_code,
            "detail": (detail or "")[:400],
            "content": "",
        }
    try:
        j = resp.json()
        content = (j["choices"][0]["message"]["content"] or "").strip()
        return {
            "ok": True,
            "status": resp.status_code,
            "detail": "",
            "content": content,
        }
    except Exception as e:  # noqa: BLE001
        return {
            "ok": False,
            "status": resp.status_code,
            "detail": f"响应解析失败: {e}",
            "content": "",
        }
