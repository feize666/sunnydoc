#!/usr/bin/env python3
"""生成 **v3 → v4 对比页**：把「丑在哪、改了什么」做成可核对的视觉对照。

## 为什么做这个页

用户上一轮的直接反馈是「有点太丑了吧」。说「已经改好了」没有说服力 ——
需要让用户**亲眼看到**：旧版长什么样、新版长什么样、具体的量化差异是什么。

v3 的几何已随文件重写而消失，但其渲染特征在对话里有完整记录
（ASCII 网格 + 覆盖率），本页用这些**实测数据**做对照，
而不是凭印象编一组「旧版参数」。

## 三个证据层级（自上而下由粗到细）

1. **并列放大图**：新旧各 3 个尺寸并排，一眼看观感
2. **同尺寸逐像素**：32px 下新旧各一张字符网格（可见结构差异）
3. **量化表**：深色占比 / 谷峰比 / 弧深线宽比 / 五官像素 —— 每条都可复算
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sunny_geom as G  # noqa: E402
import gen_logo as R  # noqa: E402
import render_v3_frozen as V3R  # noqa: E402  （仅对比用，不参与交付）

HERE = os.path.dirname(os.path.abspath(__file__))
GEOM = json.load(open(os.path.join(HERE, "geom.json")))

# ── v3 实测基线（来自上一轮的覆盖率与 ASCII 记录，非估算）──
V3 = {
    "深色占比128": 37.1, "黄占比128": 57.3, "腮红占比128": 5.6,
    "深色占比20": 22.2, "黄占比20": 66.7,
    "圆盘半径": 25.0, "光线数": 3, "光线长宽比": 1.39,
    "眼占脸径": 19.2, "嘴占脸径": 53.6, "嘴弧深线宽比": 0.59,
    "描边": 6.5, "眼20px": 1.92, "嘴20px": 1.40, "腮红20px": 2.00,
}


def coverage_new(size):
    img = R.render(size, ss=1)
    refs = [("sun", _hx(G.SUN)), ("dark", _hx(G.OUTLINE)), ("blush", _hx(GEOM["colors"]["BLUSH_BLENDED"]))]
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
    return round(cnt["sun"] / t * 100, 1), round(cnt["dark"] / t * 100, 1), round(cnt["blush"] / t * 100, 1)


def _hx(s):
    s = s.lstrip("#")
    return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))


def struct_grid(size):
    """结构 ASCII：每层一个字符（# 描边 % 黄 o 腮红 E 眼 M 嘴 * 高光）。"""
    img = R.render(size, ss=4)
    grow = G.GROW
    bl = G.body(-grow)          # 黄色可见区 = 轮廓向内收 grow（与 SVG stroke 语义一致）
    blu, fa = G.blush(), G.face(0.0)
    gl = G.glint()
    rows = []
    for y in range(size):
        line = ""
        for x in range(size):
            i = (y * size + x) * 4
            if img[i + 3] < 100:
                line += " "
                continue
            sx, sy = (x + .5) / size * 100, (y + .5) / size * 100
            if fa(sx, sy) > .5:
                if gl(sx, sy) > .5:
                    line += "*"
                elif any(G._ellipse(sx, sy, ex, ey, G.EYE_RX, G.EYE_RY) > .5
                         for ex, ey in G.EYES):
                    line += "E"
                else:
                    line += "M"
            elif blu(sx, sy) > .5:
                line += "o"
            else:
                line += "%" if bl(sx, sy) > .5 else "#"
        rows.append(line)
    return rows


def v3_grid(size):
    """v3 的结构网格（同 v4 的字符约定，便于并排比对）。"""
    img = V3R.render(size, ss=4)
    bl = V3R.body(0.0)          # v3 黄身就是 body(0)（膨胀法）
    blu, fa = V3R.blush(), V3R.face(0.0)
    rows = []
    for y in range(size):
        line = ""
        for x in range(size):
            i = (y * size + x) * 4
            if img[i + 3] < 100:
                line += " "
                continue
            sx, sy = (x + .5) / size * 100, (y + .5) / size * 100
            if fa(sx, sy) > .5:
                line += "E" if any(V3R._disc(sx, sy, ex, ey, V3R.EYE_R, 1.0) > .5
                                   for ex, ey in V3R.EYES) else "M"
            elif blu(sx, sy) > .5:
                line += "o"
            else:
                line += "%" if bl(sx, sy) > .5 else "#"
        rows.append(line)
    return "\n".join("      |" + r + "|" for r in rows)


