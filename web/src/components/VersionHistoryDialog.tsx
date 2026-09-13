"use client";

import { useState, useEffect, useCallback } from "react";
import { listDocVersions, rollbackDocument, type DocVersion } from "@/lib/api";
import { renderMarkdown } from "@/lib/markdown";
import { CloseIcon } from "./icons";

function formatTime(ts: number): string {
  const d = new Date(ts * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type DiffLine = { type: "same" | "add" | "del"; text: string };

/** 行级 LCS diff：返回 a→b 的变化（add=新增、del=删除、same=相同）。 */
function diffLines(a: string, b: string): DiffLine[] {
  const A = a.split("\n");
  const B = b.split("\n");
  const n = A.length;
  const m = B.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      result.push({ type: "same", text: A[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      result.push({ type: "del", text: A[i] });
      i++;
    } else {
      result.push({ type: "add", text: B[j] });
      j++;
    }
  }
  while (i < n) {
    result.push({ type: "del", text: A[i] });
    i++;
  }
  while (j < m) {
    result.push({ type: "add", text: B[j] });
    j++;
  }
  return result;
}

export function VersionHistoryDialog({
  open,
  docId,
  currentText,
  theme,
  onClose,
  onRolledBack,
}: {
  open: boolean;
  docId: string | null;
  currentText: string;
  theme: "light" | "dark";
  onClose: () => void;
  onRolledBack: () => void;
}) {
  const [versions, setVersions] = useState<DocVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [viewingHtml, setViewingHtml] = useState<string>("");
  const [diffId, setDiffId] = useState<string | null>(null);
  const [diffResult, setDiffResult] = useState<DiffLine[]>([]);

  const load = useCallback(async () => {
    if (!docId) return;
    setLoading(true);
    try {
      setVersions(await listDocVersions(docId));
    } catch {
      setVersions([]);
    } finally {
      setLoading(false);
    }
  }, [docId]);

  useEffect(() => {
    if (open) {
      setViewingId(null);
      setDiffId(null);
      load();
    }
  }, [open, load]);

  if (!open || !docId) return null;

  const rollback = async (versionId: string) => {
    if (!window.confirm("回滚到该版本？当前内容会先存为新版本，可再次恢复。")) return;
    setBusyId(versionId);
    try {
      await rollbackDocument(docId, versionId);
      onRolledBack();
      onClose();
    } catch (e) {
      alert(`回滚失败：${e instanceof Error ? e.message : "未知错误"}`);
    } finally {
      setBusyId(null);
    }
  };

  const view = async (v: DocVersion) => {
    if (viewingId === v.id) {
      setViewingId(null);
      return;
    }
    setViewingId(v.id);
    setDiffId(null);
    setViewingHtml(await renderMarkdown(v.text ?? "", undefined, theme));
  };

  const compare = (v: DocVersion) => {
    if (diffId === v.id) {
      setDiffId(null);
      return;
    }
    setDiffId(v.id);
    setViewingId(null);
    setDiffResult(diffLines(v.text ?? "", currentText ?? ""));
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog-panel flex max-h-[72vh] w-[720px] max-w-[94vw] flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div className="text-[15px] font-semibold text-text">版本历史</div>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-md text-faint transition-colors hover:bg-hover hover:text-text"
          >
            <CloseIcon size={15} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* 左侧：版本列表 */}
          <div className="w-[240px] shrink-0 overflow-y-auto border-r border-line px-2 py-2">
            {loading ? (
              <div className="px-3 py-8 text-center text-[14px] text-faint">加载中…</div>
            ) : versions.length === 0 ? (
              <div className="px-3 py-8 text-center text-[14px] text-faint">
                暂无历史版本
              </div>
            ) : (
              <ul>
                {versions.map((v) => (
                  <li key={v.id}>
                    <button
                      onClick={() => view(v)}
                      className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors ${
                        viewingId === v.id ? "bg-accent-soft" : "hover:bg-hover"
                      }`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] text-text">{v.title}</span>
                        <span className="block text-[11px] text-faint">{formatTime(v.created_at)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 右侧：内容 / 对比 */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center gap-2 border-b border-line px-4 py-2">
              <span className="text-[13px] font-medium text-text">
                {diffId ? "与当前内容对比" : viewingId ? "版本内容" : "选择左侧版本查看或对比"}
              </span>
              {viewingId && (
                <span className="ml-auto flex items-center gap-1">
                  <button
                    onClick={() => {
                      const v = versions.find((x) => x.id === viewingId);
                      if (v) compare(v);
                    }}
                    className="rounded-md border border-line px-2.5 py-1 text-[12px] text-muted transition-colors hover:border-accent/40 hover:text-accent"
                  >
                    对比当前
                  </button>
                  <button
                    onClick={() => rollback(viewingId)}
                    disabled={busyId === viewingId}
                    className="rounded-md border border-accent/40 px-2.5 py-1 text-[12px] text-accent transition-colors hover:bg-accent-soft disabled:opacity-50"
                  >
                    {busyId === viewingId ? "回滚中…" : "回滚此版本"}
                  </button>
                </span>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              {diffId ? (
                <div className="overflow-x-auto rounded-lg border border-line font-mono text-[12px] leading-relaxed">
                  <table className="w-full border-collapse">
                    <tbody>
                      {diffResult.map((line, i) => (
                        <tr key={i} className={line.type === "add" ? "bg-success-soft" : line.type === "del" ? "bg-danger-soft" : ""}>
                          <td className="w-6 select-none border-r border-line px-2 text-right text-faint">
                            {line.type === "add" ? "+" : line.type === "del" ? "-" : ""}
                          </td>
                          <td className={`whitespace-pre-wrap break-all px-2 py-0.5 ${line.type === "add" ? "text-success" : line.type === "del" ? "text-danger" : "text-muted"}`}>
                            {line.text || " "}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : viewingId ? (
                <div className="md-body" dangerouslySetInnerHTML={{ __html: viewingHtml }} />
              ) : (
                <div className="py-8 text-center text-[13px] text-faint">
                  点击左侧版本查看内容，或点击「对比当前」查看差异
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
