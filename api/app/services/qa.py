"""检索问答服务：检索 + LLM 生成（降级为规则式回答）"""
from __future__ import annotations

from typing import Any

from app.services import llm
from app.services.snippet import build_citations
from app.services.store import search


def _full_texts(hits: list[dict[str, Any]]) -> dict[str, str]:
    """{doc_id: 整篇正文} —— 定位词要靠它判断「命中词是否在代码块内」。

    只看分片不够：`_segment` 按空行/句子切分、不知代码块结构，
    分片边界会截断代码块 → 块内外判断失真（详见 `services/snippet.locate_term`）。
    """
    from app.services.store import store

    out: dict[str, str] = {}
    for h in hits:
        did = h.get("doc_id")
        if not did or did in out:
            continue
        doc = store.get(did)
        if doc:
            out[did] = doc.get("text") or ""
    return out


def _try_generate(
    query: str, contexts: list[str], history: list[dict[str, str]] | None
) -> tuple[str | None, str | None]:
    """调用 LLM 生成，返回 ``(文本, 错误状态)``：成功为 ``(文本, None)``。

    ⚠️ **必须捕获 `LLMError`**：`llm.generate` 只在「未配置 API Key」时返回 None，
    而在**模型不存在 / Key 无效 / 网络异常**时是**抛 `LLMError`** 的（见 llm.py）。
    早先本模块只判返回值 falsy，异常便直穿到路由层 → `/chat` 直接 500
    （实测：配置了账号未开通的模型名时必现）。
    流式路径（`/chat/stream`）早已捕获并降级，此处对齐它，避免两条路径行为分叉。
    """
    try:
        return (llm.generate(query, contexts, history) or None), None
    except llm.LLMError as e:
        # 只把状态码给用户看，detail 可能是英文原始报错，留给日志
        print(f"[问答] ⚠️ LLM 调用失败 status={e.status} detail={e.detail!r}，降级为规则式回答")
        return None, str(e.status)


def _degrade_note(status: str | None) -> str:
    """降级回答的尾注，让用户知道这不是大模型生成的。与流式路径文案保持一致。"""
    return f"\n\n（大模型错误 {status}：已自动降级使用知识库片段）" if status else ""


def answer(
    query: str,
    top_k: int = 5,
    history: list[dict[str, str]] | None = None,
    user_id: str | None = None,
) -> dict[str, Any]:
    history = history or []
    hits = search(query, top_k, user_id)
    # 引用统一走 `services/snippet.build_citations` —— 与 `/chat/stream` 同一实现。
    # 早先这里自己拼引用（只有 doc_id/title/snippet），于是新增的定位词 `terms`
    # 只加到了流式路径上，非流式 `/chat` 的 terms 全为空（真机实测暴露）。
    citations = build_citations(hits, _full_texts(hits))

    # 有命中：RAG 模式，用检索上下文让 LLM 生成
    if hits:
        contexts = [h["text"] for h in hits]
        llm_answer, err = _try_generate(query, contexts, history)
        if llm_answer:
            return {"answer": llm_answer, "citations": citations}
        # 降级：规则式拼接（LLM 未配置或调用失败）
        top = hits[0]
        answer_text = (
            f"根据知识库中的「{top['title']}」，找到以下相关内容：\n\n"
            f"{top['text'][:300]}"
        )
        if len(hits) > 1:
            answer_text += f"\n\n（共命中 {len(hits)} 个相关片段）"
        return {"answer": answer_text + _degrade_note(err), "citations": citations}

    # 无命中：让 LLM 普通对话回答（寒暄、通用问题等），无 LLM 才返回"未找到"
    if llm.available():
        llm_answer, err = _try_generate(query, [], history)
        if llm_answer:
            return {"answer": llm_answer, "citations": []}
        # ⚠️ 这里必须区分「知识库里没有」和「大模型坏了」（否则会误导用户
        # 去补文档）：后者带上状态码，与流式路径一致。
        if err:
            return {
                "answer": "未能在知识库中找到相关内容，且大模型服务暂不可用，无法生成回答。"
                + _degrade_note(err),
                "citations": [],
            }

    return {
        "answer": "未能从知识库中找到与问题相关的内容，请尝试换一种问法或补充更多文档。",
        "citations": [],
    }
