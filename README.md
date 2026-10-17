# sunnydoc 知库

<div align="center">

**以文档为核心、支持 AI 问答与引用溯源的私有知识库**

一个开箱即用的个人/团队知识库：多知识库管理、丰富的文档类型（富文本 / 流程图 / 思维导图 / 表格 / 数据表 / 画板）、文档导入解析、全文检索、RAG 问答与引用溯源，Obsidian 风格三栏界面。

当前版本 **[v2.0.0](CHANGELOG.md)** · [特性](#-功能特性) · [技术栈](#-技术架构) · [快速开始](#-快速开始) · [部署](#-部署) · [目录结构](#-目录结构)

</div>

## ✨ 功能特性

**知识组织**

- **多知识库**：创建 / 编辑 / 删除知识库，卡片式首页 + 最近浏览。
- **共享协作**：知识库授权给指定用户，可分别设**只读 / 可编辑**；只读用户仅可查看、搜索、问答。
- **文档管理**：新建、编辑、删除、**拖拽移动**文档；多级文件夹（新建 / 重命名 / 删除 / 跨知识库移动）。
- **批量操作**：文档树多选后**批量删除**（进回收站）/ **批量移动到其它知识库**；一键展开 / 折叠整个文档树（默认折叠）。
- **灵活排序**：文件树支持按**数字前缀**（`01-`、`02-` 数值序）、名称、**创建时间**三种排序。
- **版本历史**：文档每次保存留存历史版本，可查看差异并**一键回滚**。
- **标签体系**：给文档打标签、按标签筛选；侧栏标签管理支持**批量重命名 / 合并 / 删除**（改成已存在的标签名即合并，自动去重）。
- **回收站**：删除进回收站（软删除），30 天自动清理，可随时还原。

**编辑器**

- **富文本（所见即所得）**：基于 TipTap，含表格 / 任务列表 / 高亮 / 文字颜色 / 对齐 / 拖拽插图 / 附件挂载 / 划词 AI。
- **写作增强**：输入 `/` 唤起**块命令菜单**、`@` 提及成员、`[[` 插入**文档引用**（自动进反向链接）、**划词批注**（标记锚定正文，改文后仍尽量定位）。
- **卡片嵌入**：把其它文档作为**可编辑卡片**嵌入正文，就地编辑并写回来源文档。
- **五种图形编辑器**：流程图、思维导图、表格、数据表、画板 —— 支持形状库、模板、导出 `PNG` / `SVG` / `PDF`、泳道图、鱼骨图、Xmind 导入。
- **类型分工**：**表格**＝文档内嵌轻量表格（支持 `=SUM` / `=AVG` 等公式）；**数据表**＝独立结构化数据（列类型 + 筛选）。

**检索与 AI**

- **全文搜索**：标题 + 正文检索，中文分词（jieba）、命中词高亮、引用定位、类型过滤、搜索历史。
- **AI 问答**：RAG 检索增强（关键词 + 向量混合召回、Rerank 精排）、**引用溯源**（点击引用跳转并高亮原文）、多轮对话记忆、联网搜索兜底、流式输出。
- **AI 摘要与写作辅助**：一键生成文档摘要；编辑器内划词改写 / 续写。
- **智能体工具编排**：28 个语义化工具、分级执行（只读校验 vs 落库提交）。

**导入导出与体验**

- **多格式导入**：`md` / `txt` / `json` / `csv` / `pdf` / `docx` / `xlsx` / `zip` / `html`，zip 自动还原目录结构，异步解析 + 实时进度。
- **正文插图与附件**：编辑器内**粘贴或拖拽**图片即上传并插入正文；拖拽 / 选择 `pdf` / `docx` / `xlsx` / `zip` 等文件即作为附件挂载（下载时还原原始文件名）。附件走内容寻址存储，同文件只存一份。
- **多格式导出**：`md` / `docx` / `pdf` / `html` / `json` / `zip`。
- **图表模板**：流程图 / 思维导图可保存为本地模板一键复用，也可**发布到社区**共享；已发布的模板**作者本人可删除**（管理员可管理全部，后端校验越权返回 403）。
- **用户体系**：注册 / 登录 / 退出，密码 pbkdf2 加盐哈希，token 会话；角色（管理员 / 普通用户）、用户管理、个人信息、按用户数据隔离。
- **导航与适配**：3~4 级页面可到达（浏览器前进 / 后退可用）、PC 与移动端自适应、明暗主题（彩色切换）、命令面板（⌘K）、Obsidian 风格三栏 UI、大纲滚动高亮（scroll-spy）。

## 🧱 技术架构

| 层 | 技术选型 |
| --- | --- |
| 前端 | Next.js 16 + React 19 + TypeScript + Tailwind CSS 4 |
| 后端 | Python 3.12 + FastAPI + Uvicorn |
| 存储 | PostgreSQL + pgvector（未配置时优雅降级为 JSON 文件存储） |
| 文档解析 | PyMuPDF（PDF）、python-docx（Word）、openpyxl（Excel） |
| 检索 | jieba 分词 + Embedding 向量召回 + Rerank 精排 |
| 导出 | reportlab（PDF）、markdown、python-docx |
| 模型 | 阿里云百炼：qwen-plus（LLM，可换任意已开通型号）、text-embedding-v4（向量）、qwen3-rerank（重排） |

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

> **从 1.x（JSON 存储）升级**：配置好 `DATABASE_URL` 后执行一次迁移，脚本是流式且幂等的，
> 可重复运行；`store.json` 会保留为冷备份，不会删除。
>
> ```bash
> cd api && .venv/bin/python scripts/migrate_json_to_pg.py
> ```

### 3. 启动前端

```bash
cd web
npm install
npm run dev             # http://localhost:3001
```

前端端口固定为 **3001**（已写进 `web/package.json` 的 `dev` 脚本），
避免与机器上其他项目的 3000 端口互相混淆。

本地开发默认后端地址为 `http://localhost:8000/api/v1`（见 `web/.env.local`）。

### 4. 首次使用

访问前端 → 注册账号登录 → 创建知识库 → 导入文档 → 开始检索问答。

## 🚢 部署

> ⚠️ **线上环境已于 2026-09-22 拆除**，仓库中不再包含可直接使用的部署目标。
> 下面描述的是原来的单机部署形态（保留作为自建参考）；`deploy.sh` 中的服务器地址
> 已失效，请勿直接执行，需替换为你自己的目标。

原部署形态为单机三进程 + nginx：

- **前端**：`next build` 静态导出到 `web/out`，由 nginx 托管。
- **后端**：`systemd` 管理 `uvicorn`（`sunnydoc-api.service`），监听 `127.0.0.1:8000`。
- **数据库**：PostgreSQL + pgvector（本机实例）。
- **反向代理**：nginx 托管静态文件并将 `/api/` 反代到后端。
- **环境变量**：`api/.env` 由服务器自行维护（`DATABASE_URL`、模型密钥等），不随代码分发。
- 构建时会显式置空 `NEXT_PUBLIC_API_BASE`，使前端走相对路径 `/api/v1`，避免把本地开发地址打进生产包。

自建时按「[快速开始](#-快速开始)」跑通本地三件套（PostgreSQL + 后端 + 前端）后，
用 nginx 反代即可；`deploy.sh` 可作为打包与发布流程的起点，但需自行替换服务器与路径。

## 📁 目录结构

```
sunnydoc/
├── web/                        # 前端（Next.js 16）
│   ├── src/
│   │   ├── app/                # 页面、布局、全局样式
│   │   │   ├── page.tsx        # 主页面（视图路由、状态编排、登录守卫）
│   │   │   └── globals.css     # 设计变量 + 主题 + 组件样式
│   │   ├── components/         # UI 组件
│   │   │   ├── Sidebar.tsx     # 侧栏（文件树 / 搜索 / 排序 / 标签 / 新建）
│   │   │   ├── FileTree.tsx    # 文件树（拖拽移动 / 批量操作 / 多选）
│   │   │   ├── Editor.tsx      # 文档壳（视图切换 / 保存 / 协同事件）
│   │   │   ├── RichEditor.tsx  # 富文本编辑器（TipTap）
│   │   │   ├── FlowchartEditor.tsx   # 流程图编辑器
│   │   │   ├── MindMapEditor.tsx     # 思维导图编辑器
│   │   │   ├── TableEditor.tsx       # 表格编辑器
│   │   │   ├── DatasheetEditor.tsx   # 数据表编辑器
│   │   │   ├── BoardEditor.tsx       # 画板编辑器
│   │   │   ├── AiPanel.tsx     # AI 问答面板
│   │   │   ├── HomeView.tsx    # 首页（知识库卡片 / 最近浏览）
│   │   │   ├── LoginView.tsx   # 登录 / 注册
│   │   │   └── ...             # 各类对话框、命令面板、标签管理等
│   │   ├── lib/                # 工具（api 客户端 / markdown / 树构建）
│   │   └── data/               # 类型定义
│   ├── scripts/                # 真机验证脚本（verify_*.cjs + 批量 runner）
│   └── public/
├── api/                        # 后端（FastAPI）
│   ├── app/
│   │   ├── api/routes.py       # 路由（文档 / 文件夹 / 知识库 / 搜索 / 导出 / 认证）
│   │   ├── core/config.py      # 配置（环境变量 / 模型）
│   │   └── services/           # 业务服务
│   │       ├── store.py        # 存储（Postgres / JSON 降级）
│   │       ├── db.py           # PostgreSQL + pgvector 数据层
│   │       ├── parser.py       # 文档解析（pdf/docx/xlsx/zip/html）
│   │       ├── snippet.py      # 搜索片段与引用产出（三条路径统一入口）
│   │       ├── qa.py           # 问答编排
│   │       ├── llm.py          # LLM 调用（流式）
│   │       ├── embedding.py    # 向量化
│   │       ├── rerank.py       # 重排
│   │       ├── web_search.py   # 联网搜索
│   │       ├── agent.py        # 智能体编排
│   │       ├── agent_tools.py  # 智能体工具集（28 个，分级执行）
│   │       ├── exporter.py     # 多格式导出
│   │       └── auth.py         # 认证（密码哈希 / token）
│   ├── scripts/                # 迁移与运维脚本（migrate_json_to_pg.py 等）
│   ├── tests/                  # 后端单元测试
│   ├── requirements.txt
│   └── docker-compose.yml      # pgvector 数据库
├── docs/                       # 设计规范（DESIGN.md）与路线图（ROADMAP.md）
├── CHANGELOG.md                # 更新日志
├── deploy.sh                   # 部署脚本（目标服务器已下线，自建需替换）
├── dev.sh                      # 本地开发启停脚本
└── README.md
```

## ✅ 测试

两套互补的测试：**后端单元测试**（快、零依赖）与**浏览器端到端验证**（真机、覆盖 UI 链路）。

**后端单元测试**（218 项，约 2 秒）：

```bash
cd api && .venv/bin/python -m pytest -q
```

**浏览器端到端验证**（25 个脚本）。需要前后端都在运行，且准备一个登录 token：

```bash
# 1. 取 token（登录接口返回的 token 写入文件）
curl -s -X POST http://127.0.0.1:8000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"t_hook","password":"admin123"}' \
  | python3 -c "import json,sys;print(json.load(sys.stdin)['token'])" > /tmp/sunnydoc-token.txt

# 2. 全量跑（约 12 分钟），或只跑匹配的
cd web
NODE_PATH=<node_modules> node scripts/run_all_verify.cjs
NODE_PATH=<node_modules> node scripts/run_all_verify.cjs --only search,citation
```

脚本**自建自清夹具**（跑前播种、跑后删除），正常情况下不会在库里留下残留文档。

## 📄 许可证

待定
