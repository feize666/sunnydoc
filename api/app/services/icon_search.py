"""联网图形搜索服务：Iconify 图标库（20 万+ 开源 SVG 图标）。

为什么经后端代理而不是前端直连：
- 前端直连要发两次请求（先 search 拿图标名，再取每个图标的路径），一屏 24 个图标
  就是 25 次往返；这里在服务端合并成一次，前端只调一个接口。
- 服务端有 SSR/浏览器之外的稳定出口，可做超时与降级，不受用户侧网络环境影响。

安全边界：返回给前端的 `body` 是**第三方内容**，本模块负责在服务端做一次净化
（只放行纯几何绘图元素），前端写入文档前还会再净化一次 —— 双重防线，任一层失效
都不至于让 `<script>` / `<foreignObject>` 落进页面或文档。
"""
from __future__ import annotations

import re
from typing import Any

import httpx

ICONIFY_API = "https://api.iconify.design"

# 只查询这几个主流开源集合：覆盖面足够（Material / Tabler / Phosphor / Solar / Lucide …），
# 且都以 24x24 或规整 viewBox 为主，风格上能共存于同一张图。
# 不加限制会混入大量风格迥异的集合（手绘、像素、彩色），排在同一网格里很不协调。
ICON_COLLECTIONS = "mdi,tabler,ph-mdi,ph,fluent,solar,lucide,bi,ri,carbon"

# 关键词长度上限：防止超长串打满上游配额
MAX_QUERY_LEN = 64
# 一次返回的候选数（前端一屏约 24 个，多取一些便于滚动）
DEFAULT_LIMIT = 36
MAX_LIMIT = 60

# —— 中文 → 英文检索词映射 ——
# 为什么要这层：Iconify 的检索索引**只有英文**，实测「服务器 / 用户 / 数据库」等
# 中文关键词全部返回 0 结果 —— 对中文用户来说搜索框等于不可用。
# 这里把常见绘图词汇映射成英文再查，是成本最低、效果最直接的解法。
# 键按「长词优先」匹配（见 _translate_query），避免「数据库服务器」先命中短词「数据」。
ZH_TO_EN: dict[str, str] = {
    # 角色与人
    "用户": "user", "客户": "customer", "团队": "team", "人员": "people",
    "员工": "employee", "管理员": "admin", "开发者": "developer", "机器人": "robot",
    "人物": "person", "头像": "avatar",
    # 系统与技术
    "服务器": "server", "数据库": "database", "云": "cloud", "云端": "cloud",
    "网络": "network", "接口": "api", "终端": "terminal", "命令行": "terminal",
    "容器": "container", "微服务": "microservice", "缓存": "cache", "消息队列": "queue",
    "负载均衡": "load balancer", "网关": "gateway", "防火墙": "firewall",
    "监控": "monitor", "日志": "log", "部署": "deploy", "扩容": "scale",
    # 安全与权限
    "安全": "security", "加密": "encryption", "密钥": "key", "锁": "lock",
    "认证": "authentication", "权限": "permission", "登录": "login", "密码": "password",
    "盾牌": "shield", "警告": "warning", "风险": "risk",
    # 数据与文档
    "数据": "data", "文档": "document", "文件": "file", "文件夹": "folder",
    "报表": "report", "图表": "chart", "统计": "statistics", "分析": "analytics",
    "搜索": "search", "任务": "task", "清单": "checklist", "表格": "table",
    "设置": "settings", "配置": "config",
    # 流程与业务
    "流程": "workflow", "步骤": "step", "审批": "approval", "订单": "order",
    "支付": "payment", "购物车": "cart", "电商": "ecommerce", "营销": "marketing",
    "客服": "support", "工单": "ticket", "邮件": "email", "消息": "message",
    "通知": "notification", "日历": "calendar", "日程": "schedule", "时间": "time",
    "时钟": "clock", "进度": "progress", "目标": "target", "里程碑": "milestone",
    # 硬件与设备
    "电脑": "computer", "手机": "mobile", "平板": "tablet", "打印机": "printer",
    "相机": "camera", "摄像头": "camera", "硬盘": "storage", "内存": "memory",
    "芯片": "chip", "处理器": "cpu", "键盘": "keyboard", "鼠标": "mouse",
    "显示器": "monitor", "路由器": "router", "传感器": "sensor", "物联网": "iot",
    # 图标与状态
    "成功": "check", "完成": "check", "失败": "error", "错误": "error", "取消": "cancel",
    "添加": "plus", "删除": "delete", "编辑": "edit", "上传": "upload", "下载": "download",
    "分享": "share", "刷新": "refresh", "同步": "sync", "链接": "link", "附件": "attachment",
    "星标": "star", "收藏": "bookmark", "标签": "tag", "筛选": "filter", "排序": "sort",
    "刷新重试": "refresh", "帮助": "help", "信息": "info", "问题": "question",
    "加载": "loading", "首页": "home", "菜单": "menu", "列表": "list", "网格": "grid",
    # 抽象与通用
    "想法": "idea", "灯泡": "lightbulb", "创意": "idea", "创新": "innovation",
    "开始": "play", "暂停": "pause", "停止": "stop", "火箭": "rocket", "发射": "launch",
    "增长": "growth", "趋势": "trending", "利润": "profit", "成本": "cost",
    "预算": "budget", "金额": "money", "钱包": "wallet", "银行卡": "credit card",
    "合同": "contract", "法律": "legal", "合规": "compliance", "质量": "quality",
    "测试": "test", "调试": "debug", "优化": "optimize", "性能": "performance",
    "架构": "architecture", "设计": "design", "开发": "development", "运维": "operations",
    "人工智能": "ai", "智能": "smart", "算法": "algorithm", "模型": "model",
    "神经网络": "neural network", "知识": "knowledge", "学习": "learn", "教育": "education",
    "医疗": "medical", "健康": "health", "医生": "doctor", "医院": "hospital",
    "交通": "traffic", "汽车": "car", "物流": "logistics", "仓库": "warehouse",
    "工厂": "factory", "农业": "agriculture", "能源": "energy", "环保": "environment",
    "天气": "weather", "太阳": "sun", "月亮": "moon", "星星": "star", "地球": "globe",
    "位置": "location", "地图": "map", "世界": "world", "建筑": "building", "办公室": "office",
}

