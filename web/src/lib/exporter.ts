import JSZip from "jszip";
import type { Doc } from "@/data/docs";

function download(filename: string, content: Blob) {
  const url = URL.createObjectURL(content);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** 导出单个文档为 Markdown */
export function exportDocAsMarkdown(doc: Doc) {
  const blob = new Blob([doc.body], { type: "text/markdown;charset=utf-8" });
  download(`${doc.title}.md`, blob);
}

/** 导出全部文档为 JSON */
export function exportAllAsJson(docs: Doc[]) {
  const payload = docs.map((d) => ({
    title: d.title,
    path: d.path,
    updated: d.updated,
    body: d.body,
  }));
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  download("sunnydoc-export.json", blob);
}

/** 导出全部文档为 zip（保留目录结构） */
export async function exportAllAsZip(docs: Doc[]) {
  const zip = new JSZip();
  const usedNames = new Set<string>();

  for (const doc of docs) {
    let rel = doc.path.split(" / ").join("/") + ".md";
    // 处理同名冲突
    if (usedNames.has(rel)) {
      const i = rel.lastIndexOf(".");
      rel = rel.slice(0, i) + `-${doc.key}.md`;
    }
    usedNames.add(rel);
    zip.file(rel, doc.body);
  }

  const blob = await zip.generateAsync({ type: "blob" });
  download("sunnydoc-export.zip", blob);
}
