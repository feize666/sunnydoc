/** 复制文本到剪贴板：clipboard API 优先，execCommand 兜底（兼容 http 非安全上下文）。
 *  返回是否成功，调用方据此做提示。 */
export async function copyText(text: string): Promise<boolean> {
  // 方案一：Clipboard API（需安全上下文：https / localhost）
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fallthrough */
  }

  // 方案二：execCommand（兼容 http 环境，需用户手势）
  try {
    if (typeof document === "undefined") return false;
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
