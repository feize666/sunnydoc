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

## PostgreSQL 配置（可选）

存储层默认使用 JSON 文件（`data/store.json`）。配置 `DATABASE_URL` 后自动切换为
PostgreSQL + pgvector 存储；未配置或连接失败时优雅降级回 JSON，不影响启动。

### 1. 启动带 pgvector 的 Postgres（Docker）

```bash
cd api
docker compose up -d
```

镜像 `pgvector/pgvector:pg16`，默认库/用户/密码均为 `sunnydoc`，端口 `5432`。

### 2. 配置连接串

在 `api/.env` 中新增：

```bash
DATABASE_URL=postgresql://sunnydoc:sunnydoc@localhost:5432/sunnydoc
```

### 3. 表结构（启动时自动创建，幂等）

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS documents (
    id varchar PRIMARY KEY,
    title text,
    text text,
    source text,
    ext text,
    created_at double precision
);

CREATE TABLE IF NOT EXISTS chunks (
    id serial PRIMARY KEY,
    doc_id varchar REFERENCES documents(id) ON DELETE CASCADE,
    segment_index integer,
    text text,
    vector vector   -- 不固定维度，维度由 embedding 模型决定
);
```

文档与分片（含 1024 维向量）在 `add` 时写入；检索时用 pgvector `<=>` 余弦距离
做候选召回，关键词 + 向量加权打分仍在 Python 层完成。

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
│       ├── store.py       # 文档存储（PG/pgvector 优先，JSON 降级）+ 检索
│       ├── db.py          # PostgreSQL 连接管理 + CRUD
│       └── qa.py          # 问答（检索 + 引用）
├── docker-compose.yml     # 带 pgvector 的 Postgres 容器
└── requirements.txt
```

## 后续规划

- [ ] 接入 Embedding 模型（向量化）
- [x] PostgreSQL + pgvector（替换 JSON 存储，保留 JSON 降级）
- [ ] 混合检索（BM25 + 向量）+ Rerank
- [ ] LLM 生成回答（替换规则式回答）
