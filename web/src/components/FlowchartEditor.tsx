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
  type EdgeMarker,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { toPng, toSvg } from "html-to-image";
import { generateDiagram } from "@/lib/api";
import { DiagramTemplateDialog } from "./DiagramTemplateDialog";

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
  | "preparation"
  | "internalStorage"
  | "display"
  | "terminator"
  | "predefined"
  | "merge"
  | "hexagon"
  | "card"
  | "container"
  | "group"
  | "lane"
  | "note";

type EdgeKind = "default" | "straight" | "step" | "smoothstep";

type TextAlign = "left" | "center" | "right";
// 连线箭头：无 / 实心 / 空心 / 菱形
type ArrowType = "none" | "solid" | "hollow" | "diamond";

interface FlowData {
  label: string;
  shape: ShapeKind;
  fill?: string;
  stroke?: string;
  width?: number;
  height?: number;
  fontSize?: number;
  bold?: boolean;
  textAlign?: TextAlign;
}

// 连线的箭头记录（序列化用），存于 edge.data
interface EdgeArrowData {
  arrowStart?: ArrowType;
  arrowEnd?: ArrowType;
  [key: string]: unknown;
}

interface StoredNode {
  id: string;
  label: string;
  shape: ShapeKind;
  x: number;
  y: number;
  fill?: string;
  stroke?: string;
  width?: number;
  height?: number;
  fontSize?: number;
  bold?: boolean;
  textAlign?: TextAlign;
  parentId?: string;
}
interface StoredEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  markerStart?: ArrowType;
  markerEnd?: ArrowType;
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
          width: typeof n.width === "number" ? n.width : undefined,
          height: typeof n.height === "number" ? n.height : undefined,
          fontSize: typeof n.fontSize === "number" ? n.fontSize : undefined,
          bold: typeof n.bold === "boolean" ? n.bold : undefined,
          textAlign: (n.textAlign as TextAlign) || undefined,
          parentId: typeof n.parentId === "string" ? n.parentId : undefined,
        })),
        edges: Array.isArray(p.edges)
          ? p.edges.map((e: any, i: number) => ({
              id: String(e.id ?? `e${i + 1}`),
              source: String(e.source),
              target: String(e.target),
              label: e.label || "",
              // 旧数据无 marker 字段：终点默认实心箭头，起点无箭头（与历史默认一致）
              markerStart: (e.markerStart as ArrowType) || undefined,
              markerEnd: (e.markerEnd as ArrowType) || undefined,
            }))
          : [],
      };
    }
  } catch {
    /* fallthrough */
  }
  return { nodes: [], edges: [] };
}

// 形状库（分类组织）。容器类/备注类默认尺寸更大，由 addNode 处理。
const SHAPE_GROUPS: { cat: string; items: { kind: ShapeKind; label: string; icon: string }[] }[] = [
  {
    cat: "流程类",
    items: [
      { kind: "ellipse", label: "起止", icon: "M8 3 A5 5 0 1 1 8 13 A5 5 0 1 1 8 3" },
      { kind: "rect", label: "处理", icon: "M2 4h12v8H2z" },
      { kind: "diamond", label: "判断", icon: "M8 1 15 8 8 15 1 8Z" },
      { kind: "rounded", label: "文档", icon: "M2 3h12v10H2z" },
      { kind: "parallelogram", label: "输入/输出", icon: "M3 4h8l2 8H5Z" },
      { kind: "manual", label: "手动操作", icon: "M2 4h10l2 8H2z" },
      { kind: "preparation", label: "准备", icon: "M3 8 8 3l5 5-5 5Z" },
      { kind: "delay", label: "延迟", icon: "M6 4h7a3 3 0 0 1 0 8H6Z" },
      { kind: "database", label: "数据存储", icon: "M8 1c3 0 6 1.5 6 3.5S11 8 8 8 2 6.5 2 4.5 5 1 8 1Zm-6 3.5V12c0 2 3 3.5 6 3.5s6-1.5 6-3.5V4.5" },
      { kind: "internalStorage", label: "内部存储", icon: "M2 4h12v8H2z M6 4v8" },
      { kind: "display", label: "显示", icon: "M2 4h12v6H2z M2 10 Q8 14 14 10" },
      { kind: "terminator", label: "终止", icon: "M5 5h6a3 3 0 0 1 0 6H5a3 3 0 0 1 0-6Z" },
      { kind: "predefined", label: "预定义处理", icon: "M2 4h12v8H2z M5 4v8 M11 4v8" },
      { kind: "merge", label: "合并", icon: "M2 4h12L10 12H6Z" },
      { kind: "hexagon", label: "六边形", icon: "M5 2h6l3 6-3 6H5L2 8Z" },
      { kind: "card", label: "卡片", icon: "M2 3h12v9H2z M9 12l3-3h-3Z" },
    ],
  },
  {
    cat: "容器类",
    items: [
      { kind: "container", label: "容器框", icon: "M3 3h10v10H3z" },
      { kind: "group", label: "分组框", icon: "M4 3h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z M2 5h4v1.5H2z" },
      { kind: "lane", label: "泳道", icon: "M2 3h12v10H2z M4 3v10" },
    ],
  },
  {
    cat: "备注类",
    items: [
      { kind: "note", label: "注释", icon: "M2 3h9l3 3v7H2z M11 3v3h3" },
    ],
  },
];

// 扁平列表：用于按 kind 查名称
const ALL_SHAPES = SHAPE_GROUPS.flatMap((g) => g.items);
const SHAPE_LABEL: Record<string, string> = Object.fromEntries(ALL_SHAPES.map((s) => [s.kind, s.label]));

// 容器类默认尺寸（更大）
const CONTAINER_SHAPES: ShapeKind[] = ["container", "group"];

const EDGE_KINDS: { kind: EdgeKind; label: string }[] = [
  { kind: "default", label: "曲线" },
  { kind: "straight", label: "直线" },
  { kind: "step", label: "正交" },
  { kind: "smoothstep", label: "圆角正交" },
];

// 快捷键提示面板内容（分组展示）
const SHORTCUTS: { group: string; items: { key: string; desc: string }[] }[] = [
  {
    group: "编辑",
    items: [
      { key: "Ctrl+Z", desc: "撤销" },
      { key: "Ctrl+Y", desc: "重做" },
      { key: "Ctrl+C", desc: "复制" },
      { key: "Ctrl+V", desc: "粘贴" },
      { key: "Ctrl+D", desc: "复制并粘贴" },
      { key: "Ctrl+A", desc: "全选" },
      { key: "Delete", desc: "删除选中" },
    ],
  },
  {
    group: "操作",
    items: [
      { key: "双击节点/连线", desc: "改文字" },
      { key: "拖拽连线", desc: "创建连接" },
    ],
  },
  {
    group: "视图",
    items: [{ key: "滚轮", desc: "缩放画布" }],
  },
];

// 右键菜单项样式（复用 menu-panel 面板）
const CTX_ITEM = "flex w-full items-center rounded-md px-3 py-1.5 text-left text-xs text-text transition-colors hover:bg-hover";
const CTX_ITEM_DANGER = "flex w-full items-center rounded-md px-3 py-1.5 text-left text-xs text-danger transition-colors hover:bg-danger-soft";
const CTX_SEP = "my-1 h-px bg-line";

const FILL_COLORS = ["#ffffff", "#fee2e2", "#fef3c7", "#dcfce7", "#dbeafe", "#f3e8ff", "#e0f2fe", "#ffe4e6"];
const STROKE_COLORS = ["#78716c", "#ef4444", "#f97316", "#22c55e", "#3b82f6", "#a855f7", "#0ea5e9", "#ec4899"];

// —— 整图主题（一键换色，全部用十六进制，不使用 CSS 变量）——
const THEMES: { name: string; nodeFill: string; nodeStroke: string; edgeColor: string }[] = [
  { name: "默认蓝", nodeFill: "#dbeafe", nodeStroke: "#3b82f6", edgeColor: "#3b82f6" },
  { name: "商务灰", nodeFill: "#f1f5f9", nodeStroke: "#64748b", edgeColor: "#64748b" },
  { name: "科技青", nodeFill: "#cffafe", nodeStroke: "#06b6d4", edgeColor: "#06b6d4" },
  { name: "暖橙", nodeFill: "#ffedd5", nodeStroke: "#f97316", edgeColor: "#f97316" },
  { name: "墨绿", nodeFill: "#dcfce7", nodeStroke: "#16a34a", edgeColor: "#16a34a" },
  { name: "紫罗兰", nodeFill: "#ede9fe", nodeStroke: "#8b5cf6", edgeColor: "#8b5cf6" },
  { name: "玫瑰红", nodeFill: "#ffe4e6", nodeStroke: "#f43f5e", edgeColor: "#f43f5e" },
];

