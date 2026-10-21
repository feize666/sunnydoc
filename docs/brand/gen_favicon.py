#!/usr/bin/env python3
"""生成落地 favicon 资源：
  - `web/src/app/icon.svg`      ← 主 favicon（Next.js App Router 约定文件）
  - `web/src/app/favicon.ico`   ← 多尺寸 ICO（**当前缺失，实测 /favicon.ico 返回 404**）
  - `web/src/app/apple-icon.png`← iOS 主屏图标

## 为什么 favicon 与主 logo 不同

主 logo 是**透明底**，靠「页面背景」提供对比。但浏览器标签页背后没有可依赖的
背景（明暗不定、还可能被扩展改色）—— 实测透明版在浅色标签栏上会因
「黄对白 1.38」而糊掉。所以 favicon **自带浅暖白圆角底**（#FFF8E1），
任何环境下都清晰。

## 为什么补 favicon.ico

实测 `/favicon.ico` **404**（`/icon.svg` 是 200）。老浏览器、部分爬虫、
以及某些 RSS/预览服务只请求 `/favicon.ico`，拿不到就显示空白图标。
本脚本补齐该路径。

## ICO 结构（自己写，不引依赖）

    ICONDIR(6) + ICONDIRENTRY(16)×N + 各尺寸 PNG 数据

每个目录项 `width/height` 为 0 表示 256（单字节存不下 256）。
内嵌 PNG（而非 BMP/DIB）由 Vista+ 与现代浏览器全部支持，且体积小一个量级。
"""
import math
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
import sunny_geom as G  # noqa: E402
import gen_logo as GL  # noqa: E402

APP = os.path.join(REPO, "web", "src", "app")

# ── favicon 专属参数（与 gen_logo.build_favicon 的 SVG 版保持一致）──
S = 0.90      # 整体缩放：给圆角底留边距
K = 1.15      # 描边额外加粗：小尺寸下 16px 时描边仅 0.47px，需补
BG = "#FFF8E1"
CORNER_R = 20.0

ICO_SIZES = (16, 32, 48, 256)
APPLE_SIZE = 180


