"use client";

/**
 * 图表导出的公共实现（流程图 / 思维导图共用）。
 *
 * 为什么单独抽一层：两个编辑器此前各自维护一份 PNG / SVG / PDF 导出三件套，
 * 已经出现**行为漂移**——同样是「另存为 PDF」，流程图给打印文档设了 `@page{margin:12mm}`
 * 而思维导图没有，于是同一功能在两处的页边距不一致；画布底色一个从 `document.body`
 * 现算、一个另有分支。这类复制粘贴出来的差异不会报错，只会让用户在不同文档类型上
 * 得到不一致的结果，所以收敛到一处。
 *
 * 依赖方向：本模块不认识 toast / 组件状态，只做「拿到 dataUrl → 落地成文件」，
 * 提示文案与降级决策由调用方负责（各编辑器的 UX 措辞可能不同）。
 */

import { toPng, toSvg } from "html-to-image";
import { CANVAS_BG } from "./colorContrast";

export type ExportFormat = "png" | "svg";

/** 导出图片的画布底色：与当前主题一致，避免透明背景在外部查看器里变黑/变白 */
export function canvasBackground(theme: "light" | "dark"): string {
  return CANVAS_BG[theme];
}

/** 触发一次浏览器下载。dataUrl 可直接是 html-to-image 的产物。 */
export function downloadDataUrl(dataUrl: string, filename: string): void {
  const a = document.createElement("a");
  a.download = filename;
  a.href = dataUrl;
  a.click();
}

export interface CaptureOptions {
  /** 画布底色（见 canvasBackground） */
  backgroundColor: string;
  /** 仅流程图需要：导出前把视口变换固定成整图可见 */
  width?: number;
  height?: number;
  style?: Partial<CSSStyleDeclaration>;
  pixelRatio?: number;
}

/** 把 DOM 节点截成 PNG / SVG 的 dataUrl。 */
export function captureNode(
  el: HTMLElement,
  format: ExportFormat,
  opts: CaptureOptions,
): Promise<string> {
  const base = {
    backgroundColor: opts.backgroundColor,
    width: opts.width,
    height: opts.height,
    style: opts.style,
  };
  if (format === "png") return toPng(el, { ...base, pixelRatio: opts.pixelRatio ?? 2 });
  return toSvg(el, base);
}

export type PrintResult = "printed" | "popup-blocked" | "write-failed";

/**
 * 借助浏览器打印窗口把图片「另存为 PDF」——不引入 PDF 库。
 *
 * 返回状态而不是直接弹提示，让调用方决定降级文案（弹出被拦截时通常降级下载 PNG）。
 *
 * 打印文档里两处样式是必需的，不是装饰：
 * - `@page{margin:12mm}` 给纸张留边，否则整图贴边、多数打印机还会裁掉外圈；
 * - `print-color-adjust:exact` 保留底色，否则浏览器默认不打印背景色，
 *   深色主题的图会被打成白底黑框（浅色主题下则看不出差别，因此容易漏测）。
 */
export function printImageAsPdf(dataUrl: string, title: string): PrintResult {
  const w = window.open("", "_blank");
  if (!w) return "popup-blocked";
  try {
    w.document.write(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>` +
        `<style>@page{margin:12mm;}` +
        `html,body{margin:0;padding:0;}` +
        `img{display:block;width:100%;height:auto;` +
        `-webkit-print-color-adjust:exact;print-color-adjust:exact;}` +
        `</style></head><body><img src="${dataUrl}" onload="window.print()" /></body></html>`,
    );
    w.document.close();
    return "printed";
  } catch {
    try {
      w.close();
    } catch {
      /* 关不掉就算了，不影响主流程 */
    }
    return "write-failed";
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/**
 * 导出文件名：优先用文档标题，缺失或全是非法字符时回退到默认名。
 *
 * 为什么不让调用方直接拼：标题可能含 `/`、`\`、`:` 等路径分隔符，
 * 直接塞进 download 属性会被浏览器静默截断或拒写；同名导出还会相互覆盖。
 */
export function exportFilename(
  title: string | undefined,
  fallback: string,
  ext: ExportFormat | "pdf",
): string {
  const cleaned = (title ?? "")
    // 去掉路径分隔符与控制字符，压缩空白
    .replace(/[/\\:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return `${cleaned || fallback}.${ext}`;
}