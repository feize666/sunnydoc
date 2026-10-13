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
| `--accent` | `#2563eb` | `#4f8bff` | 主色：链接、选中态、焦点、图标强调（**兼任 137 处 `text-accent` 文本色，须在 `--accent-soft` 上 ≥4.5**）。浅色已由 `#2f6bff` 压深，详见下方与 §6.3 |
| `--accent-solid` | `#2862f4` | `#2f63ee` | **实底蓝**：`bg-accent-solid` + `text-white` 的单色场景（白字底须「暗」）。新增 token，与 `--accent` 分离，详见 §6.3 |
| `--accent-solid-hover` | `#1d4ed8` | `#325fd9` | 实底蓝 hover（白字 6.70 / 5.56） |
| `--accent-hover` | `#1d4ed8` | `#6ea0ff` | 主色 hover（注：TSX 中 0 引用，当前为保留 token） |
| `--accent-active` | `#1e4fd6` | `#3b82f6` | 主色按下（注：TSX 中 0 引用，当前为保留 token） |
| `--accent-deep` | `#2b5ce6` | `#3b82f6` | 主色深色锚点（注：TSX 中 0 引用，当前为保留 token） |
| `--accent-soft` | `#eaf1ff` | `#172554` | 主色弱底（选中背景 / 徽标底） |
| `--accent-grad` | `linear-gradient(135deg,#2862f4,#0c4be8 48%,#093ab1)` | `linear-gradient(135deg,#2f63ee,#134ce4 48%,#0e3baf)` | 渐变主按钮、消息气泡、`logo-mark`。**三档均承载白字**，每档按白字 ≥4.5 校准 |
| `--grad-blue-indigo` | `linear-gradient(135deg,#065cef,#2b54fa 45%,#6445fa)` | `linear-gradient(135deg,#0f5ee6,#3057f2 45%,#6448f3)` | 品牌渐变面板（`.hero-surface` 登录页/首页）与 `avatar-ring`。**承载白字与 `--hero-*` 前景**，故压得比 `--accent` 更深 |

> **`--accent` 与 `--accent-solid` 为何必须分开**：`--accent` 同时担任「文本色」与「白字底」两个角色，
> 而这两个角色对亮度的要求方向相反——文本要够亮才能看清，白字底要够暗才能托住白字。
> 同一个变量无法同时满足，故拆为两个 token。改任一者都需重算 §6.3 的对比度。

> **浅色 `--accent` 为何是 `#2563eb` 而不是更亮的蓝**：`--accent` 的「最严苛背景」不是白底，
> 而是 `--accent-soft` `#eaf1ff`——因为 `text-accent` 最常见的形态就是坐在浅蓝徽标/标签/内联代码上
> （源码中静态共现 25 处，另有文档内联代码与 wikilink）。原值 `#2f6bff` 在白底恰好 **4.50**（临界），
> 一旦落到有明度的底色上就跌破：`accent-soft` 3.97、`surface-2` 4.00、`surface` 4.30。
> 故按最严苛底色反解，压深到 `#2563eb`（`accent-soft` 4.56 / 白底 5.17 / `surface-2` 4.60）。
> 色相仍为品牌蓝，饱和度略降，肉眼观感几乎不变。深色 `#4f8bff` 最低 4.51，无需调整。
>
> **别再用「在白底上够 4.5」判断 `--accent`**——那只是刚好压线，任何浅色底都会让它失效。

### 2.2 背景 / 文本 / 边框

| Token | 浅色 | 深色 | 用途 |
| --- | --- | --- | --- |
| `--background` | `#ffffff` | `#0b1120` | 页面主背景 |
| `--surface` | `#f8fafc` | `#111827` | 侧栏 / 面板 / 工具栏底 |
| `--surface-2` | `#eef2f7` | `#1e293b` | 次级底（代码块 / 输入框 / 表头） |
| `--hover` | `#e2ecfd` | `#24324a` | hover 背景（须在 `--background` 上可察觉，见 §6.3） |
| `--active` | `#d3e2fb` | `#1e3a8a` | 按下/选中背景。**不配 `--accent` 文字**（仅 3.95）；选中态请用 `--accent-soft`，详见 §6.3 |
| `--text` | `#0f172a` | `#e2e8f0` | 正文 / 标题 |
| `--muted` | `#475569` | `#94a3b8` | 次要文字 |
| `--faint` | `#5f6e84` | `#8494a8` | 弱文字 / 占位 / 图标（**已按最严苛背景 `--surface-2` 校准为 AA，勿调浅**，详见 §6.3） |
| `--line` | `#e2e8f0` | `#273549` | 边框 / 分隔线（**装饰性**，不受 3:1 约束，暗色 1.52 为定论，详见 §6.3） |
| `--line-strong` | `#cbd5e1` | `#3b4a63` | 强调边框（次要按钮 hover）。**若用于表单控件轮廓，须按 3:1 单独核算** |
| `--scrollbar` | `#c2cedb` | `#3f4f68` | 滚动条滑块（装饰级，但过淡会「看不见滚动条」，故较原值各深一档） |
| `--scrollbar-hover` | `#8b9cb0` | `#526178` | 滚动条滑块 hover |

### 2.3 状态色

> 状态色**必须按自身的 `-soft` 徽标底校准**，而非白底。原因：`text-<status>` 几乎总是与
> `bg-<status>-soft` 成对出现（用户可见的典型形态就是「浅色徽标里的深色文字」），
> 而 `-soft` 底色本身有明度，会把对比度拉低约 0.5。原值只按白底算得 5.0+，落到自身徽标上
> 只剩 3.0~4.0（danger 3.95 / success 3.00 / warning 2.86），实测不达标。现按徽标底重算。

| Token | 浅色 | 深色 | 用途 |
| --- | --- | --- | --- |
| `--success` / `--success-soft` | `#1b7e3f` / `#dcfce7` | `#34d399` / `#052e1f` | 成功 / 在线（徽标底 4.66 · 白底 5.12 · surface-2 4.55） |
| `--warning` / `--warning-soft` | `#a55c12` / `#fef3c7` | `#fbbf24` / `#3a2e05` | 警告 / 检测中（徽标底 4.56 · 白底 5.07 · surface-2 4.51） |
| `--danger` / `--danger-soft` | `#c92626` / `#fee2e2` | `#f87171` / `#3b1216` | 危险 / 删除 / 错误（徽标底 4.54 · 白底 5.54 · surface-2 4.93） |
| `--danger-hover` | `#b91c1c` | `#ef4444` | 危险**文字** hover（白字 6.47 / 徽标底 5.30） |
| `--danger-solid` | `#dc2626` | `#dc2626` | **实底红**：`bg-danger-solid` + `text-white`（危险确认按钮 / 未读角标）。白字 4.83 |
| `--danger-solid-hover` | `#c92626` | `#c92626` | 实底红 hover（白字 5.54） |

深色主题的状态色作**文字**一律通过（最低 danger 5.91），无需调整。

> **`--danger` 与 `--danger-solid` 为何必须分开**（同 `--accent` 的道理）：
> `--danger` 兼任 `text-danger` 文字色，暗色下必须是**亮红** `#f87171` 才看得清；
> 但同一个值当**白字底**时白字只有 **2.77**，实为不可读。
> 故实底场景（危险确认按钮 `ConfirmDialog`、未读角标 `TitleBar`）改用 `--danger-solid`。
> 亮色下 `#c92626` 与 `#dc2626` 观感接近，但为保持 token 语义一致，两个主题都用同一个实底值。
>
> **新增实底状态色时照此办理**：任何「`bg-<status>` + `text-white`」的场景，
> 都不要复用文字色 token——先算白字对比度，不够就单列 `-solid`。

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

### 3.4 玻璃拟态（现状说明）

> **注意**：本节早前记载的 `--glass-bg` / `--glass-blur` / `--glass-border` 三个 token
> 与 `.glass` 工具类**在 `globals.css` 中均不存在**（已核对，0 处定义）。
> 实际的玻璃效果只有一处来源：`.hero-chip` 内的 `backdrop-filter: blur(4px)`，
> 以及登录页两处引用 `--hero-chip` 的徽标所带的 `backdrop-blur-sm`。
> 浮层（`.menu-panel` / `.popover-panel`）用的是**不透明底 + 边框 + 阴影**，并未做毛玻璃。
> 若要恢复 token 化，请先补定义再更新本节，**不要沿用旧表**。

### 3.5 品牌氛围层（`--hero-*`，登录页 / 首页渐变面板）

用于 `.hero-surface`（登录页品牌区、首页欢迎条）、`.hero-chip`（玻璃徽标）
与 `avatar-ring` / `logo-mark`。**全部前景色在 `--grad-blue-indigo` / `--accent-grad` 之上**，
故其取值受 §6.3「渐变面上的前景色」的物理约束支配。

| Token | 浅色 | 深色 | 说明 |
| --- | --- | --- | --- |
| `--hero-ink` | `#ffffff` | `#ffffff` | 渐变底主前景 · 白字 5.55 / 5.57 |
| `--hero-ink-muted` | `rgba(255,255,255,.92)` | 同左 | 次级前景 · 4.93 / 4.97 |
| `--hero-ink-faint` | `rgba(255,255,255,.88)` | 同左 | 弱前景 · 4.64 / 4.68（早前 0.86 仅 4.50，无余量） |
| `--hero-grid-line` | `rgba(255,255,255,.08)` | 同左 | 网格纹理线（仅右上角显形，见 §6.3） |
| `--hero-glow` | `rgba(255,255,255,.18)` | `rgba(120,160,255,.20)` | 右上角径向光晕 |
| `--hero-chip` | `rgba(9,20,62,.34)` | 同左 | **深蓝玻璃**徽标底（原为白玻璃，白字不可能达标，见 §6.3） |
| `--hero-chip-border` | `rgba(255,255,255,.38)` | 同左 | 徽标描边（在深玻璃上 2.48:1 可辨） |

`--hero-chip` 是**唯一允许的渐变面玻璃底**。任何渐变底上的徽标 / 卡片一律引用它，
**禁止写 `bg-white/20`、`bg-white/18` 这类裸白玻璃**（历史缺陷，已全量清除）。

---

## 4. 字号 / 字重 / 间距

- 字体栈：`--font-sans`（系统中文优先）、`--font-mono`（代码）。
- 字号层级（约定，非强制枚举）：
  - 页面标题 `30px / 32px`，正文 `15px`，正文小 `13px`，辅助 `12px`，弱提示 `11px`。
- **可读性下限 `11px`**：正文与徽标文字一律 ≥`11px`。仅**数字角标**（未读计数 `99+`）
  与 `kbd` 键位提示可到 `10px`，因为它们是单/双字符的辅助符号而非阅读内容。
  `9px` 已全部清除 —— 中文徽标（「管理员」「即将上线」）在 9px 下笔画粘连，实测不可读。
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

> **`brightness` 只能取 1.04**：`.btn-accent:hover` 的提亮会同时抬高渐变各档的亮度，
> 从而压低白字对比。1.06 会使最亮档（`#2862f4`）的白字跌到 **4.32 < 4.5**；
> 1.04 时为 4.89，达标。改这个值必须重算 §6.3。

> **单色实底场景用 `bg-accent-solid`**：当需要「纯色蓝底 + 白字」（而非渐变）时，
> 用 `bg-accent-solid` 而不是 `bg-accent`——`--accent` 是文本色，作白字底不达标。详见 §6.3。

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

> **`.menu-item` 的实测规格**：31.5px 高（`6px` 上下内边距 + `13px` 字 / `19.5px` 行高）、
> `--radius-md` 圆角、`gap: 10px`。**不要在调用点写 `px-3 py-2 text-[14px]` 重新定义** ——
> 那会得到 37px 高 / 14px 字 / 无圆角，与编辑器菜单产生可肉眼分辨的不一致（`UserMenu`、
> `TreeNodeMenu` 曾是此写法，已收敛）。行内需要危险态时追加 `text-danger hover:bg-danger-soft`；
> 需要主色态追加 `text-accent`。

> **若按菜单行数估算浮层高度**（如 `TreeNodeMenu` 的底部翻转判断），请用 **每行 32px**、
> 面板自身再加 8px（`.menu-panel` 的 `padding: 4px`）。一旦 `.menu-item` 规格变化，
> 这些估算常数必须同步，否则菜单在视口底部会翻转到错误位置。

