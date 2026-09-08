export interface Doc {
  key: string;
  title: string;
  path: string;
  updated: string;
  body: string;
}

export interface TreeNode {
  type: "folder" | "file";
  name: string;
  key?: string;
  children?: TreeNode[];
}

export const docs: Record<string, Doc> = {
  quickstart: {
    key: "quickstart",
    title: "快速开始",
    path: "产品文档 / 快速开始",
    updated: "2026-09-08 08:30",
    body: `# 快速开始

欢迎使用 **知库** —— 一个以文档为核心的知识库。

## 三步上手

1. 在左侧点击 **新建**，创建一个 Markdown 文档；
2. 拖入或上传你的 PDF、Word、Markdown 文件；
3. 右侧 **AI 问答** 面板中直接提问，回答会附带原文引用。

## 支持的文件类型

| 类型 | 说明 |
|------|------|
| Markdown | 原生支持，推荐 |
| PDF | 含扫描件 OCR |
| Word / Excel | 表格自动抽取 |
| 网页 | 输入 URL 抓取 |

## 为什么用 Markdown

> Markdown 是纯文本格式，便于版本管理、迁移和全文检索，也是 AI 处理最友好的格式。

\`\`\`bash
# 本地预览本项目
npm run dev
\`\`\`

更多用法见 **功能指南**。`,
  },
  features: {
    key: "features",
    title: "功能指南",
    path: "产品文档 / 功能指南",
    updated: "2026-09-07 19:12",
    body: `# 功能指南

## 核心能力

- **全文检索**：基于 PostgreSQL + pgvector 的混合检索（BM25 + 向量）。
- **引用溯源**：每条 AI 回答都会标注来源文档与片段。
- **权限隔离**：按团队 / 空间划分可见范围。
- **增量更新**：文档变更后自动重新切片、重建索引。

## 检索流程

\`\`\`text
用户提问
   │
   ▼
混合检索（关键词 + 向量）
   │
   ▼
Rerank 重排
   │
   ▼
LLM 生成 + 引用标注
\`\`\`

## 注意事项

1. 扫描件需先 OCR，解析耗时较长；
2. 表格内容建议用 Excel 导入；
3. 权限变更后需重建索引缓存。`,
  },
  deploy: {
    key: "deploy",
    title: "部署指南",
    path: "技术手册 / 部署指南",
    updated: "2026-09-06 15:40",
    body: `# 部署指南

## 环境要求

- 服务器：4C 8G 起步
- 数据库：PostgreSQL 16 + pgvector
- 队列：Redis
- 对象存储：MinIO（S3 兼容）

## Docker Compose 一键启动

\`\`\`yaml
services:
  db:
    image: pgvector/pgvector:pg16
  redis:
    image: redis:7
  api:
    build: ./api
    ports: ["8000:8000"]
  web:
    build: ./web
    ports: ["3000:3000"]
\`\`\`

## 常见问题

> **问**：内存不足怎么办？
> **答**：关闭 OCR 离线推理，改用云端 OCR 服务。`,
  },
  api: {
    key: "api",
    title: "API 参考",
    path: "技术手册 / API 参考",
    updated: "2026-09-05 11:20",
    body: `# API 参考

## 文档上传

\`\`\`http
POST /api/v1/documents
Content-Type: multipart/form-data
\`\`\`

| 参数 | 类型 | 说明 |
|------|------|------|
| file | file | 待上传文件 |
| collection | string | 所属知识库 ID |

## 问答接口

\`\`\`http
POST /api/v1/chat
\`\`\`

\`\`\`json
{
  "query": "如何部署？",
  "collection_id": "kb_001",
  "top_k": 5
}
\`\`\`

返回结果包含 \`answer\` 与 \`citations\`（引用片段）。`,
  },
  meeting: {
    key: "meeting",
    title: "2026-09-01 周会纪要",
    path: "会议纪要 / 2026-09-01 周会",
    updated: "2026-09-01 18:00",
    body: `# 2026-09-01 周会纪要

## 参与人

产品、研发、测试全体。

## 议题

1. MVP 范围确认：优先跑通「上传 → 检索 → 问答」闭环；
2. 前端 UI 参考 Obsidian，追求简洁；
3. 检索质量需引入 Rerank 精排。

## 待办

- [x] 技术选型评审
- [ ] 搭建项目骨架
- [ ] 接入 Embedding 模型`,
  },
};

export const treeData: TreeNode[] = [
  {
    type: "folder",
    name: "产品文档",
    children: [
      { type: "file", name: "快速开始", key: "quickstart" },
      { type: "file", name: "功能指南", key: "features" },
    ],
  },
  {
    type: "folder",
    name: "技术手册",
    children: [
      { type: "file", name: "部署指南", key: "deploy" },
      { type: "file", name: "API 参考", key: "api" },
    ],
  },
  {
    type: "folder",
    name: "会议纪要",
    children: [{ type: "file", name: "2026-09-01 周会", key: "meeting" }],
  },
];
