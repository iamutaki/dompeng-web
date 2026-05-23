/**
 * Basemap: CARTO Dark Matter (CDN global, tanpa API key, kuota lebih longgar untuk traffic publik).
 * Alternatif: set window.DOMPENG_MAP_STYLE sebelum map.js dimuat.
 * @see https://carto.com/attributions/
 */
const MAP_STYLE_DEFAULT =
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const MAP_STYLE = window.DOMPENG_MAP_STYLE || MAP_STYLE_DEFAULT;
/** Font stacks yang tersedia di tiles.basemaps.cartocdn.com (Open Sans Bold ≠ 404). */
const MAP_LABEL_FONT = ["Montserrat Bold", "Open Sans Bold"];
const MAP_CENTER = [118.0, -2.5];
const MAP_ZOOM = 4.2;
const CLUSTER_MAX_ZOOM = 12;
const CLUSTER_RADIUS = 72;
const COORD_PRECISION = 4;

function fmt(n) {
  return Number(n).toLocaleString("en-US");
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function clustersToGeoJson(clusters) {
  return {
    type: "FeatureCollection",
    features: (clusters || []).map((city) => ({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [city.lng, city.lat],
      },
      properties: {
        key: city.key,
        label: city.label,
        province: city.province || "",
        count: city.count,
        mergedCount: city.mergedCount || 1,
        mergedCities: city.mergedCities ? JSON.stringify(city.mergedCities) : "",
      },
    })),
  };
}

