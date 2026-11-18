"use client";

import { LogoMark } from "../LogoMark";
import { AI_LOGO_SIZE, type AiLogoSize } from "./aiBrand";

/**
 * AI 助理的品牌标记 —— 三档尺寸的语义化封装。
 *
 * 直接 `size={24}` / `size={28}` / `size={56}` 散落在各处，改起来要全文件搜；
 * 这里把「哪个场合用多大」固化下来。
 *
 * ## 🔴 为什么三档都**不加底色**（2026-11-18 实测纠正）
 *
 * 我最初给 avatar / hero 加了 `bg-accent-soft` 底（想让它在白底上"立住"），
 * 实测踩了 `LogoMark` 文件头记录过的同一个坑：
 *
 *     浅色 accent-soft #EAF1FF ← 太阳 #FFD93D 对比度 **1.22**（要求 ≥3.0）
 *     深色 accent-soft #172554 ← 描边 #7C2D12 对比度 **1.57**（会糊掉）
 *
 * 这个 logo 的可辨性**依赖底色是纯白或纯深**：
 *   浅色 → 靠深棕描边 #7C2D12 对白底 9.37 勾轮廓
 *   深色 → 靠黄 #FFD93D 对深底 13.59 勾轮廓
 * 任何中间色底都会同时削弱这两者。所以三档一律透明底。
 *
 * 需要"立住"的场合（消息头像）改用**间距 + 略微缩进**解决，不加底。
 *
 * ## hero 档的呼吸动效
 *
 * 只播一次（`animation` 非 `infinite`），且只在空态出现 —— 空态是唯一
 * 允许「表达欢迎」的场合。重复循环会变成干扰。
 * `prefers-reduced-motion` 下完全不播（见 globals.css）。
 */
export function AiLogo({
  variant = "title",
  className,
}: {
  variant?: AiLogoSize;
  className?: string;
}) {
  const size = AI_LOGO_SIZE[variant];

  // 三档唯一区别是尺寸与圆角档位，底色一律不设
  const rounded = variant === "hero" ? "rounded-xl" : variant === "avatar" ? "rounded-md" : "rounded-md";

  return (
    <span
      className={`inline-grid shrink-0 place-items-center ${className ?? ""}`}
      style={{ width: size, height: size }}
      data-ai-logo={variant}
    >
      <LogoMark size={size} rounded={rounded} />
    </span>
  );
}