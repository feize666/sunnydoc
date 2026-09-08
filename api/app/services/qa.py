"""检索问答服务：检索 + LLM 生成（降级为规则式回答）"""
from __future__ import annotations

from typing import Any

from app.services import llm
from app.services.store import search


def answer(
    query: str,
    top_k: int = 5,
    history: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    history = history or []
    hits = search(query, top_k)
    citations = [
        {
            "doc_id": h["doc_id"],
            "title": h["title"],
            "source": h["source"],
            "segment_index": h["segment_index"],
            "snippet": h["text"][:200],
        }
        for h in hits
    ]

    # 有命中：RAG 模式，用检索上下文让 LLM 生成
    if hits:
        contexts = [h["text"] for h in hits]
        llm_answer = llm.generate(query, contexts, history)
        if llm_answer:
            return {"answer": llm_answer, "citations": citations}
        # 降级：规则式拼接
        top = hits[0]
        answer_text = (
            f"根据知识库中的「{top['title']}」，找到以下相关内容：\n\n"
            f"{top['text'][:300]}"
        )
        if len(hits) > 1:
            answer_text += f"\n\n（共命中 {len(hits)} 个相关片段）"
        return {"answer": answer_text, "citations": citations}

    # 无命中：让 LLM 普通对话回答（寒暄、通用问题等），无 LLM 才返回"未找到"
    if llm.available():
        llm_answer = llm.generate(query, [], history)
        if llm_answer:
            return {"answer": llm_answer, "citations": []}

    return {
        "answer": "未能从知识库中找到与问题相关的内容，请尝试换一种问法或补充更多文档。",
        "citations": [],
    }
