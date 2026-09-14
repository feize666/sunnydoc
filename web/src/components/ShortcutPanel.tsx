"use client";

import { useEffect } from "react";

interface ShortcutGroup {
  group: string;
  items: { keys: string; desc: string }[];
}

const GROUPS: ShortcutGroup[] = [
  {
    group: "全局",
    items: [
      { keys: "⌘ / Ctrl + K", desc: "打开命令面板" },
      { keys: "⌘ / Ctrl + /", desc: "打开本快捷键面板" },
      { keys: "?", desc: "打开本快捷键面板" },
      { keys: "Ctrl + F", desc: "全文搜索" },
      { keys: "Ctrl + I", desc: "导入文档" },
      { keys: "Ctrl + ,", desc: "系统设置" },
      { keys: "Ctrl + Shift + T", desc: "切换主题" },
      { keys: "Esc", desc: "关闭弹窗 / 取消选择" },
    ],
  },
  {
    group: "通用编辑（流程图 / 思维导图）",
    items: [
      { keys: "⌘ / Ctrl + Z", desc: "撤销" },
      { keys: "⌘ / Ctrl + Y", desc: "重做" },
      { keys: "⌘ / Ctrl + C", desc: "复制" },
      { keys: "⌘ / Ctrl + V", desc: "粘贴" },
      { keys: "⌘ / Ctrl + D", desc: "复制并粘贴" },
      { keys: "⌘ / Ctrl + A", desc: "全选" },
      { keys: "Delete / Backspace", desc: "删除选中" },
      { keys: "方向键", desc: "移动选中（Shift 加速）" },
    ],
  },
  {
    group: "思维导图",
    items: [
      { keys: "Tab", desc: "添加子主题" },
      { keys: "Enter", desc: "添加同级主题" },
      { keys: "F2", desc: "编辑节点文字" },
      { keys: "双击节点", desc: "编辑节点文字" },
      { keys: "拖拽节点", desc: "重排父子关系" },
      { keys: "滚轮", desc: "缩放画布" },
    ],
  },
  {
    group: "流程图",
    items: [
      { keys: "双击节点 / 连线", desc: "修改文字" },
      { keys: "拖拽连线", desc: "创建连接" },
      { keys: "滚轮", desc: "缩放画布" },
    ],
  },
];

export function ShortcutPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/30" onClick={onClose} />
      <div className="glass anim-scale-in fixed left-1/2 top-[14%] z-50 w-[600px] max-w-[92vw] -translate-x-1/2 overflow-hidden rounded-xl shadow-lg">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div className="text-[15px] font-semibold text-text">快捷键</div>
          <button
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-md text-faint transition-colors hover:bg-hover hover:text-text"
            title="关闭"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="grid max-h-[62vh] grid-cols-1 gap-4 overflow-y-auto px-4 py-4 sm:grid-cols-2">
          {GROUPS.map((g) => (
            <div key={g.group}>
              <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-faint">
                {g.group}
              </div>
              <ul className="space-y-1.5">
                {g.items.map((it, i) => (
                  <li key={i} className="flex items-center justify-between gap-3">
                    <span className="text-[13px] text-muted">{it.desc}</span>
                    <kbd className="shrink-0 rounded border border-line bg-background px-1.5 py-0.5 font-mono text-[11px] text-text">
                      {it.keys}
                    </kbd>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="border-t border-line bg-surface px-4 py-1.5 text-[10px] text-faint">
          按 <kbd className="rounded border border-line bg-background px-1 font-mono text-[10px]">?</kbd> 或 <kbd className="rounded border border-line bg-background px-1 font-mono text-[10px]">⌘/</kbd> 随时呼出 · Esc 关闭
        </div>
      </div>
    </>
  );
}
