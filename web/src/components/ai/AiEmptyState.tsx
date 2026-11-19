"use client";


/**
 * 空态的能力卡。
 *
 * ## 为什么要有它（2026-11-17）
 *
 * 原空态只有一个通用气泡图标 + 一句「开始新的对话」，新用户完全不知道
 * 能问什么。后端有 24 个工具（14 个写/破坏性），界面一个都没提。
 *
 * 改成 4 张卡：三张「问」，一张「做」。
 * 点击后**填入输入框**而不是直接发送 —— 用户往往想改一改再问
 * （比如换成自己知识库里的文档名）。直接发送会让 4 张卡变成 4 个坑。
 *
 * ## 卡片内容怎么定的
 *
 * 按后端工具清单倒推，只挑**真能做成**的：
 *   - 建文档  → create_document
 *   - 找内容  → list_documents + 检索
 *   - 总结    → get_document + LLM
 *   - 整理标签 → set_document_tags（write 级）
 *
 * ⚠️ 不要写「删除文档」这类破坏性示例：新手第一个点的就是它，
 *    而删除需要二次确认，体验上是「求助反而被吓到」。
 */
interface Capability {
  /** 卡片主文案（用户看到的问题）。 */
  text: string;
  /** 一行说明做了什么。 */
  hint: string;
  /** 图标类型。 */
  icon: "write" | "search" | "summary" | "tag";
}

const CAPABILITIES: Capability[] = [
  {
    text: "帮我写一篇部署记录",
    hint: "新建文档并写入正文",
    icon: "write",
  },
  {
    text: "这个知识库里有哪些关于 K8s 的文档",
    hint: "检索标题与正文",
    icon: "search",
  },
  {
    text: "把刚才那篇文档总结成三段",
    hint: "读取全文后提炼",
    icon: "summary",
  },
  {
    text: "给最近改过的文档都加上「待复习」标签",
    hint: "批量改标签",
    icon: "tag",
  },
];

function CapIcon({ kind }: { kind: Capability["icon"] }) {
  const common = {
    width: 15,
    height: 15,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (kind === "write") {
    return (
      <svg {...common}>
        <path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
      </svg>
    );
  }
  if (kind === "search") {
    return (
      <svg {...common}>
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-3.5-3.5" />
      </svg>
    );
  }
  if (kind === "summary") {
    return (
      <svg {...common}>
        <path d="M4 6h16M4 12h10M4 18h7" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M20.6 13.4L13.4 20.6a2 2 0 0 1-2.8 0l-7.2-7.2a2 2 0 0 1-.6-1.4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 1.4.6l6.4 6.4a2 2 0 0 1 0 2.8z" />
      <circle cx="7.5" cy="7.5" r="1.2" />
    </svg>
  );
}

export function AiEmptyState({
  onPick,
  logo,
}: {
  /** 点卡片：把文案填进输入框（不直接发送）。 */
  onPick: (text: string) => void;
  /** 主视觉（由调用方传入，避免这个文件依赖 Logo 实现）。 */
  logo: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 px-4 py-10 text-center">
      {logo}
      <div className="flex flex-col gap-1">
        <div className="text-[15px] font-medium text-text">今天想做什么？</div>
        <div className="text-[12px] leading-relaxed text-faint">
          可以直接提问，也可以让我动手改文档
        </div>
      </div>

      <div className="grid w-full max-w-[420px] gap-1.5" data-ai-capabilities="1">
        {CAPABILITIES.map((c, i) => {
          // 屏幕阅读器读按钮时只有主文案（"帮我写一篇部署记录"），
          // 听不出它"会做什么"也听不出"点了只是填入不发送"。
          // 用 aria-describedby 把 hint 挂上去，读作
          // "帮我写一篇部署记录，新建文档并写入正文"。
          const descId = `ai-cap-desc-${i}`;
          return (
            <button
              key={c.text}
              type="button"
              onClick={() => onPick(c.text)}
              aria-describedby={descId}
              /*
               * 悬停/聚焦用**纯 CSS**（group-hover + group-focus-visible），
               * 不用 onMouseEnter 的 JS 状态。
               *
               * 🔴 为什么（2026-11-19 实测）：原先只挂 onMouseEnter，
               *    键盘 Tab 到卡片时**底色毫无变化**，只有全局的 2px outline。
               *    鼠标用户能"扫一眼看哪张卡高亮"，键盘用户不能 —— 两类用户
               *    的视觉反馈不一致。而 `:focus-visible` 只在键盘导航时生效，
               *    正好符合"键盘用户需要它、鼠标用户不需要"的语义。
               */
              className="group flex w-full items-center gap-2.5 rounded-lg border border-line bg-background px-3 py-2.5 text-left transition-colors hover:border-accent/40 hover:bg-accent-soft focus-visible:border-accent/40 focus-visible:bg-accent-soft"
            >
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-surface-2 text-muted transition-colors group-hover:bg-accent/12 group-hover:text-accent group-focus-visible:bg-accent/12 group-focus-visible:text-accent">
                <CapIcon kind={c.icon} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] text-text">{c.text}</span>
                <span id={descId} className="block text-[11px] text-faint">
                  {c.hint}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}