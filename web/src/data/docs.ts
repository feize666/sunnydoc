export interface Doc {
  key: string;
  title: string;
  path: string;
  updated: string;
  body: string;
  type?: string;
  /**
   * 乐观锁版本号（服务端 `documents.revision`）。
   *
   * 打开文档时记下它，每次保存时原样带回；服务端比对不一致即返回 409，
   * 说明他人已改过。保存成功后必须用响应里的新值刷新它，否则下一次保存
   * 会被误判成冲突。
   */
  revision?: number;
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
