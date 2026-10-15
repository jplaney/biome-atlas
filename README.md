# Biome Atlas

An interactive web map of the world's **14 WWF/RESOLVE biomes**. The layout has
three regions plus a key across the top:

- **Left — "Today":** an immediate dashboard. Each biome's live daily
  **min · avg · max** temperature (range bar) plus a **toggle-able set of
  metrics** — feels-like, precipitation, humidity, wind, UV, sunshine — from the
  current forecast at its sample points, with a global-average headline. Pick
  which metrics to show via the "Show metrics" chips; your choice is remembered
  (localStorage). The visceral, less-scientific view.
- **Center — map:** biomes colored by identity or by anomaly (toggle up top;
  anomaly mode adds a color key).
- **Right — "Long-term trend":** the climatological view — each biome's
  **normal** (2011–2020 mean) vs its **recent 12-month anomaly**, with the
  sample points behind the average, plus a ranked bar chart of all 14 anomalies.

Both side panels **collapse** (‹ / › buttons) to a thin rail, giving the map
the full width. **Hover** any biome (map, key, or anomaly list) to preview it;
**click** to pin it — the rest of the map dims and every panel follows. Esc, the
× button, or a click on open map clears it. If the daily snapshot is more than a
day old, the "Today" date turns amber and shows its age. On narrow screens the
layout stacks (map → trend → today) and the earth-activity box starts folded.

**Earth-activity overlays** (top-right control) layer live *natural* events over
the map — 🔴 earthquakes, 🌋 volcanoes, 🔥 wildfires, 🌀 cyclones, 💧 floods,
🌊 tsunami, 🧊 sea-ice (natural hazards only; no human events). Fault-tolerant
client-side fetches, so one feed being down never breaks the others or the app.
Toggle each on/off; the choice is remembered (localStorage). Some layers are often
empty (floods/tsunami are only shown when significant events are active).

Why these variables and not more: temperature, precipitation, wind, and UV are
free *daily* aggregates in one forecast request; humidity has no daily aggregate,
so it's the mean of today's hourly values (same request — low overhead). The
long-term panel stays temperature-only on purpose: the archive API bills by data
volume, and extra decadal variables would blow the hourly quota.

This is the high-fidelity successor to the braille-TUI `worldmap.py`: instead of
point cities standing in for biomes and live instantaneous weather, it uses
**real biome polygons** and **multi-decade climate statistics**.

## Why it's built this way

- **No heavy dependencies.** Runs on a stock Python 3 — no geopandas/GDAL/shapely,
  no Flask. Geometry (shapefile parsing, simplification, point-in-polygon,
  sampling) is pure Python in `pipeline/`; the server is stdlib `http.server`;
  the map is Leaflet from a CDN.
- **Precompute, then serve.** The slow geospatial + climate work happens once in
  the pipeline and is cached to `data/processed/`. The server just hands those
  two JSON files to the browser, so the app loads instantly.
- **Data-derived definitions.** Each biome's "typical" temperature isn't guessed
  — it's the measured 1991–2020 mean, sampled inside the biome's real polygons.

## Run it

The processed data (`data/processed/biomes.geojson` + `stats.json`) is bundled,
so you can start immediately:

```bash
python3 server.py            # then open http://127.0.0.1:8000
```

## Rebuild the data (optional)

Only needed if you want finer resolution, more sample points, or fresh temps.

```bash
# 1. Get the biome polygons (150 MB, CC-BY 4.0) — once.
curl -o data/raw/Ecoregions2017.zip https://storage.googleapis.com/teow2016/Ecoregions2017.zip
unzip data/raw/Ecoregions2017.zip -d data/raw/

# 2. Shapefile -> simplified biomes.geojson
python3 -m pipeline.build_biomes

# 3. Long-term trend: sample each biome and fetch climate (cached in data/cache/)
python3 -m pipeline.build_stats 8      # 8 sample points per biome

# 4. Today snapshot: sample each biome (16 pts) and fetch live forecasts
python3 -m pipeline.build_today [n]    # n samples/biome, default 16
```

`build_today` samples the biome polygons **independently** of `build_stats` and
uses only the light 1-day forecast API — so it's cheap, never touches the archive
quota, and can run on a daily cron to keep the left dashboard fresh. Points are
chosen by **farthest-point sampling** (`geo.sample_points`), which spreads them
across every continent the biome touches instead of clustering — so a globe-spanning
biome (e.g. deserts) won't miss a landmass. Open-Meteo's free forecast tier
(~600/min, 10k/day) leaves plenty of headroom; the practical limit is build time
(~1s/point), so ~40/biome is reachable, but 16 with farthest-point spread is plenty.

## Tuning knobs

| Where | Knob | Effect |
|---|---|---|
| `pipeline/build_biomes.py` | `EPS`, `MIN_AREA` | polygon detail vs file size |
| `pipeline/build_stats.py` (arg) | samples per biome | average fidelity vs API calls |
| `pipeline/climate.py` | `NORMAL_START/END` | which period defines "normal" |
| `web/app.js` | `anomalyColor()` | how deviations read on the map |
| `web/app.js` | `METRICS` catalog | add a "today" metric (+ a field in `build_today.py`) |

## Data sources & licensing

- Biomes: [RESOLVE Ecoregions 2017](https://ecoregions.appspot.com/) — CC-BY 4.0.
- Climate: [Open-Meteo](https://open-meteo.com/) (ERA5 archive + forecast) — free, no key.
- Earthquakes & tsunami: [USGS GeoJSON feeds](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php) — public domain.
- Volcanoes, wildfires & sea-ice: [NASA EONET](https://eonet.gsfc.nasa.gov/) — free, no key.
- Cyclones & floods: [GDACS](https://www.gdacs.org/) — free, no key.
- Basemap: OpenStreetMap © / CARTO.

All earth-activity feeds are fetched live in the browser (CORS-enabled); there's no
pipeline step for them, so they're always current on reload.
