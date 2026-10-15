/* Biome Atlas — top key · left "today" dashboard · map · right trend panel. */

const SHORT = {
  "Tropical & Subtropical Moist Broadleaf Forests": "Tropical Moist Forest",
  "Tropical & Subtropical Dry Broadleaf Forests": "Tropical Dry Forest",
  "Tropical & Subtropical Coniferous Forests": "Tropical Conifer Forest",
  "Tropical & Subtropical Grasslands, Savannas & Shrublands": "Tropical Grassland",
  "Temperate Broadleaf & Mixed Forests": "Temperate Broadleaf",
  "Temperate Conifer Forests": "Temperate Conifer",
  "Temperate Grasslands, Savannas & Shrublands": "Temperate Grassland",
  "Boreal Forests/Taiga": "Boreal / Taiga",
  "Flooded Grasslands & Savannas": "Flooded Grassland",
  "Montane Grasslands & Shrublands": "Montane Grassland",
  "Mediterranean Forests, Woodlands & Scrub": "Mediterranean",
  "Deserts & Xeric Shrublands": "Desert & Xeric",
  "Mangroves": "Mangroves",
  "Tundra": "Tundra",
};
const short = n => SHORT[n] || n;

// Range-bar axis. Starts as a sane fallback, then snaps to the planet's actual
// span (coldest biome min → hottest biome max) once today's data is in — so the
// bars use the full width to show each biome's position across global diversity.
// Shared across all bars (honest comparison); the floor is data-driven, not 0°.
let axisMin = -30, axisMax = 45;
const pct = t => Math.max(0, Math.min(100, (t - axisMin) / (axisMax - axisMin) * 100));
function computeAxis() {
  const mins = [], maxs = [];
  for (const v of Object.values(TODAY)) if (v.n) { mins.push(v.day_min); maxs.push(v.day_max); }
  if (mins.length) { axisMin = Math.min(...mins); axisMax = Math.max(...maxs); }
}
const fmt = (v, u = "°") => (v === null || v === undefined ? "—" : `${v.toFixed(1)}${u}`);
const signed = (v, dp = 1) => (v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(dp)}°`);
// Third-party feed text (quake places, event titles) goes into popup HTML — escape it.
const esc = v => String(v ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// Make a non-button element keyboard-operable (Enter/Space) like a button.
function clickable(el, fn, label) {
  el.tabIndex = 0;
  el.setAttribute("role", "button");
  if (label) el.setAttribute("aria-label", label);
  el.onclick = fn;
  el.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn(); } };
}

// Catalog of toggle-able "today" metrics. Add a row here + a field in
// build_today.py to introduce a new one — nothing else needs to change.
const METRICS = [
  { key: "feels",    icon: "🌡", label: "Feels",    unit: "°",     dp: 0 },
  { key: "precip",   icon: "💧", label: "Precip",   unit: "mm",    dp: 1 },
  { key: "humidity", icon: "💦", label: "Humidity", unit: "%",     dp: 0 },
  { key: "wind",     icon: "🌬", label: "Wind",     unit: " km/h", dp: 0 },
  { key: "uv",       icon: "☀", label: "UV",       unit: "",      dp: 1, hi: v => v >= 8 },
  { key: "sunshine", icon: "🌤", label: "Sun",      unit: " h",    dp: 1 },
];
const DEFAULT_METRICS = ["precip", "humidity", "wind", "uv"];
const loadEnabled = () => {
  try { const s = JSON.parse(localStorage.getItem("ba_metrics")); if (Array.isArray(s)) return s; }
  catch (e) { /* ignore */ }
  return DEFAULT_METRICS;
};
const enabled = new Set(loadEnabled());
const saveEnabled = () => { try { localStorage.setItem("ba_metrics", JSON.stringify([...enabled])); } catch (e) { /* ignore */ } };

let STATS = {}, TODAY = {}, LAYER = null, MODE = "biome";
// PINNED = clicked selection (sticky, dims the rest of the map); FOCUS = what's
// highlighted right now (a hovered biome previews over the pinned one).
let PINNED = null, FOCUS = null;
const layersByName = {};
const sampleMarkers = L.layerGroup();

const WORLD = [[-56, -168], [78, 180]];            // land extent, Antarctica excluded
const map = L.map("map", { preferCanvas: true, worldCopyJump: true, zoomSnap: 0.25,
                           minZoom: 1, maxZoom: 7 });
map.fitBounds(WORLD);
// Esri "Dark Gray Base" — keyless, no watermark on public origins (unlike CARTO,
// which stamps "API KEY REQUIRED" on non-localhost sites). Esri tiles use z/y/x.
L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
  attribution: "Tiles © Esri — Esri, HERE, Garmin, © OpenStreetMap contributors · biomes: RESOLVE/WWF · climate: Open-Meteo",
  maxZoom: 16,
}).addTo(map);
sampleMarkers.addTo(map);

// ── anomaly → color ─────────────────────────────────────────────────────────
// ★ TUNE ME: diverging ramp for "color by anomaly". Default spreads ~±2.5 °C
// from grey(0) → orange(warm) / blue(cool). Widen for a calmer map, narrow to
// dramatize, or switch to fixed bands for discrete categories.
function anomalyColor(a) {
  if (a === null || a === undefined) return "#3a3a3a";
  const t = Math.max(-1, Math.min(1, a / 2.5));
  return t >= 0 ? mix([120, 130, 140], [255, 110, 60], t)
                : mix([120, 130, 140], [70, 150, 255], -t);
}
const mix = (c1, c2, t) =>
  `rgb(${c1.map((v, i) => Math.round(v + (c2[i] - v) * t)).join(",")})`;

// ── map styling & emphasis ───────────────────────────────────────────────────
function styleFor(feature) {
  const name = feature.properties.biome;
  const s = STATS[name] || {};
  const fill = MODE === "anomaly" ? anomalyColor(s.anomaly)
                                  : (feature.properties.color || "#888");
  if (name === FOCUS) return { color: "#fff", weight: 2, fillColor: fill, fillOpacity: 0.95 };
  // Only a pinned selection dims the rest — plain hovering shouldn't flicker the map.
  const dim = PINNED && FOCUS && name !== FOCUS;
  return { color: "#0a0f16", weight: 0.4, fillColor: fill, fillOpacity: dim ? 0.3 : 0.82 };
}
function restyle() {
  if (!LAYER) return;
  LAYER.setStyle(styleFor);
  if (FOCUS && layersByName[FOCUS]) layersByName[FOCUS].bringToFront();   // outline on top
}

// ── selection (ties the three views together) ───────────────────────────────
// kind = which sample points to drop on the map: "daily" (from the left panel)
// or "trend" (from the map/legend/right-panel context).
function render(name, kind) {
  FOCUS = name;
  showDetail(name);
  showSamples(name, kind);
  restyle();
  document.querySelectorAll("[data-b]").forEach(r =>
    r.classList.toggle("active", r.dataset.b === name));
}
function selectBiome(name, zoom = false, kind = "trend") {
  PINNED = { name, kind };
  render(name, kind);
  if (zoom && layersByName[name]) map.fitBounds(layersByName[name].getBounds(), { maxZoom: 5 });
  revealRow(name);
}
const preview = name => render(name, "trend");
const endPreview = () => (PINNED ? render(PINNED.name, PINNED.kind) : clearSelection());
function clearSelection() {
  PINNED = null; FOCUS = null;
  sampleMarkers.clearLayers();
  restyle();
  document.querySelectorAll("[data-b].active").forEach(r => r.classList.remove("active"));
  const el = document.getElementById("detail");
  el.className = "detail empty";
  el.textContent = "No biome selected — hover or click one on the map, the key, or the list below.";
}
// Scroll the biome's "today" row into view — inside the panel only, never the page
// (on a phone the panels stack under the map, and jumping away would be jarring).
function revealRow(name) {
  const panel = document.getElementById("left");
  const row = panel.querySelector(`.trow[data-b="${CSS.escape(name)}"]`);
  if (!row || panel.scrollHeight <= panel.clientHeight + 1) return;
  const top = row.offsetTop, bottom = top + row.offsetHeight;
  if (top < panel.scrollTop || bottom > panel.scrollTop + panel.clientHeight)
    panel.scrollTo({ top: top - panel.clientHeight / 3, behavior: "smooth" });
}
document.addEventListener("keydown", e => { if (e.key === "Escape" && PINNED) clearSelection(); });

// ── right panel: long-term trend ─────────────────────────────────────────────
function showDetail(name) {
  const s = STATS[name] || {};
  const t = TODAY[name] || {};
  const el = document.getElementById("detail");
  el.className = "detail" + (PINNED && PINNED.name === name ? " pinned" : "");
  const cls = s.anomaly == null ? "" : s.anomaly >= 0 ? "pos" : "neg";
  el.innerHTML = `
    <div class="name"><span class="swatch" style="background:${s.color || t.color || "#888"}"></span>
      <span class="dname">${esc(name)}</span>
      ${PINNED && PINNED.name === name ? `<button class="unpin" title="Clear selection (Esc)" aria-label="Clear selection">×</button>` : ""}</div>
    <table>
      <tr><td class="k">Climatological normal</td><td class="v">${fmt(s.normal, "°C")}</td></tr>
      <tr><td class="k">Spatial spread (σ)</td><td class="v">${fmt(s.spread, "°C")}</td></tr>
      <tr><td class="k">Recent 12-mo mean</td><td class="v">${fmt(s.recent, "°C")}</td></tr>
      <tr><td class="k">Anomaly vs normal</td><td class="v anom ${cls}">${s.anomaly == null ? "—" : signed(s.anomaly) + "C"}</td></tr>
      <tr><td class="k">Today's average</td><td class="v">${t.n ? fmt(t.day_avg, "°C") : "—"}</td></tr>
      <tr><td class="k">Ecoregions · samples</td><td class="v">${s.ecoregions ?? "—"} · ${s.n ?? "—"}</td></tr>
    </table>
    <div class="note">Normal = the temperature that defines this biome, measured
      inside its real polygons. Anomaly = how the last year deviated from it.</div>`;
  const x = el.querySelector(".unpin");
  if (x) x.onclick = clearSelection;
}

// All 14 anomalies at a glance: diverging bars around 0, warmest first. The scale
// is symmetric and shared, so bar length compares honestly across biomes.
function buildAnomalyList() {
  const rows = Object.entries(STATS).filter(([, s]) => s.anomaly != null)
    .sort((a, b) => b[1].anomaly - a[1].anomaly);
  const span = Math.max(1, Math.ceil(Math.max(...rows.map(([, s]) => Math.abs(s.anomaly)))));
  document.getElementById("anom-axis").innerHTML =
    `<span>${signed(-span, 0)}</span><span class="axis-mid">cooler ↔ warmer than normal</span><span>${signed(span, 0)}</span>`;
  const list = document.getElementById("anom-list");
  list.innerHTML = "";
  rows.forEach(([name, s]) => {
    const w = Math.abs(s.anomaly) / span * 50;
    const row = document.createElement("div");
    row.className = "arow";
    row.dataset.b = name;
    row.innerHTML = `<span class="chip" style="background:${s.color}"></span>
      <span class="aname">${esc(short(name))}</span>
      <span class="abar"><span class="abar-fill" style="${s.anomaly >= 0 ? "left:50%" : `left:${50 - w}%`};width:${w}%;background:${anomalyColor(s.anomaly)}"></span></span>
      <span class="aval ${s.anomaly >= 0 ? "pos" : "neg"}">${signed(s.anomaly)}</span>`;
    clickable(row, () => selectBiome(name, true), `${name}: ${signed(s.anomaly)}C vs normal`);
    row.onmouseenter = () => preview(name);
    row.onmouseleave = endPreview;
    list.appendChild(row);
  });
}

// A point's temperature → color on the daily axis (same scale as the range bars).
function tempColor(t) {
  const f = Math.max(0, Math.min(1, (t - axisMin) / ((axisMax - axisMin) || 1)));
  return mix([70, 150, 255], [255, 110, 60], f);   // cold → warm
}

// Sample-point markers: "daily" (today's 10 pts, temp-colored) or "trend"
// (long-term 5 pts, anomaly-colored). Shown for the selected biome.
function showSamples(name, kind) {
  sampleMarkers.clearLayers();
  if (kind === "daily") {
    ((TODAY[name] || {}).samples || []).forEach(p =>
      L.circleMarker([p.lat, p.lon], { radius: 4, color: "#fff", weight: 1, bubblingMouseEvents: false,
          fillColor: tempColor(p.t), fillOpacity: 1 })
       .bindTooltip(`${p.t.toFixed(1)}° today`).addTo(sampleMarkers));
  } else {
    ((STATS[name] || {}).samples || []).forEach(p =>
      L.circleMarker([p.lat, p.lon], { radius: 4, color: "#fff", weight: 1, bubblingMouseEvents: false,
          fillColor: anomalyColor(p.anomaly), fillOpacity: 1 })
       .bindTooltip(`normal ${fmt(p.normal)} · recent ${fmt(p.recent)} · ${p.anomaly >= 0 ? "+" : ""}${p.anomaly}°`)
       .addTo(sampleMarkers));
  }
}

// ── left panel: today dashboard ──────────────────────────────────────────────
function buildToday() {
  const rows = Object.entries(TODAY).filter(([, v]) => v.n);
  const dateEl = document.getElementById("today-date");
  const anyDate = rows[0] && rows[0][1].date;
  dateEl.textContent = anyDate || new Date().toISOString().slice(0, 10);
  // The snapshot is rebuilt daily by CI; if that stalls, say so rather than
  // presenting an old forecast as "today".
  const ageDays = anyDate ? Math.floor((Date.now() - Date.parse(anyDate)) / 864e5) : 0;
  dateEl.classList.toggle("stale", ageDays > 1);
  dateEl.title = ageDays > 1 ? `Snapshot is ${ageDays} days old — the daily refresh hasn't run since` : "";
  if (ageDays > 1) dateEl.textContent += ` · ${ageDays}d old`;

  document.getElementById("today-axis").innerHTML =
    `<span>${Math.round(axisMin)}°</span>` +
    `<span class="axis-mid">coldest ↔ hottest biome today</span>` +
    `<span>${Math.round(axisMax)}°</span>`;

  // global summary card
  const avgs = rows.map(([n, v]) => [n, v.day_avg]);
  const gAvg = avgs.reduce((a, [, x]) => a + x, 0) / (avgs.length || 1);
  const warm = avgs.reduce((a, b) => (b[1] > a[1] ? b : a), avgs[0] || ["", 0]);
  const cold = avgs.reduce((a, b) => (b[1] < a[1] ? b : a), avgs[0] || ["", 0]);
  document.getElementById("global-today").innerHTML = `
    <div class="card">
      <div class="k">Global biome average today</div>
      <div class="v">${gAvg.toFixed(1)}°C</div>
      <div class="n">warmest ${short(warm[0])} ${warm[1].toFixed(0)}° ·
        coldest ${short(cold[0])} ${cold[1].toFixed(0)}°</div>
    </div>`;

  // per-biome rows, warmest first
  const list = document.getElementById("today-list");
  list.innerHTML = "";
  Object.entries(TODAY).sort((a, b) => (b[1].day_avg ?? -99) - (a[1].day_avg ?? -99))
    .forEach(([name, v]) => {
      const row = document.createElement("div");
      row.className = "trow";
      row.dataset.b = name;
      if (v.n) {
        const l = pct(v.day_min), w = Math.max(2, pct(v.day_max) - pct(v.day_min));
        const cells = METRICS.filter(m => enabled.has(m.key)).map(m => {
          const val = v[m.key];
          const cls = m.hi && val != null && m.hi(val) ? "uv-high" : "";
          const disp = val == null ? "—" : val.toFixed(m.dp);
          return `<span title="${m.label}" class="${cls}"><span class="mi">${m.icon}</span>${disp}${m.unit}</span>`;
        }).join("");
        row.innerHTML = `
          <div class="trow-top"><span class="chip" style="background:${v.color}"></span>
            <span class="tname">${esc(short(name))}</span><span class="tavg">${v.day_avg.toFixed(0)}°</span></div>
          <div class="bar"><div class="bar-range" style="left:${l}%;width:${w}%;background:${v.color}"></div>
            <div class="bar-avg" style="left:${pct(v.day_avg)}%"></div></div>
          <div class="ends"><span>${v.day_min.toFixed(0)}°</span><span>${v.day_max.toFixed(0)}°</span></div>
          ${cells ? `<div class="metrics">${cells}</div>` : ""}`;
      } else {
        row.innerHTML = `<div class="trow-top"><span class="chip" style="background:${v.color}"></span>
          <span class="tname">${esc(short(name))}</span><span class="tavg">—</span></div>`;
      }
      if (PINNED && PINNED.name === name) row.classList.add("active");
      clickable(row, () => selectBiome(name, true, "daily"), `${name}: today`);
      list.appendChild(row);
    });
}

