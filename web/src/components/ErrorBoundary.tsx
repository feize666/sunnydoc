"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * 错误边界：捕获子树渲染/生命周期异常，降级为局部错误提示，避免整页白屏。
 *
 * 典型用途：包裹重型编辑器（React Flow 流程图/思维导图/画板等），
 * 某个文档渲染抛错时只降级该区域，用户仍可切换其它文档。
 *
 * 重置方式：父级给本组件换 key（例如 key={doc.key}），切换文档时自动重挂载重置。
 */
export class ErrorBoundary extends Component<
  { children: ReactNode; title?: string; onReset?: () => void },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 便于在控制台定位；生产环境可接入上报
    console.error("[ErrorBoundary]", error, info?.componentStack);
  }

  private reset = () => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.error) {
      return (
        <div className="mx-auto my-10 max-w-[560px] rounded-lg border border-danger/30 bg-danger-soft px-5 py-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-danger/10 text-danger">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <path d="M12 9v4M12 17h.01" />
              </svg>
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold text-text">
                {this.props.title ?? "此内容渲染失败"}
              </div>
              <div className="mt-1 text-[13px] leading-relaxed text-muted">
                {this.state.error.message || "发生了未知错误"}
              </div>
              <div className="mt-2 text-[12px] text-faint">
                其它文档不受影响，可切换或点击下方重试。
              </div>
              <button
                onClick={this.reset}
                className="btn btn-sm btn-secondary mt-3 hover:border-accent/40 hover:text-accent"
              >
                重试
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}