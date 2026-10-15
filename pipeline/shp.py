"""
Minimal pure-Python reader for polygon shapefiles (.shp + .dbf).

Only what this project needs: polygon geometry from the .shp and attribute
records from the .dbf, zipped by record order. No pyshp / GDAL dependency.
Shapefile spec: ESRI Shapefile Technical Description (1998).
"""

import struct
from .geo import ring_area, point_in_ring


# ─────────────────────────────── .dbf ──────────────────────────────────────
def read_dbf(path):
    with open(path, "rb") as f:
        data = f.read()
    n_records = struct.unpack_from("<I", data, 4)[0]
    header_size = struct.unpack_from("<H", data, 8)[0]
    record_size = struct.unpack_from("<H", data, 10)[0]

    fields = []          # (name, type, length)
    pos = 32
    while data[pos] != 0x0D:                      # 0x0D terminates field list
        name = data[pos:pos + 11].split(b"\x00")[0].decode("latin-1")
        ftype = chr(data[pos + 11])
        flen = data[pos + 16]
        fields.append((name, ftype, flen))
        pos += 32

    records = []
    base = header_size
    for r in range(n_records):
        off = base + r * record_size + 1          # +1 skips deletion flag
        row = {}
        for name, ftype, flen in fields:
            raw = data[off:off + flen].decode("latin-1").strip()
            if ftype in "NF":
                try:
                    raw = float(raw) if ("." in raw) else int(raw)
                except ValueError:
                    raw = None
            row[name] = raw
            off += flen
        records.append(row)
    return records


# ─────────────────────────────── .shp ──────────────────────────────────────
def read_shp(path):
    """Yield one entry per record: a list of polygons, each [outer, *holes]."""
    with open(path, "rb") as f:
        data = f.read()
    pos = 100                                     # skip main header
    out = []
    n = len(data)
    while pos < n:
        # record header (big-endian): number, content length (16-bit words)
        content_len = struct.unpack_from(">I", data, pos + 4)[0]
        rec_start = pos + 8
        shape_type = struct.unpack_from("<i", data, rec_start)[0]
        if shape_type == 5:                       # Polygon
            out.append(_read_polygon(data, rec_start))
        else:                                     # null / unsupported → empty
            out.append([])
        pos = rec_start + content_len * 2
    return out


def _read_polygon(data, start):
    p = start + 4 + 32                            # skip shape type + bbox
    n_parts, n_points = struct.unpack_from("<ii", data, p)
    p += 8
    parts = list(struct.unpack_from("<%di" % n_parts, data, p))
    p += 4 * n_parts
    coords = struct.unpack_from("<%dd" % (2 * n_points), data, p)

    rings = []
    parts.append(n_points)
    for i in range(n_parts):
        pts = [[coords[2 * j], coords[2 * j + 1]]
               for j in range(parts[i], parts[i + 1])]
        rings.append(pts)

    # Shapefile convention: clockwise ring = outer (area < 0), CCW = hole.
    outers = [r for r in rings if ring_area(r) < 0]
    holes = [r for r in rings if ring_area(r) >= 0]
    if not outers:                               # degenerate: treat all as outers
        outers, holes = rings, []
    polys = [[o] for o in outers]
    for hole in holes:                           # attach each hole to a container
        hx, hy = hole[0]
        for poly in polys:
            if point_in_ring(hx, hy, poly[0]):
                poly.append(hole)
                break
    return polys
