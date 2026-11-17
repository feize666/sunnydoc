"use client";

import { LogoMark } from "../LogoMark";
import { AI_LOGO_SIZE, type AiLogoSize } from "./aiBrand";

/**
 * AI 助理的品牌标记 —— 三档尺寸的语义化封装。
 *
 * 直接 `size={24}` / `size={28}` / `size={56}` 散落在各处，改起来要全文件搜；
 * 这里把「哪个场合用多大」固化下来，并给出对应的视觉处理。
 *
 * ## 为什么 avatar 档带底色，title 档不带
 *
 * 标题档与文字并排，加底色会和标题抢视觉重量；
 * 消息头像单独出现在气泡左侧，加一层极轻的 `--accent-soft` 底
 * 能让它在白底上「立住」而不需要描边（描边会显得像按钮）。
 *
 * ## hero 档的呼吸动效
 *
 * 只播一次（`animation` 非 `infinite`），且只在空态出现 —— 空态是唯一
 * 允许「表达欢迎」的场合。重复循环会变成干扰。
 * `prefers-reduced-motion` 下完全不播。
 */
export function AiLogo({
  variant = "title",
  className,
}: {
  variant?: AiLogoSize;
  className?: string;
}) {
  const size = AI_LOGO_SIZE[variant];

  if (variant === "title") {
    // 标题旁：无底色，与文字同基线
    return <LogoMark size={size} rounded="rounded-md" className={className} />;
  }

  if (variant === "avatar") {
    return (
      <span
        className={`inline-grid shrink-0 place-items-center rounded-lg bg-accent-soft ${className ?? ""}`}
        style={{ width: size, height: size }}
        data-ai-logo="avatar"
      >
        <LogoMark size={size - 4} rounded="rounded" />
      </span>
    );
  }

  // hero：空态主视觉，唯一的动效场合
  return (
    <span
      className={`ai-logo-hero inline-grid shrink-0 place-items-center rounded-2xl bg-accent-soft ${className ?? ""}`}
      style={{ width: size, height: size }}
      data-ai-logo="hero"
    >
      <LogoMark size={size - 10} rounded="rounded-xl" />
    </span>
  );
}