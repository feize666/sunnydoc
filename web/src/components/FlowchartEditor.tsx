"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  addEdge,
  getNodesBounds,
  getViewportForBounds,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { toPng } from "html-to-image";
import { generateDiagram } from "@/lib/api";

// —— 数据结构 ——
type ShapeKind =
  | "ellipse"
  | "rect"
  | "diamond"
  | "parallelogram"
  | "rounded"
  | "database"
  | "manual"
  | "delay"
  | "preparation";

type EdgeKind = "default" | "straight" | "step" | "smoothstep";

interface FlowData {
  label: string;
  shape: ShapeKind;
  fill?: string;
  stroke?: string;
}

interface StoredNode {
  id: string;
  label: string;
  shape: ShapeKind;
  x: number;
  y: number;
  fill?: string;
  stroke?: string;
}
interface StoredEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}
interface StoredFlow {
  nodes: StoredNode[];
  edges: StoredEdge[];
}

function parseFlow(value: string): StoredFlow {
  try {
    const p = JSON.parse(value);
    if (p && Array.isArray(p.nodes)) {
      return {
        nodes: p.nodes.map((n: any, i: number) => ({
          id: String(n.id ?? `n${i + 1}`),
          label: n.label ?? n.text ?? "节点",
          shape: (n.shape as ShapeKind) || "rect",
          x: Number(n.x ?? n.position?.x ?? 0),
          y: Number(n.y ?? n.position?.y ?? 0),
          fill: n.fill,
          stroke: n.stroke,
        })),
        edges: Array.isArray(p.edges)
          ? p.edges.map((e: any, i: number) => ({
              id: String(e.id ?? `e${i + 1}`),
              source: String(e.source),
              target: String(e.target),
              label: e.label || "",
            }))
          : [],
      };
    }
  } catch {
    /* fallthrough */
  }
  return { nodes: [], edges: [] };
}

const SHAPES: { kind: ShapeKind; label: string; icon: string }[] = [
  { kind: "ellipse", label: "起止", icon: "M8 3 A5 5 0 1 1 8 13 A5 5 0 1 1 8 3" },
  { kind: "rect", label: "处理", icon: "M2 3h12v10H2z" },
  { kind: "diamond", label: "判断", icon: "M8 1 15 8 8 15 1 8Z" },
  { kind: "parallelogram", label: "输入/输出", icon: "M3 3h8l2 10H5Z" },
  { kind: "rounded", label: "文档", icon: "M2 2h12v12H2z" },
  { kind: "database", label: "数据库", icon: "M8 1c3 0 6 1.5 6 3.5S11 8 8 8 2 6.5 2 4.5 5 1 8 1Zm-6 3.5V12c0 2 3 3.5 6 3.5s6-1.5 6-3.5V4.5" },
  { kind: "manual", label: "手动操作", icon: "M2 3h10l2 10H2z" },
  { kind: "delay", label: "延迟", icon: "M6 3h7a3 3 0 0 1 0 10H6Z" },
  { kind: "preparation", label: "准备", icon: "M3 8 8 3l5 5-5 5Z" },
];

const EDGE_KINDS: { kind: EdgeKind; label: string }[] = [
  { kind: "default", label: "曲线" },
  { kind: "straight", label: "直线" },
  { kind: "step", label: "正交" },
  { kind: "smoothstep", label: "圆角正交" },
];

const FILL_COLORS = ["#ffffff", "#fee2e2", "#fef3c7", "#dcfce7", "#dbeafe", "#f3e8ff", "#e0f2fe", "#ffe4e6"];
const STROKE_COLORS = ["#78716c", "#ef4444", "#f97316", "#22c55e", "#3b82f6", "#a855f7", "#0ea5e9", "#ec4899"];

let nodeSeq = 0;
function genId(prefix: string): string {
  nodeSeq += 1;
  return `${prefix}${Date.now().toString(36)}${nodeSeq}`;
}

// —— 自定义形状节点 ——
const NODE_W = 160;
const NODE_H = 64;

