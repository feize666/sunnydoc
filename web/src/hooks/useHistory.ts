"use client";

import { useCallback, useRef, useState } from "react";

/**
 * 撤销/重做双栈。图表编辑器共用一个实现。
 *
 * 为什么抽出来：流程图与思维导图此前各写了一份**完全同构**的历史引擎
 * （past/future 两个栈 + 100 步截断 + redo 时把当前态压回 past）。
 * 两份实现的截断写法稍有不同，很容易在后续改动中只改一边。
 *
 * 状态形状由调用方决定（两个编辑器的快照不同：一个是 flow，一个是 nodes+links），
 * 因此本 hook 不持有数据，只管理两个栈 —— 读写通过 `read` / `write` 回调注入。
 *
 * 两条实现约束：
 *
 * 1. **updater 内不做副作用。** 原实现把 `setFuture(...)` 与「写回编辑器」都塞进
 *    `setPast` 的 updater 里；React 在 StrictMode 下会重复调用 updater 以暴露不纯写法，
 *    那会让 redo 栈多压一条、写回被执行两次。
 * 2. **栈的读取走 ref，保证判断「能不能撤销」时拿到最新值。** 若改用闭包里的
 *    `past.length`，连续触发（长按 Ctrl+Z）时可能因闭包未更新而重复应用同一步。
 *    ref 只在事件处理里同步更新（不在渲染期写），既能保证新鲜度，也不违反
 *    「渲染期不得读写 ref」的约定。
 *
 * @param read  取当前状态的快照（用于压栈 / 重做前的备份）
 * @param write 把某个历史状态写回编辑器
 * @param limit 栈深上限，超出丢最旧的
 */
export function useHistory<T>(
  read: () => T,
  write: (snapshot: T) => void,
  limit = 100,
) {
  // state 仅供渲染（驱动按钮禁用态）；ref 是事件处理里的权威值
  const [past, setPast] = useState<T[]>([]);
  const [future, setFuture] = useState<T[]>([]);
  const pastRef = useRef<T[]>([]);
  const futureRef = useRef<T[]>([]);

  /** 两个栈的唯一写入口：同步更新 ref（供事件处理读取）与 state（供渲染）。 */
  const settle = useCallback((p: T[], f: T[]) => {
    pastRef.current = p;
    futureRef.current = f;
    setPast(p);
    setFuture(f);
  }, []);

  /** 压入一个**指定**的快照。用于 undo/redo 的记帐，也可直接对外暴露。 */
  const pushSnapshot = useCallback(
    (s: T) => {
      settle([...pastRef.current.slice(-(limit - 1)), s], []);
    },
    [settle, limit],
  );

  /**
   * 在「即将发生一次修改」前调用：把当前态压入 past，并作废 redo 分支。
   *
   * 拖拽这类「一次交互 = 一个历史步」的场景不能用它（起点已在 pointerdown 记下），
   * 那种情况请直接用 `pushSnapshot(起点快照)`。
   */
  const push = useCallback(() => {
    pushSnapshot(read());
  }, [pushSnapshot, read]);

  const undo = useCallback(() => {
    const p = pastRef.current;
    if (p.length === 0) return;
    const prev = p[p.length - 1];
    // 先把当前态备份进 future，再写回上一态
    settle(p.slice(0, -1), [...futureRef.current, read()]);
    write(prev);
  }, [settle, read, write]);

  const redo = useCallback(() => {
    const f = futureRef.current;
    if (f.length === 0) return;
    const next = f[f.length - 1];
    settle([...pastRef.current.slice(-(limit - 1)), read()], f.slice(0, -1));
    write(next);
  }, [settle, read, write, limit]);

  /** 清空历史（如整图替换后，旧历史已无意义）。 */
  const clear = useCallback(() => settle([], []), [settle]);

  return {
    push,
    pushSnapshot,
    undo,
    redo,
    clear,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
  };
}