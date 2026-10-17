"""智能体编排：把用户消息 → 工具调用 → 结果回灌 → 最终回答串成一个循环。

## 一轮对话的形状

```
用户消息
  ↓ 带上工具定义 + 系统提示
模型（流式）─── 若只产出文本 ──────────────→ 直接回答，结束
  ↓ 若产出 tool_calls
执行工具（read/write 立即执行；destructive 只登记为「待确认」）
  ↓ 把结果作为 role="tool" 消息回灌
模型（流式）─── 产出最终回答 ─────────────→ 结束
  ↓ 若又调工具（最多 MAX_ROUNDS 轮，防死循环）
重复
```

## 分级执行的实际含义

- `read` / `write`：`agent_tools.execute()` 直接落到 store。
- `destructive`：`execute()` **只解析目标、返回 pending**，不落库；
  编排层把「待确认」事件推给前端，前端弹确认卡片 →
  用户点确认 → 前端调 `/agent/confirm` → 那时才真正执行。

## 权限

`ToolContext.user` 就是当前登录用户，工具内部一律调用带 `user_id` 的 store 方法。
**不因为调用方是 AI 而放宽任何判定**（见 `agent_tools` 的模块说明）。
"""
from __future__ import annotations

from collections.abc import Iterator
from typing import Any

from app.services import agent_tools, llm
from app.services.agent_tools import ToolContext

# 工具循环上限。多步任务（查 → 改 → 确认）通常 2~3 轮，
# 设 5 给复杂任务留余量，同时挡住「模型反复调同一工具」的死循环。
MAX_ROUNDS = 5

AGENT_SYSTEM_PROMPT = """你是 sunnydoc 知识库的智能助手，既能回答问题，也能操作用户的系统。

## 你的能力

1. **回答知识库问题**：先用 search_documents 搜索，再基于结果回答。
2. **执行操作**：可以新建/修改/移动文档、管理文件夹与知识库、查看系统状态。
3. **控制界面**：用 open_document 打开文档、goto_view 切换视图。

## 重要规则

- **需要事实时先搜索，不要凭空回答**。用户问「XX 是什么/怎么做」时，
  先 search_documents，拿到片段后再回答；搜不到就直说没找到。
- **不确定目标时先查再动**。用户说「把那个文档删掉」但没说哪个时，
  先用 search_documents / list_documents 确认唯一目标。
  **有多个候选时必须先问用户是哪一个，不要猜。**
- **id 必须来自工具返回**，不要自己编造。
- **删除类操作**你只需要准备好参数调用即可，系统会弹确认卡片让用户确认
  （你不需要反复询问「确定要删吗」）。
- 🔴 **删除类工具执行后，绝不能说「已删除/已完成」**。工具返回里带
  `pending: true` 时表示**尚未执行**，你只能说「已准备好，请确认」。
  说「已完成」会让用户以为删除生效了 —— 这是严重误导。
- 🔴 **引用必须标号**：基于 `search_documents` 的结果回答时，在依据的句子后标注
  该结果的 `index`，形如 `[1]`、`[1][2]`。**没有编号，用户就不知道哪句话出自
  哪篇文档** —— 引用溯源是产品的核心能力，不能只靠面板上的列表。
- 回答用中文，简洁直接。操作完成后简要说明做了什么。

## 当前上下文

{context}
"""


def _context_block(ctx: ToolContext) -> str:
    """把「用户当前在哪」写进系统提示，让指代消解有依据（如「这个知识库」）。"""
    lines = [f"- 当前用户：{ctx.user.get('nickname') or ctx.user.get('username')}"
             f"（{ctx.user.get('role')}）"]
    if ctx.current_kb_id:
        kb = None
        try:
            from app.services.store import store

            kb = store.get_kb(ctx.current_kb_id, ctx.user["id"])
        except Exception:  # noqa: BLE001
            kb = None
        if kb:
            lines.append(f"- 当前所在知识库：{kb.get('name')}（kb_id={kb['id']}）")
    if ctx.current_doc_id:
        lines.append(f"- 当前打开的文档 doc_id={ctx.current_doc_id}")
    lines.append("- 今天的日期由系统提供，不必推算。")
    return "\n".join(lines)


