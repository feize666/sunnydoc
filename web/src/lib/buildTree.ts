import type { TreeNode, SortBy } from "@/data/docs";
import type { DocMeta, Folder } from "@/lib/api";

/** 从名称开头提取数字前缀（如 "01-xxx" -> 1），无则返回 null */
function numericKey(name: string): number | null {
  const m = /^(\d+)/.exec(name);
  return m ? parseInt(m[1], 10) : null;
}

function compareNode(a: TreeNode, b: TreeNode, sortBy: SortBy): number {
  // 文件夹始终排在文档前面（保持树的「结构分组」视觉语法）。
  // 置顶在本组内生效 —— 即「置顶的文件夹」在文件夹区最前、「置顶的文档」在文档区最前，
  // 而不是让置顶文档越过文件夹。这与 Notion / 语雀 的约定一致。
  if (a.type !== b.type) return a.type === "folder" ? -1 : 1;

  // 置顶优先：在任何排序模式下，同组内的置顶项都固定在最前面。
  if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;

  if (sortBy === "manual") {
    // 升序：sort_order 小者在上（与主流 Notion / Outline 一致）。
    // 兜底不再用 createdAt —— 它是秒级时间戳（约 1.79e9），而 sort_order 已重播种为
    // 「间隔 1024 的小整数」，两者量纲相差 6 个数量级，混用会让顺序难以预料。
    const sa = a.sort_order ?? 0;
    const sb = b.sort_order ?? 0;
    if (sa !== sb) return sa - sb;
    return a.name.localeCompare(b.name, "zh-Hans-CN");
  }

  if (sortBy === "created") {
    const ta = a.createdAt ?? 0;
    const tb = b.createdAt ?? 0;
    if (ta !== tb) return tb - ta; // 新的在前
    return a.name.localeCompare(b.name, "zh-Hans-CN");
  }

  if (sortBy === "updated") {
    // 文件夹没有 updatedAt，回落到 createdAt，避免它们全部并列成 0
    const ua = a.updatedAt ?? a.createdAt ?? 0;
    const ub = b.updatedAt ?? b.createdAt ?? 0;
    if (ua !== ub) return ub - ua; // 最近修改的在前
    return a.name.localeCompare(b.name, "zh-Hans-CN");
  }

  if (sortBy === "numeric") {
    const na = numericKey(a.name);
    const nb = numericKey(b.name);
    if (na !== null && nb !== null && na !== nb) return na - nb;
    if (na !== null && nb === null) return -1; // 带数字的排前面
    if (na === null && nb !== null) return 1;
    return a.name.localeCompare(b.name, "zh-Hans-CN");
  }

  // 名称排序
  return a.name.localeCompare(b.name, "zh-Hans-CN");
}

/**
 * 按「手动顺序」重排一组同级节点（升降序取 sort_order 升序），返回新数组。
 *
 * 为什么需要：拖拽落点必须用**手动序**计算，不能用当前视觉序。
 * 视觉序随 sortBy 变化（名称/数字/创建/修改），而落点是写回 sort_order 的 ——
 * 只有手动序与该坐标同源。若拿视觉序算中点，在「两序不一致」的分组里
 * 会落到完全无关的位置（实测复现，详见 .workbuddy/repro_dnd_bug.js）。
 *
 * 沿用 compareNode 的 manual 分支，保证与渲染时的排序规则完全一致
 * （文件夹在前、置顶在前、sort_order 升序、同名再按名称）。
 */
export function sortSiblingsForManual(nodes: TreeNode[]): TreeNode[] {
  return [...nodes].sort((a, b) => compareNode(a, b, "manual"));
}

/**
 * 根据扁平文档列表 + 扁平文件夹列表组装多级文件树。
 * - 文件夹按 parent_id 递归组树，根级文件夹挂在树根
 * - 文档按 folder_id 挂到对应文件夹，无 folder_id 的挂在树根
 * - 每个节点按「文件夹在前、文档在后、按 sortBy 排序」
 */
export function buildTree(
  docs: DocMeta[],
  folders: Folder[],
  sortBy: SortBy = "numeric",
): TreeNode[] {
  const docList = Array.isArray(docs) ? docs : [];
  const folderList = Array.isArray(folders) ? folders : [];

  const folderMap = new Map<string, Folder>();
  for (const f of folderList) folderMap.set(f.id, f);

  const folderNodes = new Map<string, TreeNode>();
  for (const f of folderList) {
    folderNodes.set(f.id, {
      type: "folder",
      name: f.name,
      key: f.id,
      children: [],
      createdAt: f.created_at,
      folder_id: f.parent_id,
      sort_order: f.sort_order,
      pinned: !!f.pinned,
    });
  }

  const roots: TreeNode[] = [];

  // 挂接文件夹层级
  for (const f of folderList) {
    const node = folderNodes.get(f.id)!;
    const parent = f.parent_id ? folderNodes.get(f.parent_id) : undefined;
    if (parent) {
      parent.children!.push(node);
    } else {
      roots.push(node);
    }
  }

  // 挂接文档
  for (const d of docList) {
    const fileNode: TreeNode = {
      type: "file",
      name: d.title,
      key: d.id,
      createdAt: d.created_at,
      updatedAt: d.updated_at ?? d.created_at,
      folder_id: d.folder_id,
      pinned: !!d.pinned,
      sort_order: d.sort_order,
    };
    const parent = d.folder_id ? folderNodes.get(d.folder_id) : undefined;
    if (parent) {
      parent.children!.push(fileNode);
    } else {
      roots.push(fileNode);
    }
  }

  const sortChildren = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => compareNode(a, b, sortBy));
    for (const n of nodes) {
      if (n.children && n.children.length > 0) sortChildren(n.children);
    }
  };
  sortChildren(roots);

  return roots;
}
