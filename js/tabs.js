const DASHBOARD_TABS = [
  { id: "overview", label: "Ringkasan", hash: "ringkasan" },
  { id: "geo", label: "Peta Kota", hash: "peta" },
  { id: "analytics", label: "Indeks", hash: "indeks" },
  { id: "ops", label: "Operasi", hash: "operasi" },
  { id: "preview", label: "Sampel", hash: "pratinjau" },
  { id: "data", label: "Data", hash: "data" },
];

window.DOMPENG_TABS = DASHBOARD_TABS;

const OPS_TAB_HASHES = new Set(["operasi", "ops", "pembaruan", "changelog", "sistem", "sys"]);
const DATA_TAB_HASHES = new Set(["data", "dat", "metodologi", "tentang"]);

function resizeDashboardCharts() {
  if (typeof window.resizeOverviewSankey === "function") {
    window.resizeOverviewSankey();
  }
  if (typeof window.resizeIndexTreemap === "function") {
    window.resizeIndexTreemap();
  }
}

function resizeGeoMap() {
  const detail = dashboardHashState().detail;
  if (typeof window.ensureDompengGeoMap === "function") {
    window.ensureDompengGeoMap({ focus: detail });
  }
  const map = window.DOMPENG_MAP;
  if (!map?.resize) return;
  const refit = () => {
    if (typeof window.fitDompengMapToIndonesia === "function") {
      window.fitDompengMapToIndonesia({ animate: false });
    }
  };
  window.requestAnimationFrame(() => {
    map.resize();
    refit();
    window.setTimeout(() => {
      map.resize();
      if (typeof window.fitDompengMapToIndonesia === "function") {
        window.fitDompengMapToIndonesia({ animate: true });
      }
    }, 160);
  });
}

function updateTabBarIndicator({ animate = true } = {}) {
  const bar = document.getElementById("tab-bar");
  const indicator = document.getElementById("tab-bar-indicator");
  if (!bar || !indicator) return;

  const active = bar.querySelector('.tab-btn[aria-selected="true"]');
  if (!active) {
    indicator.style.opacity = "0";
    return;
  }

  const move = () => {
    const barRect = bar.getBoundingClientRect();
    const rect = active.getBoundingClientRect();
    indicator.style.left = `${rect.left - barRect.left + bar.scrollLeft}px`;
    indicator.style.width = `${rect.width}px`;
    indicator.style.opacity = "1";
    bar.classList.add("tab-bar--ready");
  };

  if (!animate) {
    indicator.style.transition = "none";
    move();
    void indicator.offsetWidth;
    indicator.style.transition = "";
    return;
  }

  window.requestAnimationFrame(move);
}

function applyDashboardHashDetail(tabId, detail) {
  if (!detail || !window.dashboardDataCache) return;
  if (tabId === "analytics") {
    const search = document.getElementById("analytics-index-search");
    if (search) {
      search.value = detail;
      if (typeof window.refreshIndexViews === "function") {
        window.refreshIndexViews(window.dashboardDataCache);
      }
    }
    return;
  }
  if (tabId === "geo") {
    if (typeof window.setCityFilterQuery === "function") {
      window.setCityFilterQuery(detail);
      if (window.dashboardDataCache.geo && typeof window.refreshGeoCityViews === "function") {
        window.refreshGeoCityViews(window.dashboardDataCache.geo, { fitMapBounds: true });
      }
    }
  }
}

function onDashboardTabShown(tabId) {
  if (tabId === "geo") resizeGeoMap();
  if (tabId === "analytics" || tabId === "overview") {
    window.requestAnimationFrame(resizeDashboardCharts);
  }
  const hashState = typeof window.dashboardHashState === "function" ? window.dashboardHashState() : null;
  if (hashState?.id === tabId && hashState.detail) {
    applyDashboardHashDetail(tabId, hashState.detail);
  }
  if (tabId === "preview") {
    const detail = document.getElementById("preview-log-detail");
    if (detail) void detail.offsetHeight;
  }
}

function playPanelEnter(panel) {
  if (!panel) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  panel.classList.remove("is-entering");
  void panel.offsetWidth;
  panel.classList.add("is-entering");

  const onEnd = (event) => {
    if (event.target !== panel || event.animationName !== "motion-panel-in") return;
    panel.classList.remove("is-entering");
    panel.removeEventListener("animationend", onEnd);
  };
  panel.addEventListener("animationend", onEnd);
}

