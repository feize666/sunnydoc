"""搜索结果片段（snippet）的清洗与选词 —— **两条产出路径共用同一实现**。

## 为什么单独成模块（2026-10-13）

片段/引用有**两条产出路径**：`/search`（侧栏搜索）与引用卡片
（`/chat` 与 `/chat/stream`）。历史上这三处的片段逻辑各写各的，于是：

1. **清洗只做了一条**：`_make_snippet` 改了，而「仅标题命中」的兜底分支
   （`_lead_snippet`）与引用路径的 `h["text"][:200]` 都没改 → 真机暴露
   4 条片段以 `## 开头`、含围栏。
2. **定位词只在一条路径改了**：给 `/chat/stream` 加了 `terms`，
   却漏了 `/chat`（走的 `qa.py`）→ 实测 `terms` 全部为空。

**根因不是"忘了改第二处"，而是"第二处根本没有共用的东西可改"。**
本模块把「清洗 / 选词 / 取片段 / 构造引用」收成一份实现，两条路径都从这里取。

## 与前端的分工

前端 `highlightKw` 是**自己在渲染文本里搜词**的，不依赖后端给的字符偏移；
`match_count` / `match_in_title` 也都基于原始文本。
**所以 snippet 只是给人看的「展示串」，清洗不影响任何逻辑。**
但 `terms` 不同 —— 它会被前端拿去在**未清洗的正文**里做子串匹配，
所以必须是「内部无空白的连续词」（详见 `locate_term`）。
"""
from __future__ import annotations

import re

# ---------------- 清洗规则 ----------------
_IMG_RE = re.compile(r"!\[[^\]]*\]\([^)]*\)")
_LINK_RE = re.compile(r"\[([^\]]*)\]\([^)]*\)")
_FENCE_RE = re.compile(r"```[a-zA-Z0-9+#._-]*")
_HTML_TAG_RE = re.compile(r"</?[a-zA-Z][^>]{0,60}>")
# 残留的 markdown 记号，统一换成空格而不是删除 —— 删除会把相邻词粘成一个
# （实测：`磁盘</td><td>类型` 删标签后会变成「磁盘类型」这种假词）
_MD_CHARS_RE = re.compile(r"[|>#*`_~]")
_WS_RE = re.compile(r"\s+")
# 表格分隔行清洗后的残留：`---- ---- ----`（原本是 `| --- | --- |`）。
# 规则：**连续 3 个及以上的短横线**（允许中间夹空格）整段删掉。
#                      ↑ 用 3 个而非 2 个，是为了不误伤 `--disk`、`--vcpus`
#                        这类命令行参数（实测片段里大量出现）。
_SEP_RUN_RE = re.compile(r"(?:-{3,}\s*)+")
# 零宽字符（BOM、\u200b 等）一开始就清掉：它们会让「贴行边界」的查找错位
_ZERO_WIDTH_RE = re.compile(r"[\ufeff\u200b-\u200f\u2028\u2029]")

# 🔴 **截断残留**（真机验证抓出，残留 3/206）：
# 宽松窗口的**边界可能落在图片/链接语法中间**，于是切出 `![img](/api` 这种
# **不完整**标记 —— 上面那些完整模式匹配不到它，就漏给用户了。
# 真实残留样例：`…PiVw 提取码：zhuz 这里注意内存和磁盘给大点 ![img](/api`。
#
# 分两条规则，覆盖两种截断位置：
#   ① 尾部截断：`![img](/api` —— `![...` 之后还有 `](` 与半个 URL，`$` 匹配不到
#      单独一个 `![`，所以用「**尾部含 `![` 就整段砍掉**」处理；
#   ② 中部残留：`前文 ![image`（`![` 已在结尾）→ 用 `!\[[^\]]*$`。
_DANGLING_IMG_TAIL_RE = re.compile(r"!\[.*$")
_DANGLING_IMG_RE = re.compile(r"!\[[^\]]*$")
_DANGLING_MD_TAIL_RE = re.compile(r"\]\([^)]*$")
# 项目自身的媒体路径（`/api/v1/media/<name>` / `/uploads/<name>`）对读者永远是噪声，
# 无论完整与否都清掉 —— 这同时兜住「窗口开头落在 URL 中间」的头截断情况
_MEDIA_PATH_RE = re.compile(r"/?(?:api/v1/media|uploads)/[A-Za-z0-9._-]+\)?")

