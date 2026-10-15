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
const saveEnabled = () => localStorage.setItem("ba_metrics", JSON.stringify([...enabled]));

let STATS = {}, TODAY = {}, LAYER = null, MODE = "biome";
const layersByName = {};
const sampleMarkers = L.layerGroup();

const map = L.map("map", { preferCanvas: true, worldCopyJump: true,
                           minZoom: 2, maxZoom: 7 }).setView([25, 10], 2);
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
  const s = STATS[feature.properties.biome] || {};
  const fill = MODE === "anomaly" ? anomalyColor(s.anomaly)
                                  : (feature.properties.color || "#888");
  return { color: "#0a0f16", weight: 0.4, fillColor: fill, fillOpacity: 0.82 };
}
function emphasize(name) {
  if (!LAYER) return;
  Object.entries(layersByName).forEach(([n, layer]) =>
    layer.setStyle(n === name ? { weight: 2, color: "#fff", fillOpacity: 0.9 }
                              : styleFor(layer.feature)));
}

// ── selection (ties the three views together) ───────────────────────────────
// kind = which sample points to drop on the map: "daily" (from the left panel)
// or "trend" (from the map/legend/right-panel context).
function selectBiome(name, zoom = false, kind = "trend") {
  showDetail(name);
  showSamples(name, kind);
  emphasize(name);
  document.querySelectorAll(".trow").forEach(r =>
    r.classList.toggle("active", r.dataset.b === name));
  if (zoom && layersByName[name]) map.fitBounds(layersByName[name].getBounds(), { maxZoom: 5 });
}

