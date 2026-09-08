"""检索问答服务：MVP 版基于关键词检索 + 规则式回答（后续可接 LLM）"""
from __future__ import annotations

from typing import Any

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
    else:
        # MVP：用命中片段拼接一个基础回答（后续替换为 LLM 生成）
        top = hits[0]
        answer_text = (
            f"根据知识库中的「{top['title']}」，找到以下相关内容：\n\n"
            f"{top['text'][:300]}"
        )
        if len(hits) > 1:
            answer_text += f"\n\n（共命中 {len(hits)} 个相关片段）"

    return {"answer": answer_text, "citations": citations}
