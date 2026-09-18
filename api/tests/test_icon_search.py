"""icon_search 服务单元测试：中文检索词翻译 + SVG 正文净化。

这两个函数是「联网搜图」的关键路径：
- 翻译决定中文用户能不能搜到东西（Iconify 索引只有英文）；
- 净化决定第三方 SVG 落进页面时能不能带进 XSS。
两者都是纯函数，适合直接做单元测试。
"""
from app.services.icon_search import _sanitize_body, _translate_query


# ---------- 中文 → 英文检索词 ----------

def test_translate_exact():
    assert _translate_query("服务器") == "server"
    assert _translate_query("用户") == "user"
    assert _translate_query("数据库") == "database"


def test_translate_english_passthrough():
    # 英文关键词原样保留，不受影响
    assert _translate_query("rocket") == "rocket"
    assert _translate_query("user profile") == "user profile"


def test_translate_longest_match_first():
    """长词优先：`数据库服务器架构` 不能被短词「数据」抢先切走。

    这类复合词是中文里最常见的形式，若按短词先匹配会退化成
    "data 服务器架构"，中间残片被丢弃后检索词就残缺了。
    """
    assert _translate_query("数据库服务器架构") == "database server architecture"


def test_translate_mixed_language():
    assert _translate_query("服务器 rocket") == "server rocket"


def test_translate_unknown_chinese_falls_back():
    """完全不在词表内的中文原样返回（交给上游处理，可能返回空结果）。"""
    assert _translate_query("量子") == "量子"


def test_translate_empty():
    assert _translate_query("") == ""


# ---------- SVG 净化 ----------

def test_sanitize_removes_script():
    out = _sanitize_body('<path d="M0 0"/><script>alert(1)</script>')
    assert "script" not in out
    assert "alert" not in out
    assert "<path" in out


def test_sanitize_removes_event_handlers():
    out = _sanitize_body('<path d="M0 0" onload="alert(1)" onclick="evil()"/>')
    assert "onload" not in out
    assert "onclick" not in out
    assert "alert" not in out


def test_sanitize_removes_foreign_object():
    out = _sanitize_body(
        '<foreignObject><script>alert(1)</script></foreignObject><path d="M1 1"/>'
    )
    assert "foreignObject" not in out
    assert "script" not in out
    assert "<path" in out


def test_sanitize_strips_javascript_href():
    """<a> 被改写成 <g>，其 href 一并丢弃，但内部图元保留。"""
    out = _sanitize_body('<a href="javascript:alert(1)"><path d="M2 2"/></a>')
    assert "javascript:" not in out
    assert "href" not in out
    assert "<path" in out
    assert "<g>" in out


def test_sanitize_removes_style_and_comment():
    out = _sanitize_body('<style>*{display:none}</style><path d="M3 3"/><!-- <script>x</script> -->')
    assert "<style" not in out
    assert "<!--" not in out
    assert "script" not in out


def test_sanitize_removes_use_and_image():
    """<use> / <image> 可外链加载远程资源，必须整体移除。"""
    out = _sanitize_body('<use href="//evil.com/x.svg#y"/><image href="//evil.com/a.png"/>')
    assert "<use" not in out
    assert "<image" not in out
    assert "evil.com" not in out


def test_sanitize_keeps_nested_geometry():
    """合法嵌套结构完整保留，闭合标签要配对（不能被改写成非法 SVG）。"""
    src = '<g fill="none"><g stroke="red"><path d="M5 5"/></g></g>'
    out = _sanitize_body(src)
    assert out.count("<g") == out.count("</g>") == 2
    assert 'stroke="red"' in out


def test_sanitize_keeps_normal_icon():
    """常规图标（fill-rule / stroke 等呈现属性）不应被过度清洗。"""
    src = (
        '<path fill="currentColor" fill-rule="evenodd" d="M12 2S7 4 7 12z"/>'
        '<circle cx="5" cy="5" r="2" fill="none" stroke="currentColor" stroke-width="1.5"/>'
    )
    out = _sanitize_body(src)
    assert 'fill-rule="evenodd"' in out
    assert 'stroke-width="1.5"' in out
    assert "<circle" in out


def test_sanitize_empty():
    assert _sanitize_body("") == ""