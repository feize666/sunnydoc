"use client";

import { useState, useMemo, useRef } from "react";
import { Tooltip } from "./Tooltip";

function parseData(value: string): string[][] {
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.every((r) => Array.isArray(r))) {
      const rows = parsed as string[][];
      return rows.length > 0 ? rows : [["", "", ""], ["", "", ""]];
    }
  } catch {
    /* fallthrough */
  }
  return [["", "", ""], ["", "", ""]];
}

function colLetter(i: number): string {
  let s = "";
  let n = i;
  while (n >= 0) {
    s = String.fromCharCode((n % 26) + 65) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

function parseRef(ref: string): [number, number] | null {
  const m = /^([A-Z]+)(\d+)$/.exec(ref.trim().toUpperCase());
  if (!m) return null;
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return [parseInt(m[2], 10) - 1, col - 1];
}

/** 计算以 = 开头的简单公式（=SUM/=AVG/=MIN/=MAX，范围如 A1:B2）。 */
function evalFormula(expr: string, data: string[][]): string {
  const e = expr.trim();
  const m = /^=(SUM|AVG|MIN|MAX)\(([A-Z]+\d+):([A-Z]+\d+)\)$/i.exec(e);
  if (!m) return expr;
  const fn = m[1].toUpperCase();
  const a = parseRef(m[2]);
  const b = parseRef(m[3]);
  if (!a || !b) return expr;
  const [r1, c1] = a;
  const [r2, c2] = b;
  const vals: number[] = [];
  for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) {
    for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) {
      const v = parseFloat((data[r]?.[c] ?? "").trim());
      if (!Number.isNaN(v)) vals.push(v);
    }
  }
  if (vals.length === 0) return "0";
  if (fn === "SUM") return String(vals.reduce((s, v) => s + v, 0));
  if (fn === "AVG") return String(vals.reduce((s, v) => s + v, 0) / vals.length);
  if (fn === "MIN") return String(Math.min(...vals));
  return String(Math.max(...vals));
}

type Sel = { r1: number; c1: number; r2: number; c2: number } | null;

