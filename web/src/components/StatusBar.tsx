export function StatusBar({
  wordCount,
  openCount,
}: {
  wordCount: number;
  openCount: number;
}) {
  return (
    <footer className="flex h-7 items-center gap-4 border-t border-line bg-surface px-3.5 text-[11px] text-faint select-none">
      <span>{wordCount} 字</span>
      <span>{openCount} 篇已打开</span>
      <span>索引已就绪</span>
      <div className="ml-auto flex gap-3.5">
        <span>Markdown</span>
        <span>UTF-8</span>
      </div>
    </footer>
  );
}