> **画布编辑器的浮层菜单不例外**：`FlowchartEditor` 的右键菜单与导出下拉、
> `MindMapEditor` 的导出下拉同样是 `.menu-panel` 浮层，必须走 `.menu-item`。
> 曾用文件内常量 `CTX_ITEM`（`px-3 py-1.5 text-xs`）自建一套，实测算 **28px / 12px**，
> 与编辑器菜单肉眼可辨；同一个「导出下拉」在 Flowchart（28px）与 MindMap（31.5px）
> 里因此出现两种行高。§5.12 的画布豁免只针对**工具栏的 26px 高度**（那是画布内嵌 UI），
> **不适用于菜单行**——菜单是浮层，与工具栏是两类东西，勿以「画布内」为由另立规格。

需要承载表单的浮层（编辑器「插入链接」等弹窗）用 **`.popover-panel`**：与 `.menu-panel` 同为浮层，
区别是 `--surface` 底 + `--shadow-lg` + 内置 12px 内边距。

### 5.7 Tooltip（`components/Tooltip.tsx`）
API 不变：`<Tooltip content="提示" side="top|bottom">触发元素</Tooltip>`。样式由 `.tooltip-bubble` 控制（深色底 + 主色描边 + `--shadow-md` + backdrop-blur），禁用原生 `title`。

### 5.8 代码块
`.md-body .codeblock` 容器 + `.codeblock-head`（语言标签 + 复制按钮）+ `pre.shiki`（shiki 高亮）。复制逻辑在 `components/CodeBlock.tsx`（事件委托），样式与逻辑分离，勿改动复制逻辑。

### 5.9 消息气泡
用户消息用 `.bubble-accent`（渐变蓝底白字，白字 5.07:1）；AI 消息用 `border-line bg-background` 圆角卡片，错误态用 `border-danger/40 bg-danger-soft text-danger`。

> **用户气泡内的附件徽标**（`AiPanel` 的 `AttachmentBadge`）底必须是 `var(--hero-chip)`（深蓝玻璃），
> 不能是 `bg-white/20`。原名/大小两行中，**大小行原用 `opacity-70` 只有 2.54:1，已提到 `opacity-90`（6.42:1）**。
> 原因是它叠在 `--accent-grad` 渐变的**最亮档**上，白玻璃会把底提亮到白字 3.58:1。详见 §6.3。

### 5.9b 正文附件链接（`.md-body a[href*="/media/"]`）

编辑器插入的正文附件在 Markdown 里表示为链接 `[📎 文件名](/api/v1/media/<hash>?name=<原名>)`，
由 `globals.css` 里 `a[href*="/media/"]` 选中渲染为**文件芯片**（`--line-strong` 边框 +
`--surface-2` 弱底 + 圆角 + hover 转 `--accent` 边框与 `--accent-soft` 底）。

> **为什么用 href 前缀选中而不是加 class**：附件是 Markdown 链接，经
> 富文本 ↔ markdown ↔ 预览三处往返（tiptap-markdown 序列化 / 解析）后，
> 自定的 `class` 会被丢弃，只有 `href` 能稳定存活。用属性选择器是唯一可靠的做法。
>
> **为什么附件用「链接」而非自定义 TipTap 节点**：链接是 Markdown 原生构件，
> 三处往返无损；自定义节点需给 tiptap-markdown 另写序列化与解析，收益不抵复杂度。

### 5.10 品牌标识（`.logo-mark`）
渐变蓝底（`--accent-grad`）白字 + 微光，用于「知」Logo 标识，替代硬编码 `from-[#5b8dff] to-[#2b5ce6]`。
白字 5.07:1（亮/暗同值）。

### 5.11 页面级组合类（登录页 / 首页）

| 类名 | 用途 | 说明 |
| --- | --- | --- |
| `.hero-surface` | 品牌渐变面板 | `--grad-blue-indigo` 底 + 网格纹理（`::before`）+ 右上光晕（`::after`）。前景文字统一用 `--hero-ink / --hero-ink-muted / --hero-ink-faint`。**子元素自动 `position: relative; z-index: 1`**，无需手动处理层级。用于登录页左侧品牌区、首页欢迎条。 |
| `.hero-chip` | 渐变底上的小徽标 | **深蓝玻璃底**（`--hero-chip` = `rgba(9,20,62,.34)`）+ 白描边 + `backdrop-filter`，文字用 `--hero-ink`。**不可改回白玻璃**（白玻璃+白字数学上不可能达标，见 §6.3）。 |
| `.stat-tile` | 首页数据概览磁贴 | 与 `.card` 同规格，hover 上浮 1px + 蓝色描边 + `--shadow-md`。 |
| `.section-heading` | 首页区块标题 | 左侧 3px 渐变竖条（`::before`）+ 15px/600 标题；计数徽标以兄弟 `span` 传入。 |
| `.kb-topline` / `.kb-badge` | 知识库卡片 hover 装饰 | 需配合父级 `.group`：hover 时顶部渐变条淡入、首字徽标由浅底蓝字反转为渐变底白字。 |
| `.anim-rise-in` / `.stagger` | 上浮入场 | `.anim-rise-in` 单项 0.32s 上浮；`.stagger > *` 对同容器前 6 个子项依次延迟 0.02~0.22s。均受 `prefers-reduced-motion` 兜底。 |

> 品牌氛围层前景色（`--hero-ink*` / `--hero-grid-line` / `--hero-glow` / `--hero-chip*`）在 `:root` 与 `[data-theme="dark"]` 成对定义，渐变底上始终为白色系以保证对比度。

> **网格与光晕有作用域，不是全屏均匀的**（评估对比度时须注意）：
> `::before` 网格被 `mask-image` 限制在右上角（`ellipse 86% 74% at 84% 6%`），
> `::after` 光晕是以右上角为心的圆（全透明半径 = `0.68 ×` 最远角距离 ≈ 182.7px）。
> 登录页正文位于左侧，两者的实际叠加量都为 0。详见 §6.3。

### 5.12 尺寸阶梯（全站统一，勿另造新规格）

| 高度 | 类 | 用途 |
| --- | --- | --- |
| **36px** | `.btn` / `.input` / `.select` | 主表单、对话框主操作 |
| **32px** | `.btn-sm` / `.input-sm` / `.select-sm` / `.tool-btn` / `.icon-btn` | 工具栏、紧凑表单、编辑器 |
| **28px** | `.btn-ghost` | 内联文字操作（消息操作条、菜单弹窗内的小按钮） |
| 24px | （局部手写 `h-6 w-6`） | 紧贴正文的微操作（气泡内复制、列表项删除） |

- **`.tool-btn`**：工具栏图标按钮，32px + `min-width:32px`（可含图标、文字或图标+小箭头），
  hover `--hover`；选中态追加 **`.tool-btn-on`**（底与文字见下条，**不是** `--active`）。
- **`.tool-btn-on`**：选中态底用 **`--accent-soft`** + `--accent` 文字。
  **不要改用 `--active`** —— `--active` 偏深，`--accent` 文字压上去只有 3.95（选中态里含
  B / I / U 等字母按钮，不能按图标 3.0 豁免），详见 §6.3「选中态底色」。
- **`.icon-btn`**：32px 正方形（`display:grid` + `place-items:center`），用于纯图标按钮；
  与 `.tool-btn-on` 可组合表示选中。
- **`.btn-ghost`**：28px、无底色、hover 才浮现。需要主色/危险态时在 `className` 上追加
  `text-accent` / `text-danger hover:bg-danger-soft` 等 token 类覆盖。
- **例外**：画布类编辑器（`FlowchartEditor` / `MindMapEditor` / `BoardEditor`）的浮动工具栏
  为 26px 紧凑档（`rounded-md px-2 py-1 text-xs`）——属于画布内嵌 UI，需贴近画布且密度更高，
  **刻意不并入 32px 阶梯**，勿强行统一。

### 5.13 主题切换按钮（`components/ThemeToggle.tsx`）

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

### 5.15 悬停显形的行内操作（`.reveal-on-hover`）

列表行 / 卡片上的次级操作（共享、编辑、删除、复制、行尾箭头）平时隐去、hover 才浮现，
保持列表干净。**必须用 `.reveal-on-hover`（或文字型 `.reveal-on-hover-text`），
不要手写 `opacity-0 transition-opacity group-hover:opacity-100`** —— 手写写法有两个可达性缺陷：

| 缺陷 | 后果 |
| --- | --- |
| Tailwind 的 `group-hover:` 被编译进 `@media (hover: hover)` | **触屏设备上规则永不匹配**，元素永远停在 `opacity:0`，操作实际不可达 |
| 只靠 `:hover` 显形，无聚焦兜底 | 元素可 Tab 到达，但**聚焦光圈也被 `opacity:0` 一起吃掉** —— 用户 Tab 过去只看到一片空白，违反 WCAG 2.4.7「焦点可见」 |

`.reveal-on-hover` 一次性覆盖四种显形条件：`@media (hover:none)` 常显、`.group:hover`、
`:focus-visible` / `:focus-within`、`.group:focus-within`。父级仍需保留 `group` 类。

```tsx
<li className="group flex items-center gap-1 ...">
  <span className="... flex-1">标题</span>
  <button className="reveal-on-hover grid h-6 w-6 place-items-center ...">
    <TrashIcon size={12} />
  </button>
</li>
```

- 文字型操作（如「打开 →」）用 `.reveal-on-hover-text`，显形时伴随 4px 右移的细微动效。
- 正文标题锚点 `.md-anchor` 同理：hover 显形之外，另在 `@media (hover:none)` 下以
  `opacity:.6` 常显，并对 `:focus-visible` 显形。
- 均受 `prefers-reduced-motion` 兜底（位移与过渡一并关闭）。

### 5.16 加载态 / 骨架屏

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

### 5.17 分享页水印（`components/Watermark.tsx`）

公开分享页（`ShareView`）在**取到文档内容之后**叠加一层平铺水印：访客标识 + 时间。

**定位：威慑，不是防护。** 水印拦不住截屏或复制 —— 它的作用是让流出的截图**可归因**，
提高随手外传的心理成本。方案评审时须对齐此预期，不要当作防泄漏手段。

| 参数 | 值 | 说明 |
| --- | --- | --- |
| 颜色 | `--text` + `ALPHA` | 由 `getComputedStyle` 现读 → 主题切换自动跟随，**无裸色值** |
| `ALPHA` | `0.1` | **实测调出来的**，见下 |
| 步长 | `260 × 160` px，隔行错位半格（砖砌） | 够疏不糊正文；够密使局部截图裁不掉 |
| 字号 / 倾角 | 13px / `-20°` | 常规水印视觉语言 |

**对比度（实测，canvas 像素回读）**：亮色对白底 **1.245:1**、暗色对 `#0b1120` **1.263:1**，
均落在「可见（≥1.15）但不干扰阅读（≤1.35）」区间。

> 水印**不适用**正文的 4.5:1 要求（§6.3）—— 那是给需阅读的文本定的。按 4.5:1 做水印
> 会把文档整片糊住。**改 `ALPHA` 必须重新实测两个主题**。

**实现约束**
- 颜色只从 token 取，禁止硬编码（§6）。
- canvas 固定铺满视口、**不随正文滚动** —— 这是「重复平铺」的意义所在。
- `pointer-events: none` + `aria-hidden="true"`：不拦截点击，也不给读屏用户添噪声。
- 每分钟重绘一次，让时间戳保持大致当下。
- 访客标识存 `localStorage`，是**浏览器级**而非**人级**：分享页无需登录，服务端无从
  知道访客是谁。它能关联同一浏览器的多次访问，**不能**跨设备识别同一个人。
   要人级溯源须先让分享需要登录 —— 那是另一个决策。

```tsx
{/* 只放在「拿到内容」的分支：密码页 / 报错页不加水印 */}
<Watermark theme={theme} />
```

### 5.18 树形列表缩进（`components/FileTree.tsx`）

**每层缩进只有一个来源：行容器的 `paddingLeft`。**

| 常数 | 值 | 说明 |
| --- | --- | --- |
| `INDENT_STEP` | 12px | 每层递进步长，文件夹行与文档行共用 |
| `TREE_BASE_PAD` | 8px | 根行内容相对侧栏左缘的内边距 |
| `SELECT_GUTTER` | 22px | 选择框常驻留白；选择框绝对定位停在这条带里，**不占布局宽度** |
| `DOC_PREFIX_COMPENSATION` | 42px | 文档行的前缀补偿 = `SELECT_GUTTER 22 + chevron 14 + gap 6` |