// ── metric toggles (left panel) ──────────────────────────────────────────────
function buildToggles() {
  const box = document.getElementById("metric-toggles");
  box.innerHTML = "";
  METRICS.forEach(m => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chipbtn" + (enabled.has(m.key) ? " on" : "");
    b.setAttribute("aria-pressed", enabled.has(m.key));
    b.innerHTML = `<span aria-hidden="true">${m.icon}</span>${m.label}`;
    b.onclick = () => {
      enabled.has(m.key) ? enabled.delete(m.key) : enabled.add(m.key);
      saveEnabled();
      b.classList.toggle("on");
      b.setAttribute("aria-pressed", enabled.has(m.key));
      buildToday();                     // re-render rows with the new selection
    };
    box.appendChild(b);
  });
}

// ── legend (top bar) ─────────────────────────────────────────────────────────
function buildLegend(geo) {
  const box = document.getElementById("legend");
  box.innerHTML = "";
  geo.features.map(f => f.properties).sort((a, b) => a.biome.localeCompare(b.biome))
    .forEach(p => {
      const row = document.createElement("div");
      row.className = "row";
      row.dataset.b = p.biome;
      row.title = p.biome;
      row.innerHTML = `<span class="chip" style="background:${p.color}"></span>${esc(short(p.biome))}`;
      clickable(row, () => selectBiome(p.biome, true));
      row.onmouseenter = () => preview(p.biome);
      row.onmouseleave = endPreview;
      box.appendChild(row);
    });
}

