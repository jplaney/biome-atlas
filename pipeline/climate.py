"""
Climate sampling via the Open-Meteo Archive API (ERA5, free, no key).

For a point we pull one daily-mean series and derive two numbers:
  normal — the 2011–2020 decadal mean (the climatological "definition" here)
  recent — the mean of the most recent 365 days (how it's actually been lately)
The anomaly is recent − normal. Raw responses are cached to disk keyed by
rounded coordinates, so re-runs and nearby points are cheap.

Note on NORMAL_START: Open-Meteo's free tier bills by data volume, so a 30-year
window blows the hourly quota fast. A 2011–2020 decade keeps requests light while
staying a valid recent-climate baseline. Widen it if you have API budget.
"""

import datetime as dt
import json
import os
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE_DIR = os.path.join(HERE, "data", "cache")            # archive (never stale)
TODAY_DIR = os.path.join(HERE, "data", "cache_today")      # forecast (per day)
NORMAL_START, NORMAL_END = "2011-01-01", "2020-12-31"


class QuotaExceeded(Exception):
    """Raised when Open-Meteo's hourly quota is hit — retrying won't help soon."""


def _get_json(url):
    """GET + parse JSON with Open-Meteo-aware retry.

    Two kinds of 429: a per-minute burst limit (back off ~a minute and retry)
    and a per-hour volume limit (retrying is futile — raise QuotaExceeded so the
    caller can stop and resume later; cached points are preserved either way).
    """
    req = urllib.request.Request(url, headers={"User-Agent": "biome-atlas/1.0"})
    for attempt in range(4):
        try:
            return json.loads(urllib.request.urlopen(req, timeout=90).read())
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "ignore") if e.code == 429 else ""
            if e.code == 429 and "Hourly" in body:
                raise QuotaExceeded(body)
            if e.code == 429 and attempt < 3:
                time.sleep(65)
                continue
            raise
        except Exception:
            if attempt < 3:
                time.sleep(6)
                continue
            raise


def _cache_path(lat, lon):
    return os.path.join(CACHE_DIR, f"{lat:+06.2f}_{lon:+07.2f}.json")


def _fetch_series(lat, lon):
    """Daily-mean series NORMAL_START→recent as {date: temp}, cached to disk."""
    os.makedirs(CACHE_DIR, exist_ok=True)
    cp = _cache_path(lat, lon)
    if os.path.exists(cp):
        with open(cp) as f:
            return json.load(f)
    end = (dt.date.today() - dt.timedelta(days=7)).isoformat()   # archive lag
    url = ("https://archive-api.open-meteo.com/v1/archive"
           f"?latitude={lat:.2f}&longitude={lon:.2f}"
           f"&start_date={NORMAL_START}&end_date={end}"
           "&daily=temperature_2m_mean&timezone=UTC")
    daily = _get_json(url).get("daily", {})
    series = dict(zip(daily.get("time", []), daily.get("temperature_2m_mean", [])))
    with open(cp, "w") as f:
        json.dump(series, f)
    time.sleep(0.4)                                              # be polite
    return series


def point_today(lat, lon):
    """Today's snapshot for a point from the light forecast API, cached per day.

    Returns a dict {tmin, tmax, tmean, precip, wind, uv, humidity} or None. Temp,
    precip, wind, UV are free daily aggregates; humidity has no daily aggregate so
    it's the mean of today's hourly values (same request). Raises QuotaExceeded on
    the hourly cap.
    """
    os.makedirs(TODAY_DIR, exist_ok=True)
    today = dt.date.today().isoformat()
    cp = os.path.join(TODAY_DIR, f"{today}_{lat:+06.2f}_{lon:+07.2f}.json")
    if os.path.exists(cp):
        with open(cp) as f:
            d = json.load(f)
        if isinstance(d, dict):            # ignore any older tuple-format cache
            return d
    url = ("https://api.open-meteo.com/v1/forecast"
           f"?latitude={lat:.2f}&longitude={lon:.2f}"
           "&daily=temperature_2m_min,temperature_2m_max,temperature_2m_mean,"
           "apparent_temperature_max,precipitation_sum,wind_speed_10m_max,"
           "uv_index_max,sunshine_duration"
           "&hourly=relative_humidity_2m&forecast_days=1&timezone=auto")
    try:
        j = _get_json(url)
        dd = j["daily"]
        hum = [h for h in j.get("hourly", {}).get("relative_humidity_2m", [])
               if h is not None]
        sun = dd["sunshine_duration"][0]
        rec = {"tmin": dd["temperature_2m_min"][0],
               "tmax": dd["temperature_2m_max"][0],
               "tmean": dd["temperature_2m_mean"][0],
               "feels": dd["apparent_temperature_max"][0],
               "precip": dd["precipitation_sum"][0],
               "wind": dd["wind_speed_10m_max"][0],
               "uv": dd["uv_index_max"][0],
               "sunshine": (sun / 3600.0) if sun is not None else None,  # sec → h
               "humidity": (sum(hum) / len(hum)) if hum else None}
    except QuotaExceeded:
        raise
    except Exception:
        return None
    if rec["tmean"] is None:
        return None
    with open(cp, "w") as f:
        json.dump(rec, f)
    time.sleep(0.3)
    return rec


def point_climate(lat, lon):
    """Return (normal_c, recent_c) or (None, None) if the API had no data."""
    try:
        series = _fetch_series(lat, lon)
    except QuotaExceeded:
        raise                              # let the caller stop & resume later
    except Exception:
        return None, None
    normal_vals, recent_vals = [], []
    cutoff = (dt.date.today() - dt.timedelta(days=372)).isoformat()
    for date, temp in series.items():
        if temp is None:
            continue
        if NORMAL_START <= date <= NORMAL_END:
            normal_vals.append(temp)
        if date >= cutoff:
            recent_vals.append(temp)
    if not normal_vals or not recent_vals:
        return None, None
    return (sum(normal_vals) / len(normal_vals),
            sum(recent_vals) / len(recent_vals))
