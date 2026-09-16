"use client";

import { useEffect, useMemo, useState } from "react";
import {
  listDiagramTemplates,
  saveDiagramTemplate,
  deleteDiagramTemplate,
  type DiagramType,
} from "@/lib/diagramTemplates";
import {
  listCommunityTemplates,
  publishCommunityTemplate,
  useCommunityTemplate,
  type CommunityTemplate,
} from "@/lib/api";
import { useToast } from "./Toast";
import { useModalFocus } from "@/lib/useModalFocus";

/**
 * 流程图 / 思维导图「模板」对话框。
 * 三个 tab：保存为模板（本地 / 发布到社区）+ 我的模板（本地）+ 社区模板（云端）。
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
  const [tab, setTab] = useState<"save" | "browse" | "community">("save");
  const [name, setName] = useState("");
  const [version, setVersion] = useState(0); // 触发本地模板列表刷新
  const [community, setCommunity] = useState<CommunityTemplate[]>([]);
  const [communityLoading, setCommunityLoading] = useState(false);
  const [search, setSearch] = useState("");

  const templates = useMemo(
    () => listDiagramTemplates(type),
    [type, version],
  );

  useEffect(() => {
    if (open) {
      setName("");
      setTab("save");
      setSearch("");
    }
  }, [open]);

  // 加载社区模板
  useEffect(() => {
    if (!open || tab !== "community") return;
    setCommunityLoading(true);
    listCommunityTemplates(type)
      .then(setCommunity)
      .catch(() => setCommunity([]))
      .finally(() => setCommunityLoading(false));
  }, [open, tab, type, version]);

  const filteredCommunity = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return community;
    return community.filter((t) => t.name.toLowerCase().includes(q));
  }, [community, search]);

  const label = type === "flowchart" ? "流程图" : "思维导图";
  const panelRef = useModalFocus<HTMLDivElement>(open, onClose, `${label}模板`);

  if (!open) return null;

  const handleSaveLocal = () => {
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

  const handlePublish = async () => {
    const n = name.trim();
    if (!n) {
      toast.warning("请输入模板名称");
      return;
    }
    try {
      await publishCommunityTemplate({ name: n, type, data: currentData });
      toast.success(`已发布到社区「${n}」`);
      setName("");
      setTab("community");
      setVersion((v) => v + 1);
    } catch (e) {
      toast.error(`发布失败：${e instanceof Error ? e.message : "未知错误"}`);
    }
  };

  const handleApply = (data: string, tplName: string) => {
    onApply(data);
    toast.success(`已应用模板「${tplName}」`);
    onClose();
  };

  const handleDeleteLocal = (id: string) => {
    deleteDiagramTemplate(id);
    setVersion((v) => v + 1);
    toast.success("已删除模板");
  };

  const handleApplyCommunity = async (t: CommunityTemplate) => {
    try {
      await useCommunityTemplate(t.id);
    } catch {
      /* 计数失败不影响应用 */
    }
    handleApply(t.data, t.name);
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        ref={panelRef}
        className="dialog-panel w-[500px] max-w-[92vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <span className="text-sm font-semibold">{label}模板</span>
          <button
            onClick={onClose}
            aria-label="关闭"
            title="关闭"
            className="icon-btn text-muted hover:text-text"
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
              tab === "save" ? "border-accent text-accent" : "border-transparent text-muted hover:text-text"
            }`}
          >
            保存为模板
          </button>
          <button
            onClick={() => setTab("browse")}
            className={`border-b-2 px-2 pb-2 text-[13px] font-medium transition-colors ${
              tab === "browse" ? "border-accent text-accent" : "border-transparent text-muted hover:text-text"
            }`}
          >
            我的模板（{templates.length}）
          </button>
          <button
            onClick={() => setTab("community")}
            className={`border-b-2 px-2 pb-2 text-[13px] font-medium transition-colors ${
              tab === "community" ? "border-accent text-accent" : "border-transparent text-muted hover:text-text"
            }`}
          >
            社区模板
          </button>
        </div>

        <div className="p-4">
          {tab === "save" ? (
            <div>
              <label className="field-label">模板名称</label>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveLocal();
                }}
                placeholder={`例如：${type === "flowchart" ? "审批流程" : "项目规划"}`}
                className="input"
              />
              <p className="field-hint">
                将当前{label}的节点与连线保存为模板，之后可一键复用。
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <button onClick={onClose} className="btn btn-secondary">取消</button>
                <button onClick={handlePublish} className="btn btn-secondary hover:border-accent/40 hover:text-accent">
                  发布到社区
                </button>
                <button onClick={handleSaveLocal} className="btn btn-accent text-white">
                  保存到本地
                </button>
              </div>
            </div>
          ) : tab === "browse" ? (
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
                        onClick={() => handleDeleteLocal(t.id)}
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
          ) : (
            <div>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索社区模板…"
                className="input mb-3"
              />
              {communityLoading ? (
                <ul className="max-h-72 space-y-1.5 overflow-y-auto">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <li key={i} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2">
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="skeleton skeleton-line w-32" />
                        <div className="skeleton skeleton-line w-20" />
                      </div>
                      <div className="skeleton h-6 w-12 shrink-0 rounded-md" />
                    </li>
                  ))}
                </ul>
              ) : filteredCommunity.length === 0 ? (
                <div className="py-8 text-center text-[13px] text-faint">
                  {community.length === 0 ? "社区还没有模板，快来发布第一个吧" : "没有匹配的模板"}
                </div>
              ) : (
                <ul className="max-h-72 space-y-1.5 overflow-y-auto">
                  {filteredCommunity.map((t) => (
                    <li
                      key={t.id}
                      className="flex items-center gap-2 rounded-lg border border-line px-3 py-2"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] text-text">{t.name}</span>
                        <span className="block text-[11px] text-faint">
                          {t.author_name || "匿名"} · {t.use_count ?? 0} 次使用
                        </span>
                      </span>
                      <button
                        onClick={() => handleApplyCommunity(t)}
                        className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white transition-opacity hover:opacity-90"
                      >
                        应用
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
