"""Embedding 服务：OpenAI 兼容接口，未配置时降级为 None"""
from __future__ import annotations

import json
from typing import Any

import httpx

from app.core.config import ai_config


def _cfg() -> dict:
    """每次调用时动态读取配置。"""
    return ai_config()


def available() -> bool:
    c = _cfg()
    return bool(c.get("embedding_api_key") and c.get("embedding_base_url") and c.get("embedding_model"))


# 复用的 HTTP 客户端。
#
# ⚠️ 不要退回 `httpx.post(...)`：那是「每次调用新建一个连接」的简写，
# 一篇 300 段的文档要发 30 个批次 → 30 次 TLS 握手。实测 13k 字文档保存时
# SSL 握手累计 9.6s（占端到端 12.6s 的 76%），而真正的向量计算只占小头。
# AsyncClient/Client 带连接池，握手只发生一次。
_client: httpx.Client | None = None


def _get_client() -> httpx.Client:
    """惰性创建带连接池的客户端（单进程复用同一池）。"""
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.Client(
            # 连接复用：单篇文档最多 30 批次，池子给 10 足够，多余批次排队而非重建连接。
            limits=httpx.Limits(max_connections=10, max_keepalive_connections=10),
            # 向量接口偶发慢响应，读超时给足；连接超时短一些以便快速失败重试。
            timeout=httpx.Timeout(60.0, connect=10.0),
        )
    return _client


def embed(texts: list[str]) -> list[list[float]] | None:
    """批量向量化；未配置或失败时返回 None。

    部分 embedding 服务（如阿里云百炼 text-embedding-v4）限制单次批量 ≤10 条，
    这里按 10 条一批拆分调用，再按批次顺序拼回，保证顺序与输入一致。

    ⚠️ 顺序对齐是这里唯一的难点，务必理解再改：
        服务端返回的 `index` 是**批内局部**索引 —— 不论你分几批，
        每批返回的都是 0,1,2,...（实测阿里云百炼如此）。因此：
          · 只能在**批内**按 index 排序；
          · 跨批次必须靠 `items.extend` 的调用顺序拼接；
          · **绝不能**对所有批次做一次 `items.sort(key=index)` —— 那会把
            各批次的第 0 项排在一起、第 1 项排在一起……导致向量与文本整体错配。
        该缺陷曾静默存在：>10 个分片（约 4000 字以上）的文档向量全部错位，
        搜索仍能返回结果，只是指向错误的位置，不会报错、极难察觉。
    """
    if not available():
        return None
    if not texts:
        return None

    cfg = _cfg()
    url = f"{cfg.get('embedding_base_url', '').rstrip('/')}/embeddings"
    headers = {"Authorization": f"Bearer {cfg.get('embedding_api_key')}"}
    model = cfg.get("embedding_model")

    BATCH_SIZE = 10
    items: list[dict[str, Any]] = []
    try:
        client = _get_client()
        for i in range(0, len(texts), BATCH_SIZE):
            batch = texts[i : i + BATCH_SIZE]
            resp = client.post(
                url,
                headers=headers,
                json={"model": model, "input": batch},
            )
            resp.raise_for_status()
            data: list[dict[str, Any]] = resp.json()["data"]
            if len(data) != len(batch):
                # 条数对不上就别猜了：直接降级为「无向量」，交由上层按需重算。
                return None
            # 批内按 index 排序（防止服务端乱序返回），再按批次顺序 extend。
            items.extend(sorted(data, key=lambda x: x["index"]))
    except (httpx.HTTPError, KeyError, IndexError, json.JSONDecodeError):
        return None

    return [item["embedding"] for item in items]
