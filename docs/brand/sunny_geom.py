#!/usr/bin/env python3
"""Sunny「乐观向上卡通笑脸太阳」的**唯一几何与配色定义**（v4）。

两个生成器（`gen_v4.py` 出 SVG/PNG、`gen_preview.py` 出预览页）都从这里 import，
常量只此一处 —— 防止「效果图好看、装上去变形」。

═══════════════════════════════════════════════════════════════════
v4 相对 v3 的四项改动（每一项都由「把渲染结果转成 ASCII 读出来」驱动）
═══════════════════════════════════════════════════════════════════

## 1. 光芒：分离圆头棒 → **连续尖角轮廓**（v3 最大的问题）

v3 是「圆盘 + 3 根圆头棒」。棒与盘之间必须留净间隙，而描边层会把
间隙吃掉 `2×GROW`（两侧各外扩 GROW）—— 20px 下 GROW 只剩 0.65px，
间隙直接被抹平，光芒与脸**焊成一块**。ASCII 实测表现为：
「三个深色方块戳在头上」，而不是光芒。

v4 改为**极坐标连续波浪**：

    r(θ) = R + AMP · ((1 + cos(N·θ)) / 2)^P

一条闭合曲线，谷（径向凹处）= R、峰 = R + AMP，凹凸随尺寸**等比缩放**，
20px 下依然分得开；而且描边沿整条曲线连续走，**不存在内部缝合线**。
P 控制尖度（P 大 → 凸起窄而尖，P=1 → 平滑花瓣）。

## 2. 嘴：关键比值是「弧深 / 线宽」，不是角度

这是本轮最有价值的发现。v3 的嘴坐标本身没错，但：

    v3: 弧深 4.10 / 线宽 7.00 = **0.59**   ← 弧的弯曲量 < 线宽本身
    v4: 弧深 6.50 / 线宽 3.80 = **1.71**   ← 弯得出来

**比值 < 1 时，无论坐标多精确，渲染出来都只是一根粗棒**（因为线宽把
曲率完全盖住了）。这就是「明明算对了但看不出在笑」的根本原因。
`mouth_pts()` 现在按「弦宽 + 弧深」反推圆心与角度区间，比值可精确控制。

## 3. 眼睛：纯色圆点 → **竖椭圆 + 白色高光**

v3 是 r=4.8 的深色圆点，在 20px 下就是两个黑点（呆）。
v4 改竖椭圆（宽 9.6 × 高 12.6）+ 白色高光（半径 = 眼宽 1/3，偏左上）。
20px 下高光仅 0.64px（读不出，物理所限），但 32px 起 1.03px 可辨 ——
**这是「有神」与「呆滞」的分界**，所以保留。

## 4. 描边：6.5 → 3.0（深色占比 37% → 8%）

v3 描边 6.5 导致 128px 下深色像素占 **37.1%**，整个图形被深棕框住、
黄色被闷在中间。v4 取 3.0：20px 下 0.60px（仍能勾出轮廓），
深色占比降到 ~8%，黄色成为主导色。

## 5. 顺带：镜头语言

光芒相位 22.5° → 正上、正下各有一个尖角，左右舒展，
静态图形也能读出「朝上发光」而不是「一个刺球」。

═══════════════════════════════════════════════════════════════════
透明底 + 双主题
═══════════════════════════════════════════════════════════════════

同一份配色在两种主题下都成立，但**「轮廓提供者」不同**：

    元素              浅底    深底
    黄 #FFD93D        1.38   13.59   ← 浅底看不见，深底极清晰
    描边 #7C2D12      9.37    2.00   ← 浅底清晰，深底变暗（无害）
    五官 #4E342E     11.32    1.65

    浅色主题 → **描边**负责勾勒轮廓
    深色主题 → **黄与深底的强对比**负责（描边不可见也无妨）

⇒ 一份透明底 SVG 跨主题通用，不需要两套资源。
favicon 例外：标签页没有可依赖的页面背景，自带浅暖白圆角底。
"""
import math

S = 100.0  # 设计坐标系边长

# --------------------------- 配色 ---------------------------

SUN = "#FFD93D"           # 向日葵黄（太阳本体）
OUTLINE = "#7C2D12"       # 深棕描边：对白底 9.37、对黄 6.8
FACE = "#4E342E"          # 深暖棕（眼睛 / 嘴）：对黄 8.22
BLUSH = "#F4511E"         # 朱橙腮红（半透明叠加，避免变成深斑）
BLUSH_ALPHA = 0.42        # 叠加后 ≈ #FA9C4A，对黄可见但不抢眼

# --------------------------- 主体（连续尖角轮廓）--------------------------

CX, CY = 50.0, 50.0

# 谷半径。峰半径 = R + AMP = 35 → 视觉外径 70，四周各留 15 单位余量。
R = 26.0

