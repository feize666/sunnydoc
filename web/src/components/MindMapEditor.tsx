"use client";

import { useState, useRef, useCallback, useMemo } from "react";
import { toPng } from "html-to-image";
import { generateDiagram } from "@/lib/api";

// —— 数据结构：扁平节点 + parent 引用 ——
interface MindNode {
  id: string;
  text: string;
  parent: string | null;
  color?: string;
  collapsed?: boolean;
  icon?: string; // 节点图标 id（见 ICONS）
  note?: string; // 节点备注（Markdown 文本，纯文本展示）
}

type LayoutMode = "logic" | "org" | "timeline" | "fishbone" | "tree";

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
  anchorX?: number; // 鱼骨图：连线起点 x（主干锚点或父节点中心）
  anchorY?: number; // 鱼骨图：连线起点 y
  spineEndX?: number; // 鱼骨图：主干（鱼脊）右端 x（鱼头处）
}

// 时间轴布局：根在最左，一级子节点水平排成主干，二级及以下垂直挂在各自父节点下方
function layoutTimeline(nodes: MindNode[]): Record<string, LayoutItem> {
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
  const widthOf = (id: string) => nodeWidth(map[id]?.text || "", map[id]?.icon);
  const done = new Set<string>();

  // 根节点垂直排列在最左
  let rootY = 0;
  for (const r of roots) {
    pos[r] = { x: 0, y: rootY, w: widthOf(r), h: NODE_H };
    rootY += NODE_H + V_GAP;
    done.add(r);
  }

  // 一级节点水平排成时间轴主干（位于根节点右侧）
  const level1: string[] = [];
  for (const r of roots) level1.push(...(kids[r] || []));
  const rootMaxW = roots.length ? Math.max(...roots.map((r) => widthOf(r))) : 60;
  let tx = rootMaxW + GAP * 2;
  for (const c of level1) {
    const w = widthOf(c);
    pos[c] = { x: tx, y: 0, w, h: NODE_H };
    tx += w + GAP;
    done.add(c);
  }

  // 二级及以下：垂直挂在父节点下方
  const queue: string[] = [...level1];
  while (queue.length) {
    const pid = queue.shift()!;
    const pp = pos[pid];
    let yOff = NODE_H + V_GAP;
    for (const cid of kids[pid] || []) {
      if (done.has(cid)) continue;
      pos[cid] = { x: pp.x, y: pp.y + yOff, w: widthOf(cid), h: NODE_H };
      yOff += NODE_H + V_GAP;
      done.add(cid);
      queue.push(cid);
    }
  }

  // 孤儿节点兜底
  let gy = 0;
  for (const n of nodes) {
    if (!pos[n.id]) {
      pos[n.id] = { x: 0, y: gy, w: widthOf(n.id), h: NODE_H };
      gy += NODE_H + V_GAP;
    }
  }
  return pos;
}

// 鱼骨图（因果分析图）：水平主干（鱼脊）在 y=0，根（鱼头/问题）在最右；
// 一级主因沿主干上下交替伸出斜分支，二级及更深沿父节点外侧方向继续排开。
function layoutFishbone(nodes: MindNode[]): Record<string, LayoutItem> {
  const map: Record<string, MindNode> = {};
  const kids: Record<string, string[]> = {};
  for (const n of nodes) {
    map[n.id] = n;
    kids[n.id] = kids[n.id] || [];
  }
  for (const n of nodes) {
    if (n.parent && map[n.parent]) kids[n.parent].push(n.id);
  }
  const roots = nodes.filter((n) => !n.parent || !map[n.parent]).map((n) => n.id);
  const widthOf = (id: string) => nodeWidth(map[id]?.text || "", map[id]?.icon);
  const pos: Record<string, LayoutItem> = {};

  const level1: string[] = [];
  for (const r of roots) level1.push(...(kids[r] || []));

  const slant = 78; // 一级主因相对主干的垂直偏移
  const stepGap = 36; // 同侧相邻分支的水平额外间距
  let upCursor = 0;
  let downCursor = 0;
  let maxRight = 0;

  level1.forEach((id, i) => {
    const up = i % 2 === 0; // 上下交替
    const sign = up ? -1 : 1;
    const w = widthOf(id);
    const attachX = up ? upCursor : downCursor; // 同侧独立游标，避免重叠
    const cx = attachX + 44;
    const cy = sign * slant;
    pos[id] = { x: cx - w / 2, y: cy - NODE_H / 2, w, h: NODE_H, anchorX: attachX, anchorY: 0 };
    const step = w + stepGap;
    if (up) upCursor += step;
    else downCursor += step;
    maxRight = Math.max(maxRight, cx + w / 2);

    // 二级及更深：沿父节点外侧方向继续排开（x 略向右错，y 继续向外）
    let frontier: { id: string; cx: number; cy: number; sign: number }[] = [{ id, cx, cy, sign }];
    while (frontier.length) {
      const next: { id: string; cx: number; cy: number; sign: number }[] = [];
      for (const f of frontier) {
        let yy = f.cy + f.sign * (NODE_H + 16);
        for (const cid of kids[f.id] || []) {
          const cw = widthOf(cid);
          const ccx = f.cx + 8;
          const ccy = yy;
          pos[cid] = { x: ccx - cw / 2, y: ccy - NODE_H / 2, w: cw, h: NODE_H, anchorX: f.cx, anchorY: f.cy };
          next.push({ id: cid, cx: ccx, cy: ccy, sign: f.sign });
          yy += f.sign * (NODE_H + 12);
          maxRight = Math.max(maxRight, ccx + cw / 2);
        }
      }
      frontier = next;
    }
  });

  // 鱼头（根）放在主干右端；多根时竖向堆叠
  roots.forEach((r, ri) => {
    const w = widthOf(r);
    const ry = roots.length > 1 ? (ri - (roots.length - 1) / 2) * (NODE_H + V_GAP) : 0;
    const rx = maxRight + GAP;
    pos[r] = { x: rx, y: ry - NODE_H / 2, w, h: NODE_H, spineEndX: rx + w / 2 };
  });

  // 孤儿节点兜底
  let gy = 0;
  for (const n of nodes) {
    if (!pos[n.id]) {
      pos[n.id] = { x: 0, y: gy, w: widthOf(n.id), h: NODE_H };
      gy += NODE_H + V_GAP;
    }
  }
  return pos;
}

