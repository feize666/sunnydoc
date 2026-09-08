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
}
