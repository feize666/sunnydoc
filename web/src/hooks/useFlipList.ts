"use client";

import { useLayoutEffect, useRef } from "react";

/**
 * 轻量 FLIP 动画（不引第三方库）：列表项增删时，其余项平滑移动。
 *
 * 用法：
 *   const listRef = useFlipList(items);
 *   <div ref={listRef}> … <li data-flip-key={key}>…</li> … </div>
 *
 * 原理：记录上一次布局中每个 data-flip-key 元素的纵向位置；当 `deps` 变化
 * （列表数据更新、项被增删）后，对比新旧位置，对仍在列表中的元素做
 * translateY 反转 → 下一帧 transition 归零，实现「剩余项平滑上移/下移」。
 */
export function useFlipList(deps: unknown) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const positionsRef = useRef<Map<string, number>>(new Map());

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const els = container.querySelectorAll<HTMLElement>("[data-flip-key]");
    const prev = positionsRef.current;
    const next = new Map<string, number>();

    els.forEach((el) => {
      const key = el.dataset.flipKey;
      if (!key) return;
      const top = el.getBoundingClientRect().top;
      const prevTop = prev.get(key);
      if (prevTop !== undefined && Math.abs(prevTop - top) > 0.5) {
        const dy = prevTop - top;
        // 反转：先定位到旧位置，再在下一帧过渡回新位置
        el.style.transition = "none";
        el.style.transform = `translateY(${dy}px)`;
        requestAnimationFrame(() => {
          el.style.transition = "transform 0.28s cubic-bezier(0.16, 1, 0.3, 1)";
          el.style.transform = "translateY(0)";
        });
      }
      next.set(key, top);
    });

    positionsRef.current = next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deps]);

  return containerRef;
}