// ── load everything ──────────────────────────────────────────────────────────
const getJSON = url => fetch(url).then(r => {
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
});
Promise.all([
  getJSON("data/processed/biomes.geojson"),
  getJSON("data/processed/stats.json"),
  // date query busts the CDN cache so a new day's rebuild is picked up immediately
  fetch(`data/processed/today.json?d=${new Date().toISOString().slice(0, 10)}`).then(r => r.ok ? r.json() : {}).catch(() => ({})),
]).then(([geo, stats, today]) => {
  STATS = stats; TODAY = today;
  computeAxis();
  LAYER = L.geoJSON(geo, {
    style: styleFor,
    onEachFeature: (f, layer) => {
      const name = f.properties.biome;
      layersByName[name] = layer;
      layer.on("mouseover", () => preview(name));
      layer.on("mouseout", endPreview);
      layer.on("click", e => { L.DomEvent.stopPropagation(e); selectBiome(name, true); });
    },
  }).addTo(map);
  buildLegend(geo);
  buildToggles();
  buildToday();
  buildAnomalyList();
  indexBiomes(geo);
  renderEvents();                                   // fill in the events' biome column
  map.invalidateSize();
  document.getElementById("loading").remove();
}).catch(err => {
  console.error(err);
  const el = document.getElementById("loading");
  el.classList.add("error");
  el.textContent = "Couldn't load the biome data — try reloading.";
});

