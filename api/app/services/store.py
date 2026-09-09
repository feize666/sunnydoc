"""文档存储服务：PostgreSQL + pgvector 优先，JSON 文件降级。

对外接口保持不变（DocStore 的 add/add_many/all/get/delete、模块级
search/_segment/_tokenize/_cosine、模块级 store 单例）。内部按 db.available()
分流：可用走 PostgreSQL，否则回退到 JSON 文件。
"""
from __future__ import annotations

import json
import re
import time
import uuid
from pathlib import Path
from typing import Any

import jieba

from app.core.config import DATA_DIR
from app.services import db, embedding, rerank

STORE_FILE = DATA_DIR / "store.json"

# 用于区分「未传参」与「显式传 None」的哨兵值。
# 复用 db 模块的 _UNSET，保证跨 store/db 转发时身份一致（否则会误把哨兵当真实值写入 SQL）。
_UNSET = db._UNSET

# 检索时的停用词（常见疑问词/虚词，避免干扰打分）
STOPWORDS = {
    "如何", "怎么", "什么", "哪些", "哪里", "为什么", "请问", "一下",
    "的", "了", "是", "在", "和", "与", "或", "吗", "呢", "吧", "这个", "那个",
    "一个", "我", "你", "他", "它", "我们", "请", "帮我", "给出", "告诉我",
}


def _tokenize(text: str) -> list[str]:
    """中文分词 + 去停用词 + 过滤单字"""
    words = []
    for w in jieba.cut(text):
        w = w.strip()
        if not w:
            continue
        if w in STOPWORDS:
            continue
        # 保留中文词、英文单词、数字
        if re.match(r"^[\u4e00-\u9fa5a-zA-Z0-9]+$", w):
            words.append(w.lower())
    return words


