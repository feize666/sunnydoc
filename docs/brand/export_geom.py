#!/usr/bin/env python3
"""把 `sunny_geom.py` 的几何**导出为 JSON**，供 Node 侧验证脚本读取。

## 为什么必须导出而不是让 JS 抄一份

上一版 `web/scripts/verify_brand_logo.cjs` 里硬编码了 `discR/eyes/blushR/...`，
并注明「改动需同步」。这正是**最不可靠**的做法 —— 本次把 v3 几何改成 v4
（圆盘 → 连续尖角轮廓、圆点眼 → 椭圆眼、加高光）后，脚本里的常量全部失效，
而它仍然会「通过」，因为断言的采样点已经落在图形之外。**同源才能自证。**

用法：
    python3 export_geom.py            # 写到 docs/brand/geom.json
Node 侧：require("../../docs/brand/geom.json")
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sunny_geom as G  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))


def mouth_bottom_y():
    return max(p[1] for p in G.mouth_pts())


def blush_blended():
    """腮红半透明叠加在黄上的实际渲染色。

    🔴 叠加顺序不能写反：腮红**压在黄上** ⇒ 结果 = 黄·(1−α) + 腮红·α。
       首版写成 腮红·(1−α) + 黄·α，得到 #F98A2B；真实渲染是 #FAA030
       （已用 `gen_logo.render()` 取腮红中心像素复核）。
    """
    def hx(s):
        s = s.lstrip("#")
        return [int(s[i:i + 2], 16) for i in (0, 2, 4)]
    sun, bl = hx(G.SUN), hx(G.BLUSH)
    return "#" + "".join(f"{round(sun[i] * (1 - G.BLUSH_ALPHA) + bl[i] * G.BLUSH_ALPHA):02X}"
                         for i in range(3))


def build():
    mp = G.mouth_pts()
    # 8 尖 + 相位 0 → 峰在 θ = 0°,45°,90°,...；谷在 θ = 22.5°,67.5°,...
    # 🔴 探针必须按**真实峰谷位置**取，不能沿用「圆盘」时代的假设：
    #    θ=45° 是**峰**而非谷（首版误当谷用，导致描边探针落在黄色里）。
    peak_th = math.pi / 2                                  # 正上方 = 峰
    valley_th = math.radians(22.5)                         # 谷
    peak_r = G.outline_radius(peak_th)
    valley_r = G.outline_radius(valley_th)

    def polar(r, th):
        return [round(G.CX + r * math.cos(th), 2), round(G.CY - r * math.sin(th), 2)]

    return {
        "_comment": "由 docs/brand/export_geom.py 程序生成，请勿手改；改几何请改 sunny_geom.py",
        "S": G.S,
        "cx": G.CX, "cy": G.CY,
        "R": G.R, "AMP": G.AMP, "rayN": G.RAY_N, "rayP": G.RAY_P, "phase": G.PHASE,
        "peak": round(peak_r, 2),
        "valleyPeak": round(G.R / (G.R + G.AMP), 3),
        "outlineStroke": G.OUTLINE_STROKE,
        "eyes": [list(e) for e in G.EYES], "eyeRx": G.EYE_RX, "eyeRy": G.EYE_RY,
        "glint": list(G.GLINT),
        "blushes": [list(b) for b in G.BLUSHES], "blushR": G.BLUSH_R,
        "mouthChord": G.MOUTH_CHORD, "mouthSag": G.MOUTH_SAG,
        "mouthBottomY": round(mouth_bottom_y(), 2),
        "mouthHalf": G.MOUTH_HALF,
        "mouthMidX": round(mp[len(mp) // 2][0], 3),
        # ---- 采样点（SVG 的 100×100 用户坐标系）----
        "sunProbe": [G.CX, G.CY - 13.0],                 # 纯黄区（两眼中线偏上）
        # 描边探针：取**峰顶端**再往里 1 单位 —— 那里必然是描边带
        # （stroke 3.0 的一半 = 1.5，故峰半径 ±1.5 内都被描边覆盖）
        "outlineProbe": polar(peak_r - 1.0, peak_th),
        # 峰顶外侧 1 单位：仍应在描边内（证明尖角真的伸出去了）
        "peakProbe": polar(peak_r - 0.6, peak_th),
        # 谷底位置：应为黄色（谷是脸盘的凹口，不是背景）
        "valleyProbe": polar(valley_r - 2.0, valley_th),
        "cornerProbe": [4.0, 4.0],
        # favicon 角点探针：必须在**圆角矩形之内**、且在太阳之外。
        # 圆角 rx=20（100 坐标系）→ 圆角圆心 (20,20)。
        # (12,12) 距圆心 11.3 < 20 ✅ 在矩形内；距图心 53.7 ≫ 峰半径 31.5 ✅ 不在太阳上。
        # 🔴 首版用 (4,4)：距圆角圆心 22.6 > 20 → 落在圆角**外**，
        #    量到的是页面背景而不是 favicon 底色（假失败）。
        "faviconCornerProbe": [12.0, 12.0],
        "colors": {
            "SUN": G.SUN, "OUTLINE": G.OUTLINE, "FACE": G.FACE,
            "BLUSH": G.BLUSH, "BLUSH_BLENDED": blush_blended(),
        },
        "minPx20": {
            "eye": round(G.EYE_RX * 2 * 20 / 100, 2),
            "mouth": round(G.MOUTH_HALF * 2 * 20 / 100, 2),
            "blush": round(G.BLUSH_R * 2 * 20 / 100, 2),
        },
    }


if __name__ == "__main__":
    data = build()
    p = os.path.join(HERE, "geom.json")
    with open(p, "w") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"已导出 → {p}")
    print(f"  峰值半径 {data['peak']} · 谷/峰 {data['valleyPeak']} · "
          f"嘴弧深/线宽 {data['mouthSag']/(data['mouthHalf']*2):.2f}")
    print(f"  20px 下：眼 {data['minPx20']['eye']}px 嘴 {data['minPx20']['mouth']}px "
          f"腮红 {data['minPx20']['blush']}px")