"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useColorTheme } from "@/lib/useColorTheme";
import { mediaUrl } from "@/lib/markdown";
import { captureNode, canvasBackground, downloadDataUrl, exportFilename } from "@/lib/diagramExport";
import {
  CANVAS_H,
  CANVAS_W,
  TEMPLATES,
  makePage,
  parseSlideDoc,
  resolveFill,
  uid,
  type SlideDoc,
  type SlideElement,
  type SlidePage,
  type TemplateId,
} from "@/lib/slideTemplates";
import { Tooltip } from "./Tooltip";

/**
 * 幻灯片编辑器（P1-1，补齐 `NODE_TYPES` 里唯一未实现的类型）。
 *
 * 设计取舍（照 ROADMAP 的既定方案，**不引重型演示框架**）：
 * - 数据模型 `{ pages: [{ elements: [...] }] }`，落在 `documents.text` 里，无新表；
 *   结构与模板生成在 `@/lib/slideTemplates`（纯函数零重依赖，供 page.tsx 复用）。
 * - 元素只做三种基础图元（文本 / 矩形 / 图片），但改成**可拖动摆位**
 *   —— 演示稿的核心是「摆位置」，画板那种「落笔即定」的自由手绘不适合。
 * - 单页画布 + 左侧缩略图 + 放映模式（全屏、←→ 翻页）。
 * - 导出复用 `@/lib/diagramExport`（与流程图/思维导图同一实现），不另写一套。
 * - 一期**不做**动画、过渡、母版继承、备注页 —— 只保证「能讲清楚」。
 */

/**
 * 画布渲染：**测量层与变换层分离**。
 *
 * 🔴 为什么必须分离：若把 `transform: scale()` 加在被 ResizeObserver 观察的元素上，
 * `getBoundingClientRect()` 会把 transform 算进去 → 缩放改变实测宽度 → 宽度又改变
 * 缩放比例，形成反馈环（实测表现为画面持续抖动/缩到极小）。
 * 所以：外层按 aspect-ratio 定尺寸且不变换；一个 absolute 的**测量层**负责读宽度；
 * 另一个 absolute 的**变换层**承载 scale 与所有子元素。
 */
function SlideCanvas({
  page,
  theme,
  readOnly,
  selectedId,
  onSelect,
  onElementPointerDown,
  stageRef,
  testId,
}: {
  page: SlidePage;
  theme: "light" | "dark";
  readOnly: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onElementPointerDown: (e: React.PointerEvent, el: SlideElement) => void;
  stageRef?: React.RefObject<HTMLDivElement | null>;
  testId: string;
}) {
  const outerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const read = () => {
      const w = el.getBoundingClientRect().width;
      setScale(w > 0 ? w / CANVAS_W : 0);
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
    // 每个实例各自测量自己：放映态与编辑态的画布宽度来源不同（92vw vs 侧栏内宽），
    // 共用一个全局值时切换模式会读到另一边的宽度。
  }, []);

  // 导出用的是外层（未变换、尺寸即最终图尺寸），语义正确
  const setRefs = (node: HTMLDivElement | null) => {
    outerRef.current = node;
    if (stageRef) stageRef.current = node;
  };

  return (
    <div
      ref={setRefs}
      data-testid={testId}
      className="relative w-full overflow-hidden"
      style={{ aspectRatio: `${CANVAS_W} / ${CANVAS_H}`, background: canvasBackground(theme) }}
      onClick={() => onSelect(null)}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          // 缩放未测量出之前先不画，避免首帧以原尺寸闪一下（1280px 会溢出可视区）
          visibility: scale > 0 ? "visible" : "hidden",
        }}
      >
        {page.elements.map((el) => {
          const selected = !readOnly && el.id === selectedId;
          const base: React.CSSProperties = {
            position: "absolute",
            left: el.x,
            top: el.y,
            cursor: readOnly ? "default" : "move",
          };
          const handlers = {
            "data-slide-el": el.type,
            "data-el-id": el.id,
            onPointerDown: (e: React.PointerEvent) => onElementPointerDown(e, el),
            className: selected ? "ring-2 ring-accent" : "",
          };
          if (el.type === "text") {
            return (
              <div
                key={el.id}
                {...handlers}
                style={{
                  ...base,
                  width: el.w,
                  fontFamily: "var(--font-sans)",
                  fontSize: el.size,
                  fontWeight: el.bold ? 600 : 400,
                  lineHeight: 1.3,
                  // `--text` 是项目实际 token（`--color-text` 只作为 Tailwind 映射存在）
                  color: el.color === "inherit" ? "var(--text)" : el.color,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {el.text}
              </div>
            );
          }
          if (el.type === "rect") {
            return (
              <div
                key={el.id}
                {...handlers}
                style={{
                  ...base,
                  width: el.w,
                  height: el.h,
                  borderRadius: el.radius ?? 12,
                  background: resolveFill(el.fill, theme),
                }}
              />
            );
          }
          return (
            <img
              key={el.id}
              {...handlers}
              src={mediaUrl(el.src)}
              alt=""
              draggable={false}
              style={{ ...base, width: el.w, height: el.h, objectFit: "cover", borderRadius: 8 }}
            />
          );
        })}
      </div>
    </div>
  );
}

