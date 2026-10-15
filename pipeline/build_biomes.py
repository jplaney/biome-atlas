"""
Turn the RESOLVE/WWF Ecoregions 2017 shapefile into a web-friendly
biomes.geojson: 847 detailed ecoregions grouped into 14 biomes, each ring
simplified (Douglas–Peucker) and tiny islands dropped, tagged with the
official WWF biome color.

Usage:
    python3 -m pipeline.build_biomes [path_to_Ecoregions2017_without_extension]

Defaults to data/raw/Ecoregions2017. Writes data/processed/biomes.geojson.
"""

import json
import os
import sys

from .shp import read_dbf, read_shp
from .geo import simplify, ring_area, bbox

EPS = 0.06          # simplification tolerance in degrees (~6 km)
MIN_AREA = 0.004    # drop rings smaller than this (deg²) — removes tiny islets
DP = 3              # coordinate decimals (~110 m) — ample for a ~6 km tolerance,
                    # and cuts the file ~2.4x vs full float precision
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _round_ring(ring):
    """Round to DP decimals, dropping consecutive duplicates that rounding creates."""
    out = []
    for x, y in ring:
        p = [round(x, DP), round(y, DP)]
        if not out or out[-1] != p:
            out.append(p)
    return out


def _simplify_ring(ring):
    r = _round_ring(simplify(ring, EPS))
    if r[0] != r[-1]:
        r.append(r[0])                       # keep GeoJSON rings closed
    return r


def build(stem):
    recs = read_dbf(stem + ".dbf")
    geoms = read_shp(stem + ".shp")
    assert len(recs) == len(geoms), "dbf/shp record mismatch"

    biomes = {}          # name -> {"color":..., "polys":[...]}
    for rec, polys in zip(recs, geoms):
        name = rec.get("BIOME_NAME")
        if not name or name == "N/A" or not polys:
            continue
        b = biomes.setdefault(name, {"color": rec.get("COLOR_BIO") or "#888888",
                                     "polys": [], "ecoregions": 0})
        b["ecoregions"] += 1
        for poly in polys:                   # poly = [outer, *holes]
            if abs(ring_area(poly[0])) < MIN_AREA:
                continue
            simp = [_simplify_ring(poly[0])]
            if len(simp[0]) < 4:             # collapsed to a sliver — nothing to draw
                continue
            for hole in poly[1:]:
                if abs(ring_area(hole)) >= MIN_AREA:
                    h = _simplify_ring(hole)
                    if len(h) >= 4:
                        simp.append(h)
            b["polys"].append(simp)

    features = []
    for name, b in sorted(biomes.items()):
        features.append({
            "type": "Feature",
            "properties": {"biome": name, "color": b["color"],
                           "ecoregions": b["ecoregions"], "polygons": len(b["polys"])},
            "geometry": {"type": "MultiPolygon", "coordinates": b["polys"]},
        })

    fc = {"type": "FeatureCollection", "features": features}
    out = os.path.join(HERE, "data", "processed", "biomes.geojson")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w") as f:
        json.dump(fc, f, separators=(",", ":"))

    verts = sum(len(r) for feat in features
                for poly in feat["geometry"]["coordinates"] for r in poly)
    print(f"{len(features)} biomes, {verts} vertices, "
          f"{os.path.getsize(out)/1e6:.1f} MB -> {out}")
    return out


if __name__ == "__main__":
    stem = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "data", "raw", "Ecoregions2017")
    build(stem)