> ⚠️ **反面案例（真实缺陷，2026-10-02 修）**：曾把缩进同时写在两处 ——
> 文件夹行的选择框 `<span>` 用 `marginLeft: 8 + depth*12`、内层 `<button>` 用
> `paddingLeft: 8 + depth*12`，两者**叠加**，文件夹行每层实际递进 **24px**；
> 而文档行只在行上写一次 `8 + depth*12 + 18`，每层只递进 **12px**。
>
> 后果是越深偏得越远：d2 的 `kvm` 在 126px，而它下面的文档在 102px
> （**与 d1 文件夹同深**）；`WSL安装指南` 甚至比父文件夹还浅。用户看到的就是
> 「文档挂错了层级」。
>
> **教训**：
> 1. 任何缩进/对齐量**只允许一个来源**。同一个 `8 + depth*N` 出现在两个元素上，
>    就要立刻怀疑是叠加而不是覆盖。
> 2. 改 UI 后要**实测渲染数值**（`getBoundingClientRect`），不要只看代码「逻辑正确」。
>    此缺陷里每一行代码单独看都合理，坏的是两个数字相加。
> 3. 测缩进要按**渲染嵌套**递归取父子关系 —— 这里的「行」与「子树容器」是**兄弟**，
>    任何 `.group` 都不是另一个 `.group` 的祖先；靠祖先计数推深度会恒得 0。

**对齐基准**：同级文件夹与文档的**类型图标**与**文字起点**应落在同一 x
（文件夹首枚 svg 是折叠箭头，比较时要取**第二枚** FolderIcon，否则会拿
chevron 去比 FileIcon，恒不相等）。

```tsx
// 文件夹行：外层承担缩进，选择框绝对定位
<div className="group relative flex ..." style={{ paddingLeft: TREE_BASE_PAD + depth * INDENT_STEP }}>
  <span className="absolute top-1/2 -translate-y-1/2"
        style={{ left: TREE_BASE_PAD + depth * INDENT_STEP + 1 }}><SelectBox /></span>
  <button className="flex min-w-0 flex-1 items-center gap-1.5" style={{ paddingLeft: SELECT_GUTTER }}>…
// 文档行：同一套常数 + 前缀补偿
<div className="group relative flex ... gap-1.5" style={{ paddingLeft: TREE_BASE_PAD + depth * INDENT_STEP + DOC_PREFIX_COMPENSATION }}>
```

- 文档行必须是 `gap-1.5`(6px) 而非 `gap-1`(4px)：4px 只能让「图标对齐、文字差 2px」
  或反之，二者不可兼得；6px 才同时成立（见上表 42 的推导）。

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
- `--faint` 是准文本色（占位符 / 旁白 / 计数）。**须按最严苛背景 `--surface-2` 校准，而非白底**：
  亮色 `#5f6e84` = **4.61:1（对 surface-2）**、暗色 `#8494a8` = **6.08:1**。**勿再调浅**。
  （原先按白底算的 `#64748b` 看似 4.76:1 达标，但落在 `--surface-2` 上只有 4.23:1，实为不达标。）
- `--hover` / `--active` 须在 `--background` 上**可察觉**：亮色 `#e2ecfd`（1.19）/ `#d3e2fb`（1.31）。
  原 `#eef4ff` 仅 1.10，与静止态几乎无差，hover 反馈形同失效。
- 改任何文本 token 后必须重算对比度（公式：相对亮度 `L = 0.2126R + 0.7152G + 0.0722B`，
  比值 `(L₁+0.05)/(L₂+0.05)`），并同时核对它落在 `--background` / `--surface` / `--surface-2` 上的表现。

#### 装饰性边框 vs UI 组件边界（WCAG 1.4.11 的适用范围）

- `--line` 系列的 3:1 约束**只适用于 UI 组件边界**（输入框 / 按钮 / 选择器等的可视轮廓）。
- 本项目 `border-line` 实测**在 `input`/`select`/`textarea` 上 0 次**——表单边框由 `.input` 等
  组件类内部定义。故 `--line` 实为**装饰性分隔线**（div 容器 / 分割线），**不受 3:1 约束**。
- 据此，暗色 `--line: #273549` 对 `--background` 的 **1.52:1 判定为可接受**（已高于亮色的 1.23，
  与 GitHub Primer 等业界暗色描边基线同档）。**此为定论，勿再以「不达 3:1」为由反复调整。**
- 若将来把 `--line` 用到表单控件的可视轮廓上，则该处**必须单独取 `--line-strong` 或更深值**并重算 3:1。

#### 渐变面上的前景色（关键物理约束）

**半透明白的对比度恒 ≤ 纯白。** 这条推论决定了渐变品牌区的所有取值方向：

- 若渐变某档的**纯白字**对比 < 4.5，则在它上面**任何 alpha 的半透明白都不可能达标**。
  因此要么压暗渐变色阶，要么降低叠加层强度，**不能靠调 alpha 补救**。
- **品牌区 `--grad-blue-indigo`** 承载白字与 `--hero-*` 系前景，三档 stop 全部按白字 ≥4.5 校准：
  亮色 `#065cef / #2b54fa / #6445fa`（白字 5.55 / 5.60 / 5.57），
  暗色 `#0f5ee6 / #3057f2 / #6448f3`（5.58 / 5.57 / 5.58）。
  原亮色起端 `#4f8bff` 白字仅 **2.58**，整片品牌区标题在 WCAG 上不可读。
- **`--accent` 与 `--accent-solid` 必须分开**：`--accent` 兼任 137 处 `text-accent` 文本色（需「亮」），
  `--accent-solid` 作白字底（需「暗」），同一变量无法同时满足两个方向。
  渐变主按钮底 `--accent-grad` 三档同样压到白字 ≥4.5，并预留 `hover` 提亮余量
  （`.btn-accent:hover` 的 `brightness` 只能取 1.04；1.06 会使最亮档白字跌到 4.32）。

#### 文本色的「最严苛背景」不是白底

判断文本 token 是否达标，**不能只看白底**，必须找它实际落过的**有明度底色**。
`--accent` 的教训最典型：`#2f6bff` 在白底恰好 4.50（压线），
但它最常坐的底是 `--accent-soft` `#eaf1ff`，一算只剩 **3.97**。

| 前景 | 最严苛背景 | 修复前 | 修复后 |
|---|---|---|---|
| `--accent` | `--accent-soft`（主徽标/标签/内联代码底，25 处静态共现） | 3.97  | **4.56 ✅** |
| `--accent` | `--surface-2` | 4.00 ❌ | 4.60 ✅ |
| `--accent` | `--surface` | 4.30 ❌ | 4.94 ✅ |
| `--success` | `--success-soft`（自身徽标底） | 3.00 ❌ | 4.66 ✅ |
| `--warning` | `--warning-soft` | 2.86 ❌ | 4.56 ✅ |
| `--danger` | `--danger-soft` | 3.95 ❌ | 4.54 ✅ |
| 白字 | `--danger`（暗色，作实底） | 2.77 ❌ | 4.83 ✅（改用 `--danger-solid`） |

**通用规则**：任何 `text-X` 若与 `bg-X-soft` 成对出现，必须按该 `-soft` 底校准。
这是本项目的**主徽标范式**（浅色底 + 同色深字），也是最容易被漏算的一类。

**对称的规则**：任何 `bg-X` + `text-white` 的实底场景，**同样不能复用文字色 token**——
文字色为了可读必须够亮，白字底必须够暗，方向相反。§2.1 的 `--accent-solid` 与
§2.3 的 `--danger-solid` 都是为拆开这个矛盾而存在。

#### 选中态底色：为什么 `--active` 不能配 `--accent` 文字

`.tool-btn-on`（富文本工具栏选中态）与 `AiPanel` 的历史按钮，原用 `--active` `#d3e2fb` 作底。
该底色偏深，`--accent` 文字压上去只有 **3.95**；而选中态里存在 **B / I / U 等文字按钮**
（`ToolBtn` 会渲染字母而非图标），不能按图标 3.0 豁免。

故选中态底色改用 **`--accent-soft`**（"accent on accent-soft" 是本设计系统里已被校准为 4.56 的固定搭配）：

```css
.tool-btn-on, .tool-btn-on:hover { background-color: var(--accent-soft); color: var(--accent); }
```

**区分度**：`--hover`(1.19) 比 `--accent-soft`(1.13) 更淡，仍能区分 hover 与选中两态。
`--active` 保留给纯图形用途与按下反馈（如 `.btn-secondary:active`，那里文字是 `--text`，13.6:1 无忧）。

#### 两类「纸面缺陷」需按实际渲染判定，不是看到组合就算

审计易产生假阳性。以下两类经核实**不是缺陷，勿再改动**：

1. **`--faint` on `--hover` / `--active`**（纸面 4.36 / 3.96 亮、4.16 / 3.35 暗）：
   全项目 61 处 `bg-hover` 使用点，**全部**要么带 `hover:text-text` / `hover:text-accent`
   在悬停时改掉字色（如 `text-faint hover:bg-hover hover:text-accent`），要么内部只有图标。
   其**静止态**是 `text-faint on bg-surface-2` = 4.61 ✅。故纸面组合并非实际渲染结果。
2. **`.tool-btn-on` 的 `--accent` on `--active`（纸面 3.19 暗色）**：已由上面的「选中态改底」修掉；
   其余使用点均为 `<svg stroke="currentColor">` 图标，按非文本 3.0 判定本就通过。

> **方法论**：对比度审计必须区分「**该前景色与背景色是否真的会同时出现在同一个元素上**」。
> 只按 token 全排列组合去算，会得到大量永不成立的配对（本轮 28 组纸面缺陷中仅 3 组为真）。
> 判定依据是源码里 className 的实际共现，而非配色表的两两相乘。

#### 玻璃徽标：白玻璃 + 白字是数学死结

`.hero-chip`（登录页「私有部署」、首页「N 篇收藏」）及 AI 气泡的附件徽标，原本都是
**半透明白玻璃底 + 白字**。这是不可能达标的组合（见上「半透明白恒 ≤ 纯白」）：

| 组合 | 实测（渐变色相最坏档） |
|---|---|
| 白玻璃 α=0.16 + 白字 | 4.17 ❌ |
| 白玻璃 α=0.30 + 白字 | 3.20 ❌（越白越糊） |
| **深蓝玻璃 `rgba(9,20,62,0.34)` + 白字** | **7.42 ✅** |

故 `--hero-chip` 取**深蓝玻璃**：既保住「玻璃徽标」的块感，又让白字有充足余量。
`--hero-chip-border` 相应提到 `rgba(255,255,255,0.38)`，使描边在深玻璃上仍可辨（2.48:1）。
**渐变底上一律用 `var(--hero-chip)` 作玻璃底，禁止写 `bg-white/20` 这类裸白玻璃。**

#### 装饰层的「作用域」意识

`.hero-surface` 的网格纹理（`::before`）与光晕（`::after`）**都不是全屏均匀的**：

- 网格：`mask-image: radial-gradient(ellipse 86% 74% at 84% 6%, …)` → 只在**右上角**显形，
  向左下衰减到 t=0.76 处完全透明。**登录页正文在左侧，实际叠加量为 0。**
- 光晕：`circle … transparent 68%`，68% 是相对 **farthest-corner** 的（380px 盒即 182.7px 半径），
  **不是半个边长**。仅首页右侧的 chip 落在其内。

评估此类装饰面上的文字对比时，**必须按元素实际位置代入各自的叠加量**，而不是全域取最坏值——
后者会把不存在的重叠算进来，得出过于悲观的结论。不过为留余量，两层装饰本次仍各降一档
（网格 `0.14→0.08`、亮色光晕峰值 `0.32→0.18`）。

#### 已知遗留：开关（toggle）关闭态轨道

`AiPanel` 的“联网检索”开关轨道是 `bg-accent`（开）/ `bg-line-strong`（关），白色滑块在内滑动。
实测：

| 元素 | 亮色 | 暗色 | 需 | 结论 |
|---|---|---|---|---|
| 轨道 `--accent` vs 页面底 | 4.50 | 5.80 | 3.0 | ✅ |
| 白色滑块 vs 轨道 `--accent` | 4.50 | 3.25 | 3.0 | ✅ |
| 轨道 `--line-strong` vs 页面底（**关闭态**） | **1.48** | **2.10** | 3.0 | ⚠️ 偏低 |

