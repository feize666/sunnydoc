"use client";

import { useState } from "react";
import { Tooltip } from "./Tooltip";

/** 解析表格 JSON（二维数组），非法/空则返回默认 3x3 空表。 */
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

/** 电子表格编辑器（所见即所得，数据存 JSON 二维数组）。 */
export function TableEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (json: string) => void;
}) {
  const [data, setData] = useState<string[][]>(() => parseData(value));

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

  const cols = data[0]?.length ?? 0;

  return (
    <div className="flex min-h-[calc(100vh-300px)] flex-col rounded-lg border border-line bg-background">
      {/* 工具栏 */}
      <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
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
        <span className="text-[11px] text-faint">
          {data.length} 行 × {cols} 列
        </span>
      </div>

      {/* 表格 */}
      <div className="flex-1 overflow-auto p-3">
        <table className="border-collapse">
          <tbody>
            {data.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c} className="group/td relative border border-line p-0">
                    <input
                      value={cell}
                      onChange={(e) => setCell(r, c, e.target.value)}
                      className="h-9 w-32 bg-transparent px-2 text-[13px] text-text outline-none focus:bg-accent-soft/40"
                      placeholder=""
                    />
                  </td>
                ))}
                <td className="w-8 border-0 align-middle">
                  <button
                    onClick={() => removeRow(r)}
                    className="grid h-6 w-6 place-items-center rounded text-faint opacity-0 transition-opacity hover:bg-danger-soft hover:text-danger group-hover/tr:opacity-100"
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
                    className="grid h-6 w-full place-items-center rounded text-faint opacity-0 transition-opacity hover:bg-danger-soft hover:text-danger"
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
