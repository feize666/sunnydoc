# sunnydoc 知库 · 前端设计规范

> 版本：阶段 3（蓝白科技感风格统一）
> 适用范围：`web/` 前端（Next.js 16 + React 19 + Tailwind CSS 4）
> 核心原则：**所有样式必须引用 design token 变量，禁止写裸色值**（临时调试除外）。

---

## 1. 设计原则

1. **蓝白科技感**：以蓝色（`--accent` #2f6bff 家族）为唯一主色，配白/深蓝中性底色；强调「渐变 + 微光 + 玻璃拟态」营造现代科技感，参考语雀 / Notion / Linear 的克制质感。
2. **克制统一**：以「统一」为第一优先级，不推翻重做。圆角、阴影、边框、hover/active、聚焦态、渐变按钮全部收敛到 token 与约定类，避免每个组件各写一套。
3. **明暗双主题**：`:root` 定义浅色，`[data-theme="dark"]` 定义深色；两套色板、阴影、聚焦环都要成对提供，保证两种主题下文字均可读、对比度达标。

---

## 2. 色板表（明暗两套）

### 2.1 主色（蓝）

| Token | 浅色 | 深色 | 用途 |
| --- | --- | --- | --- |
| `--accent` | `#2f6bff` | `#4f8bff` | 主色：链接、选中态、焦点、图标强调 |
| `--accent-hover` | `#1d4ed8` | `#6ea0ff` | 主色 hover |
| `--accent-active` | `#1e4fd6` | `#3b82f6` | 主色按下 |
| `--accent-deep` | `#2b5ce6` | `#3b82f6` | 主色深色锚点 |
| `--accent-soft` | `#eaf1ff` | `#172554` | 主色弱底（选中背景 / 徽标底） |
| `--accent-grad` | `linear-gradient(135deg,#5b8dff,#2f6bff 50%,#2b5ce6)` | `linear-gradient(135deg,#7aa7ff,#4f8bff 50%,#3b82f6)` | 渐变主按钮、消息气泡 |
| `--grad-blue-indigo` | `linear-gradient(135deg,#4f8bff,#2f6bff 45%,#6d5cff)` | `linear-gradient(135deg,#6ea0ff,#4f8bff 45%,#8b7bff)` | 蓝→靛装饰线（H1 下划线等） |

### 2.2 背景 / 文本 / 边框

| Token | 浅色 | 深色 | 用途 |
| --- | --- | --- | --- |
| `--background` | `#ffffff` | `#0b1120` | 页面主背景 |
| `--surface` | `#f8fafc` | `#111827` | 侧栏 / 面板 / 工具栏底 |
| `--surface-2` | `#eef2f7` | `#1e293b` | 次级底（代码块 / 输入框 / 表头） |
| `--hover` | `#eef4ff` | `#24324a` | hover 背景 |
| `--active` | `#dbeafe` | `#1e3a8a` | 选中背景 |
| `--text` | `#0f172a` | `#e2e8f0` | 正文 / 标题 |
| `--muted` | `#475569` | `#94a3b8` | 次要文字 |
| `--faint` | `#64748b` | `#8494a8` | 弱文字 / 占位 / 图标（**已按 AA 校准，勿调浅**，详见 §6.3） |
| `--line` | `#e2e8f0` | `#273549` | 边框 / 分隔线 |
| `--line-strong` | `#cbd5e1` | `#3b4a63` | 强调边框（次要按钮 hover） |

### 2.3 状态色

| Token | 浅色 | 深色 | 用途 |
| --- | --- | --- | --- |
| `--success` / `--success-soft` | `#16a34a` / `#dcfce7` | `#34d399` / `#052e1f` | 成功 / 在线 |
| `--warning` / `--warning-soft` | `#d97706` / `#fef3c7` | `#fbbf24` / `#3a2e05` | 警告 / 检测中 |
| `--danger` / `--danger-soft` | `#dc2626` / `#fee2e2` | `#f87171` / `#3b1216` | 危险 / 删除 / 错误 |
| `--danger-hover` | `#b91c1c` | `#ef4444` | 危险按钮 hover |

---

## 3. 圆角 / 阴影 / 聚焦环

### 3.1 圆角层级

