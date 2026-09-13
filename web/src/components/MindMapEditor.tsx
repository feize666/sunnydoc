"use client";

import { useState, useRef, useCallback, useMemo } from "react";
import { generateDiagram } from "@/lib/api";

// —— 数据结构：扁平节点 + parent 引用 ——
interface MindNode {
  id: string;
  text: string;
  parent: string | null;
}

const NODE_H = 40;
const H_GAP = 90; // 父子节点水平间距
const V_GAP = 14; // 兄弟节点垂直间距

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
  x: number; // 节点左上角 x
  y: number; // 节点左上角 y
  w: number;
  h: number;
}

// 从左到右树形布局
function layout(nodes: MindNode[]): Record<string, LayoutItem> {
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

  // 计算子树总高度
  const heightOf = (id: string): number => {
    const ks = kids[id] || [];
    if (ks.length === 0) return NODE_H + V_GAP;
    let total = 0;
    for (const k of ks) total += heightOf(k);
    return total;
  };

  const place = (id: string, x: number, yTop: number): void => {
    const w = widthOf(id);
    const ks = kids[id] || [];
    if (ks.length === 0) {
      pos[id] = { x, y: yTop, w, h: NODE_H };
      return;
    }
    let cursor = yTop;
    const childY: Record<string, number> = {};
    for (const k of ks) {
      const kh = heightOf(k);
      place(k, x + w + H_GAP, cursor);
      childY[k] = pos[k].y + NODE_H / 2;
      cursor += kh;
    }
    const first = childY[ks[0]];
    const last = childY[ks[ks.length - 1]];
    pos[id] = { x, y: (first + last) / 2 - NODE_H / 2, w, h: NODE_H };
  };

  if (roots.length > 0) {
    let cursor = 0;
    for (const r of roots) {
      const rh = heightOf(r);
      place(r, 0, cursor);
      cursor += rh;
    }
  }
  return pos;
}