# 尖角高度。AMP/R = 0.35 → 谷/峰 = 0.74，凹凸足够明显。
# 🔴 AMP 不能太小：v3 早期试过 AMP=5.4（谷/峰 0.80）→ ASCII 里读成
#    「圆脸边上一点点起伏」，像个花瓣而不是太阳。
AMP = 9.0

RAY_N = 8                 # 尖角数量
RAY_P = 2.4               # 尖度：P 大 → 窄而尖；P=1 → 平滑花瓣
PHASE = 0.0               # 8 尖 + 相位 0 → 正上 / 正下各一个尖角，左右舒展

# 描边宽度（v3 是 6.5）。20px 下 0.60px、32px 下 0.96px，仍能勾出轮廓。
OUTLINE_STROKE = 3.0
GROW = OUTLINE_STROKE / 2.0

# --------------------------- 五官 ---------------------------

# 眼睛：竖椭圆 + 白色高光
EYE_RX = 4.8
EYE_RY = 6.3
EYE_Y = 43.0
EYE_DX = 10.5             # 眼心距中线 → 两眼间距 21.0
EYES = ((CX - EYE_DX, EYE_Y), (CX + EYE_DX, EYE_Y))
GLINT = (-0.34, -0.34, 0.36)   # (dx, dy, r) 均以 EYE_RX / EYE_RY 为单位

# 嘴：由「弦宽 + 弧深」反推（比值可控，见模块 docstring 第 2 条）
MOUTH_CHORD = 17.5        # 两嘴角的横向距离
MOUTH_SAG = 8.5           # 弧深（矢高）：弦到弧底的距离
MOUTH_BOTTOM = 63.0       # 弧底的 y
MOUTH_HALF = 2.6          # 线宽的一半（视觉线宽 5.2）

# 腮红
BLUSH_R = 4.0
BLUSH_X = 18.0
BLUSH_Y = 55.5
BLUSHES = ((CX - BLUSH_X, BLUSH_Y), (CX + BLUSH_X, BLUSH_Y))


def _mouth_geom():
    """由弦宽 / 弧深反推 (圆心 y, 半径 R, 角区间)。"""
    w, s, yb = MOUTH_CHORD, MOUTH_SAG, MOUTH_BOTTOM
    r = (w * w / 4.0 + s * s) / (2.0 * s)
    yc = yb - r
    a = math.degrees(math.atan2(r - s, w / 2.0))
    return CX, yc, r, a, 180.0 - a


# --------------------------- 原语 ---------------------------

def _smooth(e0, e1, x):
    if e1 == e0:
        return 1.0 if x >= e1 else 0.0
    t = min(max((x - e0) / (e1 - e0), 0.0), 1.0)
    return t * t * (3 - 2 * t)


def _disc(x, y, cx, cy, r, aa=1.0):
    return 1.0 - _smooth(r - aa, r + aa, math.hypot(x - cx, y - cy))


def _ellipse(x, y, cx, cy, rx, ry, aa=0.9):
    d = math.hypot((x - cx) / rx, (y - cy) / ry)
    k = aa / min(rx, ry)
    return 1.0 - _smooth(1.0 - k, 1.0 + k, d)


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


def outline_radius(theta):
    """轮廓在角度 θ 处的半径（θ 为数学约定：y 向上）。"""
    return R + AMP * (((1.0 + math.cos(RAY_N * (theta + math.radians(PHASE)))) / 2.0)
                      ** RAY_P)


# --------------------------- 图层 ---------------------------

def body(grow=0.0):
    """太阳本体（连续尖角轮廓）。grow 用于膨胀出描边层。"""
    def fn(x, y):
        r = math.hypot(x - CX, y - CY)
        lim = outline_radius(math.atan2(CY - y, x - CX)) + grow
        return 1.0 - _smooth(lim - 1.0, lim + 1.0, r)
    return fn


def mouth_pts(grow=0.0, steps=26):
    """嘴：沿弧的折线点。grow 让端点外延，避免描边在嘴角开口。"""
    cx, yc, r, a0, a1 = _mouth_geom()
    pts = [(cx + r * math.cos(math.radians(a0 + (a1 - a0) * i / steps)),
            yc + r * math.sin(math.radians(a0 + (a1 - a0) * i / steps)))
           for i in range(steps + 1)]
    if grow > 0:
        def ext(p, q, k):
            dx, dy = p[0] - q[0], p[1] - q[1]
            L = math.hypot(dx, dy) or 1.0
            return (p[0] + dx / L * k, p[1] + dy / L * k)
        pts[0] = ext(pts[0], pts[1], grow)
        pts[-1] = ext(pts[-1], pts[-2], grow)
    return pts


