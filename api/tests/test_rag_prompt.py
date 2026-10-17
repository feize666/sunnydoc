"""引用溯源的两个前提条件（RAG 提示词契约）。

为什么值得单独钉住：引用溯源是产品核心能力之一，但它由**两处约定**共同保证，
任一处回归都会让链路静默失效（回答照常生成、引用列表照常展示，
只是**正文里没有编号、用户不知道哪句话出自哪条片段**）：

  1. 传给 LLM 的片段必须**带序号**（`[1] [2] …`）—— 否则提示词里的「标注编号」无从对应；
  2. 系统提示词必须**明确要求标注编号** —— 否则 LLM 不会主动标（实测：要求缺失时
     回答完全不带 `[N]`，而引用列表有 5 条，看似正常）。

真机脚本 `verify_ai_answer.cjs` 依赖真实 LLM 调用（慢、且受网络与配额影响），
这两个纯函数断言则**零依赖、毫秒级**，适合作为回归的第一道闸。
"""
from app.services.llm import RAG_SYSTEM_PROMPT, _build_messages


def test_rag_prompt_requires_citation_markers():
    """系统提示词必须要求标注引用编号，否则正文不会出现 [N]。"""
    assert "[1]" in RAG_SYSTEM_PROMPT or "编号" in RAG_SYSTEM_PROMPT, (
        "RAG 提示词未要求标注引用编号 → 回答里不会有 [N]，引用溯源在正文侧断链"
    )
    # 明确指向「这是引用溯源的入口」，避免后人把它当装饰删掉
    assert "引用" in RAG_SYSTEM_PROMPT


def test_contexts_are_numbered():
    """传给 LLM 的片段必须带 [1] [2] … 序号，与提示词要求的编号一一对应。"""
    msgs = _build_messages("问题", ["片段甲", "片段乙"], [])
    user = next(m for m in msgs if m["role"] == "user")
    assert "[1] 片段甲" in user["content"], user["content"]
    assert "[2] 片段乙" in user["content"], user["content"]


def test_system_prompt_used_in_rag_mode():
    """有上下文时必须走 RAG 提示词（而不是普通对话提示词）。"""
    msgs = _build_messages("问题", ["片段"], [])
    sys = next(m for m in msgs if m["role"] == "system")
    assert sys["content"] == RAG_SYSTEM_PROMPT


def test_no_contexts_falls_back_to_chat_prompt():
    """无上下文（检索未命中）时走普通对话提示词 —— 两条路径不能混。"""
    msgs = _build_messages("你好", [], [])
    sys = next(m for m in msgs if m["role"] == "system")
    assert sys["content"] != RAG_SYSTEM_PROMPT
    assert "[1]" not in sys["content"]


# ---------- Agent 路径（智能体模式）----------
# 真机实测：AI 面板默认走 **Agent 路径**（先 search_documents 再总结），
# 用的不是 RAG_SYSTEM_PROMPT。只在 RAG 提示词上补引用要求是不够的 ——
# 两条路径都要覆盖，否则会「修了 /chat 但面板里仍然没有编号」。


def test_agent_prompt_requires_citation_markers():
    """Agent 提示词同样必须要求标引用编号（真机走的是这条路径）。"""
    from app.services.agent import AGENT_SYSTEM_PROMPT as P

    assert "[1]" in P, "Agent 提示词未要求标注引用编号 → 面板回答不会有 [N]"
    assert "引用" in P


def test_agent_search_results_carry_index():
    """Agent 的 search_documents 结果必须带 index（编号依据），否则模型无从标号。"""
    import inspect

    from app.services import agent_tools

    src = inspect.getsource(agent_tools._search_documents)
    assert '"index": i + 1' in src, "搜索结果缺少 index 字段 → 模型只能猜编号"