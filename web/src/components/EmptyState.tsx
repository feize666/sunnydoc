"use client";

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 px-6 py-14 text-center ${className ?? ""}`}
    >
      {icon && (
        <div className="mb-2 grid h-16 w-16 place-items-center rounded-2xl border border-line bg-accent-soft text-accent shadow-md [&>svg]:h-7 [&>svg]:w-7">
          {icon}
        </div>
      )}
      <div className="text-[15px] font-semibold text-text">{title}</div>
      {description && (
        <div className="max-w-[280px] text-[13px] leading-relaxed text-muted">
          {description}
        </div>
      )}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
