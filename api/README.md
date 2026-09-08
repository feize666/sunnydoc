# sunnydoc API

文档知识库后端（FastAPI）：文档上传解析 → 分片向量化 → 混合检索 → 问答 + 引用溯源。

## 运行

```bash
# 创建虚拟环境（首次）
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

# 启动（开发）
.venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

不配置 `.env` 也能启动：LLM 降级为规则回答、检索降级为纯关键词、存储降级为 JSON。

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

-- 文档 / 分片（含向量）
CREATE TABLE IF NOT EXISTS documents (id varchar PRIMARY KEY, title text, text text,
    source text, ext text, created_at double precision,
    folder_id varchar, kb_id varchar);
CREATE TABLE IF NOT EXISTS chunks (id serial PRIMARY KEY,
    doc_id varchar REFERENCES documents(id) ON DELETE CASCADE,
    segment_index integer, text text, vector vector);

-- 文件夹 / 知识库 / 最近浏览 / 用户
CREATE TABLE IF NOT EXISTS folders (id varchar PRIMARY KEY, name text,
    parent_id varchar, created_at double precision, kb_id varchar);
CREATE TABLE IF NOT EXISTS knowledge_bases (id varchar PRIMARY KEY, name text,
    description text, created_at double precision);
CREATE TABLE IF NOT EXISTS recent_views (id varchar PRIMARY KEY, doc_id varchar,
    kb_id varchar, viewed_at double precision);
CREATE TABLE IF NOT EXISTS users (id varchar PRIMARY KEY, username varchar UNIQUE,
    password_hash text, created_at double precision);
```

## 数据迁移（JSON → PostgreSQL）

```bash
cd api
docker compose up -d                          # 1. 启动 Postgres
.venv/bin/python3 scripts/migrate_json_to_pg.py  # 2. 迁移（幂等，按 doc id 先删后插）
```

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/health` | 健康检查 |
| GET | `/api/v1/kbs` | 知识库列表（含文档数） |
| POST/PUT/DELETE | `/api/v1/kbs[/{id}]` | 知识库增改删 |
| GET | `/api/v1/documents` | 文档列表（可按 `kb_id` 过滤） |
| POST | `/api/v1/documents` | 新建文档 |
| GET/PUT/DELETE | `/api/v1/documents/{id}` | 文档详情 / 更新（含移动）/ 删除 |
| POST | `/api/v1/documents/import` | 上传导入（异步，返回 task_id） |
| GET | `/api/v1/documents/import/{task_id}` | 查询导入进度 |
| GET/POST/PUT/DELETE | `/api/v1/folders[/{id}]` | 文件夹增查改（重命名）删 |
| GET | `/api/v1/search` | 全文搜索（`q` + 可选 `kb_id`） |
| POST | `/api/v1/chat` | 问答（answer + citations） |
| POST | `/api/v1/chat/stream` | 流式问答（SSE） |
| POST | `/api/v1/export` | 多格式导出（md/docx/pdf/html/json/zip） |
| GET/POST | `/api/v1/recent` | 最近浏览 |
| POST | `/api/v1/auth/register` | 注册（返回 token + user） |
| POST | `/api/v1/auth/login` | 登录（返回 token + user） |
| GET | `/api/v1/auth/me` | 当前用户（`Authorization: Bearer <token>`） |
| POST | `/api/v1/auth/logout` | 退出（吊销 token） |

## 目录结构

```
api/
├── app/
│   ├── main.py            # 应用入口
│   ├── api/routes.py      # 路由
│   ├── core/config.py     # 配置
│   └── services/
│       ├── parser.py      # 多格式解析（pdf/docx/xlsx/zip/md）
│       ├── store.py       # 存储（PG/pgvector 优先，JSON 降级）+ 检索
│       ├── db.py          # PostgreSQL 连接管理 + CRUD
│       ├── qa.py          # 问答编排
│       ├── llm.py         # LLM 流式生成
│       ├── embedding.py   # 向量化
│       ├── rerank.py      # 重排精排
│       ├── web_search.py  # 联网搜索
│       ├── exporter.py    # 多格式导出
│       └── auth.py        # 认证（密码哈希 + token）
├── scripts/               # 迁移脚本
├── docker-compose.yml     # 带 pgvector 的 Postgres 容器
└── requirements.txt
```

## 认证说明

- 密码使用 `pbkdf2_hmac(sha256)` 加盐哈希，格式 `pbkdf2$salt_b64$dk_b64`。
- token 为进程内会话（单 worker 部署），服务重启后需重新登录；后续可升级为 JWT 或数据库会话表。
