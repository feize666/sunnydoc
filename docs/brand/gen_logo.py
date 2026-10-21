#!/usr/bin/env python3
"""Sunny v4 生成器 —— 从 `sunny_geom.py`（唯一来源）出 SVG + PNG。

v4 相对 v3 的改（都由「看 ASCII 读出来的丑」驱动，逐条可复算）：

## 1. 光芒：分离圆头棒 → **连续尖角轮廓**

v3 是「圆盘 + 3 根圆头棒」，棒与盘之间要留净间隙，而间隙在小尺寸会被
两侧描边（各 GROW）吃掉 → 20px 下光芒与脸焊成一块（实测 ASCII 里
光芒退化成「深色方块」）。改为**极坐标连续的波浪轮廓**：
一条闭合曲线，谷=脸半径、峰=脸半径+amp，凹凸随尺寸等比缩放，
20px 下也分得开，且描边连续、无内部缝合线。

## 2. 五官：算出来的比例，不是摆出来的

- **嘴**：关键不是角度而是「弧深 / 线宽」。v3 该比值 **0.59**（弧的弯曲量
  小于线宽本身）→ 无论坐标多对，渲染出来都是一根粗棒。
  v4 取弦宽 17.5、弧深 6.5、线宽 1.9 → 比值 **3.4**。
- **眼睛**：v3 纯深色圆点（呆）。v4 竖椭圆 9.6×12.6 且带白色高光
  （半径 = 眼宽 1/3）→ 20px 下高光 0.64px，32px 下 1.03px。

## 3. 描边：6.5 → 3.0

v3 深色占比 **37.1%**（128px），视觉被深棕框住。v4 降到 ~8%
（20px 下 0.60px，仍能勾出轮廓）。

## 4. 加「光照」语义

光芒向上多、向下少（相位 22.5°，上下一对尖角 + 左右舒展），
静态图形里也能读出「朝上发光」。
"""
import math
import os
import struct
import sys
import zlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sunny_geom as G  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
OUTS = os.path.join(HERE, "svg")
OUTP = os.path.join(HERE, "candidates")


def _hx(s):
    s = s.lstrip("#")
    return tuple(int(s[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


def _hx255(s):
    s = s.lstrip("#")
    return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))


# --------------------------- 光栅化 ---------------------------

def render(size, ss=None):
    """渲染成 RGBA。

    ## 描边必须与 SVG 的 `stroke` **同语义**（否则预览图和落地图不一致）

    🔴 首版用的是「膨胀法」：先画 `body(+grow)` 的深棕**实心**形状，再在上面
       画 `body(0)` 的黄色 —— 效果是**描边只往外长**（深棕带 = [r, r+grow]）。
       而 SVG 侧用的是 `stroke-width = 2·grow`，它是**以路径为中心**的
       （深棕带 = [r−grow, r+grow]）。两者画出来的轮廓粗细差一倍，
       而且在尖角处差异最明显 —— 我在预览页看到的效果图与真实落地图不是一回事。

    ✅ 正确做法（与 SVG 等价）：深棕实心 `body(+grow)` 打底，
       上面盖**缩小**的黄色 `body(−grow)`。这样露出的深棕带正好是
       `[r−grow, r+grow]`，和 `stroke` 完全一致；黄色可见区也正确地止于 `r−grow`。
    """
    ss = (4 if size <= 96 else 1) if ss is None else ss
    W = size * ss
    grow = G.OUTLINE_STROKE / 2.0
    layers = [
        (G.body(grow), _hx(G.OUTLINE), 1.0),
        (G.body(-grow), _hx(G.SUN), 1.0),
    ]
    if G.BLUSH_R > 0:
        layers.append((G.blush(), _hx(G.BLUSH), G.BLUSH_ALPHA))
    layers.append((G.face(0.0), _hx(G.FACE), 1.0))
    if G.GLINT:
        layers.append((G.glint(), (1.0, 1.0, 1.0), 1.0))

    buf = [[0.0] * (W * W) for _ in range(4)]
    for py in range(W):
        for px in range(W):
            sx, sy = (px + 0.5) / W * G.S, (py + 0.5) / W * G.S
            r = g = b = at = 0.0
            for fn, col, alpha in layers:
                cov = fn(sx, sy)
                if cov <= 0:
                    continue
                sa = cov * alpha
                r = col[0] * sa + r * (1 - sa)
                g = col[1] * sa + g * (1 - sa)
                b = col[2] * sa + b * (1 - sa)
                at = sa + at * (1 - sa)
            i = py * W + px
            if at > 0:
                buf[0][i] = min(255.0, r / at * 255)
                buf[1][i] = min(255.0, g / at * 255)
                buf[2][i] = min(255.0, b / at * 255)
                buf[3][i] = min(255.0, at * 255)
    out = bytearray()
    n = ss * ss
    for y in range(size):
        for x in range(size):
            acc = [0.0] * 4
            for j in range(ss):
                base = (y * ss + j) * W + x * ss
                for i in range(ss):
                    k = base + i
                    for ch in range(4):
                        acc[ch] += buf[ch][k]
            out += bytes(min(255, max(0, round(v / n))) for v in acc)
    return bytes(out)


def _chunk(tag, data):
    return (struct.pack(">I", len(data)) + tag + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))


