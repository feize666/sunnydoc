"use client";

/**
 * 幻灯片的数据模型与模板（**纯函数，零重依赖**）。
 *
 * 🔴 为什么要单独一个模块：`SlideEditor` 是重依赖（html-to-image 等），
 * 已通过 `LazyEditors` 懒加载。但 `page.tsx`（首屏主入口）与 `DocumentEmbed`
 * 都需要「新建时的初始内容」，若直接从 SlideEditor 里 import 模板函数，
 * 整包会被拽进首屏 chunk —— 正是懒加载要避免的事。
 * 所以把数据结构 + 模板生成放在这里，两边都 import 本模块。
 *
 * 坐标系：元素坐标一律用固定逻辑坐标系 1280×720（16:9），渲染时整体缩放。
 * 好处：换窗口 / 嵌卡片 / 放映都不错位，导出尺寸稳定。
 */

export const CANVAS_W = 1280;
export const CANVAS_H = 720;

export type SlideElement =
  | { id: string; type: "text"; x: number; y: number; w: number; text: string; size: number; bold?: boolean; color: string }
  | { id: string; type: "rect"; x: number; y: number; w: number; h: number; fill: string; radius?: number }
  | { id: string; type: "image"; x: number; y: number; w: number; h: number; src: string };

export interface SlidePage {
  id: string;
  elements: SlideElement[];
}

export interface SlideDoc {
  pages: SlidePage[];
}

/** 生成 id。不用 crypto.randomUUID：老 Safari 与 http 环境会缺失。 */
export function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export type TemplateId = "blank" | "cover" | "title-body" | "two-col" | "big-image";

export const TEMPLATES: { id: TemplateId; label: string; desc: string }[] = [
  { id: "blank", label: "空白", desc: "一张空页" },
  { id: "cover", label: "封面", desc: "大标题 + 副标题" },
  { id: "title-body", label: "标题正文", desc: "最常用的一页" },
  { id: "two-col", label: "两栏", desc: "左右并列要点" },
  { id: "big-image", label: "大图", desc: "图片占主视觉" },
];

/**
 * 填充色用**语义名**（`accent-soft` / `surface-2` / `accent-band`），渲染时才解析。
 *
 * 为什么不在数据里存裸色值：裸色值不随主题翻转 —— 浅色下做的稿子切到暗色主题后
 * 就是「深色块 + 深色字」，实测对比度不足、文字等于不可见
 * （图表编辑器踩过同款坑，见 useColorTheme 的注释）。
 */
export const SEMANTIC_FILL: Record<string, (t: "light" | "dark") => string> = {
  "accent-band": (t) => (t === "dark" ? "#1e3a8a" : "#dbeafe"),
  "accent-soft": (t) => (t === "dark" ? "#1f2937" : "#f1f5f9"),
  "surface-2": (t) => (t === "dark" ? "#111827" : "#f8fafc"),
};

export function resolveFill(fill: string, theme: "light" | "dark"): string {
  const f = SEMANTIC_FILL[fill];
  return f ? f(theme) : fill;
}

/** 按模板造一页。 */
export function makePage(tpl: TemplateId): SlidePage {
  const T = (x: number, y: number, w: number, text: string, size: number, bold = false): SlideElement => ({
    id: uid("t"),
    type: "text",
    x,
    y,
    w,
    text,
    size,
    bold,
    color: "inherit",
  });
  const R = (x: number, y: number, w: number, h: number, fill: string, radius = 12): SlideElement => ({
    id: uid("r"),
    type: "rect",
    x,
    y,
    w,
    h,
    fill,
    radius,
  });

  switch (tpl) {
    case "cover":
      return {
        id: uid("p"),
        elements: [
          R(0, 0, CANVAS_W, CANVAS_H, "accent-band", 0),
          T(120, 260, 1040, "演示标题", 76, true),
          T(120, 380, 900, "副标题或演讲者信息", 32),
        ],
      };
    case "title-body":
      return {
        id: uid("p"),
        elements: [T(100, 90, 1080, "页面标题", 52, true), T(100, 220, 1080, "要点一\n要点二\n要点三", 30)],
      };
    case "two-col":
      return {
        id: uid("p"),
        elements: [
          T(100, 90, 1080, "页面标题", 52, true),
          R(100, 220, 500, 380, "accent-soft"),
          T(140, 260, 420, "左栏要点", 30),
          R(680, 220, 500, 380, "surface-2"),
          T(720, 260, 420, "右栏要点", 30),
        ],
      };
    case "big-image":
      return {
        id: uid("p"),
        elements: [T(100, 80, 1080, "页面标题", 44, true), R(100, 180, 1080, 460, "surface-2")],
      };
    case "blank":
    default:
      return { id: uid("p"), elements: [] };
  }
}

/** 解析文档里的幻灯片内容；脏数据/空内容兜底为一页封面（而不是空屏）。 */
export function parseSlideDoc(value: string): SlideDoc {
  try {
    const p = JSON.parse(value);
    if (p && Array.isArray(p.pages) && p.pages.length > 0) {
      // 逐页清洗：缺 id 的老数据补一个（否则拖动/删除会错位）；
      // 非三种已知 type 的元素丢弃，避免解析器被脏数据带崩。
      const pages: SlidePage[] = p.pages.map((pg: Partial<SlidePage>) => ({
        id: pg?.id || uid("p"),
        elements: (Array.isArray(pg?.elements) ? pg.elements : [])
          .filter((e: SlideElement) => e && (e.type === "text" || e.type === "rect" || e.type === "image"))
          .map((e: SlideElement) => ({ ...e, id: e.id || uid(String(e.type).charAt(0)) })),
      }));
      return { pages };
    }
  } catch {
    /* fallthrough */
  }
  return { pages: [makePage("cover")] };
}

/** 新建幻灯片文档时的初始内容（`page.tsx` 与 `DocumentEmbed` 必须一致）。 */
export function newSlideDocBody(): string {
  return JSON.stringify({ pages: [makePage("cover")] });
}