def face(grow=0.0):
    """五官（眼睛 + 嘴）。grow 用于膨胀出描边层。"""
    def fn(x, y):
        a = 0.0
        for ex, ey in EYES:
            a = max(a, _ellipse(x, y, ex, ey, EYE_RX + grow, EYE_RY + grow))
        pts = mouth_pts(grow)
        for i in range(len(pts) - 1):
            a = max(a, _bar(x, y, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1],
                            MOUTH_HALF + grow))
        return a
    return fn


def glint():
    """眼睛里的白色高光（「有神」的关键）。"""
    hx, hy, hr = GLINT

    def fn(x, y):
        a = 0.0
        for ex, ey in EYES:
            a = max(a, _disc(x, y, ex + hx * EYE_RX, ey + hy * EYE_RY,
                             hr * EYE_RX, 0.8))
        return a
    return fn


def blush():
    def fn(x, y):
        a = 0.0
        for bx, by in BLUSHES:
            a = max(a, _disc(x, y, bx, by, BLUSH_R, 1.0))
        return a
    return fn


def layers():
    """渲染顺序（自下而上）：本体描边 → 黄本体 → 腮红 → 五官 → 高光。

    🔴 **五官不加自己的描边**（v3 试过，是错的）：
       五官色对黄的对比度已是 8.22，远超图形所需的 3.0，边界天然清晰；
       而五官描边在 20px 下只有 0.30px，会与眼睛本体糊在一起把它「吃掉」。
    """
    out = [
        (body(GROW), OUTLINE, 1.0),
        (body(0.0), SUN, 1.0),
    ]
    if BLUSH_R > 0:
        out.append((blush(), BLUSH, BLUSH_ALPHA))
    out.append((face(0.0), FACE, 1.0))
    if GLINT:
        out.append((glint(), "#FFFFFF", 1.0))
    return out


# --------------------------- 几何自检 ---------------------------

