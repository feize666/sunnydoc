"""搜索结果片段的清洗 —— 回归测试。

**缺陷背景（2026-10-13 实测，非推测）**

`snippet` 原先是「以命中点为中心、固定半径的原样切片」：
    text[idx-60 : idx+60].replace("\\n", " ")
命中点落在 markdown 结构里时，切出来的就是结构噪声。实测 10 个高频查询、
185 条结果，**142 条（77%）含噪声**：标题号 109 / 代码围栏 41 / 长空白 29 /
图片链接 29 / 表格竖线 22。真实样例（搜「磁盘」命中「15-磁盘管理」）：

    `…                    ```    ## 2、磁盘管理 ### 2.1、磁盘`   ← 用户看不出为何命中

清洗后：

    `…2、磁盘管理 2.1、磁盘 - 磁盘/硬盘：永久存放数据`            ← 是句人话

**断言为什么这样设计**

只断「snippet 非空」是**恒真**的（改前改后都非空），不能区分实现。
必须断言**噪音特征的有无**，且测试数据要构造成「旧实现必然带噪声」的形态。
"""

from __future__ import annotations

import re

from app.api.routes import _clean_snippet_text, _make_snippet


def _noise(s: str) -> list[str]:
    """列出片段里残留的结构噪声类型（空列表 = 干净）。"""
    r: list[str] = []
    if "```" in s:
        r.append("代码围栏")
    if re.search(r"[ \t]{6,}", s):
        r.append("长空白")
    if s.count("|") >= 2:
        r.append("表格竖线")
    if re.search(r"!\[|\]\(|<[a-zA-Z]", s):
        r.append("图片/链接/HTML")
    if re.search(r"(^|\s)#{1,6}", s):
        r.append("标题号")
    if re.search(r"-{3,}", s):
        r.append("分隔线")
    return r


def test_code_fence_and_heading_noise_removed():
    """命中点落在「一大段空格 + 围栏 + 标题」里 —— 旧实现必然带 3 类噪声。"""
    text = "                                            \n```\n\n\n## 2、磁盘管理\n### 2.1、磁盘\n- 磁盘/硬盘：永久存放数据"
    idx = text.index("磁盘")
    out = _make_snippet(text, idx, 2)
    assert _noise(out) == [], (out, _noise(out))
    assert "磁盘" in out, out
    # 残留的 ## / ### 记号也应被清掉（不是只去掉围栏）
    assert "#" not in out, out


def test_table_row_noise_removed():
    """表格行：竖线与 `| --- |` 分隔行都要清掉。"""
    text = "| 项目 | 说明 |\n| ---- | ---- |\n| 内存 | 16G 以上 |"
    idx = text.index("内存")
    out = _make_snippet(text, idx, 2)
    assert _noise(out) == [], (out, _noise(out))
    assert "内存" in out and "16G" in out, out


def test_image_and_blockquote_markers_removed():
    """图片语法整段去掉；引用记号 `>` 清掉但保留文字。"""
    text = "![Ceph架构](/api/v1/media/abc.png) 流程 > - osd：对应的是一块物理磁盘，进行数据存储"
    idx = text.index("磁盘")
    out = _make_snippet(text, idx, 2)
    assert _noise(out) == [], (out, _noise(out))
    assert "物理磁盘" in out, out
    assert "![" not in out and "](/api" not in out, out


def test_markdown_link_keeps_visible_text():
    """链接保留可见文字、去掉 URL（而不是整段删掉，否则会丢信息）。"""
    text = "参见 [官方安装文档](https://example.com/very/long/path) 里的磁盘配置章节"
    idx = text.index("磁盘")
    out = _make_snippet(text, idx, 2)
    assert "官方安装文档" in out, out
    assert "https://" not in out, out


def test_cli_double_dash_options_survive():
    """命令行参数 `--disk` / `--vcpus` 必须保留。

    这是清洗规则的边界：分隔线规则用的是「连续 3 个及以上短横线」，
    若放宽到 2 个就会把 `--disk` 打成碎片。库内大量文档是运维命令手册，
    误伤这类文本的代价很高。
    """
    text = "virt-install --virt-type kvm --memory 2048 --disk size=20 指定磁盘大小"
    idx = text.index("磁盘")
    out = _make_snippet(text, idx, 2)
    assert "--disk" in out, out
    assert "--vcpus" in _make_snippet(
        "a" * 40 + " --vcpus 指定CPU的核心数 磁盘 " + "b" * 40, 60, 2
    ), "`--vcpus` 被清洗破坏"