| Token | 值 | 用途 |
| --- | --- | --- |
| `--radius-sm` | `6px` | 小控件：chip、kbd、图标按钮、行内代码 |
| `--radius-md` | `8px` | 按钮、输入框、菜单项 |
| `--radius-lg` | `12px` | 卡片、对话框、下拉面板 |

Tailwind 通过 `@theme inline` 映射：`rounded-sm` / `rounded-md` / `rounded-lg` 自动使用上述 token。

### 3.2 阴影（冷调，偏蓝）

| Token | 浅色 | 深色 | 用途 |
| --- | --- | --- | --- |
| `--shadow-sm` | `0 1px 2px rgba(15,23,42,.05), 0 1px 3px rgba(47,107,255,.06)` | `0 1px 2px rgba(0,0,0,.4), 0 1px 3px rgba(47,107,255,.08)` | 卡片默认 |
| `--shadow-md` | `0 4px 12px rgba(15,23,42,.08), 0 2px 4px rgba(47,107,255,.06)` | `0 4px 14px rgba(0,0,0,.5), 0 2px 6px rgba(47,107,255,.1)` | 下拉菜单、Tooltip |
| `--shadow-lg` | `0 12px 32px rgba(15,23,42,.12), 0 4px 12px rgba(47,107,255,.08)` | `0 16px 40px rgba(0,0,0,.6), 0 6px 16px rgba(47,107,255,.12)` | 对话框、浮层 |
| `--shadow-glow` | `0 0 0 1px rgba(47,107,255,.22), 0 8px 24px rgba(47,107,255,.18)` | `0 0 0 1px rgba(79,139,255,.3), 0 10px 30px rgba(79,139,255,.28)` | 蓝色光晕：主按钮 hover、命令面板、卡片 hover |

Tailwind 映射：`shadow-sm` / `shadow-md` / `shadow-lg` / `shadow-glow`。

### 3.3 聚焦环

| Token | 浅色 | 深色 |
| --- | --- | --- |
| `--focus-ring` | `0 0 0 3px rgba(47,107,255,.25)` | `0 0 0 3px rgba(79,139,255,.35)` |

统一聚焦态（见 `globals.css`）：
- 可点击元素（`button` / `[role="button"]` / `a` / `[tabindex]`）`focus-visible` → 蓝色 `outline`。
- 文本输入 / 下拉（`input` / `select`）`focus-visible` → 蓝色边框 + `--focus-ring` 光晕。

### 3.4 玻璃拟态

| Token | 浅色 | 深色 |
| --- | --- | --- |
| `--glass-bg` | `rgba(255,255,255,.72)` | `rgba(17,24,39,.72)` |
| `--glass-blur` | `12px` | `12px` |
| `--glass-border` | `rgba(255,255,255,.6)` | `rgba(255,255,255,.08)` |

使用类 `.glass`（半透明 + `backdrop-filter: blur()`），用于命令面板等浮层。

---

## 4. 字号 / 字重 / 间距

- 字体栈：`--font-sans`（系统中文优先）、`--font-mono`（代码）。
- 字号层级（约定，非强制枚举）：
  - 页面标题 `30px / 32px`，正文 `15px`，正文小 `13px`，辅助 `12px`，弱提示 `11px`。
- 字重：常规 `400`，中等 `500~600`，加粗 `700`，重标题 `800`（H1）。
- 间距：优先 Tailwind 内置 `0.5 / 1 / 1.5 / 2 / 2.5 / 3 / 4 / 5 / 6 / 8`，容器内边距多用 `px-4 py-3`（卡片）与 `p-4`（对话框内容）。

---

## 5. 组件约定

### 5.1 主按钮（`.btn` + `.btn-accent`）
`.btn` 提供尺寸与排版（**36px** 高 / `--radius-md` / 500 字重 / `:active` 下压 / `:disabled` 透明），`.btn-accent` 叠加渐变蓝底 + 白色文字 + 微光，hover 提亮并叠加 `--shadow-glow`。

**必须组合使用**：裸 `.btn-accent` 没有尺寸，需自行写 `h-9 px-4`；推荐始终 `btn btn-accent`。

```tsx
<button className="btn btn-accent text-white">保存</button>
<button className="btn btn-accent btn-sm text-white">保存</button>
```

### 5.2 次要按钮（`.btn` + `.btn-secondary`）
`.btn-secondary` 叠加描边 + 透明白底，hover 用 `--hover` 底 + `--line-strong` 边框。

```tsx
<button className="btn btn-secondary">取消</button>
```

