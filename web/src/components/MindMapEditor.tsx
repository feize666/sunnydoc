"use client";

import { useState, useRef, useCallback, useMemo } from "react";
import { generateDiagram } from "@/lib/api";

// —— 数据结构：扁平节点 + parent 引用 ——
interface MindNode {
  id: string;
  text: string;
  parent: string | null;
  color?: string;
}

type LayoutMode = "logic" | "org";

const NODE_H = 40;
const GAP = 90; // 父子节点间距
const V_GAP = 14; // 兄弟节点间距

function genId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function parseMind(value: string): MindNode[] {
  try {
    const p = JSON.parse(value);
    if (p && Array.isArray(p.nodes)) return p.nodes as MindNode[];
  } catch {
    /* fallthrough */
  }
  return [];
}

function estimateWidth(text: string): number {
  let w = 0;
  for (const ch of text) {
    w += /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch) ? 14 : 8;
  }
  return Math.max(48, Math.min(240, w + 32));
}

interface LayoutItem {
  x: number;
  y: number;
  w: number;
  h: number;
}

// 树形布局（logic 从左到右 / org 从上到下）
function layout(nodes: MindNode[], mode: LayoutMode): Record<string, LayoutItem> {
  const map: Record<string, MindNode> = {};
  const kids: Record<string, string[]> = {};
  for (const n of nodes) {
    map[n.id] = n;
    kids[n.id] = kids[n.id] || [];
  }
  for (const n of nodes) {
    if (n.parent && map[n.parent]) (kids[n.parent] = kids[n.parent] || []).push(n.id);
  }
  const roots = nodes.filter((n) => !n.parent || !map[n.parent]).map((n) => n.id);

  const pos: Record<string, LayoutItem> = {};
  const widthOf = (id: string) => estimateWidth(map[id]?.text || "");

  const spanOf = (id: string): number => {
    const ks = kids[id] || [];
    if (ks.length === 0) return (mode === "logic" ? NODE_H + V_GAP : widthOf(id) + V_GAP);
    let total = 0;
    for (const k of ks) total += spanOf(k);
    return total;
  };

  if (mode === "logic") {
    const place = (id: string, x: number, yTop: number): void => {
      const w = widthOf(id);
      const ks = kids[id] || [];
      if (ks.length === 0) {
        pos[id] = { x, y: yTop, w, h: NODE_H };
        return;
      }
      let cursor = yTop;
      const centers: number[] = [];
      for (const k of ks) {
        place(k, x + w + GAP, cursor);
        centers.push(pos[k].y + NODE_H / 2);
        cursor += spanOf(k);
      }
      pos[id] = { x, y: (centers[0] + centers[centers.length - 1]) / 2 - NODE_H / 2, w, h: NODE_H };
    };
    let cursor = 0;
    for (const r of roots) {
      place(r, 0, cursor);
      cursor += spanOf(r);
    }
  } else {
    const place = (id: string, xLeft: number, y: number): void => {
      const w = widthOf(id);
      const ks = kids[id] || [];
      if (ks.length === 0) {
        pos[id] = { x: xLeft, y, w, h: NODE_H };
        return;
      }
      let cursor = xLeft;
      const centers: number[] = [];
      for (const k of ks) {
        place(k, cursor, y + NODE_H + GAP);
        centers.push(pos[k].x + pos[k].w / 2);
        cursor += spanOf(k);
      }
      pos[id] = { x: (centers[0] + centers[centers.length - 1]) / 2 - w / 2, y, w, h: NODE_H };
    };
    let cursor = 0;
    for (const r of roots) {
      place(r, cursor, 0);
      cursor += spanOf(r);
    }
  }
  return pos;
}

function bounds(nodes: MindNode[], pos: Record<string, LayoutItem>) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const n of nodes) {
    const p = pos[n.id];
    if (!p) continue;
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + p.w);
    maxY = Math.max(maxY, p.y + p.h);
  }
  if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  return { minX, minY, maxX, maxY };
}

const PALETTE = ["#2f6bff", "#16a34a", "#f97316", "#a855f7", "#0ea5e9", "#ec4899", "#dc2626", "#78716c"];

