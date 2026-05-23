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
/** Fokus default: kepulauan Indonesia (bukan dunia penuh). */
const MAP_CENTER = [117.5, -2.2];
const MAP_ZOOM = 4.6;
/** [barat, selatan] — [timur, utara] — batas kasar wilayah Indonesia. */
const INDONESIA_BOUNDS = [
  [94.5, -11.5],
  [141.5, 6.5],
];
const INDONESIA_MAX_BOUNDS = [
  [88, -13.5],
  [146, 8.5],
];
const INDONESIA_FIT_MAX_ZOOM = 5.25;
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

/** Kota dengan koordinat lookup sama digabung jadi satu titik (jumlah entitas dijumlahkan). */
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

/** Radius bubble from jumlah entitas (merged sum atau count kota). */
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
const BUBBLE_OPACITY = 0.9;

const featureActive = ["boolean", ["feature-state", "active"], false];

const circleRadiusHover = [
  "case",
  featureActive,
  ["*", circleRadiusExpr, 1.08],
  circleRadiusExpr,
];

const circleOpacityPaint = ["case", featureActive, 1, BUBBLE_OPACITY];

const circleStrokeWidthMerged = ["case", featureActive, 2.5, 2];

const circleStrokeWidthPoint = ["case", featureActive, 2, 1.5];

const circleStrokeColorHover = [
  "case",
  featureActive,
  "rgba(232, 240, 248, 0.95)",
  "rgba(0, 212, 170, 0.88)",
];

const circleBlurPaint = (idle) => ["case", featureActive, 0.18, idle];

const haloRadiusExpr = ["*", circleRadiusExpr, 1.18];

const haloOpacityExpr = ["case", featureActive, 0.38, 0];

function indonesiaLngLatBounds() {
  return new maplibregl.LngLatBounds(INDONESIA_BOUNDS[0], INDONESIA_BOUNDS[1]);
}

/**
 * Pastikan viewport mencakup seluruh Indonesia; perluas dengan titik cluster bila ada.
 */
