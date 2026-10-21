#!/usr/bin/env python3
"""从 `sunny_geom.py`（几何**唯一来源**）生成 `web/src/components/LogoMark.tsx`。

## 为什么要生成而不是手写 JSX

几何常量一旦在 TSX 里手抄一份，就又多了一个「需要人工同步」的点 ——
本项目已在这一类问题上栽过三次（见 MEMORY.md「几何常量所有消费方都要程序导出」）。
本脚本让 TSX 里的路径与配色**每次重新算**，改 `sunny_geom.py` 后重跑即可。

## 两个导出

- `SunnyGlyph` —— 只画太阳（内联 SVG，透明底，无容器底）
- `LogoMark`  —— 带圆角容器的完整标记（内部用 SunnyGlyph）

## 为什么容器**不带底色**（这是本轮的关键设计决定）

原 `.logo-mark` 是「蓝渐变底 + 白字」。太阳是黄色，实测：

    黄 #FFD93D 对蓝底 #2862f4 = 3.68   ← 太阳糊在蓝里
    描边 #7C2D12 对蓝底        = 1.85   ← 轮廓直接消失

⇒ 蓝底必须去掉。去底后：
    浅色主题：描边对白底 9.37 勾轮廓；
    深色主题：黄对深底 13.59 勾轮廓；
    登录页深蓝 hero（#1e40af）：黄对它 6.33 —— 比白底还清晰。
"""
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
import sunny_geom as G  # noqa: E402
import gen_logo as GL  # noqa: E402

OUT = os.path.join(REPO, "web", "src", "components", "LogoMark.tsx")

# 轮廓路径段数：288 段（实测 20px 下偏差 0.12px，肉眼不可分，体积只有 720 段的一半）
STEPS = 288


def r2(v):
    s = f"{v:.2f}".rstrip("0").rstrip(".")
    return s or "0"


def outline_d():
    """连续尖角轮廓 → 闭合 path（与 gen_logo.outline_d 同一算法）。"""
    pts = []
    for i in range(STEPS):
        th = 2 * math.pi * i / STEPS
        r = G.outline_radius(th)
        pts.append((G.CX + r * math.cos(th), G.CY - r * math.sin(th)))
    d = f"M{r2(pts[0][0])} {r2(pts[0][1])}"
    for x, y in pts[1:]:
        d += f"L{r2(x)} {r2(y)}"
    return d + "Z"


def mouth_d():
    pts = G.mouth_pts()
    d = f"M{r2(pts[0][0])} {r2(pts[0][1])}"
    for x, y in pts[1:]:
        d += f"L{r2(x)} {r2(y)}"
    return d


