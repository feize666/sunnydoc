"""AI 设置的分组检测与密钥边界；全部 mock HTTP，不访问供应商、不改真实配置。"""
import httpx
import pytest

from app.api import routes


SAVED = {
    "llm_base_url": "https://chat.example/v1", "llm_api_key": "chat-secret", "llm_model": "chat-model",
    "embedding_base_url": "https://embed.example/v1", "embedding_api_key": "embed-secret", "embedding_model": "embed-model",
    "rerank_base_url": "https://rank.example/v1", "rerank_model": "rank-model",
}


def test_saved_secret_is_selected_per_group(monkeypatch):
    monkeypatch.setattr(routes, "ai_config", lambda: SAVED)
    assert routes._resolve_test_params(routes.AITestRequest(saved=True, group="embedding")) == (
        "embedding", "https://embed.example/v1", "embed-secret", "embed-model",
    )
    assert routes._resolve_test_params(routes.AITestRequest(saved=True, group="rerank")) == (
        "rerank", "https://rank.example/v1", "embed-secret", "rank-model",
    )


def test_explicit_secret_wins_and_saved_false_cannot_read_server_secret(monkeypatch):
    monkeypatch.setattr(routes, "ai_config", lambda: SAVED)
    assert routes._resolve_test_params(routes.AITestRequest(
        base_url="https://new.example/v1", api_key="new-secret", model="new-model", group="embedding",
    )) == ("embedding", "https://new.example/v1", "new-secret", "new-model")
    assert routes._resolve_test_params(routes.AITestRequest(
        base_url="https://new.example/v1", model="new-model", group="embedding",
    )) == ("embedding", "https://new.example/v1", "", "new-model")


def test_saved_rerank_base_falls_back_to_llm_and_explicit_values_win(monkeypatch):
    saved = {**SAVED, "rerank_base_url": ""}
    monkeypatch.setattr(routes, "ai_config", lambda: saved)
    assert routes._resolve_test_params(routes.AITestRequest(saved=True, group="rerank")) == (
        "rerank", "https://chat.example/v1", "embed-secret", "rank-model",
    )
    assert routes._resolve_test_params(routes.AITestRequest(
        base_url="https://new-rank.example/v1", api_key="new-rank-secret",
        model="new-rank-model", group="rerank", saved=True,
    )) == ("rerank", "https://new-rank.example/v1", "new-rank-secret", "new-rank-model")


def test_saved_false_still_tests_explicit_new_llm_credentials(monkeypatch):
    calls = []
    monkeypatch.setattr(routes.llm, "test_connection", lambda *args: calls.append(args) or {"ok": True})
    routes.test_ai_settings(routes.AITestRequest(
        base_url="https://new.example/v1", api_key="new-secret", model="new-model",
    ), {"role": "admin"})
    assert calls == [("https://new.example/v1", "new-secret", "new-model")]


def test_rerank_explicit_key_wins_even_when_saved_fallback_is_enabled(monkeypatch):
    monkeypatch.setattr(routes, "ai_config", lambda: SAVED)
    assert routes._resolve_test_params(routes.AITestRequest(
        api_key="current-chat-secret", group="rerank", saved=True,
    )) == ("rerank", "https://rank.example/v1", "current-chat-secret", "rank-model")


@pytest.mark.parametrize("group,path,key_name", [
    ("embedding", "embeddings", "data"),
    ("rerank", "reranks", "results"),
])
def test_minimal_group_protocols(monkeypatch, group, path, key_name):
    seen = {}
    item = {"index": 0} if key_name == "data" else {"index": 0, "relevance_score": 1}
    payload = {key_name: [item]}
    def post(url, **kwargs):
        seen.update(url=url, **kwargs)
        request = httpx.Request("POST", url)
        return httpx.Response(200, request=request, json=payload)
    monkeypatch.setattr(routes.httpx, "post", post)
    out = routes._test_minimal_connection(group, "https://service.example/v1/", "secret", "model")
    assert out["ok"] is True
    assert seen["url"] == f"https://service.example/v1/{path}"
    assert seen["headers"] == {"Authorization": "Bearer secret"}
    assert seen["json"]["model"] == "model"
    assert ("input" in seen["json"]) if group == "embedding" else ("documents" in seen["json"])


def test_minimal_protocol_failure_is_not_a_false_success(monkeypatch):
    def post(url, **kwargs):
        return httpx.Response(200, request=httpx.Request("POST", url), json={"unexpected": True})
    monkeypatch.setattr(routes.httpx, "post", post)
    out = routes._test_minimal_connection("embedding", "https://service.example/v1", "secret", "model")
    assert out["ok"] is False
    assert "响应缺少预期" in out["detail"]
    assert "secret" not in str(out)


def test_model_fetch_uses_group_saved_secret_without_echo(monkeypatch):
    calls = []
    monkeypatch.setattr(routes, "ai_config", lambda: SAVED)
    monkeypatch.setattr(routes.llm, "fetch_models", lambda base, key: calls.append((base, key)) or {"ok": True, "models": []})
    out = routes.list_ai_models(routes.AITestRequest(saved=True, group="embedding"), {"role": "admin"})
    assert calls == [("https://embed.example/v1", "embed-secret")]
    assert "embed-secret" not in str(out)