**为何暂不改**：`--line-strong` 同时担任“次要按钮 hover 描边”等装饰角色（多处引用），
把它整体加深会波及这些场景的观感；而开关的**开启/关闭状态由滑块位置**（左右）明确传达，
轨道自身的颜色是**冗余信息**，故按“冗余信息可豁免”处理。

> **若将来要修**：不要动 `--line-strong`，而是给开关轨道单独取一个 ≥3:1 的专用色，
> 或把关闭态改成一个浅色填充 + 边框的组合，避免影响其他引用点。

#### 图标按钮必须可访问

- **纯图标按钮（无可见文本）必须有可访问名**：优先 `aria-label`（动态场景用 `title` 兜底）。
- `Tooltip` 组件已内置自动注入：当子元素是「无文本且无 `aria-label` / `aria-labelledby` / `title`」
  的单个元素时，自动把 `content` 注入为其 `aria-label`，并在气泡打开时用 `aria-describedby` 关联。
  **因此被 `<Tooltip>` 包裹的图标按钮无需再写 `aria-label`**；含可见文本的按钮不会被覆盖。
- 新写图标按钮统一用 `.icon-btn`（32px），不要另造 `grid h-6 w-6` / `h-7 w-7` 尺寸。

#### 焦点必须可见（WCAG 2.4.7）

统一聚焦态由 `globals.css` 的 `:where(...):focus-visible` 提供（蓝色 outline）。
但**仅靠全局 outline 不够**——它会被下列写法吃掉：

- **`opacity-0` 的元素**：聚焦环与内容一起消失。凡「悬停才显形」的操作必须加聚焦兜底，
  统一用 `.reveal-on-hover`（见 §5.15）。
- **`overflow: hidden` 的祖先**：位于容器边缘的控件，其 `outline-offset` 部分可能被裁切。
  若控件紧贴裁切边界，需改用内描边（`ring-inset`）或给容器留出边距。

> 判定方法：用**真实键盘 Tab** 走一遍（`press Tab`，不要用 `el.focus()` 代替——
> 后者不触发 `:focus-visible`），逐项读 `getComputedStyle(el).opacity` 与
> `el.matches(':focus-visible')`，确认「聚焦 → 可见」成立。

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

### 6.4 图表配色（流程图 / 思维导图）

图表编辑器有一条**不同于全站的配色约束**：节点颜色是**存进文档的裸色值**（`data.fill` /
`data.stroke` / 节点 `color`），必须能随导出（PNG / SVG / PDF）带走、且跨主题打开不变形。
**因此不能用 CSS 变量**——`var(--x)` 一旦写进文档，换主题或导出都会失真。

#### 核心矛盾：节点文字色随主题翻转，节点填充却是死值

节点文字用 `var(--text)`：亮色 `#0f172a`（深），暗色 `#e2e8f0`（近白）。
而节点填充是**存下来的亮色系**（`#dbeafe` 这类粉彩）。两者一撞就是**白字压浅底**：

| 填充（亮色档） | 暗色 `--text` 在其上 |
|---|---|
| `#ffffff` | 1.23 ❌ |
| `#dbeafe` / `#fee2e2` | **1.01** ❌ |
| `#fef3c7` / `#dcfce7` | 1.11 / 1.12 ❌ |
| `#f3e8ff` / `#e0f2fe` / `#ffe4e6` | 1.04 / 1.07 / 1.03  |

**全部 8 色都在 1.0~1.2 之间 —— 暗色下节点文字等于不可见。** 这不是「观感偏淡」，是硬失效。

#### 解法：两套色板 + 按索引换档（`fillForTheme` / `strokeForTheme`）

```ts
const FILL_COLORS      = ["#ffffff", "#fee2e2", "#fef3c7", "#dcfce7", "#dbeafe", "#f3e8ff", "#e0f2fe", "#ffe4e6"];
const FILL_COLORS_DARK = ["#1e293b", "#450a0a", "#451a03", "#052e16", "#172554", "#3b0764", "#082f49", "#4c0519"];
```

**为什么是索引映射而不是 CSS 变量**：文档里存的永远是**亮色档**（导出/共享的稳定表示）；
暗色下**渲染时**按 `indexOf` 换到同索引的深色档。这样：

- 文档格式不变（无需迁移历史数据），导出结果不受当前主题影响；
- 用户**自定义**的颜色（不在色板内）与**已清空**的颜色**原样返回，绝不擅自改动用户数据**；
- 新增色板项只需在两个数组同位置各加一个值。

暗色填充的实测结果 —— 文字 **11.26~13.10 ✅**：

| 深色填充 | 暗色 `--text` | vs 画布 `#0b1120` |
|---|---|---|
| `#1e293b` | 11.87 | 1.29 |
| `#450a0a` | 13.10 | 1.17 |
| `#451a03` | 12.15 | 1.26 |
| `#052e16` | 12.09 | 1.26 |
| `#172554` | 11.92 | 1.28 |
| `#3b0764` | 12.16 | 1.26 |
| `#082f49` | 11.26 | 1.36 |
| `#4c0519` | 12.68 | 1.20 |

> **填充 vs 画布只有 1.17~1.36，是否违规？不违规。** 节点轮廓由**描边**界定，
> 而非填充与画布的对比。描边暗色档对画布 `#0b1120` 实测 **6.81~10.81（min 6.81）**，
> 远超非文本所需的 3.0 —— 边界清晰由描边负责，填充是**装饰性底面**，不受 3:1 约束。
> 这与 §6.3「`--line` 为装饰性分隔线」是同一判定逻辑。

描边用同样的两套索引映射（亮色档 `#78716c…#ec4899` → 暗色亮版 `#a8a29e…#f472b6`），
因为深底上需要**更亮**的描边才看得见 —— 方向和填充**相反**（填充要变深、描边要变亮）。
两档都再过一遍 `readableOnCanvas`（亮档原 3/8 失败、最低 2.28 → 校正后 0/8、min 3.00）。

#### 整图主题（`THEMES`）：填充要双份，描边/连线共用一份 + 运行时校正

7 套一键换色主题各带 `nodeFill` + `nodeFillDark`（如「默认蓝」`#dbeafe` → `#172554`），
因为**填充色要承载 `var(--text)` 文字**，必须按主题换档（见上文 11.26~13.10 表）。
而 `nodeStroke` / `edgeColor` 只存一份：它们是**非文本**（3.0），由 `readableOnCanvas`
按当前主题校正即可 —— 亮底原 2/7 偏低（最低「科技青」`#06b6d4` **2.43**）校正后 0/7。

#### 思维导图根节点：实底 + 白字，必须用 `-solid` token

思维导图的**根节点**是**实底 + 白字**（不同于流程图的浅底 + 深字，也不同于思维导图自身
的子节点 —— 后者是透明底 + 彩色描边）。它踩的正是 §6.3 那个**对称陷阱**：

| 场景 | 修复前 | 修复后 |
|---|---|---|
| 根节点底（暗色，原用 `--accent #4f8bff`） | **3.25** ❌ | **5.07** ✅（改 `--accent-solid`） |
| 根节点底（亮色，原 `#2f6bff`） | 4.50（压线） | **5.07** ✅ |

**`--accent` 是文字色 token（要「亮」），拿它当白字底必翻车** —— 与 §2.1 的
`--accent` / `--accent-solid` 拆分是同一个道理，只是这次发生在**图表组件内部**而非 CSS 里。
故 `MindMapEditor` 引入 `ROOT_FILL = "var(--accent-solid)"` / `ROOT_TEXT = "#ffffff"`，
**图内任何「实底 + 白字」都只能用 `-solid` 系 token。**

#### 思维导图分支调色板：不写死双套，**渲染时按主题校正**

分支节点色（`PALETTE`、各 `THEMES` 调色板、`PRESET_COLORS`、「自定义主题」即时生成的 8 色）
用在哪？—— **子节点的描边、图标与连线**。子节点本身是 `fill="var(--background)"`（透出画布底），
文字用 `var(--text)`；**调色板色从不作白字实底**。全图唯一的「实底 + 白字」节点是根节点，
它固定用 `ROOT_FILL`（上一小节）。

所以本数组的硬约束是**非文本 3.0**，且要**同时**在当前主题的两种画布底色上可辨 ——
白底 `#ffffff` 与近黑底 `#0b1120`。两者共存的合规亮度带**极窄：`L∈[0.117, 0.300]`**。

> **上一版曾误判（已回退）**：把它当作「一色一实底 + 白字」，按「白字 ≥4.5」把临界色压深
> （`#2f6bff`→`#1d4ed8`、`#0ea5e9`→`#0369a1`…）。压深只改善**白底**，却在**近黑底**恶化：

| 色值 | 白底（前 → 后） | 暗底（前 → 后） |
|---|---|---|
| `#2f6bff` → `#1d4ed8` | 4.50 → **6.70** ✅ | 4.19 → **2.81** ❌ |
| `#0d9488` → `#0f766e` | 3.74 → **5.47** ✅ | 5.03 → **3.44** ⚠️ |
| `#0284c7` → `#0369a1` | 4.10 → **5.93** ✅ | 4.60 → **3.17** ⚠️ |

主调色板 8 色的**暗底失败数 0 → 4**（最低 **2.47**，`#57534e`）—— 用 2 个亮底失败换来
4 个暗底失败，是一次净倒退。**结论：按白字压深是错误处置；颜色要朝满足两种底色的方向调。**

正确做法是**渲染时适配**，而非在色板上写死两套值（写死既要把上百色人工同步，又覆盖不到
用户自选色与运行时生成的调色板）：

```ts
// web/src/lib/colorContrast.ts
readableOnCanvas(hex, theme, target = 3.0): string
```

- 已达标的色**原样返回**（绝大多数不动，视觉与设计师原值一致）；
- 未达标时**只调明度**，**色相与饱和度保持不变** —— 用户认的是「这是绿色那支」，
  实测最大色相偏移 **< 0.35°**；
- **纯函数、不写回文档**：已存文档与导出结果（PNG / SVG / PDF）不受当前主题影响；
- 极端色（纯黑 / 纯白）在给定底色上本就无法达标时返回原值，不做无意义改写。

审计 **69 个去重色值 × 2 主题 = 138 组合**：

| 指标 | 值 |
|---|---|
| 原始色值未过 3.0（亮底 / 暗底） | 41 / 3 |
| 校正后 亮底最差 | **3.00**（`#22c55e`） |
| 校正后 暗底最差 | **3.01**（`#6b21a8`） |
| 被校正的色数 | 44 / 69（其余原样保留） |
| 最大色相偏移 | 0.30° |

同一适配器也接在流程图侧：`THEMES[].nodeStroke` / `edgeColor`（亮底原 2/7 失败 → 校正后 0/7）、
用户自选描边、以及 `STROKE_COLORS` 亮档（原 3/8 失败、最低 2.28 → 校正后 0/8、min 3.00）。

> **通用规则**：凡**存进文档的图表色**（`data.fill` / `data.stroke` / 节点 `color` / `THEMES`），
> 都享受不到 CSS token 审计的覆盖，且必须**同时在两种主题底色上可辨**。
> 处置优先用**运行时适配器**（保色相、只调明度、不写回文档），而不是写死两套色板。
> **唯一**例外是「实底 + 文字」的节点（如思维导图根节点）：它受**文本 4.5** 约束，
> 且必须用 `-solid` 系 token。

### 6.5 图形库（左栏）：页签 / 搜索 / 收藏 / 联网图标

参考 ProcessOn 重构，左栏固定三个页签：**图形库 / 我的组件 / 风格**。

#### 分类折叠与「文本」置于首位

`SHAPE_GROUPS` 为唯一事实源，分类可折叠（`aria-expanded` + `collapsedCats`）。
**「文本」必须排在「基础图形」分类的最前**——它是最高频的标注需求，
埋在 20 个几何图形之后等于没有。泳道分类命名为「泳池/泳道」。

#### 收藏（「我的组件」）是**个人偏好，不随文档走**

存 `localStorage`（键 `sunnydoc.flowchart.favorites`），不进文档、不参与协作同步：
同一个图形库在不同人手里各有所好，没有理由随文档共享。

读取用**模块级 `readFavorites()` + `useState` 惰性初始化**，**不要**放在 effect 里：
放 effect 会先渲染空态再补数据，产生一次可见闪烁，并触发 `set-state-in-effect` lint。

#### 联网图标：三重约束

1. **检索索引只有英文**。Iconify 的中文关键词实测一律返回 0 条，
   故后端维护 `ZH_TO_EN` 映射（按词长降序匹配，长词优先），翻译后再查。
   这是**功能必需**，不是优化项——去掉它中文用户搜不到任何图标。
