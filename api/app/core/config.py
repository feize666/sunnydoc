"""应用配置"""
import os
from pathlib import Path

from dotenv import load_dotenv

# app/core/config.py -> app/core -> app -> (项目根 api/)
BASE_DIR = Path(__file__).resolve().parent.parent.parent

# 加载 api/.env（若存在）
load_dotenv(BASE_DIR / ".env")

# 文档存储目录
DATA_DIR = BASE_DIR / "data"
DOCS_DIR = DATA_DIR / "docs"

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