def write_png(path, w, h, rgba):
    raw = b""
    for y in range(h):
        raw += b"\x00" + rgba[y * w * 4:(y + 1) * w * 4]
    png = b"\x89PNG\r\n\x1a\n"
    png += _chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
    png += _chunk(b"IDAT", zlib.compress(raw, 9))
    png += _chunk(b"IEND", b"")
    open(path, "wb").write(png)


# --------------------------- SVG ---------------------------

def r2(v):
    s = f"{v:.2f}".rstrip("0").rstrip(".")
    return s or "0"


def outline_d(steps=288, sx=1.0, rscale=1.0, cy=None):
    """连续尖角轮廓 → 一条闭合 path。

    为什么用 **288 段折线** 而不是更高密度：
      实测段数与「最大弦偏差」的关系（100 单位坐标系）：
        720 段 → 0.25 单位（20px 下 0.05px）
        288 段 → 0.62 单位（20px 下 0.12px）  ← 取这里
        160 段 → 1.07 单位（20px 下 0.21px）
      288 段在最小真实展示尺寸下偏差 0.12px（肉眼不可分），而路径长度只有
      720 段的一半。再降就会在 128px 以上看出多边形棱角。

    **描边不另画一层膨胀路径**，直接用 `stroke`（见 build_logo）：
      膨胀法在尖角的凹侧会让描边局部变厚、凸侧变薄；`stroke` 是**均匀**的，
      且只需一条 path（体积减半）。

    sx / rscale：水平缩放与径向缩放（favicon 整体缩小用）。
    cy：垂直中心（默认 G.CY）。
    """
    cy = G.CY if cy is None else cy
    pts = []
    for i in range(steps):
        th = 2 * math.pi * i / steps
        r = G.outline_radius(th) * rscale
        x = G.CX + r * math.cos(th)
        y = G.CY - r * math.sin(th)          # 数学约定（y 向上）→ 画布（y 向下）
        pts.append((50.0 + (x - 50.0) * sx, cy + (y - G.CY) * rscale))
    d = f"M{r2(pts[0][0])},{r2(pts[0][1])}"
    for x, y in pts[1:]:
        d += f"L{r2(x)},{r2(y)}"
    return d + "Z"


def mouth_path():
    p = G.mouth_pts()
    d = f"M{r2(p[0][0])},{r2(p[0][1])}"
    for x, y in p[1:]:
        d += f"L{r2(x)},{r2(y)}"
    return d