# 中文词表按长度降序：长词优先命中，避免「数据库服务器」被短词「数据」抢先切走
_ZH_KEYS_BY_LEN = sorted(ZH_TO_EN.keys(), key=len, reverse=True)


def _translate_query(q: str) -> str:
    """把中文关键词转成英文检索词。

    策略：
    1. 整串精确命中映射表 → 直接用对应英文（「服务器」→ server）。
    2. 否则把串里出现的中文词**逐个替换**成英文、英文原样保留，拼成检索串
       （「数据库服务器架构」→ "database server architecture"）。
    3. 一个中文词都没命中时原样返回，交由上游处理（可能返回空，前端会显示无结果）。
    """
    if not q:
        return q
    if q in ZH_TO_EN:
        return ZH_TO_EN[q]
    # 按长词优先扫描替换，替换过的部分用占位符避免被更短的词二次命中
    out = q
    for zh in _ZH_KEYS_BY_LEN:
        if zh in out:
            out = out.replace(zh, f" {ZH_TO_EN[zh]} ")
    out = " ".join(out.split())
    # 仍含未翻译的中文（如「量子」不在表内）：去掉纯中文残片，避免带着无效词去查
    if any("\u4e00" <= ch <= "\u9fff" for ch in out):
        kept = [w for w in out.split() if not any("\u4e00" <= ch <= "\u9fff" for ch in w)]
        out = " ".join(kept)
    return out or q

# —— 净化白名单（与服务端输出、前端写入共用语义）——
ALLOWED_TAGS = {
    "path", "circle", "ellipse", "rect", "line", "polyline", "polygon", "g",
}
ALLOWED_ATTRS = {
    "d", "cx", "cy", "r", "rx", "ry", "x", "y", "x1", "y1", "x2", "y2",
    "width", "height", "points", "transform",
    "fill", "fill-rule", "fill-opacity",
    "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin",
    "stroke-opacity", "stroke-dasharray", "stroke-miterlimit", "opacity",
}

_TAG_RE = re.compile(r"<\s*/?\s*([a-zA-Z][\w:-]*)")
_ATTR_RE = re.compile(r"([a-zA-Z_:][\w:.-]*)\s*=\s*(\"[^\"]*\"|'[^']*')")


def available() -> bool:
    return True


