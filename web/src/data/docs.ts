export interface Doc {
  key: string;
  title: string;
  path: string;
  updated: string;
  body: string;
}

export interface TreeNode {
  type: "folder" | "file";
  name: string;
  key?: string;
  children?: TreeNode[];
  createdAt?: number;
  folder_id?: string | null;
  pinned?: boolean;
  sort_order?: number | null;
}

export type SortBy = "manual" | "numeric" | "name" | "created";
