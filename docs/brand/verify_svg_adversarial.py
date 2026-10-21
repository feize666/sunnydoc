#!/usr/bin/env python3
"""对抗性验证：往**落地 SVG** 里注入缺陷，确认 `verify_brand_logo.cjs`
的断言**真的会失败** —— 防止「自检恒真」。

## 为什么必须做这件事

2026-10-21 本轮就栽过两次同类：
  ① 把几何从 v3 改成 v4 后，JS 里硬编码的采样点全部失效，
     但脚本**照样报通过** —— 因为探针落到了图形之外，断言变成
     「拿背景色比背景色」。**采样点必须同源**（现改为读 `geom.json`）。
  ② 「嘴角比弧底高」这条判据用亮度比较，哭脸时两个探针会**同时**落到黄上
     → 恒真。改判「弧底正上方 0.9×弧深 处必须是黄」才区分得开。

⇒ 每次改几何或改判据，都要重跑本脚本。

用法：
    python3 verify_svg_adversarial.py
"""
import os
import re
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
WEB = os.path.join(REPO, "web")
LOGO = os.path.join(HERE, "svg", "sunny-face.svg")
FAVICON = os.path.join(HERE, "svg", "favicon-sunny.svg")


def run_verify():
    env = dict(os.environ)
    env["NODE_PATH"] = "/Users/beidou/.workbuddy/binaries/node/workspace/node_modules"
    node = "/Users/beidou/.workbuddy/binaries/node/versions/22.22.2-6/bin/node"
    r = subprocess.run([node, "scripts/verify_brand_logo.cjs"], cwd=WEB, env=env,
                       capture_output=True, text=True)
    out = r.stdout + r.stderr
    m = re.search(r"通过 (\d+) / 失败 (\d+)", out)
    failed_lines = [ln.strip() for ln in out.splitlines() if "❌" in ln]
    if not m:
        # 🔴 没有统计行 = 脚本中途崩溃（如 SVG 解析失败）。
        #    不能当成「0 失败」——那会把崩溃伪装成「判据漏过」。
        crash = next((ln.strip() for ln in out.splitlines()
                      if "Error" in ln or "throw" in ln), "（无统计行）")
        return (-1, -1), failed_lines + [f"脚本崩溃: {crash[:80]}"]
    return (int(m.group(1)), int(m.group(2))), failed_lines


def mouth_flip(svg):
    """把嘴的 path 上下翻转 → 哭脸（真正改变凸向，而非平移）。"""
    m = re.search(r'(<path d=")(M[^"]+)(" fill="none" stroke="#4E342E")', svg)
    if not m:
        return None
    pts = re.findall(r"(-?[\d.]+),(-?[\d.]+)", m.group(2))
    ys = [float(b) for _, b in pts]
    ybot, ytop = max(ys), min(ys)
    new = [f"{a},{ybot - (float(b) - ytop):.2f}" for a, b in pts]
    return svg[:m.start(2)] + "M" + "L".join(new) + svg[m.end(2):]


# (说明, 目标文件, 变换函数)
def build_cases(svg, fav):
    def sub(a, b):
        return lambda s: s.replace(a, b, 1)

    return [
        ("眼睛隐掉（display:none）", LOGO, sub("<ellipse", '<ellipse style="display:none"')),
        ("高光改成黄色（失去『有神』）", LOGO, sub('fill="#FFFFFF"', 'fill="#FFD93D"')),
        ("嘴的 stroke 去掉", LOGO, sub('fill="none" stroke="#4E342E"', 'fill="none" stroke="none"')),
        ("嘴改成哭脸（上下翻转）", LOGO, mouth_flip),
        ("描边细到看不见（3 → 0.2）", LOGO, sub('stroke-width="3"', 'stroke-width="0.2"')),
        ("腮红移出脸外", LOGO, sub('<circle cx="32" cy="55.5" r="4"', '<circle cx="96" cy="55.5" r="4"')),
        # 🔴 注入必须保持 SVG **语法有效**：首版写成 `s.replace("<svg ", "<svg ><rect/>")`
        #    把 `xmlns` 挤到了 `rect` 之后 → 解析失败 → 脚本**中途崩溃**，
        #    既不输出统计行也不给出明确失败，反而伪装成「判据漏过」。
        #    正确做法是在 `<svg ...>` 标签**闭合之后**插入。
        ("主 logo 加实底（破坏透明底）", LOGO,
         lambda s: re.sub(r"(<svg[^>]*>)",
                          r'\1<rect width="100" height="100" fill="#FFF8E1"/>', s, count=1)),
        ("favicon 底色改黑", FAVICON, sub("#FFF8E1", "#000000")),
    ]


def main():
    b_logo, b_fav = open(LOGO).read(), open(FAVICON).read()
    shutil.copy(LOGO, "/tmp/_sunny_bk.svg")
    shutil.copy(FAVICON, "/tmp/_fav_bk.svg")

    base, _ = run_verify()
    print(f"基线：通过 {base[0]} / 失败 {base[1]}")
    if base[1] != 0:
        print("❌ 基线本身就不通过，先修好再谈对抗性验证")
        return 1
    print()

    hdr = f"{'注入':<34}{'结果':<10}被触发的断言"
    print(hdr)
    print("-" * 100)
    all_ok = True
    for label, target, fn in build_cases(b_logo, b_fav):
        mutated = fn(open(target).read())
        if mutated is None or mutated == open(target).read():
            print(f"{label:<34}{'⚠️ 无效':<10}（变换未生效，无法判证）")
            all_ok = False
            continue
        open(target, "w").write(mutated)
        (_, f), lines = run_verify()
        ok = f > 0
        all_ok &= ok
        tag = ("✅ 抓到" if f > 0 else "❌ 漏过（恒真！）") if f >= 0 else "💥 脚本崩溃"
        detail = " ｜ ".join(x.replace("❌ ", "")[:46] for x in lines[:2])
        print(f"{label:<34}{tag:<10}{detail}")
        open(LOGO, "w").write(b_logo)
        open(FAVICON, "w").write(b_fav)

    # 还原
    open(LOGO, "w").write(b_logo)
    open(FAVICON, "w").write(b_fav)
    (p, f), _ = run_verify()
    print()
    print(f"还原后：通过 {p} / 失败 {f}")
    print()
    print("✅ 全部注入都被捕获" if all_ok else "❌ 存在漏过的注入")
    return 0 if all_ok and f == 0 else 1


if __name__ == "__main__":
    sys.exit(main())