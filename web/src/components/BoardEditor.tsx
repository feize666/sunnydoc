"use client";

import { useState, useRef, useEffect, useCallback } from "react";

type Shape =
  | { type: "pen"; points: [number, number][]; color: string; width: number }
  | { type: "line"; x1: number; y1: number; x2: number; y2: number; color: string; width: number }
  | { type: "rect"; x: number; y: number; w: number; h: number; color: string; width: number }
  | { type: "ellipse"; x: number; y: number; w: number; h: number; color: string; width: number }
  | { type: "text"; x: number; y: number; content: string; color: string; size: number };

function parseShapes(value: string): Shape[] {
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed as Shape[];
  } catch {
    /* fallthrough */
  }
  return [];
}

const TOOLS = [
  { id: "pen", label: "画笔" },
  { id: "line", label: "直线" },
  { id: "rect", label: "矩形" },
  { id: "ellipse", label: "椭圆" },
  { id: "text", label: "文本" },
  { id: "erase", label: "橡皮" },
] as const;

type Tool = (typeof TOOLS)[number]["id"];

const COLORS = ["#111827", "#ef4444", "#f97316", "#22c55e", "#3b82f6", "#a855f7"];

export function BoardEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (json: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [shapes, setShapes] = useState<Shape[]>(() => parseShapes(value));
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState("#111827");
  const [width, setWidth] = useState(3);
  const draftRef = useRef<Shape | null>(null);
  const startRef = useRef<[number, number] | null>(null);

  const commit = useCallback(
    (next: Shape[]) => {
      setShapes(next);
      onChange(JSON.stringify(next));
    },
    [onChange],
  );

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const draw = (s: Shape) => {
      if (s.type === "pen") {
        if (s.points.length < 2) return;
        ctx.strokeStyle = s.color;
        ctx.lineWidth = s.width;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(s.points[0][0], s.points[0][1]);
        for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i][0], s.points[i][1]);
        ctx.stroke();
      } else if (s.type === "line") {
        ctx.strokeStyle = s.color;
        ctx.lineWidth = s.width;
        ctx.beginPath();
        ctx.moveTo(s.x1, s.y1);
        ctx.lineTo(s.x2, s.y2);
        ctx.stroke();
      } else if (s.type === "rect") {
        ctx.strokeStyle = s.color;
        ctx.lineWidth = s.width;
        ctx.strokeRect(s.x, s.y, s.w, s.h);
      } else if (s.type === "ellipse") {
        ctx.strokeStyle = s.color;
        ctx.lineWidth = s.width;
        ctx.beginPath();
        ctx.ellipse(s.x + s.w / 2, s.y + s.h / 2, Math.abs(s.w) / 2, Math.abs(s.h) / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else if (s.type === "text") {
        ctx.fillStyle = s.color;
        ctx.font = `${s.size}px sans-serif`;
        ctx.fillText(s.content, s.x, s.y);
      }
    };

    for (const s of shapes) draw(s);
    if (draftRef.current) draw(draftRef.current);
  }, [shapes]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  useEffect(() => {
    const onResize = () => redraw();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [redraw]);

  const getPos = (e: React.MouseEvent): [number, number] => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  };

  const onMouseDown = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const [x, y] = getPos(e);

    if (tool === "text") {
      const content = window.prompt("输入文本", "");
      if (content == null || content === "") return;
      commit([...shapes, { type: "text", x, y, content, color, size: width * 8 }]);
      return;
    }

    startRef.current = [x, y];
    if (tool === "pen" || tool === "erase") {
      draftRef.current = { type: "pen", points: [[x, y]], color: tool === "erase" ? "#ffffff" : color, width: tool === "erase" ? 24 : width };
    } else {
      draftRef.current = { type: tool, x1: x, y1: y, x2: x, y2: y, color, width } as Shape;
    }
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!startRef.current || !draftRef.current) return;
    const [x, y] = getPos(e);
    if (draftRef.current.type === "pen") {
      (draftRef.current as { points: [number, number][] }).points.push([x, y]);
    } else if (draftRef.current.type === "line") {
      draftRef.current = { ...draftRef.current, x2: x, y2: y } as Shape;
    } else if (draftRef.current.type === "rect" || draftRef.current.type === "ellipse") {
      const [sx, sy] = startRef.current;
      draftRef.current = {
        ...draftRef.current,
        x: Math.min(sx, x),
        y: Math.min(sy, y),
        w: Math.abs(x - sx),
        h: Math.abs(y - sy),
      } as Shape;
    }
    redraw();
  };

  const onMouseUp = () => {
    if (draftRef.current && startRef.current) {
      commit([...shapes, draftRef.current]);
    }
    draftRef.current = null;
    startRef.current = null;
    redraw();
  };

  const undo = () => {
    if (shapes.length === 0) return;
    commit(shapes.slice(0, -1));
  };

  const clear = () => {
    if (shapes.length === 0) return;
    commit([]);
  };

  return (
    <div className="flex min-h-[calc(100vh-300px)] flex-col rounded-lg border border-line bg-background">
      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-1 border-b border-line px-2 py-1.5">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTool(t.id)}
            className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
              tool === t.id ? "bg-accent text-white" : "text-muted hover:bg-hover hover:text-text"
            }`}
          >
            {t.label}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-line" />
        {COLORS.map((c) => (
          <button
            key={c}
            onClick={() => setColor(c)}
            className={`h-5 w-5 rounded-full border border-black/10 transition-transform hover:scale-110 ${
              color === c ? "ring-2 ring-accent ring-offset-1" : ""
            }`}
            style={{ backgroundColor: c }}
            title={c}
          />
        ))}
        <span className="mx-1 h-4 w-px bg-line" />
        <input
          type="range"
          min={1}
          max={12}
          value={width}
          onChange={(e) => setWidth(Number(e.target.value))}
          className="w-20"
          title="线宽"
        />
        <span className="ml-auto flex items-center gap-1">
          <button onClick={undo} className="rounded-md px-2 py-1 text-xs text-muted transition-colors hover:bg-hover hover:text-text">
            撤销
          </button>
          <button onClick={clear} className="rounded-md px-2 py-1 text-xs text-danger transition-colors hover:bg-danger-soft">
            清空
          </button>
        </span>
      </div>

      <canvas
        ref={canvasRef}
        className="flex-1 w-full cursor-crosshair"
        style={{ touchAction: "none" }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      />
    </div>
  );
}
