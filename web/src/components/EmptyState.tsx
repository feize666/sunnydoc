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
    <div className={`flex flex-col items-center justify-center gap-1.5 px-6 py-10 text-center ${className ?? ""}`}>
      {icon && <div className="mb-1 grid h-12 w-12 place-items-center rounded-full bg-surface-2 text-faint">{icon}</div>}
      <div className="text-[14px] font-medium text-text">{title}</div>
      {description && <div className="max-w-[260px] text-[12px] leading-relaxed text-faint">{description}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
