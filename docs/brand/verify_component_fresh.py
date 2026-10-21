#!/usr/bin/env python3
"""验证 `web/src/components/LogoMark.tsx` **与 `sunny_geom.py` 一致**（防几何漂移）。

## 为什么需要这道断言

`LogoMark.tsx` 由 `gen_component.py` 生成，但它一旦落盘就成了一份**静态副本**。
如果改了 `sunny_geom.py` 却忘了重跑生成器，TSX 里还是旧几何 ——
而 **tsc 不会报错**（数字仍然是合法 JSX 属性），只有肉眼看图才发现"怎么没变"。

判据：重新生成一份到内存，与磁盘上的文件**逐字节比对**。
不一致即失败，并提示跑生成器。
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import gen_component  # noqa: E402

TARGET = os.path.join(os.path.dirname(os.path.dirname(HERE)),
                      "web", "src", "components", "LogoMark.tsx")


def main():
    if not os.path.exists(TARGET):
        print(f"❌ 未找到 {TARGET}\n   请先跑：python3 gen_component.py")
        return 1
    disk = open(TARGET).read()
    fresh = gen_component.build()
    if disk == fresh:
        print("✅ LogoMark.tsx 与 sunny_geom.py 一致（无几何漂移）")
        print(f"   {len(disk)} bytes")
        return 0
    print("❌ LogoMark.tsx 与 sunny_geom.py **不一致** —— 几何改了但没重新生成")
    print("   修复：cd docs/brand && python3 gen_component.py")
    # 指出首个差异位置
    n = min(len(disk), len(fresh))
    for i in range(n):
        if disk[i] != fresh[i]:
            print(f"   首个差异在偏移 {i}：")
            print(f"     磁盘: ...{disk[max(0,i-40):i+40]!r}")
            print(f"     新算: ...{fresh[max(0,i-40):i+40]!r}")
            break
    else:
        print(f"   长度不同：磁盘 {len(disk)} vs 新算 {len(fresh)}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
