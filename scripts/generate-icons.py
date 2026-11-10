"""Generate GuitarMate's pick-and-guitar mark with Python's standard library.

The cream plectrum carries a guitar neck, sound hole and lime bridge. The entire
mark fits inside the central 80% safe circle used by maskable app icons.
SVG and supersampled PNG assets share exactly the same geometry and palette.
"""
from pathlib import Path
import math
import struct
import zlib

BACKGROUND = (36, 91, 71)
PAPER = (246, 244, 236)
LIME = (223, 234, 156)
PICK = "M .5 .20 C .28 .20 .22 .28 .245 .43 C .275 .62 .4 .77 .5 .81 C .60 .77 .725 .62 .755 .43 C .78 .28 .72 .20 .5 .20 Z"
CURVES = [
    ((.5, .20), (.28, .20), (.22, .28), (.245, .43)),
    ((.245, .43), (.275, .62), (.4, .77), (.5, .81)),
    ((.5, .81), (.60, .77), (.725, .62), (.755, .43)),
    ((.755, .43), (.78, .28), (.72, .20), (.5, .20)),
]


def svg():
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1">
<title>기타메이트</title>
<path fill="#245b47" d="M0 0h1v1H0z"/>
<path fill="#f6f4ec" d="{PICK}"/>
<path d="M.5 .30V.49" stroke="#245b47" stroke-width=".055" stroke-linecap="round"/>
<circle cx=".5" cy=".49" r=".082" fill="#245b47"/>
<path d="M.43 .65H.57" stroke="#245b47" stroke-width=".065" stroke-linecap="round"/>
<path d="M.45 .65H.55" stroke="#dfea9c" stroke-width=".022" stroke-linecap="round"/>
</svg>
'''


def icon(size):
    scale = 4
    edge = size * scale
    pixels = bytearray(BACKGROUND * (edge * edge))

    def paint(x, y, color):
        pos = (y * edge + x) * 3
        pixels[pos:pos + 3] = bytes(color)

    # Sample the same cubic curves as the SVG, then scan-convert the pick.
    points = []
    for curve in CURVES:
        for step in range(65):
            t = step / 64
            points.append(tuple(edge * sum(
                weight * point[axis] for weight, point in zip(
                    ((1-t)**3, 3*(1-t)**2*t, 3*(1-t)*t*t, t**3), curve))
                for axis in (0, 1)))
    for y in range(edge):
        scan = y + .5
        intersections = []
        for (x1, y1), (x2, y2) in zip(points, points[1:] + points[:1]):
            if (y1 <= scan < y2) or (y2 <= scan < y1):
                intersections.append(x1 + (scan-y1) * (x2-x1) / (y2-y1))
        intersections.sort()
        for left, right in zip(intersections[::2], intersections[1::2]):
            for x in range(max(0, math.ceil(left-.5)), min(edge, math.ceil(right-.5))):
                paint(x, y, PAPER)

    def line(x1, y1, x2, y2, width, color):
        x1, y1, x2, y2, width = [v * edge for v in (x1, y1, x2, y2, width)]
        dx, dy = x2-x1, y2-y1
        for y in range(max(0, int(min(y1, y2)-width)), min(edge, math.ceil(max(y1, y2)+width))):
            for x in range(max(0, int(min(x1, x2)-width)), min(edge, math.ceil(max(x1, x2)+width))):
                px, py = x+.5, y+.5
                t = max(0, min(1, ((px-x1)*dx + (py-y1)*dy) / (dx*dx+dy*dy))) if dx or dy else 0
                if (px-x1-t*dx)**2 + (py-y1-t*dy)**2 <= (width/2)**2:
                    paint(x, y, color)

    line(.5, .30, .5, .49, .055, BACKGROUND)
    line(.5, .49, .5, .49, .164, BACKGROUND)
    line(.43, .65, .57, .65, .065, BACKGROUND)
    line(.45, .65, .55, .65, .022, LIME)
    rows = bytearray()
    for y in range(size):
        rows.append(0)
        for x in range(size):
            for c in range(3):
                rows.append(round(sum(pixels[((y*scale+dy)*edge+x*scale+dx)*3+c]
                                      for dy in range(scale) for dx in range(scale)) / scale**2))

    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind+data))

    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(rows, 9)) + chunk(b'IEND', b''))


if __name__ == '__main__':
    root = Path(__file__).resolve().parents[1]
    (root / 'icons').mkdir(exist_ok=True)
    for name, size in [('icons/icon-192.png', 192), ('icons/icon-512.png', 512),
                       ('icons/maskable-512.png', 512), ('icons/apple-touch-icon.png', 180),
                       ('favicon-32.png', 32), ('favicon-16.png', 16)]:
        (root / name).write_bytes(icon(size))
    (root / 'favicon.svg').write_text(svg(), encoding='utf-8')
