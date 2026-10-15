"""
Sample points inside each biome polygon, fetch their climate, and aggregate to
per-biome statistics. Writes data/processed/stats.json which the server serves
to the map.

Usage:
    python3 -m pipeline.build_stats [samples_per_biome]     # default 6
"""

import json
import os
import statistics
import sys
import zlib

from .geo import sample_points
from .climate import point_climate, QuotaExceeded

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BIOMES = os.path.join(HERE, "data", "processed", "biomes.geojson")
OUT = os.path.join(HERE, "data", "processed", "stats.json")


def build(samples_per_biome=6):
    with open(BIOMES) as f:
        fc = json.load(f)

    out = {}
    quota_hit = False
    for feat in fc["features"]:
        name = feat["properties"]["biome"]
        polys = feat["geometry"]["coordinates"]        # [ [outer,*holes], ... ]
        # Stable seed (zlib.crc32, not hash()) so re-runs regenerate the SAME
        # sample points and actually hit the on-disk climate cache.
        pts = sample_points(polys, samples_per_biome, seed=zlib.crc32(name.encode()))

        samples, normals, recents = [], [], []
        for lon, lat in pts:
            try:
                normal, recent = point_climate(lat, lon)
            except QuotaExceeded:
                quota_hit = True                       # skip uncached; keep cached
                continue
            if normal is None:
                continue
            samples.append({"lat": lat, "lon": lon,
                            "normal": round(normal, 1), "recent": round(recent, 1),
                            "anomaly": round(recent - normal, 1)})
            normals.append(normal)
            recents.append(recent)

        n = len(normals)
        if n:
            nm, rm = statistics.mean(normals), statistics.mean(recents)
            out[name] = {
                "color": feat["properties"]["color"],
                "ecoregions": feat["properties"]["ecoregions"],
                "normal": round(nm, 1),
                "spread": round(statistics.pstdev(normals), 1) if n > 1 else 0.0,
                "recent": round(rm, 1),
                "anomaly": round(rm - nm, 1),
                "n": n,
                "samples": samples,
            }
        else:
            out[name] = {"color": feat["properties"]["color"],
                         "ecoregions": feat["properties"]["ecoregions"],
                         "normal": None, "spread": 0.0, "recent": None,
                         "anomaly": None, "n": 0, "samples": []}
        print(f"  {name:52} normal={out[name]['normal']} "
              f"anomaly={out[name]['anomaly']} (n={n})")

    with open(OUT, "w") as f:
        json.dump(out, f, indent=1)
    print(f"wrote {OUT}")

    filled = sum(1 for v in out.values() if v["n"])
    print(f"{filled}/{len(out)} biomes have climate data")
    if quota_hit or filled < len(out):
        print("! Open-Meteo hourly quota was hit. Cached points are preserved — "
              "just re-run `python3 -m pipeline.build_stats` next hour to resume "
              "(it only fetches the still-missing points).")


if __name__ == "__main__":
    spb = int(sys.argv[1]) if len(sys.argv) > 1 else 6
    build(spb)
