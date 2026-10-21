#!/usr/bin/env python3
"""对抗性验证：往**产品源码**里注入品牌回归缺陷，确认
`web/scripts/verify_brand_inapp.cjs` **真的会失败** —— 防止断言恒真。

## 为什么必须做（本轮已出现过的同类风险）

`verify_brand_inapp.cjs` 有 34 项断言。如果其中有一类是「自我满足」的
（比如只验「存在 `[data-brand]`」而不验里面画了什么），那么把 logo 换成任何
垃圾都能通过。三个必测的注入方向：

  ① **文案回归** —— 把品牌字改回「知库」→「无残留」断言必须失败
  ② **组件替换失效** —— 把 `<LogoMark>` 换成空 div → 「结构正确」断言必须失败
  ③ **标题回归** —— layout.tsx 标题改回旧值 → 标题断言必须失败

⚠️ 每个注入都必须**真的模拟到缺陷**。曾栽过：想造哭脸却只平移了圆心、
凸向没变，注入无效却当成「判据漏过」。（见 MEMORY.md）

用法：python3 verify_inapp_adversarial.py
"""
import os
import re
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
WEB = os.path.join(REPO, "web")
SRC = os.path.join(WEB, "src")

HOME = os.path.join(SRC, "components", "HomeView.tsx")
LAYOUT = os.path.join(SRC, "app", "layout.tsx")
TITLEBAR = os.path.join(SRC, "components", "TitleBar.tsx")
LAYOUT = os.path.join(SRC, "app", "layout.tsx")


def run_verify():
    env = dict(os.environ)
    env["NODE_PATH"] = "/Users/beidou/.workbuddy/binaries/node/workspace/node_modules"
    node = "/Users/beidou/.workbuddy/binaries/node/versions/22.22.2-6/bin/node"
    r = subprocess.run([node, "scripts/verify_brand_inapp.cjs"], cwd=WEB, env=env,
                       capture_output=True, text=True, timeout=300)
    out = r.stdout + r.stderr
    m = re.search(r"通过 (\d+) / 失败 (\d+)", out)
    failed = [ln.strip() for ln in out.splitlines() if "❌" in ln]
    if not m:
        crash = next((l.strip() for l in out.splitlines()
                      if "Error" in l or "throw" in l), "（无统计行）")
        return (-1, -1), failed + [f"脚本崩溃: {crash[:90]}"]
    return (int(m.group(1)), int(m.group(2))), failed


# (说明, 文件, 旧串, 新串)
CASES = [
    ("文案回归：首页品牌字 Sunny → 知库", HOME,
     'font-semibold text-text">Sunny<', 'font-semibold text-text">知库<'),
    ("副标题回归：个人知识库 → 文档知识库", HOME,
     'text-faint">个人知识库<', 'text-faint">文档知识库<'),
    ("标题回归：Sunny · 个人知识库 → 知库 · 文档知识库", LAYOUT,
     'title: "Sunny · 个人知识库"', 'title: "知库 · 文档知识库"'),
    ("组件失效：LogoMark 换成空 span", TITLEBAR,
     '<LogoMark size={20} rounded="rounded-md" />',
     '<span className="inline-block" style={{width:20,height:20}} />'),
    # 👇 下面两条来自**独立复核的发现**：DOM 断言看不见、只有静态扫描能抓
    ("隐藏残留：知识库名兜底字 S → 知（DOM 断言看不见）", HOME,
     '(kb.name || "S")', '(kb.name || "知")'),
    ("生成物未接线：apple 指向 icon.svg（apple-icon.png 白生成）", LAYOUT,
     'apple: "/apple-icon.png"', 'apple: "/icon.svg"'),
]


def main():
    backups = {}
    for _, f, _, _ in CASES:
        backups.setdefault(f, open(f).read())

    base, _ = run_verify()
    print(f"基线：通过 {base[0]} / 失败 {base[1]}")
    if base[1] != 0:
        print("❌ 基线就不通过，先修好再做对抗性验证")
        return 1
    print()

    print(f"{'注入':<44}{'结果':<12}被触发的断言")
    print("-" * 100)
    all_ok = True
    for label, f, old, new in CASES:
        src = open(f).read()
        if old not in src:
            print(f"{label:<44}{'⚠️ 注入点未找到':<12}{old[:50]}")
            all_ok = False
            continue
        open(f, "w").write(src.replace(old, new, 1))
        (_, nfail), lines = run_verify()
        ok = nfail > 0
        all_ok &= ok
        tag = ("✅ 抓到" if nfail > 0 else "❌ 漏过（恒真！）") if nfail >= 0 else "💥 脚本崩溃"
        detail = " ｜ ".join(x.replace("❌ ", "")[:44] for x in lines[:2])
        print(f"{label:<44}{tag:<12}{detail}")
        # 立即还原
        open(f, "w").write(backups[f])

    for f, content in backups.items():
        open(f, "w").write(content)
    (p, nf), _ = run_verify()
    print()
    print(f"还原后：通过 {p} / 失败 {nf}")
    print()
    print("✅ 全部注入都被捕获" if all_ok and nf == 0 else "❌ 存在漏过或未还原干净")
    return 0 if all_ok and nf == 0 else 1


if __name__ == "__main__":
    sys.exit(main())