export function SlideEditor({
  value,
  onChange,
  readOnly = false,
  title,
}: {
  value: string;
  onChange: (json: string) => void;
  readOnly?: boolean;
  title?: string;
}) {
  const theme = useColorTheme();
  const [doc, setDoc] = useState<SlideDoc>(() => parseSlideDoc(value));
  const [cur, setCur] = useState(0);
  const [selId, setSelId] = useState<string | null>(null);
  /** 放映模式：全屏覆盖层 + 键盘翻页 */
  const [presenting, setPresenting] = useState(false);
  const [busy, setBusy] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  /**
   * 拖动状态全用 ref：事件回调里读 state 会拿到**上一次渲染的旧值**，
   * 首帧会被误判成「没在拖动」而丢掉。
   */
  const dragRef = useRef<{
    id: string;
    startX: number;
    startY: number;
    ox: number;
    oy: number;
    scale: number;
  } | null>(null);

  const page = doc.pages[Math.min(cur, doc.pages.length - 1)];

  const commit = useCallback(
    (next: SlideDoc) => {
      setDoc(next);
      onChange(JSON.stringify(next));
    },
    [onChange],
  );

  /** 只改当前页 —— 增删元素/改属性都走这条，避免每处各写一遍 map。 */
  const updatePage = useCallback(
    (fn: (p: SlidePage) => SlidePage) => {
      const pages = doc.pages.map((p, i) => (i === cur ? fn(p) : p));
      commit({ ...doc, pages });
    },
    [doc, cur, commit],
  );

  const patchElement = useCallback(
    (id: string, patch: Partial<SlideElement>) => {
      updatePage((p) => ({
        ...p,
        elements: p.elements.map((e) => (e.id === id ? ({ ...e, ...patch } as SlideElement) : e)),
      }));
    },
    [updatePage],
  );

  // ---------- 元素拖动（window 级监听：移出画布也不断） ----------
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      /**
       * 🔴 位移必须除以缩放比才是**逻辑坐标**位移。
       * 画布被 scale 过，直接拿 clientX 差值当逻辑位移会在窄窗拖不动、
       * 宽窗拖过头（画布 1280 逻辑宽、实际可能只有 800px，比例差 1.6 倍）。
       */
      const nx = d.ox + (e.clientX - d.startX) / d.scale;
      const ny = d.oy + (e.clientY - d.startY) / d.scale;
      // 允许略微出界（贴边摆放常见），但不能整块拖丢
      patchElement(d.id, {
        x: Math.max(-100, Math.min(CANVAS_W - 40, nx)),
        y: Math.max(-60, Math.min(CANVAS_H - 24, ny)),
      } as Partial<SlideElement>);
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [patchElement]);

  const startDrag = (e: React.PointerEvent, el: SlideElement) => {
    if (readOnly) return;
    e.preventDefault();
    e.stopPropagation();
    setSelId(el.id);
    const stage = stageRef.current;
    const scale = stage ? stage.getBoundingClientRect().width / CANVAS_W || 1 : 1;
    dragRef.current = { id: el.id, startX: e.clientX, startY: e.clientY, ox: el.x, oy: el.y, scale };
  };

  // ---------- 放映模式：← → 翻页、Esc 退出、锁背后滚动 ----------
  useEffect(() => {
    if (!presenting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setPresenting(false);
      } else if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") {
        e.preventDefault();
        setCur((c) => Math.min(doc.pages.length - 1, c + 1));
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        setCur((c) => Math.max(0, c - 1));
      }
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [presenting, doc.pages.length]);

  const addPage = (tpl: TemplateId = "blank") => {
    const pages = [...doc.pages, makePage(tpl)];
    commit({ ...doc, pages });
    setCur(pages.length - 1);
    setSelId(null);
  };

  const removePage = (i: number) => {
    if (doc.pages.length <= 1) return;
    const pages = doc.pages.filter((_, k) => k !== i);
    commit({ ...doc, pages });
    setCur(Math.max(0, Math.min(cur > i ? cur - 1 : cur, pages.length - 1)));
    setSelId(null);
  };

  const exportPng = async () => {
    const el = stageRef.current;
    if (!el || busy) return;
    setBusy(true);
    try {
      const dataUrl = await captureNode(el, "png", {
        backgroundColor: canvasBackground(theme),
        width: CANVAS_W,
        height: CANVAS_H,
        pixelRatio: 2,
      });
      const base = exportFilename(title, "幻灯片", "png").replace(/\.png$/, "");
      downloadDataUrl(dataUrl, `${base}-${cur + 1}.png`);
    } finally {
      setBusy(false);
    }
  };

  const selected = useMemo(() => page.elements.find((e) => e.id === selId) ?? null, [page.elements, selId]);

  // ---------- 放映覆盖层 ----------
  if (presenting) {
    return (
      <div
        data-testid="slide-present"
        className="fixed inset-0 z-[70] flex flex-col bg-black"
        onClick={() => setCur((c) => Math.min(doc.pages.length - 1, c + 1))}
      >
        <div className="flex flex-1 items-center justify-center p-6">
          {/* 16:9 且不超出视口高度：min(92vw, 可用高度 × 16/9) */}
          <div style={{ width: "min(92vw, calc((100vh - 150px) * 16 / 9))" }}>
            <SlideCanvas
              page={page}
              theme={theme}
              readOnly
              selectedId={null}
              onSelect={() => {}}
              onElementPointerDown={() => {}}
              testId="slide-present-stage"
            />
          </div>
        </div>
        <div
          className="flex shrink-0 items-center justify-center gap-3 pb-4 text-[13px] text-white/70"
          onClick={(e) => e.stopPropagation()}
        >
          <span data-testid="slide-present-indicator">
            {cur + 1} / {doc.pages.length}
          </span>
          <span className="text-white/40">← → 翻页 · Esc 退出</span>
          <button
            type="button"
            data-testid="slide-present-exit"
            onClick={() => setPresenting(false)}
            className="rounded-md bg-white/10 px-2 py-1 text-white transition-colors hover:bg-white/20"
          >
            退出放映
          </button>
        </div>
      </div>
    );
  }

  // ---------- 只读态（预览 / 嵌入卡片 / 分享页）----------
  if (readOnly) {
    return (
      <div className="flex min-h-[calc(100vh-300px)] flex-col rounded-lg border border-line bg-background">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
          <span className="text-[12px] text-faint" data-testid="slide-readonly-count">
            {cur + 1} / {doc.pages.length} 页
          </span>
          <span className="ml-auto flex items-center gap-1">
            <button
              type="button"
              data-testid="slide-prev"
              onClick={() => setCur((c) => Math.max(0, c - 1))}
              disabled={cur === 0}
              className="rounded-md px-2 py-1 text-xs text-muted transition-colors hover:bg-hover hover:text-text disabled:opacity-40"
            >
              上一页
            </button>
            <button
              type="button"
              data-testid="slide-next"
              onClick={() => setCur((c) => Math.min(doc.pages.length - 1, c + 1))}
              disabled={cur >= doc.pages.length - 1}
              className="rounded-md px-2 py-1 text-xs text-muted transition-colors hover:bg-hover hover:text-text disabled:opacity-40"
            >
              下一页
            </button>
          </span>
        </div>
        <div className="flex-1 p-3">
          <SlideCanvas
            page={page}
            theme={theme}
            readOnly
            selectedId={null}
            onSelect={() => {}}
            onElementPointerDown={() => {}}
            testId="slide-stage"
          />
        </div>
      </div>
    );
  }

  // ---------- 编辑态 ----------
  return (
    <div className="flex min-h-[calc(100vh-300px)] flex-col rounded-lg border border-line bg-background">
      <div className="flex flex-wrap items-center gap-1 border-b border-line px-2 py-1.5">
        <Tooltip content="插入文本框">
          <button
            type="button"
            data-testid="slide-add-text"
            onClick={() =>
              setSelId(
                (() => {
                  const el: SlideElement = {
                    id: uid("t"),
                    type: "text",
                    x: 120,
                    y: 320,
                    w: 600,
                    text: "双击编辑文本",
                    size: 32,
                    color: "inherit",
                  };
                  updatePage((p) => ({ ...p, elements: [...p.elements, el] }));
                  return el.id;
                })(),
              )
            }
            className="rounded-md px-2 py-1 text-xs text-muted transition-colors hover:bg-hover hover:text-text"
          >
            文本
          </button>
        </Tooltip>
        <Tooltip content="插入矩形色块">
          <button
            type="button"
            data-testid="slide-add-rect"
            onClick={() =>
              setSelId(
                (() => {
                  const el: SlideElement = { id: uid("r"), type: "rect", x: 160, y: 240, w: 360, h: 200, fill: "accent-soft" };
                  updatePage((p) => ({ ...p, elements: [...p.elements, el] }));
                  return el.id;
                })(),
              )
            }
            className="rounded-md px-2 py-1 text-xs text-muted transition-colors hover:bg-hover hover:text-text"
          >
            色块
          </button>
        </Tooltip>
        <Tooltip content="插入图片（输入图片地址）">
          <button
            type="button"
            data-testid="slide-add-image"
            onClick={() => {
              const src = window.prompt("图片地址", "");
              if (!src) return;
              const el: SlideElement = { id: uid("i"), type: "image", x: 340, y: 180, w: 600, h: 340, src };
              updatePage((p) => ({ ...p, elements: [...p.elements, el] }));
              setSelId(el.id);
            }}
            className="rounded-md px-2 py-1 text-xs text-muted transition-colors hover:bg-hover hover:text-text"
          >
            图片
          </button>
        </Tooltip>
        <span className="mx-1 h-4 w-px bg-line" />
        <span className="text-[12px] text-faint">加页：</span>
        {TEMPLATES.map((t) => (
          <button
            key={t.id}
            type="button"
            data-testid={`slide-tpl-${t.id}`}
            title={t.desc}
            onClick={() => addPage(t.id)}
            className="rounded-md px-2 py-1 text-xs text-muted transition-colors hover:bg-hover hover:text-text"
          >
            {t.label}
          </button>
        ))}
        <span className="ml-auto flex items-center gap-1">
          <button
            type="button"
            data-testid="slide-present-btn"
            onClick={() => setPresenting(true)}
            className="rounded-md px-2 py-1 text-xs text-muted transition-colors hover:bg-hover hover:text-text"
          >
            放映
          </button>
          <button
            type="button"
            data-testid="slide-export-btn"
            disabled={busy}
            onClick={exportPng}
            className="rounded-md px-2 py-1 text-xs text-muted transition-colors hover:bg-hover hover:text-text disabled:opacity-40"
          >
            {busy ? "导出中…" : "导出 PNG"}
          </button>
        </span>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* 左侧缩略图：只画色块表达版式，不渲染真实文字（省开销、也避免小字糊成一团） */}
        <div data-testid="slide-thumbs" className="w-[168px] shrink-0 overflow-y-auto border-r border-line bg-surface p-2">
          {doc.pages.map((pg, i) => (
            <div key={pg.id} className="group relative mb-2">
              <button
                type="button"
                data-testid="slide-thumb"
                data-index={i}
                data-active={i === cur ? "1" : "0"}
                onClick={() => {
                  setCur(i);
                  setSelId(null);
                }}
                className={`relative block w-full overflow-hidden rounded-md border transition-colors ${
                  i === cur ? "border-accent ring-1 ring-accent" : "border-line hover:border-accent/50"
                }`}
                style={{ aspectRatio: `${CANVAS_W} / ${CANVAS_H}`, background: canvasBackground(theme) }}
              >
                {pg.elements.slice(0, 10).map((el) => (
                  <span
                    key={el.id}
                    style={{
                      position: "absolute",
                      left: `${(el.x / CANVAS_W) * 100}%`,
                      top: `${(el.y / CANVAS_H) * 100}%`,
                      width: `${(el.w / CANVAS_W) * 100}%`,
                      height: el.type === "text" ? 5 : `${(el.h / CANVAS_H) * 100}%`,
                      background:
                        el.type === "rect"
                          ? resolveFill(el.fill, theme)
                          : el.type === "image"
                            ? "var(--line-strong)"
                            : "var(--faint)",
                      borderRadius: 2,
                    }}
                  />
                ))}
              </button>
              <span className="mt-0.5 block text-center text-[11px] text-faint">{i + 1}</span>
              {doc.pages.length > 1 && (
                <button
                  type="button"
                  data-testid="slide-thumb-del"
                  onClick={() => removePage(i)}
                  title="删除本页"
                  className="absolute right-1 top-1 hidden h-5 w-5 place-items-center rounded bg-background/90 text-danger group-hover:grid"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>

        {/* 画布 + 选中属性条 */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex-1 overflow-auto p-4">
            <div className="mx-auto max-w-[1000px] rounded-lg border border-line shadow-sm">
              <SlideCanvas
                page={page}
                theme={theme}
                readOnly={false}
                selectedId={selId}
                onSelect={setSelId}
                onElementPointerDown={startDrag}
                stageRef={stageRef}
                testId="slide-stage"
              />
            </div>
            <p className="mx-auto mt-2 max-w-[1000px] text-[12px] text-faint">
              点元素选中后可拖动摆位；在下方属性条改文字与尺寸。
            </p>
          </div>

          {selected && (
            <div data-testid="slide-inspector" className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line px-3 py-2">
              <span className="text-[12px] text-faint">
                {selected.type === "text" ? "文本" : selected.type === "rect" ? "色块" : "图片"}
              </span>
              {selected.type === "text" && (
                <>
                  <input
                    data-testid="slide-text-input"
                    value={selected.text}
                    onChange={(e) => patchElement(selected.id, { text: e.target.value } as Partial<SlideElement>)}
                    className="input h-8 w-64 text-[13px]"
                    placeholder="文本内容"
                  />
                  <label className="flex items-center gap-1 text-[12px] text-muted">
                    字号
                    <input
                      type="number"
                      data-testid="slide-font-size"
                      value={selected.size}
                      min={12}
                      max={140}
                      onChange={(e) =>
                        patchElement(selected.id, { size: Number(e.target.value) || 32 } as Partial<SlideElement>)
                      }
                      className="input h-8 w-16 text-[13px]"
                    />
                  </label>
                  <label className="flex items-center gap-1 text-[12px] text-muted">
                    <input
                      type="checkbox"
                      data-testid="slide-bold"
                      checked={!!selected.bold}
                      onChange={(e) => patchElement(selected.id, { bold: e.target.checked } as Partial<SlideElement>)}
                    />
                    加粗
                  </label>
                </>
              )}
              {selected.type !== "rect" && (
                <label className="flex items-center gap-1 text-[12px] text-muted">
                  宽度
                  <input
                    type="number"
                    data-testid="slide-el-width"
                    value={Math.round(selected.w)}
                    onChange={(e) =>
                      patchElement(selected.id, { w: Math.max(40, Number(e.target.value) || 200) } as Partial<SlideElement>)
                    }
                    className="input h-8 w-20 text-[13px]"
                  />
                </label>
              )}
              {selected.type !== "text" && (
                <label className="flex items-center gap-1 text-[12px] text-muted">
                  高度
                  <input
                    type="number"
                    data-testid="slide-el-height"
                    value={Math.round(selected.h)}
                    onChange={(e) =>
                      patchElement(selected.id, { h: Math.max(30, Number(e.target.value) || 120) } as Partial<SlideElement>)
                    }
                    className="input h-8 w-20 text-[13px]"
                  />
                </label>
              )}
              <button
                type="button"
                data-testid="slide-el-delete"
                onClick={() => {
                  updatePage((p) => ({ ...p, elements: p.elements.filter((e) => e.id !== selected.id) }));
                  setSelId(null);
                }}
                className="ml-auto rounded-md px-2 py-1 text-xs text-danger transition-colors hover:bg-danger-soft"
              >
                删除元素
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-line px-3 py-1.5 text-[12px] text-faint">
        共 {doc.pages.length} 页 · 第 {cur + 1} 页
      </div>
    </div>
  );
}