map.on("click", () => { if (PINNED) clearSelection(); });   // click open water/basemap
document.querySelectorAll('input[name="mode"]').forEach(r =>
  r.addEventListener("change", e => {
    MODE = e.target.value;
    restyle();
    document.getElementById("app").classList.toggle("mode-anomaly", MODE === "anomaly");
  }));
window.addEventListener("resize", () => map.invalidateSize());

// Diverging-ramp key, shown on the map only in "anomaly" mode.
const AnomKey = L.control({ position: "bottomleft" });
AnomKey.onAdd = () => {
  const div = L.DomUtil.create("div", "anom-key");
  const stops = [-2.5, -1.25, 0, 1.25, 2.5].map(a => anomalyColor(a)).join(",");
  div.innerHTML = `<div class="anom-key-title">Recent 12-mo anomaly</div>
    <div class="anom-key-bar" style="background:linear-gradient(90deg,${stops})"></div>
    <div class="anom-key-ticks"><span>≤ −2.5°</span><span>0</span><span>≥ +2.5°</span></div>`;
  return div;
};
AnomKey.addTo(map);

// ── collapsible side panels ──────────────────────────────────────────────────
// Widths live in CSS (via classes) so the phone layout's media query can override them.
let leftOpen = true, rightOpen = true;
function updateLayout() {
  const app = document.getElementById("app");
  app.classList.toggle("left-collapsed", !leftOpen);
  app.classList.toggle("right-collapsed", !rightOpen);
  document.getElementById("left").classList.toggle("collapsed", !leftOpen);
  document.getElementById("right").classList.toggle("collapsed", !rightOpen);
  document.getElementById("left-toggle").textContent = leftOpen ? "‹" : "›";
  document.getElementById("right-toggle").textContent = rightOpen ? "›" : "‹";
  document.getElementById("left-toggle").title = leftOpen ? "Collapse panel" : "Expand panel";
  document.getElementById("right-toggle").title = rightOpen ? "Collapse panel" : "Expand panel";
  setTimeout(() => map.invalidateSize(), 200);        // after the width transition
}
document.getElementById("left-toggle").onclick = () => { leftOpen = !leftOpen; updateLayout(); };
document.getElementById("right-toggle").onclick = () => { rightOpen = !rightOpen; updateLayout(); };