### 5.3 卡片（知识库 / 最近浏览）
`rounded-xl border border-line bg-background shadow-sm`，hover 用 `-translate-y-0.5 + hover:border-accent/40 + hover:shadow-glow` 做微动效。通用卡片也可直接用 `.card`（`--radius-lg` + `--line` + `--shadow-sm`）。

### 5.4 对话框
遮罩用 `.dialog-overlay`（固定 + 居中 + 半透明黑 + 轻微 blur + **`overflow-y:auto`**），面板用 `.dialog-panel`（`--background` + `--line` 边框 + `--radius-lg` 圆角 + `--shadow-lg` + **`margin:auto`**），宽度由业务方在 className 上指定：

```tsx
<div className="dialog-overlay" onClick={onClose}>
  <div className="dialog-panel w-[460px] max-w-[92vw]" onClick={(e) => e.stopPropagation()}>
    ...
  </div>
</div>
```

> ⚠️ **`.dialog-overlay` / `.dialog-panel` 是「无层级 CSS」**（优先级高于 Tailwind 全部 layer），
> 因此**绝不能在其中写 `max-height` / `max-width` 等尺寸约束** —— 否则会压掉调用方的
> `max-h-[85vh]` / `max-w-[92vw]`。矮屏兜底靠「遮罩可滚动 + 面板 `margin:auto`」实现。

### 5.5 输入框 / 下拉 / 文本域
统一用控件类，**不要手写** `rounded-lg border border-line bg-surface px-3 py-2`：

| 类名 | 高度 | 用途 |
| --- | --- | --- |
| `.input` | 36px | 表单 / 对话框主输入 |
| `.input-sm` | 32px | 工具栏、设置行、侧栏内联编辑 |
| `.input-icon` / `.input-icon-sm` | — | 追加左侧 36px / 32px 图标内边距（写在 `.input` 之后） |
| `.textarea` | min-h 72px | 多行文本，`resize: vertical` |
| `.textarea-sm` | min-h 48px | 评论 / AI 追问等高频小输入区（常配 `resize-none`） |
| `.select` | 36px | 原生外观重置 + `--chevron-down` token 化自定义箭头 |
| `.select-sm` | 32px | 工具栏内联选择器 |
| `.field-label` | — | 字段标签：13px / 500 / `--muted` |
| `.field-hint` | — | 字段旁白或校验提示：12px / `--faint` |

```tsx
<label className="field-label" htmlFor="name">名称</label>
<input id="name" className="input" placeholder="请输入" />
<select className="select"><option>选项</option></select>
<textarea className="textarea" rows={3} />
<p className="field-hint">字段说明</p>
```

聚焦态由类内 `:focus` 统一处理（`--accent` 边框 + `--focus-ring`），无需再写 `focus:ring-*`。错误提示统一 `border-danger/40 bg-danger-soft text-danger`。

### 5.6 下拉菜单（`.menu-panel`）与菜单行
面板用 `.menu-panel`：`--background` + `--line` 边框 + `--radius-lg` 圆角 + `--shadow-md` + 4px 内边距，配合绝对定位使用：

```tsx
<div className="menu-panel absolute left-0 top-full z-50 mt-1 w-44">
  <button className="menu-item">重命名</button>
  <button className="menu-item">删除</button>
</div>
```

**菜单内的行用 `.menu-item`**（整行 flex + `padding 6px 12px` + 13px + hover `--hover`），
不要用 `.btn` / `.btn-ghost` —— 按钮样式用于触发点，菜单行是列表项，两者不能混用。

需要承载表单的浮层（编辑器「插入链接」等弹窗）用 **`.popover-panel`**：与 `.menu-panel` 同为浮层，
区别是 `--surface` 底 + `--shadow-lg` + 内置 12px 内边距。

### 5.7 Tooltip（`components/Tooltip.tsx`）
API 不变：`<Tooltip content="提示" side="top|bottom">触发元素</Tooltip>`。样式由 `.tooltip-bubble` 控制（深色底 + 主色描边 + `--shadow-md` + backdrop-blur），禁用原生 `title`。

### 5.8 代码块
`.md-body .codeblock` 容器 + `.codeblock-head`（语言标签 + 复制按钮）+ `pre.shiki`（shiki 高亮）。复制逻辑在 `components/CodeBlock.tsx`（事件委托），样式与逻辑分离，勿改动复制逻辑。

