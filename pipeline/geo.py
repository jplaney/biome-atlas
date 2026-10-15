"""
Pure-Python geometry helpers — no shapely/geopandas required.

Everything here works on plain [x, y] == [lon, lat] coordinate lists so the
whole pipeline runs on a stock Python 3 install. A "ring" is a closed list of
points; a "polygon" is [outer_ring, *hole_rings]; a "biome" owns a list of
polygons (it is effectively a MultiPolygon).
"""

import math
import random


# ─────────────────────── simplification (Douglas–Peucker) ──────────────────
def _perp_dist(p, a, b):
    (x, y), (x1, y1), (x2, y2) = p, a, b
    dx, dy = x2 - x1, y2 - y1
    if dx == 0 and dy == 0:
        return math.hypot(x - x1, y - y1)
    t = ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    return math.hypot(x - (x1 + t * dx), y - (y1 + t * dy))


def simplify(points, eps):
    """Douglas–Peucker. eps is in degrees (~0.05 ≈ 5 km near the equator)."""
    if len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        s, e = stack.pop()
        dmax, idx = 0.0, -1
        for i in range(s + 1, e):
            d = _perp_dist(points[i], points[s], points[e])
            if d > dmax:
                dmax, idx = d, i
        if dmax > eps and idx != -1:
            keep[idx] = True
            stack.append((s, idx))
            stack.append((idx, e))
    return [p for p, k in zip(points, keep) if k]


# ─────────────────────── point-in-polygon (ray casting) ────────────────────
def point_in_ring(x, y, ring):
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi) + xi):
            inside = not inside
        j = i
    return inside


def point_in_polygon(x, y, poly):
    """poly = [outer, *holes]. Inside the outer ring and outside every hole."""
    if not point_in_ring(x, y, poly[0]):
        return False
    return not any(point_in_ring(x, y, hole) for hole in poly[1:])


# ─────────────────────── areas, boxes, sampling ────────────────────────────
def ring_area(ring):
    """Signed shoelace area in deg². Positive = counter-clockwise."""
    s = 0.0
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % n]
        s += x1 * y2 - x2 * y1
    return s / 2.0


def bbox(rings):
    xs = [p[0] for r in rings for p in r]
    ys = [p[1] for r in rings for p in r]
    return min(xs), min(ys), max(xs), max(ys)


def _candidate_points(polygons, count, rng):
    """Area-weighted candidate points (bigger ecoregions get proportionally more),
    placed by rejection sampling inside each chosen polygon."""
    weights = [abs(ring_area(p[0])) for p in polygons]
    total = sum(weights) or 1.0
    out = []
    tries = 0
    while len(out) < count and tries < count * 200:
        tries += 1
        r = rng.random() * total
        acc = 0.0
        chosen = polygons[0]
        for poly, w in zip(polygons, weights):
            acc += w
            if r <= acc:
                chosen = poly
                break
        x0, y0, x1, y1 = bbox([chosen[0]])
        px, py = rng.uniform(x0, x1), rng.uniform(y0, y1)
        if point_in_polygon(px, py, chosen):
            out.append((px, py))
    return out


def sample_points(polygons, n, seed=0):
    """Return up to n [lon, lat] points well-spread across a biome's polygons.

    Farthest-point sampling over an area-weighted candidate pool: greedily pick
    the candidate maximizing distance to the nearest already-chosen point. This
    covers the biome's full geographic extent (every continent/disjoint region it
    touches) instead of clustering wherever random draws happened to land — while
    costing the same downstream (only the selected points get fetched).
    """
    rng = random.Random(seed)
    pool = _candidate_points(polygons, max(n, n * 12), rng)
    if len(pool) <= n:
        return [[round(x, 3), round(y, 3)] for x, y in pool]
    chosen = [pool.pop(0)]
    while len(chosen) < n and pool:
        best, best_d = 0, -1.0
        for i, c in enumerate(pool):
            # squared lon/lat distance to the nearest chosen point (good enough
            # for spreading; not geodesic, and ignores antimeridian wrap)
            d = min((c[0] - s[0]) ** 2 + (c[1] - s[1]) ** 2 for s in chosen)
            if d > best_d:
                best_d, best = d, i
        chosen.append(pool.pop(best))
    return [[round(x, 3), round(y, 3)] for x, y in chosen]
