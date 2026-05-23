const MAP_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const MAP_CENTER = [118.0, -2.5];
const MAP_ZOOM = 4.2;

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
      },
    })),
  };
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
    chip.className = "inline-stat";
    const k = document.createElement("span");
    k.className = "inline-stat-label";
    k.textContent = label;
    const v = document.createElement("span");
    v.className = "inline-stat-value";
    v.textContent = fmt(value ?? 0);
    chip.append(k, v);
    container.appendChild(chip);
  }
}

function buildGeoMap(container, geo, options = {}) {
  const clusters = geo.clusters || [];
  const map = new maplibregl.Map({
    container,
    style: MAP_STYLE,
    center: MAP_CENTER,
    zoom: MAP_ZOOM,
    attributionControl: true,
  });

  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

  map.on("load", () => {
    map.addSource("city-clusters", {
      type: "geojson",
      data: clustersToGeoJson(clusters),
    });

    map.addLayer({
      id: "cluster-circles",
      type: "circle",
      source: "city-clusters",
      paint: {
        "circle-color": [
          "interpolate",
          ["linear"],
          ["get", "count"],
          1, "rgba(0, 212, 170, 0.35)",
          10, "rgba(78, 201, 255, 0.45)",
          50, "rgba(230, 168, 23, 0.55)",
          100, "rgba(255, 92, 92, 0.65)",
        ],
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["get", "count"],
          1, 12,
          5, 16,
          20, 22,
          50, 28,
          100, 36,
          200, 44,
        ],
        "circle-stroke-width": 1.5,
        "circle-stroke-color": "rgba(0, 212, 170, 0.85)",
      },
    });

    map.addLayer({
      id: "cluster-labels",
      type: "symbol",
      source: "city-clusters",
      layout: {
        "text-field": ["to-string", ["get", "count"]],
        "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
        "text-size": 11,
        "text-allow-overlap": true,
      },
      paint: {
        "text-color": "#e8f0f8",
        "text-halo-color": "rgba(8, 14, 22, 0.9)",
        "text-halo-width": 1.2,
      },
    });

    const popup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: true,
      className: "geo-popup",
      offset: 12,
    });

    map.on("click", "cluster-circles", (event) => {
      const feature = event.features?.[0];
      if (!feature) return;
      const { label, province, count } = feature.properties;
      const provinceLine = province
        ? `<div class="geo-popup-prov">${escapeHtml(province)}</div>`
        : "";
      popup
        .setLngLat(feature.geometry.coordinates)
        .setHTML(
          `<div class="geo-popup-title">${escapeHtml(label)}</div>${provinceLine}<div class="geo-popup-count">${fmt(count)} entity</div>`,
        )
        .addTo(map);
    });

    map.on("mouseenter", "cluster-circles", () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "cluster-circles", () => {
      map.getCanvas().style.cursor = "";
    });

    if (options.fitBounds !== false) {
      const bounds = new maplibregl.LngLatBounds();
      for (const city of clusters) {
        bounds.extend([city.lng, city.lat]);
      }
      map.fitBounds(bounds, { padding: 48, maxZoom: 7, duration: 0 });
    }
  });

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
  return buildGeoMap(container, geo, options);
}

document.addEventListener("DOMContentLoaded", () => {
  if (window.DOMPENG_GEO) {
    initDompengGeoMap(window.DOMPENG_GEO);
  }
});

window.initDompengGeoMap = initDompengGeoMap;