2. **走服务端代理，不前端直连**。一屏 36 个图标需「先检索、再逐集合取正文」，
   前端直连是几十次往返；后端一次请求合并返回，前端只调 `/icons/search` 一个接口。
3. **净化必须双重**。图标正文来自公网第三方，最终经 `dangerouslySetInnerHTML` 注入。
   后端 `icon_search._sanitize_body` 与前端 `sanitizeIconBody` 各做一遍白名单过滤 ——
   任一侧单独存在都不足以抵御「另一端被绕过 / 历史文档中的脏数据」。
   白名单刻意**排除** `href/xlink:href/style/class/id/on*`：这些属性既能外链追踪，
   也能借 CSS 逃逸出节点边界。

#### 图标节点的渲染与配色

`shape:"icon"` 的节点**不存颜色**，渲染时 `fill="var(--text)"` ——
与文本节点同理，属于「跟随主题翻转」的一类，因此不受 §6.4 的裸色值约束。
尺寸等比内联 `<svg viewBox="0 0 w h">`，插入默认 64×64。

#### 文本块：无边框、无填充、只承载文字

`shape:"text"` 的节点画裸 `<text>`，仅选中时叠加虚线轮廓（`--accent` 描边 + `--accent-soft` 底），
让它在深色/浅色画布上都能被定位。**不要**套用其他图形那套「11 字符省略号截断」——
文本块存在的意义就是完整显示多行文字。

### 6.6 文字编辑＝画布内就地编辑（不弹对话框）

双击节点/连线直接在原位浮出输入框，**不再弹模态对话框**。理由是可预期性：
弹窗把「改哪个对象」的上下文切走了，用户得先读完对话框标题才知道自己在改谁；
就地编辑则让输入框本身成为「选中态」的可视反馈。

#### 坐标必须实测 DOM，不能手算

节点是 SVG，画布整体带 `transform: scale()`。节点的屏幕位置同时受
viewport（pan/zoom）、自身尺寸、以及泳道父节点偏移影响——任何在 JS 里手写的
换算公式，一旦用户缩放就会偏。改为把「正在编辑的 id」交给一个
`useLayoutEffect`，由它 `querySelector` 命中真实元素后读 `getBoundingClientRect()`，
再换算成相对容器的坐标。

- 用 **`useLayoutEffect` 而非 `useEffect`**：必须在浏览器绘制前算好位置，
  否则输入框会先出现在错误位置再跳一下（可见闪动）。
- 依赖数组要带 `viewport / nodes / edges`，否则缩放、拖拽后输入框不跟随。
- 编辑未测到矩形前用 `visibility:hidden`，避免在左上角闪一帧。
- 连线没有盒模型（是 `<path>`），取 `.react-flow__edge-textwrapper` 的包围盒；
  无标签时退回 `<path>` 本身。
- 编辑框尺寸设下限（宽 90 / 高 28 屏幕像素）：缩得很小时节点只有几十像素，
  再贴身就窄到打不出字。故**缩放小于约 0.64 时框会比节点略大，这是刻意的**。

#### 用 Context 广播「谁在编辑」，不要进 `nodeTypes` 依赖

编辑期间要隐藏节点自带的 `<text>`（否则和输入框文字重影）。这个状态通过
`EditingNodeContext` 下发，节点组件 `useContext` 取用。
**不能**把它塞进 `nodeTypes` 的 `useMemo` 依赖：`nodeTypes` 一变，React Flow
会重建节点组件类型并**重新挂载**全部节点，拖拽会当场中断。

#### 编辑期间必须冻结画布交互

`nodesDraggable / elementsSelectable / panOnDrag / zoomOnDoubleClick` 在编辑时全置 `false`。
否则在输入框里按住拖动选文字，事件穿透到画布会被判成画布平移：输入框跟着漂、选区也断。

#### 键位：Enter 与 Esc 的语义按输入框类型分岔

- 节点文字是多行 `textarea` → **Enter 换行**，提交用 `Cmd/Ctrl+Enter`。
- 连线文字是单行 `input` → **Enter 直接提交**。
- 两者 **Esc 一律取消**（丢弃草稿），失焦（`onBlur`）一律提交。
- 输入框的 `onKeyDown` 必须 `stopPropagation()`：否则画布快捷键会吃掉
  `Backspace/Delete`（删节点）与方向键。

## 5.19 媒体 URL 的解析与绝对化

后端产出的媒体引用一律是**根绝对路径**，两种形态：

| 形态 | 来源 | 服务方式 |
|---|---|---|
| `/api/v1/media/{sha1前16}.{ext}` | zip 导入时内容寻址存储 | 路由 `GET /media/{filename}`（在 `/api/v1` 下） |
| `/uploads/{uuid}.{ext}` | 编辑器上传、AI 附件、头像 | `app.mount("/uploads", StaticFiles(...))`（挂在**应用根**） |

**规则：渲染层按需绝对化，数据层保持相对。**

- **数据层永不写入 origin**。文档正文里的引用保持根绝对路径，
  否则换环境（本地 ↔ 生产）就会把旧 origin 写死进数据。
- **渲染层按 `NEXT_PUBLIC_API_BASE` 判断是否同源**：
  - 配成**绝对地址**（本地开发 `http://localhost:8000/api/v1`）→ 前后端不同源，
    渲染时必须把 `/api/v1/media/*` 与 `/uploads/*` 补成**后端 origin**。
  - 配成**相对路径或未设置**（生产静态导出，nginx 同域反代）→ **原样返回**。
    此时浏览器按当前 origin 解析即可命中，任何改写都是多余的、且有风险。

实现见 `web/src/lib/markdown.ts` 的 `absolutizeMediaUrls` / `mediaUrl`。

### 必须覆盖的渲染入口

同一个媒体 URL 会经由**多条独立代码路径**输出，只修一条就会漏：

| 入口 | 渲染方式 | 接入点 |
|---|---|---|
| Markdown 预览 | `renderMarkdown` → `dangerouslySetInnerHTML` | 清洗后统一改写 |
| HTML 文档直渲染 | `sanitizeHtml` → `dangerouslySetInnerHTML` | 清洗后统一改写 |
| 编辑态所见即所得 | TipTap `Image.renderHTML` | 扩展 `renderHTML` 补 origin |
| AI 附件缩略图 / 协作者头像 | 组件内联 `<img src>` | `mediaUrl()` |

> **TipTap 只改渲染、不改数据**：保存走 `editor.storage.markdown.getMarkdown()`，
> 文档源里仍是根绝对路径。若在 `renderHTML` 里改了 `getHTML()`，会把 origin
> 写进正文——那是错的。

### 排查要点

- **先问「两个 origin 是否同源」**。同域反代会把相对路径的解析缺陷**完全掩盖**，
  于是出现「本地裂图 / 线上正常」这种反直觉现象（本缺陷即是）。
- **`curl` 后端 200 ≠ 前端能显示**。要分别探测**后端 origin**与**前端 origin**，
  并在浏览器里读 `img.currentSrc` + `naturalWidth` —— 前者给出真实解析结果，
  后者给出是否真的解码成功。`<img>` 有 `box` 尺寸但 `naturalWidth=0`
  说明标签渲染正常、**只是 URL 拉不到资源**。

## 6.5 长文档渲染性能（实测基线，改动前必读）

### 实测基线（2026-10-11）

最长文档 **202,719 字符 / 3,005 个顶层块 / 638 个代码块**：

| 指标 | 数值 |
|---|---|
| 首屏长任务合计 | 391ms（修复后 227ms） |
| 最长单次阻塞 | 220ms（修复后 91ms） |
| DOM 节点总数 | 17,372（`.md-body` 内） |
| 正文高度 | 232,988px ≈ **233 屏** |
| 单次 DOM 写入 | 398KB（修复后 30 批 × 18KB 最大） |

### 两道阻塞来源（都已处理）

1. **代码块同步高亮**：638 个块一次高亮 = shiki 134ms + 720KB HTML 解析 200ms。
   → 对策：首屏只出纯文本（`pendingCodeHtml`），`hydrateCodeBlocks` 闲时分批补。
2. **HTML 一次性注入**：JS 赋值仅 5ms，其余 ~171ms 是浏览器样式计算/布局/绘制。
   → 对策：`renderProgressively` 每批 100 个顶层块；实测单批 1–4ms。

### 已验证**无效**的方案（不要再试）

| 方案 | 实测结果 |
|---|---|
| `content-visibility: auto` | **反而慢 8%**（675ms vs 623ms）。它优化布局与绘制，阻塞发生在构建 DOM 阶段。 |
| 单纯"更快的 JS" | 无意义：JS 只占 5ms，瓶颈在浏览器内部。 |

### 改这一块时的硬约束

1. **搜索态必须走一次性渲染。** 搜索要展示全文命中且落点可能任意靠后；
   渐进渲染会让定位漂移。用户主动搜索愿意等待，正确性优先。
2. **进度回调必须用 ref，不能用 state。** 用 state 会让"渐进渲染 effect"的
   依赖变化 → 重跑 → cancel + 重渲染 → 再次回调，形成自激循环
   （实测表现为长任务不退反升、DOM 瞬间变全量）。
3. **补高亮的语言与代码都从 DOM 取**（`data-code-lang` + `pre code` 的
   `textContent`），不要维护与 DOM 索引对齐的旁路数组——索引错位是这类
   改造的经典 bug，而 DOM 自带的顺序天然正确。
4. **`hydrateCodeBlocks` / `renderProgressively` 的清理函数必须被调用**，
   否则切换文档后会往已脱离的旧 DOM 继续写入。
5. **绝不"一次渲染到底"**：实测无条件注入剩余 240KB 会重造 178ms 长任务，
   等于把优化全部还回去。用 `ensureVisible` 逐批推进到目标出现为止。

### 验收方式

用 `web/scripts/verify_bigdoc_perf.cjs`（判据为**单次写入体积**，
而非会因阈值宽松而"恒真"的长任务时长）。

> **判据选择原则**：优先选"无法蒙混"的指标。长任务时长受机器与阈值影响，
> 回滚后仍可能通过；单次写入体积则是结构性的——恢复一次性注入必然超标。

## 6.6 文档卡片嵌入的渲染（预览态与编辑态必须一致）

卡片节点在**两条独立渲染路径**上出现，任何只改一条都会造成「一处能看、一处空白」：

| 路径 | 渲染机制 | 卡片来源 |
|---|---|---|
| 编辑态 | ProseMirror NodeView（`ReactNodeViewRenderer`） | `DocumentEmbedView` |
| 预览态 | `renderMarkdown` 产出的 HTML + `dangerouslySetInnerHTML` | 扫描 `div[data-doc-id]` 后挂载 |

**因此卡片本体必须共用同一个组件**（`DocumentEmbedCard`），由两态各自套壳：

- 编辑态：`DocumentEmbedView`（NodeViewWrapper）→ `DocumentEmbedCard`（带「移除」按钮）
- 预览态：`hydrateEmbeds` 用 `createRoot` 挂到占位 div → `DocumentEmbedCard`（只读、无移除按钮）

### ⚠️ 历史缺陷（2026-10-12 修复，勿重犯）

**预览态卡片完全不可见**。`renderHTML` 只产出占位 `<div data-doc-id>` 就返回了
（当时的理由是"预览态渲染内容会重复加载重型编辑器"），而**没有任何代码去填充它**。
实测：容器高 `0px`、子元素 `0` —— 用户在默认的预览态看到的是**一片空白**。

代价是上一轮的验证全部在**编辑态**做的，断言"卡片已插入正文"通过了，
但用户实际使用的主路径（预览）根本没被覆盖。
→ **教训：验证必须覆盖用户默认会走的路径，而不只是"某个能走通的路径"。**

### 三条硬约束

1. **`hydrateEmbeds` 必须可重复调用且幂等**：渐进渲染逐批追加 HTML，
   每批之后都要重新扫描新增的占位 div。用 `WeakMap` 记录已挂载节点去重。
   ⚠️ **cleanup 里必须同时删掉 WeakMap 记录**，否则节点仍在 DOM 时会被永久跳过
   （卡片再也无法复原）。
2. **渐进渲染下不能"先卸载再重挂"**：已追加的批次仍留在 DOM 里，
   卸载后虽有记录可重挂，但那一帧卡片会消失（表现为"滚动中卡片闪烁/消失"）。
   正解是**只挂载、不卸载**，靠 WeakMap 去重。cleanup 用**累积数组**收集。
