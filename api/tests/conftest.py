"""pytest 全局配置：注入 api 目录到 sys.path，并隔离数据库连接。"""
import os
import sys
from pathlib import Path

# 确保能 import app.* 模块
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# 测试环境不连数据库：强制走 JSON 降级后端（store 的 _tokenize/_segment 等纯函数不依赖 DB）
os.environ.pop("DATABASE_URL", None)
