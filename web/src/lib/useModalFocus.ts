"use client";

import { useEffect, useRef } from "react";

/**
 * 模态对话框焦点管理。
 *
 * 解决三件事：
 *   1. Esc 关闭 —— 且支持嵌套对话框（只有最上层响应，内层先关）。
 *   2. 焦点陷阱 —— Tab / Shift+Tab 在对话框内循环，不逃逸到背后页面。
 *   3. 焦点归还 —— 打开时记住触发元素，关闭后把焦点还回去（屏幕阅读器／
 *      键盘用户不会「丢失位置」）。
 *
 * 同时自动给面板补上 role="dialog" / aria-modal="true" / tabIndex=-1，
 * 调用方只需把返回的 ref 挂到 .dialog-panel 上，并传入标题作为可访问名。
 *
 * 用法：
 *   const ref = useModalFocus<HTMLDivElement>(open, onClose, "导出文档");
 *   return <div ref={ref} className="dialog-panel …">…</div>;
 */

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** 已打开的对话框栈：仅栈顶对话框响应 Esc / Tab 陷阱 */
const dialogStack: symbol[] = [];

export function useModalFocus<T extends HTMLElement>(
  open: boolean,
  onClose?: () => void,
  label?: string,
) {
  const panelRef = useRef<T | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const idRef = useRef<symbol>(Symbol("modal"));
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const id = idRef.current;
    dialogStack.push(id);
    restoreRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    // 补模态语义（零侵入，不覆盖调用方已写的同名属性）
    const panel = panelRef.current;
    if (panel) {
      if (!panel.hasAttribute("role")) panel.setAttribute("role", "dialog");
      if (!panel.hasAttribute("aria-modal")) panel.setAttribute("aria-modal", "true");
      if (!panel.hasAttribute("tabindex")) panel.setAttribute("tabindex", "-1");
      if (label && !panel.hasAttribute("aria-label") && !panel.hasAttribute("aria-labelledby")) {
        panel.setAttribute("aria-label", label);
      }
    }

    // 初始焦点：若组件自身用了 autoFocus（已在 panel 内）则不抢
    const raf = requestAnimationFrame(() => {
      const p = panelRef.current;
      if (!p || p.contains(document.activeElement)) return;
      const first = p.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? p).focus({ preventScroll: true });
    });

    const onKeyDown = (e: KeyboardEvent) => {
      const isTop = dialogStack[dialogStack.length - 1] === id;

      if (e.key === "Escape") {
        // defaultPrevented：内层（如标签建议下拉）已自行处理，避免误关整个对话框
        if (e.defaultPrevented || !isTop) return;
        e.preventDefault();
        closeRef.current?.();
        return;
      }

      if (e.key === "Tab" && isTop) {
        const p = panelRef.current;
        if (!p) return;
        const items = Array.from(p.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
          (el) => el.getClientRects().length > 0,
        );
        if (items.length === 0) {
          e.preventDefault();
          p.focus({ preventScroll: true });
          return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement;
        if (!(active instanceof HTMLElement) || !p.contains(active)) {
          e.preventDefault();
          first.focus({ preventScroll: true });
        } else if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus({ preventScroll: true });
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus({ preventScroll: true });
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKeyDown);
      const i = dialogStack.indexOf(id);
      if (i >= 0) dialogStack.splice(i, 1);
      restoreRef.current?.focus?.({ preventScroll: true });
    };
  }, [open, label]);

  return panelRef;
}