// 树形图：根在顶部居中，子节点向下分层、左右对称；连线用直角折线。
function layoutTree(nodes: MindNode[]): Record<string, LayoutItem> {
  const map: Record<string, MindNode> = {};
  const kids: Record<string, string[]> = {};
  for (const n of nodes) {
    map[n.id] = n;
    kids[n.id] = kids[n.id] || [];
  }
  for (const n of nodes) {
    if (n.parent && map[n.parent]) kids[n.parent].push(n.id);
  }
  const roots = nodes.filter((n) => !n.parent || !map[n.parent]).map((n) => n.id);
  const pos: Record<string, LayoutItem> = {};
  const widthOf = (id: string) => nodeWidth(map[id]?.text || "", map[id]?.icon);
  const TREE_VGAP = 12; // 比 org 的 V_GAP 更紧凑

  const spanOf = (id: string): number => {
    const ks = kids[id] || [];
    if (ks.length === 0) return widthOf(id) + TREE_VGAP;
    let total = 0;
    for (const k of ks) total += spanOf(k);
    return total;
  };

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
      place(k, cursor, y + NODE_H + TREE_VGAP);
      centers.push(pos[k].x + pos[k].w / 2);
      cursor += spanOf(k);
    }
    // 父节点 x = 子树水平中心 - 自身宽度/2（完全左右对称居中）
    pos[id] = { x: (centers[0] + centers[centers.length - 1]) / 2 - w / 2, y, w, h: NODE_H };
  };

  let cursor = 0;
  for (const r of roots) {
    place(r, cursor, 0);
    cursor += spanOf(r);
  }

  // 孤儿节点兜底
  let gy = 0;
  for (const n of nodes) {
    if (!pos[n.id]) {
      pos[n.id] = { x: 0, y: gy, w: widthOf(n.id), h: NODE_H };
      gy += NODE_H + V_GAP;
    }
  }
  return pos;
}

