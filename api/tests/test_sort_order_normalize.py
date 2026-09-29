"""sort_order 值域归一化与网格不变式测试。

背景（为什么要锁住这些行为）：
    历史数据的 sort_order 种子等于 created_at（约 1.79e9 的秒级时间戳），
    而改造后的手动顺序是「1024 的整数倍、随行数线性增长」（十万行也才 1e8）。
    两套量纲若同时进库，前端升序比较会把手动顺序整段压到列表末尾，
    **且不报任何错** —— 只是「顺序乱了」。实测过：库里出现 2 行 1.79e9
    的值时，页面上那两个文档就固定钉在最底部。

    曾在实现 `_normalize_sort_order` 时把方向写反（让旧值升序后整体跑到
    新值**之前**），本文件的 `test_legacy_newer_sorts_on_top` 就是为此设的回归锁。
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.db import (  # noqa: E402
    SORT_COORD_LIMIT,
    SORT_STEP,
    _normalize_sort_order,
)


def test_grid_values_pass_through_unchanged():
    """合法值（1024 网格，含负数与 0）必须原样返回，不能被兜底逻辑改动。"""
    for v in (0.0, SORT_STEP, 2 * SORT_STEP, -SORT_STEP, 210 * SORT_STEP):
        assert _normalize_sort_order(v) == v


def test_none_and_garbage_become_none():
    """NULL / 非数字不能变成 0 —— 0 会被误当成「最靠上」，语义不同。"""
    assert _normalize_sort_order(None) is None
    assert _normalize_sort_order("abc") is None


def test_legacy_seed_folds_into_bottom_band():
    """旧种子必须折进「底部区带」，即确定性地排在合法网格之后。

    为什么不插到「正确位置」：正确位置取决于该分组的种子分布与重播种的名次分配，
    读取时无法得知。与其猜错，不如放到底部并显著告警，等重播种修好。
    """
    seeds = [1789697587.795, 1790124741.726, 1790126131.595]
    outs = [_normalize_sort_order(s) for s in seeds]
    assert all(o is not None for o in outs)
    # 整段高于任何现实的网格值（网格 = 行数 × 1024，十万行也才约 1e8）
    assert min(outs) > 1e8
    # 且仍低于阈值，否则会被判成「未迁移」，自检永远告警
    assert max(outs) < SORT_COORD_LIMIT


def test_legacy_newer_sorts_on_top():
    """旧语义是 `ORDER BY sort_order DESC` 且种子 = created_at → 越新越靠上。

    因此归一化后必须满足：created_at 越大 → 值越小（升序下越靠上）。
    这是本文件存在的核心理由：第一版实现把这个方向写反了。
    """
    older, newer = 1789697587.0, 1790126131.0
    assert _normalize_sort_order(newer) < _normalize_sort_order(older)


def test_legacy_ordering_is_monotonic():
    """单调性：一串递增的种子，归一化后必须严格递减。"""
    seeds = sorted([1789697587.0, 1790000000.0, 1790124741.0, 1790126131.0])
    outs = [_normalize_sort_order(s) for s in seeds]
    assert outs == sorted(outs, reverse=True), f"单调性被破坏：{outs}"


def test_out_of_range_seed_is_clamped_not_extrapolated():
    """超出实测时间戳范围的值（2e9 / inf）必须被夹住，不能外推出怪值。"""
    band_lo, band_hi = 9.0e8, 9.0e8 + 1e6
    for v in (2e9, 5e9, float("inf")):
        o = _normalize_sort_order(v)
        assert o is not None and band_lo <= o <= band_hi, (v, o)


def test_no_legacy_value_collides_with_grid_zero():
    """旧种子绝不能映射到 0 —— 0 是合法网格值（表示「最顶部」），撞车会互相混淆。

    这正是第一版的 bug：映射区间是 [-1e6, 0)，而 0 在排除区间内，
    导致接近阈值的旧值恰好落到 0。
    """
    assert _normalize_sort_order(SORT_COORD_LIMIT + 1) != 0
    # 网格上的任何一个值都不应等于旧种子的归一化结果
    grid = {i * SORT_STEP for i in range(-210, 1025)}
    for v in (SORT_COORD_LIMIT + 1, 1.2e9, 1.5e9, 1.8e9, 2e9):
        assert _normalize_sort_order(v) not in grid, v


def test_threshold_boundary():
    """阈值本身算合法，刚过阈值才折 —— 边界行为要明确。"""
    assert _normalize_sort_order(SORT_COORD_LIMIT) == SORT_COORD_LIMIT
    assert _normalize_sort_order(SORT_COORD_LIMIT + 1) > 1e8


def test_mixed_grid_keeps_manual_order_intact():
    """混入旧种子的行，不能打乱合法行的相对顺序（这是当初的真实症状）。

    第一版把旧值折到网格**之前**，于是漏洗的旧行整段挤到列表顶部、
    把用户拖出来的手动顺序全部推下去 —— 比原来的 bug 还糟。
    """
    manual = [SORT_STEP, 2 * SORT_STEP, 3 * SORT_STEP]   # 用户拖出来的顺序
    legacy = [1790126131.595, 1789697587.795]            # 两行漏洗的旧数据
    ordered = sorted(manual + legacy, key=_normalize_sort_order)
    # 手动顺序必须原样保留在最前，旧数据整段落到其后
    assert ordered[:3] == manual, ordered
    assert set(ordered[3:]) == set(legacy), ordered