// ── earth-activity overlays (live natural hazards — not human activity) ───────
// Three CORS-enabled, no-key feeds, each loaded independently and fault-tolerant:
// a failing feed shows "—" and never breaks the map or the other overlays.
// Every feed is normalized to plain event records first, so the map markers and
// the "Earth activity" table are built from one list:
//   { key, icon, lat, lon, title, time (ms|null), size (number|null, for sorting),
//     sizeLabel (html), popup (html), url, marker }
// Icon size scales *inversely* with zoom: bigger when zoomed out (easy to spot),
// smaller when zoomed in (don't blanket the map). z2 → ~22px, z7 → ~12px.
const hazSize = () => Math.round(Math.min(24, 22 - (map.getZoom() - 2) * 2));
const hzIcon = (emoji, size = hazSize()) => L.divIcon({
  html: `<span style="font-size:${Math.round(size * 0.8)}px">${emoji}</span>`,
  className: "hz-icon", iconSize: [size, size], iconAnchor: [size / 2, size / 2],
});
const fmtNum = v => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v);
const UNIT = { acres: "ac", "NM^2": "NM²" };        // short units for the table's narrow Size column
const dateLabel = t => (t ? new Date(t).toUTCString().replace(/:\d\d GMT$/, " UTC") : "");
const source = url => (url ? `<br><a href="${esc(url)}" target="_blank" rel="noopener">source ↗</a>` : "");

// One EONET fetch for ALL categories, filtered client-side. This avoids bursts
// (EONET throttles concurrent requests to an empty body) AND is more complete —
// the per-category `category=` filter silently under-returns sea-ice & storms.
// Memoize a single shared promise that RETRIES until it gets a non-empty body,
// so a transient throttle can't poison the cache for every EONET layer.
let _eonet;
function eonetAll() {
  return _eonet = _eonet || (async () => {
    for (let i = 0; i < 4; i++) {
      try {
        const d = await fetch("https://eonet.gsfc.nasa.gov/api/v3/events?days=120&limit=1000").then(r => r.json());
        if (d.events && d.events.length) return d;
      } catch (e) { /* retry */ }
      await new Promise(r => setTimeout(r, 1000));
    }
    return { events: [] };
  })();
}

function usgsRecord(f, extra = {}) {                // USGS GeoJSON feature → record
  const [lon, lat] = f.geometry.coordinates, p = f.properties, mag = p.mag ?? 0;
  return { lat, lon, title: p.place || p.title || "Earthquake", time: p.time ?? null,
    size: mag, sizeLabel: `M${mag.toFixed(1)}`, url: p.url, ...extra,
    popup: `<b>M${mag.toFixed(1)}</b> — ${esc(p.place || "?")}<br><small>${dateLabel(p.time)}</small>${source(p.url)}` };
}

async function loadQuakes() {                       // USGS — M2.5+, past 24h
  const d = await fetch("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson").then(r => r.json());
  return d.features.map(f => usgsRecord(f));
}

async function loadTsunami() {                      // USGS quakes flagged tsunami-capable
  const d = await fetch("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson").then(r => r.json());
  return d.features.filter(f => f.properties.tsunami === 1).map(f => {
    const r = usgsRecord(f);
    return { ...r, popup: `<b>🌊 Tsunami-flagged</b> ${r.popup}` };
  });
}

async function loadEonet(catId, days, emoji) {      // NASA EONET — volcanoes / fires / ice
  const d = await eonetAll();
  const cutoff = Date.now() - days * 864e5;
  const out = [];
  (d.events || []).forEach(e => {
    if (!e.categories.some(c => c.id === catId)) return;
    const geom = e.geometry[e.geometry.length - 1];
    const time = geom.date ? Date.parse(geom.date) : null;
    if (time && time < cutoff) return;                         // per-category recency
    let lon, lat;
    if (geom.type === "Point") [lon, lat] = geom.coordinates;
    else if (geom.type === "Polygon") [lon, lat] = geom.coordinates[0][0];  // area event → a vertex
    else return;
    const v = geom.magnitudeValue, unit = UNIT[geom.magnitudeUnit] ?? geom.magnitudeUnit ?? "";
    const url = e.link || (e.sources && e.sources[0] && e.sources[0].url);
    out.push({ lat, lon, title: e.title, time, url,
      size: v ?? null, sizeLabel: v != null ? `${fmtNum(v)}<small> ${esc(unit)}</small>` : "",
      popup: `<b>${emoji} ${esc(e.title)}</b><br><small>${esc((geom.date || "").slice(0, 10))}</small>${source(url)}` });
  });
  return out;
}

