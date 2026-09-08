declare module "markdown-it-task-lists" {
  import type MarkdownIt from "markdown-it";

  interface TaskListsOptions {
    /** 是否允许点击切换复选框（默认 false，渲染为 disabled） */
    enabled?: boolean;
    /** 是否用 <label> 包裹 */
    label?: boolean;
    /** label 放在复选框之后 */
    labelAfter?: boolean;
  }

  const taskLists: (md: MarkdownIt, options?: TaskListsOptions) => void;
  export default taskLists;
}
