"use client";

import type { ReactNode } from "react";

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  danger?: boolean;
}

/** 「···」更多操作下拉菜单。 */
export function TreeNodeMenu({
  items,
  onClose,
}: {
  items: MenuItem[];
  onClose: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-20" onClick={onClose} />
      <div className="menu-panel absolute right-0 top-full z-30 mt-1 w-44 overflow-hidden rounded-xl py-1">
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
    </>
  );
}
