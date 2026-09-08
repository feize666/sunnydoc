import type { TreeNode } from "@/data/docs";
import type { DocMeta, Folder } from "@/lib/api";

/**
 * 根据扁平文档列表 + 扁平文件夹列表组装多级文件树。
 * - 文件夹按 parent_id 递归组树，根级文件夹挂在树根
 * - 文档按 folder_id 挂到对应文件夹，无 folder_id 的挂在树根
 * - 每个节点按「文件夹在前、文档在后、名称排序」排序
 */
export function buildTree(docs: DocMeta[], folders: Folder[]): TreeNode[] {
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
    const fileNode: TreeNode = { type: "file", name: d.title, key: d.id };
    const parent = d.folder_id ? folderNodes.get(d.folder_id) : undefined;
    if (parent) {
      parent.children!.push(fileNode);
    } else {
      roots.push(fileNode);
    }
  }

  const sortChildren = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name, "zh-Hans-CN");
    });
    for (const n of nodes) {
      if (n.children && n.children.length > 0) sortChildren(n.children);
    }
  };
  sortChildren(roots);

  return roots;
}
