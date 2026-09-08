import JSZip from "jszip";

export interface ImportedDoc {
  title: string;
  body: string;
  ext: string;
  sourcePath?: string;
}

export interface SkippedFile {
  name: string;
  reason: string;
}

const TEXT_EXT = new Set([
  ".md",
  ".markdown",
  ".txt",
  ".text",
  ".json",
  ".csv",
  ".tsv",
]);

// 二进制格式：前端可识别，但需后端解析（本轮先提示）
const BINARY_EXT = new Set([
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
]);

export const ALL_SUPPORTED_EXT = new Set([
  ...TEXT_EXT,
  ...BINARY_EXT,
  ".zip",
]);

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

function titleOf(name: string): string {
  const i = name.lastIndexOf(".");
  const base = i >= 0 ? name.slice(0, i) : name;
  const parts = base.split("/");
  return parts[parts.length - 1] || name;
}

function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error(`读取失败：${file.name}`));
    reader.readAsText(file, "utf-8");
  });
}

/**
 * 导入文件列表，返回可导入的文档与被跳过的文件。
 * zip 会递归解压，提取其中所有文本类文档。
 */
export async function importFiles(
  files: File[],
): Promise<{ imported: ImportedDoc[]; skipped: SkippedFile[] }> {
  const imported: ImportedDoc[] = [];
  const skipped: SkippedFile[] = [];

  for (const file of files) {
    const ext = extOf(file.name);

    if (ext === ".zip") {
      try {
        const zip = await JSZip.loadAsync(file);
        const entries = Object.values(zip.files).filter((e) => !e.dir);
        for (const entry of entries) {
          const eExt = extOf(entry.name);
          if (TEXT_EXT.has(eExt)) {
            const text = await entry.async("string");
            imported.push({
              title: titleOf(entry.name),
              body: text,
              ext: eExt,
              sourcePath: entry.name,
            });
          } else if (BINARY_EXT.has(eExt)) {
            skipped.push({ name: entry.name, reason: "二进制格式（待后端解析）" });
          }
          // 其他文件类型静默忽略
        }
        if (entries.length === 0) skipped.push({ name: file.name, reason: "空压缩包" });
      } catch (e) {
        skipped.push({ name: file.name, reason: "解压失败" });
      }
      continue;
    }

    if (TEXT_EXT.has(ext)) {
      try {
        const text = await readAsText(file);
        imported.push({ title: titleOf(file.name), body: text, ext });
      } catch (e) {
        skipped.push({ name: file.name, reason: "读取失败" });
      }
      continue;
    }

    if (BINARY_EXT.has(ext)) {
      skipped.push({ name: file.name, reason: "二进制格式（待后端解析）" });
      continue;
    }

    skipped.push({ name: file.name, reason: "不支持的文件类型" });
  }

  return { imported, skipped };
}