// 计算所有节点 + 连线的包围盒（用于初始视口居中）
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
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [view, setView] = useState<{ x: number; y: number; k: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; vx: number; vy: number } | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiText, setAiText] = useState("");
  const [aiBusy, setAiBusy] = useState(false);

  const pos = useMemo(() => layout(nodes), [nodes]);
  const bb = useMemo(() => bounds(nodes, pos), [nodes, pos]);

  const commit = useCallback(
    (next: MindNode[]) => {
      setNodes(next);
      onChange(JSON.stringify({ nodes: next }));
    },
    [onChange],
  );

  // 默认视口：居中 + 适配缩放
  const v = view ?? (() => {
    const k = Math.min(1, 760 / Math.max(bb.maxX - bb.minX + 160, 400));
    return { x: 40 - bb.minX * k, y: 40 - bb.minY * k, k };
  })();

  const mapNode = (id: string) => nodes.find((n) => n.id === id);

  const addChild = (id: string) => {
    const child: MindNode = { id: genId(), text: "子主题", parent: id };
    commit([...nodes, child]);
    setSelected(child.id);
    startEdit(child.id, "子主题");
  };

  const addSibling = (id: string) => {
    const node = mapNode(id);
    if (!node) return;
    if (!node.parent) {
      addChild(id);
      return;
    }
    const sib: MindNode = { id: genId(), text: "子主题", parent: node.parent };
    commit([...nodes, sib]);
    setSelected(sib.id);
    startEdit(sib.id, "子主题");
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
      // 不能全删：重置为中心主题
      commit([{ id: genId(), text: "中心主题", parent: null }]);
      setSelected(null);
      return;
    }
    commit(nodes.filter((n) => !doomed.has(n.id)));
    setSelected(null);
  };

  const startEdit = (id: string, text: string) => {
    setEditing(id);
    setEditText(text);
  };

  const finishEdit = () => {
    if (editing) {
      const t = editText.trim();
      commit(
        nodes.map((n) => (n.id === editing ? { ...n, text: t || n.text } : n)),
      );
    }
    setEditing(null);
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

  // 画布平移（拖拽空白处）
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
    const k = Math.max(0.2, Math.min(2.5, v.k * delta));
    setView({ ...v, k });
  };

  const levelColor = (id: string): string => {
    let depth = 0;
    let cur = id;
    while (mapNode(cur)?.parent) {
      depth++;
      cur = mapNode(cur)!.parent!;
    }
    const palette = ["#2f6bff", "#16a34a", "#f97316", "#a855f7", "#0ea5e9", "#dc2626"];
    return palette[depth % palette.length];
  };

  const isRoot = (id: string) => !mapNode(id)?.parent;

  return (
    <div className="flex min-h-[calc(100vh-300px)] flex-col rounded-lg border border-line bg-background">
      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-1 border-b border-line px-2 py-1.5">
        <button
          onClick={() => selected && addChild(selected)}
          disabled={!selected}
          className="rounded-md px-2.5 py-1 text-xs text-text transition-colors hover:bg-hover disabled:opacity-40"
        >
          + 子主题
        </button>
        <button
          onClick={() => selected && addSibling(selected)}
          disabled={!selected}
          className="rounded-md px-2.5 py-1 text-xs text-text transition-colors hover:bg-hover disabled:opacity-40"
        >
          + 兄弟主题
        </button>
        <button
          onClick={() => selected && removeNode(selected)}
          disabled={!selected}
          className="rounded-md px-2.5 py-1 text-xs text-danger transition-colors hover:bg-danger-soft disabled:opacity-40"
        >
          删除
        </button>
        <span className="mx-1 h-4 w-px bg-line" />
        <span className="text-[11px] text-faint">
          双击编辑 · Tab 子主题 · Enter 兄弟 · Delete 删除 · 滚轮缩放 · 拖拽平移
        </span>
        <span className="ml-auto flex items-center gap-1">
          <button
            onClick={() => setAiOpen(true)}
            className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white transition-opacity hover:opacity-90"
          >
            ✨ AI 生成
          </button>
          <button
            onClick={() => commit([{ id: genId(), text: "中心主题", parent: null }])}
            className="rounded-md px-2 py-1 text-xs text-muted transition-colors hover:bg-hover hover:text-text"
          >
            重置
          </button>
        </span>
      </div>

      {/* AI 生成对话框 */}
      {aiOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setAiOpen(false)}>
          <div
            className="w-[480px] max-w-[92vw] rounded-xl border border-line bg-background p-4 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 text-[14px] font-semibold text-text">AI 生成思维导图</div>
            <textarea
              value={aiText}
              onChange={(e) => setAiText(e.target.value)}
              placeholder="输入主题，例如：产品需求文档结构 或 我的知识库整理"
              rows={3}
              className="mb-3 w-full resize-none rounded-lg border border-line bg-surface px-3 py-2 text-[13px] text-text outline-none focus:border-accent"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setAiOpen(false)} className="rounded-md px-3 py-1.5 text-[13px] text-muted hover:bg-hover">
                取消
              </button>
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
        className="flex-1 cursor-grab overflow-hidden outline-none active:cursor-grabbing"
        style={{ touchAction: "none" }}
      >
        <svg width="100%" height="100%">
          <g transform={`translate(${v.x},${v.y}) scale(${v.k})`}>
            {/* 连线（先画，节点在上层） */}
            {nodes.map((n) => {
              if (!n.parent) return null;
              const p = pos[n.parent];
              const c = pos[n.id];
              if (!p || !c) return null;
              const sx = p.x + p.w;
              const sy = p.y + NODE_H / 2;
              const ex = c.x;
              const ey = c.y + NODE_H / 2;
              const mx = (sx + ex) / 2;
              return (
                <path
                  key={`e-${n.id}`}
                  d={`M ${sx} ${sy} C ${mx} ${sy}, ${mx} ${ey}, ${ex} ${ey}`}
                  fill="none"
                  stroke="var(--line-strong)"
                  strokeWidth={1.5}
                />
              );
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