function shapePath(shape: ShapeKind, w: number, h: number): string {
  switch (shape) {
    case "ellipse":
      return `M ${w / 2} 0 A ${w / 2} ${h / 2} 0 1 1 ${w / 2 - 0.01} 0 Z`;
    case "diamond":
      return `M ${w / 2} 0 L ${w} ${h / 2} L ${w / 2} ${h} L 0 ${h / 2} Z`;
    case "parallelogram": {
      const s = 20;
      return `M ${s} 0 L ${w} 0 L ${w - s} ${h} L 0 ${h} Z`;
    }
    case "rounded": {
      const r = 16;
      return `M ${r} 0 H ${w - r} Q ${w} 0 ${w} ${r} V ${h - r} Q ${w} ${h} ${w - r} ${h} H ${r} Q 0 ${h} 0 ${h - r} V ${r} Q 0 0 ${r} 0 Z`;
    }
    case "database": {
      const r = h / 4;
      return `M 0 ${r} A ${w / 2} ${r} 0 0 1 ${w} ${r} L ${w} ${h - r} A ${w / 2} ${r} 0 0 1 0 ${h - r} Z`;
    }
    case "manual": {
      const s = 18;
      return `M 0 0 L ${w} 0 L ${w - s} ${h} L 0 ${h} Z`;
    }
    case "delay": {
      const r = h / 2;
      return `M ${r} 0 L ${w - r} 0 A ${r} ${r} 0 0 1 ${w - r} ${h} L ${r} ${h} Z`;
    }
    case "preparation": {
      const s = 22;
      return `M ${s} 0 L ${w - s} 0 L ${w} ${h / 2} L ${w - s} ${h} L ${s} ${h} L 0 ${h / 2} Z`;
    }
    default:
      return `M 0 0 H ${w} V ${h} H 0 Z`;
  }
}

function ShapeNode({ data, selected }: NodeProps) {
  const d = data as unknown as FlowData;
  const w = NODE_W;
  const h = NODE_H;
  const fill = d.fill || (selected ? "var(--accent-soft)" : "var(--background)");
  const stroke = d.stroke || (selected ? "var(--accent)" : "var(--line-strong)");
  return (
    <div style={{ width: w, height: h }} className="relative">
      <svg width={w} height={h} className="overflow-visible">
        <path d={shapePath(d.shape, w, h)} fill={fill} stroke={stroke} strokeWidth={selected ? 2 : 1.5} />
        <text
          x={w / 2}
          y={h / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={13}
          fill="var(--text)"
          style={{ userSelect: "none" }}
        >
          {d.label.length > 11 ? d.label.slice(0, 11) + "…" : d.label}
        </text>
      </svg>
      <Handle type="target" position={Position.Left} style={{ background: "var(--accent)" }} />
      <Handle type="source" position={Position.Right} style={{ background: "var(--accent)" }} />
      <Handle type="source" position={Position.Top} style={{ background: "var(--accent)" }} />
      <Handle type="target" position={Position.Bottom} style={{ background: "var(--accent)" }} />
    </div>
  );
}

const nodeTypes = { shape: ShapeNode };

// AI 生成后按拓扑简单分层布局
function autoLayout(nodes: StoredNode[], edges: StoredEdge[]): void {
  if (nodes.length === 0) return;
  const inDegree: Record<string, number> = {};
  const out: Record<string, string[]> = {};
  for (const n of nodes) {
    inDegree[n.id] = 0;
    out[n.id] = [];
  }
  for (const e of edges) {
    if (out[e.source]) out[e.source].push(e.target);
    if (inDegree[e.target] !== undefined) inDegree[e.target]++;
  }
  const roots = nodes.filter((n) => inDegree[n.id] === 0).map((n) => n.id);
  const order: string[] = [];
  const queue = [...roots];
  const visited = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    order.push(id);
    for (const t of out[id] || []) queue.push(t);
  }
  for (const n of nodes) if (!visited.has(n.id)) order.push(n.id);
  const COLS = 4;
  order.forEach((id, i) => {
    const n = nodes.find((x) => x.id === id);
    if (!n) return;
    n.x = (i % COLS) * (NODE_W + 90);
    n.y = Math.floor(i / COLS) * (NODE_H + 90);
  });
}

const MAX_HISTORY = 100;

