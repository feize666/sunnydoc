"use client";

import { useState, useMemo } from "react";
import { Tooltip } from "./Tooltip";

type FieldType = "text" | "number" | "date" | "select";

interface Column {
  name: string;
  type: FieldType;
}

interface DatasheetData {
  columns: Column[];
  rows: string[][];
}

const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: "text", label: "文本" },
  { value: "number", label: "数字" },
  { value: "date", label: "日期" },
  { value: "select", label: "单选" },
];

function parseData(value: string): DatasheetData {
  try {
    const parsed = JSON.parse(value);
    if (parsed && Array.isArray(parsed.columns) && Array.isArray(parsed.rows)) {
      const columns: Column[] = parsed.columns.map((c: string | Column) =>
        typeof c === "string" ? { name: c, type: "text" as FieldType } : { name: c.name, type: c.type ?? "text" }
      );
      return {
        columns: columns.length > 0 ? columns : [{ name: "字段 1", type: "text" }, { name: "字段 2", type: "text" }],
        rows: parsed.rows,
      };
    }
  } catch {
    /* fallthrough */
  }
  return {
    columns: [{ name: "字段 1", type: "text" }, { name: "字段 2", type: "text" }],
    rows: [["", ""], ["", ""]],
  };
}

export function DatasheetEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (json: string) => void;
}) {
  const [data, setData] = useState<DatasheetData>(() => parseData(value));
  const [filter, setFilter] = useState<Record<number, string>>({});

  const commit = (next: DatasheetData) => {
    setData(next);
    onChange(JSON.stringify(next));
  };

  const setColumnName = (c: number, name: string) => {
    const columns = [...data.columns];
    columns[c] = { ...columns[c], name };
    commit({ ...data, columns });
  };

  const setColumnType = (c: number, type: FieldType) => {
    const columns = [...data.columns];
    columns[c] = { ...columns[c], type };
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
    commit({
      columns: [...data.columns, { name: `字段 ${data.columns.length + 1}`, type: "text" }],
      rows: data.rows.map((row) => [...row, ""]),
    });
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

  const visibleRows = useMemo(() => {
    const keys = Object.keys(filter);
    if (keys.length === 0) return data.rows;
    return data.rows.filter((row) =>
      keys.every((k) => {
        const c = Number(k);
        const f = filter[c];
        return !f || (row[c] ?? "") === f;
      })
    );
  }, [data.rows, filter]);

  const columnValues = (c: number): string[] => {
    const set = new Set<string>();
    for (const row of data.rows) {
      const v = row[c] ?? "";
      if (v) set.add(v);
    }
    return Array.from(set);
  };

  const renderCell = (row: string[], c: number) => {
    const v = row[c] ?? "";
    const type = data.columns[c]?.type ?? "text";
    if (type === "number" && v) {
      return <span className="text-right text-[13px] text-text">{v}</span>;
    }
    if (type === "select" && v) {
      return <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[12px] text-muted">{v}</span>;
    }
    return <span className="text-[13px] text-text">{v}</span>;
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
          {data.columns.length} 字段 × {visibleRows.length}/{data.rows.length} 记录
        </span>
      </div>

      <div className="flex-1 overflow-auto p-3">
        <table className="border-collapse">
          <thead>
            <tr>
              {data.columns.map((col, c) => (
                <th key={c} className="sticky top-0 z-10 border border-line bg-surface p-0">
                  <div className="flex items-center gap-1">
                    <input
                      value={col.name}
                      onChange={(e) => setColumnName(c, e.target.value)}
                      className="h-8 min-w-0 flex-1 bg-transparent px-2 text-[13px] font-semibold text-text outline-none focus:bg-accent-soft/40"
                    />
                    <select
                      value={col.type}
                      onChange={(e) => setColumnType(c, e.target.value as FieldType)}
                      className="mr-1 rounded border border-line bg-background px-1 py-0.5 text-[11px] text-muted outline-none"
                      title="字段类型"
                    >
                      {FIELD_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="border-t border-line px-2 py-0.5">
                    <select
                      value={filter[c] ?? ""}
                      onChange={(e) => setFilter((prev) => ({ ...prev, [c]: e.target.value }))}
                      className="w-full bg-transparent text-[11px] text-faint outline-none"
                      title="筛选"
                    >
                      <option value="">全部</option>
                      {columnValues(c).map((v) => (
                        <option key={v} value={v}>{v}</option>
                      ))}
                    </select>
                  </div>
                </th>
              ))}
              <th className="sticky top-0 z-10 border-0 bg-surface" />
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, r) => (
              <tr key={r}>
                {data.columns.map((_, c) => (
                  <td key={c} className="border border-line p-0">
                    <input
                      value={row[c] ?? ""}
                      onChange={(e) => setCell(data.rows.indexOf(row), c, e.target.value)}
                      className={`h-9 w-36 bg-transparent px-2 text-[13px] outline-none focus:bg-accent-soft/40 ${
                        data.columns[c]?.type === "number" ? "text-right" : "text-text"
                      }`}
                    />
                  </td>
                ))}
                <td className="w-8 border-0">
                  <button
                    onClick={() => removeRow(data.rows.indexOf(row))}
                    className="grid h-6 w-6 place-items-center rounded text-faint opacity-0 transition-opacity hover:bg-danger-soft hover:text-danger"
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
                    className="grid h-6 w-full place-items-center rounded text-faint opacity-0 transition-colors hover:bg-danger-soft hover:text-danger"
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
