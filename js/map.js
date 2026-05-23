const MAP_STYLE = "https://tiles.openfreemap.org/styles/dark";
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
        return;
      }
      map.getCanvas().style.cursor = "pointer";
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
    cooperativeGestures: true,
  });

  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

  map.on("load", () => {
    map.addSource("city-clusters", {
      type: "geojson",
      data: clustersToGeoJson(clusters),
      cluster: true,
      clusterMaxZoom: CLUSTER_MAX_ZOOM,
      clusterRadius: CLUSTER_RADIUS,
      // Gabungkan jumlah orang saat cluster merge (bukan hanya hitung titik).
      clusterProperties: {
        people_sum: ["+", ["get", "count"]],
      },
    });

    // Cluster gabungan — zoom out
    map.addLayer({
      id: "city-clusters-merged",
      type: "circle",
      source: "city-clusters",
      filter: ["has", "point_count"],
      paint: {
        "circle-color": circleColorExpr,
        "circle-radius": circleRadiusExpr,
        "circle-stroke-width": 2,
        "circle-stroke-color": "rgba(0, 212, 170, 0.9)",
        "circle-opacity": 0.92,
      },
    });

    map.addLayer({
      id: "city-clusters-merged-labels",
      type: "symbol",
      source: "city-clusters",
      filter: ["has", "point_count"],
      layout: {
        "text-field": countLabelExpr,
        "text-font": ["Noto Sans Bold"],
        "text-size": 13,
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: {
        "text-color": "#e8f0f8",
        "text-halo-color": "rgba(8, 14, 22, 0.92)",
        "text-halo-width": 2,
      },
    });

    // Kota individual — memecah cluster saat zoom in (tanpa label; detail via hover/klik)
    map.addLayer({
      id: "city-points",
      type: "circle",
      source: "city-clusters",
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-color": circleColorExpr,
        "circle-radius": circleRadiusExpr,
        "circle-stroke-width": 1.5,
        "circle-stroke-color": "rgba(0, 212, 170, 0.85)",
      },
    });

    bindClusterInteractions(map, "city-clusters");

    if (options.fitBounds !== false) {
      const bounds = new maplibregl.LngLatBounds();
      for (const city of clusters) {
        bounds.extend([city.lng, city.lat]);
      }
      map.fitBounds(bounds, { padding: 48, maxZoom: 7, duration: 0 });
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
