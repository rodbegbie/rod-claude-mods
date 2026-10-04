import re
import struct
import subprocess
import sys
import zlib
from pathlib import Path

import pytest

REGISTER = Path(__file__).resolve().parent.parent / "hooks" / "register.tsx"
SIGNATURE = b"\x89PNG\r\n\x1a\n"


def script_source() -> str:
    match = re.search(
        r"LOGO_COLOUR_SCRIPT\s*=\s*String\.raw`(.*?)`", REGISTER.read_text(), re.S
    )
    assert match, "LOGO_COLOUR_SCRIPT not found in register.tsx"
    return match.group(1)


@pytest.fixture(scope="module")
def helper() -> dict:
    namespace = {"__name__": "logo_colour"}
    exec(compile(script_source(), "logo_colour_script", "exec"), namespace)
    return namespace


def chunk(kind: bytes, data: bytes) -> bytes:
    crc = zlib.crc32(kind + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", crc)


def paeth(a: int, b: int, c: int) -> int:
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    return b if pb <= pc else c


def make_png(width, height, pixel, colour_type=6, interlace=0, filter_type=0) -> bytes:
    channels = {2: 3, 6: 4, 3: 1}[colour_type]
    rows = [
        bytes(v for x in range(width) for v in pixel(x, y)[:channels])
        for y in range(height)
    ]
    out = bytearray()
    zero = bytes(width * channels)
    for y, row in enumerate(rows):
        prev = rows[y - 1] if y else zero
        out.append(filter_type)
        for i, cur in enumerate(row):
            left = row[i - channels] if i >= channels else 0
            up = prev[i]
            upleft = prev[i - channels] if i >= channels else 0
            predicted = {
                0: 0,
                1: left,
                2: up,
                3: (left + up) // 2,
                4: paeth(left, up, upleft),
            }[filter_type]
            out.append((cur - predicted) & 255)
    header = struct.pack(">IIBBBBB", width, height, 8, colour_type, 0, 0, interlace)
    parts = [SIGNATURE, chunk(b"IHDR", header)]
    if colour_type == 3:
        parts.append(chunk(b"PLTE", bytes(768)))
    parts += [chunk(b"IDAT", zlib.compress(bytes(out))), chunk(b"IEND", b"")]
    return b"".join(parts)


def purple_logo(x, y):
    if x < 2 and y < 2:
        return (0, 0, 0, 0)
    if x < 4 or y < 4 or x >= 36 or y >= 36:
        return (255, 255, 255, 255)
    return (110, 40, 160, 255)


def wobbly_purple(x, y):
    return (100 + x % 8, 40 + y % 8, 150 + (x + y) % 8, 255)


def near(hex_colour: str, target: tuple, tolerance: int = 24) -> bool:
    got = tuple(int(hex_colour[i : i + 2], 16) for i in (1, 3, 5))
    return all(abs(g - t) <= tolerance for g, t in zip(got, target))


def test_purple_rgba_logo_returns_purple(helper):
    png = make_png(40, 40, purple_logo)

    assert near(helper["dominant_colour"](png), (110, 40, 160))


def test_ignores_white_black_and_transparent(helper):
    def mostly_white(x, y):
        if 10 <= x < 16 and 10 <= y < 16:
            return (230, 180, 20, 255)
        return (255, 255, 255, 255) if (x + y) % 3 else (0, 0, 0, 255)

    assert near(helper["dominant_colour"](make_png(40, 40, mostly_white)), (230, 180, 20))


@pytest.mark.parametrize("filter_type", [1, 2, 3, 4])
def test_decodes_every_png_filter(helper, filter_type):
    plain = helper["dominant_colour"](make_png(32, 32, wobbly_purple, filter_type=0))

    filtered = helper["dominant_colour"](
        make_png(32, 32, wobbly_purple, filter_type=filter_type)
    )

    assert filtered == plain
    assert near(plain, (104, 44, 154))


def test_rgb_colour_type_2_is_supported(helper):
    png = make_png(40, 40, purple_logo, colour_type=2)

    assert near(helper["dominant_colour"](png), (110, 40, 160))


def test_interlaced_png_is_rejected(helper):
    with pytest.raises(ValueError):
        helper["dominant_colour"](make_png(8, 8, purple_logo, interlace=1))


def test_palette_png_is_rejected(helper):
    with pytest.raises(ValueError):
        helper["dominant_colour"](make_png(8, 8, lambda x, y: (1,), colour_type=3))


def test_all_grey_image_is_rejected(helper):
    with pytest.raises(ValueError):
        helper["dominant_colour"](make_png(16, 16, lambda x, y: (128, 128, 128, 255)))


def test_non_png_bytes_are_rejected(helper):
    with pytest.raises(ValueError):
        helper["dominant_colour"](b"<html>not a png</html>")


@pytest.mark.parametrize(
    "url", ["file:///etc/passwd", "http://img.thesports.com/a.png", ""]
)
def test_check_url_rejects_anything_but_https(helper, url):
    with pytest.raises(ValueError):
        helper["check_url"](url)


def test_check_url_accepts_https(helper):
    helper["check_url"]("https://img.thesports.com/a.png")


def test_main_exits_non_zero_without_https():
    result = subprocess.run(
        [sys.executable, "-c", script_source(), "file:///etc/hosts"],
        capture_output=True,
        text=True,
        timeout=20,
    )

    assert result.returncode != 0
    assert result.stdout == ""
