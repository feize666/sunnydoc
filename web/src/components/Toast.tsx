"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

type ToastType = "success" | "error" | "info" | "warning";

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  warning: (message: string) => void;
}

const ToastContext = createContext<ToastApi>({
  success: () => {},
  error: () => {},
  info: () => {},
  warning: () => {},
});

const TYPE_META: Record<ToastType, { icon: React.ReactNode; bar: string; iconColor: string }> = {
  success: {
    icon: <path d="M20 6L9 17l-5-5" />,
    bar: "var(--success)",
    iconColor: "var(--success)",
  },
  error: {
    icon: <path d="M18 6L6 18M6 6l12 12" />,
    bar: "var(--danger)",
    iconColor: "var(--danger)",
  },
  info: {
    icon: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 16v-4M12 8h.01" />
      </>
    ),
    bar: "var(--accent)",
    iconColor: "var(--accent)",
  },
  warning: {
    icon: (
      <>
        <path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
        <path d="M12 9v4M12 17h.01" />
      </>
    ),
    bar: "var(--warning)",
    iconColor: "var(--warning)",
  },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const push = useCallback((type: ToastType, message: string) => {
    const id = ++idRef.current;
    setToasts((t) => [...t.slice(-4), { id, type, message }]);
    window.setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, 3000);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      success: (m) => push("success", m),
      error: (m) => push("error", m),
      info: (m) => push("info", m),
      warning: (m) => push("warning", m),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* Toast 容器：右上角堆叠，pointer-events 仅卡片本身可交互 */}
      <div className="pointer-events-none fixed right-4 top-16 z-[100] flex flex-col items-end gap-2">
        {toasts.map((t) => {
          const meta = TYPE_META[t.type];
          return (
            <div
              key={t.id}
              className="anim-slide-in-right pointer-events-auto flex items-center gap-2.5 overflow-hidden rounded-lg border border-line bg-background py-2.5 pl-3 pr-4 shadow-lg"
              style={{ minWidth: 200, maxWidth: 360 }}
            >
              <span
                className="grid h-5 w-5 shrink-0 place-items-center rounded-full"
                style={{ backgroundColor: `${meta.bar}1a` }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={meta.iconColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  {meta.icon}
                </svg>
              </span>
              <span className="text-[13px] text-text">{t.message}</span>
              <button
                onClick={() => setToasts((tt) => tt.filter((x) => x.id !== t.id))}
                className="ml-1 shrink-0 text-faint transition-colors hover:text-text"
                title="关闭"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  return useContext(ToastContext);
}