class DocStore:
    def __init__(self) -> None:
        self._docs: list[dict[str, Any]] = []
        self._folders: list[dict[str, Any]] = []
        self._kbs: list[dict[str, Any]] = []
        self._recent: list[dict[str, Any]] = []
        self._users: list[dict[str, Any]] = []
        self._shares: list[dict[str, Any]] = []
        self._favorites: list[dict[str, Any]] = []
        self._share_links: list[dict[str, Any]] = []
        # 启动时判定存储后端：PostgreSQL 可用则用库，否则 JSON 降级
        if db.available():
            self._backend = "db"
            db.init()
        else:
            self._backend = "json"
            self._load()

    def _load(self) -> None:
        if STORE_FILE.exists():
            try:
                data = json.loads(STORE_FILE.read_text("utf-8"))
            except (json.JSONDecodeError, OSError):
                data = []
            # 兼容旧版「纯文档数组」结构
            if isinstance(data, list):
                self._docs = data
                self._folders = []
                self._kbs = []
                self._recent = []
                self._users = []
                self._shares = []
                self._favorites = []
                self._share_links = []
            else:
                self._docs = data.get("documents", [])
                self._folders = data.get("folders", [])
                self._kbs = data.get("kbs", [])
                self._recent = data.get("recent", [])
                self._users = data.get("users", [])
                self._shares = data.get("shares", [])
                self._favorites = data.get("favorites", [])
                self._share_links = data.get("share_links", [])
        # 补齐旧数据缺失的字段，保证 all() 返回结构一致
        for d in self._docs:
            d.setdefault("folder_id", None)
            d.setdefault("kb_id", None)
            d.setdefault("user_id", None)
            d.setdefault("deleted_at", None)
            d.setdefault("tags", [])
            d.setdefault("pinned", False)
            d.setdefault("summary", None)
            d.setdefault("type", "doc")
        for f in self._folders:
            f.setdefault("kb_id", None)
            f.setdefault("user_id", None)
            f.setdefault("deleted_at", None)
        for k in self._kbs:
            k.setdefault("user_id", None)
            k.setdefault("deleted_at", None)
        for r in self._recent:
            r.setdefault("user_id", None)
        for u in self._users:
            u.setdefault("role", "user")
            u.setdefault("nickname", u.get("username"))
            u.setdefault("email", None)
            u.setdefault("avatar", None)
            u.setdefault("status", "active")
            u.setdefault("updated_at", u.get("created_at"))

    def _save(self) -> None:
        STORE_FILE.parent.mkdir(parents=True, exist_ok=True)
        STORE_FILE.write_text(
            json.dumps(
                {
                    "documents": self._docs,
                    "folders": self._folders,
                    "kbs": self._kbs,
                    "recent": self._recent,
                    "users": self._users,
                    "shares": self._shares,
                    "favorites": self._favorites,
                    "share_links": self._share_links,
                },
                ensure_ascii=False,
                indent=2,
            ),
            "utf-8",
        )

    def _build_chunks(self, text: str) -> list[dict[str, Any]]:
        """分片 + 向量化，供 add / update 共用。"""
        chunks = _segment(text)
        # 尝试向量化（无 embedding 服务时为 None）
        vectors = embedding.embed(chunks) if embedding.available() else None
        return [
            {"text": c, "vector": vectors[i] if vectors else None}
            for i, c in enumerate(chunks)
        ]

    # ---------- 可见性与权限 ----------

    def _is_admin(self, user_id: str | None) -> bool:
        if user_id is None:
            return False
        u = self.get_user_by_id(user_id)
        return bool(u and u.get("role") == "admin")

    def get_share_permission(self, kb_id: str, user_id: str | None) -> str | None:
        """返回共享权限 read/write，无共享返回 None。"""
        if user_id is None:
            return None
        if self._backend == "db":
            return db.get_share_permission(kb_id, user_id)
        for s in self._shares:
            if s["kb_id"] == kb_id and s["user_id"] == user_id:
                return s["permission"]
        return None

    def kb_permission(self, kb_id: str, user_id: str | None) -> str | None:
        """返回用户对知识库的权限：owner/read/write；无权限返回 None。管理员视为 owner。"""
        if user_id is None:
            return None
        if self._is_admin(user_id):
            return "owner"
        kb = self.get_kb(kb_id)
        if kb is None:
            return None
        if kb.get("user_id") == user_id:
            return "owner"
        return self.get_share_permission(kb_id, user_id)

    def _accessible_kb_ids(self, user_id: str | None) -> set[str]:
        """返回用户可访问的知识库 id 集合（属主 + 被共享；管理员为全部）。"""
        if user_id is None:
            return set()
        if self._backend == "db":
            kbs = db.list_kbs(None)
            shared = db.list_shared_kbs(user_id)
        else:
            kbs = self._kbs
            shared = [s for s in self._shares if s["user_id"] == user_id]
        is_admin = self._is_admin(user_id)
        ids: set[str] = set()
        for k in kbs:
            if is_admin or k.get("user_id") == user_id:
                ids.add(k["id"])
        for s in shared:
            ids.add(s["kb_id"])
        return ids

    def _can_write_doc(self, doc: dict[str, Any], user_id: str | None) -> bool:
        if doc.get("user_id") == user_id:
            return True
        kb_id = doc.get("kb_id")
        return self.kb_permission(kb_id, user_id) in ("write", "owner") if kb_id else False

    def _can_write_folder(self, folder: dict[str, Any], user_id: str | None) -> bool:
        if folder.get("user_id") == user_id:
            return True
        kb_id = folder.get("kb_id")
        return self.kb_permission(kb_id, user_id) in ("write", "owner") if kb_id else False

    # ---------- 共享 ----------

    def add_share(self, kb_id: str, user_id: str, permission: str) -> dict[str, Any]:
        """新增/更新共享（upsert）。permission: read/write。"""
        if self._backend == "db":
            return db.add_share(kb_id, user_id, permission)
        self._shares = [
            s for s in self._shares if not (s["kb_id"] == kb_id and s["user_id"] == user_id)
        ]
        share = {
            "id": uuid.uuid4().hex,
            "kb_id": kb_id,
            "user_id": user_id,
            "permission": permission,
            "created_at": time.time(),
        }
        self._shares.append(share)
        self._save()
        return share

    def remove_share(self, kb_id: str, user_id: str) -> bool:
        if self._backend == "db":
            return db.remove_share(kb_id, user_id)
        before = len(self._shares)
        self._shares = [
            s for s in self._shares if not (s["kb_id"] == kb_id and s["user_id"] == user_id)
        ]
        if len(self._shares) != before:
            self._save()
            return True
        return False

    def list_shares(self, kb_id: str) -> list[dict[str, Any]]:
        if self._backend == "db":
            return db.list_shares(kb_id)
        return [dict(s) for s in self._shares if s["kb_id"] == kb_id]

    # ---------- 文档收藏 ----------

    def add_favorite(self, user_id: str, doc_id: str) -> dict[str, Any] | None:
        if self._backend == "db":
            return db.add_favorite(user_id, doc_id)
        if any(f["user_id"] == user_id and f["doc_id"] == doc_id for f in self._favorites):
            return next(f for f in self._favorites if f["user_id"] == user_id and f["doc_id"] == doc_id)
        fav = {
            "id": uuid.uuid4().hex,
            "user_id": user_id,
            "doc_id": doc_id,
            "created_at": time.time(),
        }
        self._favorites.append(fav)
        self._save()
        return fav

    def remove_favorite(self, user_id: str, doc_id: str) -> bool:
        if self._backend == "db":
            return db.remove_favorite(user_id, doc_id)
        before = len(self._favorites)
        self._favorites = [
            f for f in self._favorites if not (f["user_id"] == user_id and f["doc_id"] == doc_id)
        ]
        if len(self._favorites) != before:
            self._save()
            return True
        return False

    def list_favorites(self, user_id: str) -> list[str]:
        if self._backend == "db":
            return db.list_favorites(user_id)
        items = sorted(
            (f for f in self._favorites if f["user_id"] == user_id),
            key=lambda f: f.get("created_at", 0),
            reverse=True,
        )
        return [f["doc_id"] for f in items]

    def is_favorite(self, user_id: str, doc_id: str) -> bool:
        if self._backend == "db":
            return db.is_favorite(user_id, doc_id)
        return any(f["user_id"] == user_id and f["doc_id"] == doc_id for f in self._favorites)

    # ---------- 文档分享链接 ----------

    def create_share(self, doc_id: str, token: str) -> dict[str, Any]:
        if self._backend == "db":
            return db.create_share(doc_id, token)
        self._share_links = [s for s in self._share_links if s["doc_id"] != doc_id]
        share = {
            "id": uuid.uuid4().hex,
            "token": token,
            "doc_id": doc_id,
            "created_at": time.time(),
        }
        self._share_links.append(share)
        self._save()
        return share

    def get_share_by_token(self, token: str) -> dict[str, Any] | None:
        if self._backend == "db":
            return db.get_share_by_token(token)
        for s in self._share_links:
            if s["token"] == token:
                return dict(s)
        return None

    def get_share_by_doc(self, doc_id: str) -> dict[str, Any] | None:
        if self._backend == "db":
            return db.get_share_by_doc(doc_id)
        for s in self._share_links:
            if s["doc_id"] == doc_id:
                return dict(s)
        return None

    def delete_share(self, doc_id: str) -> bool:
        if self._backend == "db":
            return db.delete_share(doc_id)
        before = len(self._share_links)
        self._share_links = [s for s in self._share_links if s["doc_id"] != doc_id]
        if len(self._share_links) != before:
            self._save()
            return True
        return False

    def add(
        self,
        title: str,
        text: str,
        source: str,
        ext: str,
        folder_id: str | None = None,
        kb_id: str | None = None,
        user_id: str | None = None,
        type: str = "doc",
    ) -> dict[str, Any]:
        doc = {
            "id": uuid.uuid4().hex,
            "title": title,
            "text": text,
            "source": source,
            "ext": ext,
            "created_at": time.time(),
            "folder_id": folder_id,
            "kb_id": kb_id,
            "user_id": user_id,
            "type": type,
            "chunks": self._build_chunks(text),
        }
        if self._backend == "db":
            db.add_document(doc)
        else:
            self._docs.append(doc)
            self._save()
        return doc

    def duplicate(self, doc_id: str, user_id: str | None = None) -> dict[str, Any] | None:
        """复制文档：新标题加「（副本）」，内容/归属/位置一致。"""
        doc = self.get(doc_id, user_id)
        if doc is None:
            return None
        title = f"{doc['title']}（副本）"
        return self.add(
            title=title,
            text=doc["text"],
            source=doc["source"],
            ext=doc["ext"],
            folder_id=doc.get("folder_id"),
            kb_id=doc.get("kb_id"),
            user_id=doc.get("user_id"),
            type=doc.get("type", "doc"),
        )

    def update(
        self,
        doc_id: str,
        title: Any = _UNSET,
        text: Any = _UNSET,
        folder_id: Any = _UNSET,
        kb_id: Any = _UNSET,
        user_id: str | None = None,
    ) -> dict[str, Any] | None:
        """更新文档字段。title/text 提供时更新并重建分片 + 向量；folder_id/kb_id 提供时移动。

        权限：文档属主，或对文档所在知识库有 write/owner 权限。找不到或无权限返回 None。
        """
        if self._backend == "db":
            doc = db.get_document(doc_id)
            if doc is None or (user_id is not None and not self._can_write_doc(doc, user_id)):
                return None
            if title is not _UNSET:
                doc["title"] = title
            if text is not _UNSET:
                doc["text"] = text
                doc["chunks"] = self._build_chunks(text)
            if folder_id is not _UNSET:
                doc["folder_id"] = folder_id
            if kb_id is not _UNSET:
                doc["kb_id"] = kb_id
            return db.update_document(doc_id, doc)
        for d in self._docs:
            if d["id"] == doc_id:
                if user_id is not None and not self._can_write_doc(d, user_id):
                    return None
                if title is not _UNSET:
                    d["title"] = title
                if text is not _UNSET:
                    d["text"] = text
                    d["chunks"] = self._build_chunks(text)
                if folder_id is not _UNSET:
                    d["folder_id"] = folder_id
                if kb_id is not _UNSET:
                    d["kb_id"] = kb_id
                self._save()
                return d
        return None

    def add_many(self, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        docs: list[dict[str, Any]] = []
        for item in items:
            docs.append(
                self.add(
                    item["title"],
                    item["text"],
                    item["source"],
                    item["ext"],
                    item.get("folder_id"),
                    item.get("kb_id"),
                    item.get("user_id"),
                )
            )
        return docs

    def all(self, kb_id: str | None = None, user_id: str | None = None) -> list[dict[str, Any]]:
        """返回用户可见的文档（知识库级可见性）。

        - kb_id 提供：用户对该 kb 有权限则返回该 kb 下全部文档，否则空。
        - kb_id 为空、user_id 提供：返回可访问知识库下的全部文档 + 自有且未归属 kb 的文档。
        - user_id 为空：返回全部（内部/未登录场景）。
        """
        if self._backend == "db":
            if kb_id is not None:
                if user_id is not None and self.kb_permission(kb_id, user_id) is None:
                    return []
                return db.all_documents(kb_id=kb_id)
            if user_id is not None:
                return db.all_documents_for_user(user_id, self._accessible_kb_ids(user_id))
            return db.all_documents()
        docs = [d for d in self._docs if not d.get("deleted_at")]
        if kb_id is not None:
            if user_id is not None and self.kb_permission(kb_id, user_id) is None:
                return []
            return [d for d in docs if d.get("kb_id") == kb_id]
        if user_id is not None:
            kb_ids = self._accessible_kb_ids(user_id)
            return [
                d
                for d in docs
                if (d.get("kb_id") in kb_ids) or (d.get("user_id") == user_id and not d.get("kb_id"))
            ]
        return list(docs)

    def get(self, doc_id: str, user_id: str | None = None) -> dict[str, Any] | None:
        if self._backend == "db":
            doc = db.get_document(doc_id)
        else:
            doc = next(
                (d for d in self._docs if d["id"] == doc_id and not d.get("deleted_at")),
                None,
            )
        if doc is None:
            return None
        if user_id is None:
            return doc
        # 属主可见；或文档所在知识库可访问（共享/管理员）
        if doc.get("user_id") == user_id:
            return doc
        kb_id = doc.get("kb_id")
        if kb_id and self.kb_permission(kb_id, user_id) is not None:
            return doc
        return None

    def delete(self, doc_id: str, user_id: str | None = None) -> bool:
        if self._backend == "db":
            if user_id is not None:
                doc = db.get_document(doc_id)
                if doc is None or not self._can_write_doc(doc, user_id):
                    return False
            return db.delete_document(doc_id)
        for d in self._docs:
            if d["id"] == doc_id and (user_id is None or self._can_write_doc(d, user_id)):
                if d.get("deleted_at"):
                    return False
                d["deleted_at"] = time.time()
                self._save()
                return True
        return False

    # ---------- 回收站 / 标签 / 置顶 / 摘要 ----------

    def list_trash(self, user_id: str | None = None) -> dict[str, list[dict[str, Any]]]:
        """回收站：返回删除的文档/文件夹/知识库。"""
        if self._backend == "db":
            return {
                "documents": db.list_trash_documents(user_id),
                "folders": db.list_trash_folders(user_id),
                "kbs": db.list_trash_kbs(user_id),
            }
        return {
            "documents": [
                d for d in self._docs if d.get("deleted_at") and (user_id is None or d.get("user_id") == user_id)
            ],
            "folders": [
                f for f in self._folders if f.get("deleted_at") and (user_id is None or f.get("user_id") == user_id)
            ],
            "kbs": [
                k for k in self._kbs if k.get("deleted_at") and (user_id is None or k.get("user_id") == user_id)
            ],
        }

    def restore(self, kind: str, obj_id: str, user_id: str | None = None) -> bool:
        """恢复回收站中的对象。kind: document/folder/kb。"""
        if self._backend == "db":
            if kind == "document":
                return db.restore_document(obj_id)
            if kind == "folder":
                return db.restore_folder(obj_id)
            if kind == "kb":
                return db.restore_kb(obj_id)
            return False
        if kind == "document":
            for d in self._docs:
                if d["id"] == obj_id and d.get("deleted_at"):
                    d["deleted_at"] = None
                    self._save()
                    return True
        elif kind == "folder":
            for f in self._folders:
                if f["id"] == obj_id and f.get("deleted_at"):
                    f["deleted_at"] = None
                    self._save()
                    return True
        elif kind == "kb":
            kb_id = obj_id
            for k in self._kbs:
                if k["id"] == kb_id and k.get("deleted_at"):
                    k["deleted_at"] = None
            for d in self._docs:
                if d.get("kb_id") == kb_id:
                    d["deleted_at"] = None
            for f in self._folders:
                if f.get("kb_id") == kb_id:
                    f["deleted_at"] = None
            self._save()
            return True
        return False

    def purge(self, kind: str, obj_id: str, user_id: str | None = None) -> bool:
        """彻底删除回收站对象。kind: document/folder/kb。"""
        if self._backend == "db":
            if kind == "document":
                return db.purge_document(obj_id)
            if kind == "folder":
                return db.purge_folder(obj_id)
            if kind == "kb":
                return db.purge_kb(obj_id)
            return False
        before = len(self._docs)
        if kind == "document":
            self._docs = [d for d in self._docs if d["id"] != obj_id]
        elif kind == "folder":
            self._folders = [f for f in self._folders if f["id"] != obj_id]
        elif kind == "kb":
            self._docs = [d for d in self._docs if d.get("kb_id") != obj_id]
            self._folders = [f for f in self._folders if f.get("kb_id") != obj_id]
            self._kbs = [k for k in self._kbs if k["id"] != obj_id]
        else:
            return False
        changed = len(self._docs) != before or kind in ("folder", "kb")
        if changed:
            self._save()
        return True

    def set_tags(self, doc_id: str, tags: list[str]) -> bool:
        if self._backend == "db":
            return db.set_document_tags(doc_id, tags)
        for d in self._docs:
            if d["id"] == doc_id:
                d["tags"] = list(tags)
                self._save()
                return True
        return False

    def set_pinned(self, doc_id: str, pinned: bool) -> bool:
        if self._backend == "db":
            return db.set_document_pinned(doc_id, pinned)
        for d in self._docs:
            if d["id"] == doc_id:
                d["pinned"] = bool(pinned)
                self._save()
                return True
        return False

    def set_summary(self, doc_id: str, summary: str) -> bool:
        if self._backend == "db":
            return db.set_document_summary(doc_id, summary)
        for d in self._docs:
            if d["id"] == doc_id:
                d["summary"] = summary
                self._save()
                return True
        return False

    def list_all_tags(self, user_id: str | None = None) -> list[str]:
        if self._backend == "db":
            return db.list_all_tags(user_id)
        all_tags: set[str] = set()
        for d in self._docs:
            if d.get("deleted_at"):
                continue
            if user_id is not None and d.get("user_id") != user_id:
                continue
            for t in d.get("tags") or []:
                all_tags.add(t)
        return sorted(all_tags)

    # ---------- 文件夹 ----------

    def list_folders(
        self, kb_id: str | None = None, user_id: str | None = None
    ) -> list[dict[str, Any]]:
        """返回用户可见的文件夹（扁平列表，含 parent_id，供前端组装树）。

        - kb_id 提供：用户对该 kb 有权限则返回该 kb 下全部文件夹，否则空。
        - kb_id 为空、user_id 提供：返回可访问知识库下的全部文件夹 + 自有且未归属 kb 的文件夹。
        """
        if self._backend == "db":
            if kb_id is not None:
                if user_id is not None and self.kb_permission(kb_id, user_id) is None:
                    return []
                return db.list_folders(kb_id=kb_id)
            if user_id is not None:
                return db.list_folders_for_user(user_id, self._accessible_kb_ids(user_id))
            return db.list_folders()
        folders = [f for f in self._folders if not f.get("deleted_at")]
        if kb_id is not None:
            if user_id is not None and self.kb_permission(kb_id, user_id) is None:
                return []
            return [f for f in folders if f.get("kb_id") == kb_id]
        if user_id is not None:
            kb_ids = self._accessible_kb_ids(user_id)
            return [
                f
                for f in folders
                if (f.get("kb_id") in kb_ids) or (f.get("user_id") == user_id and not f.get("kb_id"))
            ]
        return list(folders)

    def create_folder(
        self,
        name: str,
        parent_id: str | None = None,
        kb_id: str | None = None,
        user_id: str | None = None,
    ) -> dict[str, Any]:
        folder = {
            "id": uuid.uuid4().hex,
            "name": name,
            "parent_id": parent_id,
            "created_at": time.time(),
            "kb_id": kb_id,
            "user_id": user_id,
        }
        if self._backend == "db":
            db.create_folder(folder)
        else:
            self._folders.append(folder)
            self._save()
        return folder

    def rename_folder(
        self, folder_id: str, name: str, user_id: str | None = None
    ) -> dict[str, Any] | None:
        """重命名文件夹，不存在或无权限返回 None。"""
        if self._backend == "db":
            f = db.rename_folder(folder_id, name)
            if f is None or (user_id is not None and not self._can_write_folder(f, user_id)):
                return None
            return f
        for f in self._folders:
            if f["id"] == folder_id:
                if user_id is not None and not self._can_write_folder(f, user_id):
                    return None
                f["name"] = name
                self._save()
                return dict(f)
        return None

    def delete_folder(self, folder_id: str, user_id: str | None = None) -> bool:
        """软删除文件夹：标记自身 + 后代 deleted_at，其下文档 folder_id 置空（移回根目录）。"""
        if self._backend == "db":
            if user_id is not None:
                folders = db.list_folders()
                target = next((f for f in folders if f["id"] == folder_id), None)
                if target is None or not self._can_write_folder(target, user_id):
                    return False
            return db.delete_folder(folder_id)
        # 校验归属/权限
        if user_id is not None:
            target = next((f for f in self._folders if f["id"] == folder_id), None)
            if target is None or not self._can_write_folder(target, user_id):
                return False
        # 收集自身 + 所有后代文件夹 id
        ids = [folder_id]
        idx = 0
        while idx < len(ids):
            for f in self._folders:
                if f["parent_id"] == ids[idx] and f["id"] not in ids and not f.get("deleted_at"):
                    ids.append(f["id"])
            idx += 1

        now = time.time()
        existed = any(f["id"] == folder_id for f in self._folders)
        if not existed:
            return False

        for f in self._folders:
            if f["id"] in ids:
                f["deleted_at"] = now
        # 文档移回根目录
        for d in self._docs:
            if d.get("folder_id") in ids:
                d["folder_id"] = None
        self._save()
        return True

    # ---------- 知识库 ----------

    def list_kbs(self, user_id: str | None = None) -> list[dict[str, Any]]:
        """返回用户可见的知识库（属主 + 被共享），每个 kb 附 permission 字段。

        permission: owner/read/write。user_id 为 None 时返回全部（无 permission）。
        """
        if self._backend == "db":
            kbs = db.list_kbs(None)
        else:
            kbs = [k for k in self._kbs if not k.get("deleted_at")]
        if user_id is None:
            return [dict(k) for k in kbs]
        is_admin = self._is_admin(user_id)
        result: list[dict[str, Any]] = []
        for k in kbs:
            if is_admin or k.get("user_id") == user_id:
                perm = "owner"
            else:
                perm = self.get_share_permission(k["id"], user_id)
                if perm is None:
                    continue
            kk = dict(k)
            kk["permission"] = perm
            result.append(kk)
        return result

    def create_kb(
        self, name: str, description: str | None = None, user_id: str | None = None
    ) -> dict[str, Any]:
        kb = {
            "id": uuid.uuid4().hex,
            "name": name,
            "description": description,
            "created_at": time.time(),
            "user_id": user_id,
        }
        if self._backend == "db":
            db.create_kb(kb)
        else:
            self._kbs.append(kb)
            self._save()
        return kb

    def get_kb(self, kb_id: str, user_id: str | None = None) -> dict[str, Any] | None:
        if self._backend == "db":
            kb = db.get_kb(kb_id)
        else:
            kb = next(
                (k for k in self._kbs if k["id"] == kb_id and not k.get("deleted_at")),
                None,
            )
            kb = dict(kb) if kb else None
        if kb is None:
            return None
        if user_id is None:
            return kb
        if self.kb_permission(kb_id, user_id) is not None:
            return kb
        return None

    def update_kb(
        self,
        kb_id: str,
        name: Any = _UNSET,
        description: Any = _UNSET,
        user_id: str | None = None,
    ) -> dict[str, Any] | None:
        """更新知识库字段，_UNSET 表示不修改。仅属主/管理员可改，否则返回 None。"""
        if self._backend == "db":
            kb = db.get_kb(kb_id)
        else:
            kb = next((k for k in self._kbs if k["id"] == kb_id), None)
        if kb is None:
            return None
        if user_id is not None and self.kb_permission(kb_id, user_id) != "owner":
            return None
        if self._backend == "db":
            return db.update_kb(kb_id, name, description)
        if name is not _UNSET:
            kb["name"] = name
        if description is not _UNSET:
            kb["description"] = description
        self._save()
        return dict(kb)

    def count_docs(self, kb_id: str, user_id: str | None = None) -> int:
        if self._backend == "db":
            return db.count_docs(kb_id)
        return sum(1 for d in self._docs if d.get("kb_id") == kb_id and not d.get("deleted_at"))

    def delete_kb(self, kb_id: str, user_id: str | None = None) -> bool:
        """软删除知识库：标记 kb + 其下文档/文件夹 deleted_at。仅属主/管理员可删。"""
        if self._backend == "db":
            if user_id is not None:
                kb = db.get_kb(kb_id)
                if kb is None or self.kb_permission(kb_id, user_id) != "owner":
                    return False
            return db.delete_kb(kb_id)
        existed = any(
            k["id"] == kb_id
            and not k.get("deleted_at")
            and (user_id is None or self.kb_permission(kb_id, user_id) == "owner")
            for k in self._kbs
        )
        if not existed:
            return False
        now = time.time()
        for k in self._kbs:
            if k["id"] == kb_id:
                k["deleted_at"] = now
        for d in self._docs:
            if d.get("kb_id") == kb_id:
                d["deleted_at"] = now
        for f in self._folders:
            if f.get("kb_id") == kb_id:
                f["deleted_at"] = now
        self._save()
        return True

    # ---------- 最近浏览 ----------

    def record_recent(self, doc_id: str, user_id: str | None = None) -> dict[str, Any] | None:
        """记录一次浏览（同 doc_id 去重只保留最新）。文档不存在返回 None。"""
        doc = self.get(doc_id, user_id)
        if doc is None:
            return None
        kb_id = doc.get("kb_id")
        uid = doc.get("user_id") if user_id is None else user_id
        if self._backend == "db":
            return db.record_recent(doc_id, kb_id, uid)
        self._recent = [r for r in self._recent if r.get("doc_id") != doc_id]
        rec = {
            "id": uuid.uuid4().hex,
            "doc_id": doc_id,
            "kb_id": kb_id,
            "user_id": uid,
            "viewed_at": time.time(),
        }
        self._recent.append(rec)
        self._save()
        return rec

    def list_recent(self, limit: int = 20, user_id: str | None = None) -> list[dict[str, Any]]:
        """按 viewed_at 倒序返回最近浏览，join 文档 title/source。"""
        if self._backend == "db":
            return db.list_recent(limit, user_id)
        recs = [
            r for r in self._recent if user_id is None or r.get("user_id") == user_id
        ]
        recs = sorted(recs, key=lambda r: r.get("viewed_at", 0), reverse=True)
        out: list[dict[str, Any]] = []
        for r in recs[:limit]:
            doc = next((d for d in self._docs if d["id"] == r["doc_id"]), None)
            out.append(
                {
                    "doc_id": r["doc_id"],
                    "kb_id": r.get("kb_id"),
                    "viewed_at": r["viewed_at"],
                    "title": doc["title"] if doc else None,
                    "source": doc["source"] if doc else None,
                }
            )
        return out

    # ---------- 用户 ----------

    def create_user(
        self,
        username: str,
        password_hash: str,
        role: str = "user",
        nickname: str | None = None,
        email: str | None = None,
        avatar: str | None = None,
    ) -> dict[str, Any] | None:
        """创建用户；用户名已存在返回 None。"""
        if self._backend == "db":
            return db.create_user(username, password_hash, role, nickname, email, avatar)
        if any(u["username"] == username for u in self._users):
            return None
        now = time.time()
        user = {
            "id": uuid.uuid4().hex,
            "username": username,
            "password_hash": password_hash,
            "role": role,
            "nickname": nickname or username,
            "email": email,
            "avatar": avatar,
            "status": "active",
            "created_at": now,
            "updated_at": now,
        }
        self._users.append(user)
        self._save()
        return {k: v for k, v in user.items() if k != "password_hash"}

    def get_user_by_username(self, username: str) -> dict[str, Any] | None:
        if self._backend == "db":
            return db.get_user_by_username(username)
        for u in self._users:
            if u["username"] == username:
                return dict(u)
        return None

    def get_user_by_id(self, user_id: str) -> dict[str, Any] | None:
        if self._backend == "db":
            return db.get_user_by_id(user_id)
        for u in self._users:
            if u["id"] == user_id:
                return dict(u)
        return None

    def list_users(self) -> list[dict[str, Any]]:
        if self._backend == "db":
            return db.list_users()
        return [dict(u) for u in self._users]

    def update_user(
        self,
        user_id: str,
        password_hash: Any = _UNSET,
        role: Any = _UNSET,
        nickname: Any = _UNSET,
        email: Any = _UNSET,
        avatar: Any = _UNSET,
        status: Any = _UNSET,
    ) -> dict[str, Any] | None:
        if self._backend == "db":
            return db.update_user(
                user_id, password_hash, role, nickname, email, avatar, status
            )
        for u in self._users:
            if u["id"] == user_id:
                if password_hash is not _UNSET:
                    u["password_hash"] = password_hash
                if role is not _UNSET:
                    u["role"] = role
                if nickname is not _UNSET:
                    u["nickname"] = nickname
                if email is not _UNSET:
                    u["email"] = email
                if avatar is not _UNSET:
                    u["avatar"] = avatar
                if status is not _UNSET:
                    u["status"] = status
                u["updated_at"] = time.time()
                self._save()
                return dict(u)
        return None

    def delete_user(self, user_id: str) -> bool:
        if self._backend == "db":
            return db.delete_user(user_id)
        before = len(self._users)
        self._users = [u for u in self._users if u["id"] != user_id]
        if len(self._users) != before:
            self._save()
            return True
        return False


store = DocStore()


def _segment(text: str, size: int = 400) -> list[str]:
    """简单分片：按段落/句子切分，控制每片长度"""
    # 先按空行分段
    paras = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    chunks: list[str] = []
    for para in paras:
        if len(para) <= size:
            chunks.append(para)
        else:
            # 长段落按句子切
            sentences = re.split(r"(?<=[。！？.!?])\s*", para)
            buf = ""
            for s in sentences:
                if len(buf) + len(s) <= size:
                    buf += s
                else:
                    if buf:
                        chunks.append(buf)
                    buf = s
            if buf:
                chunks.append(buf)
    return chunks


def _cosine(a: list[float], b: list[float]) -> float:
    """余弦相似度"""
    dot = sum(x * y for x, y in zip(a, b))
    na = sum(x * x for x in a) ** 0.5
    nb = sum(x * x for x in b) ** 0.5
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def _candidates_from_docs(docs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """把「文档 + chunks」结构拍平成 chunk 级候选（JSON 全量扫描用）。"""
    candidates: list[dict[str, Any]] = []
    for doc in docs:
        chunks = doc.get("chunks")
        if not chunks:
            chunks = [{"text": c, "vector": None} for c in _segment(doc["text"])]
        for i, chunk in enumerate(chunks):
            candidates.append(
                {
                    "doc_id": doc["id"],
                    "title": doc["title"],
                    "source": doc["source"],
                    "segment_index": i,
                    "text": chunk["text"],
                    "vector": chunk.get("vector"),
                }
            )
    return candidates


def _score_candidates(
    candidates: list[dict[str, Any]],
    keywords: list[str],
    query_vec: list[float] | None,
) -> list[dict[str, Any]]:
    """在候选 chunk 上做关键词 + 向量加权打分（保留在 Python 层）。"""
    results: list[dict[str, Any]] = []
    for chunk in candidates:
        text = chunk["text"]
        lower_text = text.lower()

        # 关键词分数
        kw_score = 0.0
        for kw in keywords:
            if kw in lower_text:
                kw_score += 1.0 + (0.5 if kw in _tokenize(text) else 0.0)

        # 向量相似度
        vec_score = 0.0
        if query_vec is not None and chunk.get("vector"):
            vec_score = _cosine(query_vec, chunk["vector"])

        # 混合：关键词归一 + 向量加权（向量权重 0.7）
        score = kw_score / max(1, len(keywords)) * 0.3 + vec_score * 0.7

        if kw_score > 0 or vec_score > 0.3:
            results.append(
                {
                    "doc_id": chunk["doc_id"],
                    "title": chunk["title"],
                    "source": chunk["source"],
                    "text": text[:500],
                    "segment_index": chunk["segment_index"],
                    "score": score,
                }
            )
    results.sort(key=lambda x: x["score"], reverse=True)
    return results


def search(query: str, top_k: int = 5, user_id: str | None = None) -> list[dict[str, Any]]:
    """混合检索：jieba 关键词 + 向量相似度粗召回，再用 rerank 精排（若可用）。

    user_id 提供时仅在该用户文档内检索。
    """
    keywords = _tokenize(query)
    if not keywords:
        keywords = [query.strip().lower()]

    # query 向量（若 embedding 可用）
    query_vec = embedding.embed([query])[0] if embedding.available() else None

    # 候选召回：DB 路径用 pgvector <=> 召回；JSON 路径全量扫描
    if db.available():
        if query_vec is not None:
            kb_ids = store._accessible_kb_ids(user_id) if user_id is not None else None
            candidates = db.search_chunks(query_vec, max(20, top_k * 4), user_id, kb_ids)
        else:
            candidates = _candidates_from_docs(store.all(user_id=user_id))
    else:
        candidates = _candidates_from_docs(store.all(user_id=user_id))

    results = _score_candidates(candidates, keywords, query_vec)

    # Rerank 精排：粗召回取 top_k*4 候选，rerank 后取 top_k
    if rerank.available() and len(results) > top_k:
        candidates = results[: top_k * 4]
        ranked = rerank.rerank(query, [c["text"] for c in candidates], top_k)
        if ranked:
            reranked = []
            for idx, rel in ranked:
                item = dict(candidates[idx])
                item["score"] = rel  # 用相关分数覆盖，便于排序
                reranked.append(item)
            return reranked

    return results[:top_k]
