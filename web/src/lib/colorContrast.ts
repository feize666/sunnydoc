/**
 * 画布类组件的颜色可辨性工具。
 *
 * 为什么需要单独一层：流程图 / 思维导图的节点色是**存进文档的裸色值**（要能随导出带走），
 * 不能用 CSS 变量，因此也不享受设计 token 的对比度校准。它们同时要落在
 * 「亮色主题画布（白底）」与「暗色主题画布（近黑底）」上，而这两个方向要求的
 * 亮度区间**很窄** —— 同时满足非文本 3.0 的合规带只有 L∈[0.117, 0.300]。
 *
 * 与其在色板上写死两套值（要人工保持上百色同步，还覆盖不到用户自选色与运行时生成的
 * 调色板），不如**渲染时**按当前主题校正一次：保住色相，只微调明度，且不写回文档。
 */

/** WCAG 相对亮度（sRGB 线性化，WCAG 2.1 定义） */
export function relLuminance(hex: string): number {
  const c = hex.replace("#", "");
  if (c.length !== 6) return 0;
  const chan = (i: number) => {
    const v = parseInt(c.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * chan(0) + 0.7152 * chan(2) + 0.0722 * chan(4);
}

/** WCAG 对比度（1~21） */
export function contrastRatio(a: string, b: string): number {
  const la = relLuminance(a);
  const lb = relLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** 两个主题各自的画布底色（--background 的取值，见 globals.css） */
export const CANVAS_BG: Record<"light" | "dark", string> = {
  light: "#ffffff",
  dark: "#0b1120",
};

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  let c = (hex || "#000000").replace("#", "");
  if (c.length === 3) c = c.split("").map((x) => x + x).join("");
  if (c.length !== 6) c = "000000";
  const r = parseInt(c.slice(0, 2), 16) / 255;
  const g = parseInt(c.slice(2, 4), 16) / 255;
  const b = parseInt(c.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: s * 100, l: l * 100 };
}

function hslToHex(h: number, s: number, l: number): string {
  const ss = Math.max(0, Math.min(100, s)) / 100;
  const ll = Math.max(0, Math.min(100, l)) / 100;
  const c = (1 - Math.abs(2 * ll - 1)) * ss;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = ll - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * 把画布色校正到「在当前主题的底色上可辨」（非文本 3.0）。
 *
 * - 已达标的颜色**原样返回**（绝大多数色不会被动），保证视觉与设计师原值一致；
 * - 需要调整时**只改明度**，色相与饱和度保持不变 —— 用户认的是「这是绿色那支」，
 *   换色相会让人认不出自己的图；
 * - 纯函数、不写回文档，因此已存文档内容与导出结果不受影响；
 * - 极端色（纯黑 / 纯白）在该底色上本就无法达标时返回原值，不做无意义的改写。
 */
export function readableOnCanvas(
  hex: string,
  theme: "light" | "dark",
  target = 3.0,
): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return hex;
  const bg = CANVAS_BG[theme];
  if (contrastRatio(hex, bg) >= target) return hex;
  const { h, s, l } = hexToHsl(hex);
  const lighter = relLuminance(bg) < 0.5; // 暗底 → 提亮；亮底 → 压深
  for (let i = 1; i <= 200; i++) {
    const nl = l + (lighter ? i * 0.4 : -i * 0.4);
    if (nl < 0 || nl > 100) break;
    const cand = hslToHex(h, s, nl);
    if (contrastRatio(cand, bg) >= target) return cand;
  }
  return hex;
}