export function FlowchartEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (json: string) => void;
}) {
  const initial = useMemo(() => parseFlow(value), []);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(
    initial.nodes.map((n) => ({
      id: n.id,
      type: "shape",
      position: { x: n.x, y: n.y },
      data: { label: n.label, shape: n.shape, fill: n.fill, stroke: n.stroke },
    })),
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(
    initial.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.label || undefined,
    })),
  );
  const [edgeKind, setEdgeKind] = useState<EdgeKind>("default");
  const [mounted, setMounted] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiText, setAiText] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [fillOpen, setFillOpen] = useState(false);
  const [strokeOpen, setStrokeOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  // —— 撤销/重做 ——
  const [past, setPast] = useState<StoredFlow[]>([]);
  const [future, setFuture] = useState<StoredFlow[]>([]);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  nodesRef.current = nodes;
  edgesRef.current = edges;
  const dragStartRef = useRef<StoredFlow | null>(null);
  const clipboardRef = useRef<StoredNode[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  const snapshot = useCallback((): StoredFlow => {
    return {
      nodes: nodesRef.current.map((n) => {
        const d = n.data as unknown as FlowData;
        return { id: n.id, label: d.label, shape: d.shape, x: n.position.x, y: n.position.y, fill: d.fill, stroke: d.stroke };
      }),
      edges: edgesRef.current.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        label: typeof e.label === "string" ? e.label : "",
      })),
    };
  }, []);

  const pushHistory = useCallback(() => {
    const s = snapshot();
    setPast((p) => [...p.slice(-(MAX_HISTORY - 1)), s]);
    setFuture([]);
  }, [snapshot]);

  const applyFlow = useCallback((s: StoredFlow) => {
    setNodes(s.nodes.map((n) => ({ id: n.id, type: "shape", position: { x: n.x, y: n.y }, data: { label: n.label, shape: n.shape, fill: n.fill, stroke: n.stroke } })));
    setEdges(s.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, label: e.label || undefined })));
  }, [setNodes, setEdges]);

  const undo = useCallback(() => {
    setPast((p) => {
      if (p.length === 0) return p;
      const prev = p[p.length - 1];
      setFuture((f) => [...f, snapshot()]);
      applyFlow(prev);
      return p.slice(0, -1);
    });
  }, [snapshot, applyFlow]);

  const redo = useCallback(() => {
    setFuture((f) => {
      if (f.length === 0) return f;
      const next = f[f.length - 1];
      setPast((p) => [...p.slice(-(MAX_HISTORY - 1)), snapshot()]);
      applyFlow(next);
      return f.slice(0, -1);
    });
  }, [snapshot, applyFlow]);

  useEffect(() => setMounted(true), []);

  const defaultEdgeOptions = useMemo(
    () => ({
      type: edgeKind,
      markerEnd: { type: MarkerType.ArrowClosed, color: "var(--line-strong)" },
      style: { stroke: "var(--line-strong)", strokeWidth: 1.5 },
      labelStyle: { fill: "var(--text)", fontSize: 12, fontWeight: 500 },
      labelBgStyle: { fill: "var(--background)", fillOpacity: 0.9 },
      labelBgPadding: [6, 3] as [number, number],
      labelBgBorderRadius: 4,
    }),
    [edgeKind],
  );

  const commit = useCallback(() => {
    const stored: StoredFlow = {
      nodes: nodes.map((n) => {
        const d = n.data as unknown as FlowData;
        return {
          id: n.id,
          label: d.label,
          shape: d.shape,
          x: n.position.x,
          y: n.position.y,
          fill: d.fill,
          stroke: d.stroke,
        };
      }),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        label: typeof e.label === "string" ? e.label : "",
      })),
    };
    onChange(JSON.stringify(stored));
  }, [nodes, edges, onChange]);

  useEffect(() => {
    if (!mounted) return;
    const t = setTimeout(commit, 200);
    return () => clearTimeout(t);
  }, [nodes, edges, mounted, commit]);

  const onConnect = useCallback(
    (c: Connection) => {
      pushHistory();
      setEdges((eds) => addEdge({ ...c, id: genId("e") }, eds));
    },
    [setEdges, pushHistory],
  );

  const addNode = (shape: ShapeKind) => {
    pushHistory();
    const id = genId("n");
    const offset = (nodes.length % 5) * 40;
    setNodes((nds) => [
      ...nds,
      {
        id,
        type: "shape",
        position: { x: 80 + offset, y: 80 + offset },
        data: { label: SHAPES.find((s) => s.kind === shape)?.label || "节点", shape },
      },
    ]);
  };

  const editLabel = (id: string) => {
    const n = nodes.find((x) => x.id === id);
    if (!n) return;
    const cur = (n.data as unknown as FlowData).label;
    const next = window.prompt("节点文字", cur);
    if (next == null) return;
    pushHistory();
    setNodes((nds) => nds.map((x) => (x.id === id ? { ...x, data: { ...x.data, label: next || cur } } : x)));
  };

  const editEdgeLabel = (id: string) => {
    const e = edges.find((x) => x.id === id);
    if (!e) return;
    const cur = typeof e.label === "string" ? e.label : "";
    const next = window.prompt("连线文字", cur);
    if (next == null) return;
    pushHistory();
    setEdges((eds) => eds.map((x) => (x.id === id ? { ...x, label: next } : x)));
  };

  const deleteSelected = () => {
    const sel = nodes.filter((n) => n.selected);
    const selEdges = edges.filter((e) => e.selected);
    if (sel.length === 0 && selEdges.length === 0) return;
    pushHistory();
    const ids = new Set(sel.map((n) => n.id));
    setNodes((nds) => nds.filter((n) => !ids.has(n.id)));
    setEdges((eds) => eds.filter((e) => !ids.has(e.source) && !ids.has(e.target) && !selEdges.includes(e)));
  };

  const clearAll = () => {
    if (nodes.length === 0 && edges.length === 0) return;
    if (!window.confirm("清空整个流程图？")) return;
    pushHistory();
    setNodes([]);
    setEdges([]);
  };

  // —— 复制 / 粘贴 / 全选 ——
  const copySelected = useCallback(() => {
    const sel = nodesRef.current.filter((n) => n.selected);
    if (sel.length === 0) return;
    clipboardRef.current = sel.map((n) => {
      const d = n.data as unknown as FlowData;
      return { id: n.id, label: d.label, shape: d.shape, x: n.position.x, y: n.position.y, fill: d.fill, stroke: d.stroke };
    });
  }, []);

  const pasteClipboard = useCallback(() => {
    const items = clipboardRef.current;
    if (items.length === 0) return;
    pushHistory();
    const idMap: Record<string, string> = {};
    const newNodes: Node[] = items.map((n) => {
      const nid = genId("n");
      idMap[n.id] = nid;
      return { id: nid, type: "shape", position: { x: n.x + 30, y: n.y + 30 }, selected: true, data: { label: n.label, shape: n.shape, fill: n.fill, stroke: n.stroke } };
    });
    // 粘贴后默认选中新节点，取消旧选中
    setNodes((nds) => [...nds.map((n) => ({ ...n, selected: false })), ...newNodes]);
    const newEdges: Edge[] = [];
    for (const e of edgesRef.current) {
      if (idMap[e.source] && idMap[e.target]) {
        newEdges.push({ id: genId("e"), source: idMap[e.source], target: idMap[e.target], label: typeof e.label === "string" ? e.label : undefined });
      }
    }
    setEdges((eds) => [...eds, ...newEdges]);
  }, [pushHistory, setNodes, setEdges]);

  const duplicateSelected = useCallback(() => {
    copySelected();
    pasteClipboard();
  }, [copySelected, pasteClipboard]);

  const selectAll = useCallback(() => {
    setNodes((nds) => nds.map((n) => ({ ...n, selected: true })));
    setEdges((eds) => eds.map((e) => ({ ...e, selected: true })));
  }, [setNodes, setEdges]);

  const selectedNodes = nodes.filter((n) => n.selected);
  const selectedNode = selectedNodes.length === 1 ? selectedNodes[0] : null;
  const selectedEdges = edges.filter((e) => e.selected);
  const selectedEdge = selectedEdges.length === 1 ? selectedEdges[0] : null;
  const curFill = selectedNode ? ((selectedNode.data as unknown as FlowData).fill || "") : "";
  const curStroke = selectedNode ? ((selectedNode.data as unknown as FlowData).stroke || "") : "";

  const setFill = (color: string) => {
    if (!selectedNode) return;
    pushHistory();
    const id = selectedNode.id;
    setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, fill: color || undefined } } : n)));
  };

  const setStroke = (color: string) => {
    if (!selectedNode) return;
    pushHistory();
    const id = selectedNode.id;
    setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, stroke: color || undefined } } : n)));
  };

  // —— 连线样式 ——
  const setEdgeColor = (color: string) => {
    if (!selectedEdge) return;
    pushHistory();
    const id = selectedEdge.id;
    setEdges((eds) =>
      eds.map((e) =>
        e.id === id
          ? { ...e, style: { ...(e.style || {}), stroke: color }, markerEnd: { type: MarkerType.ArrowClosed, color } }
          : e,
      ),
    );
  };

  const setEdgeWidth = (w: number) => {
    if (!selectedEdge) return;
    pushHistory();
    const id = selectedEdge.id;
    setEdges((eds) => eds.map((e) => (e.id === id ? { ...e, style: { ...(e.style || {}), strokeWidth: w } } : e)));
  };

  const toggleEdgeDash = () => {
    if (!selectedEdge) return;
    pushHistory();
    const id = selectedEdge.id;
    const dashed = selectedEdge.style?.strokeDasharray === "6 4";
    setEdges((eds) =>
      eds.map((e) =>
        e.id === id ? { ...e, style: { ...(e.style || {}), strokeDasharray: dashed ? undefined : "6 4" } } : e,
      ),
    );
  };

  // —— 自动布局 ——
  const autoLayoutBtn = () => {
    if (nodes.length === 0) return;
    const sn: StoredNode[] = nodes.map((n) => {
      const d = n.data as unknown as FlowData;
      return { id: n.id, label: d.label, shape: d.shape, x: n.position.x, y: n.position.y, fill: d.fill, stroke: d.stroke };
    });
    const se: StoredEdge[] = edges.map((e) => ({ id: e.id, source: e.source, target: e.target, label: typeof e.label === "string" ? e.label : "" }));
    autoLayout(sn, se);
    pushHistory();
    setNodes(sn.map((n) => ({ id: n.id, type: "shape", position: { x: n.x, y: n.y }, data: { label: n.label, shape: n.shape, fill: n.fill, stroke: n.stroke } })));
  };

  // —— 导出 PNG ——
  const exportPng = async () => {
    const viewportEl = containerRef.current?.querySelector(".react-flow__viewport") as HTMLElement | null;
    if (!viewportEl) return;
    setExporting(true);
    try {
      const bounds = getNodesBounds(nodes);
      const W = 1400;
      const H = Math.max(500, Math.round((bounds.height / Math.max(bounds.width, 1)) * W));
      const viewport = getViewportForBounds(bounds, W, H, 0.5, 2, 0.08);
      const bg = getComputedStyle(document.body).backgroundColor || "#ffffff";
      const dataUrl = await toPng(viewportEl, {
        backgroundColor: bg,
        width: W,
        height: H,
        pixelRatio: 2,
        style: {
          width: `${W}px`,
          height: `${H}px`,
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
        },
      });
      const a = document.createElement("a");
      a.download = "流程图.png";
      a.href = dataUrl;
      a.click();
    } catch (err) {
      alert(`导出失败：${err instanceof Error ? err.message : "未知错误"}`);
    } finally {
      setExporting(false);
    }
  };

  // —— 多选对齐 / 分布 ——
  const alignNodes = (mode: "left" | "centerH" | "right" | "top" | "centerV" | "bottom") => {
    const sel = nodesRef.current.filter((n) => n.selected);
    if (sel.length < 2) return;
    pushHistory();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of sel) {
      minX = Math.min(minX, n.position.x);
      maxX = Math.max(maxX, n.position.x + NODE_W);
      minY = Math.min(minY, n.position.y);
      maxY = Math.max(maxY, n.position.y + NODE_H);
    }
    const ids = new Set(sel.map((n) => n.id));
    setNodes((nds) =>
      nds.map((n) => {
        if (!ids.has(n.id)) return n;
        let x = n.position.x;
        let y = n.position.y;
        if (mode === "left") x = minX;
        else if (mode === "right") x = maxX - NODE_W;
        else if (mode === "centerH") x = (minX + maxX) / 2 - NODE_W / 2;
        else if (mode === "top") y = minY;
        else if (mode === "bottom") y = maxY - NODE_H;
        else if (mode === "centerV") y = (minY + maxY) / 2 - NODE_H / 2;
        return { ...n, position: { x, y } };
      }),
    );
  };

  const distributeNodes = (axis: "h" | "v") => {
    const sel = nodesRef.current.filter((n) => n.selected);
    if (sel.length < 3) return;
    pushHistory();
    const sorted = [...sel].sort((a, b) =>
      axis === "h" ? a.position.x - b.position.x : a.position.y - b.position.y,
    );
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const ids = new Set(sel.map((n) => n.id));
    const total =
      axis === "h"
        ? last.position.x - first.position.x
        : last.position.y - first.position.y;
    const step = total / (sorted.length - 1);
    const idxMap: Record<string, number> = {};
    sorted.forEach((n, i) => (idxMap[n.id] = i));
    setNodes((nds) =>
      nds.map((n) => {
        if (!ids.has(n.id)) return n;
        const i = idxMap[n.id];
        if (axis === "h") return { ...n, position: { x: first.position.x + step * i, y: n.position.y } };
        return { ...n, position: { x: n.position.x, y: first.position.y + step * i } };
      }),
    );
  };

  const runAi = async () => {
    const t = aiText.trim();
    if (!t) return;
    setAiBusy(true);
    try {
      const res = await generateDiagram("flowchart", t);
      const sn: StoredNode[] = (res.nodes || []).map((n: any, i: number) => ({
        id: String(n.id ?? `n${i + 1}`),
        label: n.label ?? n.text ?? "节点",
        shape: (n.shape as ShapeKind) || "rect",
        x: 0,
        y: 0,
      }));
      const se: StoredEdge[] = (res.edges || []).map((e: any, i: number) => ({
        id: String(e.id ?? `e${i + 1}`),
        source: String(e.source),
        target: String(e.target),
        label: e.label || "",
      }));
      autoLayout(sn, se);
      pushHistory();
      setNodes(sn.map((n) => ({ id: n.id, type: "shape", position: { x: n.x, y: n.y }, data: { label: n.label, shape: n.shape } })));
      setEdges(se.map((e) => ({ id: e.id, source: e.source, target: e.target, label: e.label || undefined })));
      setAiOpen(false);
      setAiText("");
    } catch (e) {
      alert(`AI 生成失败：${e instanceof Error ? e.message : "未知错误"}`);
    } finally {
      setAiBusy(false);
    }
  };

  // —— 键盘快捷键 ——
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (mod && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) {
        e.preventDefault();
        redo();
      } else if (mod && e.key.toLowerCase() === "c") {
        copySelected();
      } else if (mod && e.key.toLowerCase() === "v") {
        e.preventDefault();
        pasteClipboard();
      } else if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplicateSelected();
      } else if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        selectAll();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSelected();
      }
    },
    [undo, redo, copySelected, pasteClipboard, duplicateSelected, selectAll, deleteSelected],
  );

  if (!mounted) return <div className="flex-1" />;

  const canUndo = past.length > 0;
  const canRedo = future.length > 0;

  return (
    <div className="flex min-h-[calc(100vh-300px)] flex-col rounded-lg border border-line bg-background">
      {/* 工具栏 */}
      <div className="relative z-20 flex flex-wrap items-center gap-1 border-b border-line px-2 py-1.5">
        <span className="text-[11px] text-faint">形状</span>
        {SHAPES.map((s) => (
          <button
            key={s.kind}
            onClick={() => addNode(s.kind)}
            className="grid h-8 w-8 place-items-center rounded-md text-muted transition-colors hover:bg-hover hover:text-text"
            title={`添加 ${s.label}`}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d={s.icon} />
            </svg>
          </button>
        ))}

        <span className="mx-1 h-4 w-px bg-line" />

        <span className="text-[11px] text-faint">连线</span>
        {EDGE_KINDS.map((k) => (
          <button
            key={k.kind}
            onClick={() => setEdgeKind(k.kind)}
            className={`rounded-md px-2 py-1 text-xs transition-colors ${
              edgeKind === k.kind ? "bg-accent-soft text-accent" : "text-muted hover:bg-hover hover:text-text"
            }`}
          >
            {k.label}
          </button>
        ))}

        {/* 选中连线时：样式编辑 */}
        {selectedEdge && (
          <>
            <span className="mx-1 h-4 w-px bg-line" />
            <span className="text-[11px] text-faint">连线样式</span>
            {STROKE_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setEdgeColor(c)}
                className={`h-5 w-5 rounded-full border border-line transition-transform hover:scale-110 ${
                  (selectedEdge.style?.stroke || "#78716c") === c ? "ring-2 ring-accent ring-offset-1" : ""
                }`}
                style={{ backgroundColor: c }}
                title={`连线颜色 ${c}`}
              />
            ))}
            <span className="mx-1 h-4 w-px bg-line" />
            {[1, 2, 3].map((w) => (
              <button
                key={w}
                onClick={() => setEdgeWidth(w)}
                className={`flex h-6 w-6 items-center justify-center rounded-md border border-line transition-colors hover:bg-hover ${
                  (selectedEdge.style?.strokeWidth || 1.5) === w ? "bg-accent-soft text-accent" : "text-muted"
                }`}
                title={`线宽 ${w}`}
              >
                <span style={{ height: w === 1 ? 1 : w === 2 ? 2 : 3, width: 12, backgroundColor: "currentColor" }} />
              </button>
            ))}
            <button
              onClick={toggleEdgeDash}
              className={`rounded-md px-2 py-1 text-xs transition-colors ${
                selectedEdge.style?.strokeDasharray ? "bg-accent-soft text-accent" : "text-muted hover:bg-hover hover:text-text"
              }`}
              title="虚线"
            >
              虚线
            </button>
          </>
        )}

        {selectedNode && (
          <>
            <span className="mx-1 h-4 w-px bg-line" />
            {/* 填充下拉 */}
            <div className="relative shrink-0">
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setFillOpen((v) => !v);
                  setStrokeOpen(false);
                }}
                className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-text transition-colors hover:bg-hover"
              >
                <span className="h-3.5 w-3.5 rounded-sm border border-line" style={{ backgroundColor: curFill || "transparent" }} />
                填充
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className={`transition-transform ${fillOpen ? "rotate-180" : ""}`}>
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
              {fillOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setFillOpen(false)} />
                  <div className="menu-panel absolute left-0 top-full z-40 mt-1 flex items-center gap-1 p-1.5">
                    {FILL_COLORS.map((c) => (
                      <button
                        key={c}
                        onClick={() => {
                          setFill(c);
                          setFillOpen(false);
                        }}
                        className={`h-6 w-6 rounded border border-line transition-transform hover:scale-110 ${curFill === c ? "ring-2 ring-accent ring-offset-1" : ""}`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                    <button
                      onClick={() => {
                        setFill("");
                        setFillOpen(false);
                      }}
                      className="grid h-6 w-6 place-items-center rounded border border-dashed border-line text-faint hover:text-text"
                      title="无填充"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
                    </button>
                  </div>
                </>
              )}
            </div>
            {/* 边框下拉 */}
            <div className="relative shrink-0">
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setStrokeOpen((v) => !v);
                  setFillOpen(false);
                }}
                className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-text transition-colors hover:bg-hover"
              >
                <span className="h-3.5 w-3.5 rounded-full border border-line" style={{ backgroundColor: curStroke || "transparent" }} />
                边框
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className={`transition-transform ${strokeOpen ? "rotate-180" : ""}`}>
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
              {strokeOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setStrokeOpen(false)} />
                  <div className="menu-panel absolute left-0 top-full z-40 mt-1 flex items-center gap-1 p-1.5">
                    {STROKE_COLORS.map((c) => (
                      <button
                        key={c}
                        onClick={() => {
                          setStroke(c);
                          setStrokeOpen(false);
                        }}
                        className={`h-6 w-6 rounded-full border border-line transition-transform hover:scale-110 ${curStroke === c ? "ring-2 ring-accent ring-offset-1" : ""}`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                    <button
                      onClick={() => {
                        setStroke("");
                        setStrokeOpen(false);
                      }}
                      className="grid h-6 w-6 place-items-center rounded-full border border-dashed border-line text-faint hover:text-text"
                      title="默认边框"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
                    </button>
                  </div>
                </>
              )}
            </div>
          </>
        )}

        {/* 多选对齐/分布 */}
        {selectedNodes.length >= 2 && (
          <>
            <span className="mx-1 h-4 w-px bg-line" />
            <span className="text-[11px] text-faint">对齐</span>
            {(
              [
                ["left", "M3 6h11M3 12h7M3 18h11"],
                ["centerH", "M3 6h11M6 12h5M3 18h11"],
                ["right", "M3 6h11M9 12h5M3 18h11"],
                ["top", "M6 3v11M12 3v7M18 3v11"],
                ["centerV", "M6 3v11M12 6v5M18 3v11"],
                ["bottom", "M6 3v11M12 9v5M18 3v11"],
              ] as [string, string][]
            ).map(([mode, d]) => (
              <button
                key={mode}
                onClick={() => alignNodes(mode as any)}
                className="grid h-7 w-7 place-items-center rounded-md text-muted transition-colors hover:bg-hover hover:text-text"
                title={mode === "left" ? "左对齐" : mode === "centerH" ? "水平居中" : mode === "right" ? "右对齐" : mode === "top" ? "顶对齐" : mode === "centerV" ? "垂直居中" : "底对齐"}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d={d} />
                </svg>
              </button>
            ))}
            <span className="mx-1 h-4 w-px bg-line" />
            <button onClick={() => distributeNodes("h")} className="rounded-md px-2 py-1 text-xs text-muted transition-colors hover:bg-hover hover:text-text" title="水平等距分布">
              水平分布
            </button>
            <button onClick={() => distributeNodes("v")} className="rounded-md px-2 py-1 text-xs text-muted transition-colors hover:bg-hover hover:text-text" title="垂直等距分布">
              垂直分布
            </button>
          </>
        )}

        <span className="mx-1 h-4 w-px bg-line" />
        <button onClick={undo} disabled={!canUndo} className="rounded-md px-2.5 py-1 text-xs text-text transition-colors hover:bg-hover disabled:opacity-40 disabled:cursor-not-allowed" title="撤销 (Ctrl+Z)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-15-6.7L3 13" /></svg>
        </button>
        <button onClick={redo} disabled={!canRedo} className="rounded-md px-2.5 py-1 text-xs text-text transition-colors hover:bg-hover disabled:opacity-40 disabled:cursor-not-allowed" title="重做 (Ctrl+Y)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 7v6h-6" /><path d="M3 17a9 9 0 0 1 15-6.7L21 13" /></svg>
        </button>
        <button onClick={deleteSelected} className="rounded-md px-2.5 py-1 text-xs text-danger transition-colors hover:bg-danger-soft" title="删除选中 (Delete)">
          删除
        </button>
        <button onClick={clearAll} className="rounded-md px-2.5 py-1 text-xs text-muted transition-colors hover:bg-hover hover:text-text">
          清空
        </button>
        <button onClick={autoLayoutBtn} className="rounded-md px-2.5 py-1 text-xs text-text transition-colors hover:bg-hover" title="自动整理布局">
          自动布局
        </button>
        <span className="ml-auto flex items-center gap-1">
          <span className="hidden text-[11px] text-faint lg:inline">双击改文字 · 拖拽连线 · Ctrl+Z 撤销</span>
          <button
            onClick={exportPng}
            disabled={exporting}
            className="rounded-md px-2.5 py-1 text-xs text-text transition-colors hover:bg-hover disabled:opacity-50"
            title="导出 PNG 图片"
          >
            {exporting ? "导出中…" : "导出 PNG"}
          </button>
          <button
            onClick={() => setAiOpen(true)}
            className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white transition-opacity hover:opacity-90"
          >
            ✨ AI 生成
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
            <div className="mb-2 text-[14px] font-semibold text-text">AI 生成流程图</div>
            <textarea
              value={aiText}
              onChange={(e) => setAiText(e.target.value)}
              placeholder="用一句话描述流程，例如：用户提交订单后，系统校验库存，有货则扣减库存并生成订单，无货则提示失败"
              rows={4}
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
      <div ref={containerRef} tabIndex={0} onKeyDown={onKeyDown} className="outline-none" style={{ height: "60vh", minHeight: 400 }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeDoubleClick={(_, node) => editLabel(node.id)}
          onEdgeDoubleClick={(_, edge) => editEdgeLabel(edge.id)}
          onNodeDragStart={() => {
            dragStartRef.current = snapshot();
          }}
          onNodeDragStop={() => {
            if (dragStartRef.current) {
              setPast((p) => [...p.slice(-(MAX_HISTORY - 1)), dragStartRef.current!]);
              setFuture([]);
              dragStartRef.current = null;
            }
          }}
          onPaneClick={() => containerRef.current?.focus()}
          nodeTypes={nodeTypes}
          defaultEdgeOptions={defaultEdgeOptions}
          deleteKeyCode={null}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
          <Controls />
          <MiniMap pannable zoomable className="!bg-background" />
        </ReactFlow>
      </div>
    </div>
  );
}