### 5.9 消息气泡
用户消息用 `.bubble-accent`（渐变蓝底白字）；AI 消息用 `border-line bg-background` 圆角卡片，错误态用 `border-danger/40 bg-danger-soft text-danger`。

### 5.10 品牌标识（`.logo-mark`）
渐变蓝底白字 + 微光，用于「知」Logo 标识，替代硬编码 `from-[#5b8dff] to-[#2b5ce6]`。

### 5.11 页面级组合类（登录页 / 首页）

| 类名 | 用途 | 说明 |
| --- | --- | --- |
| `.hero-surface` | 品牌渐变面板 | `--grad-blue-indigo` 底 + 网格纹理（`::before`）+ 右上光晕（`::after`）。前景文字统一用 `--hero-ink / --hero-ink-muted / --hero-ink-faint`。**子元素自动 `position: relative; z-index: 1`**，无需手动处理层级。用于登录页左侧品牌区、首页欢迎条。 |
| `.hero-chip` | 渐变底上的小徽标 | 半透明白底 + 白描边 + `backdrop-filter`，文字用 `--hero-ink`。 |
| `.stat-tile` | 首页数据概览磁贴 | 与 `.card` 同规格，hover 上浮 1px + 蓝色描边 + `--shadow-md`。 |
| `.section-heading` | 首页区块标题 | 左侧 3px 渐变竖条（`::before`）+ 15px/600 标题；计数徽标以兄弟 `span` 传入。 |
| `.kb-topline` / `.kb-badge` | 知识库卡片 hover 装饰 | 需配合父级 `.group`：hover 时顶部渐变条淡入、首字徽标由浅底蓝字反转为渐变底白字。 |
| `.anim-rise-in` / `.stagger` | 上浮入场 | `.anim-rise-in` 单项 0.32s 上浮；`.stagger > *` 对同容器前 6 个子项依次延迟 0.02~0.22s。均受 `prefers-reduced-motion` 兜底。 |

> 品牌氛围层前景色（`--hero-ink*` / `--hero-grid-line` / `--hero-glow` / `--hero-chip*`）在 `:root` 与 `[data-theme="dark"]` 成对定义，渐变底上始终为白色系以保证对比度。

### 5.12 尺寸阶梯（全站统一，勿另造新规格）

| 高度 | 类 | 用途 |
| --- | --- | --- |
| **36px** | `.btn` / `.input` / `.select` | 主表单、对话框主操作 |
| **32px** | `.btn-sm` / `.input-sm` / `.select-sm` / `.tool-btn` / `.icon-btn` | 工具栏、紧凑表单、编辑器 |
| **28px** | `.btn-ghost` | 内联文字操作（消息操作条、菜单弹窗内的小按钮） |
| 24px | （局部手写 `h-6 w-6`） | 紧贴正文的微操作（气泡内复制、列表项删除） |

- **`.tool-btn`**：工具栏图标按钮，32px + `min-width:32px`（可含图标、文字或图标+小箭头），
  hover `--hover`；选中态追加 **`.tool-btn-on`**（`--active` 底 + `--accent` 文字）。
- **`.icon-btn`**：32px 正方形（`display:grid` + `place-items:center`），用于纯图标按钮；
  与 `.tool-btn-on` 可组合表示选中。
- **`.btn-ghost`**：28px、无底色、hover 才浮现。需要主色/危险态时在 `className` 上追加
  `text-accent` / `text-danger hover:bg-danger-soft` 等 token 类覆盖。
- **例外**：画布类编辑器（`FlowchartEditor` / `MindMapEditor` / `BoardEditor`）的浮动工具栏
  为 26px 紧凑档（`rounded-md px-2 py-1 text-xs`）——属于画布内嵌 UI，需贴近画布且密度更高，
  **刻意不并入 32px 阶梯**，勿强行统一。

#### 主题切换按钮（`components/ThemeToggle.tsx`）

- 尺寸走 `.icon-btn`（32px），**调用点不要再传 `className="h-9 w-9"` / `"h-8 w-8"`** —— 那些是野生规格。
  需要图标更醒目时只调 `size`（默认 16，标题栏 / 设置页用 18）。