// —— 内置模板库（静态预设，套用即可，不调后端 / 不调 AI）——
const FLOW_TEMPLATES: { name: string; flow: { nodes: StoredNode[]; edges: StoredEdge[] } }[] = [
  {
    name: "登录注册流程",
    flow: {
      nodes: [
        { id: "t1", label: "开始", shape: "ellipse", x: 0, y: 120 },
        { id: "t2", label: "输入账号密码", shape: "rect", x: 250, y: 120 },
        { id: "t3", label: "验证通过?", shape: "diamond", x: 520, y: 120 },
        { id: "t4", label: "进入首页", shape: "rect", x: 820, y: 120 },
        { id: "t5", label: "提示错误", shape: "rect", x: 520, y: -60 },
      ],
      edges: [
        { id: "te1", source: "t1", target: "t2" },
        { id: "te2", source: "t2", target: "t3" },
        { id: "te3", source: "t3", target: "t4", label: "是" },
        { id: "te4", source: "t3", target: "t5", label: "否" },
        { id: "te5", source: "t5", target: "t2", label: "重试" },
      ],
    },
  },
  {
    name: "审批流程",
    flow: {
      nodes: [
        { id: "a1", label: "提交申请", shape: "rect", x: 0, y: 120 },
        { id: "a2", label: "主管审批", shape: "diamond", x: 250, y: 120 },
        { id: "a3", label: "财务审批", shape: "diamond", x: 520, y: 120 },
        { id: "a4", label: "审批通过", shape: "rect", x: 820, y: 120 },
        { id: "a5", label: "驳回", shape: "rect", x: 520, y: -60 },
      ],
      edges: [
        { id: "ae1", source: "a1", target: "a2" },
        { id: "ae2", source: "a2", target: "a3", label: "同意" },
        { id: "ae3", source: "a2", target: "a5", label: "拒绝" },
        { id: "ae4", source: "a3", target: "a4", label: "通过" },
        { id: "ae5", source: "a3", target: "a5", label: "不通过" },
      ],
    },
  },
  {
    name: "请假流程",
    flow: {
      nodes: [
        { id: "l1", label: "开始", shape: "ellipse", x: 0, y: 120 },
        { id: "l2", label: "填写请假单", shape: "rect", x: 250, y: 120 },
        { id: "l3", label: "直属领导审批", shape: "diamond", x: 520, y: 120 },
        { id: "l4", label: "HR 备案", shape: "rect", x: 820, y: 120 },
        { id: "l5", label: "结束", shape: "ellipse", x: 1100, y: 120 },
        { id: "l6", label: "驳回", shape: "rect", x: 520, y: -60 },
      ],
      edges: [
        { id: "le1", source: "l1", target: "l2" },
        { id: "le2", source: "l2", target: "l3" },
        { id: "le3", source: "l3", target: "l4", label: "通过" },
        { id: "le4", source: "l3", target: "l6", label: "不通过" },
        { id: "le5", source: "l4", target: "l5" },
      ],
    },
  },
  {
    name: "退款流程",
    flow: {
      nodes: [
        { id: "r1", label: "用户申请退款", shape: "rect", x: 0, y: 120 },
        { id: "r2", label: "审核", shape: "diamond", x: 250, y: 120 },
        { id: "r3", label: "退款处理", shape: "rect", x: 520, y: 120 },
        { id: "r4", label: "退款完成", shape: "ellipse", x: 820, y: 120 },
        { id: "r5", label: "拒绝退款", shape: "rect", x: 250, y: -60 },
      ],
      edges: [
        { id: "re1", source: "r1", target: "r2" },
        { id: "re2", source: "r2", target: "r3", label: "通过" },
        { id: "re3", source: "r2", target: "r5", label: "不通过" },
        { id: "re4", source: "r3", target: "r4" },
      ],
    },
  },
  {
    name: "软件部署发布",
    flow: {
      nodes: [
        { id: "s1", label: "代码提交", shape: "rect", x: 0, y: 120 },
        { id: "s2", label: "CI 构建", shape: "rect", x: 250, y: 120 },
        { id: "s3", label: "测试通过?", shape: "diamond", x: 520, y: 120 },
        { id: "s4", label: "部署到生产", shape: "rect", x: 820, y: 120 },
        { id: "s5", label: "监控验证", shape: "rect", x: 1100, y: 120 },
        { id: "s6", label: "回滚", shape: "rect", x: 820, y: -60 },
      ],
      edges: [
        { id: "se1", source: "s1", target: "s2" },
        { id: "se2", source: "s2", target: "s3" },
        { id: "se3", source: "s3", target: "s4", label: "是" },
        { id: "se4", source: "s3", target: "s6", label: "否" },
        { id: "se5", source: "s4", target: "s5" },
        { id: "se6", source: "s6", target: "s2", label: "重试" },
      ],
    },
  },
  {
    name: "客服工单",
    flow: {
      nodes: [
        { id: "c1", label: "创建工单", shape: "rect", x: 0, y: 120 },
        { id: "c2", label: "分派客服", shape: "rect", x: 250, y: 120 },
        { id: "c3", label: "处理问题", shape: "rect", x: 520, y: 120 },
        { id: "c4", label: "已解决?", shape: "diamond", x: 820, y: 120 },
        { id: "c5", label: "关闭工单", shape: "rect", x: 1100, y: 120 },
        { id: "c6", label: "升级处理", shape: "rect", x: 820, y: -60 },
      ],
      edges: [
        { id: "ce1", source: "c1", target: "c2" },
        { id: "ce2", source: "c2", target: "c3" },
        { id: "ce3", source: "c3", target: "c4" },
        { id: "ce4", source: "c4", target: "c5", label: "是" },
        { id: "ce5", source: "c4", target: "c6", label: "否" },
        { id: "ce6", source: "c6", target: "c3", label: "跟进" },
      ],
    },
  },
];

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
    case "internalStorage":
      // 矩形带竖线
      return `M 0 0 H ${w} V ${h} H 0 Z`;
    case "display": {
      // 底部内凹
      const dip = Math.min(14, h * 0.4);
      return `M 0 0 H ${w} V ${h - dip} Q ${w / 2} ${h - dip * 1.8} 0 ${h - dip} Z`;
    }
    case "terminator": {
      // 圆角矩形（双边框由装饰层绘制）
      const r = h / 2;
      return `M ${r} 0 H ${w - r} Q ${w} 0 ${w} ${r} V ${h - r} Q ${w} ${h} ${w - r} ${h} H ${r} Q 0 ${h} 0 ${h - r} V ${r} Q 0 0 ${r} 0 Z`;
    }
    case "predefined":
      return `M 0 0 H ${w} V ${h} H 0 Z`;
    case "merge": {
      // 梯形（上宽下窄，漏斗/合并）
      const s = w * 0.18;
      return `M 0 0 H ${w} L ${w - s} ${h} H ${s} Z`;
    }
    case "hexagon": {
      const s = w * 0.26;
      return `M ${s} 0 H ${w - s} L ${w} ${h / 2} L ${w - s} ${h} H ${s} L 0 ${h / 2} Z`;
    }
    case "card": {
      // 圆角矩形 + 右下折角
      const r = 12;
      const f = 16;
      return `M ${r} 0 H ${w - r} Q ${w} 0 ${w} ${r} V ${h - f} L ${w - f} ${h} H ${r} Q 0 ${h} 0 ${h - r} V ${r} Q 0 0 ${r} 0 Z`;
    }
    case "container":
    case "group":
    case "lane": {
      // 大圆角矩形（虚线边框由渲染层处理）
      const r = 18;
      return `M ${r} 0 H ${w - r} Q ${w} 0 ${w} ${r} V ${h - r} Q ${w} ${h} ${w - r} ${h} H ${r} Q 0 ${h} 0 ${h - r} V ${r} Q 0 0 ${r} 0 Z`;
    }
    case "note": {
      // 右上折角的矩形
      const f = 16;
      return `M 0 0 H ${w - f} L ${w} ${f} V ${h} H 0 Z`;
    }
    default:
      return `M 0 0 H ${w} V ${h} H 0 Z`;
  }
}

// 部分形状需要的额外装饰（竖线 / 双边框 / 折角线）
function shapeDecoration(shape: ShapeKind, w: number, h: number, stroke: string) {
  const sw = 1.4;
  switch (shape) {
    case "internalStorage":
      return <line x1={20} y1={6} x2={20} y2={h - 6} stroke={stroke} strokeWidth={sw} />;
    case "predefined":
      return (
        <>
          <line x1={9} y1={6} x2={9} y2={h - 6} stroke={stroke} strokeWidth={sw} />
          <line x1={w - 9} y1={6} x2={w - 9} y2={h - 6} stroke={stroke} strokeWidth={sw} />
        </>
      );
    case "terminator":
      return (
        <rect x={5} y={5} width={Math.max(0, w - 10)} height={Math.max(0, h - 10)} rx={12} fill="none" stroke={stroke} strokeWidth={1.1} />
      );
    case "note":
      return <path d={`M ${w - 16} 0 L ${w - 16} 16 L ${w} 16`} fill="none" stroke={stroke} strokeWidth={sw} />;
    case "card": {
      const f = 16;
      return <path d={`M ${w - f} ${h - f} L ${w - f} ${h} M ${w - f} ${h - f} L ${w} ${h - f}`} fill="none" stroke={stroke} strokeWidth={sw} />;
    }
    default:
      return null;
  }
}

// 连线箭头：把 ArrowType 转成 React Flow 的 marker（菱形用文档内的自定义 marker）
const ARROW_OPTIONS: { type: ArrowType; label: string }[] = [
  { type: "none", label: "无" },
  { type: "solid", label: "实" },
  { type: "hollow", label: "空" },
  { type: "diamond", label: "菱" },
];

function buildMarker(type: ArrowType | undefined, color: string): EdgeMarker | string | undefined {
  if (!type || type === "none") return undefined;
  if (type === "solid") return { type: MarkerType.ArrowClosed, color, width: 18, height: 18 };
  if (type === "hollow") return { type: MarkerType.Arrow, color, width: 18, height: 18 };
  // 菱形：引用文档中定义的自定义 marker（颜色随连线，用 context-stroke 继承）
  return "url(#rf-diamond)";
}

// 通过闭包把当前主题传入节点：未手动设色时使用主题色，手动色优先
function createShapeNode(theme: { nodeFill: string; nodeStroke: string }) {
  return function ShapeNode({ data, selected }: NodeProps) {
    const d = data as unknown as FlowData;
    const w = d.width ?? NODE_W;
    const h = d.height ?? NODE_H;
    const isContainerShape = d.shape === "container" || d.shape === "group" || d.shape === "lane";
    // 容器类：更淡的半透明填充（基于主题边框色，低透明度），让容器更清晰且不喧宾夺主
    const containerFill = (() => {
      const hex = theme.nodeStroke;
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return `rgba(${r}, ${g}, ${b}, 0.06)`;
    })();
    const fill = d.fill ?? (selected ? "var(--accent-soft)" : isContainerShape ? containerFill : theme.nodeFill);
    const stroke = d.stroke ?? (selected ? "var(--accent)" : theme.nodeStroke);
    const dashed = d.shape === "container" || d.shape === "group";
    // 选中态加粗到 2.5；容器类非选中态 2，其它 1.5
    const strokeW = selected ? 2.5 : isContainerShape ? 2 : 1.5;

    // 文字样式
    const fontSize = d.fontSize ?? 13;
    const fontWeight = d.bold ? 700 : 400;
    const align = d.textAlign ?? "center";
    const lineH = fontSize * 1.35;
    const rawLines = (d.label || "").split("\n");
    const displayLines =
      rawLines.length > 1
        ? rawLines
        : [d.label.length > 11 ? d.label.slice(0, 11) + "…" : d.label];
    const totalH = displayLines.length * lineH;
    const startY = h / 2 - totalH / 2 + lineH / 2;
    const tx = align === "left" ? 10 : align === "right" ? w - 10 : w / 2;
    const anchor = align === "left" ? "start" : align === "right" ? "end" : "middle";

    // 泳道：左侧标题栏（竖排标题）+ 主体，标题文字用节点 label（竖排显示在左侧标题栏）
    if (d.shape === "lane") {
      const BAR_W = 28;
      const r = 12;
      const titleBarPath = `M ${r} 0 H ${BAR_W} V ${h} H ${r} Q 0 ${h} 0 ${h - r} V ${r} Q 0 0 ${r} 0 Z`;
      return (
      <div style={{ width: w, height: h, filter: selected ? "drop-shadow(0 0 4px var(--accent))" : undefined }} className="relative" title={d.label}>
        <svg width={w} height={h} className="overflow-visible">
          <path d={shapePath(d.shape, w, h)} fill={fill} stroke={stroke} strokeWidth={strokeW} />
          <path d={titleBarPath} fill="rgba(100,116,139,0.2)" stroke="none" />
          <line x1={BAR_W} y1={0} x2={BAR_W} y2={h} stroke={stroke} strokeWidth={1} strokeOpacity={0.6} />
            <text
              x={BAR_W / 2}
              y={h / 2}
              textAnchor="middle"
              dominantBaseline="central"
              style={{ writingMode: "vertical-rl", userSelect: "none" }}
              fontSize={fontSize}
              fontWeight={fontWeight}
              fill="var(--text)"
            >
              {d.label}
            </text>
          </svg>
          <Handle type="target" position={Position.Left} style={{ background: "var(--accent)" }} />
          <Handle type="source" position={Position.Right} style={{ background: "var(--accent)" }} />
          <Handle type="source" position={Position.Top} style={{ background: "var(--accent)" }} />
          <Handle type="target" position={Position.Bottom} style={{ background: "var(--accent)" }} />
        </div>
      );
    }

    return (
      <div style={{ width: w, height: h, filter: selected ? "drop-shadow(0 0 4px var(--accent))" : undefined }} className="relative" title={d.label}>
        <svg width={w} height={h} className="overflow-visible">
          <path
            d={shapePath(d.shape, w, h)}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeW}
            strokeDasharray={dashed ? "6 4" : undefined}
          />
          {shapeDecoration(d.shape, w, h, stroke)}
          <text
            x={tx}
            y={startY}
            textAnchor={anchor}
            dominantBaseline="central"
            fontSize={fontSize}
            fontWeight={fontWeight}
            fill="var(--text)"
            style={{ userSelect: "none" }}
          >
            {displayLines.map((ln, i) => (
              <tspan key={i} x={tx} y={startY + i * lineH}>
                {ln}
              </tspan>
            ))}
          </text>
        </svg>
        <Handle type="target" position={Position.Left} style={{ background: "var(--accent)" }} />
        <Handle type="source" position={Position.Right} style={{ background: "var(--accent)" }} />
        <Handle type="source" position={Position.Top} style={{ background: "var(--accent)" }} />
        <Handle type="target" position={Position.Bottom} style={{ background: "var(--accent)" }} />
      </div>
    );
  };
}

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

