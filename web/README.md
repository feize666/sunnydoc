# sunnydoc 前端（web）

sunnydoc 知库的前端，Next.js 16 + React 19 + TypeScript + Tailwind CSS 4。

## 开发

```bash
npm install
npm run dev     # http://localhost:3000
```

## 构建

```bash
# 生产构建（API 走相对路径 /api/v1，由 nginx 反代到后端）
NEXT_PUBLIC_API_BASE= npm run build

# 本地联调后端时指定地址
NEXT_PUBLIC_API_BASE=http://localhost:8000/api/v1 npm run build
```

`web/.env.local` 中的 `NEXT_PUBLIC_API_BASE` 仅用于本地开发，生产构建务必置空，否则会把 `localhost` 地址打进产物。

## 目录

- `src/app/` — 页面、布局、全局样式
- `src/components/` — UI 组件（侧栏 / 文件树 / 编辑器 / AI 面板 / 登录等）
- `src/lib/` — 工具（API 客户端、markdown 渲染、文件树构建）
- `src/data/` — 类型定义