3. **`data-embed-type` 必须挂在卡片本体上**：类型只有拉到文档后才知道，
   放在外层占位 div 上会恒为空。两态都从卡片本体读。

### 编辑器高度：卡片场景必须覆盖「整屏假设」

5 个图表编辑器都硬编码 `min-h-[calc(100vh-300px)]`（独立打开时正确），
但嵌进正文会把卡片撑到 **71% 视口**（实测 639px）。卡片场景用 token 覆盖：

```
--doc-embed-max-h: 460px;   /* .doc-embed-body 限高 + overflow auto */
--doc-embed-inner-h: 420px; /* .doc-embed-canvas > * 强制高度，覆盖 min-h */
```

**不要直接改组件里的 `min-h-[calc(100vh-300px)]`** —— 独立打开文档时那是正确的。
在容器层覆盖，组件保持自己的全屏假设。

## 6.7 卡片就地编辑（2026-10-12）

卡片默认**只读**，点「编辑」才可写；保存写回**来源文档**（卡片只是引用）。

### 为什么默认只读

卡片内嵌的是完整编辑器。长期可写会让「改卡片 vs 改正文」的焦点归属含糊，
也容易误触。用户明确要改时再切，意图清晰。

### 三条硬约束

1. **用 `draft !== null` 判编辑态，不要用「内容是否非空」**。
   五个图表编辑器的内容都是 JSON 串，**新建的空表格/空画板内容就是 `""` 或 `{}`**。
   若用「非空」判编辑态，空图表一进编辑态就会被判成「没在编辑」。
   → **编辑态必须是显式状态，不能从内容反推。**
   （`draft` 初值 `null` = 未编辑；进入编辑置为当前内容，哪怕它是空串。）

2. **`onChange` 只在已进入编辑态后才接**。
   图表编辑器在挂载后会**自动 commit 一次**
   （如 `FlowchartEditor` 的 `mounted` effect 会 `setTimeout(commit, 200)` → `onChange`），
   若 `onChange` 无条件置编辑态，卡片会在预览态**自己进入编辑态**并显示「保存」
   —— 实测踩到（reload 后 flowchart 卡片 `editing=true`）。
   实现用**函数式更新**读当前状态：
   ```tsx
   // 传 onChange 而没开编辑态 = 该卡片不该被当成脏数据
   const flush = () => {...};
   const [draft, setDraft] = useState<string | null>(null);
   const onChange = (v: string) => setDraft((prev) => (prev === null ? prev : v));
   ```
   这在语义上表示「没在编辑态就不接收」。

3. **切换 `readOnly` 时不要更换组件类型**。`renderEmbedded` 按文档类型选组件，
   但只读/编辑两态必须渲染**同一个**组件（只改 `readOnly` prop），
   即 `{type === "table" && <LazyTableEditor value={...} readOnly={!editing} .../>}`，
   而不是 `{editing ? <EditableX/> : <ReadonlyX/>}`。
   换了类型会让 React 卸载重建编辑器实例 → 内部状态（画布缩放、滚动位置、
   正在输入的内容）全部丢失。
   ⚠️ 注意 `value` 也要跟着切：只读时给 `doc.text`，编辑时给 `draft`，
   否则用户看不到自己的输入。

### 保存与冲突

- 保存带 `expectedRevision`（`doc.revision`），来源被别人改过 → **409**。
- **用 `RevisionConflictError` 判冲突，不要字符串匹配**（后者会把网络错误里的
  `409` 之类误判成冲突）。项目里已定义该类，直接 `instanceof`。
- 冲突时**不覆盖**，提示用户刷新后重试。
- 保存成功后广播 `sunnydoc:doc-saved`，主界面复用协作场景的 `refreshDoc` 刷新
  可能正开着的来源文档标签页（否则用户切过去看到旧内容，再保存会覆盖刚存的东西）。

### 各类型的编辑器都会「挂载后自动 commit」

排查同类问题（卡片/预览/嵌入）时的通用检查项：
- Flowchart：`mounted` effect → `setTimeout(commit, 200)`
- MindMap：见 `MindMapEditor` 的自动提交
- Datasheet / Board：同族模式
→ **任何把 `onChange` 当「用户开始编辑」信号的写法都不可靠**，
  必须用显式状态标记编辑态。

## 6.8 AI 问答链路（项目定位核心，改动前必读）

**定位**：sunnydoc 是「以文档为核心、支持 AI 问答与引用溯源」的知识库 ——
本节这条链路就是产品的**定位本身**，而不是附属功能。它的可用性优先级高于任何编辑器特性。

### 链路结构

```
提问 → store.search（jieba 关键词 + pgvector 向量粗召回 → rerank 精排）
     → qa.answer / chat_stream（拼 context 给 LLM）
     → LLM 生成 → 回答 + citations（引用溯源）
```

**两条并行的出口，行为必须一致**：
- `/chat`（非流式）→ `app/services/qa.py`
- `/chat/stream`（流式，**前端实际使用**）→ `routes.py::chat_stream`

### 🔴 硬约束 1：降级判断必须以「捕获异常」为前提，不能只判返回值

`llm.generate` / `generate_stream` **不是**「失败返回 None」的语义：

| 情形 | 行为 |
|---|---|
| 未配置 API Key | 返回 `None` |
| **模型不存在 / Key 无效 / 限流 / 网络异常** | **抛 `LLMError`** |

所以「`if not llm_answer: 降级`」这种写法**只覆盖了第一种情形**。
历史上 `/chat` 因此把 `LLMError` 直穿到 HTTP 层 → **500**（实测必现）。

- 两条出口**都要 `except llm.LLMError`**，并用同一份降级文案
  （`（大模型错误 {status}：已自动降级使用知识库片段）`）。
- **降级必须可观测**：把 status + detail 打进日志，否则「服务一直降级」会完全静默
  —— 这正是本次缺陷能长期潜伏的原因（接口一直 200、引用也正常，只是回答不是 LLM 生成的）。

### 🔴 硬约束 2：模型名必须选「账号实际开通」的型号

默认 `LLM_MODEL` 曾为 `qwen3-max`，实测在某 Key 下 DashScope 直接返回
**404 `Model not exist`** —— 而 `qwen-max` / `qwen-plus` / `qwen-turbo` 同 Key 均 200。

- **模型名「存在」≠「你的账号能用」**：同一模型在不同账号的开通状态不同。
  换 Key 或换供应商后，**必须重新点设置页「测试连接」**确认 200，不能沿用旧模型名。
- 默认值选**普遍可用**的型号（现为 `qwen-plus`），更强模型由设置页/env 覆盖。
- `core/config.py`、`api/.env.example` 两处的默认值必须同步。

### 🔴 硬约束 3：检索必须过滤软删除文档

软删除只改 `documents.deleted_at`，**分片故意留在 `chunks` 表**
（回收站恢复需要内容还在）。因此**每个检索 SQL 都必须显式过滤 `d.deleted_at IS NULL`**。

- 实测后果（未过滤时）：库存 **83 篇已删文档 / 3365 行分片**仍被召回，
  并作为「引用来源」出现在 AI 回答里 → 用户点进去是 404，**引用溯源失去可信度**。
- `db.search_chunks` 有 **3 个 SQL 分支**（`kb_ids` / `user_id` / 无过滤），
  **改一个分支必须同步改另外两个**（与「同一资源多个动词鉴权容易只写一个」同族）。
- **不要**改成「删除时清 chunks」—— 那会破坏回收站恢复。过滤只放在读取侧。

### 验收方式

- 后端：`scripts/verify_deleted_retrieval.py`（三分支 + `--raw` 对抗性探针）。
  **必须跑 `--raw`**：它用修复前的旧 SQL 查询，能召回才证明测试真的测到了过滤逻辑
  （否则可能是「该文档本来就召回不到」——那这条断言等于没测）。
  查询向量取自目标文档自身，从而把「是否被过滤」变成唯一变量。
- 前端：`web/scripts/verify_ai_answer.cjs` —— 读**用户屏幕上真正的回答文本**，
  断言「不含『大模型错误』」「不是规则拼接模板『根据知识库中的「』」
  「含引用标注如 `[1]`」「页面无 JS 错误」。
  **光看接口 200 是不够的** —— 本次缺陷全程返回 200。

## 6.9 全文搜索的匹配语义（`/search`，改动前必读）

### 规则：空白分组 AND；组内按「是否含中文」分流

| 输入片段 | 组内候选 | 理由 |
|---|---|---|
| **含中文**（`虚拟机怎么开机`） | jieba 分词结果，**OR** | 中文不加空格，必须切开才能匹配 |
| **纯英文/数字/符号**（`vt-x`、`/dev/sda`） | **原串精确匹配**（不切） | 见下 |
| **引号包裹**（`"虚拟机 的日常"`） | 整段为一个词 | 给用户显式的原样匹配途径 |

**分组之间是 AND**（`kvm 磁盘` = 两个分组，都要命中）—— 这是既有契约，
`test_multi_keyword_requires_all` 在守着。

### 🔴 为什么纯英文片段不能分词

**jieba 对英文是按符号切的**，产生的碎片在标识符语境下只是噪声。实测（2026-10-12）：

| 查询 | 正确做法 | 无脑分词 OR 的后果 |
|---|---|---|
| `/dev/sda` | 6 条 | **124 条**（`dev` 命中 development 之类） |
| `vt-x` | 4 条 | **20 条**（`vt`） |

`vt-x`、`/dev/sda`、`ceph-osd` 这类标识符**本就该精确匹配**；想宽松就直接搜 `sda`。
这条规则还顺带保证 **`kvm virsh` 这类纯英文多词查询完全保持原行为**（AND，不退化）。

### 🔴 必须回传 `terms`（前端高亮契约）

响应新增 `terms` = 实际参与匹配的词表。**前端必须用它做高亮，不能用原始查询串**：

- 后端按分词 OR 匹配，「虚拟机怎么开机」命中的是 `虚拟机` / `开机`，
  **文档里根本不存在这个整串** → 用原始串高亮会「有结果但零高亮」。
- 前端链条：`searchDocumentsFull()` 返回 `{results, terms}` →
  `page.tsx` 存 `searchTerms` → 传给 `Sidebar` 与正文 `highlight`（空格拼接，
  `highlightKw` / `highlightText` 本就支持多关键词）。
- 兼容：`terms` 缺失时回退到原始查询串（旧后端）。

### 验收方式

- 后端：`tests/test_search_ranking.py` 的 5 个中文用例。
  数据刻意构造成「文档里**只有分词后的词**、没有整串」——
  旧实现（整串匹配）必然 0 条、新实现必然命中，**可区分**。
- 前端：`web/scripts/verify_search_cjk.cjs` —— 读侧栏真实的「共 N 条结果」
  与 `<mark class="search-hit">` 数量/文本，断言高亮词恰为分词结果。
- **验证新测试非恒真**：把 `_search_groups` 换成旧实现跑一遍，
  4 项新用例必须精确失败（实测确认）。这是项目对每个新测试的硬要求。

## 6.10 搜索片段的清洗（snippet 可读性，改动前必读）

### 为什么必须清洗

原实现是「以命中点为中心、固定半径的**原样切片**」：
`text[idx-60 : idx+60].replace("\n", " ")` —— 命中点落在 markdown 结构里时，
切出来的就是结构噪声。**实测 10 个高频查询、185 条结果，142 条（77%）含噪声**：

| 噪声类型 | 条数 |
|---|---|
| 标题号 `##` `###` | 109 |
| 代码围栏 ` ``` ` | 41 |
| 长空白（表格对齐空格） | 29 |
| 图片 / 链接语法 | 29 |
| 表格竖线 `|` | 22 |

真实对照（搜「磁盘」命中「15-磁盘管理」）：

```
修复前：…                    ```    ## 2、磁盘管理 ### 2.1、磁盘     ← 看不出为何命中
修复后：…df -h /mnt 2、磁盘管理 2.1、磁盘 - 磁盘/硬盘：永久存放数据   ← 是句人话
```

### 🔴 两条渲染分支都要清洗（踩过的覆盖盲区）

`snippet` 有**两条产出路径**，只改一条会漏：

| 分支 | 触发条件 | 走哪个函数 |
|---|---|---|
| 正文命中 | 正文里有命中词 | `_make_snippet`（在命中点附近取） |
| **仅标题命中** | 正文里**没有**命中词 | `_lead_snippet`（取正文开头） |