// One GDACS fetch shared by floods + cyclones (both live in the same feed).
let _gdacs;
const gdacs = () => (_gdacs = _gdacs || fetch("https://www.gdacs.org/gdacsapi/api/events/geteventlist/EVENTS4APP").then(r => r.json()));
const ALERT_RANK = { green: 1, orange: 2, red: 3 };
async function loadGdacs(type, emoji) {
  const d = await gdacs();
  return (d.features || []).filter(f => f.properties && f.properties.eventtype === type &&
                                        f.geometry && f.geometry.type === "Point").map(f => {
    const [lon, lat] = f.geometry.coordinates, p = f.properties;
    const lvl = String(p.alertlevel || "").toLowerCase();
    const title = p.name || p.description || p.country || type;
    const time = Date.parse(p.todate || p.fromdate) || null;
    const url = p.url && (p.url.report || p.url.details);
    return { lat, lon, title, time, url, size: ALERT_RANK[lvl] ?? null,
      sizeLabel: lvl ? `<span class="alert alert-${esc(lvl)}">${esc(p.alertlevel)}</span>` : "",
      popup: `<b>${emoji} ${esc(title)}</b>${p.alertlevel ? ` <small>(${esc(p.alertlevel)} alert)</small>` : ""}` +
             (p.severitydata && p.severitydata.severitytext ? `<br><small>${esc(p.severitydata.severitytext)}</small>` : "") + source(url) };
  });
}

const HAZARDS = [
  { key: "earthquakes", icon: "🔴", label: "Earthquakes", sizeHead: "Mag",   load: loadQuakes },
  { key: "volcanoes",   icon: "🌋", label: "Volcanoes",   sizeHead: "",      load: () => loadEonet("volcanoes", 120, "🌋") },
  { key: "fires",       icon: "🔥", label: "Fires",       sizeHead: "Area",  load: () => loadEonet("wildfires", 30, "🔥") },
  { key: "cyclones",    icon: "🌀", label: "Cyclones",    sizeHead: "Alert", load: () => loadGdacs("TC", "🌀") },
  { key: "floods",      icon: "💧", label: "Floods",      sizeHead: "Alert", load: () => loadGdacs("FL", "💧") },
  { key: "tsunami",     icon: "🌊", label: "Tsunami",     sizeHead: "Mag",   load: loadTsunami },
  { key: "seaice",      icon: "🧊", label: "Sea ice",     sizeHead: "Area",  load: () => loadEonet("seaLakeIce", 365, "🧊") },
];
const HAZ = Object.fromEntries(HAZARDS.map(h => [h.key, h]));
const hazardLayers = {};
const EVENTS = {};                                  // key → [record] once its feed has loaded
const loadHaz = () => { try { const s = JSON.parse(localStorage.getItem("ba_haz_v2")); if (Array.isArray(s)) return s; } catch (e) {} return HAZARDS.map(h => h.key); };
const hazardOn = new Set(loadHaz());
const saveHaz = () => { try { localStorage.setItem("ba_haz_v2", JSON.stringify([...hazardOn])); } catch (e) {} };
// Folded state of the overlay box: remembered; folded by default on small screens.
const hazFolded = (() => { try { const v = localStorage.getItem("ba_haz_folded"); if (v !== null) return v === "1"; } catch (e) {} return innerWidth < 860; })();

const HazControl = L.control({ position: "topright" });
HazControl.onAdd = () => {
  const div = L.DomUtil.create("div", "haz-control" + (hazFolded ? " folded" : ""));
  div.innerHTML = `<button type="button" class="haz-title" aria-expanded="${!hazFolded}">🌍 Earth activity <span class="haz-live">live</span><span class="haz-caret" aria-hidden="true">▾</span></button>`;
  div.querySelector(".haz-title").onclick = () => {
    const folded = div.classList.toggle("folded");
    div.querySelector(".haz-title").setAttribute("aria-expanded", !folded);
    try { localStorage.setItem("ba_haz_folded", folded ? "1" : "0"); } catch (e) {}
  };
  const body = L.DomUtil.create("div", "haz-body", div);
  HAZARDS.forEach(h => {
    const row = L.DomUtil.create("label", "haz-row", body);
    row.innerHTML = `<input type="checkbox" ${hazardOn.has(h.key) ? "checked" : ""}> <span>${h.icon} ${h.label}</span> <span class="haz-count" id="hz-${h.key}">…</span>`;
    row.querySelector("input").addEventListener("change", e => toggleHazard(h.key, e.target.checked));
  });
  const foot = L.DomUtil.create("div", "haz-foot", body);
  foot.textContent = "USGS · NASA EONET · GDACS";
  L.DomEvent.disableClickPropagation(div);
  L.DomEvent.disableScrollPropagation(div);
  return div;
};
HazControl.addTo(map);

function toggleHazard(key, on) {
  on ? hazardOn.add(key) : hazardOn.delete(key);
  saveHaz();
  const layer = hazardLayers[key];
  if (layer) on ? layer.addTo(map) : map.removeLayer(layer);
  renderEvents();                                   // keep the table's "overlay off" hints current
}

