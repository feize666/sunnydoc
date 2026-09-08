# sunnydoc API

文档知识库后端（FastAPI）。MVP 阶段：文档上传解析 → 关键词检索 → 问答 + 引用溯源。

## 运行

```bash
# 创建虚拟环境（首次）
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

# 启动（开发）
.venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/health` | 健康检查 |
| GET | `/api/v1/documents` | 文档列表 |
| POST | `/api/v1/documents/import` | 上传文档（md/txt/json/csv/pdf/docx/xlsx/zip） |
| POST | `/api/v1/chat` | 问答（返回 answer + citations） |
| DELETE | `/api/v1/documents/{doc_id}` | 删除文档 |

## 目录结构

```
api/
├── app/
│   ├── main.py            # 应用入口
│   ├── api/routes.py      # 路由
│   ├── core/config.py     # 配置
│   └── services/
│       ├── parser.py      # 多格式解析（pdf/docx/xlsx/zip）
│       ├── store.py       # 文档存储 + 分片 + 关键词检索
│       └── qa.py          # 问答（检索 + 引用）
└── requirements.txt
```

## 后续规划

- [ ] 接入 Embedding 模型（向量化）
- [ ] PostgreSQL + pgvector（替换 JSON 存储）
- [ ] 混合检索（BM25 + 向量）+ Rerank
- [ ] LLM 生成回答（替换规则式回答）
