"""应用配置"""
from pathlib import Path

# app/core/config.py -> app/core -> app -> (项目根 api/)
BASE_DIR = Path(__file__).resolve().parent.parent.parent

# 文档存储目录
DATA_DIR = BASE_DIR / "data"
DOCS_DIR = DATA_DIR / "docs"

# 支持的文本格式（扩展名）
TEXT_EXTS = {".md", ".markdown", ".txt", ".text", ".json", ".csv", ".tsv"}
BINARY_EXTS = {".pdf", ".docx", ".xlsx"}

# 检索相关
DEFAULT_TOP_K = 5
