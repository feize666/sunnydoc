"use client";

import { useState } from "react";
import { Tooltip } from "./Tooltip";

interface DatasheetData {
  columns: string[];
  rows: string[][];
}

function parseData(value: string): DatasheetData {
  try {
    const parsed = JSON.parse(value);
    if (parsed && Array.isArray(parsed.columns) && Array.isArray(parsed.rows)) {
      return {
        columns: parsed.columns.length > 0 ? parsed.columns : ["字段 1", "字段 2"],
        rows: parsed.rows,
      };
    }
  } catch {
    /* fallthrough */
  }
  return {
    columns: ["字段 1", "字段 2"],
    rows: [["", ""], ["", ""]],
  };
}

/** 数据表（多维表格）编辑器：字段列 + 记录行。 */
export function DatasheetEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (json: string) => void;
}) {
  const [data, setData] = useState<DatasheetData>(() => parseData(value));

  const commit = (next: DatasheetData) => {
    setData(next);
    onChange(JSON.stringify(next));
  };

  const setColumn = (c: number, name: string) => {
    const columns = [...data.columns];
    columns[c] = name;
    commit({ ...data, columns });
  };

  const setCell = (r: number, c: number, v: string) => {
    const rows = data.rows.map((row) => [...row]);
    while (rows.length <= r) rows.push([]);
    while (rows[r].length <= c) rows[r].push("");
    rows[r][c] = v;
    commit({ ...data, rows });
  };

  const addColumn = () => {
    const columns = [...data.columns, `字段 ${data.columns.length + 1}`];
    const rows = data.rows.map((row) => [...row, ""]);
    commit({ columns, rows });
  };

  const addRow = () => {
    commit({ ...data, rows: [...data.rows, Array(data.columns.length).fill("")] });
  };

  const removeColumn = (c: number) => {
    if (data.columns.length <= 1) return;
    const columns = data.columns.filter((_, i) => i !== c);
    const rows = data.rows.map((row) => row.filter((_, i) => i !== c));
    commit({ columns, rows });
  };

  const removeRow = (r: number) => {
    if (data.rows.length <= 0) return;
    commit({ ...data, rows: data.rows.filter((_, i) => i !== r) });
  };

  return (
    <div className="flex min-h-[calc(100vh-300px)] flex-col rounded-lg border border-line bg-background">
      <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
        <Tooltip content="添加字段">
          <button onClick={addColumn} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted transition-colors hover:bg-hover hover:text-text">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            字段
          </button>
        </Tooltip>
        <Tooltip content="添加记录">
          <button onClick={addRow} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted transition-colors hover:bg-hover hover:text-text">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            记录
          </button>
        </Tooltip>
        <span className="ml-auto text-[11px] text-faint">
          {data.columns.length} 字段 × {data.rows.length} 记录
        </span>
      </div>

      <div className="flex-1 overflow-auto p-3">
        <table className="border-collapse">
          <thead>
            <tr>
              {data.columns.map((col, c) => (
                <th key={c} className="border border-line bg-surface p-0">
                  <input
                    value={col}
                    onChange={(e) => setColumn(c, e.target.value)}
                    className="h-9 w-36 bg-transparent px-2 text-[13px] font-semibold text-text outline-none focus:bg-accent-soft/40"
                  />
                </th>
              ))}
              <th className="w-8 border-0" />
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, r) => (
              <tr key={r}>
                {data.columns.map((_, c) => (
                  <td key={c} className="border border-line p-0">
                    <input
                      value={row[c] ?? ""}
                      onChange={(e) => setCell(r, c, e.target.value)}
                      className="h-9 w-36 bg-transparent px-2 text-[13px] text-text outline-none focus:bg-accent-soft/40"
                    />
                  </td>
                ))}
                <td className="w-8 border-0">
                  <button
                    onClick={() => removeRow(r)}
                    className="grid h-6 w-6 place-items-center rounded text-faint transition-colors hover:bg-danger-soft hover:text-danger"
                    title="删除记录"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
                  </button>
                </td>
              </tr>
            ))}
            <tr>
              {data.columns.map((_, c) => (
                <td key={c} className="border border-line p-0">
                  <button
                    onClick={() => removeColumn(c)}
                    className="grid h-6 w-full place-items-center rounded text-faint transition-colors hover:bg-danger-soft hover:text-danger"
                    title="删除字段"
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