def _tool_result_message(
    call_id: str, name: str, result: dict[str, Any], level: str = "read"
) -> dict[str, Any]:
    """把工具结果包成 role="tool" 消息。

    ⚠️ 用 `json.dumps(ensure_ascii=False)` 而不是 `str(dict)`：
    后者产出 Python 字面量（`True`/`None`/单引号），模型容易误读为文本。

    🔴 **破坏性操作要额外加「尚未执行」标记**。
    `execute()` 对 destructive 只做校验（返回 `pending=True`），真正的删除在
    `/agent/confirm` 里。若不标注，模型会看到 `ok: true` 就告诉用户「已删除」——
    实测出现过原话「已将标题为 X 的文档移入回收站」，**而库里文档还在**。
    这是会让用户误判的高危误导，必须在数据里显式否定。
    """
    import json

    payload = json.dumps(result, ensure_ascii=False)
    # 截断超长结果（如整篇文档），避免把上下文撑爆导致下一轮报错
    if len(payload) > 8000:
        payload = payload[:8000] + "…(结果过长已截断)"
    if level == "destructive" and result.get("pending"):
        payload += (
            "\n\n⛔ 注意：以上操作【尚未执行】。系统已向用户弹出确认卡片，"
            "只有用户点击确认后才会真正执行。"
            "**你现在绝不能说「已删除/已完成」**，应说明「已准备好，等待你确认」。"
        )
    return {"role": "tool", "tool_call_id": call_id, "name": name, "content": payload}


def run(
    query: str,
    ctx: ToolContext,
    history: list[dict[str, str]] | None = None,
    contexts: list[str] | None = None,
    images: list[str] | None = None,
) -> Iterator[dict[str, Any]]:
    """跑一轮智能体对话，产出事件流。

    事件类型（与前端 SSE 契约一致）：
    - ``{"type": "delta", "content": ...}``     文本增量
    - ``{"type": "tool_call", ...}``            开始调用某工具
    - ``{"type": "tool_result", ...}``          工具执行结果（含 pending 标记）
    - ``{"type": "pending", ...}``              破坏性操作待确认（前端弹卡片）
    """
    import json

    # 组装初始 messages：系统提示 + 历史 + （可选）知识库片段 + 附件 + 当前问题
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": AGENT_SYSTEM_PROMPT.format(context=_context_block(ctx))}
    ]
    messages.extend(history or [])

    user_text = query
    if contexts:
        joined = "\n\n---\n\n".join(f"[{i + 1}] {c}" for i, c in enumerate(contexts))
        user_text = f"知识库检索片段：\n{joined}\n\n用户问题：{query}"
    if images:
        content: list[dict[str, Any]] = [{"type": "text", "text": user_text}]
        for img in images:
            content.append({"type": "image_url", "image_url": {"url": img}})
        messages.append({"role": "user", "content": content})
    else:
        messages.append({"role": "user", "content": user_text})

    specs = agent_tools.specs()
    pending_calls: list[dict[str, Any]] = []

    for round_no in range(MAX_ROUNDS):
        turn: llm.ToolTurn | None = None
        # 流式跑一轮：文本边出边推，工具调用在结尾汇总
        for ev in llm.stream_turn(
            messages, tools=specs, max_tokens=1500 if round_no else 1200
        ):
            if ev["type"] == "delta":
                yield {"type": "delta", "content": ev["content"]}
            elif ev["type"] == "turn":
                turn = ev["turn"]
        if turn is None:
            break

        # 模型没要求调工具 → 这一轮就是最终回答，结束
        if not turn.tool_calls:
            break

        # 记下模型这一轮的 assistant 消息（含 tool_calls），回灌时必需
        messages.append(turn.raw_message)

        for call in turn.tool_calls:
            spec = agent_tools.get_tool(call.name)
            level = spec.level if spec else "read"
            yield {
                "type": "tool_call",
                "id": call.id,
                "name": call.name,
                "level": level,
                "arguments": call.arguments,
            }

            result = agent_tools.execute(call.name, call.arguments, ctx)

            # 破坏性操作：登记待确认，**不落库**
            if level == "destructive" and result.get("ok"):
                # 解析出参数供确认卡片展示（execute 已校验过，这里不会失败）
                try:
                    args = json.loads(call.arguments) if call.arguments else {}
                except json.JSONDecodeError:
                    args = {}
                pending = {
                    "tool": call.name,
                    "arguments": args,
                    "level": "destructive",
                    "summary": _describe(call.name, result),
                }
                pending_calls.append(pending)
                yield {"type": "pending", "id": call.id, **pending}

            yield {
                "type": "tool_result",
                "id": call.id,
                "name": call.name,
                "level": level,
                "ok": bool(result.get("ok")),
                "pending": bool(result.get("pending")),
                "error": result.get("error"),
            }

            # UI 类工具（不改数据）在前端执行，但不回灌给模型 —— 回灌无意义
            if spec is not None and result.get("ui_action"):
                yield {"type": "ui_action", "id": call.id, **result}

            messages.append(_tool_result_message(call.id, call.name, result, level))

        # 若这轮全是 UI 动作且没有待确认项，模型可能还需要总结一句；
        # 若已有 pending，继续下一轮让模型向用户解释「需要你确认」。
        if round_no == MAX_ROUNDS - 1:
            # 触顶：让模型基于已有结果给出结语，避免用户看到悬空的工具调用
            messages.append(
                {
                    "role": "system",
                    "content": "已达到工具调用上限。请基于已有信息给出当前结论，"
                    "并说明还需哪些步骤。",
                }
            )
            for piece in llm.chat_final_stream(messages):
                yield {"type": "delta", "content": piece}
            break

    # 有多个待确认项时，前端需要一次性知道全部
    if pending_calls:
        yield {"type": "pending_all", "pendings": pending_calls}


