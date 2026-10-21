#!/usr/bin/env node
/**
 * 真机验证「Sunny 笑脸太阳」SVG —— 透明底，需在**明暗两套主题背景**上都成立。
 *
 * ## 为什么需要浏览器验证（Python 侧已渲染过一遍）
 *
 * Python 用「覆盖率场」自算像素（`gen_logo.py`），浏览器用真实 SVG 光栅化
 * （抗锯齿、`stroke-linecap`、椭圆曲线细分）。两者不保证等价 ——
 * 这个脚本就是拿**真实渲染引擎**复核一遍。
 *
 * ## 判据设计（每条都对应一次真实踩坑）
 *
 * 🔴 **几何必须程序导出，不能硬编码**：
 *    上一版把 `discR/eyes/blushR` 抄在 JS 里并注明「改动需同步」。
 *    把几何从 v3 改成 v4（圆盘→连续尖角轮廓、圆眼→椭圆眼+高光）后，
 *    那些常量全部失效，脚本却**照样通过** —— 因为采样点已经落在图形之外，
 *    断言变成了「拿背景色比背景色」。现改为读 `docs/brand/geom.json`
 *    （由 `export_geom.py` 从 `sunny_geom.py` 生成）——**同源才自证**。
 *
 * 🔴 **必须验「五官真的渲染出来了」**，而不是只验「有颜色」：
 *    用户诉求是「乐观向上的卡通脸」，眼睛/嘴/腮红缺一不可。
 *
 * 🔴 **必须验两种主题**：透明底 logo 在浅色主题靠描边勾轮廓、深色主题靠
 *    黄↔深底的强对比。只验一种会漏掉另一种主题下的失效。
 *
 * 🔴 **不能用「截图 → 读像素」**：截图丢 CSS 背景，透明区被读成黑色，
 *    会得出「深色正常、浅色全黑」这类错误结论。
 *    改为页内重建背景色 + drawImage(SVG)，全程不经过截图。
 *
 * 🔴 **小尺寸用「亮度差」而非精确色**：20px 下眼睛仅 1.92px，
 *    中心点必然被抗锯齿混合，断精确色会假失败。
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BRAND = path.resolve(__dirname, "../../docs/brand");
const LOGO = path.join(BRAND, "svg", "sunny-face.svg");
const FAVICON = path.join(BRAND, "svg", "favicon-sunny.svg");
const GEOM_FILE = path.join(BRAND, "geom.json");

let pass = 0, fail = 0;
const check = (n, ok, d = "") => {
  console.log(`  ${ok ? "✅" : "❌"} ${n}${d ? "  " + d : ""}`);
  ok ? pass++ : fail++;
};
const hex2rgb = (h) => {
  h = h.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};
const dist = (a, b) => Math.round(Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2));
const lum = (c) => {
  const [r, g, b] = hex2rgb(c);
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a, b) => {
  const x = lum(a), y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

/** 页内重建「背景色 + SVG」→ 返回关键点颜色。 */
const sample = (pg, svg, bgColor, size, geo) => pg.evaluate(async ([svg, bgColor, size, geo]) => {
  const c = document.createElement("canvas");
  c.width = size; c.height = size;
  const g = c.getContext("2d");
  g.fillStyle = bgColor;
  g.fillRect(0, 0, size, size);
  await new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => { g.drawImage(img, 0, 0, size, size); res(); };
    img.onerror = rej;
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  });
  const d = g.getImageData(0, 0, size, size).data;
  const px = (fx, fy) => {
    const x = Math.min(size - 1, Math.max(0, Math.round(fx / 100 * size)));
    const y = Math.min(size - 1, Math.max(0, Math.round(fy / 100 * size)));
    const i = (y * size + x) * 4;
    return [d[i], d[i + 1], d[i + 2]];
  };
  const hex = (p) => "#" + p.map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
  // 嘴带区域（弧底为中心的方块）内**最暗**的像素 —— 小尺寸下单点探针不可靠
  const mouthDarkest = (() => {
    const hw = Math.max(2, Math.round(geo.mouthChord * 0.30));
    const hh = Math.max(2, Math.round(geo.mouthSag * 0.45));
    const cx0 = Math.round((geo.mouthMidX - hw / 2) / 100 * size);
    const cy0 = Math.round((geo.mouthBottomY - geo.mouthSag / 2 - hh / 2) / 100 * size);
    let best = 1e9, bc = "#FFFFFF";
    for (let y = cy0; y < cy0 + hh; y++) {
      for (let x = cx0; x < cx0 + hw; x++) {
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const i = (y * size + x) * 4;
        if (d[i + 3] < 128) continue;
        const l = (() => { const f = (v) => { v /= 255;
          return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
          return 0.2126 * f(d[i]) + 0.7152 * f(d[i + 1]) + 0.0722 * f(d[i + 2]); })();
        if (l < best) { best = l; bc = hex([d[i], d[i + 1], d[i + 2]]); }
      }
    }
    return bc;
  })();
  const [gx, gy, gr] = geo.glint;
  const glintPt = [geo.eyes[0][0] + gx * geo.eyeRx, geo.eyes[0][1] + gy * geo.eyeRy];
  return {
    eyeL: hex(px(geo.eyes[0][0], geo.eyes[0][1])),
    eyeR: hex(px(geo.eyes[1][0], geo.eyes[1][1])),
    glint: hex(px(glintPt[0], glintPt[1])),
    mouth: hex(px(geo.mouthMidX, geo.mouthBottomY)),
    mouthDarkest,
    // 弧底正上方（离弧底 0.9×弧深）—— 笑脸时弧在下方 ⇒ 此处是黄；
    // 哭脸时弧会向上凸到这里 ⇒ 变深色。这是**唯一能区分笑/哭方向**的探针。
    aboveMouth: hex(px(geo.mouthMidX, geo.mouthBottomY - geo.mouthSag * 0.9)),
    blushL: hex(px(geo.blushes[0][0], geo.blushes[0][1])),
    blushR: hex(px(geo.blushes[1][0], geo.blushes[1][1])),
    sun: hex(px(geo.sunProbe[0], geo.sunProbe[1])),
    outline: hex(px(geo.outlineProbe[0], geo.outlineProbe[1])),
    corner: hex(px(geo.cornerProbe[0], geo.cornerProbe[1])),
    // 峰值方向（正上方 = 最长尖角，探针在描边带内）
    peak: hex(px(geo.peakProbe[0], geo.peakProbe[1])),
    valley: hex(px(geo.valleyProbe[0], geo.valleyProbe[1])),
    faviconCorner: hex(px(geo.faviconCornerProbe[0], geo.faviconCornerProbe[1])),
  };
}, [svg, bgColor, size, geo]);