export function TableEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (json: string) => void;
}) {
  const [data, setData] = useState<string[][]>(() => parseData(value));
  // 合并单元格：key = "r,c"，值为被合并（跳过渲染）的单元格
  const [merged, setMerged] = useState<Set<string>>(() => new Set());
  const [sel, setSel] = useState<Sel>(null);
  const selStart = useRef<[number, number] | null>(null);

  const commit = (next: string[][]) => {
    setData(next);
    onChange(JSON.stringify(next));
  };

  const setCell = (r: number, c: number, v: string) => {
    const next = data.map((row) => [...row]);
    next[r][c] = v;
    commit(next);
  };

  const addRow = () => {
    const cols = data[0]?.length ?? 2;
    commit([...data, Array.from({ length: cols }, () => "")]);
  };

  const addCol = () => {
    commit(data.map((row) => [...row, ""]));
  };

  const removeRow = (r: number) => {
    if (data.length <= 1) return;
    commit(data.filter((_, i) => i !== r));
  };

  const removeCol = (c: number) => {
    if ((data[0]?.length ?? 0) <= 1) return;
    commit(data.map((row) => row.filter((_, i) => i !== c)));
  };

  const mergeSelection = () => {
    if (!sel) return;
    const { r1, c1, r2, c2 } = sel;
    const rmin = Math.min(r1, r2);
    const rmax = Math.max(r1, r2);
    const cmin = Math.min(c1, c2);
    const cmax = Math.max(c1, c2);
    if (rmax - rmin < 1 && cmax - cmin < 1) return; // 单格不合并
    const nextMerged = new Set(merged);
    for (let r = rmin; r <= rmax; r++) {
      for (let c = cmin; c <= cmax; c++) {
        if (r === rmin && c === cmin) continue;
        nextMerged.add(`${r},${c}`);
      }
    }
    setMerged(nextMerged);
    setSel(null);
  };

  const unmerge = () => {
    setMerged(new Set());
  };

  const cols = data[0]?.length ?? 0;
  const mergedSet = useMemo(() => merged, [merged]);

  const displayValue = (r: number, c: number): string => {
    const raw = data[r]?.[c] ?? "";
    return raw.startsWith("=") ? evalFormula(raw, data) : raw;
  };

  const cellDown = (r: number, c: number) => {
    selStart.current = [r, c];
    setSel({ r1: r, c1: c, r2: r, c2: c });
  };

  const cellEnter = (r: number, c: number) => {
    if (!selStart.current) return;
    const [sr, sc] = selStart.current;
    setSel({ r1: sr, c1: sc, r2: r, c2: c });
  };

  const inSel = (r: number, c: number): boolean => {
    if (!sel) return false;
    const rmin = Math.min(sel.r1, sel.r2);
    const rmax = Math.max(sel.r1, sel.r2);
    const cmin = Math.min(sel.c1, sel.c2);
    const cmax = Math.max(sel.c1, sel.c2);
    return r >= rmin && r <= rmax && c >= cmin && c <= cmax;
  };

  return (
    <div className="flex min-h-[calc(100vh-300px)] flex-col rounded-lg border border-line bg-background">
      <div className="flex flex-wrap items-center gap-1 border-b border-line px-2 py-1.5">
        <Tooltip content="添加行">
          <button onClick={addRow} className="grid h-8 w-8 place-items-center rounded-md text-muted transition-colors hover:bg-hover hover:text-text">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
          </button>
        </Tooltip>
        <Tooltip content="添加列">
          <button onClick={addCol} className="grid h-8 w-8 place-items-center rounded-md text-muted transition-colors hover:bg-hover hover:text-text">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
          </button>
        </Tooltip>
        <span className="mx-1 h-4 w-px bg-line" />
        <Tooltip content="合并选中单元格">
          <button onClick={mergeSelection} disabled={!sel} className="rounded-md px-2 py-1 text-xs text-muted transition-colors hover:bg-hover hover:text-text disabled:opacity-40">
            合并
          </button>
        </Tooltip>
        <Tooltip content="取消所有合并">
          <button onClick={unmerge} className="rounded-md px-2 py-1 text-xs text-muted transition-colors hover:bg-hover hover:text-text">
            取消合并
          </button>
        </Tooltip>
        <span className="mx-1 h-4 w-px bg-line" />
        <span className="text-[12px] text-faint">
          {data.length} 行 × {cols} 列 · 公式 =SUM(A1:B2)
        </span>
      </div>

      <div className="flex-1 overflow-auto p-3">
        <table className="border-collapse" onMouseUp={() => { selStart.current = null; }}>
          <thead>
            <tr>
              {Array.from({ length: cols }, (_, c) => (
                <th key={c} className="sticky top-0 z-10 border border-line bg-surface">
                  <div className="px-2 py-1 text-[12px] font-medium text-muted">{colLetter(c)}</div>
                </th>
              ))}
              <th className="sticky top-0 z-10 border-0 bg-surface" />
            </tr>
          </thead>
          <tbody>
            {data.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => {
                  if (mergedSet.has(`${r},${c}`)) return null;
                  const raw = cell;
                  const disp = displayValue(r, c);
                  return (
                    <td
                      key={c}
                      onMouseDown={() => cellDown(r, c)}
                      onMouseEnter={() => cellEnter(r, c)}
                      className={`border border-line p-0 ${inSel(r, c) ? "bg-accent-soft/40" : ""}`}
                    >
                      <input
                        value={disp}
                        onChange={(e) => setCell(r, c, e.target.value)}
                        className={`h-9 w-32 bg-transparent px-2 text-[14px] outline-none focus:bg-accent-soft/40 ${raw.startsWith("=") ? "font-mono text-accent" : "text-text"}`}
                      />
                    </td>
                  );
                })}
                <td className="w-8 border-0">
                  <button
                    onClick={() => removeRow(r)}
                    className="grid h-6 w-6 place-items-center rounded text-faint opacity-0 transition-opacity hover:bg-danger-soft hover:text-danger"
                    title="删除行"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
                  </button>
                </td>
              </tr>
            ))}
            <tr>
              {Array.from({ length: cols }, (_, c) => (
                <td key={c} className="border border-line p-0">
                  <button
                    onClick={() => removeCol(c)}
                    className="grid h-6 w-full place-items-center rounded text-faint opacity-0 transition-colors hover:bg-danger-soft hover:text-danger"
                    title="删除列"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
                  </button>
                </td>
              ))}
              <td />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