/** Kota dengan koordinat lookup sama digabung jadi satu titik (jumlah orang dijumlahkan). */
function mergeCollocatedCities(clusters, precision = COORD_PRECISION) {
  const groups = new Map();

  for (const city of clusters || []) {
    const lng = Number(city.lng);
    const lat = Number(city.lat);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;

    const key = `${lng.toFixed(precision)},${lat.toFixed(precision)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(city);
  }

  const merged = [];
  for (const cities of groups.values()) {
    cities.sort((a, b) => (b.count || 0) - (a.count || 0));
    const top = cities[0];
    if (cities.length === 1) {
      merged.push(top);
      continue;
    }

    merged.push({
      ...top,
      key: `coord:${top.lng},${top.lat}`,
      label: top.label,
      count: cities.reduce((sum, c) => sum + (c.count || 0), 0),
      mergedCount: cities.length,
      mergedCities: cities.map((c) => ({
        label: c.label,
        count: c.count,
        province: c.province || null,
      })),
    });
  }

  return merged.sort((a, b) => (b.count || 0) - (a.count || 0));
}

function renderGeoMapStats(container, geo) {
  if (!container || !geo) return;
  container.replaceChildren();

  const items = [
    ["Kota di peta", geo.mappedCities],
    ["Orang terpetakan", geo.geocodedEntities],
    ["Punya data kota", geo.entitiesWithCity],
    ["Kota berbeda", geo.uniqueCities],
  ];

  for (const [label, value] of items) {
    const chip = document.createElement("div");
    chip.className = "inline-stat inline-stat--geo";

    const v = document.createElement("strong");
    v.className = "inline-stat-value";
    v.textContent = fmt(value ?? 0);

    const k = document.createElement("span");
    k.className = "inline-stat-label";
    k.textContent = label;

    chip.append(v, k);
    container.appendChild(chip);
  }
}

/** Radius bubble from jumlah orang (merged sum atau count kota). */
const circleRadiusExpr = [
  "interpolate",
  ["linear"],
  ["coalesce", ["get", "people_sum"], ["get", "count"], 1],
  1, 14,
  10, 18,
  50, 26,
  100, 34,
  200, 42,
  500, 52,
];

const circleColorExpr = [
  "interpolate",
  ["linear"],
  ["coalesce", ["get", "people_sum"], ["get", "count"], 1],
  1, "rgba(0, 212, 170, 0.38)",
  10, "rgba(78, 201, 255, 0.48)",
  50, "rgba(230, 168, 23, 0.58)",
  100, "rgba(255, 92, 92, 0.68)",
];

const countLabelExpr = [
  "to-string",
  ["coalesce", ["get", "people_sum"], ["get", "count"], 0],
];

const QUERY_LAYERS = ["city-clusters-merged", "city-points"];
const QUERY_RADIUS = 14;
const BUBBLE_CIRCLE_LAYERS = ["city-clusters-merged", "city-points"];
const BUBBLE_ENTRY_MS = 900;
/** Satu siklus: bleep · bleep · bleep · jeda */
const SIGNAL_CYCLE_MS = 3200;
const SIGNAL_BLEEP_MS = 200;
const SIGNAL_GAP_MS = 130;
const SIGNAL_BEEPS = 3;

const circleOpacityBase = [
  "case",
  ["boolean", ["feature-state", "active"], false],
  1,
  0.9,
];

/** Radius + bleep hanya pada titik dengan feature-state `active` (satu hover). */
const circleRadiusActive = [
  "case",
  ["boolean", ["feature-state", "active"], false],
  ["*", circleRadiusExpr, ["coalesce", ["feature-state", "scale"], 1.18]],
  circleRadiusExpr,
];

const signalRingOpacity = [
  "case",
  ["boolean", ["feature-state", "active"], false],
  ["*", ["coalesce", ["feature-state", "ping"], 0], 0.24],
  0,
];

const signalRingStrokeOpacity = [
  "case",
  ["boolean", ["feature-state", "active"], false],
  ["*", ["coalesce", ["feature-state", "ping"], 0], 0.92],
  0,
];

const signalRingRadius = [
  "case",
  ["boolean", ["feature-state", "active"], false],
  [
    "*",
    circleRadiusExpr,
    ["+", 1, ["*", 0.48, ["coalesce", ["feature-state", "ping"], 0]]],
  ],
  circleRadiusExpr,
];

const signalRingStrokeWidth = [
  "case",
  ["boolean", ["feature-state", "active"], false],
  ["+", 1, ["*", 3.2, ["coalesce", ["feature-state", "ping"], 0]]],
  0,
];

const signalRingBlur = [
  "case",
  ["boolean", ["feature-state", "active"], false],
  ["+", 0.15, ["*", 0.35, ["coalesce", ["feature-state", "ping"], 0]]],
  0,
];

const circleStrokeWidthMerged = [
  "case",
  ["boolean", ["feature-state", "active"], false],
  3.5,
  2,
];

const circleStrokeWidthPoint = [
  "case",
  ["boolean", ["feature-state", "active"], false],
  2.75,
  1.5,
];

const circleStrokeColorHover = [
  "case",
  ["boolean", ["feature-state", "active"], false],
  "rgba(232, 240, 248, 0.95)",
  "rgba(0, 212, 170, 0.9)",
];

const circleBlurActive = (idle) => [
  "case",
  ["boolean", ["feature-state", "active"], false],
  0.35,
  idle,
];

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

/** Envelope satu bleep: naik cepat, turun eksponensial (radar ping). */
function bleepEnvelope(u) {
  if (u <= 0 || u >= 1) return 0;
  if (u < 0.14) return easeOutCubic(u / 0.14);
  return Math.exp(-((u - 0.14) / 0.86) * 5.2);
}

/**
 * Tiga bleep berurutan lalu jeda — pola sinyal radar.
 * @returns {number} 0..1
 */
function signalBleepStrength(elapsedMs, opts = {}) {
  const {
    cycleMs = SIGNAL_CYCLE_MS,
    bleepMs = SIGNAL_BLEEP_MS,
    gapMs = SIGNAL_GAP_MS,
    bleeps = SIGNAL_BEEPS,
  } = opts;
  const t = elapsedMs % cycleMs;
  let peak = 0;
  for (let i = 0; i < bleeps; i++) {
    const start = i * (bleepMs + gapMs);
    const local = t - start;
    if (local >= 0 && local < bleepMs) {
      peak = Math.max(peak, bleepEnvelope(local / bleepMs));
    }
  }
  return peak;
}

function stopBubbleMotion(map) {
  if (map._dompengBubbleAnim) {
    cancelAnimationFrame(map._dompengBubbleAnim);
    map._dompengBubbleAnim = 0;
  }
}

function resetBubbleOpacityPaint(map) {
  for (const layerId of BUBBLE_CIRCLE_LAYERS) {
    if (!map.getLayer(layerId)) continue;
    map.setPaintProperty(layerId, "circle-opacity", circleOpacityBase);
  }
}

/** Update bleep pada satu titik aktif (hover). */
function updateActiveSignalPulse(map, sourceId) {
  const target = map._dompengHoverState;
  if (!target) return;

  const elapsed = performance.now() - target.signalStartedAt;
  const ping = signalBleepStrength(elapsed, {
    cycleMs: 1200,
    bleepMs: 150,
    gapMs: 70,
    bleeps: 3,
  });
  const scale = 1.1 + ping * 0.32;

  try {
    map.setFeatureState(
      { source: sourceId, id: target.id },
      { active: true, ping, scale },
    );
  } catch {
    map._dompengHoverState = null;
  }
}

/** Fade-in awal, lalu opacity per-feature (hover) + pulse radius pada titik aktif. */
function startBubbleMotion(map, sourceId) {
  stopBubbleMotion(map);
  if (prefersReducedMotion()) {
    resetBubbleOpacityPaint(map);
    return;
  }

  const start = performance.now();
  let entryDone = false;

  const tick = (now) => {
    if (!map.getLayer("city-clusters-merged")) {
      stopBubbleMotion(map);
      return;
    }

    const elapsed = now - start;
    const entryT = Math.min(1, elapsed / BUBBLE_ENTRY_MS);

    if (!entryDone) {
      const entry = easeOutCubic(entryT);
      const opacity = Math.min(0.96, 0.06 + entry * 0.86);
      for (const layerId of BUBBLE_CIRCLE_LAYERS) {
        if (!map.getLayer(layerId)) continue;
        map.setPaintProperty(layerId, "circle-opacity", opacity);
      }
      if (entryT >= 1) {
        entryDone = true;
        resetBubbleOpacityPaint(map);
      }
    } else if (map._dompengHoverState) {
      updateActiveSignalPulse(map, sourceId);
    }

    map._dompengBubbleAnim = requestAnimationFrame(tick);
  };

  map._dompengBubbleAnim = requestAnimationFrame(tick);
  map.once("remove", () => stopBubbleMotion(map));
}

function peopleFromProps(props) {
  if (props.point_count != null) {
    return Number(props.people_sum) || Number(props.point_count) || 0;
  }
  return Number(props.count) || 0;
}

function tierColor(count) {
  if (count >= 100) return "#ff5c5c";
  if (count >= 50) return "#e6a817";
  if (count >= 10) return "#4ec9ff";
  return "#00d4aa";
}

function parseMergedCities(props) {
  if (!props.mergedCities) return [];
  try {
    const parsed = JSON.parse(props.mergedCities);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeHit(feature) {
  const props = feature.properties || {};
  const isMerged = props.point_count != null;
  const people = peopleFromProps(props);
  const mergedCities = parseMergedCities(props);
  return {
    isMerged,
    clusterId: props.cluster_id,
    key: props.key || "",
    label: isMerged ? null : props.label || "Kota",
    province: props.province || "",
    people,
    cityCount: isMerged ? Number(props.point_count) || 0 : Number(props.mergedCount) || 1,
    mergedCities,
    color: tierColor(people),
    coordinates: feature.geometry.coordinates,
  };
}

function queryHitsAt(map, point) {
  const box = [
    [point.x - QUERY_RADIUS, point.y - QUERY_RADIUS],
    [point.x + QUERY_RADIUS, point.y + QUERY_RADIUS],
  ];
  const layers = QUERY_LAYERS.filter((id) => map.getLayer(id));
  const raw = map.queryRenderedFeatures(box, { layers });
  const seen = new Set();
  const hits = [];

  for (const feature of raw) {
    const hit = normalizeHit(feature);
    const dedupeKey = hit.isMerged
      ? `m:${hit.clusterId}`
      : `c:${hit.key || hit.label}:${hit.people}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    hits.push(hit);
  }

  return hits.sort((a, b) => b.people - a.people);
}