def build():
    outline = outline_d()
    mouth = mouth_d()
    hx, hy, hr = G.GLINT
    glints = [
        (e[0] + hx * G.EYE_RX, e[1] + hy * G.EYE_RY, hr * G.EYE_RX) for e in G.EYES
    ]
    blush_blend = json.load(open(os.path.join(HERE, "geom.json")))["colors"]["BLUSH_BLENDED"]

    # 🔴 **不要**在 f-string 里写 `{{...}}` 去表达 JSX 的 `{变量}`：
    #    f-string 的 `{{` 退化成字面 `{`，会把 `fill={BLUSH}` 写成 `fill="{BLUSH}"`
    #    （属性变成字符串）；而内层已有 `{` 的行又会把数值包成字符串 `cx="{37.87}"`。
    #    两种畸变都**不会被 tsc 拦下**（JSX 属性接受字符串），只在渲染时表现为
    #    颜色不对 / 坐标是 NaN —— 极难发现。
    #    改用**字符串拼接**，完全绕开转义。
    def jsx_attr(name, val):
        return f'{name}={' + '}'

    glint_jsx = "\n".join(
        '      <circle cx={' + r2(x) + '} cy={' + r2(y) + '} r={' + r2(r)
        + '} fill="#FFFFFF" />'
        for x, y, r in glints
    )
    eye_jsx = "\n".join(
        '      <ellipse cx={' + r2(ex) + '} cy={' + r2(ey) + '} rx={' + r2(G.EYE_RX)
        + '} ry={' + r2(G.EYE_RY) + '} fill={FACE} />'
        for ex, ey in G.EYES
    )
    blush_jsx = "\n".join(
        '      <circle cx={' + r2(bx) + '} cy={' + r2(by) + '} r={' + r2(G.BLUSH_R)
        + '} fill={BLUSH} fillOpacity="' + r2(G.BLUSH_ALPHA) + '" />'
        for bx, by in G.BLUSHES
    )

    return f'''"use client";

/**
 * Sunny 品牌标记 —— **本文件由脚本生成，请勿手改**。
 *
 *   生成器：`docs/brand/gen_component.py`
 *   几何源：`docs/brand/sunny_geom.py`（唯一来源）
 *
 * 改几何请改 `sunny_geom.py` 后重跑：
 *   cd docs/brand && python3 gen_component.py
 *
 * ── 设计要点 ──────────────────────────────────────────────
 *
 * 1. **透明底、无容器底色。** 原 `.logo-mark` 是「蓝渐变底 + 白字」，
 *    而太阳是黄色：实测黄对蓝底仅 3.68、描边对蓝底 1.85 —— 太阳会糊在
 *    蓝底里、轮廓直接消失。去底后双主题都成立：
 *      浅色主题 → 描边 #{G.OUTLINE.lstrip('#')} 对白底 9.37 勾轮廓
 *      深色主题 → 黄 {G.SUN} 对深底 13.59 勾轮廓
 *      登录页深蓝 hero（#1e40af）→ 黄对它 6.33，比白底还清晰
 *
 * 2. **尺寸只由 `size` 决定**，内部 SVG 用 viewBox 等比缩放，
 *    20px（顶栏/AI 助手真实尺寸）下眼睛 1.92px、嘴线 1.04px，均按可辨下限反推。
 *
 * 3. 腮红在半透明叠加后实际为 {blush_blend}（黄上叠朱橙）。
 */

const SUN = "{G.SUN}";
const OUTLINE = "{G.OUTLINE}";
const FACE = "{G.FACE}";
const BLUSH = "{G.BLUSH}";

/** 轮廓与嘴的路径（从 sunny_geom 程序导出，勿手改）。 */
const OUTLINE_D = "{outline}";
const MOUTH_D = "{mouth}";

export interface SunnyGlyphProps {{
  /** 渲染尺寸（px），默认 24。 */
  size?: number;
  className?: string;
}}

/**
 * 只画太阳本体（透明底，无容器）。适合已经自带底色的场合。
 * `aria-hidden` —— 装饰性图形，语义由旁边的品牌文字承担。
 */
export function SunnyGlyph({{ size = 24, className }}: SunnyGlyphProps) {{
  return (
    <svg
      width={{size}}
      height={{size}}
      viewBox="0 0 100 100"
      className={{className}}
      aria-hidden="true"
      focusable="false"
    >
      <path
        d={{OUTLINE_D}}
        fill={{SUN}}
        stroke={{OUTLINE}}
        strokeWidth={{{r2(G.OUTLINE_STROKE)}}}
        strokeLinejoin="round"
      />
{blush_jsx}
{eye_jsx}
      <path
        d={{MOUTH_D}}
        fill="none"
        stroke={{FACE}}
        strokeWidth={{{r2(G.MOUTH_HALF * 2)}}}
        strokeLinecap="round"
      />
{glint_jsx}
    </svg>
  );
}}

export interface LogoMarkProps {{
  /** 容器尺寸（px） */
  size?: number;
  /** 圆角类，默认 `rounded-lg`（8px，对齐项目圆角阶梯）。 */
  rounded?: string;
  className?: string;
}}

/**
 * 带圆角容器的完整标记。**容器不设底色** —— 理由见文件头第 1 条。
 */
export function LogoMark({{
  size = 28,
  rounded = "rounded-lg",
  className,
}}: LogoMarkProps) {{
  return (
    <span
      className={{`inline-grid shrink-0 place-items-center overflow-hidden ${{rounded}} ${{className ?? ""}}`}}
      style={{{{ width: size, height: size }}}}
      data-brand="sunny"
    >
      <SunnyGlyph size={{size}} />
    </span>
  );
}}
'''


if __name__ == "__main__":
    src = build()
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(src)
    print(f"已生成 → {OUT} ({len(src)} bytes)")
    print(f"  轮廓 {STEPS} 段 · 描边 {G.OUTLINE_STROKE} · 峰半径 {G.R + G.AMP}")
    print(f"  20px 下：眼 {G.EYE_RX*2*0.2:.2f}px 嘴 {G.MOUTH_HALF*2*0.2:.2f}px "
          f"腮红 {G.BLUSH_R*2*0.2:.2f}px")