function fitMapToIndonesiaFocus(map, clusters, { animate = true, padding = 48 } = {}) {
  if (!map) return;
  const bounds = indonesiaLngLatBounds();
  for (const city of clusters || []) {
    const lng = Number(city.lng);
    const lat = Number(city.lat);
    if (Number.isFinite(lng) && Number.isFinite(lat)) {
      bounds.extend([lng, lat]);
    }
  }
  const pad =
    typeof padding === "number"
      ? { top: padding, bottom: padding, left: padding, right: padding }
      : padding;
  const duration = animate && !prefersReducedMotion() ? 850 : 0;
  map.fitBounds(bounds, {
    padding: pad,
    maxZoom: INDONESIA_FIT_MAX_ZOOM,
    duration,
  });
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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
        `<div class="geo-popup-count">${fmt(h.people)} entitas · ${fmt(h.cityCount)} kota</div>`,
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
            `<span class="geo-popup-item-text"><strong>${escapeHtml(city.label)}</strong>${prov} · ${fmt(city.count)} entitas</span>` +
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
        `<div class="geo-popup-count">${fmt(h.people)} entitas · ${fmt(h.mergedCities.length)} kota di titik sama</div>`,
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
      `<div class="geo-popup-count">${fmt(h.people)} entitas</div>`,
    ].join("");
  }

  const rows = hits
    .map((h) => {
      if (h.isMerged) {
        return (
          `<li class="geo-popup-item">` +
          `<span class="geo-dot" style="background:${h.color}"></span>` +
          `<span class="geo-popup-item-text"><strong>Cluster</strong> · ${fmt(h.people)} entitas · ${fmt(h.cityCount)} kota</span>` +
          `</li>`
        );
      }
      const prov = h.province ? ` · ${escapeHtml(h.province)}` : "";
      return (
        `<li class="geo-popup-item">` +
        `<span class="geo-dot" style="background:${h.color}"></span>` +
        `<span class="geo-popup-item-text"><strong>${escapeHtml(h.label)}</strong>${prov} · ${fmt(h.people)} entitas</span>` +
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

function featureActiveId(hit) {
  if (!hit) return null;
  const id = hit.isMerged ? hit.clusterId : hit.key;
  return id == null || id === "" ? null : id;
}

function clearBubbleHover(map, sourceId) {
  const prev = map._dompengHoverState;
  if (!prev) return;
  if (map._dompengClickPinned?.id === prev.id) {
    map._dompengHoverState = null;
    return;
  }
  try {
    map.removeFeatureState({ source: sourceId, id: prev.id });
  } catch {
    /* feature may have clustered away */
  }
  map._dompengHoverState = null;
}

function clearClickPin(map, sourceId) {
  const pinned = map._dompengClickPinned;
  if (!pinned) return;
  try {
    map.removeFeatureState({ source: sourceId, id: pinned.id });
  } catch {
    /* feature may have clustered away */
  }
  map._dompengClickPinned = null;
}

function pinClickFeature(map, sourceId, hit) {
  const id = featureActiveId(hit);
  if (id == null) return;
  clearClickPin(map, sourceId);
  clearBubbleHover(map, sourceId);
  try {
    map.setFeatureState({ source: sourceId, id }, { active: true });
    map._dompengClickPinned = { id };
  } catch {
    /* ignore stale cluster ids */
  }
}

function applyBubbleHover(map, sourceId, hit) {
  if (map._dompengClickPinned) return;

  if (!hit) {
    clearBubbleHover(map, sourceId);
    return;
  }

  const id = featureActiveId(hit);
  if (id == null) return;

  const prev = map._dompengHoverState;
  if (prev?.id === id) return;

  clearBubbleHover(map, sourceId);

  try {
    map.setFeatureState({ source: sourceId, id }, { active: true });
    map._dompengHoverState = { id };
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

  clickPopup.on("close", () => {
    clearClickPin(map, sourceId);
  });

  let hoverRaf = 0;

  map.on("mousemove", (event) => {
    if (hoverRaf) return;
    hoverRaf = requestAnimationFrame(() => {
      hoverRaf = 0;
      const hits = queryHitsAt(map, event.point);
      if (clickPopup.isOpen()) {
        hoverPopup.remove();
        map.getCanvas().style.cursor = hits.length ? "pointer" : "";
        clearBubbleHover(map, sourceId);
        return;
      }
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
    hoverPopup.remove();
    const hits = queryHitsAt(map, event.point);
    if (!hits.length) {
      clickPopup.remove();
      clearClickPin(map, sourceId);
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
      clearClickPin(map, sourceId);
      return;
    }

    pinClickFeature(map, sourceId, hits[0]);
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
    maxBounds: INDONESIA_MAX_BOUNDS,
    attributionControl: true,
    cooperativeGestures: false,
  });

  map._dompengClusters = clusters;

  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

  map.on("load", () => {
    map.addSource("city-clusters", {
      type: "geojson",
      data: clustersToGeoJson(clusters),
      promoteId: "key",
      cluster: true,
      clusterMaxZoom: CLUSTER_MAX_ZOOM,
      clusterRadius: CLUSTER_RADIUS,
      // Gabungkan jumlah entitas saat cluster merge (bukan hanya hitung titik).
      clusterProperties: {
        people_sum: ["+", ["get", "count"]],
      },
    });

    map.addLayer({
      id: "city-clusters-halo",
      type: "circle",
      source: "city-clusters",
      filter: ["has", "point_count"],
      paint: {
        "circle-color": "rgba(0, 212, 170, 0.55)",
        "circle-radius": haloRadiusExpr,
        "circle-opacity": haloOpacityExpr,
        "circle-blur": 0.35,
        "circle-stroke-width": 0,
      },
    });

    map.addLayer({
      id: "city-clusters-merged",
      type: "circle",
      source: "city-clusters",
      filter: ["has", "point_count"],
      paint: {
        "circle-color": circleColorExpr,
        "circle-radius": circleRadiusHover,
        "circle-stroke-width": circleStrokeWidthMerged,
        "circle-stroke-color": circleStrokeColorHover,
        "circle-opacity": circleOpacityPaint,
        "circle-blur": circleBlurPaint(0.1),
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
      id: "city-points-halo",
      type: "circle",
      source: "city-clusters",
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-color": "rgba(78, 201, 255, 0.5)",
        "circle-radius": haloRadiusExpr,
        "circle-opacity": haloOpacityExpr,
        "circle-blur": 0.3,
        "circle-stroke-width": 0,
      },
    });

    map.addLayer({
      id: "city-points",
      type: "circle",
      source: "city-clusters",
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-color": circleColorExpr,
        "circle-radius": circleRadiusHover,
        "circle-stroke-width": circleStrokeWidthPoint,
        "circle-stroke-color": circleStrokeColorHover,
        "circle-opacity": circleOpacityPaint,
        "circle-blur": circleBlurPaint(0.06),
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

    if (options.fitBounds !== false) {
      fitMapToIndonesiaFocus(map, clusters, {
        animate: !options.skipFitAnimation,
        padding: { top: 44, bottom: 64, left: 44, right: 44 },
      });
    }
  });

  window.DOMPENG_MAP = map;
  return map;
}

function initDompengGeoMap(geo, options = {}) {
  const containerId = options.containerId || "geo-map";
  const statsId = options.statsId || "geo-map-stats";
  const container = document.getElementById(containerId);
  if (!container) return null;
  if (typeof maplibregl === "undefined") {
    container.classList.add("geo-map--empty");
    container.textContent = "Peta interaktif belum tersedia karena library MapLibre gagal dimuat. Ringkasan kota tetap tersedia di tab Ringkasan.";
    return null;
  }

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

function fitDompengMapToIndonesia(options = {}) {
  const map = window.DOMPENG_MAP;
  if (!map) return;
  fitMapToIndonesiaFocus(map, map._dompengClusters || [], options);
}

function focusDompengMapCity(cityKeyOrLabel) {
  const map = window.DOMPENG_MAP;
  if (!map) return false;
  const key = String(cityKeyOrLabel || "").toUpperCase();
  const city = (map._dompengClusters || []).find((item) => {
    return (
      String(item.key || "").toUpperCase() === key ||
      String(item.label || "").toUpperCase() === key ||
      (item.mergedCities || []).some((merged) => String(merged.label || "").toUpperCase() === key)
    );
  });
  if (!city) return false;

  const coordinates = [Number(city.lng), Number(city.lat)];
  if (!Number.isFinite(coordinates[0]) || !Number.isFinite(coordinates[1])) return false;

  map.easeTo({
    center: coordinates,
    zoom: Math.max(map.getZoom(), 7),
    duration: prefersReducedMotion() ? 0 : 520,
  });

  const popupCity = {
    isMerged: false,
    key: city.key,
    label: city.label || "Kota",
    province: city.province || "",
    people: city.count || 0,
    cityCount: city.mergedCount || 1,
    mergedCities: city.mergedCities || [],
    color: tierColor(city.count || 0),
    coordinates,
  };

  new maplibregl.Popup({
    closeButton: true,
    closeOnClick: true,
    maxWidth: "300px",
    className: "geo-popup",
    offset: 12,
  })
    .setLngLat(coordinates)
    .setHTML(buildPopupHtml([popupCity], { hint: "Dipilih dari ringkasan kota" }))
    .addTo(map);
  return true;
}

window.initDompengGeoMap = initDompengGeoMap;
window.fitDompengMapToIndonesia = fitDompengMapToIndonesia;
window.focusDompengMapCity = focusDompengMapCity;
