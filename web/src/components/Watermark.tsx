"use client";

import { useEffect, useRef } from "react";

/**
 * 分享页平铺水印（P0-2）。
 *
 * **定位：威慑，不是防护。** 水印拦不住任何一次截屏或复制 —— 它的作用是让泄露出去
 * 的截图**可归因**（谁、什么时候看的），从而提高随手外传的心理成本。别把它当防泄漏。
 *
 * 几个刻意的取舍：
 *
 * 1. **访客标识是浏览器级的，不是人级的。** 分享链接本就无需登录（这正是它的用途），
 *    服务端无从知道访客是谁。所以这里用 localStorage 里的稳定随机 id —— 它能在
 *    「同一浏览器多次访问」之间关联，但**不能**跨设备识别同一个人。要人级溯源，
 *    得先让分享需要登录，那是另一个决策。
 *
 * 2. **canvas 固定铺满视口，滚动时"不动"。** 正文滚动而水印静止 —— 这正是「重复
 *    平铺」要达到的效果：局部截图裁不掉它。
 *
 * 3. **颜色取自 `--text` design token**，不写裸色值（§6 强制约定）。canvas 里的颜色
 *    是 `getComputedStyle` 现读的，所以主题切换后重绘即跟随。
 *
 * 4. **`aria-hidden`**：对读屏用户，重复几十遍的水印文本是纯噪声 ——
 *    正文本身已完整可读，水印不承载任何必要信息。
 */

// 水印透明度。**实测调出来的，不是拍脑袋**：
// 亮色 0.10 → 对白底 1.22:1；暗色 0.10 → 对 #0b1120 1.25:1。
// 落在「看得见（≥1.15）但不足以干扰阅读（≤1.35）」的区间 —— 水印不该按正文的
// 4.5:1 要求，那会把文档糊住。改这个值请重新实测两个主题。
const ALPHA = 0.1;
// 平铺步长（px）：够疏，不糊住正文；够密，局部截图裁不掉。
const STEP_X = 260;
const STEP_Y = 160;
const FONT_SIZE = 13;
// 倾斜角：负值 = 向右下倾斜，水印的通用视觉语言。
const ANGLE_DEG = -20;

const VISITOR_KEY = "sunnydoc:visitor-id";

/** 取浏览器级访客标识；不可用（隐私模式禁 localStorage）时退回 anon。 */
function getVisitorId(): string {
  try {
    let v = localStorage.getItem(VISITOR_KEY);
    if (!v) {
      v = Math.random().toString(36).slice(2, 10);
      localStorage.setItem(VISITOR_KEY, v);
    }
    return v;
  } catch {
    return "anon";
  }
}

/** 本地时间，紧凑格式：2026-10-01 14:41 */
function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 把 `--text` 的 hex 值加 alpha 变成 rgba；非 hex 则退回中性灰（不至于整块消失）。 */
function withAlpha(cssColor: string, alpha: number): string {
  const hex = cssColor.trim().replace("#", "");
  const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
  if (full.length !== 6) return `rgba(128, 128, 128, ${alpha})`;
  const n = Number.parseInt(full, 16);
  if (Number.isNaN(n)) return `rgba(128, 128, 128, ${alpha})`;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export function Watermark({ theme }: { theme: "light" | "dark" }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      // 上限 2：再高的 DPR 只是白白增加填充成本，肉眼无差别。
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const rootStyle = getComputedStyle(document.documentElement);
      const color = withAlpha(rootStyle.getPropertyValue("--text") || "#0f172a", ALPHA);
      const family = getComputedStyle(document.body).fontFamily || "sans-serif";

      ctx.font = `${FONT_SIZE}px ${family}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = color;

      const text = `${getVisitorId()} · ${stamp(new Date())}`;
      const angle = (ANGLE_DEG * Math.PI) / 180;

      // 隔行错位半格（砖砌），避免竖列对齐形成明显条纹。
      for (let row = 0, y = STEP_Y / 2; y < h + STEP_Y / 2; row++, y += STEP_Y) {
        const offset = row % 2 === 0 ? 0 : STEP_X / 2;
        for (let x = offset - STEP_X / 2; x < w + STEP_X; x += STEP_X) {
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(angle);
          ctx.fillText(text, 0, 0);
          ctx.restore();
        }
      }
    };

    draw();
    window.addEventListener("resize", draw);
    // 每分钟重绘：让时间戳保持「大致当下」。只在挂载时画一次的话，几分钟后截图上的
    // 时间就成了误导信息；重绘同时增加「裁一块就抹掉水印」的难度。
    const timer = window.setInterval(draw, 60_000);
    return () => {
      window.removeEventListener("resize", draw);
      window.clearInterval(timer);
    };
  }, [theme]);

  return (
    <canvas
      ref={ref}
      data-testid="share-watermark"
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[5] select-none"
    />
  );
}