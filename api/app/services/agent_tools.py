"""智能体工具注册表：把系统的能力收敛成一组语义化工具，供对话式操作调用。

## 为什么要有这一层

后端有 94 个 HTTP 接口（33 GET / 41 POST / 9 PUT / 11 DELETE）。
若把每个接口都暴露成工具，模型会面对一个过大的选择空间
（工具太多时**选择准确率会下降**，且大量接口是同一动作的不同视图）。

本模块把它们收敛成 **~24 个语义化工具**，每个对应一个「用户想做的事」，
而不是一个 HTTP 端点。

## 分级执行（用户已确认的策略）

| 级别 | 行为 |
|---|---|
| `read` | AI 直接执行，结果回灌给模型 |
| `write` | AI 直接执行，并在对话里提示已做 |
| `destructive` | **不执行**，返回「待确认」→ 前端弹确认卡片 → 用户确认后才执行 |

## 🔴 安全底线

**权限一律继承当前用户，不存在「AI 有超级权限」这回事。**
每个工具都收到 `ctx.user`（当前登录用户），并调用 `store` 的**带 user_id 的方法**，
由 store 内部做属主/知识库权限判定 —— 与 HTTP 接口走同一套授权，
**不因为调用方是 AI 就放宽**。

管理员类工具（`list_users` / `update_user` / `update_ai_settings`）额外用
`_require_admin(ctx)` 校验，与 `require_admin` 依赖同一条件（`role == "admin"`）。

## 与 UI 导航工具的配合

`open_document` / `goto_view` 不改变数据，只返回一个「界面指令」，
由前端执行（复用阶段 3 的 `useViewStack`）。
这让「对话操作整个系统」既有数据动作，也有界面动作。
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Callable

from app.services import llm
from app.services.store import search as search_hits
from app.services.store import store

# ---------------------------------------------------------------------------
# 上下文
# ---------------------------------------------------------------------------


@dataclass
class ToolContext:
    """一次工具调用所需的上下文。**权限来源是 user，不是「AI 身份」。**"""

    user: dict[str, Any]
    # 当前所在知识库/文档（供「打开这篇」「在这个知识库里建」等指代消解）
    current_kb_id: str | None = None
    current_doc_id: str | None = None

    @property
    def is_admin(self) -> bool:
        return self.user.get("role") == "admin"


class ToolDenied(Exception):
    """权限不足。**必须与「参数错误」区分**，否则模型会反复重试同一个越权调用。"""


class ToolError(Exception):
    """参数或业务错误（文档不存在、名称重复等）。"""


# ---------------------------------------------------------------------------
# 工具定义
# ---------------------------------------------------------------------------


@dataclass
class AgentTool:
    name: str
    description: str
    parameters: dict[str, Any]
    level: str  # read | write | destructive
    handler: Callable[[dict[str, Any], ToolContext], dict[str, Any]]

    def spec(self) -> dict[str, Any]:
        """OpenAI 兼容的 function 定义。"""
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }


_REGISTRY: dict[str, AgentTool] = {}


def tool(
    name: str,
    description: str,
    parameters: dict[str, Any],
    level: str = "read",
) -> Callable:
    """注册装饰器。保持手写顺序 = 给模型的顺序（重要工具排前面）。"""

    def deco(fn: Callable) -> Callable:
        _REGISTRY[name] = AgentTool(
            name=name,
            description=description,
            parameters=parameters,
            level=level,
            handler=fn,
        )
        return fn

    return deco


def all_tools() -> list[AgentTool]:
    return list(_REGISTRY.values())


def get_tool(name: str) -> AgentTool | None:
    return _REGISTRY.get(name)


def specs() -> list[dict[str, Any]]:
    return [t.spec() for t in all_tools()]


def _require_admin(ctx: ToolContext) -> None:
    if not ctx.is_admin:
        raise ToolDenied("该操作需要管理员权限")


def _obj(properties: dict[str, Any], required: list[str] | None = None) -> dict[str, Any]:
    return {"type": "object", "properties": properties, "required": required or []}


_S = {"type": "string"}
_B = {"type": "boolean"}
_I = {"type": "integer"}


# ===========================================================================
# 一、检索与阅读（read）
# ===========================================================================


@tool(
    "search_documents",
    "在知识库中搜索文档，返回标题、摘要与文档 id。用户问「找一下 X」「有没有关于 X 的文档」时使用。",
    _obj({"query": {**_S, "description": "搜索关键词，可用空格分隔多个词"}}, ["query"]),
    level="read",
)
def _search_documents(args: dict[str, Any], ctx: ToolContext) -> dict[str, Any]:
    q = (args.get("query") or "").strip()
    if not q:
        raise ToolError("query 不能为空")
    hits = search_hits(q, int(args.get("top_k") or 5), ctx.user["id"])
    return {
        "count": len(hits),
        "results": [
            {
                "doc_id": h["doc_id"],
                "title": h["title"],
                "snippet": (h.get("text") or "")[:200],
                "score": round(float(h.get("score") or 0), 3),
            }
            for h in hits
        ],
    }


@tool(
    "get_document",
    "读取一篇文档的完整正文（可按段落截取）。需要看文档完整内容、总结、改写时使用。",
    _obj(
        {
            "doc_id": {**_S, "description": "文档 id"},
            "max_chars": {**_I, "description": "最多返回多少字符，默认 4000"},
        },
        ["doc_id"],
    ),
    level="read",
)
def _get_document(args: dict[str, Any], ctx: ToolContext) -> dict[str, Any]:
    doc_id = (args.get("doc_id") or "").strip()
    doc = store.get(doc_id, ctx.user["id"])
    if doc is None:
        raise ToolError(f"文档不存在或无权访问：{doc_id}")
    limit = max(200, min(int(args.get("max_chars") or 4000), 20000))
    text = doc.get("text") or ""
    return {
        "doc_id": doc_id,
        "title": doc.get("title"),
        "type": doc.get("type", "doc"),
        "folder_id": doc.get("folder_id"),
        "kb_id": doc.get("kb_id"),
        "tags": doc.get("tags") or [],
        "length": len(text),
        "truncated": len(text) > limit,
        "content": text[:limit],
    }


@tool(
    "list_documents",
    "列出文档（可按知识库、文件夹、标签过滤）。用户问「有哪些文档」「这个知识库里有什么」时使用。",
    _obj(
        {
            "kb_id": {**_S, "description": "限定知识库 id，省略则列全部可见文档"},
            "folder_id": {**_S, "description": "限定文件夹 id"},
            "tag": {**_S, "description": "按标签过滤"},
            "limit": {**_I, "description": "最多返回条数，默认 50"},
        }
    ),
    level="read",
)
def _list_documents(args: dict[str, Any], ctx: ToolContext) -> dict[str, Any]:
    kb_id = (args.get("kb_id") or "").strip() or None
    folder_id = (args.get("folder_id") or "").strip() or None
    tag = (args.get("tag") or "").strip() or None
    limit = max(1, min(int(args.get("limit") or 50), 200))
    docs = store.all(kb_id, ctx.user["id"], with_chunks=False)
    if folder_id:
        docs = [d for d in docs if d.get("folder_id") == folder_id]
    if tag:
        docs = [d for d in docs if tag in (d.get("tags") or [])]
    docs.sort(key=lambda d: d.get("updated_at") or d.get("created_at") or 0, reverse=True)
    return {
        "count": len(docs),
        "documents": [
            {
                "doc_id": d["id"],
                "title": d.get("title"),
                "type": d.get("type", "doc"),
                "folder_id": d.get("folder_id"),
                "kb_id": d.get("kb_id"),
                "tags": d.get("tags") or [],
                "updated_at": d.get("updated_at") or d.get("created_at"),
            }
            for d in docs[:limit]
        ],
    }


@tool(
    "list_knowledge_bases",
    "列出全部知识库（含 id、名称、文档数）。用户提到「知识库」「库」时先调用它消解指代。",
    _obj({}),
    level="read",
)
def _list_kbs(args: dict[str, Any], ctx: ToolContext) -> dict[str, Any]:
    kbs = store.list_kbs(ctx.user["id"])
    return {
        "count": len(kbs),
        "knowledge_bases": [
            {
                "kb_id": k["id"],
                "name": k.get("name"),
                "description": k.get("description"),
                "doc_count": store.count_docs(k["id"], ctx.user["id"]),
            }
            for k in kbs
        ],
    }


@tool(
    "list_folders",
    "列出文件夹（树形结构的扁平表示，含 parent_id）。",
    _obj({"kb_id": {**_S, "description": "限定知识库 id"}}),
    level="read",
)
def _list_folders(args: dict[str, Any], ctx: ToolContext) -> dict[str, Any]:
    kb_id = (args.get("kb_id") or "").strip() or None
    folders = store.list_folders(kb_id, ctx.user["id"])
    return {
        "count": len(folders),
        "folders": [
            {"folder_id": f["id"], "name": f.get("name"), "parent_id": f.get("parent_id")}
            for f in folders
        ],
    }


@tool(
    "list_tags",
    "列出全部标签及使用情况。",
    _obj({}),
    level="read",
)
def _list_tags(args: dict[str, Any], ctx: ToolContext) -> dict[str, Any]:
    tags = store.list_all_tags(ctx.user["id"])
    docs = store.all(None, ctx.user["id"], with_chunks=False)
    usage = {t: sum(1 for d in docs if t in (d.get("tags") or [])) for t in tags}
    return {"count": len(tags), "tags": tags, "usage": usage}


@tool(
    "get_document_versions",
    "查看一篇文档的历史版本列表。用户说「历史版本」「改回去了」「谁改的」时使用。",
    _obj({"doc_id": _S}, ["doc_id"]),
    level="read",
)
def _versions(args: dict[str, Any], ctx: ToolContext) -> dict[str, Any]:
    doc_id = (args.get("doc_id") or "").strip()
    if store.get(doc_id, ctx.user["id"]) is None:
        raise ToolError(f"文档不存在或无权访问：{doc_id}")
    vs = store.list_versions(doc_id, ctx.user["id"])
    return {
        "count": len(vs),
        "versions": [
            {
                "version_id": v.get("id"),
                "title": v.get("title"),
                "created_at": v.get("created_at"),
                "length": len(v.get("text") or ""),
            }
            for v in vs
        ],
    }


@tool(
    "list_trash",
    "查看回收站内容（已删除的文档/文件夹/知识库）。",
    _obj({}),
    level="read",
)
def _list_trash(args: dict[str, Any], ctx: ToolContext) -> dict[str, Any]:
    t = store.list_trash(ctx.user["id"])
    return {
        "documents": [
            {"doc_id": d["id"], "title": d.get("title"), "deleted_at": d.get("deleted_at")}
            for d in t.get("documents") or []
        ],
        "folders": [
            {"folder_id": f["id"], "name": f.get("name"), "deleted_at": f.get("deleted_at")}
            for f in t.get("folders") or []
        ],
        "knowledge_bases": [
            {"kb_id": k["id"], "name": k.get("name"), "deleted_at": k.get("deleted_at")}
            for k in t.get("kbs") or []
        ],
    }


@tool(
    "system_overview",
    "系统概览：文档数、知识库数、用户数、最近更新。用户问「系统里有什么」「统计」时使用。",
    _obj({}),
    level="read",
)
def _overview(args: dict[str, Any], ctx: ToolContext) -> dict[str, Any]:
    docs = store.all(None, ctx.user["id"], with_chunks=False)
    kbs = store.list_kbs(ctx.user["id"])
    recent = store.list_recent(5, ctx.user["id"])
    out: dict[str, Any] = {
        "document_count": len(docs),
        "knowledge_base_count": len(kbs),
        "folder_count": len(store.list_folders(None, ctx.user["id"])),
        "tag_count": len(store.list_all_tags(ctx.user["id"])),
        "recent_documents": [{"doc_id": d["id"], "title": d.get("title")} for d in recent],
    }
    # 用户数只对管理员开放（非管理员看到也没用，且属信息最小化）
    if ctx.is_admin:
        out["user_count"] = len(store.list_users())
    return out


# ===========================================================================
# 二、文档与目录写操作（write）
# ===========================================================================


@tool(
    "create_document",
    "新建一篇文档。用户说「写一篇」「创建文档」「记录一下」时使用。",
    _obj(
        {
            "title": {**_S, "description": "文档标题"},
            "content": {**_S, "description": "正文（Markdown）"},
            "kb_id": {**_S, "description": "所属知识库 id，省略则用当前所在知识库"},
            "folder_id": {**_S, "description": "所属文件夹 id"},
            "type": {**_S, "description": "文档类型：doc/flowchart/mindmap/datasheet/board，默认 doc"},
        },
        ["title"],
    ),
    level="write",
)
def _create_document(args: dict[str, Any], ctx: ToolContext) -> dict[str, Any]:
    title = (args.get("title") or "").strip()
    if not title:
        raise ToolError("标题不能为空")
    kb_id = (args.get("kb_id") or "").strip() or ctx.current_kb_id
    if kb_id and store.get_kb(kb_id, ctx.user["id"]) is None:
        raise ToolError(f"知识库不存在或无权访问：{kb_id}")
    doc = store.add(
        title=title,
        text=args.get("content") or "",
        source="ai",
        ext="md",
        folder_id=(args.get("folder_id") or "").strip() or None,
        kb_id=kb_id,
        user_id=ctx.user["id"],
        type=(args.get("type") or "doc").strip() or "doc",
    )
    return {"ok": True, "doc_id": doc["id"], "title": doc["title"], "kb_id": doc.get("kb_id")}


@tool(
    "update_document",
    "修改文档的标题或正文。**只传要改的字段**，未传的保持不变。",
    _obj(
        {
            "doc_id": _S,
            "title": {**_S, "description": "新标题，不改则不传"},
            "content": {**_S, "description": "新正文，不改则不传"},
        },
        ["doc_id"],
    ),
    level="write",
)
def _update_document(args: dict[str, Any], ctx: ToolContext) -> dict[str, Any]:
    doc_id = (args.get("doc_id") or "").strip()
    title = args.get("title")
    content = args.get("content")
    if title is None and content is None:
        raise ToolError("至少要提供 title 或 content 之一")
    kwargs: dict[str, Any] = {"user_id": ctx.user["id"]}
    if title is not None:
        kwargs["title"] = str(title)
    if content is not None:
        kwargs["text"] = str(content)
    doc = store.update(doc_id, **kwargs)
    if doc is None:
        raise ToolError(f"文档不存在或无权修改：{doc_id}")
    return {"ok": True, "doc_id": doc_id, "title": doc.get("title")}


@tool(
    "move_document",
    "把文档移动到其他文件夹或知识库。",
    _obj(
        {
            "doc_id": _S,
            "folder_id": {**_S, "description": "目标文件夹 id；传空字符串表示移到根目录"},
            "kb_id": {**_S, "description": "目标知识库 id；不改知识库则不传"},
        },
        ["doc_id"],
    ),
    level="write",
)
def _move_document(args: dict[str, Any], ctx: ToolContext) -> dict[str, Any]:
    doc_id = (args.get("doc_id") or "").strip()
    kwargs: dict[str, Any] = {"user_id": ctx.user["id"]}
    if "folder_id" in args:
        kwargs["folder_id"] = (args.get("folder_id") or "").strip() or None
    if args.get("kb_id"):
        kwargs["kb_id"] = args["kb_id"].strip()
    if len(kwargs) == 1:
        raise ToolError("至少要提供 folder_id 或 kb_id")
    doc = store.update(doc_id, **kwargs)
    if doc is None:
        raise ToolError(f"文档不存在或无权移动：{doc_id}")
    return {"ok": True, "doc_id": doc_id, "folder_id": doc.get("folder_id"), "kb_id": doc.get("kb_id")}


@tool(
    "set_document_tags",
    "给文档设置标签（**覆盖式**：传入的标签列表会替换原有标签）。",
    _obj(
        {
            "doc_id": _S,
            "tags": {"type": "array", "items": _S, "description": "标签列表"},
        },
        ["doc_id", "tags"],
    ),
    level="write",
)
def _set_tags(args: dict[str, Any], ctx: ToolContext) -> dict[str, Any]:
    doc_id = (args.get("doc_id") or "").strip()
    raw = args.get("tags") or []
    tags = [str(t).strip() for t in raw if str(t).strip()]
    if store.set_tags(doc_id, tags) is False:
        raise ToolError(f"文档不存在或无权修改：{doc_id}")
    return {"ok": True, "doc_id": doc_id, "tags": tags}


@tool(
    "set_document_pinned",
    "置顶 / 取消置顶文档。",
    _obj({"doc_id": _S, "pinned": _B}, ["doc_id", "pinned"]),
    level="write",
)
def _set_pinned(args: dict[str, Any], ctx: ToolContext) -> dict[str, Any]:
    doc_id = (args.get("doc_id") or "").strip()
    pinned = bool(args.get("pinned"))
    if store.set_pinned(doc_id, pinned) is False:
        raise ToolError(f"文档不存在或无权修改：{doc_id}")
    return {"ok": True, "doc_id": doc_id, "pinned": pinned}


@tool(
    "create_folder",
    "新建文件夹。",
    _obj(
        {
            "name": _S,
            "parent_id": {**_S, "description": "父文件夹 id，省略则建在根目录"},
            "kb_id": {**_S, "description": "所属知识库 id，省略则用当前所在知识库"},
        },
        ["name"],
    ),
    level="write",
)
def _create_folder(args: dict[str, Any], ctx: ToolContext) -> dict[str, Any]:
    name = (args.get("name") or "").strip()
    if not name:
        raise ToolError("名称不能为空")
    kb_id = (args.get("kb_id") or "").strip() or ctx.current_kb_id
    folder = store.create_folder(
        name=name,
        parent_id=(args.get("parent_id") or "").strip() or None,
        kb_id=kb_id,
        user_id=ctx.user["id"],
    )
    return {"ok": True, "folder_id": folder["id"], "name": folder["name"]}


@tool(
    "rename_folder",
    "重命名文件夹。",
    _obj({"folder_id": _S, "name": _S}, ["folder_id", "name"]),
    level="write",
)
def _rename_folder(args: dict[str, Any], ctx: ToolContext) -> dict[str, Any]:
    folder_id = (args.get("folder_id") or "").strip()
    name = (args.get("name") or "").strip()
    if not name:
        raise ToolError("名称不能为空")
    f = store.rename_folder(folder_id, name, ctx.user["id"])
    if f is None:
        raise ToolError(f"文件夹不存在或无权修改：{folder_id}")
    return {"ok": True, "folder_id": folder_id, "name": name}


@tool(
    "create_knowledge_base",
    "新建知识库。",
    _obj(
        {
            "name": _S,
            "description": {**_S, "description": "简介，可省略"},
        },
        ["name"],
    ),
    level="write",
)
def _create_kb(args: dict[str, Any], ctx: ToolContext) -> dict[str, Any]:
    name = (args.get("name") or "").strip()
    if not name:
        raise ToolError("名称不能为空")
    kb = store.create_kb(name, args.get("description"), ctx.user["id"])
    return {"ok": True, "kb_id": kb["id"], "name": kb["name"]}


# ===========================================================================
# 三、管理员操作（read/write）
# ===========================================================================


@tool(
    "list_users",
    "列出系统用户（仅管理员）。",
    _obj({}),
    level="read",
)
def _list_users(args: dict[str, Any], ctx: ToolContext) -> dict[str, Any]:
    _require_admin(ctx)
    users = store.list_users()
    return {
        "count": len(users),
        "users": [
            {
                "user_id": u["id"],
                "username": u.get("username"),
                "nickname": u.get("nickname"),
                "role": u.get("role"),
                "status": u.get("status"),
            }
            for u in users
        ],
    }


@tool(
    "update_user",
    "修改用户资料/角色/状态（仅管理员）。**只传要改的字段**。",
    _obj(
        {
            "user_id": _S,
            "nickname": {**_S, "description": "昵称"},
            "email": {**_S, "description": "邮箱"},
            "role": {**_S, "description": "角色：admin 或 user"},
            "status": {**_S, "description": "状态：active 或 disabled"},
        },
        ["user_id"],
    ),
    level="write",
)
def _update_user(args: dict[str, Any], ctx: ToolContext) -> dict[str, Any]:
    _require_admin(ctx)
    user_id = (args.get("user_id") or "").strip()
    if store.get_user_by_id(user_id) is None:
        raise ToolError(f"用户不存在：{user_id}")
    kwargs: dict[str, Any] = {}
    for k in ("nickname", "email", "role", "status"):
        if k in args and args[k] is not None:
            kwargs[k] = str(args[k]).strip()
    if not kwargs:
        raise ToolError("没有要修改的字段")
    if "role" in kwargs and kwargs["role"] not in ("admin", "user"):
        raise ToolError("role 只能是 admin 或 user")
    if "status" in kwargs and kwargs["status"] not in ("active", "disabled"):
        raise ToolError("status 只能是 active 或 disabled")
    # 不允许把自己降级/停用（会把系统锁死，与 HTTP 接口同一条约束）
    if user_id == ctx.user["id"] and (
        kwargs.get("role") == "user" or kwargs.get("status") == "disabled"
    ):
        raise ToolError("不能降级或停用当前登录账号")
    u = store.update_user(user_id, **kwargs)
    if u is None:
        raise ToolError("修改失败")
    return {"ok": True, "user_id": user_id, "changed": list(kwargs.keys())}


@tool(
    "get_ai_settings",
    "读取当前 AI 配置（模型名、是否已配密钥）。**不返回密钥明文。**（仅管理员）",
    _obj({}),
    level="read",
)
def _get_ai_settings(args: dict[str, Any], ctx: ToolContext) -> dict[str, Any]:
    _require_admin(ctx)
    from app.core.config import ai_config

    c = ai_config()

    def _mask(v: Any) -> str:
        s = str(v or "")
        return f"{s[:4]}***" if len(s) > 4 else ("已配置" if s else "未配置")

    return {
        "llm_model": c.get("llm_model"),
        "llm_base_url": c.get("llm_base_url"),
        "llm_api_key": _mask(c.get("llm_api_key")),
        "embedding_model": c.get("embedding_model"),
        "rerank_model": c.get("rerank_model"),
    }


# ===========================================================================
# 四、破坏性操作（destructive）—— 不直接执行，交给前端确认
# ===========================================================================


@tool(
    "delete_document",
    "删除文档（进入回收站，可恢复）。",
    _obj({"doc_id": _S}, ["doc_id"]),
    level="destructive",
)
def _delete_document(args: dict[str, Any], ctx: ToolContext) -> dict[str, Any]:
    doc_id = (args.get("doc_id") or "").strip()
    doc = store.get(doc_id, ctx.user["id"])
    if doc is None:
        raise ToolError(f"文档不存在或无权删除：{doc_id}")
    # ⚠️ 返回值里**绝不能带「已完成」语义**（如 "action": "已移入回收站"）。
    # 这个 dict 会被回灌给模型，模型会据此告诉用户「已删除」——
    # 而实际尚未执行（用户还没点确认）。实测踩过：模型原话
    # 「已将标题为 X 的文档移入回收站」而库里文档还在，属严重误导。
    return {"ok": True, "doc_id": doc_id, "title": doc.get("title")}


@tool(
    "delete_folder",
    "删除文件夹及其内容（进入回收站，可恢复）。",
    _obj({"folder_id": _S}, ["folder_id"]),
    level="destructive",
)
def _delete_folder(args: dict[str, Any], ctx: ToolContext) -> dict[str, Any]:
    folder_id = (args.get("folder_id") or "").strip()
    # 只解析目标，**不调用 delete_folder** —— 真正的副作用在 commit() 里。
    # 这里若直接调，会在「用户还没点确认」时就删掉（踩过一次）。
    folder = next(
        (f for f in store.list_folders(None, ctx.user["id"]) if f["id"] == folder_id),
        None,
    )
    if folder is None:
        raise ToolError(f"文件夹不存在或无权删除：{folder_id}")
    return {"ok": True, "folder_id": folder_id, "name": folder.get("name")}


@tool(
    "delete_knowledge_base",
    "删除知识库（进入回收站，可恢复）。",
    _obj({"kb_id": _S}, ["kb_id"]),
    level="destructive",
)
def _delete_kb(args: dict[str, Any], ctx: ToolContext) -> dict[str, Any]:
    kb_id = (args.get("kb_id") or "").strip()
    kb = store.get_kb(kb_id, ctx.user["id"])
    if kb is None:
        raise ToolError(f"知识库不存在或无权删除：{kb_id}")
    if store.kb_permission(kb_id, ctx.user["id"]) != "owner":
        raise ToolDenied("只有知识库所有者可以删除它")
    return {
        "ok": True,
        "kb_id": kb_id,
        "name": kb.get("name"),
        "doc_count": store.count_docs(kb_id, ctx.user["id"]),
    }


@tool(
    "purge_trash_item",
    "从回收站**彻底删除**（不可恢复）。",
    _obj(
        {
            "kind": {**_S, "description": "document / folder / kb"},
            "obj_id": _S,
        },
        ["kind", "obj_id"],
    ),
    level="destructive",
)
def _purge_trash(args: dict[str, Any], ctx: ToolContext) -> dict[str, Any]:
    kind = (args.get("kind") or "").strip()
    obj_id = (args.get("obj_id") or "").strip()
    if kind not in ("document", "folder", "kb"):
        raise ToolError("kind 只能是 document / folder / kb")
    # 只在回收站里查（不过滤 deleted_at 的是另一套 API），确认目标确实在回收站
    trash = store.list_trash(ctx.user["id"])
    key = {"document": "documents", "folder": "folders", "kb": "kbs"}[kind]
    id_key = {"document": "doc_id", "folder": "folder_id", "kb": "kb_id"}[kind]
    found = next((x for x in trash.get(key) or [] if x.get(id_key) == obj_id), None)
    if found is None:
        raise ToolError(f"回收站中未找到该项：{kind}/{obj_id}")
    return {"ok": True, "kind": kind, "obj_id": obj_id, "label": found.get("title") or found.get("name")}


@tool(
    "delete_user",
    "删除用户（仅管理员，不可恢复）。",
    _obj({"user_id": _S}, ["user_id"]),
    level="destructive",
)
def _delete_user(args: dict[str, Any], ctx: ToolContext) -> dict[str, Any]:
    _require_admin(ctx)
    user_id = (args.get("user_id") or "").strip()
    if user_id == ctx.user["id"]:
        raise ToolError("不能删除当前登录账号")
    u = store.get_user_by_id(user_id)
    if u is None:
        raise ToolError(f"用户不存在：{user_id}")
    return {"ok": True, "user_id": user_id, "username": u.get("username"), "action": "已删除"}


@tool(
    "restore_trash_item",
    "从回收站恢复一项。",
    _obj(
        {
            "kind": {**_S, "description": "document / folder / kb"},
            "obj_id": _S,
        },
        ["kind", "obj_id"],
    ),
    level="destructive",
)
def _restore_trash(args: dict[str, Any], ctx: ToolContext) -> dict[str, Any]:
    kind = (args.get("kind") or "").strip()
    obj_id = (args.get("obj_id") or "").strip()
    if kind not in ("document", "folder", "kb"):
        raise ToolError("kind 只能是 document / folder / kb")
    if not store.restore(kind, obj_id, ctx.user["id"]):
        raise ToolError(f"恢复失败，回收站中未找到：{kind}/{obj_id}")
    return {"ok": True, "kind": kind, "obj_id": obj_id, "action": "已恢复"}


# ===========================================================================
# 五、界面导航（ui）—— 不改数据，返回给前端执行的指令
# ===========================================================================


@tool(
    "open_document",
    "在界面上打开一篇文档。用户说「打开 X」「让我看看 X」时使用。",
    _obj({"doc_id": _S}, ["doc_id"]),
    level="read",
)
def _open_document(args: dict[str, Any], ctx: ToolContext) -> dict[str, Any]:
    doc_id = (args.get("doc_id") or "").strip()
    doc = store.get(doc_id, ctx.user["id"])
    if doc is None:
        raise ToolError(f"文档不存在或无权访问：{doc_id}")
    return {
        "ui_action": "open_document",
        "doc_id": doc_id,
        "title": doc.get("title"),
    }


@tool(
    "goto_view",
    "切换界面视图（首页/知识库/设置/用户管理/回收站）。用户说「回到首页」「打开设置」「看看回收站」时使用。",
    _obj(
        {
            "view": {
                **_S,
                "description": "home / kb / settings / users / trash",
            }
        },
        ["view"],
    ),
    level="read",
)
def _goto_view(args: dict[str, Any], ctx: ToolContext) -> dict[str, Any]:
    view = (args.get("view") or "").strip()
    allowed = ("home", "kb", "settings", "users", "trash")
    if view not in allowed:
        raise ToolError(f"view 只能是 {' / '.join(allowed)}")
    # 设置与用户管理是管理员专属视图 —— 与前端菜单的可见性规则一致
    if view in ("settings", "users") and not ctx.is_admin:
        raise ToolDenied("该视图仅管理员可访问")
    return {"ui_action": "goto_view", "view": view}


# ---------------------------------------------------------------------------
# 执行
# ---------------------------------------------------------------------------


def execute(name: str, arguments: str | dict[str, Any], ctx: ToolContext) -> dict[str, Any]:
    """执行一个工具调用，返回结构化结果。

    返回结构固定为 ``{ok, level, name, ...}``：
    - ``ok=False`` 时带 ``error``，模型可据此改写参数重试；
    - ``level="destructive"`` 且 ``ok=True`` 时带 ``pending=True``，
      表示**尚未落库**，需前端确认后才真正执行。
    """
    t = get_tool(name)
    if t is None:
        return {"ok": False, "name": name, "error": f"未知工具：{name}（可用工具见系统提示）"}

    if isinstance(arguments, str):
        raw = arguments.strip()
        if not raw:
            args: dict[str, Any] = {}
        else:
            try:
                args = json.loads(raw)
            except json.JSONDecodeError as e:
                return {
                    "ok": False,
                    "name": name,
                    "error": f"参数不是合法 JSON：{e}。请按 schema 重新给出参数。",
                }
            if not isinstance(args, dict):
                return {"ok": False, "name": name, "error": "参数必须是 JSON 对象"}
    else:
        args = dict(arguments or {})

    try:
        result = t.handler(args, ctx)
    except ToolDenied as e:
        # 权限错误要明确回给模型，否则它会换个说法反复重试同一件事
        return {"ok": False, "name": name, "denied": True, "error": str(e)}
    except ToolError as e:
        return {"ok": False, "name": name, "error": str(e)}
    except Exception as e:  # noqa: BLE001
        print(f"[智能体] ⚠️ 工具 {name} 执行异常: {type(e).__name__}: {e}")
        return {"ok": False, "name": name, "error": f"执行失败：{type(e).__name__}"}

    out: dict[str, Any] = {"ok": True, "name": name, "level": t.level}
    out.update(result or {})
    if t.level == "destructive":
        # 标记 pending 让前端知道「还没真正执行」
        out["pending"] = True
        out["confirm_hint"] = "该操作需要用户确认后才会执行"
    return out


def preview(name: str, args: dict[str, Any]) -> str:
    """给「待确认」卡片用的人类可读摘要（不执行任何副作用）。"""
    t = get_tool(name)
    if t is None:
        return name
    try:
        return t.handler(args, _PreviewContext())  # type: ignore[arg-type]
    except Exception:  # noqa: BLE001
        return ""


class _PreviewContext:
    """占位上下文：仅用于让 handler 走到「描述目标」那一步。"""


# ---------------------------------------------------------------------------
# 真正的执行入口（用户确认后调用）
# ---------------------------------------------------------------------------


def commit(name: str, args: dict[str, Any], ctx: ToolContext) -> dict[str, Any]:
    """执行破坏性工具的**真实副作用**。

    与 `execute` 分开：`execute` 只做校验与目标解析（返回 pending），
    真正的删除在这里发生 —— 保证「确认前绝不落库」。
    """
    t = get_tool(name)
    if t is None or t.level != "destructive":
        raise ToolError(f"不是可确认执行的破坏性工具：{name}")
    args = dict(args or {})
    if name == "delete_document":
        doc_id = (args.get("doc_id") or "").strip()
        if not store.delete(doc_id, ctx.user["id"]):
            raise ToolError(f"删除失败：{doc_id}")
        return {"ok": True, "doc_id": doc_id}
    if name == "delete_folder":
        folder_id = (args.get("folder_id") or "").strip()
        if not store.delete_folder(folder_id, ctx.user["id"]):
            raise ToolError(f"删除失败：{folder_id}")
        return {"ok": True, "folder_id": folder_id}
    if name == "delete_knowledge_base":
        kb_id = (args.get("kb_id") or "").strip()
        if not store.delete_kb(kb_id, ctx.user["id"]):
            raise ToolError(f"删除失败：{kb_id}")
        return {"ok": True, "kb_id": kb_id}
    if name == "delete_user":
        _require_admin(ctx)
        user_id = (args.get("user_id") or "").strip()
        if user_id == ctx.user["id"]:
            raise ToolError("不能删除当前登录账号")
        if not store.delete_user(user_id):
            raise ToolError(f"删除失败：{user_id}")
        return {"ok": True, "user_id": user_id}
    if name == "purge_trash_item":
        if not store.purge(args.get("kind", ""), args.get("obj_id", ""), ctx.user["id"]):
            raise ToolError("彻底删除失败")
        return {"ok": True}
    if name == "restore_trash_item":
        if not store.restore(args.get("kind", ""), args.get("obj_id", ""), ctx.user["id"]):
            raise ToolError("恢复失败")
        return {"ok": True}
    raise ToolError(f"未实现的确认执行：{name}")