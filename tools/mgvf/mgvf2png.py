#!/usr/bin/env python3
"""Read an mgu-render frame file (MGVF) and save its newest frame as a PNG.

    python3 tools/mgvf/mgvf2png.py <frame file> [out.png]

Without an output name it only prints the header. This is the PC-side stand-in
for the renderer: it reads the file the way mgu-render does (seq and slot
first, then that slot), so a picture that comes out right here was written in
the format the car's renderer expects. Standard library only.
"""
import struct
import sys
import zlib

MAGIC = 0x4656474D
HEAD = struct.Struct("<16I")  # 64 bytes


def read_head(data):
    if len(data) < HEAD.size:
        raise SystemExit("file is shorter than the 64-byte header")
    f = HEAD.unpack_from(data)
    head = dict(magic=f[0], version=f[1], w=f[2], h=f[3], seq=f[4], slot=f[5],
                nslot=f[6], matrix=f[7], full=f[8], format=f[9])
    if head["magic"] != MAGIC:
        raise SystemExit("not a frame file: magic is 0x%08x" % head["magic"])
    return head


def check(head, size):
    w, h, n = head["w"], head["h"], head["nslot"]
    problems = []
    if head["version"] != 1:
        problems.append("version %d, the renderer knows 1" % head["version"])
    if w % 2 or h % 2 or not 16 <= w <= 2048 or not 16 <= h <= 2048:
        problems.append("size %dx%d is not even and within 16..2048" % (w, h))
    if not 1 <= n <= 4:
        problems.append("%d slots, the renderer takes 1..4" % n)
    if head["slot"] >= max(n, 1):
        problems.append("slot %d is outside %d slots" % (head["slot"], n))
    if head["format"] not in (0, 1):
        problems.append("format %d is neither I420 nor NV12" % head["format"])
    need = HEAD.size + n * (w * h * 3 // 2)
    if size < need:
        problems.append("file has %d bytes, header promises %d" % (size, need))
    if need > 12 << 20:
        problems.append("%d bytes is over the renderer's 12 MiB per app" % need)
    return problems


def to_rgb(head, data):
    w, h = head["w"], head["h"]
    frame = w * h * 3 // 2
    base = HEAD.size + head["slot"] * frame
    ys = data[base:base + w * h]
    cw, ch = w // 2, h // 2
    if head["format"] == 0:  # I420
        us = data[base + w * h:base + w * h + cw * ch]
        vs = data[base + w * h + cw * ch:base + frame]
    else:  # NV12
        uv = data[base + w * h:base + frame]
        us, vs = uv[0::2], uv[1::2]

    kr, kb = (0.299, 0.114) if head["matrix"] == 0 else (0.2126, 0.0722)
    kg = 1.0 - kr - kb
    if head["full"]:
        ymul, yoff, cmul = 1.0, 0, 1.0
    else:
        ymul, yoff, cmul = 255.0 / 219.0, 16, 255.0 / 224.0
    yt = [ymul * (i - yoff) for i in range(256)]
    rv = [cmul * 2 * (1 - kr) * (i - 128) for i in range(256)]
    bu = [cmul * 2 * (1 - kb) * (i - 128) for i in range(256)]
    gu = [-cmul * 2 * (1 - kb) * kb / kg * (i - 128) for i in range(256)]
    gv = [-cmul * 2 * (1 - kr) * kr / kg * (i - 128) for i in range(256)]

    def clamp(x):
        return 0 if x < 0 else 255 if x > 255 else int(x + 0.5)

    rows = []
    for y in range(h):
        row = bytearray(w * 3)
        crow = (y // 2) * cw
        yrow = y * w
        for x in range(w):
            lum = yt[ys[yrow + x]]
            u = us[crow + x // 2]
            v = vs[crow + x // 2]
            row[x * 3] = clamp(lum + rv[v])
            row[x * 3 + 1] = clamp(lum + gu[u] + gv[v])
            row[x * 3 + 2] = clamp(lum + bu[u])
        rows.append(bytes(row))
    return rows


def write_png(path, w, h, rows):
    def chunk(tag, body):
        return (struct.pack(">I", len(body)) + tag + body +
                struct.pack(">I", zlib.crc32(tag + body) & 0xFFFFFFFF))

    raw = b"".join(b"\x00" + r for r in rows)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)))
        f.write(chunk(b"IDAT", zlib.compress(raw, 6)))
        f.write(chunk(b"IEND", b""))


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    with open(sys.argv[1], "rb") as f:
        data = f.read()
    head = read_head(data)
    print("%dx%d %s, %s %s range, seq %d, slot %d of %d" % (
        head["w"], head["h"], ("I420", "NV12")[head["format"] & 1],
        ("BT.601", "BT.709")[head["matrix"] & 1],
        "full" if head["full"] else "limited",
        head["seq"], head["slot"], head["nslot"]))
    problems = check(head, len(data))
    for p in problems:
        print("PROBLEM: " + p)
    if problems:
        raise SystemExit(1)
    if len(sys.argv) > 2:
        write_png(sys.argv[2], head["w"], head["h"], to_rgb(head, data))
        print("wrote " + sys.argv[2])


if __name__ == "__main__":
    main()
