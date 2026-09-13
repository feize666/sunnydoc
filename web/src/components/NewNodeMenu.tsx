"use client";

export type NodeType =
  | "doc"
  | "folder"
  | "table"
  | "board"
  | "datasheet"
  | "mindmap"
  | "slides"
  | "flowchart";

function Icon({ d, color, size = 18 }: { d: string; color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      {d.split("|").map((p, i) => (
        <path key={i} d={p} />
      ))}
    </svg>
  );
}

interface TypeDef {
  type: NodeType;
  label: string;
  desc: string;
  color: string;
  available: boolean;
  icon: string;
}

const TYPES: TypeDef[] = [
  { type: "doc", label: "文档", desc: "富文本笔记", color: "#3b82f6", available: true, icon: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z|M14 2v6h6" },
  { type: "table", label: "表格", desc: "行列数据", color: "#22c55e", available: true, icon: "M3 3h18v18H3z|M3 9h18|M3 15h18|M9 3v18|M15 3v18" },
  { type: "folder", label: "目录", desc: "分类整理", color: "#f97316", available: true, icon: "M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" },
  { type: "board", label: "画板", desc: "自由绘制", color: "#a855f7", available: true, icon: "M3 3h18v18H3z|M7 16l4-4 3 2 4-5" },
  { type: "datasheet", label: "数据表", desc: "结构化数据", color: "#0ea5e9", available: true, icon: "M4 5h16v14H4z|M4 9h16|M9 9v10" },
  { type: "mindmap", label: "思维导图", desc: "梳理思路", color: "#ec4899", available: true, icon: "M12 4v16M12 8H5M12 14h7" },
  { type: "flowchart", label: "流程图", desc: "流程可视化", color: "#6366f1", available: true, icon: "M12 2l6 8-6 8-6-8z|M12 6v4M12 14v4" },
  { type: "slides", label: "幻灯片", desc: "演示文稿", color: "#ef4444", available: false, icon: "M3 5h18v12H3z|M3 9h18|M9 9v8" },
];

/** 「+」新建多类型面板（彩色图标 + 释义）。 */
export function NewNodeMenu({
  onSelect,
  onClose,
}: {
  onSelect: (type: NodeType) => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-20" onClick={onClose} />
      <div className="menu-panel absolute right-0 top-full z-30 mt-1 w-[320px] overflow-hidden rounded-xl p-1.5">
        <div className="grid grid-cols-2 gap-0.5">
          {TYPES.map((t) => (
            <button
              key={t.type}
              disabled={!t.available}
              onClick={() => {
                if (t.available) {
                  onClose();
                  onSelect(t.type);
                }
              }}
              className={`flex items-start gap-2.5 rounded-lg px-2.5 py-2.5 text-left transition-colors ${
                t.available
                  ? "hover:bg-hover"
                  : "cursor-not-allowed opacity-60"
              }`}
            >
              <span
                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg"
                style={{ backgroundColor: `${t.color}1a` }}
              >
                <Icon d={t.icon} color={t.color} />
              </span>
              <span className="min-w-0 flex-1 pt-0.5">
                <span className="flex items-center gap-1">
                  <span className={`text-[14px] font-medium ${t.available ? "text-text" : "text-faint"}`}>
                    {t.label}
                  </span>
                  {!t.available && (
                    <span className="rounded bg-surface-2 px-1 py-px text-[9px] leading-none text-faint">
                      规划中
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-[11px] text-faint">{t.desc}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
