/**
 * Lazy-load chart/map CDN assets (Fase 2 — critical rendering path).
 * Libraries are fetched on demand per tab, not on initial HTML parse.
 */
(function () {
  const LIB = {
    chartJs: "https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js",
    echarts: "https://cdn.jsdelivr.net/npm/echarts@5.6.0/dist/echarts.min.js",
    maplibreJs: "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js",
    maplibreCss: "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css",
  };

  const scriptPending = new Map();
  const stylesheetPending = new Map();

  function loadScript(src) {
    if (scriptPending.has(src)) return scriptPending.get(src);
    const promise = new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) {
        resolve();
        return;
      }
      const el = document.createElement("script");
      el.src = src;
      el.defer = true;
      el.onload = () => resolve();
      el.onerror = () => reject(new Error(`Gagal memuat script: ${src}`));
      document.head.appendChild(el);
    });
    scriptPending.set(src, promise);
    return promise;
  }

  function loadStylesheet(href) {
    if (stylesheetPending.has(href)) return stylesheetPending.get(href);
    const promise = new Promise((resolve, reject) => {
      if (document.querySelector(`link[rel="stylesheet"][href="${href}"]`)) {
        resolve();
        return;
      }
      const el = document.createElement("link");
      el.rel = "stylesheet";
      el.href = href;
      el.onload = () => resolve();
      el.onerror = () => reject(new Error(`Gagal memuat stylesheet: ${href}`));
      document.head.appendChild(el);
    });
    stylesheetPending.set(href, promise);
    return promise;
  }

  let chartJsReady;
  let echartsReady;
  let maplibreReady;
  let overviewReady;

  function ensureChartJs() {
    if (!chartJsReady) chartJsReady = loadScript(LIB.chartJs);
    return chartJsReady;
  }

  function ensureEcharts() {
    if (!echartsReady) echartsReady = loadScript(LIB.echarts);
    return echartsReady;
  }

  function ensureMaplibre() {
    if (!maplibreReady) {
      maplibreReady = loadStylesheet(LIB.maplibreCss).then(() => loadScript(LIB.maplibreJs));
    }
    return maplibreReady;
  }

  function ensureOverviewLibs() {
    if (!overviewReady) {
      overviewReady = Promise.all([ensureEcharts(), ensureChartJs()]);
    }
    return overviewReady;
  }

  window.DOMPENG_LOAD = {
    ensureChartJs,
    ensureEcharts,
    ensureMaplibre,
    ensureOverviewLibs,
  };
})();