「仅标题命中」很常见：`01-集群部署` / `03-Grafana部署与使用` / `部署harbor仓库`
这些文档**标题含「部署」但正文完全不含**（数据库 `position('部署' in text) = 0`）。

⚠️ 我最初只改了 `_make_snippet`，量化的「77% → 1%」**正好绕过了这条分支** ——
直到真机验证才暴露（4 条片段以 `## 1. 概述` 开头、含围栏）。
**改一个渲染分支时必须检查同一功能的其它分支**（同族：`search_chunks` 三个 SQL
分支、分享接口多个动词只鉴权一个）。

### 清洗规则与两条刻意保留的边界

- 图片/围栏/HTML 标签 → 删；**链接保留可见文字**（丢 URL 不丢信息）；
- markdown 记号（`| > # * ` _ ~`）→ 换成**空格**而非删除：
  删除会把相邻词粘成一个（`磁盘</td><td>类型` → 假词「磁盘类型」）；
- 🔴 **表格分隔线规则用「连续 ≥3 个短横线」**，不是 2 个 ——
  否则会误伤 `--disk` / `--vcpus`。**库内大量是运维命令手册，误伤代价很高。**
- 🔴 **必须处理「被窗口截断的」标记**：完整模式匹配不到 `![img](/api`（缺右括号），
  真机残留 3/206 全是这类。分两条规则（尾部 `!\[.*$` + 中部 `!\[[^\]]*$`），
  并额外清掉项目自身的媒体路径（`/api/v1/media/…`、`/uploads/…`）。

### 为什么可以放心清洗

前端 `highlightKw` 是**自己在渲染文本里搜词**的，不依赖后端给的字符偏移；
`match_count` / `match_in_title` 也都基于原始文本。
**所以 snippet 只是给人看的「展示串」，清洗不影响任何逻辑。**

### 验收方式

- 后端：`tests/test_search_snippet.py`（20 项，含两条分支 + 边界 + 截断残留）。
- 前端：`web/scripts/verify_snippet_clean.cjs` —— 读**渲染后**的片段文本。
- **判据修正（一次假失败）**：第一版断言「每个片段都必须有高亮」，4 条不满足。
  数据库直查确认那是**判据错**：这些文档正文确实不含命中词，片段取正文开头
  自然没有，**而标题已高亮**。正确要求是「**标题或片段至少一处高亮**」。
  （同族教训：断言失败先怀疑判据，再怀疑代码。）

## 6.11 搜索片段的选位（取「最密集处」，取改动前必读）

### 规则：`_best_hit` 挑命中最密集的簇，锚点取簇中心

原实现取**第一个命中点**作为片段中心。实测 464 条结果，
**293 条（63%）的密集窗口命中数明显高于首命中所在窗口**：

| 文档 | 长度 | 首命中位置 | 首窗命中 | 密集窗命中 |
|---|---|---|---|---|
| `openEuler安全配置基线`（搜"日志"） | 202,719 | @13063（6% 处） | 1 | **14** |
| `故障处理`（搜 nginx） | 17,081 | @10441（61% 处） | 1 | **11** |
| `01-常用命令`（搜 docker） | — | @16 | 3 | **10** |

→ **首命中常常落在目录 / 引言 / 顺带提及处**，不是真正讨论该主题的地方。

### 🔴 硬约束 1：选位跨度必须等于渲染跨度

`_best_hit` 若用 200 字符窗找「最密集处」，而 `_make_snippet` 只渲染约
`radius*2` 个字符，则「最密集的 200 字符窗」居中后截到 140 字符，
**未必是最密集的 140 字符窗**。实测片段密度只有 **80% ≥ 首命中窗口**。

→ 两者共用常量 **`_SNIPPET_RADIUS = 70`**。对齐后升到 **91%**（真机 99 条对照）。

### 🔴 硬约束 2：锚点取「最接近簇中心」的命中，不是「簇内第一个」

`_make_snippet` 是**以返回位置为中心**取前后各 `radius` 的。若返回簇内第一个命中，
片段只覆盖密集簇的**前半段**、另一半半径浪费在簇外（实测 80%）。
返回**最接近簇中心**的位置后，片段对称覆盖整个簇（→ 88%，再对齐跨度后 91%）。

### 怎么改这一块的判据（血泪教训）

**第一版真机判据「A ≥ B 的占比 ≥ 90%」在回滚后仍然通过**（!）——
因为回滚成「取首个」时，A 与 B 算的就是同一处 → `A == B` 占比 85%，
「≥」自然满足。而 `A > B` 的占比差异巨大：

| 判据 | 正确实现 | 回滚实现 |
|---|---|---|
| `A > B` 占比 | **55%** | **5%** |
| `A == B` 占比 | 36% | 85% |

→ 正确判据是 **`A > B` 的占比 ≥ 25%**（配 `A < B` 占比 ≤ 15%）。
**这是「阈值型断言看似合理、实则无区分度」的又一例** ——
每个断言都要用「回滚实现」验一遍能否失败。

### 验收方式

- 后端：`tests/test_search_snippet_position.py`（6 项，夹具刻意「稀疏在前、密集在后」）。
- 前端：`web/scripts/verify_snippet_position.cjs` —— 读界面片段的命中密度，
  与「首命中窗口」的密度对照（同一文档、同一词表，只有选位不同）。

## 6.12 引用定位词（`terms`）—— 点击引用后能否高亮

### 规则

引用卡片点击后要在来源文档里高亮。定位词**由后端下发**（`citation.terms`），
前端不再自己拼。实现在 `api/app/services/snippet.py::locate_term`。

### 🔴 硬约束 1：定位词必须来自后端，前端不要自己拼

前端原先是 `snippet.replace(/\s+/g," ").slice(0,20)` —— 拿分片的**前 20 字符**
当高亮词。但分片是**裸原文**，前 20 字常含换行/制表/表格对齐空格：

| 分片开头 | 前端拼出的词 | 结果 |
|---|---|---|
| `温馨提示:\\r\\n\\t上述两条命令…` | `温馨提示: 上述两条命令必须在KVM虚拟` | 空白被压 → 找不到 |
| ` ```sh\\r\\n#取出指定网卡的信息` | ` ```sh #取出指定网卡的信息 ip ` | 换行 → 找不到 |
| `\\| 常见原因        \\| 排查  \\|` | `\\| 常见原因 \\| 排查 \\| 如何解决 \\|` | 对齐空格被压 → 找不到 |

实测 12 条引用**只有 6 条（50%）**能定位到；改由后端下发后 **100%**。

### 🔴 硬约束 2：词必须「内部无空白」+「原文可验」+「不在代码块内」

三条都是踩出来的：

1. **不能取清洗后的拼接串**。清洗把 `温馨提示:\\r\\n\\t上述…` 变成
   `温馨提示: 上述…`，但**原文里仍是 `\\r\\n\\t`** → 照样搜不到。
   → 取**单个词**（内部无空白，空白差异不影响匹配）。
2. **中文没有空格，`split(" ")` 的 token 往往是整行**。早先对超长 token
   直接**跳过** → 中文分片几乎全被跳过、`terms` 空（实测 4/18）。
   → 改为**截前缀**，并**拿原文验证**（清洗可能移除过 token 内部字符）。
3. 🔴 **必须在代码块之外**。前端高亮走 `renderMarkdown`，
   **代码块里的文字不做关键词高亮**（由 shiki 处理、内容在 `<code>` 里）。
   选到块内的词 → 「文档跳过去了、正文里也搜得到，但**一个高亮都没有**」。
   实测 `kvm日常使用命令` 里有作者把「温馨提示」写在代码块结束前
   （整篇 34 个围栏、该词之前 33 个 = 奇数）→ 点击后 `mark.search-hit` 为 **0**。

   ⚠️ **块内外必须按「整篇正文」判断，不能按分片**：
   `_segment` 按空行/句子切片、**不知道代码块结构**，分片边界会截断代码块
   （实测某分片开头就是块内文字、却只含 1 个行首围栏）。
   → `locate_term(chunk_text, full_text)`，`full_text` 用于块内外判定。
   也因此引用构造需要 `_full_texts(hits)` 取整篇。

   ⚠️ 也不能用「统计 ` ``` ` 个数」的朴素做法（行内代码里也会出现），
   用**行首围栏**判定。

### 🔴 硬约束 3：所有引用路径共用一份实现

引用有 **3 条产出路径**（`/search` 的 snippet 分支、`/chat`、`/chat/stream`），
历史上各写各的，于是**两次分叉**：

| 分叉 | 后果 |
|---|---|
| 清洗只改了 `_make_snippet` | 兜底分支与引用路径漏出 `##` / 围栏 |
| 定位词只加在 `/chat/stream` | `/chat` 的 `terms` 全为空 |

→ 已收成 `app/services/snippet.py`，三条路径都从那里取。
**根因不是"忘了改第二处"，而是"第二处没有共用的东西可改"。**

### 验收方式

- 后端：`tests/test_search_snippet.py` 的定位词用例
  （含「分片被截断」的模仿夹具 + 全代码块返回空 + 字段形状）。
- 前端：`web/scripts/verify_citation_anchor.cjs` —— **真的点击引用**，
  读正文里的 `mark.search-hit` 数量与文本。
- 对抗性：忽略 `full_text`（退回只看分片）→ 单测精确失败 **且真机高亮回到 0**。

## 6.13 悬停动效体系（`.lift` / `.lift-sm` / `.lift-x` / `.tree-row`）

### 为什么要有这一节

实测全站 `hover:` **397 处**、`transition` **212 处**，但 `duration-` 仅 **3 处**、
`scale-` 13、`translate-` 20 —— **以颜色变化为主，缺有幅度的交互反馈**。
本节把「位移 + 缩放 + 阴影」收口成 token 化类名，改一处即可调全站手感。

### 四类及其适用场景（**幅度分场景，不是一处大到底**）

| 类 | 幅度 | 用于 |
|---|---|---|
| `.lift` | `translateY(-3px) scale(1.03)` + `--shadow-lg` | 卡片、首页入口（点击目标） |
| `.lift-sm` | `translateY(-1px) scale(1.008)` + `--shadow-md` | 密集网格（stat-tile） |
| `.lift-x` | `translateX(3px)` | **`overflow-hidden` 容器内的列表行** |
| `.tree-row` | 无几何变换，仅左侧强调条 | **文件树行（刻意）** |

后两条都是「不能位移」的场景，理由不同：

- `.lift-x`：列表容器是 `overflow-hidden rounded-xl`，垂直位移/缩放会在
  **首尾行被裁切成半截** → 改用水平轻推。
- `.tree-row`：树行缩进由 `paddingLeft = BASE + depth * STEP` 精确控制，
  位移/缩放会让文字横向偏移或行间重叠，**看起来就像「层级变了」** ——
  对树形列表这是**功能性误导**（项目有专门的缩进纪律，见 §5.18）。
  → 用「背景 + 左侧强调条」做强反馈。

### token

```
--dur-fast: 120ms      纯颜色变化
--dur-base: 180ms      位移+缩放
--dur-slow: 260ms      大面板展开
--ease-out / --ease-spring
--lift-sm: -1px  --lift-md: -3px
```

### 🔴 陷阱：入场动画会把 `transform` 永久钉死

`.stagger > *` 原用 `animation: rise-in ... both`。**`both` 含 `forwards`**，
而 **CSS 动画优先级高于普通声明** → `rise-in` 的 `to { transform: translateY(0) }`
把元素的 transform 永久钉住，**任何 `:hover { transform: ... }` 全被压住**。

实测症状极隐蔽（值得记住的诊断手法）：

- `.stagger` 里的知识库卡片 hover 时 `--shadow-glow` **正常生效**，
  `getComputedStyle().transform` 却**恒为** `matrix(1,0,0,1,0,0)`；
- 而**同一套 `.lift` 用在 `.stagger` 之外**（最近浏览列表行）**完全正常**。

→ **「同一个类在 A 处生效、B 处不生效」时，先查 B 处有没有别的规则占用了同一属性。**
→ 修法：入场动画一律用 **`backwards`**（只在开始前应用首帧），
  动画结束后不再占用 transform。`.anim-rise-in` 同理。

### 🔴 无障碍硬要求

`prefers-reduced-motion: reduce` 下**必须关掉位移与缩放**（前庭功能障碍用户会不适），
但**保留颜色/阴影反馈** —— 否则 hover 完全没反应，用户不知道指针在哪一项上。

### 验收方式

`web/scripts/verify_hover_motion.cjs` —— 读 `getComputedStyle().transform` 与
`getBoundingClientRect()` 的**实测值**（不是查 className 里有没有 "lift"），
并用 `reducedMotion: "reduce"` 另开页面验证降级。

## 6.14 移动端 / 触屏适配（阶段 2）

### 🔴 触屏适配用「输入方式」判定，不用屏幕宽度

```css
@media (hover: none) and (pointer: coarse) { ... }
```

**为什么不用 `max-width`**：触控目标大小是**输入方式**问题，不是屏幕宽度问题 ——
带鼠标的窄窗口不需要放大，平板配鼠标也不需要。
用宽度断点会把「手机上被放大」和「桌面上被放大」混为一谈。
（桌面 32px 阶梯见 §5.12，触屏抬到 44，用 `min-width/min-height` 而非改尺寸，
避免图标视觉变大破坏版面。）

### 三处实测缺陷（动手前的基线）

在 375 / 393 / 412 三档手机视口实测：

| 视图 | 横向溢出元素 | 触控目标 <44px |
|---|---|---|
| 首页 | **15**（头部总宽 **564px**，右侧全被推出屏幕 213px） | 7 |
| 知识库 | 5 | 7 |
| 文档阅读 | 5 | 7 |

### 修法

| 位置 | 问题 | 处理 |
|---|---|---|
| 首页头部 | 搜索 200px + 新建 109 + 主题 44 + 用户 187 | 搜索/新建文案 `hidden md:inline`；用户区 `hidden sm:flex` |
| `.icon-btn` | 32px 太小 | 触屏下 `min 44` |
| 行内图标（共享/编辑/删除） | 24px 视觉尺寸 | **扩命中区**：透明 `::after` 44×44 |
| AI 按钮 | 窄屏只剩图标 43px 宽 | `min-w-11` |

### 🔴 两个陷阱

1. **`::after` 扩命中区前必须先给它 `position: relative`**。
   `.reveal-on-hover` 默认是 `static`，而 `absolute` 的 `::after` 会去定位
   **最近的已定位祖先** —— 实测跑到 `left:170.5px/top:86.5px`（容器坐标），
   **命中区完全没落在按钮上**，等于没扩。
2. **验收脚本必须把 `::after` 的尺寸算进命中区**，否则会把「已扩展」的行内图标
   **误报**为过小（`getBoundingClientRect()` 量的是 border-box）。

### 验收方式

`web/scripts/verify_mobile_adaptive.cjs`：
- A. 三档手机视口 × 三视图：横向溢出 **0**、触控目标 **全部 ≥44**
- B. **PC 回归护栏**：桌面 `.icon-btn` 仍 32px、`.reveal-on-hover::after` 不启用、
  搜索入口仍 ≥200px —— 防止「为移动端改坏桌面」

另：`scripts/audit_mobile.cjs` 是**体检工具**（只输出问题清单、不判定成败），
改版式前先跑它拿基线。

## 6.15 层级导航（阶段 3）—— 3~4 级可到达

### 问题：功能都是「深度 1 的弹窗」

实测改造前：应用**只有 4 个顶层视图**（`home`/`kb`/`users`/`trash`），
而 **28 个对话框**承载绝大多数功能 —— 弹窗**进去就到底**：

| 功能 | 原来怎么到 | 深度 |
|---|---|---|
| 系统设置 | 用户菜单 → 弹窗 | 1（到底是 AI 配置长表单） |
| 用户管理 | 用户菜单 → 视图 | 1（只有「用户 / 操作日志」一个二级 Tab） |
| 回收站 | 用户菜单 → 视图 | 1 |
| 版本历史 / 分享 / 标签 / 导出 | 文档操作 → 弹窗 | 1 |

用户无法「设置 → AI 配置 → 某供应商」，也无法用后退键逐级返回。

### 方案：状态式层级 + hash 同步（**不引 Next 路由**）

`next.config.ts` 是 `output: "export"`（静态导出）。引入 App Router 的动态段
需要预生成全部路径或改成非静态导出 —— 对已上线的部署形态风险太大。
改用 **hash + pushState**，达到同等体验且零路由依赖：

```
#/                        → 首页
#/kb                      → 知识库
#/settings                → 设置（L2）
#/users                   → 用户管理（L2）
#/users/<id>              → 用户详情（L3）
```

内核：`hooks/useViewStack.ts`（路径段数 = 层级数 - 1）。

### 🔴 三条行为约定

1. **进入子页 = `pushState`；同层切换 = `replaceState`**。
   若切 Tab 也压栈，后退键要按很多次才能出去。
2. **应用内返回按钮 == 浏览器后退**（都走 `history.back()`）——
   保证两条路径语义一致，不会「点了返回但后退键还在原地」。
3. **首次加载读取 hash**（分享链接/刷新可停留），`popstate` 时同步回 React 状态。

⚠️ **hash 只表达「在哪一层」**，不存列表筛选/滚动位置 ——
否则后退行为会变得难以预期。

### 🔴 面包屑必须可点

只显示 `设置 / AI 配置 / 供应商` 而不让点，等于仍是单向深入 ——
用户到第 4 级就得按 3 次返回。**每一级可点**才是真正的层级导航。
`PageHeader`（`components/PageShell.tsx`）统一承载面包屑 + 返回 + 标题。

### 🔴 弹窗不要删，要「抽成共用组件」

`SettingsDialog` 用 `variant="dialog" | "page"` 两种形态渲染，
**同一份 968 行表单逻辑**；用户编辑/重置/删除抽成 `UserEditDialogs`，
供 L2 列表与 L3 详情共用。

理由：复制一份必然分叉 —— 本项目已因「同一数据两条产出路径」
在片段/引用上踩过两次（§6.12）。**收口比新写更省事。**

### 验收方式

`web/scripts/verify_nav_depth.cjs`：用户菜单 → 设置页（hash 变 `#/settings`）；
深链 `#/settings` 直达；**浏览器后退回上一级**（hash 与界面同步）；
面包屑可点回退；移动端 375px 可到达且无横向溢出。

## 6.16 智能体工具编排（阶段 4）

### 定位：从「问答」到「操作」

改造前 AI 只能聊天 —— `tool_call` / `function_call` 全项目 **0 处**。
后端有 **94 个接口（61 个写操作）**，AI 一个也调不到。
现在把系统能力收敛成 **28 个语义化工具**，模型可基于对话完成检索、
新建/修改/移动文档、管理文件夹与知识库、查看系统状态，并**控制界面**（打开文档、切换视图）。

### 🔴 为什么是 28 个而不是 94 个

工具太多会**降低模型选择准确率**（选择空间大 → 更容易挑错），
且大量接口只是同一动作的不同视图（如分页/详情/统计）。
收敛原则：**一个工具对应一件「用户想做的事」**，而不是一个 HTTP 端点。

| 级别 | 数量 | 行为 |
|---|---|---|
| `read` | 13 | 立即执行，结果回灌给模型 |
| `write` | 9 | 立即执行，并在对话里提示已做 |
| `destructive` | 6 | **不执行** → 前端弹确认卡片 → 用户确认后才执行 |

### 🔴 `execute()` 只校验，`commit()` 才落库

这是本阶段最重要的一条结构约束。破坏性工具被拆成两半：

```
execute(name, args, ctx)   校验参数 + 解析目标 → 返回 pending=True，**无副作用**
       ↓ 前端展示确认卡片，用户点「确认执行」
commit(name, args, ctx)    真正的 store.delete_* （经 /agent/confirm）
```

**为什么必须物理隔离**：只要 `execute` 里不小心调了一次 `store.delete`，
就会出现「用户还没点确认，东西已经没了」。代码评审看不出这一点 ——
它是**行为约束**，只能靠测试钉住（见下方验收方式 C/E 成对断言）。

### 🔴 破坏性结果回灌时必须标注「尚未执行」

实测踩到并修掉的真缺陷：destructive 工具的返回值里有 `ok: true`，
模型看到就告诉用户「**已将文档移入回收站**」—— 而库里文档还在。
**这是会让用户误判的高危误导。**

两层防护（缺一不可）：
1. `execute` 返回值**不带任何「已完成」语义**（去掉 `action: "已移入回收站"` 这类字段）；
2. 回灌的 `role="tool"` 消息里**显式追加否定句**：
   「⛔ 注意：以上操作【尚未执行】……**你现在绝不能说「已删除/已完成」**」。

系统提示里也写了同一条规则（模型对「工具返回里的显式标注」比「系统提示的一句话」更敏感，
两处都写才稳）。

### 🔴 权限一律继承当前用户

不存在「AI 有超级权限」：

- `ToolContext.user` 就是当前登录用户；所有工具调用**带 `user_id` 的 store 方法**，
  由 store 内部做属主/知识库权限判定 —— 与 HTTP 接口同一套授权。
- 管理员工具（`list_users` / `update_user` / `get_ai_settings` / `delete_user`）
  额外 `_require_admin(ctx)`，条件与 `require_admin` 依赖完全一致（`role == "admin"`）。
- `/agent/confirm` 里**再校验一次**（`commit` 内部又有 `_require_admin`）——
  不能靠「前端只对管理员显示确认卡片」来保证安全。
- 越权返回 `denied: true` 与「参数错误」**区分开**：否则模型会换个说法反复重试同一件事。

### 流式 + 工具的取舍

实测 DashScope（`qwen-plus`）在两种情况下行为清晰可分：

| 情形 | `content` | `finish_reason` |
|---|---|---|
| 直接回答 | 有增量 | `stop` |
| 需要调工具 | 空 | `tool_calls` |

因此采用 **`stream_turn`**：边流边判断 —— 直接回答能立即出字，
需要动作时在结尾拿到完整 `tool_calls` 再执行。
若改成「先非流式探一轮」，**所有**回答都要先等满一轮生成，简单问答体感明显变差。

⚠️ 流式下 `tool_calls` 的参数**按 `index` 分片到达**，必须按 index 累积字符串再解析。

### 界面控制 = 复用阶段 3

`open_document` / `goto_view` 不改数据，只返回 `ui_action` 指令，
前端交给 `useViewStack` 与 `openDoc` 执行。**这是「基于对话操作整个系统」的界面侧** ——
模型说「打开那篇文档」，落到用户眼前就是文档真的打开了，而不是只在回答里贴一个 id。

### 多轮上下文压缩

`compress_history`：保留最近 12 条消息，更早的压成「早先用户问过：…」的规则式摘要。
**不做直接丢弃**（用户在第 10 轮问「那刚才那个文档呢」时，丢掉历史会让指代完全失去依据）。
摘要**不额外调 LLM**：每轮再插一次模型调用会明显拉长首字延迟，收益只是措辞更自然。

### 验收方式

`web/scripts/verify_agent_tools.cjs`（5 段）：

- **A** 简单问答：不触发工具（不能因为接了工具就变慢/变哑）
- **B** 需要检索：出现「搜索文档」轨迹标签，且回答基于检索结果
- **C** 破坏性操作：出现确认卡片 + 文案含「尚未执行」+ **此时库里文档仍在**
- **D** 点「取消」：卡片消失、文档仍在
- **E** 点「确认执行」：卡片消失、**文档真的被删**

**C 与 E 必须成对**：只测 C 不能证明「确认能用」，只测 E 不能证明「确认前没执行」。

后端侧：`api/tests/test_agent_tools.py`（工具分级、越权、非法 JSON、未知工具）。

### 🔴 三个验证脚本自身的坑（都不是产品缺陷）

1. **页面上有两个 `aside`**（文件树 `relative` + AI 面板 `fixed z-50`）——
   `querySelector("aside")` 命中的是文件树，于是所有断言跑在错误元素上、一整片假失败。
   → 用 `aside.fixed.z-50` 精确定位。**这是本项目第二次因「抓错容器」得到假失败。**
2. **不要靠「猜请求是否结束」收敛等待**。我原先按「页面上有没有『停止/生成中』按钮」
   判断流式结束，而该文案并不存在 → `busy` 恒为 false → 提前 break →
   读到还没渲染的工具标签，功能明明是好的却全红。
   → **轮询到「要断言的那个状态」**：断言什么就等什么出现。
3. 首页**没有** AI 入口（`TitleBar` 只在知识库视图渲染），且
   `hasText:/知识库/` 会命中首页列表里含该词的文档标题 → 要先点知识库卡片
   （`.lift` + 精确文本）再找 `^AI 问答$`。