# ---------------- 跨度常量（选位与渲染必须共用，否则选位会「选偏」）----------------
#
# 🔴 **选位跨度必须等于渲染跨度**（真机对照抓出）：
# `best_hit` 若用 200 字符窗找「最密集处」，而 `make_snippet` 只渲染
# 约 `radius*2` 个字符，则「最密集的 200 字符窗」居中后截到 140 字符，
# **未必是最密集的 140 字符窗** —— 实测片段密度只有 80% ≥ 首命中窗口。
# 两者共用本常量后升到 91%（真机 99 条对照）。
_SNIPPET_RADIUS = 70


def clean_snippet_text(s: str) -> str:
    """把 markdown 结构噪声降级成普通可读文本（图片/围栏删掉，链接留文字）。"""
    s = _ZERO_WIDTH_RE.sub("", s)
    s = _IMG_RE.sub(" ", s)
    s = _LINK_RE.sub(r"\1", s)
    s = _FENCE_RE.sub(" ", s)
    s = _HTML_TAG_RE.sub(" ", s)
    # 截断残留必须在**完整模式之后**处理（否则会破坏完整的 `](url)` 结构）
    s = _DANGLING_IMG_RE.sub(" ", s)
    s = _DANGLING_IMG_TAIL_RE.sub(" ", s)
    s = _DANGLING_MD_TAIL_RE.sub(" ", s)
    s = _MEDIA_PATH_RE.sub(" ", s)
    s = _MD_CHARS_RE.sub(" ", s)
    s = _SEP_RUN_RE.sub(" ", s)
    return _WS_RE.sub(" ", s).strip()


def _strip_separator_edges(s: str) -> str:
    """清掉片段首尾残留的孤立分隔符（如开头只剩一个 `- 列表项` 的 `-`）。"""
    return s.strip().strip("-").strip()


def _trim_to_word_boundary(s: str, window: int = 20) -> str:
    """若片段结尾落在「词中间」，回缩到最近的空白处，避免露出半截词。

    为什么用**词边界**而不是**行边界**：本函数处理的 `s` 已清洗、换行已被压成空格，
    拿不到行信息。且早先试过在原始文本上按 `rfind("\\n")` 贴行尾，会把命中词之后
    的内容整段砍掉（实测某条只剩 16 个字）。词边界回缩只动最后 20 个字符以内。
    """
    tail = s[-window:]
    sp = tail.rfind(" ")
    if sp > 0 and not s.endswith(" "):
        return s[: len(s) - window + sp].rstrip()
    return s


