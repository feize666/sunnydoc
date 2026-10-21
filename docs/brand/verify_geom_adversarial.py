#!/usr/bin/env python3
"""对抗性验证：注入缺陷，确认自检**真的会失败**（否则自检可能恒真）。

每个用例：备份 → 改常量 → 跑 sanity → 恢复。
"""
import importlib
import io
import os
import sys
import contextlib

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "sunny_geom.py")
orig = open(SRC).read()

CASES = [
    ("去掉笑脸（反转角区间 = 哭脸）",
     "return CX, yc, r, a, 180.0 - a", "return CX, yc, r, -a, a - 180.0"),
    ("嘴压成一根粗棒（弧深缩到 1.0）",
     "MOUTH_SAG = 8.5", "MOUTH_SAG = 1.0"),
    ("光芒太平（AMP 4 → 谷/峰 0.87）",
     "AMP = 9.0", "AMP = 4.0"),
    ("画布越界（R 44 → 峰 53）",
     "R = 26.0", "R = 44.0"),
    ("眼睛太糊（EYE_RX 3.0 → 20px 下 1.2px）",
     "EYE_RX = 4.8", "EYE_RX = 3.0"),
    ("腮红太小（1.0 → 20px 下 0.4px）",
     "BLUSH_R = 4.0", "BLUSH_R = 1.0"),
    ("眼睛跑到脸外（EYE_Y 70）",
     "EYE_Y = 43.0", "EYE_Y = 70.0"),
    ("左右不对称（右眼横向偏移）",
     "EYES = ((CX - EYE_DX, EYE_Y), (CX + EYE_DX, EYE_Y))",
     "EYES = ((CX - EYE_DX, EYE_Y), (CX + EYE_DX + 3.0, EYE_Y))"),
    ("高光盖住整只眼（hr 0.9）",
     "GLINT = (-0.34, -0.34, 0.36)", "GLINT = (-0.34, -0.34, 0.90)"),
    ("8 尖相位偏移（正上方变谷）",
     "PHASE = 0.0", "PHASE = 22.5"),
]

print(f"{'注入':<38} {'结果':<10} 失败项")
print("-" * 92)
allgood = True
for label, old, new in CASES:
    if old not in orig:
        print(f"{label:<38} ❌ 注入点未找到: {old}")
        allgood = False
        continue
    open(SRC, "w").write(orig.replace(old, new, 1))
    for m in [m for m in list(sys.modules) if m.startswith("sunny_geom")]:
        del sys.modules[m]
    import sunny_geom as G
    importlib.reload(G)
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        res = G.sanity()
    failed = [n for n, ok in res if not ok]
    status = "✅ 抓到" if failed else "❌ 漏过"
    if not failed:
        allgood = False
    print(f"{label:<38} {status:<10} {'; '.join(failed[:2]) if failed else '（自检恒真！）'}")

open(SRC, "w").write(orig)
print()
print("✅ 全部注入都被告警捕获" if allgood else "❌ 存在漏过的注入（自检不够严）")