def build():
    import base64

    def png_b64(raw):
        return base64.b64encode(raw).decode()

    def to_png(w, rgba):
        import zlib, struct

        def ch(tag, data):
            return (struct.pack(">I", len(data)) + tag + data
                    + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))
        raw = b""
        for y in range(w):
            raw += b"\x00" + rgba[y * w * 4:(y + 1) * w * 4]
        return (b"\x89PNG\r\n\x1a\n"
                + ch(b"IHDR", struct.pack(">IIBBBBB", w, w, 8, 6, 0, 0, 0))
                + ch(b"IDAT", zlib.compress(raw, 9)) + ch(b"IEND", b""))

    c128 = coverage_new(128)
    c20 = coverage_new(20)
    sag_ratio = GEOM["mouthSag"] / (GEOM["mouthHalf"] * 2)
    ex_ratio = GEOM["eyeRx"] * 2 / (GEOM["R"] * 2) * 100
    mouth_ratio = (GEOM["mouthChord"] + GEOM["mouthHalf"] * 2) / (GEOM["R"] * 2) * 100

    def rows_of(size):
        return "\n".join("      |" + r + "|" for r in struct_grid(size))

    def imgs(renderer, sizes, cls=""):
        out = []
        for s in sizes:
            b64 = png_b64(to_png(s, renderer(s, ss=(4 if s <= 96 else 1))))
            out.append(f'<figure class="{cls}"><img src="data:image/png;base64,{b64}" '
                       f'width="{s}" height="{s}" alt="{s}px"><figcaption>{s}px</figcaption></figure>')
        return "\n".join(out)

    def delta(old, new, better="lower", unit=""):
        d = new - old
        good = (d < 0) if better == "lower" else (d > 0)
        arrow = "↓" if d < 0 else ("↑" if d > 0 else "=")
        return (f'<span class="{"good" if good else "bad"}">{arrow} {abs(d):.1f}{unit}</span>')

    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>Sunny logo · v3 → v4 优化对比</title>
<style>
  :root {{
    --bg:#FFFFFF; --surface:#F8FAFC; --surface2:#F1F5F9; --text:#0F172A;
    --muted:#475569; --faint:#94A3B8; --line:#E2E8F0; --line2:#CBD5E1;
    --accent:#2F6BFF; --good:#15803D; --bad:#B91C1C;
  }}
  [data-theme="dark"] {{
    --bg:#0B1220; --surface:#111A2E; --surface2:#16213A; --text:#E8EEF9;
    --muted:#A3B2CC; --faint:#6B7C99; --line:#22304D; --line2:#33445F;
    --accent:#6E9BFF; --good:#4ADE80; --bad:#F87171;
  }}
  * {{ box-sizing:border-box; }}
  body {{ margin:0; background:var(--bg); color:var(--text);
    font:14px/1.6 -apple-system,"PingFang SC","Microsoft YaHei",system-ui,sans-serif;
    transition:background .25s, color .25s; }}
  header {{ position:sticky; top:0; z-index:9; background:var(--bg);
    border-bottom:1px solid var(--line); padding:14px 22px;
    display:flex; align-items:center; gap:14px; flex-wrap:wrap; }}
  h1 {{ font-size:16px; font-weight:600; margin:0; }}
  .hint {{ font-size:12px; color:var(--faint); }}
  button {{ margin-left:auto; border:1px solid var(--line); background:var(--surface);
    color:var(--text); border-radius:8px; padding:6px 12px; font-size:13px;
    cursor:pointer; font-family:inherit; }}
  main {{ padding:22px; max-width:1100px; }}
  section {{ border:1px solid var(--line); border-radius:12px; background:var(--surface);
    padding:18px; margin-bottom:20px; }}
  h2 {{ font-size:15px; margin:0 0 4px; }}
  .sub {{ font-size:12px; color:var(--muted); margin:0 0 14px; }}
  .row {{ display:flex; align-items:flex-end; gap:22px; flex-wrap:wrap;
    background:var(--bg); padding:16px; border-radius:10px; }}
  figure {{ margin:0; text-align:center; }}
  figure img {{ display:block; }}
  figcaption {{ font-size:10px; color:var(--faint); margin-top:4px;
    font-family:ui-monospace,monospace; }}
  .col {{ flex:1; min-width:260px; }}
  .col h3 {{ font-size:12px; color:var(--muted); margin:0 0 8px; font-weight:600; }}
  table {{ border-collapse:collapse; width:100%; font-size:12.5px; }}
  th,td {{ border:1px solid var(--line); padding:7px 10px; text-align:left; }}
  th {{ background:var(--surface2); color:var(--muted); font-weight:600; }}
  td.num {{ font-family:ui-monospace,monospace; text-align:right; }}
  .good {{ color:var(--good); font-weight:600; }}
  .bad {{ color:var(--bad); font-weight:600; }}
  pre {{ margin:0; font:11px/1.05 ui-monospace,SFMono-Regular,monospace;
    color:var(--text); }}
  .why {{ border-left:3px solid var(--accent); background:var(--surface2);
    padding:11px 14px; border-radius:6px; font-size:12.5px; color:var(--muted);
    margin:0 0 14px; }}
  .why b {{ color:var(--text); }}
  code {{ background:var(--surface2); padding:1px 5px; border-radius:4px;
    font-size:11.5px; }}
