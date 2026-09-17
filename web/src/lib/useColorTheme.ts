"use client";

import { useEffect, useState } from "react";

export type ColorTheme = "light" | "dark";

/**
 * 订阅当前配色主题（读 <html data-theme>，见 app/page.tsx 的主题切换副作用）。
 *
 * 为什么需要它：图表编辑器的节点填充是**存进文档的裸色值**（用户能自选），
 * 不像普通组件那样走 CSS 变量。而 `--text` 会随主题翻转为近白色，
 * 若节点填充仍停在亮色系，暗色下就是「白字压浅底」——实测对比度仅 1.01~1.23，
 * 文字等于不可见。所以编辑器必须知道当前主题，才能为同一份数据
 * 选出在对应底上可读的填充/描边色。
 *
 * 用 MutationObserver 而非把 theme 一路 prop 传下来：编辑器已通过 LazyEditors
 * 惰性加载，透传会牵连 Editor/page 多层签名；而 data-theme 是 DOM 上的单一事实源，
 * 直接观察它改动面最小、也不会与页面状态失同步。
 */
export function useColorTheme(): ColorTheme {
  // 初值取 light：与 :root 默认值一致，SSR/首帧不会闪错
  const [theme, setTheme] = useState<ColorTheme>("light");

  useEffect(() => {
    const el = document.documentElement;
    const read = () => setTheme(el.dataset.theme === "dark" ? "dark" : "light");
    read();
    const observer = new MutationObserver(read);
    observer.observe(el, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  return theme;
}