def _sanitize_body(raw: str) -> str:
    """按白名单净化图标正文（正则实现，服务端不引入 XML 依赖）。

    策略：先把危险元素**连同其内容**整体剔除（script/foreignObject/use/image/style/a…），
    再逐个元素筛属性。任何拿不准的构造一律丢弃 —— 宁可少显示一个图标。
    """
    if not raw:
        return ""
    out = raw
    # 1. 危险元素连内容整段删除（这些标签内的内容本身就是攻击载荷，不能保留）
    for tag in ("script", "foreignObject", "style", "image", "use", "iframe", "animate", "set"):
        out = re.sub(rf"<\s*{tag}\b.*?<\s*/\s*{tag}\s*>", "", out, flags=re.S | re.I)
        out = re.sub(rf"<\s*/?\s*{tag}\b[^>]*>", "", out, flags=re.I)
    # 剔除注释 / CDATA / DOCTYPE，避免藏 payload
    out = re.sub(r"<!--.*?-->", "", out, flags=re.S)
    out = re.sub(r"<!\[CDATA\[.*?\]\]>", "", out, flags=re.S)
    out = re.sub(r"<!DOCTYPE[^>]*>", "", out, flags=re.I)

    # 2. 逐元素筛选：白名单外的**标签**改写成 <g> / </g> 以保留其子元素。
    #    注意必须保留闭合斜杠 —— 若把 </a> 也写成 <g>，嵌套结构会被破坏成非法 SVG。
    def keep_tag(m: re.Match[str]) -> str:
        tag = m.group(1).lower()
        if tag in ALLOWED_TAGS:
            return m.group(0)
        prefix = "</" if m.group(0).lstrip().startswith("</") else "<"
        return prefix + "g"

    out = _TAG_RE.sub(keep_tag, out)

    # 3. 逐属性筛选：删除白名单外的属性（on* / href / xlink:href / style / class / id 都在外）
    def filter_attrs(m: re.Match[str]) -> str:
        name = m.group(1).lower()
        return m.group(0) if name in ALLOWED_ATTRS else ""

    out = _ATTR_RE.sub(filter_attrs, out)
    # 属性被删后可能留下多余空格，压缩一下
    out = re.sub(r"\s+>", ">", out)
    return out.strip()


def search_icons(query: str, limit: int = DEFAULT_LIMIT) -> dict[str, Any]:
    """检索图标并一次性取回路径正文。

    返回 {"icons": [{prefix, name, w, h, body}], "query": ...}
    上游不可用时抛 httpx.HTTPError，由路由层转成 502。
    """
    q = (query or "").strip()[:MAX_QUERY_LEN]
    if not q:
        return {"icons": [], "query": q}
    limit = max(1, min(int(limit or DEFAULT_LIMIT), MAX_LIMIT))
    # 中文关键词先转成英文检索词（Iconify 索引只有英文）
    search_term = _translate_query(q)

    with httpx.Client(timeout=8.0) as client:
        # 1. 检索：限定集合，拿到 "prefix:name" 列表
        r = client.get(
            f"{ICONIFY_API}/search",
            params={"query": search_term, "limit": limit, "prefixes": ICON_COLLECTIONS},
        )
        r.raise_for_status()
        names: list[str] = r.json().get("icons", []) or []
        if not names:
            return {"icons": [], "query": q, "term": search_term}

        # 2. 按集合分组批量取正文：/mdi.json?icons=a,b,c 一次拿一个集合的全部图标，
        #    比逐个 /mdi/a.svg 少几十次往返。
        by_prefix: dict[str, list[str]] = {}
        for full in names[:limit]:
            if ":" not in full:
                continue
            prefix, name = full.split(":", 1)
            by_prefix.setdefault(prefix, []).append(name)

        icons: list[dict[str, Any]] = []
        for prefix, icon_names in by_prefix.items():
            try:
                rr = client.get(
                    f"{ICONIFY_API}/{prefix}.json",
                    params={"icons": ",".join(icon_names)},
                )
                rr.raise_for_status()
                data = rr.json()
            except httpx.HTTPError:
                # 单个集合失败不影响整体：跳过它，其余照常返回
                continue
            dw = float(data.get("width") or 24)
            dh = float(data.get("height") or 24)
            raw_icons = data.get("icons") or {}
            aliases = data.get("aliases") or {}
            for name in icon_names:
                entry = raw_icons.get(name)
                # 别名（如 mdi:user → account）指向真实条目
                if entry is None and name in aliases:
                    entry = raw_icons.get((aliases[name] or {}).get("parent", ""))
                if not entry or not entry.get("body"):
                    continue
                body = _sanitize_body(str(entry["body"]))
                if not body:
                    continue
                icons.append({
                    "prefix": prefix,
                    "name": name,
                    "w": dw,
                    "h": dh,
                    "body": body,
                })
        return {"icons": icons, "query": q, "term": search_term}