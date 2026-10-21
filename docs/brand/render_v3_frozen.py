#!/usr/bin/env python3
"""重建 **v3（上一版）** 的渲染 —— 仅用于对比页，`sunny_geom.py` 已不含 v3 几何。

## 为什么值得重建

用户上一轮的反馈是「有点太丑了吧」。只说「改好了」没有说服力 ——
必须让用户看到**旧版到底是什么样**。v3 的几何常量已随文件重写消失，
但它在对话记录里是完整可查的（圆盘 r=25 / 描边 6.5 / 3 根圆头棒 /
纯色圆眼 r=4.8 / 嘴线宽 7.0），本文件按原值重建，**不做任何美化**。

⚠️ 本文件**不参与任何交付**，只在生成对比页时被 import。
"""
import math

S = 100.0
SUN, OUTLINE, FACE, BLUSH = "#FFD93D", "#7C2D12", "#4E342E", "#F4511E"
BLUSH_ALPHA = 0.50

# ── v3 原值（照抄，不调）──
DISC_CX, DISC_CY = 50.0, 53.0
DISC_R = 25.0
OUTLINE_STROKE = 6.5
GROW = OUTLINE_STROKE / 2.0
RAY_HALF = 4.5
RAYS = ((45.0, 34.0, 40.0), (90.0, 34.0, 40.0), (135.0, 34.0, 40.0))
EYE_R = 4.8
EYES = ((39.0, 45.0), (61.0, 45.0))
BLUSH_R = 5.0
BLUSHES = ((31.0, 55.0), (69.0, 55.0))
MOUTH_CX, MOUTH_CY = 50.0, 49.0
MOUTH_R = 14.0
MOUTH_A0, MOUTH_A1 = 45.0, 135.0
MOUTH_HALF = 3.5


def _smooth(e0, e1, x):
    if e1 == e0:
        return 1.0 if x >= e1 else 0.0
    t = min(max((x - e0) / (e1 - e0), 0.0), 1.0)
    return t * t * (3 - 2 * t)


def _disc(x, y, cx, cy, r, aa=1.0):
    return 1.0 - _smooth(r - aa, r + aa, math.hypot(x - cx, y - cy))


def _dist_seg(px, py, ax, ay, bx, by):
    vx, vy = bx - ax, by - ay
    wx, wy = px - ax, py - ay
    L2 = vx * vx + vy * vy
    if L2 == 0:
        return math.hypot(wx, wy)
    t = max(0.0, min(1.0, (wx * vx + wy * vy) / L2))
    return math.hypot(px - (ax + t * vx), py - (ay + t * vy))


def _bar(x, y, ax, ay, bx, by, half_w, aa=0.9):
    return 1.0 - _smooth(half_w - aa, half_w + aa, _dist_seg(x, y, ax, ay, bx, by))


def mouth_pts(grow=0.0, steps=24):
    pts = [(MOUTH_CX + MOUTH_R * math.cos(math.radians(MOUTH_A0 + (MOUTH_A1 - MOUTH_A0) * i / steps)),
            MOUTH_CY + MOUTH_R * math.sin(math.radians(MOUTH_A0 + (MOUTH_A1 - MOUTH_A0) * i / steps)))
           for i in range(steps + 1)]
    if grow > 0:
        def ext(p, q, k):
            dx, dy = p[0] - q[0], p[1] - q[1]
            L = math.hypot(dx, dy) or 1.0
            return (p[0] + dx / L * k, p[1] + dy / L * k)
        pts[0] = ext(pts[0], pts[1], grow)
        pts[-1] = ext(pts[-1], pts[-2], grow)
    return pts


def body(grow=0.0):
    def fn(x, y):
        a = _disc(x, y, DISC_CX, DISC_CY, DISC_R + grow, 1.1)
        for ang, r0, r1 in RAYS:
            rad = math.radians(ang)
            x0 = DISC_CX + (r0 - grow) * math.cos(rad)
            y0 = DISC_CY - (r0 - grow) * math.sin(rad)
            x1 = DISC_CX + (r1 + grow) * math.cos(rad)
            y1 = DISC_CY - (r1 + grow) * math.sin(rad)
            a = max(a, _bar(x, y, x0, y0, x1, y1, RAY_HALF + grow))
        return a
    return fn


def face(grow=0.0):
    def fn(x, y):
        a = 0.0
        for ex, ey in EYES:
            a = max(a, _disc(x, y, ex, ey, EYE_R + grow, 1.0))
        pts = mouth_pts(grow)
        for i in range(len(pts) - 1):
            a = max(a, _bar(x, y, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1],
                            MOUTH_HALF + grow))
        return a
    return fn


def blush():
    def fn(x, y):
        a = 0.0
        for bx, by in BLUSHES:
            a = max(a, _disc(x, y, bx, by, BLUSH_R, 1.0))
        return a
    return fn


def _hx(s):
    s = s.lstrip("#")
    return tuple(int(s[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


def render(size, ss=None):
    """v3 描边是**膨胀法**（深棕打底 body(+grow)，黄身 body(0) 盖上去）。"""
    ss = (4 if size <= 96 else 1) if ss is None else ss
    W = size * ss
    layers = [
        (body(GROW), _hx(OUTLINE), 1.0),
        (body(0.0), _hx(SUN), 1.0),
        (blush(), _hx(BLUSH), BLUSH_ALPHA),
        (face(0.0), _hx(FACE), 1.0),
    ]
    buf = [[0.0] * (W * W) for _ in range(4)]
    for py in range(W):
        for px in range(W):
            sx, sy = (px + 0.5) / W * S, (py + 0.5) / W * S
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


def coverage(size):
    img = render(size, ss=1)
    refs = [("sun", tuple(int(SUN.lstrip('#')[i:i + 2], 16) for i in (0, 2, 4))),
            ("dark", tuple(int(OUTLINE.lstrip('#')[i:i + 2], 16) for i in (0, 2, 4))),
            ("blush", None)]
    sun_c = refs[0][1]
    bl_c = tuple(int(BLUSH.lstrip('#')[i:i + 2], 16) for i in (0, 2, 4))
    refs[2] = ("blush", tuple(round(sun_c[i] * (1 - BLUSH_ALPHA) + bl_c[i] * BLUSH_ALPHA)
                              for i in range(3)))
    cnt = {k: 0 for k, _ in refs}
    for i in range(size * size):
        r, g, b, a = img[i * 4:i * 4 + 4]
        if a < 128:
            continue
        d, nm = min((((r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2), n)
                    for n, c in refs)
        if d < 900:
            cnt[nm] += 1
    t = sum(cnt.values()) or 1
    return (round(cnt["sun"] / t * 100, 1), round(cnt["dark"] / t * 100, 1),
            round(cnt["blush"] / t * 100, 1))


if __name__ == "__main__":
    print("v3 重建覆盖率（应与记录一致：128px 黄57.3% 深37.1% 腮红5.6%）")
    for s in (20, 128):
        print(f"  {s:>4}px  黄 {coverage(s)[0]:>5}%  深 {coverage(s)[1]:>5}%  腮红 {coverage(s)[2]:>5}%")