def test_plain_text_untouched():
    """普通文本不应被改动（防止清洗规则过度作用）。"""
    text = "plain text with 磁盘 and nothing else special"
    assert _make_snippet(text, text.index("磁盘"), 2) == text


def test_hit_at_document_edges_has_no_leading_ellipsis():
    """命中词在开头时不应出现前导省略号（表示「前面还有内容」）。"""
    out = _make_snippet("磁盘管理入门", 0, 2)
    assert not out.startswith("…"), out
    out2 = _make_snippet("入门磁盘", 2, 2)
    assert not out2.endswith("…"), out2


def test_snippet_keeps_substantial_context():
    """片段不能只剩几个字 —— 旧实现误用行尾裁剪时实测只剩 16 字符。

    这里构造「命中词前后各有一行」的文本，断言片段包含命中词前后的内容。
    """
    head = "前置内容" * 20
    body = "磁盘管理是重要的内容"
    tail = "后置内容" * 20
    text = f"{head}\n{body}\n{tail}"
    out = _make_snippet(text, text.index("磁盘"), 2, radius=70)
    assert len(out) > 60, f"片段过短：{out!r}"
    assert "磁盘" in out, out


def test_empty_text_does_not_crash():
    assert _make_snippet("", 0, 2) == ""


def test_truncated_image_marker_removed():
    """**被窗口截断的**图片/链接标记也要清掉。

    ⚠️ 这条同样来自真机验证的残留（3/206）：完整模式 `!\\[..\\]\\(..\\)` 匹配不到
    `![img](/api`（缺右括号），于是它被漏给用户。真实样例：

        `…PiVw 提取码：zhuz 这里注意内存和磁盘给大点 ![img](/api`
    """
    assert "![" not in _clean_snippet_text("注意内存和磁盘给大点 ![img](/api")
    assert "![" not in _clean_snippet_text("前文 ![image")
    # 完整的图床 URL 也要清掉（无论是否截断）
    assert "i-b" not in _clean_snippet_text("网络配置 添加分布式交换机 ![在这里插入图片描述](https://i-b")
    assert "api/v1/media" not in _clean_snippet_text("图 ![](/api/v1/media/abc.png) 后文")


def test_truncated_link_target_removed():
    """结尾被截断的链接目标 `](...)` 要清掉。"""
    out = _clean_snippet_text("参考文档 ](https://example.com/a")
    assert "](" not in out, out


def test_clean_handles_zero_width_and_bom():
    """BOM / 零宽字符必须清掉，否则会污染片段且干扰高亮。"""
    assert _clean_snippet_text("\ufeff磁盘\u200b管理") == "磁盘管理"


def test_lead_snippet_also_cleaned():
    """**兜底分支**（命中词只在标题里）的片段同样必须清洗。

    ⚠️ 这条是**真机验证抓出来的覆盖盲区**：我最初只改了 `_make_snippet`，
    而路由的 else 分支是 `text[:120].replace("\\n"," ")` 原样切片 ——
    真机跑出来 4 条片段以 `## 1. 概述` 开头、含 ``` 围栏。
    **改一个渲染分支时，必须检查同一功能的其它分支。**
    """
    from app.api.routes import _lead_snippet

    text = "## 1. 概述\n```sh\nwget http://x/y\n```\n这里是正文内容" + "填充" * 60
    out = _lead_snippet(text)
    assert _noise(out) == [], (out, _noise(out))
    assert "概述" in out, out


def test_lead_snippet_truncates_with_ellipsis():
    """超长正文的兜底片段要截断并带省略号（不能把整篇塞进来）。"""
    from app.api.routes import _lead_snippet

    out = _lead_snippet("内容" * 500)
    assert out.endswith("…"), out
    assert len(out) <= 130, len(out)


def test_lead_snippet_short_text_has_no_ellipsis():
    from app.api.routes import _lead_snippet

    out = _lead_snippet("短文内容")
    assert out == "短文内容", out


def test_both_branches_produce_clean_output():
    """两条分支（正文命中 / 仅标题命中）都不允许漏出结构噪声。

    把它做成参数化的一次性断言，防止以后有人只修一条分支。
    """
    from app.api.routes import _lead_snippet

    noisy = "```\n## 标题\n| a | b |\n| --- | --- |\n正文 磁盘 内容\n![pic](/x.png)\n"
    # 分支 A：正文命中
    a = _make_snippet(noisy, noisy.index("磁盘"), 2)
    # 分支 B：仅标题命中（正文无命中词 → 走 lead）
    b_out = _lead_snippet(noisy)
    for name, s in (("正文命中", a), ("仅标题命中", b_out)):
        assert _noise(s) == [], f"{name} 分支漏出噪声: {s!r}"