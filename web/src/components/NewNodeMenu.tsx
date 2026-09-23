"use client";

import { useLayoutEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";

/**
 * portal 到 body 的浮层菜单容器标记。
 *
 * 菜单用 createPortal 渲染到 body 后，DOM 上已不在触发按钮的 ref 子树内，
 * 父级若用 `ref.contains(target)` 判定「点击外部」就会把「点击菜单项」
 * 误判为外部点击 —— mousedown 阶段先卸载菜单，导致 mouseup/click 失去
 * 目标、click 事件永不派发，表现为「菜单能弹出但点不动」。
 * 因此父级的关闭逻辑必须用此标记放行（同 Editor 划词浮层的
 * `data-annotate-btn` 思路）。
 */
export const PORTAL_MENU_ATTR = "data-portal-menu";

export type NodeType =
  | "doc"
  | "folder"
  | "table"
  | "board"
  | "datasheet"
  | "mindmap"
  | "slides"
  | "flowchart";

function Icon({ d, color, size = 18 }: { d: string; color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      {d.split("|").map((p, i) => (
        <path key={i} d={p} />
      ))}
    </svg>
  );
}

interface TypeDef {
  type: NodeType;
  label: string;
  desc: string;
  color: string;
  available: boolean;
  icon: string;
}

const TYPES: TypeDef[] = [
  { type: "doc", label: "文档", desc: "富文本笔记", color: "#3b82f6", available: true, icon: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z|M14 2v6h6" },
  { type: "table", label: "表格", desc: "行列数据", color: "#22c55e", available: true, icon: "M3 3h18v18H3z|M3 9h18|M3 15h18|M9 3v18|M15 3v18" },
  { type: "folder", label: "目录", desc: "分类整理", color: "#f97316", available: true, icon: "M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" },
  { type: "board", label: "画板", desc: "自由绘制", color: "#a855f7", available: true, icon: "M3 3h18v18H3z|M7 16l4-4 3 2 4-5" },
  { type: "datasheet", label: "数据表", desc: "结构化数据", color: "#0ea5e9", available: true, icon: "M4 5h16v14H4z|M4 9h16|M9 9v10" },
  { type: "mindmap", label: "思维导图", desc: "梳理思路", color: "#ec4899", available: true, icon: "M12 4v16M12 8H5M12 14h7" },
  { type: "flowchart", label: "流程图", desc: "流程可视化", color: "#6366f1", available: true, icon: "M12 2l6 8-6 8-6-8z|M12 6v4M12 14v4" },
  { type: "slides", label: "幻灯片", desc: "演示文稿", color: "#ef4444", available: false, icon: "M3 5h18v12H3z|M3 9h18|M9 9v8" },
];

/**
 * 「+」新建多类型面板（彩色图标 + 释义）。
 *
 * 通过 createPortal 渲染到 body 并 fixed 定位，脱离文件树的
 * overflow-y-auto 滚动容器，避免在侧栏中下部弹出时被裁剪。
 * 传入 anchorRef 时按 trigger 位置定位；否则用默认视口内定位。
 */
export function NewNodeMenu({
  onSelect,
  onClose,
  align = "right",
  anchorRef,
}: {
  onSelect: (type: NodeType) => void;
  onClose: () => void;
  align?: "left" | "right";
  anchorRef?: RefObject<HTMLElement | null>;
}) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = anchorRef?.current;
    if (el) {
      const r = el.getBoundingClientRect();
      const MENU_W = 320;
      const MENU_H = Math.min(268, window.innerHeight * 0.7);
      let left = align === "left" ? r.left : r.right - MENU_W;
      let top = r.bottom + 4;
      // 视口校正：右侧溢出则靠左；下方空间不足则向上展开
      if (left + MENU_W > window.innerWidth - 8) left = window.innerWidth - MENU_W - 8;
      if (left < 8) left = 8;
      if (top + MENU_H > window.innerHeight - 8) top = r.top - MENU_H - 4;
      if (top < 8) top = 8;
      setPos({ left, top });
    } else {
      setPos(null);
    }
  }, [anchorRef, align]);

  if (typeof document === "undefined") return null;

  const menu = (
    <div
      {...{ [PORTAL_MENU_ATTR]: "" }}
      className="anim-fade-in menu-panel fixed z-50 w-[320px] max-h-[70vh] rounded-xl p-1.5"
      style={{ ...(pos ?? {}), overflowY: "auto", overflowX: "hidden" }}
    >
      <div className="grid grid-cols-2 gap-0.5">
        {TYPES.map((t) => (
          <button
            key={t.type}
            disabled={!t.available}
            onClick={() => {
              if (t.available) {
                onClose();
                onSelect(t.type);
              }
            }}
            className={`flex items-start gap-2.5 rounded-lg px-2.5 py-2.5 text-left transition-colors ${
              t.available
                ? "hover:bg-hover"
                : "cursor-not-allowed opacity-60"
            }`}
          >
            <span
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg"
              style={{ backgroundColor: `${t.color}1a` }}
            >
              <Icon d={t.icon} color={t.color} />
            </span>
            <span className="min-w-0 flex-1 pt-0.5">
              <span className="flex items-center gap-1">
                <span className={`text-[14px] font-medium ${t.available ? "text-text" : "text-faint"}`}>
                  {t.label}
                </span>
                {!t.available && (
                  <span className="rounded bg-surface-2 px-1 py-px text-[11px] leading-none text-faint">
                    规划中
                  </span>
                )}
              </span>
              <span className="mt-0.5 block text-[11px] text-faint">{t.desc}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );

  return createPortal(
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      {menu}
    </>,
    document.body,
  );
}