function buildPopupHtml(hits, { hint } = {}) {
  if (!hits.length) return "";

  if (hits.length === 1) {
    const h = hits[0];
    if (h.isMerged) {
      return [
        '<div class="geo-popup-head">',
        `<span class="geo-dot" style="background:${h.color}"></span>`,
        "<span>Cluster gabungan</span>",
        "</div>",
        `<div class="geo-popup-count">${fmt(h.people)} orang · ${fmt(h.cityCount)} kota</div>`,
        hint ? `<div class="geo-popup-hint">${hint}</div>` : "",
      ].join("");
    }
    if (h.mergedCities?.length > 1) {
      const rows = h.mergedCities
        .slice(0, 12)
        .map((city) => {
          const prov = city.province ? ` · ${escapeHtml(city.province)}` : "";
          return (
            `<li class="geo-popup-item">` +
            `<span class="geo-dot" style="background:${tierColor(city.count)}"></span>` +
            `<span class="geo-popup-item-text"><strong>${escapeHtml(city.label)}</strong>${prov} · ${fmt(city.count)} orang</span>` +
            `</li>`
          );
        })
        .join("");
      const more =
        h.mergedCities.length > 12
          ? `<div class="geo-popup-hint">+${h.mergedCities.length - 12} kota lainnya</div>`
          : "";
      return [
        '<div class="geo-popup-head">',
        `<span class="geo-dot" style="background:${h.color}"></span>`,
        `<span class="geo-popup-title">${escapeHtml(h.label)}</span>`,
        "</div>",
        `<div class="geo-popup-count">${fmt(h.people)} orang · ${fmt(h.mergedCities.length)} kota di titik sama</div>`,
        `<ul class="geo-popup-list">${rows}</ul>`,
        more,
      ].join("");
    }
    const prov = h.province
      ? `<div class="geo-popup-prov">${escapeHtml(h.province)}</div>`
      : "";
    return [
      '<div class="geo-popup-head">',
      `<span class="geo-dot" style="background:${h.color}"></span>`,
      `<span class="geo-popup-title">${escapeHtml(h.label)}</span>`,
      "</div>",
      prov,
      `<div class="geo-popup-count">${fmt(h.people)} orang</div>`,
    ].join("");
  }

  const rows = hits
    .map((h) => {
      if (h.isMerged) {
        return (
          `<li class="geo-popup-item">` +
          `<span class="geo-dot" style="background:${h.color}"></span>` +
          `<span class="geo-popup-item-text"><strong>Cluster</strong> · ${fmt(h.people)} orang · ${fmt(h.cityCount)} kota</span>` +
          `</li>`
        );
      }
      const prov = h.province ? ` · ${escapeHtml(h.province)}` : "";
      return (
        `<li class="geo-popup-item">` +
        `<span class="geo-dot" style="background:${h.color}"></span>` +
        `<span class="geo-popup-item-text"><strong>${escapeHtml(h.label)}</strong>${prov} · ${fmt(h.people)} orang</span>` +
        `</li>`
      );
    })
    .join("");

  return [
    `<div class="geo-popup-list-title">${hits.length} cluster di area ini</div>`,
    `<ul class="geo-popup-list">${rows}</ul>`,
    hint ? `<div class="geo-popup-hint">${hint}</div>` : "",
  ].join("");
}

