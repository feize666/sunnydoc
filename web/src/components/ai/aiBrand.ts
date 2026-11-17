/**
 * AI 助手的品牌常量 —— 单一来源。
 *
 * ## 为什么单独一个文件
 *
 * 改名前「AI 问答」（面板标题）与「Sunny 助手」（消息行）两个叫法并存，
 * 用户看到的是同一个东西两个名字。集中到这里后，改名只需改一处。
 *
 * ## 尺寸规格（2026-11-17 定稿）
 *
 * Logo 分三档，各档职责不同，不要随手加第四档：
 *   - `title`  24px  面板标题旁，承担「这是谁」的识别
 *   - `avatar` 28px  每条 AI 消息的头像，比标题略大以保证在气泡旁不被压住
 *   - `hero`   56px  空态主视觉，唯一的「大图」场合
 *
 * ⚠️ `LogoMark` 的太阳几何是脚本生成的（`docs/brand/sunny_geom.py`），
 *    **不要改几何**。这里只调尺寸与容器。
 */

export const AI_NAME = "AI 助理";

/** 一句话定位，出现在空态与标题 tooltip。 */
export const AI_TAGLINE = "基于你的知识库回答，也能直接帮你改文档";

/** Logo 三档尺寸。 */
export const AI_LOGO_SIZE = {
  title: 24,
  avatar: 28,
  hero: 56,
} as const;

export type AiLogoSize = keyof typeof AI_LOGO_SIZE;