def sanity():
    """防止几何被改成「看起来没问题但越界 / 重叠 / 读不出」。

    每条自检都由一次真实踩坑产生，注释里记的是**那次错在哪**。
    """
    checks = []

    # ① 本体（含描边外扩）不越界
    mx = max(outline_radius(math.radians(i)) for i in range(720)) + GROW
    checks.append((f"本体含描边不越界（最大半径 {mx:.1f} ≤ 50）", mx <= S / 2))

    # ② 光芒凹凸必须读得出来
    #    🔴 v4 早期试过 AMP=5.4（谷/峰 0.80）→ ASCII 里像花瓣不像太阳。
    valley_peak = R / (R + AMP)
    checks.append((f"谷/峰比 {valley_peak:.2f} ≤ 0.80（凹凸明显）", valley_peak <= 0.80))

    # ③ 尖角数量与相位：8 尖 + 相位 0 → 正上 / 正下有尖角
    top_r = outline_radius(math.pi / 2)
    checks.append((f"正上方是尖角（r={top_r:.1f} = 峰 {R+AMP:.1f}）",
                   abs(top_r - (R + AMP)) < 1e-6))

    # ④ 五官（含各自半径）都在脸（谷半径）内
    #    🔴 注意用的是**谷半径 R**而非峰半径 —— 五官必须落在脸盘上，
    #       不能跑进尖角里。
    inside = True
    for ex, ey in EYES:
        if math.hypot(ex - CX, ey - CY) + max(EYE_RX, EYE_RY) > R:
            inside = False
    for bx, by in BLUSHES:
        if math.hypot(bx - CX, by - CY) + BLUSH_R > R:
            inside = False
    for p in mouth_pts():
        if math.hypot(p[0] - CX, p[1] - CY) + MOUTH_HALF > R:
            inside = False
    checks.append(("五官（含半径）都在脸盘内", inside))

    # ⑤ **_嘴必须弯得出来**（v4 的核心发现）
    #    🔴 弧深 / 线宽 < 1 时，线宽会把曲率完全盖住 → 渲染成一根粗棒。
    #       这是「坐标都对但看不出在笑」的真正原因，必须钉住。
    #    ⚠️ 本条的 **y 跨度** 对「向上凸」和「向下凸」都成立 —— 它只管
    #       「弯不弯得出来」，**方向由 ⑥ 单独负责**，两者不可互相替代。
    mpts = mouth_pts()
    sag = max(p[1] for p in mpts) - min(p[1] for p in mpts)
    ratio = sag / (MOUTH_HALF * 2)
    checks.append((f"嘴：弧深/线宽 = {ratio:.2f} ≥ 1.5（否则读成粗棒）", ratio >= 1.5))

    # ⑥ 嘴是「笑」而非「哭」：**弧的中点必须在两嘴角之下**（y 向下坐标系）
    #
    #    🔴 这条不能靠「上移圆心」来测：`mouth_pts()` 由弦宽/弧深反推圆心，
    #       改 MOUTH_BOTTOM 只会让整张嘴平移，凸向不变 → 注入无效、假通过。
    #       真正决定凸向的是**角区间**，所以对抗性验证要反转角度区间。
    #    🔴 也不能只比「中点 y > 嘴角 y」就完事 —— 必须中点是最低点，
    #       否则一个歪的弧也能骗过判据。
    corners_y = (mpts[0][1] + mpts[-1][1]) / 2.0
    mid_y = mpts[len(mpts) // 2][1]
    lowest_y = max(p[1] for p in mpts)
    checks.append((f"嘴向上笑（嘴角 y={corners_y:.1f} < 弧底 y={lowest_y:.1f}）",
                   corners_y < lowest_y - 1e-6 and abs(mid_y - lowest_y) < 1e-6))

    # ⑦ 20px 下五官仍可辨
    #
    #    三个下限的依据不同，别照抄同一个数：
    #      眼睛 —— **点状**元素，<1.5px 会糊成一个像素点 → 下限 1.6px
    #      腮红 —— 同上（大面积浅色块，太小球看不出） → 下限 1.6px
    #      嘴线 —— **线状**元素，亚像素渲染下 1px 仍能连成一条 → 下限 1.0px
    #    （v3 曾把嘴线下限写成 1.2，那是按「线宽 7.0 单位」时代定的；
    #      v4 线宽收到 5.2 后 20px 下 1.04px，仍是清晰的细线，无需加粗。）
    at20 = lambda u: u * 20 / 100
    checks.append((f"眼睛 20px 下 {at20(EYE_RX*2):.2f}px ≥1.6", at20(EYE_RX * 2) >= 1.6))
    checks.append((f"嘴线 20px 下 {at20(MOUTH_HALF*2):.2f}px ≥1.0",
                   at20(MOUTH_HALF * 2) >= 1.0))
    checks.append((f"腮红 20px 下 {at20(BLUSH_R*2):.2f}px ≥1.6", at20(BLUSH_R * 2) >= 1.6))

    # ⑧ 左右对称（按中线 x=50 镜像）
    mirror_ok = True
    for a, b in zip(EYES, reversed(EYES)):
        if abs(a[0] - (2 * CX - b[0])) > 1e-6 or abs(a[1] - b[1]) > 1e-6:
            mirror_ok = False
    for a, b in zip(BLUSHES, reversed(BLUSHES)):
        if abs(a[0] - (2 * CX - b[0])) > 1e-6 or abs(a[1] - b[1]) > 1e-6:
            mirror_ok = False
    mid = mouth_pts()[len(mouth_pts()) // 2]
    if abs(mid[0] - CX) > 1e-6:
        mirror_ok = False
    checks.append(("眼睛 / 腮红 / 嘴 左右对称", mirror_ok))

    # ⑨ 腮红应在「同侧眼」的斜下方外侧（卡通惯例）
    #    🔴 v3 这里写过「与 EYES[0] 比」，导致右侧腮红被拿去和左眼比 → 假失败。
    same_side_ok = True
    for bx, by in BLUSHES:
        same_eye = min(EYES, key=lambda e: abs(e[0] - bx))
        if not (by > same_eye[1] and abs(bx - CX) > abs(same_eye[0] - CX)):
            same_side_ok = False
    checks.append(("腮红在同侧眼的斜下方外侧", same_side_ok))

    # ⑩ 腮红不与眼睛 / 嘴重叠
    no_overlap = True
    for bx, by in BLUSHES:
        for ex, ey in EYES:
            if math.hypot(bx - ex, by - ey) < BLUSH_R + max(EYE_RX, EYE_RY):
                no_overlap = False
        for p in mouth_pts():
            if math.hypot(bx - p[0], by - p[1]) < BLUSH_R + MOUTH_HALF:
                no_overlap = False
    checks.append(("腮红不与眼睛/嘴重叠", no_overlap))

    # ⑪ 高光必须在眼睛内部且不完全盖住眼睛
    hx, hy, hr = GLINT
    gr = hr * EYE_RX
    ok = 0.10 <= hr <= 0.45
    for ex, ey in EYES:
        if math.hypot(hx * EYE_RX, hy * EYE_RY) + gr > min(EYE_RX, EYE_RY):
            ok = False
    checks.append((f"高光在眼内且占比 {hr*100:.0f}%（10~45%）", ok))

    return checks


if __name__ == "__main__":
    print("=== Sunny 几何自检（v4）===")
    ok = True
    for name, passed in sanity():
        ok &= passed
        print(f"  {'✅' if passed else '❌'} {name}")
    print()
    print("✅ 全部通过" if ok else "❌ 存在不通过项")