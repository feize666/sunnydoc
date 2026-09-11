export interface DocTemplate {
  id: string;
  name: string;
  icon: string;
  description: string;
  content: string;
}

export const DOC_TEMPLATES: DocTemplate[] = [
  {
    id: "blank",
    name: "空白文档",
    icon: "📄",
    description: "从零开始",
    content: "",
  },
  {
    id: "meeting",
    name: "会议纪要",
    icon: "🗓️",
    description: "记录会议要点与决议",
    content: `# 会议纪要

## 会议信息
- 时间：
- 地点：
- 参会人：

## 议题

## 讨论内容

## 决议事项

## 待办事项
- [ ] 
`,
  },
  {
    id: "weekly",
    name: "周报",
    icon: "📊",
    description: "本周总结与下周计划",
    content: `# 周报

## 本周完成
- 

## 下周计划
- 

## 问题与风险
- 
`,
  },
  {
    id: "project",
    name: "项目计划",
    icon: "🚀",
    description: "目标、里程碑与资源规划",
    content: `# 项目计划

## 项目背景


## 目标


## 里程碑
- 

## 资源与分工
- 

## 风险与应对
- 
`,
  },
  {
    id: "okr",
    name: "OKR",
    icon: "🎯",
    description: "目标与关键结果",
    content: `# OKR

## 目标（Objective）


## 关键结果（Key Results）
- KR1: 
- KR2: 
- KR3: 

## 进展记录
- 
`,
  },
  {
    id: "notes",
    name: "读书笔记",
    icon: "📖",
    description: "摘录与思考",
    content: `# 读书笔记

## 书籍信息
- 书名：
- 作者：

## 核心观点


## 精彩摘录
> 

## 我的思考
- 
`,
  },
];

export function getTemplate(id: string): DocTemplate | undefined {
  return DOC_TEMPLATES.find((t) => t.id === id);
}