export function MindMapEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (json: string) => void;
}) {
  const [nodes, setNodes] = useState<MindNode[]>(() => {
    const p = parseMind(value);
    return p.length ? p : [{ id: genId(), text: "中心主题", parent: null }];
  });
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("logic");
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [view, setView] = useState<{ x: number; y: number; k: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; vx: number; vy: number } | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiText, setAiText] = useState("");
  const [aiBusy, setAiBusy] = useState(false);

  const pos = useMemo(() => layout(nodes, layoutMode), [nodes, layoutMode]);
  const bb = useMemo(() => bounds(nodes, pos), [nodes, pos]);

  const commit = useCallback(
    (next: MindNode[]) => {
      setNodes(next);
      onChange(JSON.stringify({ nodes: next }));
    },
    [onChange],
  );

  const mapNode = (id: string) => nodes.find((n) => n.id === id);

  const v = view ?? (() => {
    const k = Math.min(1, 760 / Math.max(bb.maxX - bb.minX + 160, 400));
    return { x: 40 - bb.minX * k, y: 40 - bb.minY * k, k };
  })();

  const startEdit = (id: string, text: string) => {
    setEditing(id);
    setEditText(text);
  };

  const finishEdit = () => {
    if (editing) {
      const t = editText.trim();
      commit(nodes.map((n) => (n.id === editing ? { ...n, text: t || n.text } : n)));
    }
    setEditing(null);
  };

  const addChild = (id: string) => {
    const child: MindNode = { id: genId(), text: "子主题", parent: id, color: mapNode(id)?.color };
    commit([...nodes, child]);
    setSelected(child.id);
    startEdit(child.id, "子主题");
  };

  const addSibling = (id: string) => {
    const node = mapNode(id);
    if (!node) return;
    if (!node.parent) return addChild(id);
    const sib: MindNode = { id: genId(), text: "子主题", parent: node.parent, color: node.color };
    commit([...nodes, sib]);
    setSelected(sib.id);
    startEdit(sib.id, "子主题");
  };

  const insertParent = (id: string) => {
    const node = mapNode(id);
    if (!node) return;
    const parent: MindNode = { id: genId(), text: "父主题", parent: node.parent, color: node.color };
    commit([...nodes.map((n) => (n.id === id ? { ...n, parent: parent.id } : n)), parent]);
    setSelected(parent.id);
    startEdit(parent.id, "父主题");
  };

  const removeNode = (id: string) => {
    const doomed = new Set<string>([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const n of nodes) {
        if (n.parent && doomed.has(n.parent) && !doomed.has(n.id)) {
          doomed.add(n.id);
          changed = true;
        }
      }
    }
    if (doomed.size === nodes.length) {
      commit([{ id: genId(), text: "中心主题", parent: null }]);
      setSelected(null);
      return;
    }
    commit(nodes.filter((n) => !doomed.has(n.id)));
    setSelected(null);
  };

  const setNodeColor = (color: string) => {
    if (!selected) return;
    commit(nodes.map((n) => (n.id === selected ? { ...n, color: color || undefined } : n)));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editing) {
      if (e.key === "Enter") {
        e.preventDefault();
        finishEdit();
      } else if (e.key === "Escape") {
        setEditing(null);
      }
      return;
    }
    if (!selected) return;
    if (e.key === "Tab") {
      e.preventDefault();
      addChild(selected);
    } else if (e.key === "Enter") {
      e.preventDefault();
      addSibling(selected);
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      removeNode(selected);
    } else if (e.key === "F2") {
      e.preventDefault();
      const n = mapNode(selected);
      if (n) startEdit(n.id, n.text);
    }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest(".mind-node")) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, vx: v.x, vy: v.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    setView({
      ...v,
      x: dragRef.current.vx + (e.clientX - dragRef.current.startX),
      y: dragRef.current.vy + (e.clientY - dragRef.current.startY),
    });
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };
  const onWheel = (e: React.WheelEvent) => {
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setView({ ...v, k: Math.max(0.2, Math.min(2.5, v.k * delta)) });
  };

  const runAi = async () => {
    const t = aiText.trim();
    if (!t) return;
    setAiBusy(true);
    try {
      const res = await generateDiagram("mindmap", t);
      const arr: MindNode[] = (res.nodes || []).map((n: any, i: number) => ({
        id: String(n.id ?? `m${i + 1}`),
        text: n.text ?? n.label ?? "主题",
        parent: n.parent ? String(n.parent) : null,
      }));
      if (arr.length === 0) return;
      commit(arr);
      setSelected(null);
      setView(null);
      setAiOpen(false);
      setAiText("");
    } catch (e) {
      alert(`AI 生成失败：${e instanceof Error ? e.message : "未知错误"}`);
    } finally {
      setAiBusy(false);
    }
  };

  const levelColor = (id: string): string => {
    const c = mapNode(id)?.color;
    if (c) return c;
    let depth = 0;
    let cur = id;
    while (mapNode(cur)?.parent) {
      depth++;
      cur = mapNode(cur)!.parent!;
    }
    return PALETTE[depth % PALETTE.length];
  };

  const isRoot = (id: string) => !mapNode(id)?.parent;

  const toolBtn = (active: boolean) =>
    `flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors ${
      active ? "bg-accent-soft text-accent" : "text-text hover:bg-hover"
    } disabled:opacity-40 disabled:cursor-not-allowed`;

  return (
    <div className="flex min-h-[calc(100vh-300px)] flex-col rounded-lg border border-line bg-background">
      {/* 工具栏（参考 ProcessOn 分组） */}
      <div className="flex flex-wrap items-center gap-1 border-b border-line px-2 py-1.5">
        {/* 节点操作 */}
        <button onClick={() => selected && addChild(selected)} disabled={!selected} className={toolBtn(false)} title="添加子主题 (Tab)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
          子主题
        </button>
        <button onClick={() => selected && addSibling(selected)} disabled={!selected} className={toolBtn(false)} title="添加同级主题 (Enter)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 9h16M4 15h16" /></svg>
          同级
        </button>
        <button onClick={() => selected && insertParent(selected)} disabled={!selected} className={toolBtn(false)} title="插入父级主题">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
          父级
        </button>
        <button onClick={() => selected && removeNode(selected)} disabled={!selected} className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] text-danger transition-colors hover:bg-danger-soft disabled:opacity-40 disabled:cursor-not-allowed" title="删除 (Delete)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></svg>
          删除
        </button>

        <span className="mx-1 h-4 w-px bg-line" />

        {/* 节点颜色 */}
        <div className="flex items-center gap-1">
          {PALETTE.map((c) => (
            <button
              key={c}
              onClick={() => setNodeColor(c)}
              className="h-5 w-5 rounded-full border border-black/10 transition-transform hover:scale-110"
              style={{ backgroundColor: c }}
              title="节点颜色"
            />
          ))}
          <button
            onClick={() => setNodeColor("")}
            className="grid h-5 w-5 place-items-center rounded-full border border-line text-faint hover:text-text"
            title="清除颜色"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <span className="mx-1 h-4 w-px bg-line" />

        {/* 布局切换 */}
        <button onClick={() => { setLayoutMode("logic"); setView(null); }} className={toolBtn(layoutMode === "logic")} title="逻辑图（左到右）">
          逻辑图
        </button>
        <button onClick={() => { setLayoutMode("org"); setView(null); }} className={toolBtn(layoutMode === "org")} title="组织结构图（上到下）">
          组织结构图
        </button>

        <span className="mx-auto" />

        <span className="hidden text-[11px] text-faint lg:inline">
          Tab 子主题 · Enter 同级 · Delete 删除 · 双击编辑 · 拖拽平移 · 滚轮缩放
        </span>

        <button onClick={() => setAiOpen(true)} className="rounded-md bg-accent px-2.5 py-1.5 text-[13px] font-medium text-white transition-opacity hover:opacity-90">
          ✨ AI 生成
        </button>
        <button onClick={() => commit([{ id: genId(), text: "中心主题", parent: null }])} className="rounded-md px-2 py-1.5 text-[13px] text-muted transition-colors hover:bg-hover hover:text-text">
          重置
        </button>
      </div>

      {/* AI 生成对话框 */}
      {aiOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setAiOpen(false)}>
          <div className="w-[480px] max-w-[92vw] rounded-xl border border-line bg-background p-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 text-[14px] font-semibold text-text">AI 生成思维导图</div>
            <textarea
              value={aiText}
              onChange={(e) => setAiText(e.target.value)}
              placeholder="输入主题，例如：产品需求文档结构"
              rows={3}
              className="mb-3 w-full resize-none rounded-lg border border-line bg-surface px-3 py-2 text-[13px] text-text outline-none focus:border-accent"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setAiOpen(false)} className="rounded-md px-3 py-1.5 text-[13px] text-muted hover:bg-hover">取消</button>
              <button onClick={runAi} disabled={aiBusy || !aiText.trim()} className="rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-50">
                {aiBusy ? "生成中…" : "生成"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 画布 */}
      <div
        ref={containerRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
        className="cursor-grab overflow-hidden outline-none active:cursor-grabbing"
        style={{ touchAction: "none", height: "60vh", minHeight: 400 }}
      >
        <svg width="100%" height="100%">
          <g transform={`translate(${v.x},${v.y}) scale(${v.k})`}>
            {/* 连线 */}
            {nodes.map((n) => {
              if (!n.parent) return null;
              const p = pos[n.parent];
              const c = pos[n.id];
              if (!p || !c) return null;
              let d = "";
              if (layoutMode === "logic") {
                const sx = p.x + p.w;
                const sy = p.y + NODE_H / 2;
                const ex = c.x;
                const ey = c.y + NODE_H / 2;
                const mx = (sx + ex) / 2;
                d = `M ${sx} ${sy} C ${mx} ${sy}, ${mx} ${ey}, ${ex} ${ey}`;
              } else {
                const sx = p.x + p.w / 2;
                const sy = p.y + NODE_H;
                const ex = c.x + c.w / 2;
                const ey = c.y;
                const my = (sy + ey) / 2;
                d = `M ${sx} ${sy} C ${sx} ${my}, ${ex} ${my}, ${ex} ${ey}`;
              }
              return <path key={`e-${n.id}`} d={d} fill="none" stroke="var(--line-strong)" strokeWidth={1.5} />;
            })}
            {/* 节点 */}
            {nodes.map((n) => {
              const p = pos[n.id];
              if (!p) return null;
              const color = isRoot(n.id) ? "var(--accent)" : levelColor(n.id);
              const sel = selected === n.id;
              return (
                <g
                  key={n.id}
                  className="mind-node"
                  transform={`translate(${p.x},${p.y})`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelected(n.id);
                  }}
                  onDoubleClick={() => startEdit(n.id, n.text)}
                  style={{ cursor: "pointer" }}
                >
                  <rect
                    width={p.w}
                    height={NODE_H}
                    rx={isRoot(n.id) ? 20 : 8}
                    fill={isRoot(n.id) ? color : "var(--background)"}
                    stroke={color}
                    strokeWidth={isRoot(n.id) ? 0 : sel ? 2.5 : 1.5}
                  />
                  {editing === n.id ? (
                    <foreignObject x={0} y={0} width={Math.max(p.w, 120)} height={NODE_H}>
                      <input
                        autoFocus
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        onBlur={finishEdit}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            finishEdit();
                          }
                        }}
                        className="h-full w-full rounded-md border border-accent bg-background px-2 text-[14px] text-text outline-none"
                        style={{ boxSizing: "border-box" }}
                      />
                    </foreignObject>
                  ) : (
                    <text
                      x={p.w / 2}
                      y={NODE_H / 2}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={14}
                      fill={isRoot(n.id) ? "#fff" : "var(--text)"}
                      style={{ userSelect: "none" }}
                    >
                      {n.text.length > 14 ? n.text.slice(0, 14) + "…" : n.text}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
      </div>
    </div>
  );
}
