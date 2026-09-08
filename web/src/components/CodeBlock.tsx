"use client";

import type { MouseEvent } from "react";

/**
 * 代码块「复制」按钮的交互逻辑。
 *
 * markdown 渲染结果是通过 `dangerouslySetInnerHTML` 注入的字符串，
 * 复制按钮因此也是字符串里的原生 <button>。这里借助 React 合成事件的
 * 事件委托：把该函数挂到 `.md-body` 容器的 onClick 上，命中
 * `button.codeblock-copy` 时读取相邻 <pre><code> 的文本并写入剪贴板。
 */
export function handleCodeBlockCopy(e: MouseEvent<Element>): void {
  const target = e.target as Element | null;
  const btn = target?.closest?.("button.codeblock-copy");
  if (!btn) return;

  const code =
    btn.closest(".codeblock")?.querySelector("pre code")?.textContent ?? "";

  void copyText(code).then((ok) => {
    if (!ok || !btn) return;
    btn.textContent = "✓ 已复制";
    btn.classList.add("codeblock-copied");
    setTimeout(() => {
      btn.textContent = "复制";
      btn.classList.remove("codeblock-copied");
    }, 2000);
  });
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 剪贴板不可用时静默降级
    return false;
  }
}
