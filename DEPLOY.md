# Deploying Biome Atlas to GitHub Pages

The app is a static site + a daily batch job, so hosting is free and serverless:
GitHub Actions runs the pipeline on a schedule and GitHub Pages serves the result.
Nothing runs on your own servers.

## One-time setup

1. **Create a repo** on GitHub (e.g. `biome-atlas`), empty (no README).

2. **Push this folder** as the repo root (so `pipeline/`, `web/`, `data/`, and
   `.github/` sit at the top level):

   ```bash
   cd "biome-atlas"
   git init -b main
   git add .
   git commit -m "Biome Atlas"
   git remote add origin git@github.com:<you>/biome-atlas.git
   git push -u origin main
   ```

3. **Enable Pages via Actions:** on GitHub → repo **Settings → Pages** →
   *Build and deployment* → **Source: GitHub Actions**. (No branch to pick — the
   workflow in `.github/workflows/deploy.yml` handles it.)

That's it. The push triggers the workflow; in ~5 minutes your site is live at
`https://<you>.github.io/biome-atlas/`. (The app uses relative paths, so the
`/biome-atlas/` subpath works with no config.)

## What happens automatically

- **On every push to `main`** → deploys the *committed* files immediately. It
  does **not** run the live fetch, so pushes are fast and never blocked by
  Open-Meteo rate-limiting on CI runners.
- **Daily at 06:00 UTC** (and on a manual *Run workflow*) → re-runs `build_today`
  for fresh forecasts, commits the updated `today.json` back to `main`
  (`chore: refresh today.json [skip ci]`), and deploys it. This can be slow on a
  shared runner IP, but it's unattended, so that's fine. Adjust the `cron:` in
  `deploy.yml` to change the time.
- The earth-activity overlays (quakes/volcanoes/fires/…) are fetched in each
  visitor's browser, so they're always live regardless of the deploy schedule.

If you'd rather refresh the daily data from your own machine (no CI rate limits),
run `python3 -m pipeline.build_today` locally and `git push` — the push deploys it.

## Updating the long-term data (rare)

`build_stats` (the heavy archive/quota job) is **not** in CI — run it locally when
you want to refresh the climatological normals, then commit the result:

```bash
python3 -m pipeline.build_stats 8
git commit -am "refresh long-term normals" && git push
```

Same for re-simplifying biome geometry (`build_biomes`) — local, then commit
`data/processed/biomes.geojson`.

## Notes

- **No dependencies:** the pipeline is pure Python 3 stdlib, so CI needs no
  `pip install`.
- **Cache busting:** code assets are versioned (`app.js?v=N` — bump on edit) and
  `today.json` is fetched with a `?d=<date>` query, so the CDN never serves stale
  data.
- **Bandwidth:** `biomes.geojson` is 6.4 MB (gzips to ~2 MB, cached after first
  load) — comfortably within Pages' ~100 GB/month soft limit.
- **Custom domain:** add it under Settings → Pages if you want one.
