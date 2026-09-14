"use client";

import { useLayoutEffect, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  danger?: boolean;
}

/** 「···」更多操作下拉菜单。用 portal + fixed 定位，脱离滚动容器裁剪。 */
export function TreeNodeMenu({
  items,
  onClose,
  anchorRef,
}: {
  items: MenuItem[];
  onClose: () => void;
  anchorRef?: RefObject<HTMLElement | null>;
}) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = anchorRef?.current;
    if (el) {
      const r = el.getBoundingClientRect();
      const MENU_W = 176;
      // 菜单高度受 max-h-[70vh] 限制，超出部分内部滚动
      const MENU_H = Math.min(items.length * 36 + 12, window.innerHeight * 0.7);
      let left = r.right - MENU_W;
      let top = r.bottom + 4;
      if (left + MENU_W > window.innerWidth - 8) left = window.innerWidth - MENU_W - 8;
      if (left < 8) left = 8;
      if (top + MENU_H > window.innerHeight - 8) top = r.top - MENU_H - 4;
      if (top < 8) top = 8;
      setPos({ left, top });
    } else {
      setPos(null);
    }
  }, [anchorRef, items.length]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="menu-panel fixed z-50 w-44 max-h-[70vh] overflow-y-auto overflow-x-hidden rounded-xl py-1" style={pos ? { left: pos.left, top: pos.top } : undefined}>
        {items.map((item, i) => (
          <button
            key={i}
            onClick={() => {
              onClose();
              item.onClick();
            }}
            className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-[14px] transition-colors ${
              item.danger
                ? "text-danger hover:bg-danger-soft"
                : "text-text hover:bg-hover"
            }`}
          >
            {item.icon && <span className="text-muted">{item.icon}</span>}
            {item.label}
          </button>
        ))}
      </div>
    </>,
    document.body,
  );
}
