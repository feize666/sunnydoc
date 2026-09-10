"use client";

import { useState, useCallback, useRef, type MouseEvent as ReactMouseEvent } from "react";

/**
 * 侧栏拖拽加宽 hook。
 * 返回 { width, onMouseDown }：把 onMouseDown 绑到拖拽手柄上即可，
 * 宽度自动 clamp 到 [min, max]，松手后持久化到 localStorage（可选）。
 */
export function useResizable(
  initial: number,
  min: number,
  max: number,
  storageKey?: string,
  direction: 1 | -1 = 1,
) {
  const [width, setWidth] = useState<number>(() => {
    if (typeof window === "undefined" || !storageKey) return initial;
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved) {
        const n = Number(saved);
        if (!Number.isNaN(n)) return Math.min(max, Math.max(min, n));
      }
    } catch {
      /* ignore */
    }
    return initial;
  });

  const widthRef = useRef(width);
  widthRef.current = width;

  const onMouseDown = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startW = widthRef.current;

      const onMove = (ev: MouseEvent) => {
        const delta = (ev.clientX - startX) * direction;
        setWidth(Math.min(max, Math.max(min, startW + delta)));
      };
      const onUp = () => {
        if (storageKey) {
          try {
            window.localStorage.setItem(storageKey, String(widthRef.current));
          } catch {
            /* ignore */
          }
        }
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [min, max, storageKey],
  );

  return { width, onMouseDown };
}