- 图形颜色取自 `--theme-moon-from/to`（蓝紫）、`--theme-sun-from/to`（金黄），明暗两套均已成对定义。
- 渐变 `id` 由 `useId()` 生成：标题栏、首页、设置页可能同页共存，固定 id 会冲突。
- 分享页（`ShareView`）直接复用本组件，**不要再复制一份 SVG**。

### 5.14 空状态（`components/EmptyState.tsx`）

列表 / 面板 / 页面无数据时统一用 `EmptyState`，**不要手写**「居中一行 `text-faint`」的空态块。

| 规格 | 用途 | 规格特征 |
| --- | --- | --- |
| `size="page"`（默认） | 页面 / 主内容区 | 64px 圆角图标框（含 `shadow-md`）+ `py-14`；15px/600 标题 + 13px 描述 |
| `size="panel"` | 侧栏 / 弹层 / 对话框分栏等窄容器 | 36px 图标框 + `py-8`；13px/500 标题 + 12px 描述（`max-w-220px`），不撑破容器 |

```tsx
<EmptyState
  size="panel"
  icon={<HistoryIcon size={16} />}
  title="暂无历史版本"
  description="文档保存后会自动生成可回滚的版本"
/>
```

- `icon` 传入图标组件，尺寸由容器 CSS 统一控制（`[&>svg]`），**不必自己写 `size`**。
- `description` 可选；不要写「暂无 X，点击 Y」这类罗列式长句——短句或省略。
- **不适用本组件**：紧贴正文的一行旁白（文件树节点下的「暂无文件夹」、卡片字段占位
  「暂无描述」、节点备注「暂无备注」），直接用一行 `text-[12px] text-faint` 即可。

### 5.15 加载态 / 骨架屏

替换裸文字「加载中…」，按场景选用：

| 类名 | 用途 |
| --- | --- |
| `.spinner` / `.spinner-sm` | 环形旋转指示器；`-sm` 为 13px，用于按钮内 / 行内 |
| `.loading-row` | 居中 `spinner + 文案` 容器（`padding: 20px 0`）；`.loading-row-start` 变体改左对齐，用于表格 / 列表区 |
| `.skeleton` | shimmer 扫光块（骨架屏基元，尺寸由 `className` 给） |
| `.skeleton-line` | 12px 高骨架行，宽度由外部工具类控制 |
| `.typing-dots` | 三点跳动（`<i />` × 3），用于 AI 生成中 / 实时写入 |

```tsx
{loading ? (
  <div className="loading-row"><span className="spinner" /><span>识别中…</span></div>
) : (
  <ul>{items.map((it) => <li key={it.id}>{it.name}</li>)}</ul>
)}
```

> 所有动画类均有 `@media (prefers-reduced-motion: reduce)` 兜底。

---

## 6. 强制约定

> **后续所有开发必须引用 design token 变量，禁止写裸色值**（除非临时调试，且调试后必须改回 token）。

- 颜色一律用 `var(--xxx)` 或 Tailwind 映射类（`bg-*` / `text-*` / `border-*` / `ring-*`）。
- 圆角用 `rounded-sm/md/lg`，阴影用 `shadow-sm/md/lg/glow`，聚焦用统一聚焦态规则。
- 新增色值先在 `globals.css` 的 `:root` / `[data-theme="dark"]` 成对定义，再在 `@theme inline` 映射。
- 新增状态色沿用 `--success / --warning / --danger` 及其 `-soft` 变体，不要引入 `red-* / green-* / yellow-*` 裸色。
- **禁止使用 Tailwind 调色板类**（`text-emerald-500` / `bg-slate-100` 等）：这些类在本次 token 体系外，
  主题切换不会跟随。语义色一律映射到 `text-success` / `text-danger` / `text-warning` / `text-accent` 等 token 类。
- **SVG 图形内的颜色也必须 token 化**：`<stop stopColor="var(--theme-sun-from)" />`、`stroke="var(--x)"`，
  不要写 `stopColor="#fbbf24"`。多实例渲染的 SVG 若含 `<linearGradient>` 等 `id`，**必须用 `useId()` 生成唯一 id**
  ——固定 id（如 `moon-grad`）在同一页面渲染多个实例时会互相覆盖渐变定义（`ThemeToggle` 即为此例，
  见 §5.12 下方「主题切换按钮」）。
- **图标统一从 `components/icons.tsx` 取用**，不要在组件文件里重复定义相同 `<svg>`。
  同一图形曾出现三份 `ShareIcon` 副本（HomeView / ShareDialog / Editor），已收敛到图标库。