(async () => {
  if (!fs.existsSync(GEOM_FILE)) {
    console.error("❌ 缺少 geom.json —— 先跑：python3 docs/brand/export_geom.py");
    process.exit(1);
  }
  const GEO = JSON.parse(fs.readFileSync(GEOM_FILE, "utf8"));
  const C = GEO.colors;

  const b = await chromium.launch({ headless: true, args: ["--no-proxy-server"] });
  const p = await b.newPage({ viewport: { width: 900, height: 700 } });
  await p.goto("about:blank");

  console.log("=== 资源与结构 ===");
  check("主 logo SVG 存在", fs.existsSync(LOGO), LOGO);
  check("favicon SVG 存在", fs.existsSync(FAVICON));
  if (!fs.existsSync(LOGO)) { await b.close(); process.exit(1); }
  const svg = fs.readFileSync(LOGO, "utf8");
  const fav = fs.readFileSync(FAVICON, "utf8");

  check("主 logo 是透明底（无实色背景矩形）",
    !/<rect[^>]*fill="(?!none)/.test(svg),
    /<rect/.test(svg) ? "发现 rect → 不是透明底" : "无实底 rect ✅");
  check("favicon 自带实底（标签页无可依赖背景）", /<rect[^>]*fill="#FFF8E1"/.test(fav));
  check(`主 logo 含 2 眼 + 1 嘴 + 2 腮红 + 2 高光`,
    (svg.match(/<ellipse/g) || []).length === 2 &&
    (svg.match(/<circle/g) || []).length === 4 &&
    /\<path d="M[\d.,L]+" fill="none" stroke/.test(svg),
    `ellipse=${(svg.match(/<ellipse/g) || []).length} circle=${(svg.match(/<circle/g) || []).length}`);
  check("轮廓是单一闭合 path（连续尖角，非分离光芒）",
    (svg.match(/<path d="M/g) || []).length === 2,   // 轮廓 + 嘴
    `path=${(svg.match(/<path d="M/g) || []).length}`);

  console.log("\n=== 浅色主题（#FFFFFF）· 256px ===");
  const L = await sample(p, svg, "#FFFFFF", 256, GEO);
  check("左眼 = 五官色", dist(hex2rgb(L.eyeL), hex2rgb(C.FACE)) < 30, L.eyeL);
  check("右眼 = 五官色", dist(hex2rgb(L.eyeR), hex2rgb(C.FACE)) < 30, L.eyeR);
  check("眼内高光 = 白色（眼睛『有神』）", dist(hex2rgb(L.glint), [255, 255, 255]) < 40, L.glint);
  check("嘴弧底 = 五官色", dist(hex2rgb(L.mouth), hex2rgb(C.FACE)) < 40, L.mouth);
  // 🔴 判「笑」不能靠比亮度（哭脸时探针会同时落到黄上 → 恒真）。
  //    正上方 0.9×弧深 处是黄 ⇒ 弧在下方 ⇒ **向上笑**。
  check("嘴弧在下方（向上笑，非哭脸）",
    dist(hex2rgb(L.aboveMouth), hex2rgb(C.SUN)) < 60, `弧底上方 ${L.aboveMouth}`);
  check("左腮红 ≈ 黄上叠色", dist(hex2rgb(L.blushL), hex2rgb(C.BLUSH_BLENDED)) < 45, L.blushL);
  check("右腮红 ≈ 黄上叠色", dist(hex2rgb(L.blushR), hex2rgb(C.BLUSH_BLENDED)) < 45, L.blushR);
  check("纯黄区 = 太阳黄", dist(hex2rgb(L.sun), hex2rgb(C.SUN)) < 30, L.sun);
  check("圆盘顶部有描边", dist(hex2rgb(L.outline), hex2rgb(C.OUTLINE)) < 70, L.outline);
  check("正上方是最长尖角（峰顶落在描边带内）",
    dist(hex2rgb(L.peak), hex2rgb(C.OUTLINE)) < 60, L.peak);
  check("谷位仍为黄色（谷是凹口，不是背景）",
    dist(hex2rgb(L.valley), hex2rgb(C.SUN)) < 90, L.valley);
  check("墙角 = 背景（透明底，未溢出未填底）",
    dist(hex2rgb(L.corner), [255, 255, 255]) < 12, L.corner);

  console.log("\n=== 深色主题（#0B1220）· 256px ===");
  const D = await sample(p, svg, "#0B1220", 256, GEO);
  check("左眼 = 五官色", dist(hex2rgb(D.eyeL), hex2rgb(C.FACE)) < 30, D.eyeL);
  check("嘴弧底 = 五官色", dist(hex2rgb(D.mouth), hex2rgb(C.FACE)) < 40, D.mouth);
  check("纯黄区 = 太阳黄（深底上极清晰）", dist(hex2rgb(D.sun), hex2rgb(C.SUN)) < 30, D.sun);
  check("墙角 = 深色背景", dist(hex2rgb(D.corner), hex2rgb("#0B1220")) < 12, D.corner);

  console.log("\n=== 双主题可辨性（由配色推导）===");
  check(`浅底：描边对白底 ${contrast(C.OUTLINE, "#FFFFFF").toFixed(2)} ≥ 3（靠它勾轮廓）`,
    contrast(C.OUTLINE, "#FFFFFF") >= 3);
  check(`深底：黄对深底 ${contrast(C.SUN, "#0B1220").toFixed(2)} ≥ 3（靠它勾轮廓）`,
    contrast(C.SUN, "#0B1220") >= 3);
  check(`五官对黄 ${contrast(C.FACE, C.SUN).toFixed(2)} ≥ 4.5（无需额外描边）`,
    contrast(C.FACE, C.SUN) >= 4.5);

  console.log("\n=== 小尺寸可辨性（真实展示尺寸）===");
  for (const size of [16, 20, 28, 32]) {
    const s = await sample(p, svg, "#FFFFFF", size, GEO);
    const sunLum = lum(s.sun);
    // 小尺寸下眼睛必然与黄/描边抗锯齿混合 → 断言「明显暗于纯黄」，而非精确色
    check(`@${size}px 眼区明显暗于黄区（Δ ${(sunLum - lum(s.eyeL)).toFixed(2)}）`,
      lum(s.eyeL) < sunLum - 0.15, `眼 ${s.eyeL} / 黄 ${s.sun}`);
    // 用**区域最暗像素**判：单点探针在 20px（嘴线仅 1.04px）会落在抗锯齿空隙上
    check(`@${size}px 嘴区画上了深色（最暗 ${(sunLum - lum(s.mouthDarkest)).toFixed(2)} 暗于黄）`,
      lum(s.mouthDarkest) < sunLum - 0.10, `最暗 ${s.mouthDarkest} / 中心 ${s.mouth}`);
  }

  console.log("\n=== favicon 可读性 ===");
  const F = await sample(p, fav, "#FFFFFF", 32, GEO);
  check("favicon 圆角内 = 自带浅暖白底",
    dist(hex2rgb(F.faviconCorner), hex2rgb("#FFF8E1")) < 24, F.faviconCorner);
  check("favicon 有黄脸", lum(F.sun) > 0.6, F.sun);

  // 🔴 输出格式必须含「全部通过」—— runner（run_all_verify.cjs）正是按这个字符串
  //    判定成功的（见其 `/全部通过|ALL PASS/.test(out)`）。只打印「通过 N / 失败 0」
  //    会被判为「退出码 0 但未见『全部通过』」→ **假失败**（本轮踩过）。
  console.log(`\n通过 ${pass} / 失败 ${fail}`);
  console.log(fail === 0 ? "✅ 全部通过" : "❌ 存在失败项");
  await b.close();
  process.exit(fail ? 1 : 0);
})();