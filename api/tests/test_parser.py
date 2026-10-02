"""parser 服务单元测试：文件扩展名识别、文本/HTML 解析、媒体引用改写。"""
from app.services.parser import (
    ext_of,
    parse_file,
    html_to_markdown,
    replace_md_image_refs,
    replace_html_media_refs,
)


def test_ext_of():
    assert ext_of("doc.md") == ".md"
    assert ext_of("DOC.PDF") == ".pdf"
    assert ext_of("noext") == ""
    assert ext_of("a.b.c.txt") == ".txt"
    assert ext_of("archive.tar.gz") == ".gz"


def test_parse_file_md():
    data = "# 标题\n\n正文内容".encode("utf-8")
    parsed = parse_file("t.md", data)
    assert len(parsed) == 1
    assert parsed[0]["text"] == "# 标题\n\n正文内容"
    assert parsed[0]["ext"] == ".md"
    assert parsed[0]["name"] == "t.md"


def test_parse_file_txt():
    parsed = parse_file("note.txt", "纯文本内容".encode("utf-8"))
    assert len(parsed) == 1
    assert parsed[0]["text"] == "纯文本内容"


def test_parse_file_unknown():
    # 未知扩展名返回空列表（不支持的类型）
    assert parse_file("x.unknownext", b"data") == []


def test_html_to_markdown_basic():
    html = (
        "<html><head><title>测试标题</title></head><body>"
        "<article><h1>第一章</h1><p>正文内容 <strong>加粗</strong></p></article>"
        "</body></html>"
    )
    title, md = html_to_markdown(html)
    assert title == "测试标题"
    assert "第一章" in md
    assert "正文内容" in md


def test_html_to_markdown_strips_noise():
    html = (
        "<html><head><title>T</title></head><body>"
        "<nav>导航菜单</nav><script>var x=1;</script>"
        "<article><p>正文</p></article>"
        "<footer>页脚</footer></body></html>"
    )
    _, md = html_to_markdown(html)
    assert "正文" in md
    assert "导航菜单" not in md
    assert "页脚" not in md
    assert "var x" not in md


# ---------------------------------------------------------------------------
# 媒体引用改写（zip 导入）
# ---------------------------------------------------------------------------


def _path_map(*pairs: tuple[str, str]) -> dict[str, str]:
    return dict(pairs)


def test_replace_md_image_refs_hit_and_miss():
    """命中的相对路径改写为 /api/v1/media/{stored}；未命中/外链保持原样。"""
    path_map = _path_map(("docs/img/a.png", "aaaa1111.png"))
    md = "![图A](img/a.png)\n![外链](https://x.com/b.png)\n![缺](img/missing.png)"
    out = replace_md_image_refs(md, "docs/readme.md", path_map)
    assert "![图A](/api/v1/media/aaaa1111.png)" in out
    assert "![外链](https://x.com/b.png)" in out
    assert "![缺](img/missing.png)" in out


def test_replace_md_image_refs_parent_dir():
    """`../` 相对路径应能归一化到 zip 内绝对路径（docs/sub + ../media = docs/media）。"""
    path_map = _path_map(("docs/media/logo.png", "bbbb2222.png"))
    out = replace_md_image_refs("![](../media/logo.png)", "docs/sub/a.md", path_map)
    assert out == "![](/api/v1/media/bbbb2222.png)"


def test_replace_html_media_refs_img_src():
    """HTML 的 <img src> 必须改写（原先与 markdown 不对称，图片全部裂开）。"""
    path_map = _path_map(("a/b/photo.jpg", "cccc3333.jpg"))
    html = '<p>正文</p><img src="photo.jpg" alt="p">'
    out = replace_html_media_refs(html, "a/b/page.html", path_map)
    assert 'src="/api/v1/media/cccc3333.jpg"' in out
    assert "photo.jpg\"" not in out


def test_replace_html_media_refs_attrs_and_external():
    """覆盖 href/poster/data-src；外部链接、data: 与锚点一律不动。"""
    path_map = _path_map(
        ("r/pic.png", "dddd4444.png"),
        ("r/clip.mp4", "eeee5555.mp4"),
        ("r/doc.pdf", "ffff6666.pdf"),
    )
    html = (
        '<img data-src="pic.png">'
        '<video poster="clip.mp4"><source src="clip.mp4"></video>'
        '<a href="doc.pdf">下载</a>'
        '<img src="https://cdn.com/x.png">'
        '<img src="data:image/png;base64,AAAA">'
        '<a href="#top">顶部</a>'
    )
    out = replace_html_media_refs(html, "r/page.html", path_map)
    assert 'data-src="/api/v1/media/dddd4444.png"' in out
    assert 'poster="/api/v1/media/eeee5555.mp4"' in out
    assert 'src="/api/v1/media/eeee5555.mp4"' in out
    assert 'href="/api/v1/media/ffff6666.pdf"' in out
    assert 'src="https://cdn.com/x.png"' in out
    assert 'src="data:image/png;base64,AAAA"' in out
    assert 'href="#top"' in out


def test_replace_html_media_refs_query_and_encoding():
    """带查询串或 %20 编码的引用也要能命中映射。"""
    path_map = _path_map(("p/my file.png", "gggg7777.png"))
    html = '<img src="my file.png?raw=1"><img src="my%20file.png">'
    out = replace_html_media_refs(html, "p/page.html", path_map)
    assert out.count("/api/v1/media/gggg7777.png") == 2


def test_replace_html_media_refs_no_map_is_noop():
    """空 path_map 时原样返回，不产生任何改写。"""
    html = '<img src="a.png">'
    assert replace_html_media_refs(html, "x/page.html", {}) == html
