"use client";

import type { ReactNode } from "react";
import { Tooltip } from "./Tooltip";

/**
 * 页面壳：统一的「返回 + 面包屑 + 标题 + 右侧操作」头部（阶段 3）。
 *
 * ## 为什么需要它
 *
 * 改造前 `TrashView` / `UserManagementView` / `AuditLogView` 各自手写头部，
 * 结构雷同但实现重复（`h-12` + 返回按钮 + 标题块）。要支持 **3~4 级导航**，
 * 每级都需要「我在哪、怎么回去」，重复手写必然分叉。
 *
 * ## 面包屑是可点击的（这是「可到达」的核心）
 *
 * 只显示 `设置 / AI 配置 / 供应商` 而不让点，等于仍是单向深入 ——
 * 用户到了第 4 级就必须按 3 次返回。**每一级都可点**才是真正的层级导航。
 * 当前级不可点（就是当前页）。
 */

export type Crumb = {
  label: string;
  /** 提供时渲染为可点按钮；最后一项（当前页）不传。 */
  onClick?: () => void;
};

/** 只渲染「头部」（不含内容容器）—— 供需要自己控制内容区的页面复用。 */
export function PageHeader({
  title,
  subtitle,
  crumbs,
  onBack,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  crumbs?: Crumb[];
  onBack?: () => void;
  actions?: ReactNode;
}) {
  const showCrumbs = !!crumbs && crumbs.length > 1;
  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-line px-3 py-2 sm:h-12 sm:px-4 sm:py-0">
      {onBack && (
        <Tooltip content="返回上一级">
          <button
            onClick={onBack}
            className="icon-btn shrink-0 text-muted hover:text-text"
            aria-label="返回上一级"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5" />
              <path d="M12 19l-7-7 7-7" />
            </svg>
          </button>
        </Tooltip>
      )}
      <div className="min-w-0 flex-1 leading-tight">
        {/* 面包屑：窄屏也保留（它是层级导航的唯一可视线索），靠横向滚动容纳 */}
        {showCrumbs && (
          <nav
            aria-label="位置"
            className="mb-0.5 flex items-center gap-1 overflow-x-auto text-[12px] text-faint"
          >
            {crumbs!.map((c, i) => {
              const last = i === crumbs!.length - 1;
              return (
                <span key={`${c.label}-${i}`} className="flex shrink-0 items-center gap-1">
                  {i > 0 && <span className="text-faint/60">/</span>}
                  {last || !c.onClick ? (
                    <span className={last ? "text-muted" : ""}>{c.label}</span>
                  ) : (
                    <button
                      onClick={c.onClick}
                      className="rounded px-0.5 transition-colors hover:text-accent hover:underline"
                    >
                      {c.label}
                    </button>
                  )}
                </span>
              );
            })}
          </nav>
        )}
        <h1 className="truncate text-[16px] font-semibold text-text">{title}</h1>
        {subtitle ? <div className="truncate text-[12px] text-faint">{subtitle}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function PageShell({
  title,
  subtitle,
  crumbs,
  onBack,
  actions,
  children,
  /** 内容区是否自带内边距（列表页通常自己控制，表单页需要外壳给） */
  padded = false,
}: {
  title: string;
  subtitle?: ReactNode;
  /** 从顶层到当前级的路径；为空则不渲染面包屑。 */
  crumbs?: Crumb[];
  /** 返回上一级。未提供时用面包屑回退（有 crumbs 即可不留返回键）。 */
  onBack?: () => void;
  /** 头部右侧操作区。 */
  actions?: ReactNode;
  children: ReactNode;
  padded?: boolean;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <PageHeader
        title={title}
        subtitle={subtitle}
        crumbs={crumbs}
        onBack={onBack}
        actions={actions}
      />
      <div className={`min-h-0 flex-1 ${padded ? "overflow-y-auto p-4" : "overflow-hidden"}`}>
        {children}
      </div>
    </div>
  );
}