def _hx(s):
    s = s.lstrip("#")
    return tuple(int(s[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


def _map(x, y):
    """把设计坐标（0..100）等比缩放到 favicon 坐标系（仍是 0..100，中心 50,50）。"""
    return 50.0 + (x - 50.0) * S, 50.0 + (y - 50.0) * S


def render_favicon(size, ss=None):
    """渲染 favicon（浅暖白圆角底 + 缩放后的太阳）为 RGBA 字节流。"""
    ss = (4 if size <= 96 else 1) if ss is None else ss
    W = size * ss
    sun, outline, face, blush, bg = (_hx(G.SUN), _hx(G.OUTLINE),
                                     _hx(G.FACE), _hx(G.BLUSH), _hx(BG))

    # 缩放后的几何（全部在 0..100 的 favicon 空间里）
    half = G.OUTLINE_STROKE * S * K / 2.0          # 描边半宽
    eye_rx, eye_ry = G.EYE_RX * S, G.EYE_RY * S
    eyes = [_map(ex, ey) for ex, ey in G.EYES]
    blushes = [_map(bx, by) for bx, by in G.BLUSHES]
    blush_r = G.BLUSH_R * S
    mouth = [_map(x, y) for x, y in G.mouth_pts()]
    mouth_half = G.MOUTH_HALF * S
    hx_, hy_, hr_ = G.GLINT
    glints = [(_map(ex + hx_ * G.EYE_RX, ey + hy_ * G.EYE_RY)[0],
               _map(ex + hx_ * G.EYE_RX, ey + hy_ * G.EYE_RY)[1],
               hr_ * G.EYE_RX * S) for ex, ey in G.EYES]
    rr = CORNER_R * (W / 100.0)                     # 圆角半径（像素）
    gen = 1.0 / (W / 100.0)                         # 1 设计单位 = 多少像素

    def body_fn(grow):
        def fn(x, y):
            dx, dy = x - 50.0, y - 50.0
            r = math.hypot(dx, dy)
            th = math.atan2(-dy, dx)                # 数学约定（y 向上）
            lim = G.outline_radius(th) * S + grow
            aa = 1.0 * gen
            return 1.0 - G._smooth(lim - aa, lim + aa, r)
        return fn

    def face_fn():
        def fn(x, y):
            a = 0.0
            for ex, ey in eyes:
                a = max(a, G._ellipse(x, y, ex, ey, eye_rx, eye_ry, 0.9 * gen))
            for i in range(len(mouth) - 1):
                a = max(a, G._bar(x, y, mouth[i][0], mouth[i][1],
                                  mouth[i + 1][0], mouth[i + 1][1], mouth_half, 0.9 * gen))
            return a
        return fn

    def blush_fn():
        def fn(x, y):
            a = 0.0
            for bx, by in blushes:
                a = max(a, G._disc(x, y, bx, by, blush_r, 1.0 * gen))
            return a
        return fn

    def glint_fn():
        def fn(x, y):
            a = 0.0
            for gx, gy, gr in glints:
                a = max(a, G._disc(x, y, gx, gy, gr, 0.8 * gen))
            return a
        return fn

    def bg_fn():
        """圆角矩形底：把点夹到圆角中心，再看是否超出半径。"""
        def fn(x, y):
            px, py = x / 100.0 * W, y / 100.0 * W
            cx = min(max(px, rr), W - rr)
            cy = min(max(py, rr), W - rr)
            d = math.hypot(px - cx, py - cy)
            return 1.0 - G._smooth(rr - 1.0, rr + 1.0, d)
        return fn

    layers = [
        (bg_fn(), bg, 1.0),
        (body_fn(half), outline, 1.0),          # 描边（膨胀）→ 与 SVG 的 stroke 同语义
        (body_fn(-half), sun, 1.0),             # 黄本体向内收 half
        (blush_fn(), blush, G.BLUSH_ALPHA),
        (face_fn(), face, 1.0),
        (glint_fn(), (1.0, 1.0, 1.0), 1.0),
    ]

    buf = [[0.0] * (W * W) for _ in range(4)]
    for py in range(W):
        for px in range(W):
            x, y = (px + 0.5) / W * 100, (py + 0.5) / W * 100
            r = g = b = at = 0.0
            for fn, col, alpha in layers:
                cov = fn(x, y)
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


def png_bytes(w, rgba):
    """用 gen_logo 的 PNG 写入器产出内存中的 PNG 字节。"""
    import io
    import tempfile
    fd, tmp = tempfile.mkstemp(suffix=".png")
    os.close(fd)
    try:
        GL.write_png(tmp, w, w, rgba)
        return open(tmp, "rb").read()
    finally:
        os.remove(tmp)


def build_ico(entries):
    """entries: [(size, png_bytes), ...] → ICO 字节。"""
    n = len(entries)
    header = struct.pack("<HHH", 0, 1, n)
    dir_size = 16 * n
    offset = 6 + dir_size
    dirs, blobs = b"", b""
    for size, data in entries:
        b = 0 if size >= 256 else size
        dirs += struct.pack("<BBBBHHII", b, b, 0, 0, 1, 32, len(data), offset)
        blobs += data
        offset += len(data)
    return header + dirs + blobs


def main():
    os.makedirs(APP, exist_ok=True)
    results = []

    # 1) icon.svg —— 直接复用已验收的 favicon SVG
    src_svg = os.path.join(HERE, "svg", "favicon-sunny.svg")
    svg = open(src_svg).read()
    dst_svg = os.path.join(APP, "icon.svg")
    with open(dst_svg, "w") as f:
        f.write(svg)
    results.append(("icon.svg", len(svg)))

    # 2) favicon.ico —— 多尺寸内嵌 PNG
    entries = []
    for s in ICO_SIZES:
        entries.append((s, png_bytes(s, render_favicon(s))))
    ico = build_ico(entries)
    dst_ico = os.path.join(APP, "favicon.ico")
    with open(dst_ico, "wb") as f:
        f.write(ico)
    results.append(("favicon.ico", len(ico)))

    # 3) apple-icon.png
    apple = png_bytes(APPLE_SIZE, render_favicon(APPLE_SIZE))
    dst_apple = os.path.join(APP, "apple-icon.png")
    with open(dst_apple, "wb") as f:
        f.write(apple)
    results.append(("apple-icon.png", len(apple)))

    for name, n in results:
        print(f"  web/src/app/{name:18} {n:>7} bytes")
    print()
    print(f"ICO 含尺寸: {', '.join(str(s) for s in ICO_SIZES)}")


if __name__ == "__main__":
    main()