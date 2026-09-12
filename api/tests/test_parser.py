"""parser 服务单元测试：文件扩展名识别、文本/HTML 解析。"""
from app.services.parser import ext_of, parse_file, html_to_markdown


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
