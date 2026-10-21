#!/usr/bin/env python3
"""生成品牌预览页：**透明底笑脸 logo 贴在明暗两套主题的真实位置上**。

用户本轮要求：
  - 「不要背面颜色了，根据浏览器主题背景颜色自动更改即可」
  - 「做一个乐观向上的卡通脸形象」
  - 「透明底 + 深色描边」

所以预览页的核心任务变了：不再是"选哪款配色"，而是**验证同一份透明底 SVG
在浅色主题与深色主题下都成立**。

配色读自 `web/src/app/globals.css` 的 token（明/暗两套）—— 不自己编色值，
否则预览与真实界面会有偏差，判断就不可靠。
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import sunny_geom as G  # noqa: E402

TOK = json.load(open("/tmp/tokens.json"))
ROOT, DARK = TOK["root"], TOK["dark"]

LOGO_PATH = os.path.join(HERE, "svg", "sunny-face.svg")

# 8 个真实展示点：尺寸/圆角/字号**照抄组件现有实现**（含全部 8 处）
SPOTS = [
    ("顶栏（知识库视图）", "TitleBar.tsx:75", 20, 6, "Sunny", None, 15, 0, 0.86),
    ("AI 助手消息头", "AiPanel.tsx:896", 20, 6, "Sunny 助手", None, 12, 0, 0.86),
    ("分享页顶栏", "ShareView.tsx:138", 28, 8, "Sunny · 分享文档", None, 14, 0, 0.82),
    ("设置页「关于」", "SettingsDialog.tsx:966", 28, 8, "Sunny", "以文档为核心的私有知识库", 14, 12, 0.82),
    ("首页顶栏", "HomeView.tsx:212", 32, 8, "Sunny", "个人知识库", 16, 12, 0.78),
    ("登录页左栏", "LoginView.tsx:70", 40, 12, "Sunny", "个人知识库", 17, 12, 0.72),
    ("分享页正文头", "ShareView.tsx:79", 48, 12, "Sunny", "分享文档", 18, 13, 0.72),
    ("登录页大徽标", "LoginView.tsx:118", 56, 20, "Sunny", "个人知识库", 22, 14, 0.72),
]

SIZES = [16, 20, 28, 32, 40, 48, 56, 128]


def token_block():
    def decls(d, keys):
        return "\n".join(f"      {k}: {d[k]};" for k in keys if k in d)

    keys = ["--background", "--surface", "--surface-2", "--text", "--muted", "--faint",
            "--line", "--line-strong", "--accent", "--accent-solid", "--accent-soft",
            "--accent-grad", "--grad-blue-indigo", "--hero-chip", "--hero-chip-border",
            "--hero-ink", "--hero-ink-faint", "--hover"]
    return f"""    :root {{
{decls(ROOT, keys)}
      --radius-sm: 6px; --radius-md: 8px; --radius-lg: 12px;
      --radius-xl: 16px; --radius-2xl: 20px;
      --font-sans: -apple-system, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
    }}
    [data-theme="dark"] {{
{decls(DARK, keys)}
    }}"""


def spot_html(title, comp, box, radius, main, sub, fsize, subsize, pad_ratio):
    svg = open(LOGO_PATH).read()
    inner = svg.replace('width="100" height="100"',
                        f'width="{int(box * pad_ratio)}" height="{int(box * pad_ratio)}"')
    inner = inner.replace("<svg ", '<svg style="display:block" ')
    deep = "登录页左栏" in title
    if deep:
        wrap_extra = "background:var(--grad-blue-indigo);color:var(--hero-ink);"
        subcolor = "var(--hero-ink-faint)"
        boxstyle = (f"display:grid;place-items:center;width:{box}px;height:{box}px;"
                    f"border-radius:{radius}px;background:var(--hero-chip);"
                    f"box-shadow:inset 0 0 0 1px var(--hero-chip-border);")
    else:
        wrap_extra = ""
        subcolor = "var(--faint)"
        boxstyle = (f"width:{box}px;height:{box}px;border-radius:{radius}px;")
    sub_html = (f'<div style="font-size:{subsize}px;color:{subcolor};margin-top:1px">{sub}</div>'
                if sub else "")
    return f"""      <div class="spot-wrap" style="{wrap_extra}">
        <div class="spot-meta">{title}<span class="comp">{comp}</span><span class="dim">{box}px / r{radius}</span></div>
        <div class="spot">
          <div style="display:flex;align-items:center;gap:{max(6, box // 4)}px">
            <span style="{boxstyle}">{inner}</span>
            <div style="line-height:1.25">
              <div style="font-size:{fsize}px;font-weight:600;color:{'inherit' if wrap_extra else 'var(--text)'}">{main}</div>
              {sub_html}
            </div>
          </div>
        </div>
      </div>"""


def build():
    spots = "\n".join(spot_html(*s) for s in SPOTS)
    svg = open(LOGO_PATH).read()
    return f"""<!DOCTYPE html>
