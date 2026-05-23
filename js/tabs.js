const DASHBOARD_TABS = [
  { id: "overview", label: "Ringkasan", hash: "ringkasan" },
  { id: "geo", label: "Peta Kota", hash: "peta" },
  { id: "analytics", label: "Analisis", hash: "analisis" },
  { id: "preview", label: "Contoh", hash: "pratinjau" },
  { id: "changelog", label: "Pembaruan", hash: "pembaruan" },
];

function resizeDashboardCharts() {
  if (typeof Chart === "undefined") return;
  for (const id of ["coverage-chart", "queue-chart", "index-chart"]) {
    const chart = Chart.getChart(id);
    if (chart) chart.resize();
  }
}

function resizeGeoMap() {
  if (!window.DOMPENG_MAP?.resize) return;
  window.requestAnimationFrame(() => {
    window.DOMPENG_MAP.resize();
    window.setTimeout(() => window.DOMPENG_MAP.resize(), 150);
  });
}

function onDashboardTabShown(tabId) {
  if (tabId === "geo") resizeGeoMap();
  if (tabId === "analytics") {
    window.requestAnimationFrame(resizeDashboardCharts);
  }
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
    panel.classList.toggle("is-active", panel.dataset.tab === tab.id);
    panel.hidden = panel.dataset.tab !== tab.id;
  }

  if (updateHash) {
    const nextHash = `#${tab.hash}`;
    if (window.location.hash !== nextHash) {
      history.replaceState(null, "", nextHash);
    }
  }

  onDashboardTabShown(tab.id);
}

function tabIdFromHash() {
  const hash = window.location.hash.replace(/^#/, "").toLowerCase();
  if (!hash) return null;
  const match = DASHBOARD_TABS.find((tab) => tab.hash === hash || tab.id === hash);
  return match?.id ?? null;
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
    if (tabId) activateDashboardTab(tabId, { updateHash: false });
  });

  activateDashboardTab(tabIdFromHash() || "overview", { updateHash: Boolean(tabIdFromHash()) });
}

document.addEventListener("DOMContentLoaded", initDashboardTabs);

window.onDashboardTabShown = onDashboardTabShown;