function clearBubbleHover(map, sourceId) {
  const prev = map._dompengHoverState;
  if (!prev) return;
  try {
    map.removeFeatureState({ source: sourceId, id: prev.id });
  } catch {
    /* feature may have clustered away */
  }
  map._dompengHoverState = null;
}

function applyBubbleHover(map, sourceId, hit) {
  if (!hit) {
    clearBubbleHover(map, sourceId);
    return;
  }

  const id = hit.isMerged ? hit.clusterId : hit.key;
  if (id == null || id === "") return;

  const prev = map._dompengHoverState;
  if (prev?.id === id) return;

  clearBubbleHover(map, sourceId);

  try {
    map.setFeatureState({ source: sourceId, id }, { active: true, ping: 0, scale: 1.1 });
    map._dompengHoverState = { id, signalStartedAt: performance.now() };
  } catch {
    /* ignore stale cluster ids */
  }
}

function bindClusterInteractions(map, sourceId) {
  const hoverPopup = new maplibregl.Popup({
    closeButton: false,
    closeOnClick: false,
    maxWidth: "280px",
    className: "geo-popup geo-popup--hover",
    offset: 12,
  });

  const clickPopup = new maplibregl.Popup({
    closeButton: true,
    closeOnClick: true,
    maxWidth: "300px",
    className: "geo-popup",
    offset: 12,
  });

  let hoverRaf = 0;

  map.on("mousemove", (event) => {
    if (hoverRaf) return;
    hoverRaf = requestAnimationFrame(() => {
      hoverRaf = 0;
      const hits = queryHitsAt(map, event.point);
      if (!hits.length) {
        map.getCanvas().style.cursor = "";
        hoverPopup.remove();
        clearBubbleHover(map, sourceId);
        return;
      }
      map.getCanvas().style.cursor = "pointer";
      applyBubbleHover(map, sourceId, hits[0]);
      const hint =
        hits.length === 1 && hits[0].isMerged
          ? "Klik untuk memperbesar"
          : hits.length > 1
            ? "Beberapa titik bertumpuk — arahkan kursor untuk detail"
            : hits[0].mergedCities?.length > 1
              ? "Beberapa kota berbagi koordinat — lihat daftar di bawah"
              : "";
      hoverPopup
        .setLngLat(hits[0].coordinates)
        .setHTML(buildPopupHtml(hits, { hint }))
        .addTo(map);
    });
  });

  map.on("mouseleave", () => {
    map.getCanvas().style.cursor = "";
    hoverPopup.remove();
    clearBubbleHover(map, sourceId);
  });

  map.on("click", (event) => {
    const hits = queryHitsAt(map, event.point);
    if (!hits.length) {
      clickPopup.remove();
      return;
    }

    if (hits.length === 1 && hits[0].isMerged) {
      const { clusterId, coordinates } = hits[0];
      const source = map.getSource(sourceId);
      source.getClusterExpansionZoom(clusterId, (err, zoom) => {
        if (err) return;
        map.easeTo({
          center: coordinates,
          zoom: Math.min(zoom + 0.5, CLUSTER_MAX_ZOOM + 2),
          duration: 450,
        });
      });
      clickPopup.remove();
      return;
    }

    clickPopup
      .setLngLat(hits[0].coordinates)
      .setHTML(
        buildPopupHtml(hits, {
          hint: hits.some((h) => h.isMerged) ? "Klik cluster tunggal untuk memperbesar" : "",
        }),
      )
      .addTo(map);
  });
}