<html lang="zh-CN" data-theme="light">
<head>
<meta charset="utf-8">
<title>Sunny 笑脸太阳 LOGO · 透明底双主题预览</title>
<style>
{token_block()}
    * {{ box-sizing: border-box; }}
    body {{ margin:0; background:var(--background); color:var(--text);
      font-family:var(--font-sans); font-size:14px; line-height:1.5;
      transition:background .25s, color .25s; }}
    header {{ position:sticky; top:0; z-index:10; background:var(--background);
      border-bottom:1px solid var(--line); padding:14px 22px; display:flex;
      align-items:center; gap:14px; flex-wrap:wrap; }}
    header h1 {{ font-size:16px; font-weight:600; margin:0; }}
    header .hint {{ font-size:12px; color:var(--faint); }}
    .toggle {{ margin-left:auto; border:1px solid var(--line); background:var(--surface);
      color:var(--text); border-radius:var(--radius-md); padding:6px 12px;
      font-size:13px; cursor:pointer; font-family:inherit; }}
    main {{ padding:22px; max-width:1180px; }}
    .cand {{ border:1px solid var(--line); border-radius:var(--radius-lg);
      background:var(--surface); padding:18px; margin-bottom:22px; }}
    .cand h2 {{ font-size:15px; font-weight:600; margin:0 0 8px; }}
    .spot-wrap {{ border:1px dashed var(--line-strong); border-radius:var(--radius-lg);
      margin-bottom:10px; overflow:hidden; }}
    .spot-meta {{ font-size:11px; color:var(--muted); background:var(--surface-2);
      padding:4px 10px; display:flex; gap:8px; align-items:center; }}
    .spot-meta .comp {{ color:var(--faint); font-family:ui-monospace,monospace; font-size:10px; }}
    .spot-meta .dim {{ margin-left:auto; color:var(--faint); font-family:ui-monospace,monospace; font-size:10px; }}
    .spot {{ padding:12px 16px; background:var(--background); display:flex; align-items:center; }}
    .note {{ font-size:12px; color:var(--muted); border-left:3px solid var(--accent);
      background:var(--accent-soft); padding:12px 14px; border-radius:var(--radius-sm);
      margin:0 0 20px; }}
    .note b {{ color:var(--text); }}
    .note code {{ background:var(--surface-2); padding:1px 5px; border-radius:4px;
      font-size:11px; }}
    .sizes {{ display:flex; align-items:flex-end; gap:14px; padding:14px 16px;
      background:var(--background); flex-wrap:wrap; }}
    .sizes figure {{ margin:0; text-align:center; }}
    .sizes figcaption {{ font-size:10px; color:var(--faint); margin-top:5px; }}
    table {{ border-collapse:collapse; font-size:12px; width:100%; }}
    th, td {{ border:1px solid var(--line); padding:6px 9px; text-align:left; }}
    th {{ background:var(--surface-2); font-weight:600; color:var(--muted); }}
    .ok {{ color:#15803d; font-weight:600; }}
    [data-theme="dark"] .ok {{ color:#4ade80; }}
</style>
</head>
<body>
<header>
  <h1>Sunny 笑脸太阳 · 透明底双主题预览</h1>
  <span class="hint">乐观向上卡通脸 · 随主题背景自动适配</span>
  <button class="toggle" onclick="t()">切换浅色 / 深色</button>
</header>
<main>
  <p class="note">
    <b>怎么看这个页面：</b>请<b>反复切换右上角的浅色/深色</b> —— 本轮 logo 是
    <b>透明底</b>，不画任何背景色，直接贴在页面背景上，所以唯一要验证的就是
    <b>两种主题下是否都清晰</b>。
    <br><br>
    <b>为什么一定要深色描边：</b>黄 <code>#FFD93D</code> 对白底对比度只有
    <b>1.38</b>（几乎看不见边界），必须靠深棕描边 <code>#7C2D12</code>（对白 <b>9.37</b>）勾出轮廓。
    而到了深色主题，黄对深底是 <b>15.24</b>，轮廓改由「黄 ↔ 深底」的强对比提供 ——
    <b>两种主题的轮廓提供者不同，但都成立</b>，所以一份 SVG 就够，不需要两套资源。
  </p>

  <section class="cand">
    <h2>8 个真实展示位置</h2>
    <p style="font-size:12px;color:var(--muted);margin:0 0 12px">
      尺寸与圆角照抄现有组件。<b>重点看前两行（20px）</b> —— 那是顶栏与 AI 助手的真实大小，
      小尺寸才是真正的考验。
    </p>
{spots}
  </section>

  <section class="cand">
    <h2>全尺寸压力测试<code>16 → 128px</code></h2>
    <div class="sizes" id="sizes"></div>
  </section>

  <section class="cand">
    <h2>配色与几何规格</h2>
    <table>
      <tr><th>项目</th><th>取值</th><th>对比度 / 说明</th></tr>
      <tr><td>太阳黄</td><td><code>{G.SUN}</code></td><td>对白底 1.38（靠描边勾轮廓）· 对深底 15.24</td></tr>
      <tr><td>描边</td><td><code>{G.OUTLINE}</code> · {G.OUTLINE_STROKE}/100</td><td>对白底 <b>9.37</b> · 对黄 <b>6.80</b></td></tr>
      <tr><td>五官</td><td><code>{G.FACE}</code></td><td>对黄 <b>8.22</b>（不需要额外描边）</td></tr>
      <tr><td>腮红</td><td><code>{G.BLUSH}</code> @ {int(G.BLUSH_ALPHA*100)}%</td><td>叠加后 ≈ #FA9C4A，对黄可见但不抢眼</td></tr>
      <tr><td>脸盘半径</td><td>{G.R} / 100（谷）</td><td>20px 下 {G.R*2*20/100:.1f}px 直径</td></tr>
      <tr><td>光芒</td><td>{G.RAY_N} 尖角 · 峰 +{G.AMP} · 谷/峰 {G.R/(G.R+G.AMP):.2f}</td><td>连续轮廓，20px 下仍分得开</td></tr>
      <tr><td>眼睛</td><td>椭圆 {G.EYE_RX*2}×{G.EYE_RY*2}，间距 {G.EYE_DX*2}</td><td>20px 下宽 {G.EYE_RX*2*20/100:.2f}px · 带白色高光</td></tr>
      <tr><td>嘴</td><td>弦宽 {G.MOUTH_CHORD} · 弧深 {G.MOUTH_SAG} · 线宽 {G.MOUTH_HALF*2}</td><td>20px 下 <b>弧深/线宽 = {G.MOUTH_SAG/(G.MOUTH_HALF*2):.2f}</b>（&lt;1 就读不出上弯）</td></tr>
    </table>
  </section>
</main>
<script>
const SVG = {json.dumps(svg, ensure_ascii=False)};
const SIZES = {json.dumps(SIZES)};
const box = document.getElementById('sizes');
for (const s of SIZES) {{
  const f = document.createElement('figure');
  const d = document.createElement('div');
  d.style.cssText = `width:${{s}}px;height:${{s}}px;display:grid;place-items:center`;
  d.innerHTML = SVG.replace('width="100" height="100"', `width:${{s}} height:${{s}}`)
    .replace('<svg ', '<svg style="display:block" ');
  f.appendChild(d);
  const c = document.createElement('figcaption');
  c.textContent = s + 'px';
  f.appendChild(c);
  box.appendChild(f);
}}
function t() {{
  const el = document.documentElement;
  el.dataset.theme = el.dataset.theme === 'dark' ? 'light' : 'dark';
}}
</script>
</body>
</html>
"""


if __name__ == "__main__":
    p = os.path.join(HERE, "preview.html")
    open(p, "w").write(build())
    print("已生成预览页:", p, f"({os.path.getsize(p)} bytes)")