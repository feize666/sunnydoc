# sunnydoc

文档知识库 —— 以文档为核心，支持 AI 问答与引用溯源的私有知识库。

## 技术架构

- **前端**：Next.js 14 + TypeScript（MVP 阶段为 Obsidian 风格静态骨架）
- **后端**：Python 3.12 + FastAPI（规划中）
- **数据层**：PostgreSQL + pgvector（向量检索）、Redis（队列）、MinIO（文件存储）

## MVP 现状

- [x] Obsidian 风格三栏 UI（文件树 / Markdown 编辑器 / AI 问答面板）
- [x] 中文界面、明暗主题、命令面板（⌘K）
- [ ] 后端文档解析与向量化
- [ ] 混合检索 + Rerank
- [ ] 引用溯源问答

## 目录结构

```
mvp-ui/          前端骨架（单文件 HTML，可直接打开）
```

## 部署

- 服务器：180.184.86.246（火山云），nginx 托管静态文件
- 访问：http://180.184.86.246:85

## 许可证

待定