// ── right panel: long-term trend ─────────────────────────────────────────────
function showDetail(name) {
  const s = STATS[name] || {};
  const el = document.getElementById("detail");
  el.classList.remove("empty");
  const cls = s.anomaly == null ? "" : s.anomaly >= 0 ? "pos" : "neg";
  const sign = s.anomaly > 0 ? "+" : "";
  el.innerHTML = `
    <div class="name"><span class="swatch" style="background:${s.color}"></span>${name}</div>
    <table>
      <tr><td class="k">Climatological normal</td><td class="v">${fmt(s.normal, "°C")}</td></tr>
      <tr><td class="k">Spatial spread (σ)</td><td class="v">${fmt(s.spread, "°C")}</td></tr>
      <tr><td class="k">Recent 12-mo mean</td><td class="v">${fmt(s.recent, "°C")}</td></tr>
      <tr><td class="k">Anomaly vs normal</td><td class="v anom ${cls}">${s.anomaly == null ? "—" : sign + s.anomaly.toFixed(1) + "°C"}</td></tr>
      <tr><td class="k">Ecoregions · samples</td><td class="v">${s.ecoregions} · ${s.n}</td></tr>
    </table>
    <div class="note">Normal = the temperature that defines this biome, measured
      inside its real polygons. Anomaly = how the last year deviated from it.</div>`;
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
      L.circleMarker([p.lat, p.lon], { radius: 4, color: "#fff", weight: 1,
          fillColor: tempColor(p.t), fillOpacity: 1 })
       .bindTooltip(`${p.t.toFixed(1)}° today`).addTo(sampleMarkers));
  } else {
    ((STATS[name] || {}).samples || []).forEach(p =>
      L.circleMarker([p.lat, p.lon], { radius: 4, color: "#fff", weight: 1,
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
            <span class="tname">${short(name)}</span><span class="tavg">${v.day_avg.toFixed(0)}°</span></div>
          <div class="bar"><div class="bar-range" style="left:${l}%;width:${w}%;background:${v.color}"></div>
            <div class="bar-avg" style="left:${pct(v.day_avg)}%"></div></div>
          <div class="ends"><span>${v.day_min.toFixed(0)}°</span><span>${v.day_max.toFixed(0)}°</span></div>
          ${cells ? `<div class="metrics">${cells}</div>` : ""}`;
      } else {
        row.innerHTML = `<div class="trow-top"><span class="chip" style="background:${v.color}"></span>
          <span class="tname">${short(name)}</span><span class="tavg">—</span></div>`;
      }
      row.onclick = () => selectBiome(name, true, "daily");
      list.appendChild(row);
    });
}

// ── metric toggles (left panel) ──────────────────────────────────────────────
function buildToggles() {
  const box = document.getElementById("metric-toggles");
  box.innerHTML = "";
  METRICS.forEach(m => {
    const b = document.createElement("div");
    b.className = "chipbtn" + (enabled.has(m.key) ? " on" : "");
    b.innerHTML = `<span>${m.icon}</span>${m.label}`;
    b.onclick = () => {
      enabled.has(m.key) ? enabled.delete(m.key) : enabled.add(m.key);
      saveEnabled();
      b.classList.toggle("on");
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
      row.innerHTML = `<span class="chip" style="background:${p.color}"></span>${short(p.biome)}`;
      row.onclick = () => selectBiome(p.biome, true);
      box.appendChild(row);
    });
}

// ── load everything ──────────────────────────────────────────────────────────
Promise.all([
  fetch("data/processed/biomes.geojson").then(r => r.json()),
  fetch("data/processed/stats.json").then(r => r.json()),
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
      layer.on("mouseover", () => selectBiome(name));
      layer.on("click", () => selectBiome(name, true));
    },
  }).addTo(map);
  buildLegend(geo);
  buildToggles();
  buildToday();
  map.invalidateSize();
});

document.querySelectorAll('input[name="mode"]').forEach(r =>
  r.addEventListener("change", e => { MODE = e.target.value; if (LAYER) LAYER.setStyle(styleFor); }));
window.addEventListener("resize", () => map.invalidateSize());

// ── collapsible side panels ──────────────────────────────────────────────────
let leftOpen = true, rightOpen = true;
function updateLayout() {
  document.getElementById("app").style.gridTemplateColumns =
    `${leftOpen ? "320px" : "40px"} 1fr ${rightOpen ? "340px" : "40px"}`;
  document.getElementById("left").classList.toggle("collapsed", !leftOpen);
  document.getElementById("right").classList.toggle("collapsed", !rightOpen);
  document.getElementById("left-toggle").textContent = leftOpen ? "‹" : "›";
  document.getElementById("right-toggle").textContent = rightOpen ? "›" : "‹";
  setTimeout(() => map.invalidateSize(), 200);        // after the width transition
}
document.getElementById("left-toggle").onclick = () => { leftOpen = !leftOpen; updateLayout(); };
document.getElementById("right-toggle").onclick = () => { rightOpen = !rightOpen; updateLayout(); };

// ── earth-activity overlays (live natural hazards — not human activity) ───────
// Three CORS-enabled, no-key feeds, each loaded independently and fault-tolerant:
// a failing feed shows "—" and never breaks the map or the other overlays.
// Icon size scales *inversely* with zoom: bigger when zoomed out (easy to spot),
// smaller when zoomed in (don't blanket the map). z2 → ~22px, z7 → ~12px.
const hazSize = () => Math.round(22 - (map.getZoom() - 2) * 2);
const hzIcon = (emoji, size = hazSize()) => L.divIcon({
  html: `<span style="font-size:${Math.round(size * 0.8)}px">${emoji}</span>`,
  className: "hz-icon", iconSize: [size, size], iconAnchor: [size / 2, size / 2],
});
function emojiMarker(lat, lon, emoji, popupHtml) {
  const m = L.marker([lat, lon], { icon: hzIcon(emoji) });
  m._emoji = emoji;                                 // remembered so we can resize on zoom
  if (popupHtml) m.bindPopup(popupHtml);
  return m;
}

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

async function loadQuakes() {                       // USGS — M2.5+, past 24h
  const d = await fetch("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson").then(r => r.json());
  const g = L.layerGroup();
  d.features.forEach(f => {
    const [lon, lat] = f.geometry.coordinates, mag = f.properties.mag;
    const base = 2 + Math.max(0, mag) * 1.4;        // magnitude-driven base radius
    const cm = L.circleMarker([lat, lon], { radius: base * hazSize() / 16, color: "#ff453a",
        weight: 1, fillColor: "#ff453a", fillOpacity: 0.35 });
    cm._baseR = base;                               // remembered for zoom resizing
    cm.bindPopup(`<b>M${(mag ?? 0).toFixed(1)}</b> — ${f.properties.place || "?"}<br><small>${new Date(f.properties.time).toUTCString()}</small>`).addTo(g);
  });
  return { layer: g, count: d.features.length };
}

async function loadEonet(catId, days, emoji) {      // NASA EONET — volcanoes / fires / ice
  const d = await eonetAll();
  const cutoff = Date.now() - days * 864e5;
  const g = L.layerGroup();
  (d.events || []).forEach(e => {
    if (!e.categories.some(c => c.id === catId)) return;
    const geom = e.geometry[e.geometry.length - 1];
    if (geom.date && Date.parse(geom.date) < cutoff) return;   // per-category recency
    let lon, lat;
    if (geom.type === "Point") [lon, lat] = geom.coordinates;
    else if (geom.type === "Polygon") [lon, lat] = geom.coordinates[0][0];  // area event → a vertex
    else return;
    emojiMarker(lat, lon, emoji, `<b>${emoji} ${e.title}</b><br><small>${(geom.date || "").slice(0, 10)}</small>`).addTo(g);
  });
  return { layer: g, count: g.getLayers().length };
}

// One GDACS fetch shared by floods + cyclones (both live in the same feed).
let _gdacs;
const gdacs = () => (_gdacs = _gdacs || fetch("https://www.gdacs.org/gdacsapi/api/events/geteventlist/EVENTS4APP").then(r => r.json()));
async function loadGdacs(type, emoji) {
  const d = await gdacs();
  const g = L.layerGroup();
  (d.features || []).filter(f => f.properties && f.properties.eventtype === type).forEach(f => {
    const [lon, lat] = f.geometry.coordinates, p = f.properties;
    emojiMarker(lat, lon, emoji, `<b>${emoji} ${p.name || type}</b>${p.alertlevel ? ` <small>(${p.alertlevel} alert)</small>` : ""}`).addTo(g);
  });
  return { layer: g, count: g.getLayers().length };
}

async function loadTsunami() {                       // USGS quakes flagged tsunami-capable
  const d = await fetch("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson").then(r => r.json());
  const g = L.layerGroup();
  d.features.filter(f => f.properties.tsunami === 1).forEach(f => {
    const [lon, lat] = f.geometry.coordinates;
    emojiMarker(lat, lon, "🌊", `<b>🌊 Tsunami-flagged</b> M${(f.properties.mag ?? 0).toFixed(1)} — ${f.properties.place || "?"}`).addTo(g);
  });
  return { layer: g, count: g.getLayers().length };
}

const HAZARDS = [
  { key: "earthquakes", icon: "🔴", label: "Earthquakes", load: loadQuakes },
  { key: "volcanoes",   icon: "🌋", label: "Volcanoes",   load: () => loadEonet("volcanoes", 120, "🌋") },
  { key: "fires",       icon: "🔥", label: "Fires",       load: () => loadEonet("wildfires", 30, "🔥") },
  { key: "cyclones",    icon: "🌀", label: "Cyclones",    load: () => loadGdacs("TC", "🌀") },
  { key: "floods",      icon: "💧", label: "Floods",      load: () => loadGdacs("FL", "💧") },
  { key: "tsunami",     icon: "🌊", label: "Tsunami",     load: loadTsunami },
  { key: "seaice",      icon: "🧊", label: "Sea ice",     load: () => loadEonet("seaLakeIce", 365, "🧊") },
];
const hazardLayers = {};
const loadHaz = () => { try { const s = JSON.parse(localStorage.getItem("ba_haz_v2")); if (Array.isArray(s)) return s; } catch (e) {} return HAZARDS.map(h => h.key); };
const hazardOn = new Set(loadHaz());
const saveHaz = () => localStorage.setItem("ba_haz_v2", JSON.stringify([...hazardOn]));

const HazControl = L.control({ position: "topright" });
HazControl.onAdd = () => {
  const div = L.DomUtil.create("div", "haz-control");
  div.innerHTML = `<div class="haz-title">🌍 Earth activity <span class="haz-live">live</span></div>`;
  HAZARDS.forEach(h => {
    const row = L.DomUtil.create("label", "haz-row", div);
    row.innerHTML = `<input type="checkbox" ${hazardOn.has(h.key) ? "checked" : ""}> <span>${h.icon} ${h.label}</span> <span class="haz-count" id="hz-${h.key}">…</span>`;
    row.querySelector("input").addEventListener("change", e => toggleHazard(h.key, e.target.checked));
  });
  const foot = L.DomUtil.create("div", "haz-foot", div);
  foot.textContent = "USGS · NASA EONET · GDACS";
  L.DomEvent.disableClickPropagation(div);
  return div;
};
HazControl.addTo(map);

function toggleHazard(key, on) {
  on ? hazardOn.add(key) : hazardOn.delete(key);
  saveHaz();
  const layer = hazardLayers[key];
  if (layer) on ? layer.addTo(map) : map.removeLayer(layer);
}

HAZARDS.forEach(async h => {
  const el = () => document.getElementById(`hz-${h.key}`);
  try {
    const { layer, count } = await h.load();
    hazardLayers[h.key] = layer;
    if (el()) el().textContent = count;
    if (hazardOn.has(h.key)) layer.addTo(map);
  } catch (err) {
    if (el()) el().textContent = "—";
    console.warn("earth-activity feed failed:", h.key, err);
  }
});

// Resize all hazard markers inversely to zoom (emoji via setIcon, quakes via radius).
function updateHazardSizes() {
  const size = hazSize(), scale = size / 16;
  Object.values(hazardLayers).forEach(layer => layer && layer.eachLayer(m => {
    if (m._emoji) m.setIcon(hzIcon(m._emoji, size));
    else if (m._baseR != null) m.setRadius(m._baseR * scale);
  }));
}
map.on("zoomend", updateHazardSizes);
