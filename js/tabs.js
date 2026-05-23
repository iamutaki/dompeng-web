const DASHBOARD_TABS = [
  { id: "overview", label: "Ringkasan", hash: "ringkasan" },
  { id: "geo", label: "Peta Kota", hash: "peta" },
  { id: "analytics", label: "Analisis", hash: "analisis" },
  { id: "preview", label: "Contoh", hash: "pratinjau" },
];

function resizeDashboardCharts() {
  if (typeof Chart === "undefined") return;
  for (const id of [
    "coverage-chart",
    "queue-chart",
    "index-chart",
    "overview-coverage-chart",
    "overview-queue-chart",
  ]) {
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
  if (tabId === "analytics" || tabId === "overview") {
    window.requestAnimationFrame(resizeDashboardCharts);
  }
  if (tabId === "preview") {
    const showcase = document.getElementById("entity-showcase");
    if (showcase) void showcase.offsetHeight;
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
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    document.body.classList.add("dashboard-ready");
    return;
  }
  document.body.classList.add("dashboard-ready");
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
  if (hash === "pembaruan" || hash === "changelog") return "overview";
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
window.playPanelEnter = playPanelEnter;
window.markDashboardReady = markDashboardReady;