def make_snippet(text: str, idx: int, qlen: int, radius: int = _SNIPPET_RADIUS) -> str:
    """在命中点附近取一段**贴行边界 + 已清洗**的可读文本。

    步骤（顺序重要）：
      1. 取一个宽松窗口（命中点前后各 radius*3），避免清洗后剩余内容太短；
      2. 把窗口**起点**贴到换行处（不从词中间开始），但不得切掉命中词；
      3. 清洗 markdown 噪声；
      4. 在清洗后的文本里**重新定位命中词**（清洗会改变字符位置与长度），
         再以它为中心取 `radius*2+qlen` 的长度。

    第 4 步是必须的：直接用清洗前的偏移去切清洗后的串会错位。

    ⚠️ **不要给窗口终点贴行边界**（一度这么写，是错的）：用 `rfind("\\n")` 找
    窗口内最后一个换行，会把命中词**之后**的所有内容砍掉 —— 实测某条只剩
    16 个字符（`…2、磁盘管理 2.1、磁盘`）。
    """
    span = max(radius * 3, 200)
    start = max(0, idx - span)
    end = min(len(text), idx + qlen + span)
    raw = text[start:end]
    hit = text[idx : idx + qlen].strip()

    # 2. 起点贴行边界（只在不切到命中词的前提下）
    nl = raw.find("\n")
    if 0 <= nl < (idx - start):
        raw = raw[nl + 1 :]
        start += nl + 1

    cleaned = clean_snippet_text(raw)

    # 4. 清洗后重新定位。清洗可能改动命中词本身（如命中词含 `#`/`|`）——
    #    先用原词找，找不到再用「清洗过的命中词」找一次，最后才退化为取开头。
    pos = cleaned.find(hit) if hit else -1
    if pos < 0 and hit:
        pos = cleaned.find(clean_snippet_text(hit))

    lead = "…" if start > 0 else ""
    if pos < 0:
        body = cleaned[: radius * 2 + qlen].strip()
        tail = "…" if len(cleaned) > len(body) else ""
        return (lead + body + tail).strip()

    body_start = max(0, pos - radius)
    body_end = min(len(cleaned), body_start + radius * 2 + qlen)
    body = _strip_separator_edges(cleaned[body_start:body_end])
    tail = "…" if body_end < len(cleaned) else ""
    if tail:
        body = _trim_to_word_boundary(body)
    return (lead + body + tail).strip()


def lead_snippet(text: str, limit: int = 120) -> str:
    """正文里没有命中词时的兜底片段：取**清洗后**的正文开头。

    用于「命中词只在标题里」的结果（如搜「部署」命中「01-vCenter环境部署」——
    标题含「部署」，但正文开头可能没有）。原实现是 `text[:120]` 原样切片，
    会把 `## 标题`、` ``` ` 围栏等结构直接展示给用户。
    """
    cleaned = clean_snippet_text(text[: limit * 2])
    body = cleaned[:limit].strip()
    return (body + "…") if len(cleaned) > len(body) else body