function markDashboardReady() {
  document.body.classList.add("dashboard-ready");
  updateTabBarIndicator({ animate: false });

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }
  const active = document.querySelector(".tab-panel.is-active");
  if (active) playPanelEnter(active);
}

function activateDashboardTab(tabId, { updateHash = true } = {}) {
  const tab = DASHBOARD_TABS.find((item) => item.id === tabId) || DASHBOARD_TABS[0];
  const buttons = document.querySelectorAll(".tab-btn");
  const panels = document.querySelectorAll(".tab-panel");

  for (const button of buttons) {
    const active = button.dataset.tab === tab.id;
    button.setAttribute("aria-selected", active ? "true" : "false");
    button.tabIndex = active ? 0 : -1;
  }

  for (const panel of panels) {
    const active = panel.dataset.tab === tab.id;
    panel.classList.toggle("is-active", active);
    panel.hidden = !active;
    if (active) playPanelEnter(panel);
  }

  if (updateHash) {
    const current = dashboardHashState();
    const detail = current.id === tab.id ? current.detail : "";
    const nextHash = detail ? `#${tab.hash}:${encodeURIComponent(detail)}` : `#${tab.hash}`;
    if (window.location.hash !== nextHash) {
      history.replaceState(null, "", nextHash);
    }
  }

  if (typeof window.refreshShareUrl === "function") {
    window.refreshShareUrl();
  }

  updateTabBarIndicator();

  onDashboardTabShown(tab.id);
}

function tabIdFromHash() {
  const hash = window.location.hash.replace(/^#/, "").split(":", 1)[0].toLowerCase();
  if (!hash) return null;
  if (DATA_TAB_HASHES.has(hash)) return "data";
  if (OPS_TAB_HASHES.has(hash)) return "ops";
  if (hash === "analisis") return "analytics";
  const match = DASHBOARD_TABS.find((tab) => tab.hash === hash || tab.id === hash);
  return match?.id ?? null;
}

function dashboardHashState() {
  const raw = window.location.hash.replace(/^#/, "");
  const [hash, ...rest] = raw.split(":");
  const base = hash.toLowerCase();
  let id = null;
  if (DATA_TAB_HASHES.has(base)) id = "data";
  else if (OPS_TAB_HASHES.has(base)) id = "ops";
  else if (base === "analisis") id = "analytics";
  else id = DASHBOARD_TABS.find((tab) => tab.hash === base || tab.id === base)?.id ?? null;
  return {
    id,
    detail: rest.length ? decodeURIComponent(rest.join(":")) : "",
  };
}

function initDashboardTabs() {
  const bar = document.getElementById("tab-bar");
  if (!bar) return;

  bar.addEventListener("click", (event) => {
    const button = event.target.closest(".tab-btn");
    if (!button) return;
    activateDashboardTab(button.dataset.tab);
  });

  bar.addEventListener("keydown", (event) => {
    const buttons = [...bar.querySelectorAll(".tab-btn")];
    const current = buttons.findIndex((btn) => btn.getAttribute("aria-selected") === "true");
    if (current < 0) return;

    let next = current;
    if (event.key === "ArrowRight") next = (current + 1) % buttons.length;
    else if (event.key === "ArrowLeft") next = (current - 1 + buttons.length) % buttons.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = buttons.length - 1;
    else return;

    event.preventDefault();
    buttons[next].focus();
    activateDashboardTab(buttons[next].dataset.tab);
  });

  window.addEventListener("hashchange", () => {
    const tabId = tabIdFromHash();
    if (tabId) {
      activateDashboardTab(tabId, { updateHash: false });
      const hashState = typeof window.dashboardHashState === "function" ? window.dashboardHashState() : null;
      if (hashState?.detail) applyDashboardHashDetail(tabId, hashState.detail);
    }
  });

  activateDashboardTab(tabIdFromHash() || "overview", { updateHash: Boolean(tabIdFromHash()) });

  window.addEventListener("resize", () => {
    updateTabBarIndicator({ animate: false });
    const active = bar.querySelector('.tab-btn[aria-selected="true"]')?.dataset.tab;
    if (active) onDashboardTabShown(active);
  });
  bar.addEventListener("scroll", () => updateTabBarIndicator({ animate: false }), { passive: true });
}

document.addEventListener("DOMContentLoaded", initDashboardTabs);

window.onDashboardTabShown = onDashboardTabShown;
window.playPanelEnter = playPanelEnter;
window.markDashboardReady = markDashboardReady;
window.activateDashboardTab = activateDashboardTab;
window.dashboardHashState = dashboardHashState;
window.applyDashboardHashDetail = applyDashboardHashDetail;
