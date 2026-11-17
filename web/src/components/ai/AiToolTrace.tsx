"use client";

import { useState } from "react";
import type { ToolTraceItem } from "@/lib/chatHistory";

/**
 * 工具调用轨迹（可折叠步骤条）。
 *
 * ## 现状与改造（2026-11-17）
 *
 * 原实现把每个工具调用渲染成一个内联 chip（`inline-flex ... px-1.5 py-0.5`），
 * 十几个工具连着调时会在气泡上方堆成一条密集的 chip 带，把正文挤下去；
 * 而且读和写**看起来一样**，用户分不清「它只是看了看」还是「它改了东西」。
 *
 * 改成分两层：
 *   - **折叠态**（默认）：一行摘要「正在查找文档 · 2 个步骤」
 *   - **展开态**：竖排步骤条，读/写/破坏性用不同图标与颜色区分
 *
 * ## `data-tool-trace` / `data-tool-label` 必须保留
 *
 * 这两个属性是**验证脚本的稳定锚点**（`verify_agent_tools.cjs` 等靠它断言）。
 * 早先脚本用类名定位（`div.mb-1.flex.flex-wrap > span`），样式一改就静默失配，
 * 表现为「后端明明调了工具、断言读到空数组」。折叠后 `data-tool-label`
 * 只在展开时可见 —— 所以**折叠态也需要带一份**，否则脚本会假失败。
 */

/** 破坏性操作在折叠态也要一眼看见，所以单独判。 */
function hasDestructive(items: ToolTraceItem[]): boolean {
  return items.some((t) => t.level === "destructive");
}

/** 折叠态摘要：「正在执行 3 个步骤」/「已完成 3 个步骤」/「有 1 步失败」。 */
function summarize(items: ToolTraceItem[]) {
  const total = items.length;
  const running = items.filter((t) => t.ok === undefined).length;
  const failed = items.filter((t) => t.ok === false).length;
  if (failed > 0) return `有 ${failed} 个步骤失败`;
  if (running > 0) return `正在执行 ${total} 个步骤`;
  return `已完成 ${total} 个步骤`;
}

function StepIcon({ item }: { item: ToolTraceItem }) {
  if (item.ok === undefined) {
    return (
      <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border border-current border-t-transparent" />
    );
  }
  if (item.ok) {
    return (
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 6L9 17l-5-5" />
      </svg>
    );
  }
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

export function AiToolTrace({ items }: { items: ToolTraceItem[] }) {
  const [open, setOpen] = useState(false);
  const danger = hasDestructive(items);
  const failed = items.filter((t) => t.ok === false).length;

  const tone = danger
    ? { text: "text-danger", border: "border-danger/40", bg: "bg-danger-soft" }
    : failed > 0
      ? { text: "text-warning", border: "border-warning/40", bg: "bg-warning-soft" }
      : { text: "text-muted", border: "border-line", bg: "bg-surface-2" };

  return (
    <div data-tool-trace="1" className="mb-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`flex w-full items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] transition-colors ${tone.border} ${tone.bg} ${tone.text} hover:brightness-[0.98]`}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
        >
          <path d="M9 18l6-6-6-6" />
        </svg>
        <span className="min-w-0 flex-1 truncate text-left">{summarize(items)}</span>
        {danger && <span className="shrink-0 font-medium">含改动</span>}
      </button>

      {/* 折叠态也保留 data-tool-label（视觉隐藏），供验证脚本读取。
          折叠后若要按 label 断言，脚本不必先展开 —— 这是有意的。 */}
      {!open && (
        <div className="sr-only">
          {items.map((t, k) => (
            <span key={k} data-tool-label={t.label} />
          ))}
        </div>
      )}

      {open && (
        <ol className="mt-1 flex flex-col gap-0.5 border-l border-line pl-2.5">
          {items.map((t, k) => (
            <li
              key={k}
              data-tool-label={t.label}
              className={`flex items-center gap-1.5 text-[12px] ${
                t.ok === false ? "text-danger" : t.level === "destructive" ? "text-danger" : "text-muted"
              }`}
              title={t.error || t.name}
            >
              <StepIcon item={t} />
              <span className="truncate">{t.label}</span>
              {t.level !== "read" && (
                <span
                  className={`shrink-0 rounded px-1 text-[10px] ${
                    t.level === "destructive"
                      ? "bg-danger-soft text-danger"
                      : "bg-surface-2 text-faint"
                  }`}
                >
                  {t.level === "destructive" ? "删除" : "修改"}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}