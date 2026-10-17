#!/usr/bin/env python
"""媒体存储体检：用量概览 + 孤儿文件报告。

**只读脚本，不删除任何文件。** 目的是让「上传目录里到底堆了什么」可见 ——
此前该目录完全无观测手段，实测曾有一个 35MB 的无效上传静静躺着占空间。

用法：
    cd api && .venv/bin/python scripts/media_audit.py          # 概览 + 孤儿清单
    cd api && .venv/bin/python scripts/media_audit.py --all    # 附带所有文件明细

判定「被引用」的方式：扫全部**未软删**文档的正文，匹配 `/api/v1/media/<name>`
与 `/uploads/<name>` 两种历史形态。引用是按文件名精确匹配，不做模糊包含。

注意：孤儿 ≠ 可删。同一文件可能被回收站里的文档、导出包或外部引用使用，
故本脚本只打印清单，删除需人工确认。
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.config import MEDIA_DIR  # noqa: E402
from app.services import db  # noqa: E402


def human(n: float) -> str:
    """人类可读的字节数。"""
    if n < 1024:
        return f"{int(n)}B"
    for unit in ("KB", "MB", "GB"):
        n /= 1024.0
        if n < 1024 or unit == "GB":
            return f"{n:.1f}{unit}"
    return f"{n:.1f}GB"


def main() -> int:
    verbose = "--all" in sys.argv

    # ---------- 收集目录里的文件 ----------
    if not MEDIA_DIR.exists():
        print(f"媒体目录不存在：{MEDIA_DIR}")
        return 0

    files: list[tuple[str, int]] = []
    for p in MEDIA_DIR.rglob("*"):
        if p.is_file():
            files.append((str(p.relative_to(MEDIA_DIR)), p.stat().st_size))

    uploads_dir = MEDIA_DIR / "uploads"
    uploads = [(n, s) for n, s in files if n.startswith("uploads/")]
    content_addressed = [(n, s) for n, s in files if not n.startswith("uploads/")]

    total = sum(s for _, s in files)
    print("=" * 62)
    print("媒体存储概览")
    print("=" * 62)
    print(f"  目录            {MEDIA_DIR}")
    print(f"  文件总数        {len(files)}")
    print(f"  占用总大小      {human(total)}")
    print(f"  ├ 内容寻址      {len(content_addressed)} 个 · {human(sum(s for _, s in content_addressed))}")
    print(f"  └ 历史上传      {len(uploads)} 个 · {human(sum(s for _, s in uploads))}"
          f"   （早期 /uploads 形态，静态挂载服务）")

    biggest = sorted(files, key=lambda x: -x[1])[:5]
    print("\n  最大的 5 个文件：")
    for n, s in biggest:
        print(f"    {human(s):>9}  {n}")

    # ---------- 找出被文档引用的文件名 ----------
    conn = db._connect()
    with conn.cursor() as cur:
        cur.execute("SELECT id, title, text FROM documents WHERE deleted_at IS NULL")
        rows = cur.fetchall()

    referenced: set[str] = set()
    # 两种形态：/api/v1/media/<name>（含 ?name= 查询）与 /uploads/<name>
    pat = re.compile(r"/(?:api/v1/media|uploads)/([A-Za-z0-9._-]+)")
    for _id, _title, text in rows:
        for m in pat.finditer(text or ""):
            referenced.add(m.group(1))

    # 回收站文档的引用 —— 必须单独统计：这些文件的「孤儿」身份是假象，
    # 用户从回收站还原文档后图片要能立刻显示。实测 314 个孤儿里有 15 个属此类。
    with conn.cursor() as cur:
        cur.execute("SELECT text FROM documents WHERE deleted_at IS NOT NULL")
        trashed_rows = cur.fetchall()
    in_trash: set[str] = set()
    for (text,) in trashed_rows:
        for m in pat.finditer(text or ""):
            in_trash.add(m.group(1))

    print("\n" + "=" * 62)
    print(f"引用分析（扫描 {len(rows)} 篇未删文档 · {len(trashed_rows)} 篇回收站）")
    print("=" * 62)
    print(f"  被引用的媒体文件  {len(referenced)} 个")

    # 目录里存在的、但没有任何文档引用的文件
    present_names = {Path(n).name for n, _ in files}
    orphan_names = present_names - referenced

    # 引用了但文件已不在盘上的（反向问题：文档里图片会裂）
    missing = referenced - present_names

    orphan_files = [(n, s) for n, s in files if Path(n).name in orphan_names]
    orphan_size = sum(s for _, s in orphan_files)
    truly_unused = [x for x in orphan_files if Path(x[0]).name not in in_trash]
    trash_only_files = [x for x in orphan_files if Path(x[0]).name in in_trash]

    print(f"  孤儿文件          {len(orphan_files)} 个 · {human(orphan_size)}")
    if orphan_files:
        print(f"    ├ 回收站文档仍在引用  {len(trash_only_files)} 个 · {human(sum(s for _, s in trash_only_files))}")
        print("    │   ⚠️ 绝不能删 —— 用户从回收站还原文档后图片要能立刻显示")
        print(f"    └ 全库无任何引用      {len(truly_unused)} 个 · {human(sum(s for _, s in truly_unused))}")
        print("        （**仍不等于可删**：可能存在粘贴未保存、导出包、外部引用等）")
        for n, s in sorted(truly_unused, key=lambda x: -x[1])[:20]:
            print(f"          {human(s):>9}  {n}")
        if len(truly_unused) > 20:
            print(f"          … 其余 {len(truly_unused) - 20} 个")

    if missing:
        print(f"\n  ⚠️ 文档引用了但盘上不存在 {len(missing)} 个（这些图片会显示为裂图）：")
        for n in sorted(missing)[:15]:
            print(f"      {n}")

    if verbose:
        print("\n" + "=" * 62)
        print("全部文件明细")
        print("=" * 62)
        for n, s in sorted(files, key=lambda x: -x[1]):
            mark = "引用" if Path(n).name in referenced else "孤儿"
            print(f"  [{mark}] {human(s):>9}  {n}")

    print("\n完成（未做任何修改）。若要清理，请先人工核对上述清单。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())