// 树形布局（logic 从左到右 / org 从上到下），只对传入的可见节点布局
function layout(nodes: MindNode[], mode: LayoutMode): Record<string, LayoutItem> {
  if (mode === "timeline") return layoutTimeline(nodes);
  if (mode === "fishbone") return layoutFishbone(nodes);
  if (mode === "tree") return layoutTree(nodes);
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
  const widthOf = (id: string) => nodeWidth(map[id]?.text || "", map[id]?.icon);

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
const MAX_HISTORY = 100;

// 主题配色方案（按层级自动上色的色板）
const THEMES: { name: string; palette: string[] }[] = [
  { name: "默认", palette: ["#2f6bff", "#16a34a", "#f97316", "#a855f7", "#0ea5e9", "#ec4899", "#dc2626", "#78716c"] },
  { name: "海洋", palette: ["#0ea5e9", "#0284c7", "#06b6d4", "#38bdf8", "#7dd3fc", "#0c4a6e", "#0891b2", "#22d3ee"] },
  { name: "森林", palette: ["#16a34a", "#15803d", "#22c55e", "#4ade80", "#86efac", "#14532d", "#65a30d", "#84cc16"] },
  { name: "暖阳", palette: ["#f97316", "#ea580c", "#f59e0b", "#fbbf24", "#fcd34d", "#c2410c", "#ef4444", "#fb923c"] },
  { name: "紫罗兰", palette: ["#a855f7", "#9333ea", "#7c3aed", "#8b5cf6", "#c084fc", "#6b21a8", "#d946ef", "#e879f9"] },
  // —— 新增主题（每套 8 色） ——
  { name: "珊瑚", palette: ["#ff6b6b", "#fa5252", "#f06595", "#e64980", "#ff8787", "#ffa94d", "#d6336c", "#f783ac"] },
  { name: "天青", palette: ["#22b8cf", "#15aabf", "#3bc9db", "#66d9e8", "#0c8599", "#1098ad", "#099268", "#38d9a9"] },
  { name: "薄荷", palette: ["#51cf66", "#40c057", "#69db7c", "#a9e34b", "#94d82d", "#37b24d", "#2f9e44", "#74b816"] },
  { name: "金色", palette: ["#fcc419", "#fab005", "#f59f00", "#f08c00", "#e67700", "#ffd43b", "#f1a208", "#d4a017"] },
  { name: "靛蓝", palette: ["#5c7cfa", "#4c6ef5", "#748ffc", "#4263eb", "#3b5bdb", "#5f3dc4", "#6741d9", "#7048e8"] },
  { name: "石墨", palette: ["#212529", "#343a40", "#495057", "#5c636a", "#6c757d", "#868e96", "#adb5bd", "#ced4da"] },
  { name: "酒红", palette: ["#9c1d1d", "#c92a2a", "#e03131", "#d6336c", "#a61e4d", "#862e9c", "#b0255e", "#7d1f3c"] },
  { name: "蓝灰", palette: ["#4263eb", "#5c7cfa", "#748ffc", "#4c6ef5", "#5b6bd6", "#6c7ae0", "#8094e8", "#3b5bdb"] },
];

// —— 节点图标：30+ 矢量图标（单色 line icon，24x24 viewBox）——
// 每个图标用一条 `path`（可含多段 M 子路径）绘制；数字 1-9 用 `char` 渲染文本。
interface IconDef {
  id: string;
  label: string;
  path?: string;
  char?: string;
}

const ICONS: IconDef[] = [
  { id: "priority", label: "优先级", path: "M6 20V10M12 20V4M18 20v-6" },
  { id: "flag", label: "旗帜", path: "M5 21V4h11l-2 4 2 4H5" },
  { id: "star", label: "星星", path: "M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 17l-5.2 2.7 1-5.8L3.5 9.2l5.9-.9z" },
  { id: "progress", label: "进度", path: "M12 3a9 9 0 1 1-8.5 6.2" },
  { id: "bulb", label: "灯泡", path: "M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z" },
  { id: "target", label: "目标", path: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12.5a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1z" },
  { id: "question", label: "问号", path: "M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1 .9-1 1.7M12 17h.01" },
  { id: "exclam", label: "感叹号", path: "M12 8v5M12 16.5h.01" },
  { id: "check", label: "对勾", path: "M5 13l4 4L19 7" },
  { id: "cross", label: "叉", path: "M6 6l12 12M18 6L6 18" },
  { id: "heart", label: "爱心", path: "M12 20s-7-4.5-9.5-9C1 8 2.5 4.5 6 4.5c2 0 3.2 1.2 4 2.3.8-1.1 2-2.3 4-2.3 3.5 0 5 3.5 3.5 6.5C19 15.5 12 20 12 20z" },
  { id: "clock", label: "时钟", path: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2" },
  { id: "calendar", label: "日历", path: "M7 4v3M17 4v3M4 9h16M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z" },
  { id: "link", label: "链接", path: "M9 15l6-6M10.5 6.5l1.5-1.5a4 4 0 0 1 5.7 5.7l-1.5 1.5M13.5 17.5l-1.5 1.5a4 4 0 0 1-5.7-5.7l1.5-1.5" },
  { id: "book", label: "书籍", path: "M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM19 19H6" },
  { id: "gear", label: "齿轮", path: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19 12a7 7 0 0 0-.1-1l2-1.5-2-3.5L17 5.9a7 7 0 0 0-1.7-1L15 3h-3v2a7 7 0 0 0-1.7 1L8.3 5.9 5.3 7.5 7.3 9a7 7 0 0 0 0 4l-2 1.5 2 3.5L8.3 18a7 7 0 0 0 1.7 1L11 21h3v-2a7 7 0 0 0 1.7-1l1.8 1.1 2-3.5-2-1.5a7 7 0 0 0 0-2z" },
  { id: "rocket", label: "火箭", path: "M12 3c3 2 5 5 5 9l-2 4H9l-2-4c0-4 2-7 5-9zM9 16l-1 5 4-2 4 2-1-5M12 7a1.5 1.5 0 1 0 0 .01" },
  { id: "warning", label: "警示", path: "M12 4l9 16H3zM12 10v4M12 17h.01" },
  { id: "bookmark", label: "书签", path: "M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" },
  { id: "mail", label: "邮件", path: "M3 6h18v12H3zM3 7l9 6 9-6" },
  { id: "pin", label: "位置", path: "M12 21s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12zM12 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" },
  { id: "camera", label: "相机", path: "M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1zM12 16a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z" },
  { id: "music", label: "音乐", path: "M9 18V6l10-2v12M9 18a3 3 0 1 1-2-2.8M19 16a3 3 0 1 1-2-2.8" },
  { id: "bolt", label: "闪电", path: "M13 3L4 14h6l-1 7 9-11h-6z" },
  { id: "lock", label: "锁", path: "M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3" },
  { id: "key", label: "钥匙", path: "M14 7a4 4 0 1 0-3.5 6.9L7 17v3H4v-3h3l3.1-3.1A4 4 0 0 0 14 7zM14 5.5h.01" },
  { id: "eye", label: "眼睛", path: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" },
  { id: "doc", label: "文档", path: "M6 2h8l4 4v16H6zM14 2v4h4M9 13h6M9 17h6" },
  { id: "folder", label: "文件夹", path: "M3 6h6l2 2h10v11H3z" },
  { id: "user", label: "用户", path: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0" },
  { id: "search", label: "搜索", path: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-4.5-4.5" },
  { id: "sliders", label: "设置", path: "M4 6h10M18 6h2M4 12h2M10 12h10M4 18h7M15 18h5M16 4v4M7 10v4M12 16v4" },
  { id: "n1", label: "1", char: "1" },
  { id: "n2", label: "2", char: "2" },
  { id: "n3", label: "3", char: "3" },
  { id: "n4", label: "4", char: "4" },
  { id: "n5", label: "5", char: "5" },
  { id: "n6", label: "6", char: "6" },
  { id: "n7", label: "7", char: "7" },
  { id: "n8", label: "8", char: "8" },
  { id: "n9", label: "9", char: "9" },
];

const ICON_SIZE = 16;
const ICON_PAD = 30; // 图标(16) + 间距，作为有图标节点的额外宽度

// 带图标感知的节点宽度估计（图标会占用左侧空间）
function nodeWidth(text: string, icon?: string): number {
  return estimateWidth(text) + (icon ? ICON_PAD : 0);
}

// 图标渲染组件：在 HTML 与 SVG（嵌套 <svg>）中通用
function Glyph({
  iconId,
  size = 16,
  color = "currentColor",
  x = 0,
  y = 0,
}: {
  iconId: string;
  size?: number;
  color?: string;
  x?: number;
  y?: number;
}) {
  const def = ICONS.find((i) => i.id === iconId);
  if (!def) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" x={x} y={y} style={{ display: "block" }}>
      {def.char ? (
        <text x={12} y={12} textAnchor="middle" dominantBaseline="central" fontSize={15} fontWeight={700} fill={color} style={{ userSelect: "none" }}>
          {def.char}
        </text>
      ) : (
        <path d={def.path!} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
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
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("logic");
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [view, setView] = useState<{ x: number; y: number; k: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasDragRef = useRef<{ startX: number; startY: number; vx: number; vy: number } | null>(null);
  const nodeDragRef = useRef<{ id: string; startX: number; startY: number } | null>(null);
  const [dragNode, setDragNode] = useState<{ id: string; x: number; y: number } | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiText, setAiText] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [themePalette, setThemePalette] = useState<string[]>(PALETTE);
  const [themeOpen, setThemeOpen] = useState(false);
  const [iconOpen, setIconOpen] = useState(false);
  // 备注气泡：noteTarget 为打开备注的节点 id，noteDraft 为编辑中的草稿
  const [noteTarget, setNoteTarget] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [exporting, setExporting] = useState(false);

  // —— 撤销/重做 ——
  const [past, setPast] = useState<MindNode[][]>([]);
  const [future, setFuture] = useState<MindNode[][]>([]);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  const pushHistory = useCallback(() => {
    setPast((p) => [...p.slice(-(MAX_HISTORY - 1)), nodesRef.current]);
    setFuture([]);
  }, []);

  const commit = useCallback(
    (next: MindNode[]) => {
      pushHistory();
      setNodes(next);
      onChange(JSON.stringify({ nodes: next }));
    },
    [onChange, pushHistory],
  );

  const undo = useCallback(() => {
    setPast((p) => {
      if (p.length === 0) return p;
      const prev = p[p.length - 1];
      setFuture((f) => [...f, nodesRef.current]);
      setNodes(prev);
      onChange(JSON.stringify({ nodes: prev }));
      setSelected(null);
      return p.slice(0, -1);
    });
  }, [onChange]);

  const redo = useCallback(() => {
    setFuture((f) => {
      if (f.length === 0) return f;
      const next = f[f.length - 1];
      setPast((p) => [...p.slice(-(MAX_HISTORY - 1)), nodesRef.current]);
      setNodes(next);
      onChange(JSON.stringify({ nodes: next }));
      setSelected(null);
      return f.slice(0, -1);
    });
  }, [onChange]);

  const mapNode = (id: string) => nodes.find((n) => n.id === id);

  // 可见节点：祖先链上没有 collapsed 的节点
  const visibleNodes = useMemo(() => {
    const map = new Map(nodes.map((n) => [n.id, n]));
    const isVisible = (id: string): boolean => {
      let parent = map.get(id)?.parent;
      while (parent) {
        const pn = map.get(parent);
        if (!pn) break;
        if (pn.collapsed) return false;
        parent = pn.parent;
      }
      return true;
    };
    return nodes.filter((n) => isVisible(n.id));
  }, [nodes]);

  const hasChildren = (id: string): boolean => nodes.some((n) => n.parent === id);

  const pos = useMemo(() => layout(visibleNodes, layoutMode), [visibleNodes, layoutMode]);
  const bb = useMemo(() => bounds(visibleNodes, pos), [visibleNodes, pos]);

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
      const cur = mapNode(editing);
      if (cur && t && t !== cur.text) {
        commit(nodes.map((n) => (n.id === editing ? { ...n, text: t } : n)));
      }
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

  // 设置/清除选中节点的图标（走 commit 记录历史；iconId 为空表示清除）
  const setNodeIcon = (iconId: string) => {
    if (!selected) return;
    commit(
      nodes.map((n) => {
        if (n.id !== selected) return n;
        if (!iconId) {
          const c = { ...n };
          delete c.icon;
          return c;
        }
        return { ...n, icon: iconId };
      }),
    );
  };

  // 设置/删除节点备注（走 commit 记录历史；note 为空表示删除备注）
  const setNodeNote = (id: string, note: string) => {
    commit(
      nodes.map((n) => {
        if (n.id !== id) return n;
        if (!note) {
          const c = { ...n };
          delete c.note;
          return c;
        }
        return { ...n, note };
      }),
    );
  };

  const openNote = (id: string) => {
    setNoteTarget(id);
    setNoteDraft(mapNode(id)?.note || "");
  };

  const toggleCollapse = (id: string) => {
    // 视图态，不记录历史
    setNodes(nodes.map((n) => (n.id === id ? { ...n, collapsed: !n.collapsed } : n)));
    onChange(JSON.stringify({ nodes: nodes.map((n) => (n.id === id ? { ...n, collapsed: !n.collapsed } : n)) }));
  };

  const collapseAll = () => {
    const next = nodes.map((n) => (hasChildren(n.id) ? { ...n, collapsed: true } : n));
    setNodes(next);
    onChange(JSON.stringify({ nodes: next }));
  };

  const expandAll = () => {
    const next = nodes.map((n) => (n.collapsed ? { ...n, collapsed: false } : n));
    setNodes(next);
    onChange(JSON.stringify({ nodes: next }));
  };

  // —— 拖拽重排：判断 target 是否为 node 的子孙 ——
  const isDescendant = (ancestorId: string, nodeId: string): boolean => {
    const map = new Map(nodes.map((n) => [n.id, n]));
    let cur: string | null = nodeId;
    while (cur) {
      const n = map.get(cur);
      if (!n) return false;
      if (n.parent === ancestorId) return true;
      cur = n.parent;
    }
    return false;
  };

  const moveNode = (id: string, newParent: string) => {
    const node = mapNode(id);
    if (!node) return;
    if (newParent === id || node.parent === newParent) return;
    if (isDescendant(id, newParent)) return; // 避免环
    commit(nodes.map((n) => (n.id === id ? { ...n, parent: newParent } : n)));
    setSelected(id);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) {
      e.preventDefault();
      undo();
      return;
    }
    if (mod && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) {
      e.preventDefault();
      redo();
      return;
    }
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
    if (t.closest(".note-bubble")) return; // 气泡内部交互不触发画布逻辑
    const nodeEl = t.closest(".mind-node") as HTMLElement | null;
    if (nodeEl && nodeEl.dataset.id) {
      setNoteTarget(null);
      nodeDragRef.current = { id: nodeEl.dataset.id, startX: e.clientX, startY: e.clientY };
    } else {
      setNoteTarget(null);
      canvasDragRef.current = { startX: e.clientX, startY: e.clientY, vx: v.x, vy: v.y };
    }
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (canvasDragRef.current) {
      setView({
        ...v,
        x: canvasDragRef.current.vx + (e.clientX - canvasDragRef.current.startX),
        y: canvasDragRef.current.vy + (e.clientY - canvasDragRef.current.startY),
      });
    } else if (nodeDragRef.current) {
      const dx = e.clientX - nodeDragRef.current.startX;
      const dy = e.clientY - nodeDragRef.current.startY;
      if (!dragNode && Math.hypot(dx, dy) > 5) {
        const rect = containerRef.current?.getBoundingClientRect();
        setDragNode({
          id: nodeDragRef.current.id,
          x: e.clientX - (rect?.left ?? 0),
          y: e.clientY - (rect?.top ?? 0),
        });
      }
      if (dragNode) {
        const rect = containerRef.current?.getBoundingClientRect();
        setDragNode({
          ...dragNode,
          x: e.clientX - (rect?.left ?? 0),
          y: e.clientY - (rect?.top ?? 0),
        });
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (dragNode) {
      const targetEl = document.elementFromPoint(e.clientX, e.clientY);
      const targetNodeEl = targetEl?.closest(".mind-node") as HTMLElement | null;
      const targetId = targetNodeEl?.dataset.id;
      if (targetId && targetId !== dragNode.id) {
        moveNode(dragNode.id, targetId);
      }
      setDragNode(null);
      nodeDragRef.current = null;
    } else if (nodeDragRef.current) {
      nodeDragRef.current = null;
    }
    canvasDragRef.current = null;
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

  const exportPng = async () => {
    const el = containerRef.current;
    if (!el) return;
    setExporting(true);
    const prev = view;
    const b = bounds(visibleNodes, pos);
    const cw = el.clientWidth || 800;
    const ch = el.clientHeight || 500;
    const kk = Math.min(1, Math.min(cw / (b.maxX - b.minX + 80), ch / (b.maxY - b.minY + 80)));
    const fit = {
      x: (cw - (b.maxX - b.minX) * kk) / 2 - b.minX * kk,
      y: (ch - (b.maxY - b.minY) * kk) / 2 - b.minY * kk,
      k: kk,
    };
    setView(fit);
    await new Promise((r) => setTimeout(r, 150));
    try {
      const bg = getComputedStyle(document.body).backgroundColor || "#ffffff";
      const dataUrl = await toPng(el, { backgroundColor: bg, pixelRatio: 2 });
      const a = document.createElement("a");
      a.download = "思维导图.png";
      a.href = dataUrl;
      a.click();
    } catch (err) {
      alert(`导出失败：${err instanceof Error ? err.message : "未知错误"}`);
    } finally {
      setView(prev);
      setExporting(false);
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
    return themePalette[depth % themePalette.length];
  };

  const isRoot = (id: string) => !mapNode(id)?.parent;

  const toolBtn = (active: boolean) =>
    `flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors ${
      active ? "bg-accent-soft text-accent" : "text-text hover:bg-hover"
    } disabled:opacity-40 disabled:cursor-not-allowed`;

  const canUndo = past.length > 0;
  const canRedo = future.length > 0;

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

        {/* 撤销/重做 */}
        <button onClick={undo} disabled={!canUndo} className={toolBtn(false)} title="撤销 (Ctrl+Z)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-15-6.7L3 13" /></svg>
          撤销
        </button>
        <button onClick={redo} disabled={!canRedo} className={toolBtn(false)} title="重做 (Ctrl+Y)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 7v6h-6" /><path d="M3 17a9 9 0 0 1 15-6.7L21 13" /></svg>
          重做
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

        {/* 节点图标 */}
        <div className="relative shrink-0">
          <button
            onClick={() => { if (!selected) return; setIconOpen((o) => !o); }}
            disabled={!selected}
            className={toolBtn(false)}
            title="设置节点图标"
          >
            <Glyph iconId="star" size={14} />
            图标
          </button>
          {iconOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setIconOpen(false)} />
              <div className="menu-panel absolute left-0 top-full z-40 mt-1 w-[280px] p-2">
                <div className="mb-1 flex items-center justify-between px-0.5">
                  <span className="text-[12px] text-faint">选择图标</span>
                  <button
                    onClick={() => { setNodeIcon(""); setIconOpen(false); }}
                    className="text-[12px] text-muted hover:text-text"
                  >
                    清除
                  </button>
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {ICONS.map((ic) => (
                    <button
                      key={ic.id}
                      title={ic.label}
                      onClick={() => { setNodeIcon(ic.id); setIconOpen(false); }}
                      className="grid place-items-center rounded-md p-1.5 transition-colors hover:bg-hover"
                    >
                      <Glyph iconId={ic.id} size={18} />
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        <span className="mx-1 h-4 w-px bg-line" />

        {/* 布局切换 */}
        <button onClick={() => { setLayoutMode("logic"); setView(null); }} className={toolBtn(layoutMode === "logic")} title="逻辑图（左到右）">
          逻辑图
        </button>
        <button onClick={() => { setLayoutMode("org"); setView(null); }} className={toolBtn(layoutMode === "org")} title="组织结构图（上到下）">
          组织结构图
        </button>
        <button onClick={() => { setLayoutMode("timeline"); setView(null); }} className={toolBtn(layoutMode === "timeline")} title="时间轴（左到右）">
          时间轴
        </button>
        <button onClick={() => { setLayoutMode("fishbone"); setView(null); }} className={toolBtn(layoutMode === "fishbone")} title="鱼骨图（因果分析图）">
          鱼骨图
        </button>
        <button onClick={() => { setLayoutMode("tree"); setView(null); }} className={toolBtn(layoutMode === "tree")} title="树形图（向下分类树）">
          树形图
        </button>

        <span className="mx-1 h-4 w-px bg-line" />

        {/* 折叠 */}
        <button onClick={expandAll} className={toolBtn(false)} title="展开全部节点">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 9h16M4 15h16M9 4v16" /></svg>
          展开
        </button>
        <button onClick={collapseAll} className={toolBtn(false)} title="折叠全部节点">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 9h16M4 15h16M12 4v16" /></svg>
          折叠
        </button>

        <span className="mx-1 h-4 w-px bg-line" />

        {/* 主题配色 */}
        <div className="relative shrink-0">
          <button onClick={() => setThemeOpen((v) => !v)} className={toolBtn(false)} title="主题配色">
            <span className="h-3.5 w-3.5 rounded-full" style={{ background: `linear-gradient(135deg, ${themePalette[0]}, ${themePalette[2]})` }} />
            主题
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className={`transition-transform ${themeOpen ? "rotate-180" : ""}`}>
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          {themeOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setThemeOpen(false)} />
              <div className="menu-panel absolute left-0 top-full z-40 mt-1 w-40 p-1.5">
                {THEMES.map((t) => (
                  <button
                    key={t.name}
                    onClick={() => {
                      setThemePalette(t.palette);
                      setThemeOpen(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] text-text transition-colors hover:bg-hover"
                  >
                    <span className="flex gap-0.5">
                      {t.palette.slice(0, 4).map((c) => (
                        <span key={c} className="h-3 w-3 rounded-full" style={{ backgroundColor: c }} />
                      ))}
                    </span>
                    {t.name}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <span className="mx-auto" />

        <span className="hidden text-[11px] text-faint lg:inline">
          Tab 子主题 · Enter 同级 · Delete 删除 · 双击编辑 · 拖拽重排
        </span>

        <button onClick={exportPng} disabled={exporting} className="rounded-md px-2.5 py-1.5 text-[13px] text-text transition-colors hover:bg-hover disabled:opacity-50" title="导出 PNG 图片">
          {exporting ? "导出中…" : "导出 PNG"}
        </button>
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
        style={{ touchAction: "none", height: "60vh", minHeight: 400, position: "relative" }}
      >
        <svg width="100%" height="100%">
          <g transform={`translate(${v.x},${v.y}) scale(${v.k})`}>
            {/* 连线（按布局区分线型） */}
            {visibleNodes.map((n) => {
              if (!n.parent) return null;
              const p = pos[n.parent];
              const c = pos[n.id];
              if (!p || !c) return null;

              // 鱼骨图：斜直线（从主干锚点或父节点中心到子节点中心）
              if (layoutMode === "fishbone") {
                const ax = c.anchorX ?? p.x + p.w / 2;
                const ay = c.anchorY ?? p.y + NODE_H / 2;
                const bx = c.x + c.w / 2;
                const by = c.y + NODE_H / 2;
                const d = `M ${ax} ${ay} L ${bx} ${by}`;
                return <path key={`e-${n.id}`} d={d} fill="none" stroke="var(--line-strong)" strokeWidth={1.5} />;
              }

              // 树形图：直角折线（父下边中点 → 竖直 → 水平 → 子上边中点）
              if (layoutMode === "tree") {
                const sx = p.x + p.w / 2;
                const sy = p.y + NODE_H;
                const ex = c.x + c.w / 2;
                const ey = c.y;
                const my = (sy + ey) / 2;
                const d = `M ${sx} ${sy} V ${my} H ${ex} V ${ey}`;
                return <path key={`e-${n.id}`} d={d} fill="none" stroke="var(--line-strong)" strokeWidth={1.5} />;
              }

              // logic / org / timeline：贝塞尔曲线
              // logic 用水平贝塞尔；org 与 timeline 二级用垂直贝塞尔
              const vertical = c.y > p.y + NODE_H - 1;
              let d = "";
              if (vertical) {
                const sx = p.x + p.w / 2;
                const sy = p.y + NODE_H;
                const ex = c.x + c.w / 2;
                const ey = c.y;
                const my = (sy + ey) / 2;
                d = `M ${sx} ${sy} C ${sx} ${my}, ${ex} ${my}, ${ex} ${ey}`;
              } else {
                const sx = p.x + p.w;
                const sy = p.y + NODE_H / 2;
                const ex = c.x;
                const ey = c.y + NODE_H / 2;
                const mx = (sx + ex) / 2;
                d = `M ${sx} ${sy} C ${mx} ${sy}, ${mx} ${ey}, ${ex} ${ey}`;
              }
              return <path key={`e-${n.id}`} d={d} fill="none" stroke="var(--line-strong)" strokeWidth={1.5} />;
            })}

            {/* 鱼骨图主干（鱼脊）：从 x=0 到鱼头处 */}
            {layoutMode === "fishbone" &&
              (() => {
                let spineEndX = 0;
                for (const it of Object.values(pos)) if (it.spineEndX) spineEndX = Math.max(spineEndX, it.spineEndX);
                return (
                  <line x1={0} y1={0} x2={spineEndX} y2={0} stroke="var(--line-strong)" strokeWidth={3} strokeLinecap="round" />
                );
              })()}
            {/* 节点 */}
            {visibleNodes.map((n) => {
              const p = pos[n.id];
              if (!p) return null;
              const color = isRoot(n.id) ? "var(--accent)" : levelColor(n.id);
              const sel = selected === n.id;
              return (
                <g
                  key={n.id}
                  className="mind-node"
                  data-id={n.id}
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
                  {/* 节点图标（位于文字左侧，文字相应右移） */}
                  {n.icon && (
                    <Glyph
                      iconId={n.icon}
                      x={8}
                      y={NODE_H / 2 - ICON_SIZE / 2}
                      size={ICON_SIZE}
                      color={isRoot(n.id) ? "#fff" : color}
                    />
                  )}
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
                      x={n.icon ? ICON_PAD : p.w / 2}
                      y={NODE_H / 2}
                      textAnchor={n.icon ? "start" : "middle"}
                      dominantBaseline="central"
                      fontSize={14}
                      fill={isRoot(n.id) ? "#fff" : "var(--text)"}
                      style={{ userSelect: "none" }}
                    >
                      {n.text.length > 14 ? n.text.slice(0, 14) + "…" : n.text}
                    </text>
                  )}
                  {/* 备注标记（右上角小圆点，点击打开备注气泡） */}
                  {n.note && !editing && (
                    <g
                      onClick={(e) => {
                        e.stopPropagation();
                        openNote(n.id);
                      }}
                      style={{ cursor: "pointer" }}
                    >
                      <title>备注</title>
                      <circle cx={p.w - 8} cy={8} r={5} fill="var(--accent)" />
                      <circle cx={p.w - 8} cy={8} r={2} fill="#fff" />
                    </g>
                  )}
                </g>
              );
            })}
          </g>

          {/* 折叠指示器（在变换组外，用世界坐标绘制，随 g 变换）—— 放到 g 内更简单，这里单独画在 g 内 */}
          <g transform={`translate(${v.x},${v.y}) scale(${v.k})`}>
            {visibleNodes.map((n) => {
              const p = pos[n.id];
              if (!p) return null;
              const hasKids = hasChildren(n.id);
              if (!hasKids) return null;
              const folded = !!n.collapsed;
              const isLogic = layoutMode === "logic";
              const cx = isLogic ? p.x + p.w + 10 : p.x + p.w / 2;
              const cy = isLogic ? p.y + NODE_H / 2 : p.y + NODE_H + 10;
              return (
                <g
                  key={`fold-${n.id}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleCollapse(n.id);
                  }}
                  style={{ cursor: "pointer" }}
                >
                  <circle cx={cx} cy={cy} r={9} fill="var(--background)" stroke="var(--line-strong)" strokeWidth={1.5} />
                  <path
                    d={folded ? `M ${cx - 3.5} ${cy} H ${cx + 3.5}` : `M ${cx - 3.5} ${cy} H ${cx + 3.5} M ${cx} ${cy - 3.5} V ${cy + 3.5}`}
                    stroke="var(--text)"
                    strokeWidth={1.5}
                    strokeLinecap="round"
                  />
                </g>
              );
            })}
          </g>

          {/* 拖拽 ghost（屏幕坐标，不随缩放） */}
          {dragNode && (() => {
            const node = mapNode(dragNode.id);
            if (!node) return null;
            const w = nodeWidth(node.text, node.icon);
            const color = isRoot(node.id) ? "var(--accent)" : levelColor(node.id);
            const left = dragNode.x - w / 2;
            return (
              <g pointerEvents="none" opacity={0.85}>
                <rect
                  x={left}
                  y={dragNode.y - NODE_H / 2}
                  width={w}
                  height={NODE_H}
                  rx={8}
                  fill="var(--accent-soft)"
                  stroke="var(--accent)"
                  strokeWidth={2}
                />
                {node.icon && (
                  <Glyph
                    iconId={node.icon}
                    x={left + 8}
                    y={dragNode.y - ICON_SIZE / 2}
                    size={ICON_SIZE}
                    color={color}
                  />
                )}
                <text
                  x={node.icon ? left + ICON_PAD : dragNode.x}
                  y={dragNode.y}
                  textAnchor={node.icon ? "start" : "middle"}
                  dominantBaseline="central"
                  fontSize={14}
                  fill="var(--text)"
                  style={{ userSelect: "none" }}
                >
                  {node.text.length > 14 ? node.text.slice(0, 14) + "…" : node.text}
                </text>
              </g>
            );
          })()}
        </svg>

        {/* 备注气泡：HTML 绝对定位，屏幕坐标 = 世界坐标 * k + v */}
        {noteTarget && (() => {
          const np = pos[noteTarget];
          const node = mapNode(noteTarget);
          if (!np || !node) return null;
          const sx = np.x * v.k + v.x;
          const sy = np.y * v.k + v.y;
          const cw = containerRef.current?.clientWidth ?? 800;
          const bw = 280;
          let bx = sx + np.w * v.k + 10;
          if (bx + bw > cw - 8) bx = Math.max(8, sx - bw - 10);
          return (
            <div
              className="note-bubble menu-panel"
              style={{ position: "absolute", left: bx, top: sy, width: bw, zIndex: 50 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
                <span className="text-[12px] font-medium text-text">备注</span>
                <button
                  onClick={() => setNoteTarget(null)}
                  className="text-[13px] leading-none text-faint hover:text-text"
                  title="关闭"
                >
                  ✕
                </button>
              </div>
              <div className="px-3 py-2">
                {node.note ? (
                  <div
                    className="note-preview mb-2 max-h-40 overflow-auto text-[13px] text-text"
                    style={{ whiteSpace: "pre-wrap" }}
                  >
                    {node.note}
                  </div>
                ) : (
                  <div className="mb-2 text-[12px] text-faint">暂无备注</div>
                )}
                <textarea
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  placeholder="输入备注（支持换行）…"
                  rows={3}
                  className="w-full resize-none rounded-md border border-line bg-surface px-2 py-1.5 text-[13px] text-text outline-none focus:border-accent"
                />
                <div className="mt-2 flex justify-end gap-2">
                  <button
                    onClick={() => {
                      setNodeNote(noteTarget, noteDraft.trim());
                      setNoteTarget(null);
                    }}
                    className="rounded-md bg-accent px-2.5 py-1 text-[12px] font-medium text-white hover:opacity-90"
                  >
                    保存
                  </button>
                  <button
                    onClick={() => {
                      setNodeNote(noteTarget, "");
                      setNoteTarget(null);
                    }}
                    className="rounded-md px-2.5 py-1 text-[12px] text-danger hover:bg-danger-soft"
                  >
                    删除
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
