"""应用配置"""
import os
from pathlib import Path

from dotenv import load_dotenv

# app/core/config.py -> app/core -> app -> (项目根 api/)
BASE_DIR = Path(__file__).resolve().parent.parent.parent

# 加载 api/.env（若存在）
load_dotenv(BASE_DIR / ".env")

# 文档存储目录（生产环境通过环境变量 SUNNYDOC_DATA_DIR 指向数据盘，如 /data/sunnydoc）
DATA_DIR = Path(os.getenv("SUNNYDOC_DATA_DIR", str(BASE_DIR / "data")))
DOCS_DIR = DATA_DIR / "docs"
MEDIA_DIR = DATA_DIR / "media"

# PostgreSQL + pgvector（未配置则降级为 JSON 文件存储）
DATABASE_URL = os.getenv("DATABASE_URL", "")

# 支持的文本格式（扩展名）
TEXT_EXTS = {".md", ".markdown", ".txt", ".text", ".json", ".csv", ".tsv"}
BINARY_EXTS = {".pdf", ".docx", ".xlsx"}

# 检索相关
DEFAULT_TOP_K = 5

# LLM 配置（OpenAI 兼容接口，未配置则降级为规则式回答）
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
LLM_MODEL = os.getenv("LLM_MODEL", "qwen3-max")

# Embedding 配置（OpenAI 兼容接口，未配置则降级为纯关键词检索）
EMBEDDING_API_KEY = os.getenv("EMBEDDING_API_KEY", "")
EMBEDDING_BASE_URL = os.getenv("EMBEDDING_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "text-embedding-v4")

# Rerank 配置（qwen3-rerank 走 compatible-api 接口）
RERANK_BASE_URL = os.getenv("RERANK_BASE_URL", "https://dashscope.aliyuncs.com/compatible-api/v1")
RERANK_MODEL = os.getenv("RERANK_MODEL", "qwen3-rerank")


# ---------- 运行时 AI 配置（可在设置页修改，覆盖环境变量默认值） ----------

# 单个 AI 配置键，存到 settings 键值存储
AI_SETTINGS_KEY = "ai_config"


def _ai_from_settings() -> dict | None:
    """从 settings 存储读取运行时 AI 配置；无则 None。

    延迟 import，避免 core.config 被 services 反向依赖形成循环。
    """
    try:
        from app.services.settings import get_json

        return get_json(AI_SETTINGS_KEY)
    except Exception:  # noqa: BLE001
        return None


def ai_config() -> dict:
    """合并环境变量默认值与运行时设置，返回完整 AI 配置。"""
    cfg = {
        "provider": os.getenv("AI_PROVIDER", "custom"),
        "llm_base_url": LLM_BASE_URL,
        "llm_api_key": LLM_API_KEY,
        "llm_model": LLM_MODEL,
        "embedding_base_url": EMBEDDING_BASE_URL,
        "embedding_api_key": EMBEDDING_API_KEY,
        "embedding_model": EMBEDDING_MODEL,
        "rerank_base_url": RERANK_BASE_URL,
        "rerank_model": RERANK_MODEL,
    }
    saved = _ai_from_settings()
    if isinstance(saved, dict):
        for k, v in saved.items():
            if k in cfg and v not in (None, ""):
                cfg[k] = v
            elif k in cfg and v in (None, ""):
                # 允许显式清空
                cfg[k] = ""
    return cfg