def locate_term(chunk_text: str, full_text: str | None = None, max_len: int = 20) -> str:
    """取一个「前端能在正文里搜到」的定位词，供点击引用后高亮。

    **为什么需要它（实测）**

    引用卡片原来的定位词是前端拼的：`snippet.replace(/\\s+/g," ").slice(0,20)`
    —— 把分片的**前 20 个字符**当高亮词。但分片是裸原文，前 20 字符常含
    换行/制表/表格对齐空格，而前端是在**未清洗的原文**里做子串匹配：

    | 分片开头 | 前端拼出的词 | 结果 |
    |---|---|---|
    | `温馨提示:\\r\\n\\t上述两条命令…` | `温馨提示: 上述两条命令必须在KVM虚拟` | 空白被压成空格 → 找不到 |
    | ` ```sh\\r\\n#取出指定网卡的信息` | ` ```sh #取出指定网卡的信息 ip ` | 换行 → 找不到 |
    | `\\| 常见原因        \\| 排查  \\|` | `\\| 常见原因 \\| 排查 \\| 如何解决 \\|` | 对齐空格被压缩 → 找不到 |

    实测 12 条引用，**只有 6 条（50%）能在原文里定位到**。

    **三条踩过的坑**（每一条都让定位率掉 0 或跳回旧水平）：

    1. **不能拿「清洗后的拼接串」去搜**。清洗把 `温馨提示:\\r\\n\\t上述…` 变成
       `温馨提示: 上述…`，但**原文里仍是 `\\r\\n\\t`** → 照样搜不到。
    2. **中文没有空格，`split(" ")` 的 token 往往是整行**。
       早先按 `max_len` 直接**跳过**超长 token → 中文分片几乎全被跳过、
       `terms` 为空（实测 4/18 为空，全是这种）。正确做法是**截前缀**：
       连续子串仍无空白 → 仍可定位。
    3. **截出来的前缀仍要拿原文验证**。清洗可能移除了 token 内部的某个字符
       （如 `**`、`|`），截断后可能跨过被移除处而不存在。

    做法：清洗 → **排除代码块内部**（见下）→ 按空白切词、按长度降序
    （优先更具体的词）→ 从 `max_len` 逐步缩短，**第一个能在 `chunk_text`
    里原样找到的**即为结果。返回空串表示这片确实没有可用词，前端走回退。

    **④ 必须排除代码块内部**（真机点击验证抓出，最隐蔽的一条）：

    前端高亮走 `renderMarkdown` 产出的 HTML，而**代码块里的文字不做关键词高亮**
    （由 shiki 处理、内容在 `<code>` 里）。若选出的词落在 ```` ``` ```` 围栏之内，
    会出现「文档跳过去了、正文里也搜得到该文本，但**一个高亮都没有**」。
    实测：`kvm日常使用命令` 里有作者把「温馨提示」写在了代码块结束前
    （整篇 34 个围栏，该词之前有 33 个 = 奇数）→ 点击后 `mark.search-hit` 数 **0**。

    ⚠️ **块内外必须按「整篇正文」判断，不能按分片**：
    `_segment` 按空行/句子切片，**完全不知道代码块结构**，
    分片边界会把代码块截断（实测某分片开头就是块内文字、却只含 1 个行首围栏）。
    → 本函数因此接收 `full_text`（整篇），`chunk_text` 只用于取候选词。

    ⚠️ 也不能用「统计围栏个数」的朴素做法（` ``` ` 会出现在行内代码里）；
    用**行首围栏**判定（同 markdown 规范：只有行首的 ```` ``` ```` 才开关代码块）。

    Args:
        chunk_text: 分片文本（取候选词的来源）
        full_text: 整篇正文；提供时用于「排除代码块内的词」+ 存在性校验。
            缺省回退到 `chunk_text`（此时块内外判断可能不准，但至少能定位）。
    """
    if not chunk_text:
        return ""
    outside = _non_code_text(full_text) if full_text else _non_code_text(chunk_text)
    cleaned = clean_snippet_text(outside)
    if not cleaned:
        return ""
    haystack = full_text or chunk_text
    for tok in sorted(cleaned.split(" "), key=len, reverse=True):
        cand = tok.strip()[:max_len]
        while len(cand) >= 4:
            # 关键：拿**原文**验证（清洗可能改动过字符）
            if cand in haystack:
                return cand
            cand = cand[:-1]
    return ""


# 行首围栏：只有行首（允许前导空白）的 ``` 才开关代码块（行内 ```` `x` ```` 不算）
_FENCE_LINE_RE = re.compile(r"^[ \t]*```", re.M)


def _non_code_text(text: str) -> str:
    """返回 text 中**代码块之外**的部分（按行首 ``` 切分，保留块外片段）。

    用途见 `locate_term` 第 ④ 条：代码块内的文字前端不高亮，不能作为定位词。
    """
    parts: list[str] = []
    pos = 0
    inside = False
    for m in _FENCE_LINE_RE.finditer(text):
        if not inside:
            parts.append(text[pos : m.start()])
        inside = not inside
        pos = m.end()
    if not inside:
        parts.append(text[pos:])
    return " ".join(p for p in parts if p.strip())


def build_citation(hit: dict, full_text: str | None = None) -> dict:
    """构造一条引用（所有引用路径都从这里取，避免字段分叉）。

    `terms` 是定位词（见 `locate_term`），前端拿它在正文里高亮。
    `full_text` 传来源文档整篇正文 —— **必须传**，否则无法判断命中词是否在
    代码块内（分片边界会截断代码块）。缺省时仅按分片判断，可能选出块内词。
    """
    return {
        "doc_id": hit["doc_id"],
        "title": hit["title"],
        "source": hit["source"],
        "segment_index": hit["segment_index"],
        "snippet": hit["text"][:200],
        "terms": locate_term(hit["text"], full_text),
    }


def build_citations(hits: list[dict], full_texts: dict[str, str] | None = None) -> list[dict]:
    """`full_texts`：{doc_id: 整篇正文}。缺失的文档退化为仅按分片判断。"""
    ft = full_texts or {}
    return [build_citation(h, ft.get(h["doc_id"])) for h in hits]