def _describe(name: str, result: dict[str, Any]) -> str:
    """给确认卡片生成人类可读的一句话（不复用工具返回值里的英文键名）。"""
    label = (
        result.get("title")
        or result.get("name")
        or result.get("username")
        or result.get("label")
        or result.get("doc_id")
        or result.get("folder_id")
        or result.get("kb_id")
        or result.get("obj_id")
        or result.get("user_id")
        or ""
    )
    verbs = {
        "delete_document": "删除文档",
        "delete_folder": "删除文件夹",
        "delete_knowledge_base": "删除知识库",
        "delete_user": "删除用户",
        "purge_trash_item": "彻底删除（不可恢复）",
        "restore_trash_item": "从回收站恢复",
    }
    return f"{verbs.get(name, name)}：{label}" if label else verbs.get(name, name)


def confirm(
    tool_name: str, arguments: dict[str, Any], ctx: ToolContext
) -> dict[str, Any]:
    """用户点「确认」后真正执行破坏性操作。"""
    return agent_tools.commit(tool_name, arguments, ctx)


# ---------------------------------------------------------------------------
# 多轮对话历史压缩
# ---------------------------------------------------------------------------

# 保留最近 N 条消息（约 8 轮问答）。早期内容压成摘要，
# 这样长对话不会因为超出上下文而报错或悄悄丢历史。
HISTORY_KEEP = 12


def compress_history(
    history: list[dict[str, str]], summary: str | None = None
) -> tuple[list[dict[str, str]], str | None]:
    """裁掉过长的对话历史，把更早的部分压成一句摘要。

    返回 ``(要带上的历史, 新的摘要)``。

    ⚠️ 不做「直接丢弃」：用户在第 10 轮问「那刚才那个文档呢」时，
    丢掉的历史会让模型完全失去指代依据。压缩成摘要至少保留主题线索。
    摘要用规则式拼接（不额外调 LLM）—— 在每轮对话里再插一次 LLM 调用
    会让首字延迟明显变长，而收益只是措辞更自然。
    """
    if len(history) <= HISTORY_KEEP:
        return history, summary

    older = history[:-HISTORY_KEEP]
    recent = history[-HISTORY_KEEP:]

    # 只摘「用户问过什么」——这是指代消解最需要的信息
    asks = [
        (m.get("content") or "").strip()
        for m in older
        if m.get("role") == "user" and (m.get("content") or "").strip()
    ]
    if asks:
        # 单条太长会把摘要本身撑大，截断到合理长度
        brief = "；".join(a[:40] for a in asks[-8:])
        line = f"（早先用户问过：{brief}）"
        summary = f"{summary}\n{line}".strip() if summary else line

    out: list[dict[str, str]] = []
    if summary:
        out.append({"role": "system", "content": f"之前的对话摘要：{summary}"})
    out.extend(recent)
    return out, summary