### 6.1 CSS 层级纪律（务必遵守）

Tailwind 4 的层级顺序为 `theme < base < components < utilities`。

- **所有控件类必须写在 `@layer components { ... }` 内**。若写在 layer 之外，会变成「无层级样式」，
  优先级高于**全部** layer，导致 `className="input h-10"` 中的 `h-10` 静默失效。
- **无层级规则里禁止写尺寸约束**（`max-height` / `max-width` / `height` / `width`）：
  `.dialog-overlay` / `.dialog-panel` 属于此类，写尺寸会压掉调用方的 Tailwind 工具类。
- 组合类继承顺序：先写组件类（`.btn`），再写尺寸变体（`.btn-sm`），最后写工具类（`h-10`）覆盖。
- 页面级组合类（`.hero-surface`、`.stat-tile`、`.section-heading`、`.skeleton` 等）目前位于 layer 外，
  属已知例外；**新增组合类请优先放进 `@layer components`**，避免继续扩大例外面。

### 6.2 响应式约定

- 页面容器内边距：`px-4 sm:px-6`（列表 / 管理页）、`px-4 sm:px-10`（内容 / 编辑器页）。
- **宽表格必须加横向兜底**：外层包 `overflow-x-auto`，表格给 `min-w-[560px]`（用户管理）/ `min-w-[640px]`（操作日志）。
- 窄屏收敛冗余文案：副标题 `hidden sm:block`；按钮用 `<span className="hidden sm:inline">完整文案</span>`
  + `<span className="sm:hidden">短文案</span>`。
- `<480px` 时对话框自动 `width:100%` + `--radius-md`（由 `.dialog-panel` 媒体查询处理，无需业务方关心）。

### 6.3 可访问性约定（WCAG AA）

#### 对比度

- 文本色按 WCAG AA **4.5:1** 校准，非文本（边框 / 图标）按 **3.0:1** 校准。
- `--faint` 是准文本色（占位符 / 旁白 / 计数），已校准：**亮色 `#64748b` = 4.76:1**、
  **暗色 `#8494a8` = 6.08:1**。**勿再调浅**——浅于这两个值就不达 AA。
- 改任何文本 token 后必须重算对比度（公式：相对亮度 `L = 0.2126R + 0.7152G + 0.0722B`，
  比值 `(L₁+0.05)/(L₂+0.05)`），并同时核对它落在 `--background` / `--surface` / `--surface-2` 上的表现。

#### 图标按钮必须可访问

- **纯图标按钮（无可见文本）必须有可访问名**：优先 `aria-label`（动态场景用 `title` 兜底）。
- `Tooltip` 组件已内置自动注入：当子元素是「无文本且无 `aria-label` / `aria-labelledby` / `title`」
  的单个元素时，自动把 `content` 注入为其 `aria-label`，并在气泡打开时用 `aria-describedby` 关联。
  **因此被 `<Tooltip>` 包裹的图标按钮无需再写 `aria-label`**；含可见文本的按钮不会被覆盖。
- 新写图标按钮统一用 `.icon-btn`（32px），不要另造 `grid h-6 w-6` / `h-7 w-7` 尺寸。

#### 模态对话框必须可访问

用 `useModalFocus`（`lib/useModalFocus.ts`）接管，它一次性解决四件事：

```tsx
const panelRef = useModalFocus<HTMLDivElement>(open, onClose, "对话框标题");
// ...
<div ref={panelRef} className="dialog-panel …">…</div>
```

1. **自动补语义**：`role="dialog"` / `aria-modal="true"` / `tabindex="-1"` / `aria-label`（不覆盖已有值）。
2. **Esc 关闭**：内置**对话框栈**，嵌套时只有最上层响应（内层先关）；若内层已
   `preventDefault()`（如标签建议下拉）则不误关整个对话框。
3. **焦点陷阱**：Tab / Shift+Tab 在面板内循环；无可聚焦元素时聚焦面板自身。
4. **焦点归还**：打开时记住触发元素，关闭后把焦点还回去。

> 嵌套对话框（如设置页内的「另存为预设」）**各自调用一次 hook** 即可，无需手动管理层级。
> 若 `onClose` / 标题依赖下方才定义的变量，用 `useRef` 惰性转发，避免 TDZ 报错。
