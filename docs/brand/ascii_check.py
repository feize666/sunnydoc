#!/usr/bin/env python3
"""用**最终 sunny_geom（唯一来源）**渲染真实像素 ASCII —— 验收用。"""
import sys

sys.path.insert(0, ".")
import sunny_geom as G  # noqa: E402
import gen_logo as R  # noqa: E402


def px(size, ss=4):
    img = R.render(size, ss=ss)
    grow = G.GROW
    b_out, b_sun = G.body(grow), G.body(0.0)
    blu = G.blush() if G.BLUSH_R > 0 else None
    fa = G.face(0.0)
    gl = G.glint() if G.GLINT else None
    lines = []
    for y in range(size):
        line = ""
        for x in range(size):
            i = (y * size + x) * 4
            if img[i + 3] < 100:
                line += " "
                continue
            sx, sy = (x + .5) / size * 100, (y + .5) / size * 100
            if gl and fa(sx, sy) > .5 and gl(sx, sy) > .5:
                line += "*"
            elif fa(sx, sy) > .5:
                line += "M" if G._bar(sx, sy,
                                      *G.mouth_pts()[0], *G.mouth_pts()[1], 0) > 2 else "E"
                is_eye = any(G._ellipse(sx, sy, ex, ey, G.EYE_RX, G.EYE_RY) > .5
                             for ex, ey in G.EYES)
                line = line[:-1] + ("E" if is_eye else "M")
            elif blu and blu(sx, sy) > .5:
                line += "o"
            else:
                line += "%" if b_sun(sx, sy) > .5 else "#"
        lines.append(line)
    return lines


if __name__ == "__main__":
    for s in (56, 32, 20):
        print(f"\n=== {s}×{s} px（界面真实展示尺寸）===")
        for row in px(s):
            print("  |" + row + "|")