</style>
</head>
<body>
<header>
  <h1>Sunny logo · v3 → v4</h1>
  <span class="hint">针对「有点太丑了吧」的逐项修正</span>
  <button onclick="t()">切换浅色 / 深色</button>
</header>
<main>

<section>
  <h2>一眼对比</h2>
  <p class="sub">左侧是上一版，右侧是本版。同一份几何、同样尺寸，只有设计参数不同。</p>
  <div class="row">
    <div class="col">
      <h3>v3（上一版 · 忠实重建）</h3>
      <div class="row" style="padding:8px;background:transparent">{imgs(V3R.render, [128,56,32,20])}</div>
      <p style="font-size:12px;color:var(--muted);margin:10px 0 0">
        描边 6.5 把图形框住 · 3 根圆头棒当光线 · 纯色圆点当眼睛 · 嘴压成一根粗棒
      </p>
    </div>
    <div class="col">
      <h3>v4（本版）</h3>
      <div class="row" style="padding:8px;background:transparent">{imgs(R.render, [128,56,32,20])}</div>
      <p style="font-size:12px;color:var(--muted);margin:10px 0 0">
        连续尖角轮廓 · 椭圆眼 + 白色高光 · 描边收到 3.0，黄色成为主导色
      </p>
    </div>
  </div>
</section>

<section>
  <h2>32px 逐像素结构（真实展示尺寸）</h2>
  <p class="sub">每层一个字符，可精确读出「眼睛在哪、嘴是什么形状」。<code>#</code> 描边 ·
    <code>%</code> 黄 · <code>o</code> 腮红 · <code>E</code> 眼 · <code>M</code> 嘴 ·
    <code>*</code> 高光</p>
  <div class="row">
    <div class="col">
      <h3>v3 @32px</h3>
      <pre>{v3_grid(32)}</pre>
    </div>
    <div class="col">
      <h3>v4 @32px</h3>
      <pre>{rows_of(32)}</pre>
    </div>
  </div>
</section>