// 沿 parentId 链累加，求节点在画布上的绝对坐标（不含尺寸），供对齐/分布/粘贴复用
function absPositionOf(id: string, byId: Map<string, Node>): { x: number; y: number } {
  const n = byId.get(id);
  if (!n) return { x: 0, y: 0 };
  let ax = n.position.x;
  let ay = n.position.y;
  let p = n.parentId ? byId.get(n.parentId) : undefined;
  while (p) {
    ax += p.position.x;
    ay += p.position.y;
    p = p.parentId ? byId.get(p.parentId) : undefined;
  }
  return { x: ax, y: ay };
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
      parentId: n.parentId,
      position: { x: n.x, y: n.y },
      data: {
        label: n.label,
        shape: n.shape,
        fill: n.fill,
        stroke: n.stroke,
        width: n.width,
        height: n.height,
        fontSize: n.fontSize,
        bold: n.bold,
        textAlign: n.textAlign,
      },
    })),
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(
    initial.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.label || undefined,
      data: { arrowStart: e.markerStart ?? "none", arrowEnd: e.markerEnd ?? "solid" },
    })),
  );
  const [edgeKind, setEdgeKind] = useState<EdgeKind>("default");
  const [mounted, setMounted] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiText, setAiText] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [themeIndex, setThemeIndex] = useState(0);
  // 网格吸附开关
  const [snap, setSnap] = useState(false);
  // 自定义编辑对话框（替代 window.prompt，支持多行、样式统一）
  const [editTarget, setEditTarget] = useState<{ type: "node" | "edge"; id: string; draft: string; cur: string } | null>(null);
  // 快捷键提示面板开关
  const [helpOpen, setHelpOpen] = useState(false);
  // 左侧侧栏 tab：图形库 / 风格
  const [leftTab, setLeftTab] = useState<"shapes" | "style">("shapes");
  // 左右侧栏折叠开关（扩大画布空间）
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  // 拖拽对齐辅助线：记录当前吸附的对齐参考线（x/y 位置）
  const [guides, setGuides] = useState<{ x: number | null; y: number | null }>({ x: null, y: null });
  // 画布视口（用于把辅助线的世界坐标换算成屏幕坐标）
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 });
  // 画布背景：点阵 / 网格 / 空白
  const [bgVariant, setBgVariant] = useState<"dots" | "lines" | "none">("dots");
  // 右键上下文菜单（fixed 定位到鼠标位置）
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; type: "node" | "edge" | "pane"; id?: string } | null>(null);

  // —— 撤销/重做 ——
  const [past, setPast] = useState<StoredFlow[]>([]);
  const [future, setFuture] = useState<StoredFlow[]>([]);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  nodesRef.current = nodes;
  edgesRef.current = edges;
  // React Flow 实例 ref（用于状态栏缩放控制）
  const rfRef = useRef<{ zoomIn: () => void; zoomOut: () => void; fitView: () => void } | null>(null);
  const dragStartRef = useRef<StoredFlow | null>(null);
  const clipboardRef = useRef<StoredNode[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const prevThemeColorRef = useRef(THEMES[0].nodeStroke);
  // 方向键微调：标记「本次方向键序列是否已记历史」，避免连续按污染撤销栈
  const arrowMovedRef = useRef(false);

  const snapshot = useCallback((): StoredFlow => {
    return {
      nodes: nodesRef.current.map((n) => {
        const d = n.data as unknown as FlowData;
        return {
          id: n.id,
          label: d.label,
          parentId: n.parentId,
          shape: d.shape,
          x: n.position.x,
          y: n.position.y,
          fill: d.fill,
          stroke: d.stroke,
          width: d.width,
          height: d.height,
          fontSize: d.fontSize,
          bold: d.bold,
          textAlign: d.textAlign,
        };
      }),
      edges: edgesRef.current.map((e) => {
        const ad = (e.data as EdgeArrowData) || {};
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          label: typeof e.label === "string" ? e.label : "",
          markerStart: ad.arrowStart ?? "none",
          markerEnd: ad.arrowEnd ?? "solid",
        };
      }),
    };
  }, []);

  const pushHistory = useCallback(() => {
    const s = snapshot();
    setPast((p) => [...p.slice(-(MAX_HISTORY - 1)), s]);
    setFuture([]);
  }, [snapshot]);

  const applyFlow = useCallback((s: StoredFlow) => {
    setNodes(
      s.nodes.map((n) => ({
        id: n.id,
        type: "shape",
        parentId: n.parentId,
        position: { x: n.x, y: n.y },
        data: {
          label: n.label,
          shape: n.shape,
          fill: n.fill,
          stroke: n.stroke,
          width: n.width,
          height: n.height,
          fontSize: n.fontSize,
          bold: n.bold,
          textAlign: n.textAlign,
        },
      })),
    );
    setEdges(
      s.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.label || undefined,
        data: { arrowStart: e.markerStart ?? "none", arrowEnd: e.markerEnd ?? "solid" },
      })),
    );
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
      // 注意：markerEnd/markerStart 不在此设置，改由 viewEdges 依据 edge.data 箭头类型生成（含「无箭头」）
      style: { stroke: THEMES[themeIndex].nodeStroke, strokeWidth: 1.5 },
      labelStyle: { fill: "var(--text)", fontSize: 12, fontWeight: 500 },
      labelBgStyle: { fill: "var(--background)", fillOpacity: 0.9 },
      labelBgPadding: [6, 3] as [number, number],
      labelBgBorderRadius: 4,
    }),
    [edgeKind, themeIndex],
  );

  // 节点类型随主题重建，使所有未手动设色节点即时换色
  const nodeTypes = useMemo(() => ({ shape: createShapeNode(THEMES[themeIndex]) }), [themeIndex]);

  // 切换主题时更新已有连线颜色（保留被手动设色的连线）。箭头由 viewEdges 的 decorate 统一生成。
  useEffect(() => {
    const newColor = THEMES[themeIndex].nodeStroke;
    const prevColor = prevThemeColorRef.current;
    setEdges((eds) =>
      eds.map((e) => {
        const cur = e.style?.stroke;
        if (cur === undefined || cur === prevColor) {
          return { ...e, style: { ...(e.style || {}), stroke: newColor } };
        }
        return e;
      }),
    );
    prevThemeColorRef.current = newColor;
  }, [themeIndex, setEdges]);

  // 给每条连线注入起点/终点箭头（从 edge.data 读取，颜色跟随连线描边）
  const viewEdges = useMemo(
    () =>
      edges.map((e) => {
        const ad = (e.data as EdgeArrowData) || {};
        const color = (e.style?.stroke as string) || THEMES[themeIndex].nodeStroke;
        return {
          ...e,
          markerEnd: buildMarker(ad.arrowEnd ?? "solid", color),
          markerStart: buildMarker(ad.arrowStart ?? "none", color),
        };
      }),
    [edges, themeIndex],
  );

  const buildStored = useCallback((): StoredFlow => {
    return {
      nodes: nodes.map((n) => {
        const d = n.data as unknown as FlowData;
        return {
          id: n.id,
          label: d.label,
          parentId: n.parentId,
          shape: d.shape,
          x: n.position.x,
          y: n.position.y,
          fill: d.fill,
          stroke: d.stroke,
          width: d.width,
          height: d.height,
          fontSize: d.fontSize,
          bold: d.bold,
          textAlign: d.textAlign,
        };
      }),
      edges: edges.map((e) => {
        const ad = (e.data as EdgeArrowData) || {};
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          label: typeof e.label === "string" ? e.label : "",
          markerStart: ad.arrowStart ?? "none",
          markerEnd: ad.arrowEnd ?? "solid",
        };
      }),
    };
  }, [nodes, edges]);

  const commit = useCallback(() => {
    onChange(JSON.stringify(buildStored()));
  }, [buildStored, onChange]);

  // 应用本地模板：解析模板数据并替换当前画布
  const applyLocalTemplate = useCallback(
    (data: string) => {
      try {
        const p = parseFlow(data);
        pushHistory();
        setNodes(
          p.nodes.map((n) => ({
            id: n.id,
            type: "shape",
            parentId: n.parentId,
            position: { x: n.x, y: n.y },
            data: {
              label: n.label,
              shape: n.shape,
              fill: n.fill,
              stroke: n.stroke,
              width: n.width,
              height: n.height,
              fontSize: n.fontSize,
              bold: n.bold,
              textAlign: n.textAlign,
            },
          })),
        );
        setEdges(
          p.edges.map((e) => ({
            id: e.id,
            source: e.source,
            target: e.target,
            label: e.label || undefined,
            data: { arrowStart: e.markerStart ?? "none", arrowEnd: e.markerEnd ?? "solid" },
          })),
        );
      } catch {
        /* 模板数据损坏时静默忽略 */
      }
    },
    [setNodes, setEdges, pushHistory],
  );

  useEffect(() => {
    if (!mounted) return;
    const t = setTimeout(commit, 200);
    return () => clearTimeout(t);
  }, [nodes, edges, mounted, commit]);

  const onConnect = useCallback(
    (c: Connection) => {
      pushHistory();
      setEdges((eds) =>
        addEdge(
          { ...c, id: genId("e"), data: { arrowStart: "none", arrowEnd: "solid" } },
          eds,
        ),
      );
    },
    [setEdges, pushHistory],
  );

  const addNode = (shape: ShapeKind) => {
    pushHistory();
    const id = genId("n");
    const offset = (nodes.length % 5) * 40;
    const isContainer = CONTAINER_SHAPES.includes(shape);
    const defaultSize =
      shape === "lane"
        ? { width: 520, height: 160 }
        : isContainer
          ? { width: 220, height: 140 }
          : {};
    setNodes((nds) => [
      ...nds,
      {
        id,
        type: "shape",
        position: { x: 80 + offset, y: 80 + offset },
        data: {
          label: SHAPE_LABEL[shape] || "节点",
          shape,
          ...defaultSize,
        },
      },
    ]);
  };

  const editLabel = (id: string) => {
    const n = nodes.find((x) => x.id === id);
    if (!n) return;
    const cur = (n.data as unknown as FlowData).label;
    setEditTarget({ type: "node", id, draft: cur, cur });
  };

  const editEdgeLabel = (id: string) => {
    const e = edges.find((x) => x.id === id);
    if (!e) return;
    const cur = typeof e.label === "string" ? e.label : "";
    setEditTarget({ type: "edge", id, draft: cur, cur });
  };

  const commitEdit = () => {
    if (!editTarget) return;
    const { type, id, draft, cur } = editTarget;
    pushHistory();
    if (type === "node") {
      const val = draft || cur; // 空内容保留原文字（与原 prompt 行为一致）
      setNodes((nds) => nds.map((x) => (x.id === id ? { ...x, data: { ...x.data, label: val } } : x)));
    } else {
      setEdges((eds) => eds.map((x) => (x.id === id ? { ...x, label: draft } : x)));
    }
    setEditTarget(null);
  };

  const closeEdit = () => setEditTarget(null);

  const deleteSelected = (onlyNodeIds?: string[], onlyEdgeIds?: string[]) => {
    const sel = onlyNodeIds ? nodes.filter((n) => onlyNodeIds.includes(n.id)) : nodes.filter((n) => n.selected);
    const selEdges = onlyEdgeIds ? edges.filter((e) => onlyEdgeIds.includes(e.id)) : edges.filter((e) => e.selected);
    if (sel.length === 0 && selEdges.length === 0) return;
    pushHistory();
    const ids = new Set(sel.map((n) => n.id));
    // 级联删除：删除分组节点时一并删除其子节点（含多层嵌套）
    let changed = true;
    while (changed) {
      changed = false;
      for (const n of nodes) {
        if (!ids.has(n.id) && n.parentId && ids.has(n.parentId)) {
          ids.add(n.id);
          changed = true;
        }
      }
    }
    setNodes((nds) => nds.filter((n) => !ids.has(n.id)));
    setEdges((eds) => eds.filter((e) => !ids.has(e.source) && !ids.has(e.target) && !selEdges.includes(e)));
  };

  // —— 组合分组 ——
  // 把一组节点（可含已分组的子节点）打成一个新分组：新建一个大圆角容器节点，
  // 选中节点改为其子节点（parentId = 分组 id，坐标转为相对分组），原空分组自动清理。
  const groupSelected = useCallback(() => {
    const sel = nodesRef.current.filter((n) => n.selected);
    if (sel.length < 2) return;
    pushHistory();
    const byId = new Map(nodesRef.current.map((n) => [n.id, n]));
    // 解析节点在画布上的绝对坐标（沿 parentId 链向上累加）
    const absOf = (n: Node): { x: number; y: number; w: number; h: number } => {
      const d = n.data as unknown as FlowData;
      let ax = n.position.x;
      let ay = n.position.y;
      let p = n.parentId ? byId.get(n.parentId) : undefined;
      while (p) {
        ax += p.position.x;
        ay += p.position.y;
        p = p.parentId ? byId.get(p.parentId) : undefined;
      }
      return { x: ax, y: ay, w: d.width ?? NODE_W, h: d.height ?? NODE_H };
    };
    const absList = sel.map((n) => absOf(n));
    const minX = Math.min(...absList.map((a) => a.x));
    const minY = Math.min(...absList.map((a) => a.y));
    const maxX = Math.max(...absList.map((a) => a.x + a.w));
    const maxY = Math.max(...absList.map((a) => a.y + a.h));
    const PAD = 24;
    const gx = minX - PAD;
    const gy = minY - PAD;
    const gw = maxX - minX + PAD * 2;
    const gh = maxY - minY + PAD * 2;
    const groupId = genId("g");
    const selIds = new Set(sel.map((n) => n.id));
    const oldParents = new Set(sel.map((n) => n.parentId).filter((v): v is string => !!v));
    setNodes((nds) => {
      const updated = nds.map((n) => {
        if (!selIds.has(n.id)) return n;
        const abs = absOf(n);
        // 转为相对新分组的坐标，并挂到新分组之下
        return { ...n, parentId: groupId, selected: false, position: { x: abs.x - gx, y: abs.y - gy } };
      });
      // 清理已变空的原父分组（容器/分组形状）
      const referenced = new Set(updated.map((n) => n.parentId).filter((v): v is string => !!v));
      const cleaned = updated.filter((n) => {
        const d = n.data as unknown as FlowData;
        return !(oldParents.has(n.id) && !referenced.has(n.id) && (d.shape === "group" || d.shape === "container"));
      });
      const groupNode: Node = {
        id: groupId,
        type: "shape",
        parentId: undefined,
        position: { x: gx, y: gy },
        zIndex: -1,
        selected: true,
        data: {
          label: "分组",
          shape: "group",
          fill: "rgba(99,102,241,0.08)",
          width: gw,
          height: gh,
        },
      };
      return [groupNode, ...cleaned];
    });
  }, [pushHistory, setNodes]);

  const ungroupSelected = useCallback(() => {
    // 从 ref 中找「被选中有子节点」的分组节点，避免依赖渲染期靠后的 selectedNode
    const grp = nodesRef.current.find(
      (n) => n.selected && nodesRef.current.some((c) => c.parentId === n.id),
    );
    if (!grp) return;
    pushHistory();
    const byId = new Map(nodesRef.current.map((n) => [n.id, n]));
    const absOf = (n: Node): { x: number; y: number } => {
      let ax = n.position.x;
      let ay = n.position.y;
      let p = n.parentId ? byId.get(n.parentId) : undefined;
      while (p) {
        ax += p.position.x;
        ay += p.position.y;
        p = p.parentId ? byId.get(p.parentId) : undefined;
      }
      return { x: ax, y: ay };
    };
    const newParent = grp.parentId; // 子节点重新挂到分组的父级（顶层则为 undefined）
    const newParentAbs = newParent ? absOf(byId.get(newParent)!) : { x: 0, y: 0 };
    setNodes((nds) => {
      const moved = nds
        .filter((n) => n.parentId === grp.id)
        .map((n) => {
          const a = absOf(n); // 子节点绝对坐标
          return {
            ...n,
            parentId: newParent,
            selected: true,
            position: { x: a.x - newParentAbs.x, y: a.y - newParentAbs.y },
          };
        });
      const others = nds
        .filter((n) => n.id !== grp.id && n.parentId !== grp.id)
        .map((n) => ({ ...n, selected: false }));
      return [...others, ...moved];
    });
  }, [pushHistory, setNodes]);

  const clearAll = () => {
    if (nodes.length === 0 && edges.length === 0) return;
    if (!window.confirm("清空整个流程图？")) return;
    pushHistory();
    setNodes([]);
    setEdges([]);
  };

  // —— 套用模板（静态预设，替换当前内容为模板，可撤销）——
  const applyTemplate = useCallback(
    (t: (typeof FLOW_TEMPLATES)[number]) => {
      pushHistory();
      applyFlow(t.flow);
    },
    [pushHistory, applyFlow],
  );

  // —— 复制 / 粘贴 / 全选 ——
  const copySelected = useCallback((onlyIds?: string[]) => {
    const sel = onlyIds
      ? nodesRef.current.filter((n) => onlyIds.includes(n.id))
      : nodesRef.current.filter((n) => n.selected);
    if (sel.length === 0) return;
    clipboardRef.current = sel.map((n) => {
      const d = n.data as unknown as FlowData;
      return {
        id: n.id,
        label: d.label,
        shape: d.shape,
        parentId: n.parentId,
        x: n.position.x,
        y: n.position.y,
        fill: d.fill,
        stroke: d.stroke,
        width: d.width,
        height: d.height,
        fontSize: d.fontSize,
        bold: d.bold,
        textAlign: d.textAlign,
      };
    });
  }, []);

  const pasteClipboard = useCallback(() => {
    const items = clipboardRef.current;
    if (items.length === 0) return;
    pushHistory();
    // 先建立 id 映射（所有被复制节点，确保父子关系可正确重映射）
    const idMap: Record<string, string> = {};
    for (const n of items) idMap[n.id] = genId("n");
    const byIdLive = new Map(nodesRef.current.map((n) => [n.id, n]));
    const newNodes: Node[] = items.map((n) => {
      const nid = idMap[n.id];
      let parentId: string | undefined;
      let position: { x: number; y: number };
      if (n.parentId && idMap[n.parentId]) {
        // 父节点也被一起复制：保持相对坐标，挂到映射后的新父节点（整体随父偏移 +30）
        parentId = idMap[n.parentId];
        position = { x: n.x, y: n.y };
      } else if (n.parentId && byIdLive.has(n.parentId)) {
        // 父节点不在本次复制范围：转成绝对坐标，成为独立顶层节点（避免悬空 parentId）
        const oldParentAbs = absPositionOf(n.parentId, byIdLive);
        position = { x: oldParentAbs.x + n.x + 30, y: oldParentAbs.y + n.y + 30 };
        parentId = undefined;
      } else {
        // 顶层节点：整体偏移 30 避免与原位置重叠
        parentId = undefined;
        position = { x: n.x + 30, y: n.y + 30 };
      }
      return {
        id: nid,
        type: "shape",
        parentId,
        position,
        selected: true,
        data: {
          label: n.label,
          shape: n.shape,
          fill: n.fill,
          stroke: n.stroke,
          width: n.width,
          height: n.height,
          fontSize: n.fontSize,
          bold: n.bold,
          textAlign: n.textAlign,
        },
      };
    });
    // 粘贴后默认选中新节点，取消旧选中
    setNodes((nds) => [...nds.map((n) => ({ ...n, selected: false })), ...newNodes]);
    const newEdges: Edge[] = [];
    for (const e of edgesRef.current) {
      if (idMap[e.source] && idMap[e.target]) {
        const ad = (e.data as EdgeArrowData) || {};
        newEdges.push({
          id: genId("e"),
          source: idMap[e.source],
          target: idMap[e.target],
          label: typeof e.label === "string" ? e.label : undefined,
          data: { arrowStart: ad.arrowStart ?? "none", arrowEnd: ad.arrowEnd ?? "solid" },
        });
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
  const curFontSize = selectedNode ? ((selectedNode.data as unknown as FlowData).fontSize ?? 13) : 13;
  const curBold = selectedNode ? !!((selectedNode.data as unknown as FlowData).bold) : false;
  const curAlign = selectedNode ? ((selectedNode.data as unknown as FlowData).textAlign ?? "center") : "center";

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

  // —— 节点文字样式 ——
  const setNodeFontSize = (size: number) => {
    if (!selectedNode) return;
    pushHistory();
    const id = selectedNode.id;
    setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, fontSize: size } } : n)));
  };
  const setNodeBold = () => {
    if (!selectedNode) return;
    pushHistory();
    const id = selectedNode.id;
    const cur = !!((selectedNode.data as unknown as FlowData).bold);
    setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, bold: !cur } } : n)));
  };
  const setNodeAlign = (align: TextAlign) => {
    if (!selectedNode) return;
    pushHistory();
    const id = selectedNode.id;
    setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, textAlign: align } } : n)));
  };

  // —— 匹配大小（对选中 ≥2 节点，以最大为基准）——
  const matchSize = (mode: "w" | "h" | "both") => {
    const sel = selectedNodes;
    if (sel.length < 2) return;
    let maxW = 0;
    let maxH = 0;
    for (const n of sel) {
      const d = n.data as unknown as FlowData;
      maxW = Math.max(maxW, d.width ?? NODE_W);
      maxH = Math.max(maxH, d.height ?? NODE_H);
    }
    pushHistory();
    const ids = new Set(sel.map((n) => n.id));
    setNodes((nds) =>
      nds.map((n) =>
        ids.has(n.id)
          ? {
              ...n,
              data: {
                ...n.data,
                width: mode === "w" || mode === "both" ? maxW : n.data.width,
                height: mode === "h" || mode === "both" ? maxH : n.data.height,
              },
            }
          : n,
      ),
    );
  };

  // —— 连线样式 ——
  const setEdgeColor = (color: string) => {
    if (!selectedEdge) return;
    pushHistory();
    const id = selectedEdge.id;
    // 箭头由 viewEdges 的 decorate 统一生成，这里只改颜色
    setEdges((eds) =>
      eds.map((e) => (e.id === id ? { ...e, style: { ...(e.style || {}), stroke: color } } : e)),
    );
  };

  const setEdgeArrow = (end: "start" | "end", type: ArrowType) => {
    if (!selectedEdge) return;
    pushHistory();
    const id = selectedEdge.id;
    setEdges((eds) =>
      eds.map((e) => {
        if (e.id !== id) return e;
        const ad: EdgeArrowData = { ...((e.data as EdgeArrowData) || {}) };
        if (end === "start") ad.arrowStart = type;
        else ad.arrowEnd = type;
        return { ...e, data: ad };
      }),
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
      return {
        id: n.id,
        label: d.label,
        shape: d.shape,
        x: n.position.x,
        y: n.position.y,
        fill: d.fill,
        stroke: d.stroke,
        width: d.width,
        height: d.height,
        fontSize: d.fontSize,
        bold: d.bold,
        textAlign: d.textAlign,
        parentId: n.parentId,
      };
    });
    const se: StoredEdge[] = edges.map((e) => {
      const ad = (e.data as EdgeArrowData) || {};
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        label: typeof e.label === "string" ? e.label : "",
        markerStart: ad.arrowStart ?? "none",
        markerEnd: ad.arrowEnd ?? "solid",
      };
    });
    autoLayout(sn, se);
    pushHistory();
    const origById = new Map(nodesRef.current.map((n) => [n.id, n]));
    setNodes(
      sn.map((n) => {
        const orig = origById.get(n.id);
        const isChild = !!orig?.parentId;
        return {
          id: n.id,
          type: "shape",
          parentId: n.parentId,
          // 已是子节点（分组内）的保持相对坐标，仅顶层节点参与自动布局，分组整体随之移动
          position: isChild ? { x: orig!.position.x, y: orig!.position.y } : { x: n.x, y: n.y },
          data: {
            label: n.label,
            shape: n.shape,
            fill: n.fill,
            stroke: n.stroke,
            width: n.width,
            height: n.height,
            fontSize: n.fontSize,
            bold: n.bold,
            textAlign: n.textAlign,
          },
        };
      }),
    );
  };

  // —— 导出公共：计算视口范围与背景 ——
  const computeExportMeta = () => {
    const viewportEl = containerRef.current?.querySelector(".react-flow__viewport") as HTMLElement | null;
    if (!viewportEl) return null;
    const bounds = getNodesBounds(nodes);
    const W = 1400;
    const H = Math.max(500, Math.round((bounds.height / Math.max(bounds.width, 1)) * W));
    const viewport = getViewportForBounds(bounds, W, H, 0.5, 2, 0.08);
    const bg = getComputedStyle(document.body).backgroundColor || "#ffffff";
    return { viewportEl, W, H, viewport, bg };
  };

  // —— 导出 PNG ——
  const exportPng = async () => {
    const meta = computeExportMeta();
    if (!meta) return;
    const { viewportEl, W, H, viewport, bg } = meta;
    setExporting(true);
    try {
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

  // —— 导出 SVG ——
  const exportSvg = async () => {
    const meta = computeExportMeta();
    if (!meta) return;
    const { viewportEl, W, H, viewport, bg } = meta;
    setExporting(true);
    try {
      const dataUrl = await toSvg(viewportEl, {
        backgroundColor: bg,
        width: W,
        height: H,
        style: {
          width: `${W}px`,
          height: `${H}px`,
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
        },
      });
      const a = document.createElement("a");
      a.download = "流程图.svg";
      a.href = dataUrl;
      a.click();
    } catch (err) {
      alert(`导出失败：${err instanceof Error ? err.message : "未知错误"}`);
    } finally {
      setExporting(false);
    }
  };

  // —— 多选对齐 / 分布 ——
  const nodeSizeOf = (n: Node): { w: number; h: number } => {
    const d = n.data as unknown as FlowData;
    return { w: d.width ?? NODE_W, h: d.height ?? NODE_H };
  };
  const alignNodes = (mode: "left" | "centerH" | "right" | "top" | "centerV" | "bottom") => {
    const sel = nodesRef.current.filter((n) => n.selected);
    if (sel.length < 2) return;
    pushHistory();
    const byId = new Map(nodesRef.current.map((n) => [n.id, n]));
    // 在绝对坐标系下计算选中节点的包围盒（子节点需沿 parentId 链累加）
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of sel) {
      const { w, h } = nodeSizeOf(n);
      const a = absPositionOf(n.id, byId);
      minX = Math.min(minX, a.x);
      maxX = Math.max(maxX, a.x + w);
      minY = Math.min(minY, a.y);
      maxY = Math.max(maxY, a.y + h);
    }
    const ids = new Set(sel.map((n) => n.id));
    // 各选中节点在绝对坐标系下的目标位置（先全部算好，避免回写时依赖数组顺序）
    const targetAbs: Record<string, { x: number; y: number }> = {};
    for (const n of sel) {
      const { w, h } = nodeSizeOf(n);
      const a = absPositionOf(n.id, byId);
      let ax = a.x;
      let ay = a.y;
      if (mode === "left") ax = minX;
      else if (mode === "right") ax = maxX - w;
      else if (mode === "centerH") ax = (minX + maxX) / 2 - w / 2;
      else if (mode === "top") ay = minY;
      else if (mode === "bottom") ay = maxY - h;
      else if (mode === "centerV") ay = (minY + maxY) / 2 - h / 2;
      targetAbs[n.id] = { x: ax, y: ay };
    }
    setNodes((nds) => {
      // 父节点若也被选中并已移动，则用其新绝对坐标；否则用未变的旧绝对坐标
      const parentAbs = (pid: string): { x: number; y: number } =>
        targetAbs[pid] ? targetAbs[pid] : absPositionOf(pid, byId);
      return nds.map((n) => {
        if (!ids.has(n.id)) return n;
        const t = targetAbs[n.id];
        // 有父节点：新绝对坐标减去父节点新绝对坐标，转回相对坐标写回
        if (n.parentId && byId.has(n.parentId)) {
          const pa = parentAbs(n.parentId);
          return { ...n, position: { x: t.x - pa.x, y: t.y - pa.y } };
        }
        return { ...n, position: { x: t.x, y: t.y } };
      });
    });
  };

  const distributeNodes = (axis: "h" | "v") => {
    const sel = nodesRef.current.filter((n) => n.selected);
    if (sel.length < 3) return;
    pushHistory();
    const byId = new Map(nodesRef.current.map((n) => [n.id, n]));
    const absOf = (n: Node) => absPositionOf(n.id, byId);
    // 按绝对坐标排序，避免子节点相对坐标干扰
    const sorted = [...sel].sort((a, b) =>
      axis === "h" ? absOf(a).x - absOf(b).x : absOf(a).y - absOf(b).y,
    );
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const ids = new Set(sel.map((n) => n.id));
    const total =
      axis === "h"
        ? absOf(last).x - absOf(first).x
        : absOf(last).y - absOf(first).y;
    const step = total / (sorted.length - 1);
    // 各选中节点在绝对坐标系下的目标位置（先全部算好）
    const targetAbs: Record<string, { x: number; y: number }> = {};
    sorted.forEach((n, i) => {
      const a = absOf(n);
      if (axis === "h") targetAbs[n.id] = { x: absOf(first).x + step * i, y: a.y };
      else targetAbs[n.id] = { x: a.x, y: absOf(first).y + step * i };
    });
    setNodes((nds) => {
      const parentAbs = (pid: string): { x: number; y: number } =>
        targetAbs[pid] ? targetAbs[pid] : absPositionOf(pid, byId);
      return nds.map((n) => {
        if (!ids.has(n.id)) return n;
        const t = targetAbs[n.id];
        // 有父节点：转回相对坐标写回
        if (n.parentId && byId.has(n.parentId)) {
          const pa = parentAbs(n.parentId);
          return { ...n, position: { x: t.x - pa.x, y: t.y - pa.y } };
        }
        return { ...n, position: { x: t.x, y: t.y } };
      });
    });
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
        markerStart: "none",
        markerEnd: "solid",
      }));
      autoLayout(sn, se);
      pushHistory();
      setNodes(
        sn.map((n) => ({
          id: n.id,
          type: "shape",
          parentId: n.parentId,
          position: { x: n.x, y: n.y },
          data: { label: n.label, shape: n.shape, width: n.width, height: n.height, fontSize: n.fontSize, bold: n.bold, textAlign: n.textAlign },
        })),
      );
      setEdges(
        se.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          label: e.label || undefined,
          data: { arrowStart: e.markerStart ?? "none", arrowEnd: e.markerEnd ?? "solid" },
        })),
      );
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
      } else if (!mod && (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        // 方向键微调选中节点：1px，Shift+方向键 10px。连续按记一次历史。
        const sel = nodesRef.current.filter((n) => n.selected);
        if (sel.length === 0) return;
        e.preventDefault();
        if (!arrowMovedRef.current) {
          pushHistory();
          arrowMovedRef.current = true;
        }
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        setNodes((nds) =>
          nds.map((n) =>
            n.selected ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } } : n,
          ),
        );
      } else if (e.key === "Escape") {
        // 取消所有选择 + 关闭右键菜单
        setNodes((nds) => nds.map((n) => (n.selected ? { ...n, selected: false } : n)));
        setCtxMenu(null);
      }
    },
    [undo, redo, copySelected, pasteClipboard, duplicateSelected, selectAll, deleteSelected, pushHistory, setNodes],
  );

  if (!mounted) return <div className="flex-1" />;

  const canUndo = past.length > 0;
  const canRedo = future.length > 0;

  return (
    <div className="flex h-[calc(100vh-300px)] min-h-[400px] flex-col rounded-lg border border-line bg-background">
      {/* 工具栏 */}
      <div className="relative z-20 flex flex-wrap items-center gap-1 border-b border-line px-2 py-1.5">
        {/* 侧栏折叠开关 */}
        <button
          onClick={() => setLeftCollapsed((v) => !v)}
          className={`grid h-7 w-7 place-items-center rounded-md transition-colors ${leftCollapsed ? "bg-accent-soft text-accent" : "text-muted hover:bg-hover hover:text-text"}`}
          title={leftCollapsed ? "展开左侧栏" : "折叠左侧栏"}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M9 3v18" />
          </svg>
        </button>
        <button
          onClick={() => setRightCollapsed((v) => !v)}
          className={`grid h-7 w-7 place-items-center rounded-md transition-colors ${rightCollapsed ? "bg-accent-soft text-accent" : "text-muted hover:bg-hover hover:text-text"}`}
          title={rightCollapsed ? "展开右侧栏" : "折叠右侧栏"}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M15 3v18" />
          </svg>
        </button>

        <span className="mx-1.5 h-5 w-px bg-line" />

        <span className="mr-0.5 text-[11px] font-medium text-faint">连线</span>
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

        <span className="ml-1 mr-0.5 text-[11px] font-medium text-faint">视图</span>
        {/* 网格吸附开关 */}
        <button
          onClick={() => setSnap((v) => !v)}
          className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors ${
            snap ? "bg-accent-soft text-accent" : "text-muted hover:bg-hover hover:text-text"
          }`}
          title="网格吸附：开启后拖拽节点自动对齐网格"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
          </svg>
          网格
        </button>
        {/* 画布背景切换：点阵 / 网格线 / 空白 */}
        <button
          onClick={() => setBgVariant((v) => (v === "dots" ? "lines" : v === "lines" ? "none" : "dots"))}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted transition-colors hover:bg-hover hover:text-text"
          title={`画布背景：${bgVariant === "dots" ? "点阵" : bgVariant === "lines" ? "网格线" : "空白"}（点击切换）`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            {bgVariant === "dots" ? (
              <>
                <circle cx="6" cy="6" r="1" /><circle cx="18" cy="6" r="1" /><circle cx="6" cy="18" r="1" /><circle cx="18" cy="18" r="1" />
              </>
            ) : bgVariant === "lines" ? (
              <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
            ) : (
              <path d="M4 4l16 16" />
            )}
          </svg>
          背景
        </button>

        <span className="mx-1.5 h-5 w-px bg-line" />
        <button onClick={undo} disabled={!canUndo} className="rounded-md px-2.5 py-1 text-xs text-text transition-colors hover:bg-hover disabled:opacity-40 disabled:cursor-not-allowed" title="撤销 (Ctrl+Z)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-15-6.7L3 13" /></svg>
        </button>
        <button onClick={redo} disabled={!canRedo} className="rounded-md px-2.5 py-1 text-xs text-text transition-colors hover:bg-hover disabled:opacity-40 disabled:cursor-not-allowed" title="重做 (Ctrl+Y)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 7v6h-6" /><path d="M3 17a9 9 0 0 1 15-6.7L21 13" /></svg>
        </button>
        <button onClick={() => deleteSelected()} className="rounded-md px-2.5 py-1 text-xs text-danger transition-colors hover:bg-danger-soft" title="删除选中 (Delete)">
          删除
        </button>
        <button onClick={clearAll} className="rounded-md px-2.5 py-1 text-xs text-muted transition-colors hover:bg-hover hover:text-text">
          清空
        </button>
        <button onClick={autoLayoutBtn} className="rounded-md px-2.5 py-1 text-xs text-text transition-colors hover:bg-hover" title="自动整理布局">
          自动布局
        </button>
        <span className="ml-auto flex items-center gap-1">
          {/* 快捷键提示按钮（靠右，导出/AI 附近） */}
          <div className="relative shrink-0">
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setHelpOpen((v) => !v);
              }}
              className={`flex h-7 w-7 items-center justify-center rounded-md text-sm font-semibold transition-colors ${
                helpOpen ? "bg-accent-soft text-accent" : "text-muted hover:bg-hover hover:text-text"
              }`}
              title="快捷键"
            >
              ?
            </button>
            {helpOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setHelpOpen(false)} />
                <div className="menu-panel absolute right-0 top-full z-40 mt-1 w-64 p-2.5">
                  <div className="mb-1.5 px-1 text-[11px] font-medium text-text">快捷键</div>
                  {SHORTCUTS.map((g) => (
                    <div key={g.group} className="mb-2 last:mb-0">
                      <div className="mb-1 px-1 text-[10px] font-medium text-faint">{g.group}</div>
                      <ul className="flex flex-col gap-0.5 text-xs text-muted">
                        {g.items.map((s) => (
                          <li key={s.key} className="flex items-center justify-between gap-2 rounded-md px-1.5 py-1">
                            <span>{s.desc}</span>
                            <span className="shrink-0 rounded bg-hover px-1.5 py-0.5 text-[10px] font-medium text-text">{s.key}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
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
            onClick={exportSvg}
            disabled={exporting}
            className="rounded-md px-2.5 py-1 text-xs text-text transition-colors hover:bg-hover disabled:opacity-50"
            title="导出 SVG 矢量图"
          >
            导出 SVG
          </button>
          <button
            onClick={() => setTemplateOpen(true)}
            className="rounded-md px-2.5 py-1 text-xs text-text transition-colors hover:bg-hover"
            title="保存为模板 / 我的模板"
          >
            模板
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

      {/* 自定义文字编辑对话框（替代 window.prompt） */}
      {editTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          onClick={closeEdit}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              closeEdit();
            }
          }}
        >
          <div
            className="w-[420px] max-w-[92vw] rounded-xl border border-line bg-background p-4 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 text-[14px] font-semibold text-text">
              {editTarget.type === "node" ? "编辑节点文字" : "编辑连线文字"}
            </div>
            {editTarget.type === "node" ? (
              <textarea
                autoFocus
                value={editTarget.draft}
                onChange={(e) => setEditTarget({ ...editTarget, draft: e.target.value })}
                rows={3}
                placeholder="支持多行，用换行分隔"
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    closeEdit();
                  } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    e.preventDefault();
                    commitEdit();
                  }
                }}
                className="mb-3 w-full resize-none rounded-lg border border-line bg-surface px-3 py-2 text-[13px] text-text outline-none focus:border-accent"
              />
            ) : (
              <input
                autoFocus
                value={editTarget.draft}
                onChange={(e) => setEditTarget({ ...editTarget, draft: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    closeEdit();
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    commitEdit();
                  }
                }}
                className="mb-3 w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px] text-text outline-none focus:border-accent"
              />
            )}
            <div className="flex justify-end gap-2">
              <button onClick={closeEdit} className="rounded-md px-3 py-1.5 text-[13px] text-muted hover:bg-hover">
                取消
              </button>
              <button onClick={commitEdit} className="rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-white">
                确定
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 主体：左侧栏 + 画布 */}
      <div className="flex min-h-0 flex-1">
        {/* 左侧侧栏：图形库 / 风格 */}
        {!leftCollapsed && (
        <div className="flex w-44 shrink-0 flex-col border-r border-line bg-background">
          <div className="flex border-b border-line">
            <button
              onClick={() => setLeftTab("shapes")}
              className={`flex-1 border-b-2 py-2.5 text-xs transition-colors ${leftTab === "shapes" ? "border-accent font-medium text-accent" : "border-transparent text-muted hover:text-text"}`}
            >
              图形库
            </button>
            <button
              onClick={() => setLeftTab("style")}
              className={`flex-1 border-b-2 py-2.5 text-xs transition-colors ${leftTab === "style" ? "border-accent font-medium text-accent" : "border-transparent text-muted hover:text-text"}`}
            >
              风格
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {leftTab === "shapes" ? (
              SHAPE_GROUPS.map((g) => (
                <div key={g.cat} className="mb-3 last:mb-0">
                  <div className="mb-1.5 px-1 text-[10px] font-medium text-faint">{g.cat}</div>
                  <div className="grid grid-cols-2 gap-1">
                    {g.items.map((s) => (
                      <button
                        key={s.kind}
                        onClick={() => addNode(s.kind)}
                        className="flex flex-col items-center gap-1 rounded-lg px-1 py-2 text-[10px] text-muted transition-colors hover:bg-hover hover:text-text"
                        title={`添加 ${s.label}`}
                      >
                        <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                          <path d={s.icon} />
                        </svg>
                        <span className="leading-none">{s.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <div>
                <div className="mb-1.5 px-1 text-[10px] font-medium text-faint">主题</div>
                {THEMES.map((t, i) => (
                  <button
                    key={t.name}
                    onClick={() => setThemeIndex(i)}
                    className={`mb-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors ${themeIndex === i ? "bg-accent-soft font-medium text-accent" : "text-text hover:bg-hover"}`}
                  >
                    <span className="h-4 w-4 shrink-0 rounded-sm" style={{ backgroundColor: t.nodeFill, border: `1.5px solid ${t.nodeStroke}` }} />
                    {t.name}
                  </button>
                ))}
                <div className="mb-1.5 mt-3 px-1 text-[10px] font-medium text-faint">模板</div>
                {FLOW_TEMPLATES.map((t) => (
                  <button
                    key={t.name}
                    onClick={() => applyTemplate(t)}
                    className="mb-1 w-full rounded-md px-2 py-1.5 text-left text-xs text-muted transition-colors hover:bg-hover hover:text-text"
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        )}

        {/* 画布 */}
        <div
          ref={containerRef}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onKeyUp={() => {
            arrowMovedRef.current = false;
          }}
          className="relative min-w-0 flex-1 outline-none"
          style={{ height: "100%", minHeight: 400 }}
        >
        {/* 自定义菱形箭头 marker（颜色用 context-stroke 跟随连线描边） */}
        <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
          <defs>
            <marker
              id="rf-diamond"
              viewBox="0 0 12 12"
              markerWidth="14"
              markerHeight="14"
              refX="9"
              refY="6"
              orient="auto-start-reverse"
              markerUnits="userSpaceOnUse"
            >
              <path d="M1 6 L6 1 L11 6 L6 11 Z" fill="context-stroke" stroke="context-stroke" />
            </marker>
          </defs>
        </svg>
        <ReactFlow
          ref={(r) => {
            rfRef.current = r as unknown as { zoomIn: () => void; zoomOut: () => void; fitView: () => void } | null;
          }}
          nodes={nodes}
          edges={viewEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeDoubleClick={(_, node) => editLabel(node.id)}
          onEdgeDoubleClick={(_, edge) => editEdgeLabel(edge.id)}
          onNodeContextMenu={(e, node) => {
            e.preventDefault();
            setCtxMenu({ x: e.clientX, y: e.clientY, type: "node", id: node.id });
          }}
          onEdgeContextMenu={(e, edge) => {
            e.preventDefault();
            setCtxMenu({ x: e.clientX, y: e.clientY, type: "edge", id: edge.id });
          }}
          onPaneContextMenu={(e) => {
            e.preventDefault();
            setCtxMenu({ x: e.clientX, y: e.clientY, type: "pane" });
          }}
          onNodeDragStart={() => {
            dragStartRef.current = snapshot();
          }}
          onNodeDrag={(_, node) => {
            // 拖拽对齐辅助线：检测被拖节点与其他节点的左/中/右、上/中/下对齐
            const byId = new Map(nodes.map((n) => [n.id, n]));
            const da = absPositionOf(node.id, byId);
            const d = node.data as unknown as FlowData;
            const dw = d.width ?? NODE_W;
            const dh = d.height ?? NODE_H;
            const dl = da.x;
            const dcx = da.x + dw / 2;
            const dr = da.x + dw;
            const dt = da.y;
            const dcy = da.y + dh / 2;
            const db = da.y + dh;
            const SNAP = 5;
            let gx: number | null = null;
            let gy: number | null = null;
            for (const n of nodes) {
              if (n.id === node.id) continue;
              if (n.parentId === node.id) continue; // 跳过自己的子节点
              const a = absPositionOf(n.id, byId);
              const nd = n.data as unknown as FlowData;
              const nw = nd.width ?? NODE_W;
              const nh = nd.height ?? NODE_H;
              const oxs = [a.x, a.x + nw / 2, a.x + nw];
              const oys = [a.y, a.y + nh / 2, a.y + nh];
              const dxs = [dl, dcx, dr];
              const dys = [dt, dcy, db];
              for (const ox of oxs) for (const dx of dxs) if (Math.abs(ox - dx) < SNAP) { gx = ox; break; }
              if (gx === null) for (const oy of oys) for (const dy of dys) if (Math.abs(oy - dy) < SNAP) { gy = oy; break; }
              if (gx !== null || gy !== null) break;
            }
            setGuides({ x: gx, y: gy });
          }}
          onMove={(_, vp) => setViewport(vp)}
          onNodeDragStop={(_, node) => {
            setGuides({ x: null, y: null });
            const byId = new Map(nodes.map((n) => [n.id, n]));
            // 解析节点画布绝对坐标（沿 parentId 链向上累加）
            const absOf = (n: Node) => {
              const d = n.data as unknown as FlowData;
              let ax = n.position.x;
              let ay = n.position.y;
              let p = n.parentId ? byId.get(n.parentId) : undefined;
              while (p) {
                ax += p.position.x;
                ay += p.position.y;
                p = p.parentId ? byId.get(p.parentId) : undefined;
              }
              return { x: ax, y: ay, w: d.width ?? NODE_W, h: d.height ?? NODE_H };
            };
            const dragged = byId.get(node.id);
            if (dragged) {
              const dShape = (dragged.data as unknown as FlowData).shape;
              // 泳道自身不参与归属（不做泳池嵌套）；只处理普通节点拖入/拖出泳道
              if (dShape !== "lane") {
                const da = absOf(dragged);
                const cx = da.x + da.w / 2;
                const cy = da.y + da.h / 2;
                // 找到中心点命中的泳道
                let targetLane: Node | null = null;
                for (const n of nodes) {
                  const nd = n.data as unknown as FlowData;
                  if (nd.shape === "lane" && n.id !== dragged.id) {
                    const la = absOf(n);
                    const lw = nd.width ?? 520;
                    const lh = nd.height ?? 160;
                    if (cx >= la.x && cx <= la.x + lw && cy >= la.y && cy <= la.y + lh) {
                      targetLane = n;
                      break;
                    }
                  }
                }
                const newParentId = targetLane ? targetLane.id : undefined;
                // 归属发生变化才更新（拖入新泳道 / 拖出泳道）
                if (newParentId !== dragged.parentId) {
                  setNodes((nds) =>
                    nds.map((n) => {
                      if (n.id !== dragged.id) return n;
                      const a = absOf(n);
                      if (newParentId) {
                        const laneAbs = absOf(byId.get(newParentId)!);
                        // 坐标转为相对泳道
                        return { ...n, parentId: newParentId, position: { x: a.x - laneAbs.x, y: a.y - laneAbs.y } };
                      }
                      // 拖出泳道：转回画布绝对坐标
                      return { ...n, parentId: undefined, position: { x: a.x, y: a.y } };
                    }),
                  );
                }
              }
            }
            // 记录拖拽历史（含归属变化，可撤销）
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
          disableKeyboardA11y
          snapToGrid={snap}
          snapGrid={[15, 15] as [number, number]}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          {bgVariant !== "none" && (
            <Background variant={bgVariant === "dots" ? BackgroundVariant.Dots : BackgroundVariant.Lines} gap={20} size={1} color="var(--line)" />
          )}
          <Controls />
          <MiniMap pannable zoomable className="!bg-background" />
        </ReactFlow>
        {/* 拖拽对齐辅助线（红色参考线，世界坐标换算成屏幕坐标） */}
        {guides.x !== null && (
          <div
            className="pointer-events-none absolute top-0 z-20 h-full"
            style={{ left: guides.x * viewport.zoom + viewport.x, width: 1, background: "#f43f5e" }}
          />
        )}
        {guides.y !== null && (
          <div
            className="pointer-events-none absolute left-0 z-20 w-full"
            style={{ top: guides.y * viewport.zoom + viewport.y, height: 1, background: "#f43f5e" }}
          />
        )}
        {/* 空状态引导：画布无节点时居中提示，pointer-events-none 不挡操作 */}
        {nodes.length === 0 && (
          <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 text-center">
            <div className="text-sm text-faint">画布是空的</div>
            <div className="text-xs text-faint">从左侧图形库添加形状，或点击 ✨AI 生成 一键生成</div>
          </div>
        )}
        {/* 底部状态栏：节点/连线统计 + 缩放控制 */}
        <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-line bg-background/90 px-2.5 py-1 text-[11px] text-muted shadow-sm backdrop-blur">
          <span className="px-1">{nodes.length} 节点</span>
          <span className="h-3 w-px bg-line" />
          <span className="px-1">{edges.length} 连线</span>
          <span className="h-3 w-px bg-line" />
          <button onClick={() => rfRef.current?.zoomOut()} className="grid h-5 w-5 place-items-center rounded-full text-text transition-colors hover:bg-hover" title="缩小">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M5 12h14" /></svg>
          </button>
          <button onClick={() => rfRef.current?.fitView()} className="min-w-[38px] rounded-full px-1 py-0.5 text-center transition-colors hover:bg-hover" title="自适应视图">
            {Math.round(viewport.zoom * 100)}%
          </button>
          <button onClick={() => rfRef.current?.zoomIn()} className="grid h-5 w-5 place-items-center rounded-full text-text transition-colors hover:bg-hover" title="放大">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
          </button>
        </div>
        </div>

        {/* 右侧样式侧栏：按选中状态切换内容 */}
        {!rightCollapsed && (
        <div className="flex w-52 shrink-0 flex-col border-l border-line bg-background">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <span className="text-xs font-semibold text-text">样式</span>
            {selectedNode && <span className="max-w-[120px] truncate text-[10px] text-faint">{((selectedNode.data as unknown as FlowData).label || "").slice(0, 12) || "节点"}</span>}
            {selectedEdge && <span className="text-[10px] text-faint">连线</span>}
          </div>
          <div className="flex-1 overflow-y-auto">
          {selectedEdge ? (
            <div className="space-y-3 p-3">
              <div>
                <div className="mb-1.5 text-[11px] font-medium text-faint">连线颜色</div>
                <div className="grid grid-cols-4 gap-1.5">
                  {STROKE_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => setEdgeColor(c)}
                      className={`h-7 w-7 rounded-full border border-line transition-transform hover:scale-110 ${(selectedEdge.style?.stroke || "#78716c") === c ? "ring-2 ring-accent ring-offset-1" : ""}`}
                      style={{ backgroundColor: c }}
                      title={c}
                    />
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-1.5 text-[11px] font-medium text-faint">线宽</div>
                <div className="flex gap-1.5">
                  {[1, 2, 3].map((w) => (
                    <button
                      key={w}
                      onClick={() => setEdgeWidth(w)}
                      className={`flex h-8 flex-1 items-center justify-center rounded-md border border-line transition-colors hover:bg-hover ${(selectedEdge.style?.strokeWidth || 1.5) === w ? "bg-accent-soft text-accent" : "text-muted"}`}
                      title={`线宽 ${w}`}
                    >
                      <span style={{ height: w === 1 ? 1 : w === 2 ? 2 : 3, width: 16, backgroundColor: "currentColor" }} />
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-1.5 text-[11px] font-medium text-faint">样式</div>
                <button
                  onClick={toggleEdgeDash}
                  className={`w-full rounded-md px-2 py-1.5 text-xs transition-colors ${selectedEdge.style?.strokeDasharray ? "bg-accent-soft text-accent" : "text-muted hover:bg-hover hover:text-text"}`}
                >
                  虚线
                </button>
              </div>
              <div>
                <div className="mb-1.5 text-[11px] font-medium text-faint">起点箭头</div>
                <div className="grid grid-cols-4 gap-1">
                  {ARROW_OPTIONS.map((o) => {
                    const cur = ((selectedEdge.data as EdgeArrowData)?.arrowStart ?? "none") === o.type;
                    return (
                      <button
                        key={o.type}
                        onClick={() => setEdgeArrow("start", o.type)}
                        className={`rounded-md py-1 text-[11px] transition-colors ${cur ? "bg-accent-soft text-accent" : "text-muted hover:bg-hover hover:text-text"}`}
                        title={`起点箭头：${o.label}`}
                      >
                        {o.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <div className="mb-1.5 text-[11px] font-medium text-faint">终点箭头</div>
                <div className="grid grid-cols-4 gap-1">
                  {ARROW_OPTIONS.map((o) => {
                    const cur = ((selectedEdge.data as EdgeArrowData)?.arrowEnd ?? "solid") === o.type;
                    return (
                      <button
                        key={o.type}
                        onClick={() => setEdgeArrow("end", o.type)}
                        className={`rounded-md py-1 text-[11px] transition-colors ${cur ? "bg-accent-soft text-accent" : "text-muted hover:bg-hover hover:text-text"}`}
                        title={`终点箭头：${o.label}`}
                      >
                        {o.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : selectedNode ? (
            <div className="space-y-3 p-3">
              <div>
                <div className="mb-1.5 text-[11px] font-medium text-faint">字号</div>
                <div className="grid grid-cols-6 gap-1">
                  {[12, 13, 14, 16, 18, 20].map((sz) => (
                    <button
                      key={sz}
                      onClick={() => setNodeFontSize(sz)}
                      className={`rounded-md py-1 text-[11px] transition-colors ${curFontSize === sz ? "bg-accent-soft text-accent" : "text-muted hover:bg-hover hover:text-text"}`}
                      title={`字号 ${sz}`}
                    >
                      {sz}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-1.5">
                <button
                  onClick={setNodeBold}
                  className={`flex-1 rounded-md py-1.5 text-xs font-bold transition-colors ${curBold ? "bg-accent-soft text-accent" : "text-muted hover:bg-hover hover:text-text"}`}
                  title="加粗"
                >
                  B 加粗
                </button>
                <div className="flex flex-1 gap-1">
                  {(
                    [
                      ["left", "M4 6h12M4 12h8M4 18h12", "左对齐"],
                      ["center", "M3 6h14M5 12h10M3 18h14", "居中"],
                      ["right", "M4 6h12M8 12h8M4 18h12", "右对齐"],
                    ] as [TextAlign, string, string][]
                  ).map(([al, d, t]) => (
                    <button
                      key={al}
                      onClick={() => setNodeAlign(al)}
                      className={`grid flex-1 place-items-center rounded-md py-1.5 transition-colors ${curAlign === al ? "bg-accent-soft text-accent" : "text-muted hover:bg-hover hover:text-text"}`}
                      title={t}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d={d} />
                      </svg>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-1.5 text-[11px] font-medium text-faint">填充</div>
                <div className="grid grid-cols-4 gap-1.5">
                  {FILL_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => setFill(c)}
                      className={`h-7 w-7 rounded border border-line transition-transform hover:scale-110 ${curFill === c ? "ring-2 ring-accent ring-offset-1" : ""}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                  <button
                    onClick={() => setFill("")}
                    className="grid h-7 w-7 place-items-center rounded border border-dashed border-line text-faint hover:text-text"
                    title="无填充"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
                  </button>
                </div>
              </div>
              <div>
                <div className="mb-1.5 text-[11px] font-medium text-faint">边框</div>
                <div className="grid grid-cols-4 gap-1.5">
                  {STROKE_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => setStroke(c)}
                      className={`h-7 w-7 rounded-full border border-line transition-transform hover:scale-110 ${curStroke === c ? "ring-2 ring-accent ring-offset-1" : ""}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                  <button
                    onClick={() => setStroke("")}
                    className="grid h-7 w-7 place-items-center rounded-full border border-dashed border-line text-faint hover:text-text"
                    title="默认边框"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
                  </button>
                </div>
              </div>
              {nodes.some((n) => n.parentId === selectedNode.id) && (
                <button
                  onClick={ungroupSelected}
                  className="w-full rounded-md px-2 py-1.5 text-xs text-text transition-colors hover:bg-hover"
                  title="取消分组，子节点恢复为独立节点"
                >
                  取消组合
                </button>
              )}
            </div>
          ) : selectedNodes.length >= 2 ? (
            <div className="space-y-3 p-3">
              <div>
                <div className="mb-1.5 text-[11px] font-medium text-faint">对齐</div>
                <div className="grid grid-cols-3 gap-1">
                  {(
                    [
                      ["left", "M3 6h11M3 12h7M3 18h11", "左对齐"],
                      ["centerH", "M3 6h11M6 12h5M3 18h11", "水平居中"],
                      ["right", "M3 6h11M9 12h5M3 18h11", "右对齐"],
                      ["top", "M6 3v11M12 3v7M18 3v11", "顶对齐"],
                      ["centerV", "M6 3v11M12 6v5M18 3v11", "垂直居中"],
                      ["bottom", "M6 3v11M12 9v5M18 3v11", "底对齐"],
                    ] as [string, string, string][]
                  ).map(([mode, d, t]) => (
                    <button
                      key={mode}
                      onClick={() => alignNodes(mode as any)}
                      className="grid h-8 place-items-center rounded-md text-muted transition-colors hover:bg-hover hover:text-text"
                      title={t}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d={d} />
                      </svg>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-1.5 text-[11px] font-medium text-faint">匹配大小</div>
                <div className="grid grid-cols-3 gap-1">
                  <button onClick={() => matchSize("h")} className="rounded-md py-1.5 text-xs text-muted transition-colors hover:bg-hover hover:text-text" title="等高（以最大高度为基准）">等高</button>
                  <button onClick={() => matchSize("w")} className="rounded-md py-1.5 text-xs text-muted transition-colors hover:bg-hover hover:text-text" title="等宽（以最大宽度为基准）">等宽</button>
                  <button onClick={() => matchSize("both")} className="rounded-md py-1.5 text-xs text-muted transition-colors hover:bg-hover hover:text-text" title="等高且等宽">等高宽</button>
                </div>
              </div>
              <div>
                <div className="mb-1.5 text-[11px] font-medium text-faint">分布</div>
                <div className="grid grid-cols-2 gap-1">
                  <button onClick={() => distributeNodes("h")} className="rounded-md py-1.5 text-xs text-muted transition-colors hover:bg-hover hover:text-text" title="水平等距分布">水平分布</button>
                  <button onClick={() => distributeNodes("v")} className="rounded-md py-1.5 text-xs text-muted transition-colors hover:bg-hover hover:text-text" title="垂直等距分布">垂直分布</button>
                </div>
              </div>
              <button onClick={groupSelected} className="w-full rounded-md px-2 py-1.5 text-xs text-text transition-colors hover:bg-hover" title="将选中节点组合为一个分组（整体拖动）">
                组合
              </button>
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center p-4 text-center text-xs leading-relaxed text-faint">
              选中节点或连线
              <br />
              以编辑样式
            </div>
          )}
          </div>
        </div>
        )}
      </div>

      {/* 右键上下文菜单：fixed 定位到鼠标位置，点遮罩关闭 */}
      {ctxMenu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setCtxMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setCtxMenu(null);
            }}
          />
          <div
            className="menu-panel fixed z-50 min-w-[150px] overflow-hidden p-1"
            style={{
              top: Math.min(ctxMenu.y, (typeof window !== "undefined" ? window.innerHeight : 9999) - 160),
              left: Math.min(ctxMenu.x, (typeof window !== "undefined" ? window.innerWidth : 9999) - 170),
            }}
          >
            {ctxMenu.type === "node" && (
              <>
                <button className={CTX_ITEM} onClick={() => { const id = ctxMenu.id!; setCtxMenu(null); editLabel(id); }}>
                  编辑文字
                </button>
                <button className={CTX_ITEM} onClick={() => { const id = ctxMenu.id!; setCtxMenu(null); copySelected([id]); }}>
                  复制
                </button>
                <div className={CTX_SEP} />
                <button className={CTX_ITEM_DANGER} onClick={() => { const id = ctxMenu.id!; setCtxMenu(null); deleteSelected([id]); }}>
                  删除
                </button>
              </>
            )}
            {ctxMenu.type === "edge" && (
              <>
                <button className={CTX_ITEM} onClick={() => { const id = ctxMenu.id!; setCtxMenu(null); editEdgeLabel(id); }}>
                  编辑文字
                </button>
                <div className={CTX_SEP} />
                <button className={CTX_ITEM_DANGER} onClick={() => { const id = ctxMenu.id!; setCtxMenu(null); deleteSelected(undefined, [id]); }}>
                  删除
                </button>
              </>
            )}
            {ctxMenu.type === "pane" && (
              <>
                <button
                  className={`${CTX_ITEM} ${clipboardRef.current.length === 0 ? "cursor-not-allowed opacity-40" : ""}`}
                  disabled={clipboardRef.current.length === 0}
                  onClick={() => {
                    if (clipboardRef.current.length === 0) return;
                    setCtxMenu(null);
                    pasteClipboard();
                  }}
                >
                  粘贴
                </button>
                <div className={CTX_SEP} />
                <button className={CTX_ITEM} onClick={() => { setCtxMenu(null); selectAll(); }}>
                  全选
                </button>
              </>
            )}
          </div>
        </>
      )}

      <DiagramTemplateDialog
        open={templateOpen}
        onClose={() => setTemplateOpen(false)}
        type="flowchart"
        currentData={JSON.stringify(buildStored())}
        onApply={applyLocalTemplate}
      />
    </div>
  );
}