// Records → a layer of markers (quakes as magnitude-sized circles, the rest emoji).
function buildHazardLayer(h, events) {
  const g = L.layerGroup();
  events.forEach(ev => {
    let m;
    if (h.key === "earthquakes") {
      const base = 2 + Math.max(0, ev.size) * 1.4;   // magnitude-driven base radius
      m = L.circleMarker([ev.lat, ev.lon], { radius: base * hazSize() / 16, color: "#ff453a", bubblingMouseEvents: false,
          weight: 1, fillColor: "#ff453a", fillOpacity: 0.35 });
      m._baseR = base;                               // remembered for zoom resizing
    } else {
      m = L.marker([ev.lat, ev.lon], { icon: hzIcon(h.icon) });
      m._emoji = h.icon;                             // remembered so we can resize on zoom
    }
    m.bindPopup(ev.popup);
    m.on("mouseover", () => markRow(ev, true));      // map → table: light up its row
    m.on("mouseout", () => markRow(ev, false));
    ev.marker = m;
    m.addTo(g);
  });
  return g;
}

HAZARDS.forEach(async h => {
  const el = () => document.getElementById(`hz-${h.key}`);
  try {
    const events = await h.load();
    events.forEach(ev => { ev.key = h.key; ev.icon = h.icon; });
    EVENTS[h.key] = events;
    const layer = hazardLayers[h.key] = buildHazardLayer(h, events);
    if (el()) el().textContent = events.length;
    if (hazardOn.has(h.key)) layer.addTo(map);
  } catch (err) {
    EVENTS[h.key] = null;                            // null = feed failed (vs [] = quiet)
    if (el()) el().textContent = "—";
    console.warn("earth-activity feed failed:", h.key, err);
  }
  renderEvents();
});

// Resize all hazard markers inversely to zoom (emoji via setIcon, quakes via radius).
function updateHazardSizes() {
  const size = hazSize(), scale = size / 16;
  Object.values(hazardLayers).forEach(layer => layer && layer.eachLayer(m => {
    if (m._emoji) m.setIcon(hzIcon(m._emoji, size));
    else if (m._baseR != null) m.setRadius(m._baseR * scale);
  }));
  if (ring) ring.setIcon(ringIcon());
}
map.on("zoomend", updateHazardSizes);

