"""检索问答服务：检索 + LLM 生成（降级为规则式回答）"""
from __future__ import annotations

from typing import Any

from app.services import llm
from app.services.store import search


def answer(query: str, top_k: int = 5) -> dict[str, Any]:
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

    if not hits:
        answer_text = "未能从知识库中找到与问题相关的内容，请尝试换一种问法或补充更多文档。"
        return {"answer": answer_text, "citations": citations}

    # 优先用 LLM 生成
    contexts = [h["text"] for h in hits]
    llm_answer = llm.generate(query, contexts)
    if llm_answer:
        answer_text = llm_answer
    else:
        # 降级：规则式拼接
        top = hits[0]
        answer_text = (
            f"根据知识库中的「{top['title']}」，找到以下相关内容：\n\n"
            f"{top['text'][:300]}"
        )
        if len(hits) > 1:
            answer_text += f"\n\n（共命中 {len(hits)} 个相关片段）"

    return {"answer": answer_text, "citations": citations}
