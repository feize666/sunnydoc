/**
 * 流程图 / 思维导图「本地模板」存储（localStorage）。
 *
 * 与 Markdown 的 DOC_TEMPLATES（内置静态模板）不同，这里是用户
 * 在编辑器里「另存为模板」产生的自定义模板，随浏览器本地持久化。
 */

export type DiagramType = "flowchart" | "mindmap";

export interface DiagramTemplate {
  id: string;
  name: string;
  type: DiagramType;
  data: string; // 序列化 JSON：flowchart 为 {nodes,edges}，mindmap 为 {nodes,links}
  createdAt: number;
}

const STORAGE_KEY = "sunnydoc.diagramTemplates";

function readAll(): DiagramTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeAll(list: DiagramTemplate[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

export function listDiagramTemplates(type?: DiagramType): DiagramTemplate[] {
  const all = readAll();
  return type ? all.filter((t) => t.type === type) : all;
}

export function saveDiagramTemplate(
  name: string,
  type: DiagramType,
  data: string,
): DiagramTemplate {
  const tpl: DiagramTemplate = {
    id: `tpl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    name: name.trim(),
    type,
    data,
    createdAt: Date.now(),
  };
  writeAll([tpl, ...readAll()]);
  return tpl;
}

export function deleteDiagramTemplate(id: string): void {
  writeAll(readAll().filter((t) => t.id !== id));
}
