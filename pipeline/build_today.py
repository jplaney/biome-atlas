"""
Build today.json — an immediate per-biome snapshot for the left dashboard.

Samples points INSIDE each biome polygon (independently of the long-term panel,
and at a denser default so no major region is left uncovered), fetches each
point's forecast for *today*, and aggregates:
  day_min — coldest sampled spot in the biome today
  day_max — hottest sampled spot in the biome today
  day_avg — mean of the sampled daily means
  plus biome-wide means of feels-like, precip, humidity, wind, UV, sunshine.

Only uses the light 1-day forecast API (cached per date), so re-running refreshes
the snapshot cheaply — safe to run daily. This does NOT touch the archive/quota.

Usage:
    python3 -m pipeline.build_today [samples_per_biome]      # default 10
"""

import datetime as dt
import json
import os
import statistics
import sys
import zlib

from .geo import sample_points
from .climate import point_today, QuotaExceeded

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BIOMES = os.path.join(HERE, "data", "processed", "biomes.geojson")
OUT = os.path.join(HERE, "data", "processed", "today.json")
SAMPLES = 16                                        # denser than the long-term panel (5)


def _avg(xs, ndigits):
    return round(statistics.mean(xs), ndigits) if xs else None


def build(samples_per_biome=SAMPLES):
    with open(BIOMES) as f:
        fc = json.load(f)
    today = dt.date.today().isoformat()

    out = {}
    quota_hit = False
    for feat in fc["features"]:
        name = feat["properties"]["biome"]
        color = feat["properties"]["color"]
        polys = feat["geometry"]["coordinates"]     # [ [outer,*holes], ... ]
        # own seed → independent of stats.json's points; stable across re-runs.
        pts = sample_points(polys, samples_per_biome, seed=zlib.crc32(("today:" + name).encode()))

        recs, samples = [], []
        for lon, lat in pts:
            try:
                t = point_today(lat, lon)
            except QuotaExceeded:
                quota_hit = True
                continue
            if t is not None:
                recs.append(t)
                if t.get("tmean") is not None:      # keep coords for the map overlay
                    samples.append({"lat": lat, "lon": lon, "t": round(t["tmean"], 1)})

        def vals(key):                              # non-null values of one metric
            return [r[key] for r in recs if r.get(key) is not None]

        if recs:
            out[name] = {
                "color": color,
                "day_min": round(min(vals("tmin")), 1),
                "day_max": round(max(vals("tmax")), 1),
                "day_avg": round(statistics.mean(vals("tmean")), 1),
                "feels": _avg(vals("feels"), 1),        # °C (apparent max, averaged)
                "precip": _avg(vals("precip"), 1),      # mm today
                "humidity": _avg(vals("humidity"), 0),  # %
                "wind": _avg(vals("wind"), 0),          # km/h (daily max, averaged)
                "uv": _avg(vals("uv"), 1),              # UV index (daily peak, averaged)
                "sunshine": _avg(vals("sunshine"), 1),  # hours of sunshine today
                "samples": samples, "n": len(recs), "date": today}
        else:
            out[name] = {"color": color, "day_min": None, "day_max": None,
                         "day_avg": None, "feels": None, "precip": None,
                         "humidity": None, "wind": None, "uv": None,
                         "sunshine": None, "samples": [], "n": 0, "date": today}
        o = out[name]
        print(f"  {name:52} {o['day_avg']}°  feels {o['feels']}°  "
              f"precip {o['precip']}mm  hum {o['humidity']}%  wind {o['wind']}  "
              f"uv {o['uv']}  sun {o['sunshine']}h  (n={o['n']})")

    with open(OUT, "w") as f:
        json.dump(out, f, indent=1)
    filled = sum(1 for v in out.values() if v["n"])
    print(f"wrote {OUT} — {filled}/{len(out)} biomes, {samples_per_biome} samples each")
    if quota_hit or filled < len(out):
        print("! Hourly quota hit. Re-run `python3 -m pipeline.build_today` to resume "
              "(today's fetched points are cached).")


if __name__ == "__main__":
    spb = int(sys.argv[1]) if len(sys.argv) > 1 else SAMPLES
    build(spb)
