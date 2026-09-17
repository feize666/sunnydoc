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
  hover `--hover`；选中态追加 **`.tool-btn-on`**（`--active` 底 + `--accent` 文字）。
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

> ️ **上一版曾误判（已回退）**：把它当作「一色一实底 + 白字」，按「白字 ≥4.5」把临界色压深
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
