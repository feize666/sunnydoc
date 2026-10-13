"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 应用内「层级导航」内核 —— 把视图层级同步到 `location.hash`，并支持浏览器后退。
 *
 * ## 为什么需要它（2026-10-13，阶段 3）
 *
 * 改造前应用只有 4 个顶层视图（`home`/`kb`/`users`/`trash`），而 **28 个对话框**
 * 承载了绝大多数功能 —— 弹窗**进去就到底**，没有下一层：
 * 用户无法「设置 → AI 配置 → 某个自定义供应商」，也无法用后退键逐级返回。
 *
 * 目标：让管理类功能能在 **3~4 级**导航中到达，且**浏览器/手机后退键能逐级回退**。
 *
 * ## 为什么不用 Next.js 路由
 *
 * `next.config.ts` 是 `output: "export"`（静态导出）。引入 App Router 的动态段
 * （`/settings/[tab]/[id]`）需要预生成全部路径或改成非静态导出，
 * 对已上线的部署形态风险太大。这里用 **hash + pushState** 达到同等体验：
 * 地址栏可分享、后退键逐级回退，且**零路由依赖**。
 *
 * ## 层级模型
 *
 * ```
 * #/                        → 首页
 * #/kb                      → 知识库
 * #/settings                → 设置（L2）
 * #/settings/ai             → AI 配置（L3）
 * #/settings/ai/provider/xx → 自定义供应商（L4）
 * #/users/u_123             → 用户详情（L3）
 * ```
 * 即：**路径段数 = 层级数 - 1**（首页为 0 段）。
 *
 * ## 三条行为约定
 *
 * 1. **进入子页 = 压栈**（`pushState`）；同层切换用 `replaceState`
 *    （避免「切 Tab」也产生历史记录，否则后退键要按很多次）。
 * 2. **应用内返回按钮 == 浏览器后退**（都走 `history.back()`）——
 *    保证两条路径语义一致，不会出现「点了返回但后退键还在原地」。
 * 3. **首次加载读取 hash**（可分享链接）；`popstate` 时同步回 React 状态。
 *
 * ⚠️ **不在 hash 里存查询参数/滚动位置**：hash 只表达「在哪一层」，
 * 列表筛选、滚动这类瞬时状态仍留在组件内 —— 否则后退会变得难以预期。
 */

/** 视图层级用一个字符串数组表示，如 `["settings","ai","provider","p_1"]`。 */
export type ViewPath = string[];

const HASH_PREFIX = "#/";

/** 把路径数组编码成 hash 字符串（根路径为空串，而不是 `#/`）。 */
export function encodePath(path: ViewPath): string {
  if (path.length === 0) return "";
  return HASH_PREFIX + path.map(encodeURIComponent).join("/");
}

/** 把 hash 解码成路径数组；非法/空 hash 返回空数组（= 首页）。 */
export function decodeHash(hash: string): ViewPath {
  const h = (hash || "").replace(/^#\/?/, "");
  if (!h) return [];
  return h
    .split("/")
    .filter(Boolean)
    .map((seg) => {
      try {
        return decodeURIComponent(seg);
      } catch {
        // 非法百分号编码（用户手改地址栏）→ 原样返回，不让整个导航崩掉
        return seg;
      }
    });
}

export type UseViewStack = {
  /** 当前层级路径，如 `["settings","ai"]`。 */
  path: ViewPath;
  /** 跳到指定路径。深于当前 → 压栈；同层替换 → replaceState。 */
  go: (next: ViewPath) => void;
  /** 进入下一层：在当前路径后追加一段。 */
  push: (segment: string) => void;
  /** 返回上一级（等价于浏览器后退）。 */
  back: () => void;
  /** 回到某层：截断到指定长度。 */
  upTo: (depth: number) => void;
  /** 是否可返回（在首页时为 false）。 */
  canGoBack: boolean;
};

export function useViewStack(): UseViewStack {
  const [path, setPath] = useState<ViewPath>([]);
  /**
   * 用 ref 记录「我们最后一次写进历史的路径」——
   * popstate 事件只带 hash、不带方向信息，靠它判断这次事件是不是我们自己压的，
   * 避免重复写入历史（造成后退键要按两次）。
   */
  const lastWritten = useRef<string>("");

  // 初始化：读取当前 hash（支持分享链接 / 刷新后停留原处）
  useEffect(() => {
    const initial = decodeHash(window.location.hash);
    if (initial.length > 0) {
      setPath(initial);
      lastWritten.current = encodePath(initial);
    }
  }, []);

  // 监听浏览器/手机后退键
  useEffect(() => {
    const onPop = () => {
      const next = decodeHash(window.location.hash);
      lastWritten.current = encodePath(next);
      setPath(next);
    };
    window.addEventListener("popstate", onPop);
    // 同页 hash 变化（用户手改地址栏）不一定触发 popstate，补一个 hashchange。
    // 两者可能同时触发 → 状态是幂等的（同样的 hash 解出同样的路径），无副作用。
    window.addEventListener("hashchange", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("hashchange", onPop);
    };
  }, []);

  const write = useCallback((next: ViewPath, replace: boolean) => {
    const hash = encodePath(next);
    const cur = encodePath(decodeHash(window.location.hash));
    if (hash === cur) {
      // hash 没变（如重复点当前项）→ 不写历史，只同步状态
      setPath(next);
      lastWritten.current = hash;
      return;
    }
    const url = `${window.location.pathname}${window.location.search}${hash}`;
    if (replace) {
      window.history.replaceState({ sunnydocDepth: next.length }, "", url);
    } else {
      window.history.pushState({ sunnydocDepth: next.length }, "", url);
    }
    lastWritten.current = hash;
    setPath(next);
  }, []);

  const go = useCallback(
    (next: ViewPath) => {
      // 同层切换用 replace（避免「切 Tab 产生历史」），
      // 更深或更浅都用 push（更深=进入子页；更浅=用户主动跳到某层）
      const isSameDepthSwitch = next.length === path.length;
      write(next, isSameDepthSwitch);
    },
    [path.length, write],
  );

  const push = useCallback(
    (segment: string) => {
      const next = [...path, segment];
      write(next, false);
    },
    [path, write],
  );

  const upTo = useCallback(
    (depth: number) => {
      const d = Math.max(0, Math.min(depth, path.length));
      if (d === path.length) return;
      // 回到更浅层级也走 push：这样后退键能回到「深入前」的位置，
      // 符合「后退 = 撤销刚才的导航」的直觉。
      write(path.slice(0, d), false);
    },
    [path, write],
  );

  const back = useCallback(() => {
    // 与浏览器后退语义一致：交给 history，由 popstate 回写状态
    window.history.back();
  }, []);

  return { path, go, push, back, upTo, canGoBack: path.length > 0 };
}