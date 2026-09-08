# sunnydoc 知库

<div align="center">

**以文档为核心、支持 AI 问答与引用溯源的私有知识库**

一个开箱即用的个人/团队文档知识库：多知识库管理、文档导入解析、全文检索、RAG 问答与引用溯源，Obsidian 风格三栏界面。

[特性](#-功能特性) · [技术栈](#-技术架构) · [快速开始](#-快速开始) · [部署](#-部署) · [目录结构](#-目录结构)

</div>

## ✨ 功能特性

- **多知识库**：创建 / 编辑 / 删除知识库，卡片式首页 + 最近浏览。
- **文档管理**：新建、编辑、删除、**拖拽移动**文档；多级文件夹（新建 / 重命名 / 删除）。
- **灵活排序**：文件树支持按**数字前缀**（`01-`、`02-` 数值序）、名称、**创建时间**三种排序。
- **多格式导入**：`md` / `txt` / `json` / `csv` / `pdf` / `docx` / `xlsx` / `zip`，zip 自动还原目录结构，异步解析 + 实时进度。
- **多格式导出**：`md` / `docx` / `pdf` / `html` / `json` / `zip`。
- **全文搜索**：侧栏搜索框实时检索标题 + 正文，命中关键词高亮并定位到文档。
- **AI 问答**：RAG 检索增强（关键词 + 向量混合召回、Rerank 精排）、**引用溯源**、联网搜索兜底、流式输出。
- **用户体系**：注册 / 登录 / 退出，密码 pbkdf2 加盐哈希，token 会话。
- **体验细节**：明暗主题、命令面板（⌘K）、中文分词（jieba）、Obsidian 风格三栏 UI。

## 🧱 技术架构

| 层 | 技术选型 |
| --- | --- |
| 前端 | Next.js 16 + React 19 + TypeScript + Tailwind CSS 4 |
| 后端 | Python 3.12 + FastAPI + Uvicorn |
| 存储 | PostgreSQL + pgvector（未配置时优雅降级为 JSON 文件存储） |
| 文档解析 | PyMuPDF（PDF）、python-docx（Word）、openpyxl（Excel） |
| 检索 | jieba 分词 + Embedding 向量召回 + Rerank 精排 |
| 导出 | reportlab（PDF）、markdown、python-docx |
| 模型 | 阿里云百炼：qwen3-max（LLM）、text-embedding-v4（向量）、qwen3-rerank（重排） |

### 检索问答链路

```
文档导入 → 解析/分片 → 向量化入库（pgvector）
                              ↓
用户提问 → 关键词+向量混合召回 → Rerank 精排 → LLM 生成 → 引用溯源
                              ↓
        未命中 → 联网搜索 → 流式返回
```

## 🚀 快速开始

### 1. 启动数据库（可选，不配则用 JSON 存储）

```bash
cd api
docker compose up -d   # pgvector/pgvector:pg16
```

### 2. 启动后端

```bash
cd api
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env    # 按需填入 LLM / Embedding / DATABASE_URL

.venv/bin/uvicorn app.main:app --reload --port 8000
```

- API 文档：http://localhost:8000/docs
- 不配置 `.env` 也能启动：LLM 降级为规则回答，检索降级为纯关键词，存储降级为 JSON。

### 3. 启动前端

```bash
cd web
npm install
npm run dev             # http://localhost:3000
```

本地开发默认后端地址为 `http://localhost:8000/api/v1`（见 `web/.env.local`）。

### 4. 首次使用

访问前端 → 注册账号登录 → 创建知识库 → 导入文档 → 开始检索问答。

## 🚢 部署

生产部署为一键脚本（构建前端静态产物 → 上传服务器 → 重启后端 → 推送 GitHub）：

```bash
./deploy.sh "feat: 提交说明"
```

- **前端**：`next build` 静态导出到 `web/out`，由 nginx 托管。
- **后端**：`systemd` 管理 `uvicorn`（`sunnydoc-api.service`），监听 `127.0.0.1:8000`。
- **反向代理**：nginx 托管静态文件并将 `/api/` 反代到后端。
- **环境变量**：服务器上的 `api/.env` 由服务器自行维护，部署脚本不会覆盖（`DATABASE_URL`、模型密钥等）。
- 构建命令会显式置空 `NEXT_PUBLIC_API_BASE`，使前端走相对路径 `/api/v1`，避免把本地开发地址打进生产包。

## 📁 目录结构

```
sunnydoc/
├── web/                        # 前端（Next.js 16）
│   ├── src/
│   │   ├── app/                # 页面、布局、全局样式
│   │   │   ├── page.tsx        # 主页面（视图路由、状态编排、登录守卫）
│   │   │   └── globals.css     # 设计变量 + 主题 + 组件样式
│   │   ├── components/         # UI 组件
│   │   │   ├── Sidebar.tsx     # 侧栏（文件树 / 搜索 / 排序 / 新建）
│   │   │   ├── FileTree.tsx    # 文件树（拖拽移动 / 重命名 / 删除）
│   │   │   ├── Editor.tsx      # Markdown 编辑器（预览 / 编辑 / 高亮）
│   │   │   ├── AiPanel.tsx     # AI 问答面板
│   │   │   ├── HomeView.tsx    # 首页（知识库卡片 / 最近浏览）
│   │   │   ├── LoginView.tsx   # 登录 / 注册
│   │   │   └── ...             # 各类对话框、命令面板等
│   │   ├── lib/                # 工具（api 客户端 / markdown / 树构建）
│   │   └── data/               # 类型定义
│   └── public/
├── api/                        # 后端（FastAPI）
│   ├── app/
│   │   ├── api/routes.py       # 路由（文档 / 文件夹 / 知识库 / 搜索 / 导出 / 认证）
│   │   ├── core/config.py      # 配置（环境变量 / 模型）
│   │   └── services/           # 业务服务
│   │       ├── store.py        # 存储（Postgres / JSON 降级）
│   │       ├── db.py           # PostgreSQL + pgvector 数据层
│   │       ├── parser.py       # 文档解析（pdf/docx/xlsx/zip）
│   │       ├── qa.py           # 问答编排
│   │       ├── llm.py          # LLM 调用（流式）
│   │       ├── embedding.py    # 向量化
│   │       ├── rerank.py       # 重排
│   │       ├── web_search.py   # 联网搜索
│   │       ├── exporter.py     # 多格式导出
│   │       └── auth.py         # 认证（密码哈希 / token）
│   ├── scripts/                # 迁移脚本
│   ├── requirements.txt
│   └── docker-compose.yml      # pgvector 数据库
├── deploy.sh                   # 一键部署 + 推送脚本
└── README.md
```

## 📄 许可证

待定
