"""exporter 服务单元测试：文件名清洗、多格式导出。"""
import pytest

from app.services import exporter


def test_safe_filename():
    assert exporter._safe_filename('a/b\\c:d*e?f"g<h>i|j') == "a_b_c_d_e_f_g_h_i_j"
    assert exporter._safe_filename("   ") == "export"
    assert exporter._safe_filename("正常标题") == "正常标题"


def test_build_md_single():
    content, filename, ctype = exporter.build("md", [{"title": "测试文档", "text": "正文内容"}])
    assert filename == "测试文档.md"
    assert content.decode("utf-8") == "正文内容"
    assert "markdown" in ctype


def test_build_md_multi():
    docs = [{"title": "a", "text": "内容1"}, {"title": "b", "text": "内容2"}]
    content, filename, _ = exporter.build("md", docs)
    assert filename == "export.md"
    text = content.decode("utf-8")
    assert "# a" in text
    assert "# b" in text
    assert "---" in text  # 多文档分隔符


def test_build_json():
    docs = [
        {
            "id": "1",
            "title": "a",
            "text": "内容",
            "source": "a.md",
            "ext": ".md",
            "created_at": 123456.0,
        }
    ]
    content, filename, ctype = exporter.build("json", docs)
    assert filename == "export.json"
    assert "application/json" in ctype
    assert '"title"' in content.decode("utf-8")


def test_build_unsupported():
    with pytest.raises(ValueError):
        exporter.build("unknownfmt", [{"title": "x", "text": "y"}])


def test_build_case_insensitive():
    # 格式名大小写不敏感
    content, _, _ = exporter.build("MD", [{"title": "T", "text": "x"}])
    assert content.decode("utf-8") == "x"