def build_logo():
    """主 logo：**透明底**（随页面主题背景显示）。

    夕阳黄本体 + 深棕描边（`stroke`，非膨胀层）+ 腮红 + 五官 + 高光。
    """
    parts = [
        f'<path d="{outline_d()}" fill="{G.SUN}" stroke="{G.OUTLINE}" '
        f'stroke-width="{r2(G.OUTLINE_STROKE)}" stroke-linejoin="round"/>',
    ]
    if G.BLUSH_R > 0:
        for bx, by in G.BLUSHES:
            parts.append(f'<circle cx="{r2(bx)}" cy="{r2(by)}" r="{r2(G.BLUSH_R)}" '
                         f'fill="{G.BLUSH}" fill-opacity="{r2(G.BLUSH_ALPHA)}"/>')
    for ex, ey in G.EYES:
        parts.append(f'<ellipse cx="{r2(ex)}" cy="{r2(ey)}" rx="{r2(G.EYE_RX)}" '
                     f'ry="{r2(G.EYE_RY)}" fill="{G.FACE}"/>')
    parts.append(f'<path d="{mouth_path()}" fill="none" stroke="{G.FACE}" '
                 f'stroke-width="{r2(G.MOUTH_HALF*2)}" stroke-linecap="round"/>')
    if G.GLINT:
        hx, hy, hr = G.GLINT
        for ex, ey in G.EYES:
            parts.append(f'<circle cx="{r2(ex+hx*G.EYE_RX)}" cy="{r2(ey+hy*G.EYE_RY)}" '
                         f'r="{r2(hr*G.EYE_RX)}" fill="#FFFFFF"/>')
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" '
            'width="100" height="100" role="img" aria-label="Sunny">\n  '
            + "\n  ".join(parts) + "\n</svg>\n")


def build_favicon():
    """favicon：**自带浅暖白圆角底**（标签页没有可依赖的页面背景，明暗不定）。"""
    s = 0.90  # 缩到 90%，给圆角底留出边距（描边外缘 = 峰 35 × 0.9 = 31.5 + 1.5）

    def map_pt(x, y):
        return 50 + (x - 50) * s, 50 + (y - 50) * s

    parts = [f'<rect width="100" height="100" rx="20" ry="20" fill="#FFF8E1"/>',
             f'<path d="{outline_d(sx=s, rscale=s)}" fill="{G.SUN}" '
             f'stroke="{G.OUTLINE}" stroke-width="{r2(G.OUTLINE_STROKE*s*1.15)}" '
             f'stroke-linejoin="round"/>']
    if G.BLUSH_R > 0:
        for bx, by in G.BLUSHES:
            x, y = map_pt(bx, by)
            parts.append(f'<circle cx="{r2(x)}" cy="{r2(y)}" r="{r2(G.BLUSH_R*s)}" '
                         f'fill="{G.BLUSH}" fill-opacity="{r2(G.BLUSH_ALPHA)}"/>')
    for ex, ey in G.EYES:
        x, y = map_pt(ex, ey)
        parts.append(f'<ellipse cx="{r2(x)}" cy="{r2(y)}" rx="{r2(G.EYE_RX*s)}" '
                     f'ry="{r2(G.EYE_RY*s)}" fill="{G.FACE}"/>')
    mp = " ".join(f"L{r2(p[0])},{r2(p[1])}" for p in
                  [map_pt(x, y) for x, y in G.mouth_pts()])
    parts.append(f'<path d="M{mp[1:]}" fill="none" stroke="{G.FACE}" '
                 f'stroke-width="{r2(G.MOUTH_HALF*2*s)}" stroke-linecap="round"/>')
    if G.GLINT:
        hx, hy, hr = G.GLINT
        for ex, ey in G.EYES:
            x, y = map_pt(ex + hx * G.EYE_RX, ey + hy * G.EYE_RY)
            parts.append(f'<circle cx="{r2(x)}" cy="{r2(y)}" r="{r2(hr*G.EYE_RX*s)}" '
                         f'fill="#FFFFFF"/>')
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" '
            'width="64" height="64" role="img" aria-label="Sunny">\n  '
            + "\n  ".join(parts) + "\n</svg>\n")


def main():
    os.makedirs(OUTS, exist_ok=True)
    os.makedirs(OUTP, exist_ok=True)
    for name, svg in (("sunny-face.svg", build_logo()),
                      ("favicon-sunny.svg", build_favicon())):
        open(os.path.join(OUTS, name), "w").write(svg)
        print(f"  svg/{name:22} {len(svg):>7} bytes")
    for size in (512, 128, 56, 32, 20):
        write_png(os.path.join(OUTP, f"sunny-face__{size}.png"), size, size, render(size))
        print(f"  candidates/sunny-face__{size}.png")
    print()
    print("=== 几何自检 ===")
    ok = True
    for name, passed in G.sanity():
        ok &= passed
        print(f"  {'✅' if passed else '❌'} {name}")
    print()
    print("✅ 全部通过" if ok else "❌ 存在失败项")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
