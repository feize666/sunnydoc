"use client";

import { useEffect, useMemo, useState } from "react";
import {
  listDiagramTemplates,
  saveDiagramTemplate,
  deleteDiagramTemplate,
  type DiagramType,
} from "@/lib/diagramTemplates";
import { useToast } from "./Toast";

/**
 * 流程图 / 思维导图「本地模板」对话框。
 * 两个 tab：保存为模板（输入名称）+ 我的模板（应用 / 删除）。
 */
export function DiagramTemplateDialog({
  open,
  onClose,
  type,
  currentData,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  type: DiagramType;
  currentData: string;
  onApply: (data: string) => void;
}) {
  const toast = useToast();
  const [tab, setTab] = useState<"save" | "browse">("save");
  const [name, setName] = useState("");
  const [version, setVersion] = useState(0); // 触发模板列表刷新

  const templates = useMemo(
    () => listDiagramTemplates(type),
    [type, version],
  );

  useEffect(() => {
    if (open) {
      setName("");
      setTab("save");
    }
  }, [open]);

  if (!open) return null;

  const label = type === "flowchart" ? "流程图" : "思维导图";

  const handleSave = () => {
    const n = name.trim();
    if (!n) {
      toast.warning("请输入模板名称");
      return;
    }
    saveDiagramTemplate(n, type, currentData);
    toast.success(`已保存模板「${n}」`);
    setName("");
    setTab("browse");
    setVersion((v) => v + 1);
  };

  const handleApply = (data: string, tplName: string) => {
    onApply(data);
    toast.success(`已应用模板「${tplName}」`);
    onClose();
  };

  const handleDelete = (id: string) => {
    deleteDiagramTemplate(id);
    setVersion((v) => v + 1);
    toast.success("已删除模板");
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog-panel w-[480px] max-w-[92vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <span className="text-sm font-semibold">{label}模板</span>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-hover"
            title="关闭"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tab 切换 */}
        <div className="flex gap-1 border-b border-line px-4 pt-2">
          <button
            onClick={() => setTab("save")}
            className={`border-b-2 px-2 pb-2 text-[13px] font-medium transition-colors ${
              tab === "save"
                ? "border-accent text-accent"
                : "border-transparent text-muted hover:text-text"
            }`}
          >
            保存为模板
          </button>
          <button
            onClick={() => setTab("browse")}
            className={`border-b-2 px-2 pb-2 text-[13px] font-medium transition-colors ${
              tab === "browse"
                ? "border-accent text-accent"
                : "border-transparent text-muted hover:text-text"
            }`}
          >
            我的模板（{templates.length}）
          </button>
        </div>

        <div className="p-4">
          {tab === "save" ? (
            <div>
              <label className="mb-1 block text-xs text-muted">模板名称</label>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSave();
                }}
                placeholder={`例如：${type === "flowchart" ? "审批流程" : "项目规划"}`}
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
              <p className="mt-2 text-xs text-faint">
                将当前{label}的节点与连线保存为本地模板，之后可一键复用。
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <button onClick={onClose} className="btn btn-secondary">取消</button>
                <button onClick={handleSave} className="btn btn-accent text-white">
                  保存
                </button>
              </div>
            </div>
          ) : (
            <div>
              {templates.length === 0 ? (
                <div className="py-8 text-center text-[13px] text-faint">
                  还没有{label}模板，先在编辑器里「保存为模板」
                </div>
              ) : (
                <ul className="max-h-72 space-y-1.5 overflow-y-auto">
                  {templates.map((t) => (
                    <li
                      key={t.id}
                      className="flex items-center gap-2 rounded-lg border border-line px-3 py-2"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] text-text">{t.name}</span>
                        <span className="block text-[11px] text-faint">
                          {new Date(t.createdAt).toLocaleString()}
                        </span>
                      </span>
                      <button
                        onClick={() => handleApply(t.data, t.name)}
                        className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white transition-opacity hover:opacity-90"
                      >
                        应用
                      </button>
                      <button
                        onClick={() => handleDelete(t.id)}
                        className="grid h-6 w-6 place-items-center rounded-md text-faint transition-colors hover:bg-danger-soft hover:text-danger"
                        title="删除"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                        </svg>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
