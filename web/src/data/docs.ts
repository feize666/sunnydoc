export interface Doc {
  key: string;
  title: string;
  path: string;
  updated: string;
  body: string;
  type?: string;
}

export interface TreeNode {
  type: "folder" | "file";
  name: string;
  key?: string;
  children?: TreeNode[];
  createdAt?: number;
  /** 最后修改时间（文档专用；文件夹无此字段，排序时回落到 createdAt） */
  updatedAt?: number;
  folder_id?: string | null;
  pinned?: boolean;
  sort_order?: number | null;
}

/**
 * 文件树排序维度。
 * - manual：手动顺序（拖拽结果），与其余维度互斥但可切回
 * - numeric：名称开头的数字前缀（"01-xxx"）
 * - name：按名称（中文拼音）
 * - created：按创建时间，新→旧
 * - updated：按最后修改时间，新→旧
 */
export type SortBy = "manual" | "numeric" | "name" | "created" | "updated";
