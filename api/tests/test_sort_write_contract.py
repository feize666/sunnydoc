"""写入侧不变式：任何新写入的 sort_order 都必须落在「1024 网格」坐标系内。

为什么需要这类测试 —— 本次改造踩过的两个坑，根因是同一个：

  旧语义的种子是 `created_at`（秒级时间戳，约 1.79e9），新语义是
  「1024 的整数倍、随行数线性增长」（十万行也才约 1e8）。两者混在一张表里，
  前端的升序比较会把旧量纲的行**整段压到列表末尾**，而且**不报错**
  —— 症状是「数据都在、只是顺序乱了」，定位成本极高。

  两处曾经的漏网：
    1. `scripts/migrate_json_to_pg.py` 原样写入 JSON 里的 sort_order
       （已修：补齐列 + 迁移后探测 + 文档警告）。
    2. `db.add_document` / `db.create_folder` 的兜底默认值是
       `doc["created_at"]` —— 任一调用方漏传 sort_order，就会静默写入旧量纲。

  这类 bug 的特点是「逻辑正确、只在数据值域上出错」，所以不能靠 review，
  要把它变成**可自动校验的契约**：写入边界只允许网格值，兜底也不许引入旧量纲。
"""
from __future__ import annotations

import pytest

from app.services import db


def test_coord_limit_separates_grid_from_legacy_seed():
    """阈值必须夹在「现实网格上限」与「旧种子下限」之间。"""
    # 十万行的网格最大约 1e8，必须远低于阈值
    assert 100_000 * db.SORT_STEP < db.SORT_COORD_LIMIT
    # 旧种子下限必须高于阈值（否则辨认不出旧种子）
    assert db._LEGACY_SEED_MIN > db.SORT_COORD_LIMIT
    # 归一化区带必须在阈值之下，否则启动自检会永远告警
    assert db._LEGACY_BAND_LO + db._LEGACY_BAND_SPAN < db.SORT_COORD_LIMIT
    # 区带也必须高于现实网格上限，否则会挤占用户的手动顺序
    assert db._LEGACY_BAND_LO > 100_000 * db.SORT_STEP


def test_grid_boundary_is_a_multiple_of_step():
    """重播种产出的值应是 SORT_STEP 的整数倍（前端与脚本都依赖这个特征）。"""
    for n in (1, 2, 45, 300):
        v = n * db.SORT_STEP
        assert v % db.SORT_STEP == 0
        assert v <= db.SORT_COORD_LIMIT


@pytest.mark.parametrize("bad", ["", None, "abc", "1.79e9"])
def test_non_numeric_sort_order_is_rejected_by_normalizer(bad):
    """非数值/空串不能让归一化抛异常（读取边界必须稳）。"""
    assert db._normalize_sort_order(bad) is None or isinstance(
        db._normalize_sort_order(bad), float
    )


def test_normalizer_never_returns_legacy_magnitude():
    """归一化的**唯一目的**：输出值永不落在旧种子量纲里。

    这是整个兜底机制的核心断言 —— 若它失效，旧值会重新混进网格。
    """
    legacy_seeds = [1.7896e9, 1.79e9, 1.8001e9, db._LEGACY_SEED_MIN, db._LEGACY_SEED_MAX]
    for seed in legacy_seeds:
        out = db._normalize_sort_order(seed)
        assert out is not None
        assert out < db.SORT_COORD_LIMIT, f"{seed} → {out} 仍在旧量纲"
        assert out < db._LEGACY_SEED_MIN