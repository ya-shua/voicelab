"""生成 VoiceLab 图标（纯标准库，无 Pillow）：紫色圆角方块 + 白色话筒造型。

输出：
  ../icons/icon{16,48,128}.png             浏览器扩展用
  ../../frontend/icons/icon{192,512}.png   PWA 用
"""
import pathlib
import struct
import zlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUTS = [
    (ROOT / "icons", [16, 48, 128]),
    (ROOT.parent / "frontend" / "icons", [192, 512]),
]


def write_png(path: pathlib.Path, size: int, rows):
    raw = b"".join(b"\x00" + bytes(v for px in row for v in px) for row in rows)

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(raw))
           + chunk(b"IEND", b""))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)


def draw(full: int):
    """在 full×full 画布上画图标，返回像素行（RGBA 四元组）。"""
    rows = [[(0, 0, 0, 0)] * full for _ in range(full)]
    r = full * 0.22  # 圆角半径
    cap_c, cap_r = full * 0.5, full * 0.17   # 话筒头
    stem_w = full * 0.055                     # 话筒杆半宽
    for y in range(full):
        t = y / full
        base = (int(108 + (162 - 108) * t), int(92 + (155 - 92) * t), int(231 + (254 - 231) * t))
        for x in range(full):
            cx = min(max(x, r), full - 1 - r)
            cy = min(max(y, r), full - 1 - r)
            if (x - cx) ** 2 + (y - cy) ** 2 > r * r + 0.5:
                continue  # 圆角方块外透明
            c = base + (255,)
            if (x - cap_c) ** 2 + (y - full * 0.36) ** 2 <= cap_r ** 2:
                c = (255, 255, 255, 255)          # 话筒头
            elif abs(x - cap_c) <= stem_w and full * 0.40 <= y <= full * 0.62:
                c = (255, 255, 255, 255)          # 话筒杆
            elif abs(x - cap_c) <= full * 0.16 and abs(y - full * 0.70) <= full * 0.022:
                c = (255, 255, 255, 255)          # 底部横杠
            rows[y][x] = c
    return rows


def scale(rows, full: int, target: int):
    step = full / target
    return [[rows[int(y * step)][int(x * step)] for x in range(target)] for y in range(target)]


def main():
    full = 512
    rows = draw(full)
    for out_dir, sizes in OUTS:
        for s in sizes:
            write_png(out_dir / f"icon{s}.png", s, rows if s == full else scale(rows, full, s))
            print("written:", out_dir / f"icon{s}.png")


if __name__ == "__main__":
    main()