function buildGeoMap(container, geo, options = {}) {
  const clusters = mergeCollocatedCities(geo.clusters || []);
  const map = new maplibregl.Map({
    container,
    style: MAP_STYLE,
    center: MAP_CENTER,
    zoom: MAP_ZOOM,
    attributionControl: true,
    cooperativeGestures: false,
  });

  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

  map.on("load", () => {
    map.addSource("city-clusters", {
      type: "geojson",
      data: clustersToGeoJson(clusters),
      promoteId: "key",
      cluster: true,
      clusterMaxZoom: CLUSTER_MAX_ZOOM,
      clusterRadius: CLUSTER_RADIUS,
      // Gabungkan jumlah orang saat cluster merge (bukan hanya hitung titik).
      clusterProperties: {
        people_sum: ["+", ["get", "count"]],
      },
    });

    const signalRingPaint = {
      "circle-color": "rgba(0, 212, 170, 0)",
      "circle-stroke-color": "rgba(0, 212, 170, 0.9)",
      "circle-radius": signalRingRadius,
      "circle-stroke-width": signalRingStrokeWidth,
      "circle-opacity": signalRingOpacity,
      "circle-stroke-opacity": signalRingStrokeOpacity,
      "circle-blur": signalRingBlur,
    };

    map.addLayer({
      id: "city-clusters-signal",
      type: "circle",
      source: "city-clusters",
      filter: ["has", "point_count"],
      paint: signalRingPaint,
    });

    // Cluster gabungan — zoom out
    map.addLayer({
      id: "city-clusters-merged",
      type: "circle",
      source: "city-clusters",
      filter: ["has", "point_count"],
      paint: {
        "circle-color": circleColorExpr,
        "circle-radius": circleRadiusActive,
        "circle-stroke-width": circleStrokeWidthMerged,
        "circle-stroke-color": circleStrokeColorHover,
        "circle-opacity": prefersReducedMotion() ? 0.92 : 0.05,
        "circle-blur": circleBlurActive(0.12),
      },
    });

    const clusterLabelLayout = {
      "text-field": countLabelExpr,
      "text-font": MAP_LABEL_FONT,
      "text-size": [
        "interpolate",
        ["linear"],
        ["coalesce", ["get", "people_sum"], ["get", "count"], 1],
        1, 11,
        50, 12,
        200, 14,
      ],
      "text-allow-overlap": true,
      "text-ignore-placement": true,
    };

    const clusterLabelPaint = {
      "text-color": "#e8f0f8",
      "text-halo-color": "rgba(8, 14, 22, 0.92)",
      "text-halo-width": 2,
    };

    map.addLayer({
      id: "city-clusters-merged-labels",
      type: "symbol",
      source: "city-clusters",
      filter: ["has", "point_count"],
      layout: clusterLabelLayout,
      paint: clusterLabelPaint,
    });

    map.addLayer({
      id: "city-points-signal",
      type: "circle",
      source: "city-clusters",
      filter: ["!", ["has", "point_count"]],
      paint: {
        ...signalRingPaint,
        "circle-stroke-color": "rgba(78, 201, 255, 0.88)",
      },
    });

    map.addLayer({
      id: "city-points",
      type: "circle",
      source: "city-clusters",
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-color": circleColorExpr,
        "circle-radius": circleRadiusActive,
        "circle-stroke-width": circleStrokeWidthPoint,
        "circle-stroke-color": circleStrokeColorHover,
        "circle-opacity": prefersReducedMotion() ? 0.92 : 0.05,
        "circle-blur": circleBlurActive(0.08),
      },
    });

    map.addLayer({
      id: "city-points-labels",
      type: "symbol",
      source: "city-clusters",
      filter: ["!", ["has", "point_count"]],
      layout: {
        ...clusterLabelLayout,
        "text-field": ["to-string", ["get", "count"]],
        "text-size": [
          "interpolate",
          ["linear"],
          ["get", "count"],
          1, 10,
          50, 12,
          200, 13,
        ],
      },
      paint: clusterLabelPaint,
    });

    bindClusterInteractions(map, "city-clusters");
    startBubbleMotion(map, "city-clusters");

    if (options.fitBounds !== false) {
      const bounds = new maplibregl.LngLatBounds();
      for (const city of clusters) {
        bounds.extend([city.lng, city.lat]);
      }
      const fitDuration = prefersReducedMotion() ? 0 : 1100;
      map.fitBounds(bounds, { padding: 48, maxZoom: 7, duration: fitDuration });
    }
  });

  window.DOMPENG_MAP = map;
  return map;
}

function initDompengGeoMap(geo, options = {}) {
  const containerId = options.containerId || "geo-map";
  const statsId = options.statsId || "geo-map-stats";
  const container = document.getElementById(containerId);
  if (!container || typeof maplibregl === "undefined") return null;

  const clusters = geo?.clusters || [];
  if (!clusters.length) {
    container.classList.add("geo-map--empty");
    container.textContent =
      "Belum ada cluster kota ter-geocode. Perluas id-city-coords.json lalu jalankan ./summary.sh.";
    return null;
  }

  renderGeoMapStats(document.getElementById(statsId), geo);
  const map = buildGeoMap(container, geo, options);
  window.DOMPENG_MAP = map;
  return map;
}

document.addEventListener("DOMContentLoaded", () => {
  if (window.DOMPENG_GEO) {
    initDompengGeoMap(window.DOMPENG_GEO);
  }
});

window.initDompengGeoMap = initDompengGeoMap;