// ── which biome is an event in? (point-in-polygon on the loaded geometry) ─────
// Each polygon keeps its outer-ring bbox, so most tests are a cheap reject.
let BIOME_INDEX = null;
function indexBiomes(geo) {
  BIOME_INDEX = [];
  geo.features.forEach(f => f.geometry.coordinates.forEach(poly => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of poly[0]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    BIOME_INDEX.push({ name: f.properties.biome, bbox: [x0, y0, x1, y1], rings: poly });
  }));
}
function inRing(x, y, ring) {                       // ray casting
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function biomeAt(lat, lon) {
  if (!BIOME_INDEX) return undefined;               // geometry not loaded yet
  for (const p of BIOME_INDEX) {
    const [x0, y0, x1, y1] = p.bbox;
    if (lon < x0 || lon > x1 || lat < y0 || lat > y1) continue;
    if (inRing(lon, lat, p.rings[0]) && !p.rings.slice(1).some(h => inRing(lon, lat, h))) return p.name;
  }
  return null;                                      // ocean, ice sheet, lake…
}

// ── "Earth activity" tab: filterable table of every event ─────────────────────
// Hover a row → a pulsing ring marks it on the map (even if that overlay is
// switched off); click → fly there and open its popup.
let evFilter = (() => { try { return localStorage.getItem("ba_ev_filter") || "all"; } catch (e) { return "all"; } })();
let evSort = { col: "time", dir: -1 };
let ring = null;
const ringIcon = () => { const s = hazSize() + 18; return L.divIcon({ className: "hz-ring", iconSize: [s, s], iconAnchor: [s / 2, s / 2] }); };
function showRing(ev) {
  hideRing();
  ring = L.marker([ev.lat, ev.lon], { icon: ringIcon(), interactive: false, keyboard: false, zIndexOffset: 1000 }).addTo(map);
}
function hideRing() { if (ring) { map.removeLayer(ring); ring = null; } }
function markRow(ev, on) {
  if (ev._row) ev._row.classList.toggle("hover", on);
}
function flyToEvent(ev) {
  map.setView([ev.lat, ev.lon], Math.max(map.getZoom(), 4));
  if (ev.marker && map.hasLayer(ev.marker)) ev.marker.openPopup();
  else L.popup().setLatLng([ev.lat, ev.lon]).setContent(ev.popup).openOn(map);
}
const ago = t => {
  if (!t) return "—";
  const m = (Date.now() - t) / 6e4;
  if (m < 60) return `${Math.max(1, Math.round(m))}m`;
  if (m < 1440) return `${Math.round(m / 60)}h`;
  if (m < 1440 * 30) return `${Math.round(m / 1440)}d`;
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
};

function buildEventFilters() {
  const box = document.getElementById("ev-filters");
  box.innerHTML = "";
  [{ key: "all", icon: "", label: "All" }, ...HAZARDS].forEach(h => {
    const list = h.key === "all" ? Object.values(EVENTS).filter(Boolean).flat() : EVENTS[h.key];
    const n = list === undefined ? "…" : list === null ? "—" : list.length;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chipbtn" + (evFilter === h.key ? " on" : "") + (n === 0 || n === "—" ? " empty" : "");
    b.setAttribute("aria-pressed", evFilter === h.key);
    b.title = n === "—" ? `${h.label}: feed unavailable` : `${h.label}: ${n}`;
    b.innerHTML = `${h.icon ? `<span aria-hidden="true">${h.icon}</span>` : ""}${h.label}<span class="cnt">${n}</span>`;
    b.onclick = () => {
      evFilter = h.key;
      try { localStorage.setItem("ba_ev_filter", evFilter); } catch (e) {}
      renderEvents();
    };
    box.appendChild(b);
  });
}

function renderEvents() {
  if (!document.getElementById("ev-body")) return;
  buildEventFilters();
  const all = evFilter === "all" ? Object.values(EVENTS).filter(Boolean).flat() : (EVENTS[evFilter] || []);
  const total = Object.values(EVENTS).filter(Boolean).reduce((a, l) => a + l.length, 0);
  document.getElementById("ev-total").textContent = total || "";
  all.forEach(ev => { if (ev.biome === undefined) ev.biome = biomeAt(ev.lat, ev.lon); });

  const { col, dir } = evSort;
  const val = ev => col === "time" ? ev.time ?? -Infinity
                  : col === "size" ? ev.size ?? -Infinity
                  : ev.title.toLowerCase();
  const rows = [...all].sort((a, b) => {
    const x = val(a), y = val(b);
    return (x < y ? -1 : x > y ? 1 : 0) * dir || (b.time ?? 0) - (a.time ?? 0);
  });

  // Size column header depends on what's listed (Mag / Area / Alert…).
  const sizeHead = evFilter === "all" ? "Size" : (HAZ[evFilter].sizeHead || "Size");
  document.querySelectorAll("#ev-table th[data-col]").forEach(th => {
    if (th.dataset.col === "size") th.firstChild.textContent = sizeHead;
    th.classList.toggle("sorted", th.dataset.col === col);
    th.setAttribute("aria-sort", th.dataset.col === col ? (dir > 0 ? "ascending" : "descending") : "none");
    th.dataset.dir = dir > 0 ? "▲" : "▼";
  });

  const body = document.getElementById("ev-body");
  body.innerHTML = "";
  const status = document.getElementById("ev-status");
  const pending = HAZARDS.some(h => EVENTS[h.key] === undefined);
  const failed = evFilter !== "all" && EVENTS[evFilter] === null;
  status.textContent = failed ? "This feed is unavailable right now." :
    !rows.length ? (pending ? "Loading live feeds…" : "No events of this type right now.") : "";
  status.hidden = !status.textContent;

  rows.forEach(ev => {
    const tr = document.createElement("tr");
    const hidden = !hazardOn.has(ev.key);
    if (hidden) tr.classList.add("off");
    const s = ev.biome && STATS[ev.biome];
    tr.innerHTML = `
      <td class="ev-ico">${ev.icon}</td>
      <td class="ev-title"><div title="${esc(ev.title)}">${esc(ev.title)}</div>
        ${ev.biome ? `<div class="ev-biome" title="${esc(ev.biome)}"><span class="chip" style="background:${(s && s.color) || "#888"}"></span>${esc(short(ev.biome))}</div>`
                   : ev.biome === null ? `<div class="ev-biome none" title="Outside the mapped biomes">ocean / ice / lake</div>` : ""}</td>
      <td class="ev-size">${ev.sizeLabel || "—"}</td>
      <td class="ev-time" title="${esc(dateLabel(ev.time))}">${ago(ev.time)}</td>`;
    if (hidden) tr.title = `${HAZ[ev.key].label} overlay is off — hover still shows where it is`;
    clickable(tr, () => flyToEvent(ev), `${HAZ[ev.key].label}: ${ev.title}`);
    tr.onmouseenter = tr.onfocus = () => { showRing(ev); markRow(ev, true); };
    tr.onmouseleave = tr.onblur = () => { hideRing(); markRow(ev, false); };
    ev._row = tr;
    body.appendChild(tr);
  });
}

document.querySelectorAll("#ev-table th[data-col]").forEach(th => {
  const sortBy = () => {
    const c = th.dataset.col;
    evSort = { col: c, dir: evSort.col === c ? -evSort.dir : (c === "title" ? 1 : -1) };
    renderEvents();
  };
  clickable(th, sortBy, `Sort by ${th.textContent.trim()}`);
});

// ── right-panel tabs ──────────────────────────────────────────────────────────
function showTab(name) {
  document.querySelectorAll("#right [role=tab]").forEach(t => {
    const on = t.dataset.tab === name;
    t.setAttribute("aria-selected", on);
    t.tabIndex = on ? 0 : -1;
  });
  document.querySelectorAll("#right [role=tabpanel]").forEach(p => (p.hidden = p.id !== `tab-${name}`));
  if (name !== "events") hideRing();
  try { localStorage.setItem("ba_tab", name); } catch (e) {}
}
document.querySelectorAll("#right [role=tab]").forEach(t => (t.onclick = () => showTab(t.dataset.tab)));
showTab((() => { try { return localStorage.getItem("ba_tab") || "trend"; } catch (e) { return "trend"; } })());