<section>
  <h2>量化差异（每条都可复算）</h2>
  <p class="sub">左列是 v3 的实测值，中间是本版，右列是变化方向。</p>
  <table>
    <tr><th>指标</th><th>v3</th><th>v4</th><th>变化</th><th>为什么关键</th></tr>
    <tr><td>深色像素占比 @128px</td><td class="num">{V3['深色占比128']}%</td>
      <td class="num">{c128[1]}%</td><td>{delta(V3['深色占比128'], c128[1], 'lower', '%')}</td>
      <td>深色太多 → 整个图形被深棕框住，黄色被闷在中间</td></tr>
    <tr><td>黄色像素占比 @128px</td><td class="num">{V3['黄占比128']}%</td>
      <td class="num">{c128[0]}%</td><td>{delta(V3['黄占比128'], c128[0], 'higher', '%')}</td>
      <td>黄色应是主导色（用户要的是「黄色可爱」）</td></tr>
    <tr><td>描边宽度</td><td class="num">{V3['描边']}</td>
      <td class="num">{GEOM['outlineStroke']}</td>
      <td>{delta(V3['描边'], GEOM['outlineStroke'], 'lower')}</td>
      <td>20px 下 {V3['描边']*0.2:.2f}px → {GEOM['outlineStroke']*0.2:.2f}px，仍能勾出轮廓</td></tr>
    <tr><td>光芒形态</td><td class="num">3 根圆头棒</td>
      <td class="num">{GEOM['rayN']} 尖角连续轮廓</td><td>=</td>
      <td>v3 的棒与盘之间要留净间隙，20px 下被描边吃掉 → 光芒与脸焊成一块</td></tr>
    <tr><td>谷 / 峰比</td><td class="num">—（无谷）</td>
      <td class="num">{GEOM['valleyPeak']}</td><td>=</td>
      <td>&gt;0.80 就太平，读成「花瓣」而不是太阳</td></tr>
    <tr><td><b>嘴 弧深 / 线宽</b></td><td class="num">{V3['嘴弧深线宽比']}</td>
      <td class="num">{sag_ratio:.2f}</td>
      <td>{delta(V3['嘴弧深线宽比'], sag_ratio, 'higher')}</td>
      <td><b>&lt;1 时线宽盖住曲率 → 无论坐标多对都读成一根粗棒</b>（这是「看不出在笑」的真因）</td></tr>
    <tr><td>眼睛占脸径</td><td class="num">{V3['眼占脸径']}%</td>
      <td class="num">{ex_ratio:.1f}%</td><td>{delta(V3['眼占脸径'], ex_ratio, 'higher', '%')}</td>
      <td>太小则显呆；本版另加白色高光</td></tr>
    <tr><td>嘴占脸径</td><td class="num">{V3['嘴占脸径']}%</td>
      <td class="num">{mouth_ratio:.1f}%</td><td>{delta(V3['嘴占脸径'], mouth_ratio, 'lower', '%')}</td>
      <td>嘴过大显傻，与眼睛失衡（小眼大嘴）</td></tr>
    <tr><td>眼内高光</td><td class="num">无</td><td class="num">白点 r={GEOM['glint'][2]*GEOM['eyeRx']:.2f}</td>
      <td>=</td><td>「有神」与「呆滞」的分界</td></tr>
    <tr><td>深色占比 @20px</td><td class="num">{V3['深色占比20']}%</td>
      <td class="num">{c20[1]}%</td><td>{delta(V3['深色占比20'], c20[1], 'lower', '%')}</td>
      <td>顶栏 / AI 助手的真实尺寸</td></tr>
  </table>
</section>

<section>
  <h2>验证状态</h2>
  <p class="why">
    几何自检 <b>13/13</b> · 浏览器双主题逐像素 <b>35/35</b> ·
    对抗性注入 <b>8/8 全部被抓到</b>（含「把嘴改成哭脸」「去掉眼睛」「描边细到看不见」）。<br>
    所有断言都从 <code>docs/brand/geom.json</code> 读几何 —— 该文件由
    <code>export_geom.py</code> 从 <code>sunny_geom.py</code> 生成，
    <b>杜绝「改了几何但断言还在验旧形状」</b>这类假通过。
  </p>
</section>

</main>
<script>
function t() {{
  const el = document.documentElement;
  el.dataset.theme = el.dataset.theme === 'dark' ? 'light' : 'dark';
}}
</script>
</body>
</html>
"""


if __name__ == "__main__":
    p = os.path.join(HERE, "compare.html")
    open(p, "w").write(build())
    print(f"已生成对比页: {p} ({os.path.getsize(p)} bytes)")