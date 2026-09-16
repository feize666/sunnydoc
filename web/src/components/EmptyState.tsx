"use client";

/**
 * 统一空状态。
 *
 * 规格（见 DESIGN.md §5.14）：
 * - `page`（默认）：页面 / 主内容区。大图标框 64px、`py-14`、15px 标题 + 13px 描述。
 * - `panel`：侧栏 / 弹层 / 对话框分栏等窄容器。28px 图标、`py-8`、13px 标题 + 12px 描述，
 *   宽度不足时也不会把容器撑破。
 *
 * 不要为「紧贴正文的一行提示」（如树形节点下的「暂无文件夹」、字段占位「暂无描述」）
 * 套用本组件 —— 那类属于内联旁白，直接用 `text-faint` 一行文字即可。
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  size = "page",
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  size?: "page" | "panel";
  className?: string;
}) {
  const panel = size === "panel";
  return (
    <div
      className={`flex flex-col items-center justify-center text-center ${
        panel ? "gap-1 px-4 py-8" : "gap-2 px-6 py-14"
      } ${className ?? ""}`}
    >
      {icon && (
        <div
          className={`grid place-items-center border border-line bg-accent-soft text-accent ${
            panel
              ? "mb-1 h-9 w-9 rounded-lg [&>svg]:h-4 [&>svg]:w-4"
              : "mb-2 h-16 w-16 rounded-2xl shadow-md [&>svg]:h-7 [&>svg]:w-7"
          }`}
        >
          {icon}
        </div>
      )}
      <div className={panel ? "text-[13px] font-medium text-text" : "text-[15px] font-semibold text-text"}>
        {title}
      </div>
      {description && (
        <div
          className={`leading-relaxed text-faint ${
            panel ? "max-w-[220px] text-[12px]" : "max-w-[280px] text-[13px]"
          }`}
        >
          {description}
        </div>
      )}
      {action && <div className={panel ? "mt-2" : "mt-3"}>{action}</div>}
    </div>
  );
}