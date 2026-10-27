#!/usr/bin/env python3
"""生成 PWA 图标（纯标准库，不依赖 Pillow）。

图标沿用站点 favicon 的视觉：深底 + 绿色 `>_`。

    python tools/make-icons.py          # 写入 assets/icons/
    python tools/make-icons.py --check  # 只校验现有图标尺寸与存在性

为什么要脚本而不是塞几张图：
- 图标尺寸必须精确（180 / 192 / 512），手改容易糊；
- 换主题色时只改这里一处，重新生成即可。
"""

from __future__ import annotations

import argparse
import math
import struct
import sys
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "icons"

BG = (0x16, 0x18, 0x1D)
FG = (0x7E, 0xE0, 0xB0)

# 512 画布上的几何：折角 `>` 与下划线 `_`
CHEV = [(138.0, 158.0), (268.0, 256.0), (138.0, 354.0)]
CHEV_W = 46.0
UNDER = (296.0, 318.0, 408.0, 356.0, 10.0)  # x0, y0, x1, y1, r


def _dist_seg(px: float, py: float, ax: float, ay: float, bx: float, by: float) -> float:
    dx, dy = bx - ax, by - ay
    L2 = dx * dx + dy * dy
    if L2 <= 1e-9:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L2))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def _dist_round_rect(px: float, py: float, x0: float, y0: float, x1: float, y1: float, r: float) -> float:
    """到圆角矩形边界的距离，内部为负。"""
    cx, cy = (x0 + x1) / 2.0, (y0 + y1) / 2.0
    hx, hy = (x1 - x0) / 2.0 - r, (y1 - y0) / 2.0 - r
    qx, qy = abs(px - cx) - hx, abs(py - cy) - hy
    outside = math.hypot(max(qx, 0.0), max(qy, 0.0))
    inside = min(max(qx, qy), 0.0)
    return outside + inside - r


def render(size: int, scale: float = 1.0, ss: int = 3) -> bytes:
    """返回 RGBA 原始像素。scale < 1 用于 maskable 的安全区。"""
    n = size * ss
    k = 512.0 / n / scale
    cx = cy = n / 2.0
    rows = []
    for y in range(n):
        row = bytearray()
        for x in range(n):
            # 反算到 512 设计坐标（围绕中心缩放）
            px = (x + 0.5 - cx) * k + 256.0
            py = (y + 0.5 - cy) * k + 256.0

            d = min(
                _dist_seg(px, py, *CHEV[0], *CHEV[1]),
                _dist_seg(px, py, *CHEV[1], *CHEV[2]),
            ) - CHEV_W / 2.0
            d2 = _dist_round_rect(px, py, *UNDER) - 0.0
            d = min(d, d2)

            # 1.6px 软边，避免锯齿
            cov = max(0.0, min(1.0, 0.5 - d / 1.6))
            row += bytes(
                (
                    int(BG[0] + (FG[0] - BG[0]) * cov),
                    int(BG[1] + (FG[1] - BG[1]) * cov),
                    int(BG[2] + (FG[2] - BG[2]) * cov),
                    255,
                )
            )
        rows.append(bytes(row))

    # 下采样
    out = bytearray()
    for y in range(size):
        out.append(0)  # filter type 0
        for x in range(size):
            acc = [0, 0, 0, 0]
            for dy in range(ss):
                line = rows[y * ss + dy]
                for dx in range(ss):
                    o = (x * ss + dx) * 4
                    acc[0] += line[o]
                    acc[1] += line[o + 1]
                    acc[2] += line[o + 2]
                    acc[3] += line[o + 3]
            m = ss * ss
            out += bytes((acc[0] // m, acc[1] // m, acc[2] // m, acc[3] // m))
    return bytes(out)


def write_png(path: Path, size: int, raw: bytes) -> None:
    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)


TARGETS = [
    ("apple-touch-icon-180.png", 180, 1.0),
    ("icon-192.png", 192, 1.0),
    ("icon-512.png", 512, 1.0),
    ("icon-maskable-512.png", 512, 0.78),
]


def png_size(path: Path) -> tuple[int, int] | None:
    try:
        data = path.read_bytes()
    except OSError:
        return None
    if not data.startswith(b"\x89PNG\r\n\x1a\n") or len(data) < 24:
        return None
    return struct.unpack(">II", data[16:24])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只校验，不写文件")
    args = ap.parse_args()

    bad = 0
    for name, size, scale in TARGETS:
        path = OUT / name
        if args.check:
            got = png_size(path)
            ok = got == (size, size)
            print(f"{'ok   ' if ok else 'FAIL '}{name}  {got}")
            bad += 0 if ok else 1
            continue
        write_png(path, size, render(size, scale))
        print(f"写入 {path.relative_to(ROOT)}  {size}x{size}")

    if args.check and bad:
        print(f"\n{bad} 个图标不合格，运行 python tools/make-icons.py 重新生成")
        return 1
    if args.check:
        print("\n图标全部合格")
    return 0


if __name__ == "__main__":
    sys.exit(main())
