const COLORS = {
  intel: "#00d4aa",
  cyan: "#4ec9ff",
  amber: "#e6a817",
  purple: "#a98bff",
  pink: "#ff7eb3",
  danger: "#ff5c5c",
  muted: "#6b8299",
  grid: "rgba(28, 42, 58, 0.8)",
};

const COVERAGE_COLORS = [COLORS.intel, COLORS.purple, COLORS.cyan, COLORS.amber, COLORS.pink];

const VECTOR_LABELS = {
  phone: "Nomor telepon",
  email: "Alamat email",
  nik: "NIK",
  employee_id: "ID karyawan",
  photo: "Foto",
};

const CHANGELOG_KIND_LABELS = {
  Added: "Fitur baru",
  Changed: "Perubahan",
  Fixed: "Perbaikan",
  Removed: "Dihapus",
};

const CHANGELOG_TARGETS = {
  page: {
    heroId: "changelog-hero",
    summaryId: "changelog-summary",
    feedId: "changelog-feed",
    feedCountId: "changelog-feed-count",
    filterId: "changelog-kind-filter",
  },
  modal: {
    heroId: "changelog-modal-hero",
    summaryId: "changelog-modal-summary",
    feedId: "changelog-modal-feed",
    feedCountId: "changelog-modal-feed-count",
    filterId: "changelog-modal-kind-filter",
  },
};

let dashboardDataCache = null;
let dashboardViewMode = localStorage.getItem("dompeng:view-mode") === "technical" ? "technical" : "public";
let dashboardQueueFilter = "all";
let previewFilterHandler = null;

const PREVIEW_TYPE_FILTERS = {
  all: () => true,
  photo: (entity) => Boolean(entity.hasPhoto),
  phone: (entity) => (entity.relations?.phone || 0) > 0,
  email: (entity) => (entity.relations?.email || 0) > 0,
  nik: (entity) =>
    (entity.relations?.nik || 0) > 0 ||
    (entity.identifiers || []).some((item) => String(item.type || "").toUpperCase() === "NIK"),
  docs: (entity) => (entity.documentCount || 0) > 0,
};

const QUEUE_FILTER_LABELS = {
  all: "Semua status",
  pending: "Menunggu",
  processing: "Diproses",
  done: "Selesai",
  failed: "Gagal",
};

function normalizeFilterQuery(value) {
  return (value || "").trim().toLowerCase();
}

const CITY_FILTER_INPUT_IDS = ["overview-city-filter", "geo-city-filter"];
/** Debounce untuk input teks (kota, indeks, sampel). Dropdown tetap langsung. */
const DASHBOARD_FILTER_DEBOUNCE_MS = 280;

function debounce(fn, waitMs) {
  let timer = null;
  return (...args) => {
    if (timer) clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      fn(...args);
    }, waitMs);
  };
}

function syncCityFilterInputs(raw, { skipId } = {}) {
  const value = (raw ?? "").toString();
  for (const id of CITY_FILTER_INPUT_IDS) {
    if (id === skipId) continue;
    const input = document.getElementById(id);
    if (input && input.value !== value) input.value = value;
  }
}

function getCityFilterQuery() {
  const geo = document.getElementById("geo-city-filter");
  const overview = document.getElementById("overview-city-filter");
  const raw = (geo?.value ?? overview?.value ?? "").trim();
  return normalizeFilterQuery(raw);
}

function setCityFilterQuery(value) {
  syncCityFilterInputs((value || "").trim());
}

const scheduleGeoCityViewsRefresh = debounce((geo) => {
  refreshGeoCityViews(geo, { fitMapBounds: true });
}, DASHBOARD_FILTER_DEBOUNCE_MS);

function cityMatchesFilter(city, query) {
  if (!query) return true;
  const haystack = `${city.label || ""} ${city.province || ""} ${city.key || ""}`.toLowerCase();
  return haystack.includes(query);
}

function filterCityClusters(clusters, query) {
  const q = query ?? getCityFilterQuery();
  return (clusters || []).filter((city) => cityMatchesFilter(city, q));
}

function getIndexFilters() {
  return {
    query: normalizeFilterQuery(document.getElementById("analytics-index-search")?.value),
    kind: document.getElementById("analytics-index-kind-filter")?.value || "all",
  };
}

function filterIndexRows(indexRows, filters = getIndexFilters()) {
  return (indexRows || []).filter((row) => {
    if (filters.kind !== "all" && row.kind !== filters.kind) return false;
    if (!filters.query) return true;
    const mode = row.kind === "unique" ? "unik" : "silang";
    return `${row.type} ${mode} ${row.kind}`.toLowerCase().includes(filters.query);
  });
}

function sumIndexTotals(rows) {
  return (rows || []).reduce(
    (acc, row) => ({
      entries: acc.entries + (row.entries || 0),
      refs: acc.refs + (row.refs || 0),
    }),
    { entries: 0, refs: 0 },
  );
}

function getPreviewFilters() {
  return {
    query: normalizeFilterQuery(document.getElementById("preview-search")?.value),
    type: document.getElementById("preview-type-filter")?.value || "all",
  };
}

function previewEntityMatches(entity, filters = getPreviewFilters()) {
  const predicate = PREVIEW_TYPE_FILTERS[filters.type] || PREVIEW_TYPE_FILTERS.all;
  if (!predicate(entity)) return false;
  if (!filters.query) return true;
  const haystack = [
    entity.ref,
    entity.name,
    ...(entity.identifiers || []).map((item) => `${item.type} ${item.value}`),
    ...Object.keys(entity.relations || {}),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(filters.query);
}

function getQueueFilter() {
  return dashboardQueueFilter || "all";
}

function syncQueueFilterSelects(value) {
  dashboardQueueFilter = value || "all";
  for (const select of document.querySelectorAll(".js-queue-filter")) {
    if (select.value !== dashboardQueueFilter) select.value = dashboardQueueFilter;
  }
}

const chartDefaults = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      labels: {
        color: COLORS.muted,
        boxWidth: 10,
        boxHeight: 10,
        usePointStyle: true,
        pointStyle: "rect",
        padding: 16,
        font: { family: "'IBM Plex Mono', monospace", size: 11, weight: "600" },
      },
    },
    tooltip: {
      backgroundColor: "#101822",
      borderColor: "#1c2a3a",
      borderWidth: 1,
      titleColor: "#d8e2ef",
      bodyColor: COLORS.muted,
      titleFont: { family: "'IBM Plex Mono', monospace", size: 12, weight: "600" },
      bodyFont: { family: "'IBM Plex Mono', monospace", size: 11, weight: "500" },
      padding: 10,
    },
  },
  scales: {
    x: {
      ticks: { color: COLORS.muted, font: { family: "'IBM Plex Mono', monospace", size: 11, weight: "500" } },
      grid: { color: COLORS.grid },
      border: { color: "#1c2a3a" },
    },
    y: {
      ticks: { color: COLORS.muted, font: { family: "'IBM Plex Mono', monospace", size: 11, weight: "500" } },
      grid: { color: COLORS.grid },
      border: { color: "#1c2a3a" },
    },
  },
};

function pct(value, total) {
  if (!total) return 0;
  return Math.round((value / total) * 100);
}

function dateLabel(iso) {
  if (!iso) return "—";
  return iso.slice(0, 10);
}

function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function appendText(el, text) {
  el.appendChild(document.createTextNode(text));
}

function isTechnicalMode() {
  return dashboardViewMode === "technical";
}

function applyDashboardViewMode({ rerender = false } = {}) {
  document.body.dataset.viewMode = dashboardViewMode;
  const toggle = document.getElementById("view-mode-toggle");
  if (toggle) {
    const technical = isTechnicalMode();
    toggle.textContent = technical ? "MODE TEKNIS" : "MODE PUBLIK";
    toggle.setAttribute("aria-pressed", technical ? "true" : "false");
  }
  if (rerender && dashboardDataCache) {
    renderDashboardData(dashboardDataCache);
  }
}

function initDashboardViewMode() {
  applyDashboardViewMode();
  const toggle = document.getElementById("view-mode-toggle");
  if (!toggle) return;
  toggle.addEventListener("click", () => {
    dashboardViewMode = isTechnicalMode() ? "public" : "technical";
    localStorage.setItem("dompeng:view-mode", dashboardViewMode);
    applyDashboardViewMode({ rerender: true });
  });
}

function renderIntelBrief(intel) {
  const container = document.getElementById("intel-brief");
  clear(container);

  const dominantLabel = VECTOR_LABELS[intel.dominantVectorId] || "Field entitas";
  const cards = isTechnicalMode() ? [
    {
      label: "Node graf",
      value: fmt(intel.graphNodes),
      hint: `${fmt(intel.graphEdges)} edge · ${fmt(intel.sourceDocuments)} source docs`,
      tone: "intel",
    },
    {
      label: "Dominan",
      value: `${intel.dominantVectorPct}%`,
      hint: `${intel.dominantVectorId} · ${intel.activeVectors} vector aktif`,
      tone: "intel",
    },
    {
      label: "Xref ratio",
      value: `${intel.xrefRatio}×`,
      hint: `${intel.entityLinkRate} id/entity`,
      tone: "cyan",
    },
    {
      label: "Pipeline",
      value: `${intel.pipelineSuccessPct}%`,
      hint: `Backlog ${intel.pipelineBacklogPct}% · fail ${intel.pipelineFailurePct}%`,
      tone: intel.pipelineFailurePct > 10 ? "danger" : "amber",
    },
  ] : [
    {
      label: "Entitas terindeks",
      value: fmt(intel.graphNodes),
      hint: `${fmt(intel.graphEdges)} keterkaitan · ${fmt(intel.sourceDocuments)} dokumen`,
      tone: "intel",
    },
    {
      label: "Data paling lengkap",
      value: `${intel.dominantVectorPct}%`,
      hint: `${dominantLabel} · ${intel.activeVectors} jenis data terisi`,
      tone: "intel",
    },
    {
      label: "Tingkat keterkaitan",
      value: `${intel.xrefRatio}×`,
      hint: `Rata-rata ${intel.entityLinkRate} identitas per entitas`,
      tone: "cyan",
    },
    {
      label: "Status unduhan",
      value: `${intel.pipelineSuccessPct}%`,
      hint: `Antrian ${intel.pipelineBacklogPct}% · Gagal ${intel.pipelineFailurePct}%`,
      tone: intel.pipelineFailurePct > 10 ? "danger" : "amber",
    },
  ];

  for (const card of cards) {
    const article = document.createElement("article");
    article.className = "brief-card";
    if (card.tone !== "intel") article.dataset.tone = card.tone;

    const label = document.createElement("div");
    label.className = "brief-label";
    appendText(label, card.label);

    const value = document.createElement("div");
    value.className = "brief-value";
    appendText(value, card.value);

    const hint = document.createElement("div");
    hint.className = "brief-hint";
    appendText(hint, card.hint);

    article.append(label, value, hint);
    container.appendChild(article);
  }
}

function renderOverviewSummary(data) {
  const lead = document.getElementById("overview-summary-lead");
  const updated = document.getElementById("overview-summary-updated");
  const health = document.getElementById("overview-health");
  const queueHealth = document.getElementById("overview-health-queue");
  const quality = document.getElementById("overview-quality");
  if (!lead) return;

  const summary = data.summary || {};
  const geo = data.geo || {};
  const queue = data.queue || {};
  const queueTotal = queue.total || 1;
  const failurePct = pct(queue.failed || 0, queueTotal);
  const backlogPct = pct((queue.pending || 0) + (queue.processing || 0), queueTotal);
  const avgCoverage = Math.round(
    (data.coverage || []).reduce((sum, item) => sum + (item.pct || 0), 0) / Math.max(1, (data.coverage || []).length),
  );
  const geoPct = pct(geo.geocodedEntities || 0, summary.persons || geo.totalEntities || 1);
  const successPct = pct(queue.done || 0, queueTotal);
  const qualityScore = Math.round((avgCoverage * 0.35) + (geoPct * 0.25) + (successPct * 0.4));
  const bits = [
    `${fmt(summary.persons || 0)} entitas`,
    `${fmt(geo.mappedCities || 0)} kota`,
    `${fmt(summary.documents || 0)} dokumen publik`,
  ].filter(Boolean);
  lead.textContent = bits.join(" · ");
  if (updated) {
    updated.textContent = data.updated ? `Diperbarui ${data.updated}` : "Belum ada waktu pembaruan";
  }
  if (health) {
    health.textContent = data.redacted ? "Data valid · tersensor" : "Periksa status data";
    health.dataset.tone = data.redacted ? "ok" : "warn";
  }
  if (queueHealth) {
    queueHealth.textContent = `${backlogPct}% antrian · ${failurePct}% gagal`;
    queueHealth.dataset.tone = failurePct > 10 ? "warn" : "ok";
  }
  if (quality) {
    quality.textContent = `Kualitas ${qualityScore}/100`;
    quality.dataset.tone = qualityScore >= 60 ? "ok" : "warn";
    quality.title = `Kelengkapan ${avgCoverage}% · geo ${geoPct}% · unduhan ${successPct}%`;
  }

  const updatedTime = Date.parse(`${data.updated || ""}`.replace(" UTC", "Z"));
  const staleDays = Number.isFinite(updatedTime) ? Math.floor((Date.now() - updatedTime) / 86400000) : 0;
  if (health && staleDays >= 7) {
    health.textContent = `Perlu pembaruan · ${staleDays} hari`;
    health.dataset.tone = "warn";
  }
}

function renderDataTable(containerId, columns, rows) {
  const container = document.getElementById(containerId);
  if (!container) return;
  clear(container);

  const table = document.createElement("table");
  table.className = "mini-data-table";
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const col of columns) {
    const th = document.createElement("th");
    if (col.numeric) th.className = "num";
    appendText(th, col.label);
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);

  const tbody = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const col of columns) {
      const td = document.createElement("td");
      if (col.numeric) td.className = "num";
      const raw = row[col.key];
      let text = "—";
      if (raw != null && raw !== "") {
        text = col.numeric && typeof raw === "number" ? fmt(raw) : String(raw);
      }
      appendText(td, text);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.append(thead, tbody);
  container.appendChild(table);
}

let chartDataModalLastFocus = null;

function openChartDataModal(modalId) {
  const dialog = document.getElementById(modalId);
  if (!dialog) return;
  chartDataModalLastFocus = document.activeElement;
  if (typeof dialog.showModal === "function") {
    try {
      if (!dialog.open) dialog.showModal();
    } catch {
      dialog.setAttribute("open", "");
    }
    return;
  }
  dialog.setAttribute("open", "");
}

function changelogFallbackReleases(changelog) {
  if (!changelog?.latestVersion) return [];

  const match = (changelog.releases || []).find((release) => release.version === changelog.latestVersion);
  if (match?.sections?.length) {
    return [{ ...match, sections: match.sections }];
  }

  return [{
    version: changelog.latestVersion,
    date: changelog.latestDate || "—",
    sections: [{
      kind: "Changed",
      items: [`Versi aktif ${changelog.latestVersion}.`],
    }],
  }];
}

function filterChangelogReleases(changelog, kindFilter) {
  return (changelog.releases || [])
    .map((release) => ({
      ...release,
      sections: kindFilter === "all"
        ? release.sections
        : (release.sections || []).filter((section) => section.kind === kindFilter),
    }))
    .filter((release) => release.sections.length > 0);
}

function refreshChangelogModalView() {
  const changelog = dashboardDataCache?.changelog;
  if (!changelog) return;
  const target = CHANGELOG_TARGETS.modal;
  renderChangelogHero(changelog, target);
  renderChangelogSummary(changelog, target);
  renderChangelogFeed(changelog, target);
}

function openChangelogModal() {
  refreshChangelogModalView();
  openChartDataModal("changelog-modal");
}

function closeChartDataModal(dialog) {
  if (!dialog) return;
  dialog.close();
  const restore = chartDataModalLastFocus;
  chartDataModalLastFocus = null;
  if (restore && typeof restore.focus === "function" && document.contains(restore)) {
    restore.focus();
  }
}

function initChartDataModals() {
  for (const trigger of document.querySelectorAll("[data-chart-modal]")) {
    if (trigger.dataset.chartModalBound === "true") continue;
    trigger.dataset.chartModalBound = "true";
    const modalId = trigger.getAttribute("data-chart-modal");
    trigger.addEventListener("click", () => openChartDataModal(modalId));
  }

  for (const dialog of document.querySelectorAll(".chart-data-modal")) {
    if (dialog.dataset.chartModalBound === "true") continue;
    dialog.dataset.chartModalBound = "true";

    for (const closeBtn of dialog.querySelectorAll("[data-chart-modal-close]")) {
      closeBtn.addEventListener("click", () => closeChartDataModal(dialog));
    }

    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) closeChartDataModal(dialog);
    });

    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeChartDataModal(dialog);
    });
  }
}

/** Buka modal tabel saat chart tidak tersedia (mis. ECharts gagal dimuat). */
function showChartFallbackTable(modalId) {
  openChartDataModal(modalId);
}

function renderAccessibleDataTables(data) {
  if (document.getElementById("overview-sankey-table")) {
    renderOverviewSankeyTable(buildOverviewSankeyData(data).links);
  }

  renderDataTable(
    "index-chart-table",
    [
      { key: "type", label: "Tipe" },
      { key: "kind", label: "Mode" },
      { key: "entries", label: "Entri", numeric: true },
      { key: "refs", label: "Referensi", numeric: true },
    ],
    (data.indexRows || []).map((row) => ({
      type: row.type,
      kind: row.kind === "unique" ? "Unik" : "Silang",
      entries: fmt(row.entries),
      refs: fmt(row.refs),
    })),
  );
}

function createVolumeStatCard(card) {
  const article = document.createElement("article");
  article.className = "stat-card";
  article.dataset.code = card.code;
  if (card.tone) article.dataset.tone = card.tone;

  const value = document.createElement("div");
  value.className = "stat-value";
  appendText(value, fmt(card.value));

  const label = document.createElement("div");
  label.className = "stat-label";
  appendText(label, card.label);

  article.append(value, label);
  if (card.hint) {
    const hint = document.createElement("div");
    hint.className = "stat-hint";
    appendText(hint, card.hint);
    article.append(hint);
  }
  return article;
}

function createCompactVolumeMetric(item) {
  const row = document.createElement("div");
  row.className = "volume-metric";
  row.dataset.code = item.code;
  if (item.tone) row.dataset.tone = item.tone;
  if (item.hint) row.title = item.hint;

  const label = document.createElement("span");
  label.className = "volume-metric__label";
  appendText(label, item.shortLabel || item.label);

  const value = document.createElement("span");
  value.className = "volume-metric__value";
  appendText(value, fmt(item.value));

  row.append(label, value);
  return row;
}

function renderStats(summary, { excludeCodes = [] } = {}) {
  const cards = [
    { code: "N-01", value: summary.persons, label: "Entitas terindeks", tone: "intel" },
    { code: "N-02", value: summary.documents, label: "Dokumen publik", tone: "intel" },
    { code: "N-03", value: summary.templates, label: "Template ekstraksi" },
    { code: "N-04", value: summary.history, label: "Riwayat file", tone: "cyan" },
    { code: "N-05", value: summary.doneFiles, label: "File selesai diproses" },
    { code: "N-06", value: summary.photos, label: "Foto tersensor", tone: "amber" },
  ].filter((card) => !excludeCodes.includes(card.code));

  const grid = document.getElementById("stats-grid");
  if (!grid || grid.classList.contains("volume-panel")) return;
  clear(grid);

  for (const card of cards) {
    grid.appendChild(createVolumeStatCard(card));
  }
}

function renderOverviewVolume(data) {
  const container = document.getElementById("stats-grid");
  if (!container) return;

  const { summary = {}, intel = {}, indexTotal = {}, indexRows = [], geo = {}, queue = {}, coverage = [] } =
    data;
  const queueTotal = queue.total || 1;
  const entityTotal = geo.totalEntities || summary.persons || 1;
  const photoPct = coverage.find((c) => c.id === "photo")?.pct ?? 0;
  const topCoverage = [...coverage].sort((a, b) => (b.pct || 0) - (a.pct || 0))[0];
  const technical = isTechnicalMode();

  const groups = [
    {
      title: "Dataset",
      items: [
        {
          code: "N-02",
          label: "Dokumen publik",
          shortLabel: "Dokumen",
          value: summary.documents,
          tone: "intel",
          hint: `${fmt(intel.sourceDocuments || summary.documents)} sumber terindeks`,
        },
        {
          code: "N-03",
          label: "Template ekstraksi",
          shortLabel: "Template",
          value: summary.templates,
          hint: "Pola parsing dokumen",
        },
        {
          code: "N-05",
          label: "File selesai diproses",
          shortLabel: "Selesai",
          value: summary.doneFiles,
          tone: "cyan",
          hint: `Riwayat ${fmt(summary.history)} file`,
        },
        {
          code: "N-06",
          label: "Foto tersensor",
          shortLabel: "Foto",
          value: summary.photos,
          tone: "amber",
          hint: `${photoPct}% entitas punya foto`,
        },
      ],
    },
    {
      title: "Indeks",
      items: [
        {
          code: "I-01",
          label: "Entri indeks",
          shortLabel: "Entri",
          value: indexTotal.entries,
          tone: "intel",
          hint: `${fmt(indexRows.length)} tipe field`,
        },
        {
          code: "I-02",
          label: "Referensi silang",
          shortLabel: "Ref",
          value: indexTotal.refs,
          tone: "cyan",
          hint: "Referensi antar entitas",
        },
        {
          code: "G-01",
          label: technical ? "Edge graf" : "Relasi data",
          shortLabel: technical ? "Edge" : "Relasi",
          value: intel.graphEdges,
          hint: technical
            ? `${intel.entityLinkRate ?? "—"} identitas per entitas`
            : "Keterhubungan antar field",
        },
        {
          code: "G-02",
          label: technical ? "Vektor aktif" : "Field aktif",
          shortLabel: technical ? "Vektor" : "Field",
          value: intel.activeVectors,
          hint: topCoverage ? `Terkuat: ${topCoverage.label}` : "Kelengkapan field",
        },
      ],
    },
    {
      title: "Geo & antrian",
      items: [
        {
          code: "GEO-1",
          label: "Entitas di peta",
          shortLabel: "Di peta",
          value: geo.geocodedEntities,
          tone: "cyan",
          hint: `${fmt(geo.mappedCities)} kota terpetakan`,
        },
        {
          code: "GEO-2",
          label: "Punya data kota",
          shortLabel: "Punya kota",
          value: geo.entitiesWithCity,
          hint: `${pct(geo.entitiesWithCity, entityTotal)}% dari entitas`,
        },
        {
          code: "GEO-3",
          label: "Kota unik",
          shortLabel: "Kota",
          value: geo.uniqueCities,
          hint: `${fmt(geo.mappedCities)} dengan koordinat`,
        },
        {
          code: "Q-01",
          label: "Antrian URL",
          shortLabel: "Antrian",
          value: queue.total,
          tone: "amber",
          hint: `${fmt(queue.pending)} menunggu · ${fmt(queue.failed)} gagal`,
        },
      ],
    },
  ];

  clear(container);
  container.className = "volume-panel volume-panel--compact";

  const grid = document.createElement("div");
  grid.className = "volume-compact-grid";
  grid.setAttribute("role", "list");

  for (const group of groups) {
    const col = document.createElement("section");
    col.className = "volume-compact-col";
    col.setAttribute("role", "listitem");

    const title = document.createElement("h4");
    title.className = "volume-compact-col__title";
    appendText(title, group.title);
    col.appendChild(title);

    const items = document.createElement("div");
    items.className = "volume-compact-col__items";
    for (const item of group.items) {
      items.appendChild(createCompactVolumeMetric(item));
    }
    col.append(items);
    grid.appendChild(col);
  }

  container.appendChild(grid);

  const capVol = document.getElementById("overview-volume-caption");
  if (capVol) {
    capVol.textContent = [
      `${fmt(summary.documents)} dok`,
      `${fmt(indexTotal.entries)} entri`,
      `${fmt(geo.geocodedEntities)} peta`,
      `${pct(queue.done, queueTotal)}% unduh`,
    ].join(" · ");
  }
}

function renderCoverageMeters(coverage, containerId = "overview-coverage-meters") {
  const container = document.getElementById(containerId);
  if (!container) return;
  clear(container);

  const sorted = [...(coverage || [])].sort((a, b) => (b.pct || 0) - (a.pct || 0));
  for (let i = 0; i < sorted.length; i++) {
    const item = sorted[i];
    const color = COVERAGE_COLORS[i % COVERAGE_COLORS.length];
    const row = document.createElement("div");
    row.className = "signal-meter";
    row.setAttribute("role", "listitem");

    const head = document.createElement("div");
    head.className = "signal-meter__head";

    const label = document.createElement("span");
    label.className = "signal-meter__label";
    appendText(label, VECTOR_LABELS[item.label] || item.label);

    const pctEl = document.createElement("span");
    pctEl.className = "signal-meter__pct";
    appendText(pctEl, `${item.pct ?? pct(item.value, 1)}%`);

    head.append(label, pctEl);

    const track = document.createElement("div");
    track.className = "signal-meter__track";
    track.setAttribute("aria-hidden", "true");

    const fill = document.createElement("span");
    fill.className = "signal-meter__fill";
    fill.style.width = `${Math.max(item.pct || pct(item.value, 1), 3)}%`;
    fill.style.background = color;
    fill.style.setProperty("--signal-glow", color);

    track.appendChild(fill);
    row.append(head, track);
    container.appendChild(row);
  }
}

function renderCoverageSignal(coverage, total) {
  renderCoverageMeters(coverage);
  renderUsageBar(coverage, total, "overview-coverage-bar");
}

const QUEUE_SIGNAL_ITEMS = [
  { key: "pending", label: "Menunggu", short: "Tunggu", color: COLORS.amber },
  { key: "done", label: "Selesai", short: "Selesai", color: COLORS.intel },
  { key: "failed", label: "Gagal", short: "Gagal", color: COLORS.danger },
  { key: "processing", label: "Diproses", short: "Proses", color: COLORS.cyan, optional: true },
];

function queueSignalItems(queue) {
  const items = QUEUE_SIGNAL_ITEMS.filter((item) => !item.optional || (queue[item.key] || 0) > 0);
  return items.map((item) => ({
    ...item,
    value: queue[item.key] || 0,
  }));
}

function renderQueueKpis(queue, containerId = "overview-queue-kpis", { statusFilter = "all" } = {}) {
  const container = document.getElementById(containerId);
  if (!container) return;
  clear(container);

  const total = queue.total || 1;
  const items = queueSignalItems(queue);
  const visible = statusFilter === "all" ? items : items.filter((item) => item.key === statusFilter);

  for (const item of visible) {
    const card = document.createElement("div");
    card.className = "signal-kpi";
    card.dataset.tone = item.key;

    const label = document.createElement("span");
    label.className = "signal-kpi__label";
    appendText(label, item.short);

    const value = document.createElement("strong");
    value.className = "signal-kpi__value";
    value.style.color = item.color;
    appendText(value, fmt(item.value));

    const sub = document.createElement("span");
    sub.className = "signal-kpi__sub";
    appendText(sub, `${pct(item.value, total)}%`);

    card.append(label, value, sub);
    container.appendChild(card);
  }

  const totalCard = document.createElement("div");
  totalCard.className = "signal-kpi signal-kpi--total";
  const totalLabel = document.createElement("span");
  totalLabel.className = "signal-kpi__label";
  appendText(totalLabel, "Total URL");
  const totalValue = document.createElement("strong");
  totalValue.className = "signal-kpi__value";
  appendText(totalValue, fmt(queue.total || 0));
  totalCard.append(totalLabel, totalValue);
  if (statusFilter === "all") {
    container.appendChild(totalCard);
  }
}

function renderQueuePipeline(queue, containerId = "overview-queue-pipeline", { statusFilter = "all" } = {}) {
  const container = document.getElementById(containerId);
  if (!container) return;
  clear(container);

  if (statusFilter !== "all") {
    container.hidden = true;
    return;
  }
  container.hidden = false;

  const total = queue.total || 1;
  const items = queueSignalItems(queue).filter((item) => item.value > 0 || !item.optional);
  if (!items.length) return;

  const track = document.createElement("div");
  track.className = "signal-pipeline__track";

  for (const item of items) {
    const seg = document.createElement("span");
    seg.className = "signal-pipeline__seg";
    seg.style.flex = String(Math.max(item.value, 1));
    seg.style.background = item.color;
    seg.title = `${item.label}: ${fmt(item.value)} (${pct(item.value, total)}%)`;
    track.appendChild(seg);
  }

  const labels = document.createElement("div");
  labels.className = "signal-pipeline__labels";
  for (const item of items) {
    const chip = document.createElement("span");
    chip.className = "signal-pipeline__chip";
    chip.style.color = item.color;
    appendText(chip, item.short);
    labels.appendChild(chip);
  }

  container.append(track, labels);
}

function renderQueueSignal(queue, options = {}) {
  const statusFilter = options.statusFilter ?? getQueueFilter();
  renderQueueKpis(queue, "overview-queue-kpis", { statusFilter });
  renderQueuePipeline(queue, "overview-queue-pipeline", { statusFilter });
  renderQueueStats(queue, "overview-queue-stats", { statusFilter });
  buildQueueChart(queue, "overview-queue-chart", { compact: true, statusFilter });
}

const SANKEY_QUEUE_STATUS = [
  { key: "pending", label: "Menunggu", color: COLORS.amber },
  { key: "processing", label: "Diproses", color: COLORS.cyan },
  { key: "done", label: "Selesai", color: COLORS.intel },
  { key: "failed", label: "Gagal", color: COLORS.danger },
];

const DOMPENG_ECHART_STORE = {
  overviewSankey: "DOMPENG_OVERVIEW_SANKEY",
  indexBar: "DOMPENG_INDEX_BAR",
  previewGraph: "DOMPENG_PREVIEW_GRAPH",
};

const PREVIEW_GRAPH_MAX_IDENTIFIERS = 14;
const PREVIEW_GRAPH_MAX_RELATION_LINKS = 24;
/** Warna simpul per kategori — dipakai bersama oleh legend ECharts dan itemStyle node. */
const PREVIEW_GRAPH_KIND_COLOR = {
  entity: "#00ffd0",
  identifier: "#5ec8ff",
  relation: COLORS.purple,
  document: "#ffc857",
};

const PREVIEW_GRAPH_CATEGORIES = [
  { name: "Entitas", itemStyle: { color: PREVIEW_GRAPH_KIND_COLOR.entity } },
  { name: "Identitas", itemStyle: { color: PREVIEW_GRAPH_KIND_COLOR.identifier } },
  { name: "Relasi", itemStyle: { color: PREVIEW_GRAPH_KIND_COLOR.relation } },
  { name: "Dokumen", itemStyle: { color: PREVIEW_GRAPH_KIND_COLOR.document } },
];

const PREVIEW_GRAPH_RELATION_COLORS = {
  family: "#ff6b9d",
  phone: "#5ec8ff",
  email: "#6ef0c4",
  document: PREVIEW_GRAPH_KIND_COLOR.document,
  mentions: "#c49bff",
  colleague: "#8eb8ff",
  nik: "#3dffc8",
  npwp: "#ffbf47",
};

function previewGraphRelationColor(key) {
  return PREVIEW_GRAPH_RELATION_COLORS[key] || COLORS.purple;
}

/** Label legenda relasi — pisahkan relasi `document` dari berkas sumber. */
function previewGraphRelationLegendName(key) {
  if (key === "document") return "Relasi dokumen";
  return relationLabel(key);
}

/**
 * Legenda SMP-R dari simpul aktual — tiap tipe relasi di graf dapat entri sendiri
 * (mis. Keluarga), bukan hanya kategori umum "Relasi".
 */
function previewGraphLegendData(nodes = []) {
  const items = [];
  const hasEntity = nodes.some((n) => n.nodeKind === "entity");
  const hasIdentifier = nodes.some(
    (n) => n.nodeKind === "identifier" || n.nodeKind === "identifier_overflow",
  );
  const hasDocumentFile = nodes.some((n) => n.nodeKind === "document");

  if (hasEntity) {
    items.push({
      name: "Entitas",
      icon: "circle",
      itemStyle: { color: PREVIEW_GRAPH_KIND_COLOR.entity },
    });
  }
  if (hasIdentifier) {
    items.push({
      name: "Identitas",
      icon: "circle",
      itemStyle: { color: PREVIEW_GRAPH_KIND_COLOR.identifier },
    });
  }

  const relationKeys = new Set();
  for (const n of nodes) {
    if (
      n.nodeKind === "relation" ||
      n.nodeKind === "relation_link" ||
      n.nodeKind === "relation_overflow"
    ) {
      relationKeys.add(n.relationKey || "unknown");
    }
  }

  const relationOrder = [
    "family",
    "phone",
    "email",
    "nik",
    "npwp",
    "colleague",
    "mentions",
    "document",
  ];
  const sortedRelationKeys = [...relationKeys].sort((a, b) => {
    const ia = relationOrder.indexOf(a);
    const ib = relationOrder.indexOf(b);
    if (ia === -1 && ib === -1) {
      return previewGraphRelationLegendName(a).localeCompare(previewGraphRelationLegendName(b), "id");
    }
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

  for (const key of sortedRelationKeys) {
    items.push({
      name: previewGraphRelationLegendName(key),
      icon: "circle",
      itemStyle: { color: previewGraphRelationColor(key) },
    });
  }

  if (hasDocumentFile) {
    items.push({
      name: "Dokumen",
      icon: "circle",
      itemStyle: { color: PREVIEW_GRAPH_KIND_COLOR.document },
    });
  }

  return items;
}

const PREVIEW_GRAPH_NODE_SIZE = {
  entity: 26,
  identifier: 11,
  relation: 13,
  document: 13,
  overflow: 11,
};

let previewGraphActiveEntity = null;

const DOMPENG_ECHART_TOOLTIP = {
  backgroundColor: "rgba(11, 17, 24, 0.94)",
  borderColor: "rgba(78, 201, 255, 0.35)",
  textStyle: {
    color: "#c5d4e3",
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
  },
};

const SANKEY_LEVEL_STYLES = [
  { depth: 0, itemStyle: { color: COLORS.cyan }, label: { fontSize: 12, fontWeight: 700 } },
  { depth: 1, itemStyle: { color: COLORS.intel } },
  { depth: 2, itemStyle: { color: "rgba(0, 212, 170, 0.88)" } },
  { depth: 3, itemStyle: { color: COLORS.purple } },
];

/** Inisialisasi / reuse instance ECharts pada elemen dashboard. */
function initDompengEchart(el, storeKey) {
  if (!el || typeof echarts === "undefined") return null;

  let chart = window[storeKey];
  if (chart) {
    try {
      if (chart.getDom() !== el) {
        chart.dispose();
        chart = null;
        window[storeKey] = null;
      }
    } catch {
      chart = null;
      window[storeKey] = null;
    }
  }

  if (!chart) {
    window[storeKey] = echarts.init(el, null, { renderer: "canvas" });
    chart = window[storeKey];
  }
  return chart;
}

function resizeDompengEchart(storeKey) {
  const chart = window[storeKey];
  if (chart?.resize) chart.resize();
}

/** Alokasi bilangan bulat proporsional; jumlah tepat sama dengan target. */
function allocateProportionalIntegers(parts, targetTotal) {
  const total = Math.round(Number(targetTotal) || 0);
  if (total <= 0 || !parts.length) return [];

  const weights = parts.map((p) => Math.max(Number(p) || 0, 0));
  const weightSum = weights.reduce((sum, w) => sum + w, 0);
  if (weightSum <= 0) return weights.map(() => 0);

  const raw = weights.map((w) => (w / weightSum) * total);
  const values = raw.map((r) => Math.floor(r));
  let remainder = total - values.reduce((sum, v) => sum + v, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - values[i] }))
    .sort((a, b) => b.frac - a.frac);
  for (let n = 0; n < remainder; n++) {
    values[order[n % order.length].i] += 1;
  }
  return values;
}

/**
 * Sankey ringkasan — alur yang konservatif per cabang:
 * dokumen → entitas → geo (partisi) + indeks (proporsi entri, bukan total mentah);
 * dokumen → antrian URL. Vektor coverage sengaja tidak digambar (tumpang tindih antar field).
 */
function buildOverviewSankeyData(data) {
  const summary = data.summary || {};
  const queue = data.queue || {};
  const geo = data.geo || {};
  const persons = summary.persons || data.coverageTotal || 0;
  const indexRows = [...(data.indexRows || [])]
    .filter((row) => (row.entries || 0) > 0)
    .sort((a, b) => (b.entries || 0) - (a.entries || 0))
    .slice(0, 5);

  const nodeMap = new Map();
  const links = [];

  function node(name, color, depth) {
    if (!nodeMap.has(name)) {
      nodeMap.set(name, {
        name,
        depth,
        itemStyle: {
          color,
          borderColor: "rgba(255, 255, 255, 0.12)",
          borderWidth: 1,
        },
      });
    }
    return name;
  }

  function addLink(source, target, value, meta = {}) {
    const v = Math.round(Number(value) || 0);
    if (v <= 0 || source === target) return;
    links.push({ source, target, value: v, ...meta });
  }

  const nDoc = node("Dokumen publik", COLORS.cyan, 0);
  const nEnt = node("Entitas terindeks", COLORS.intel, 1);

  addLink(nDoc, nEnt, persons);

  const geocoded = geo.geocodedEntities || 0;
  const notGeocoded = Math.max(0, persons - geocoded);
  if (geocoded > 0) {
    addLink(nEnt, node("Terpetakan kota", COLORS.cyan, 2), geocoded, { metric: "geo" });
  }
  if (notGeocoded > 0) {
    addLink(nEnt, node("Belum terpetakan", COLORS.muted, 2), notGeocoded, { metric: "geo" });
  }

  const indexEntrySum = indexRows.reduce((sum, row) => sum + (row.entries || 0), 0);
  if (persons > 0 && indexRows.length && indexEntrySum > 0) {
    const nIdx = node("Indeks pencarian", COLORS.purple, 2);
    const scaled = allocateProportionalIntegers(
      indexRows.map((row) => row.entries),
      persons,
    );
    let indexHubFlow = 0;
    for (let i = 0; i < indexRows.length; i++) {
      const flow = scaled[i];
      if (flow <= 0) continue;
      const row = indexRows[i];
      const color = [COLORS.intel, COLORS.cyan, COLORS.amber, COLORS.pink, COLORS.purple][i % 5];
      addLink(nIdx, node(`Indeks · ${row.type}`, color, 3), flow, {
        metric: "index_entries",
        actual: row.entries,
        indexEntrySum,
      });
      indexHubFlow += flow;
    }
    if (indexHubFlow > 0) {
      addLink(nEnt, nIdx, indexHubFlow, {
        metric: "index_hub",
        actual: indexEntrySum,
      });
    }
  }

  const queueTotal = queue.total || 0;
  if (queueTotal > 0) {
    const nQueue = node("Antrian URL", COLORS.amber, 1);
    addLink(nDoc, nQueue, queueTotal, { metric: "queue" });
    for (const item of SANKEY_QUEUE_STATUS) {
      const v = queue[item.key] || 0;
      if (v > 0) {
        addLink(nQueue, node(item.label, item.color, 2), v, { metric: "queue_status" });
      }
    }
  }

  return { nodes: [...nodeMap.values()], links };
}

function formatSankeyTooltip(params) {
  if (params.dataType === "edge") {
    const d = params.data;
    let html = `${d.source} → ${d.target}<br/><strong>${fmt(d.value)}</strong>`;
    if (d.metric === "index_entries" && d.actual != null) {
      html += `<br/><span style="opacity:0.88">Entri indeks aktual: <strong>${fmt(d.actual)}</strong></span>`;
      if (d.indexEntrySum) {
        const share = ((d.actual / d.indexEntrySum) * 100).toFixed(1);
        html += `<br/><span style="opacity:0.75">≈ ${share}% dari entri indeks yang digambar</span>`;
      }
    } else if (d.metric === "index_hub" && d.actual != null) {
      html += `<br/><span style="opacity:0.88">Total entri indeks (semua tipe): <strong>${fmt(d.actual)}</strong></span>`;
      html += `<br/><span style="opacity:0.75">Lebar cabang = proporsi entri, dibatasi skala entitas</span>`;
    } else if (d.metric === "queue") {
      html += `<br/><span style="opacity:0.75">Jumlah URL antrian, bukan jumlah dokumen</span>`;
    }
    return html;
  }
  const total = (params.data?.value ?? 0) || 0;
  return `${params.name}<br/>Total alur: <strong>${fmt(total)}</strong>`;
}

function buildOverviewSankey(data) {
  const el = document.getElementById("overview-sankey-chart");
  if (!el) return null;

  const { nodes, links } = buildOverviewSankeyData(data);
  const sankeyLinks = links.map((link) => ({ ...link }));
  renderOverviewSankeyTable(sankeyLinks);

  const chart = initDompengEchart(el, DOMPENG_ECHART_STORE.overviewSankey);
  if (!chart) {
    showChartFallbackTable("overview-sankey-modal");
    return null;
  }

  chart.setOption(
    {
      backgroundColor: "transparent",
      animationDuration: 480,
      tooltip: {
        ...DOMPENG_ECHART_TOOLTIP,
        trigger: "item",
        triggerOn: "mousemove",
        formatter: formatSankeyTooltip,
      },
      series: [
        {
          type: "sankey",
          layout: "none",
          top: 10,
          bottom: 10,
          left: 8,
          right: 152,
          nodeAlign: "justify",
          nodeGap: 14,
          nodeWidth: 18,
          layoutIterations: 64,
          draggable: false,
          emphasis: {
            focus: "adjacency",
            lineStyle: { opacity: 0.72 },
          },
          levels: SANKEY_LEVEL_STYLES,
          lineStyle: {
            color: "gradient",
            curveness: 0.48,
            opacity: 0.45,
          },
          label: {
            show: true,
            position: "right",
            color: "#9eb4c8",
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 11,
            fontWeight: 600,
            formatter: "{b}",
          },
          data: nodes,
          links: sankeyLinks,
        },
      ],
    },
    { notMerge: true },
  );

  window.requestAnimationFrame(() => resizeDompengEchart(DOMPENG_ECHART_STORE.overviewSankey));
  return chart;
}

function sankeyTableNote(link) {
  if (link.metric === "index_entries" && link.actual != null) {
    return `Entri indeks aktual: ${fmt(link.actual)}`;
  }
  if (link.metric === "index_hub" && link.actual != null) {
    return `Total entri semua tipe: ${fmt(link.actual)}`;
  }
  if (link.metric === "queue") return "Satuan: URL antrian (bukan dokumen)";
  if (link.metric === "queue_status") return "Status antrian";
  if (link.metric === "geo") return "Partisi entitas";
  return "";
}

function renderOverviewSankeyTable(links) {
  renderDataTable(
    "overview-sankey-table",
    [
      { key: "source", label: "Dari" },
      { key: "target", label: "Ke" },
      { key: "value", label: "Alur", numeric: true },
      { key: "note", label: "Catatan" },
    ],
    (links || []).map((link) => ({
      source: link.source,
      target: link.target,
      value: link.value,
      note: sankeyTableNote(link),
    })),
  );
}

function resizeOverviewSankey() {
  resizeDompengEchart(DOMPENG_ECHART_STORE.overviewSankey);
}

function renderUsageBar(coverage, total, barId = "coverage-bar") {
  const top = coverage.reduce((a, b) => (b.pct > a.pct ? b : a), coverage[0] || { pct: 0, label: "" });
  const bar = document.getElementById(barId);
  if (!bar) return;
  clear(bar);

  const labels = document.createElement("div");
  labels.className = "usage-bar-labels";
  const left = document.createElement("span");
  appendText(left, "Proporsi kelengkapan field");
  const right = document.createElement("span");
  appendText(right, top.label ? `${top.label} · ${top.pct}% entitas` : "");
  labels.append(left, right);

  const track = document.createElement("div");
  track.className = "usage-bar-track";
  coverage.forEach((item, i) => {
    const segment = document.createElement("span");
    segment.className = "usage-bar-segment";
    segment.style.width = `${(item.value / total) * 100}%`;
    segment.style.background = COVERAGE_COLORS[i % COVERAGE_COLORS.length];
    segment.title = `${item.label}: ${fmt(item.value)}`;
    track.appendChild(segment);
  });

  bar.append(labels, track);
}

function renderQueueStats(queue, containerId = "queue-stats", { statusFilter = getQueueFilter() } = {}) {
  const total = queue.total || 1;
  const items = [
    { key: "pending", label: "Menunggu", value: queue.pending, color: COLORS.amber },
    { key: "done", label: "Berhasil", value: queue.done, color: COLORS.intel },
    { key: "failed", label: "Gagal", value: queue.failed, color: COLORS.danger },
  ];
  if (queue.processing > 0) {
    items.push({ key: "processing", label: "Sedang diproses", value: queue.processing, color: COLORS.cyan });
  }

  const visible =
    statusFilter === "all" ? items : items.filter((item) => item.key === statusFilter);

  const container = document.getElementById(containerId);
  if (!container) return;
  clear(container);
  const isSignalLegend = container.classList.contains("signal-legend");

  if (!visible.length) {
    const empty = document.createElement("p");
    empty.className = "overview-city-empty";
    appendText(empty, "Tidak ada status yang cocok.");
    container.appendChild(empty);
    return;
  }

  for (const item of visible) {
    const row = document.createElement("div");
    row.className = isSignalLegend ? "signal-legend__item" : "queue-stat";
    row.setAttribute("role", isSignalLegend ? "listitem" : undefined);
    if (statusFilter !== "all" && item.key === statusFilter) {
      row.dataset.highlight = "true";
    }

    const dot = document.createElement("span");
    dot.className = isSignalLegend ? "signal-legend__dot" : "queue-stat-dot";
    dot.style.background = item.color;

    const label = document.createElement("span");
    label.className = isSignalLegend ? "signal-legend__label" : "queue-stat-label";
    appendText(label, item.label);

    const value = document.createElement("span");
    value.className = isSignalLegend ? "signal-legend__value" : "queue-stat-value";
    appendText(value, `${fmt(item.value)} · ${pct(item.value, total)}%`);

    if (isSignalLegend) {
      const track = document.createElement("span");
      track.className = "signal-legend__track";
      track.setAttribute("aria-hidden", "true");
      const fill = document.createElement("span");
      fill.className = "signal-legend__fill";
      fill.style.width = `${Math.max(pct(item.value, total), 4)}%`;
      fill.style.background = item.color;
      track.appendChild(fill);
      row.append(dot, label, value, track);
    } else {
      row.append(dot, label, value);
    }
    container.appendChild(row);
  }
}

function renderIndexStats(indexTotal, containerId = "index-stats") {
  const container = document.getElementById(containerId);
  if (!container) return;
  clear(container);

  for (const [amount, caption] of [
    [indexTotal.entries, "ENTRI INDEKS"],
    [indexTotal.refs, "REFERENSI TERHUBUNG"],
  ]) {
    const stat = document.createElement("div");
    stat.className = "inline-stat";

    const strong = document.createElement("strong");
    appendText(strong, fmt(amount));

    const span = document.createElement("span");
    appendText(span, caption);

    stat.append(strong, span);
    container.appendChild(stat);
  }
}

function relationLabel(key) {
  const labels = {
    family: "Keluarga",
    phone: "Telepon",
    email: "Email",
    document: "Dokumen",
    mentions: "Disebut di dokumen",
    colleague: "Rekan kerja",
    nik: "NIK",
    npwp: "NPWP",
  };
  return labels[key] || "Relasi lain";
}

function appendFaint(el, text) {
  const span = document.createElement("span");
  span.className = "faint-pii";
  appendText(span, text ?? "—");
  el.appendChild(span);
}

function logField(lines, key, value) {
  if (value == null || value === "") return;
  lines.push(`${key}: ${value}`);
}

function genderLabel(gender) {
  if (gender === "male") return "Laki-laki";
  if (gender === "female") return "Perempuan";
  return gender || "—";
}

function sectorLabel(sector) {
  const labels = { public: "Publik", private: "Swasta", mixed: "Campuran" };
  return labels[sector] || sector || "—";
}

function formatEntityLog(entity) {
  const lines = [];
  lines.push(`=== ${entity.ref} ===`);
  logField(lines, "nama", entity.name);
  logField(lines, "jenis_kelamin", genderLabel(entity.gender));
  logField(lines, "tanggal_lahir", entity.dob);
  logField(lines, "tempat_lahir", entity.pob);
  logField(lines, "pekerjaan", entity.occupation);
  logField(lines, "sektor", sectorLabel(entity.sector));
  logField(lines, "status_nikah", entity.maritalStatus);
  logField(lines, "foto", entity.hasPhoto ? "ya" : "tidak");
  logField(lines, "jumlah_identitas", entity.identifierCount);
  logField(lines, "jumlah_relasi", entity.edgeCount);
  if (entity.resolutionScore != null) {
    logField(lines, "skor_resolusi", entity.resolutionScore);
  }
  if (entity.notesCount != null) {
    logField(lines, "catatan", entity.notesCount);
  }

  if (entity.identifiers?.length) {
    lines.push("");
    lines.push("[identitas]");
    for (const ident of entity.identifiers) {
      lines.push(`  ${ident.type}: ${ident.value}`);
    }
  }

  if (entity.relations && Object.keys(entity.relations).length) {
    lines.push("");
    lines.push("[relasi]");
    for (const [key, count] of Object.entries(entity.relations)) {
      lines.push(`  ${relationLabel(key)}: ${count}`);
    }
  }

  if (entity.relationLinks?.length) {
    lines.push("");
    lines.push("[relasi · konteks]");
    for (const link of entity.relationLinks) {
      lines.push(`  ${relationLabel(link.relation)}: ${link.label}`);
    }
  }

  if (entity.documents?.length) {
    lines.push("");
    lines.push("[dokumen]");
    for (const doc of entity.documents) {
      const when = doc.importedAt ? ` @ ${doc.importedAt}` : "";
      lines.push(`  ${doc.ref}${when}`);
      logField(lines, "    judul", doc.title);
      logField(lines, "    konteks", doc.context);
      logField(lines, "    berkas", doc.filename);
    }
  }

  lines.push("");
  return lines.join("\n");
}

function createPreviewChip(text, tone = "default") {
  const chip = document.createElement("span");
  chip.className = `preview-chip preview-chip--${tone}`;
  appendText(chip, text);
  return chip;
}

function createPreviewListItem(entity, index) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "preview-item log-line";
  btn.setAttribute("role", "option");
  btn.dataset.index = String(index);

  const top = document.createElement("div");
  top.className = "preview-item__top";

  const ref = document.createElement("span");
  ref.className = "preview-item__ref";
  appendText(ref, entity.ref);

  const name = document.createElement("span");
  name.className = "preview-item__name";
  appendFaint(name, entity.name || "—");

  top.append(ref, name);

  const meta = document.createElement("div");
  meta.className = "preview-item__meta";
  meta.append(
    createPreviewChip(`${entity.identifierCount} identitas`, "intel"),
    createPreviewChip(`${entity.edgeCount} relasi`, "cyan"),
  );
  if (entity.documentCount) {
    meta.append(createPreviewChip(`${entity.documentCount} dokumen`, "amber"));
  }
  if (entity.hasPhoto) {
    meta.append(createPreviewChip("foto", "muted"));
  }

  btn.append(top, meta);
  return btn;
}

function appendPreviewFieldRow(container, label, value, { faint = false } = {}) {
  const row = document.createElement("div");
  row.className = "preview-field";

  const key = document.createElement("span");
  key.className = "preview-field__label";
  appendText(key, label);

  const val = document.createElement("span");
  val.className = "preview-field__value";
  if (faint) appendFaint(val, value);
  else appendText(val, value ?? "—");

  row.append(key, val);
  container.appendChild(row);
}

function renderPreviewDetailSections(entity, container) {
  if (!container) return;
  clear(container);

  const profile = document.createElement("section");
  profile.className = "preview-section";
  const profileHead = document.createElement("h3");
  profileHead.className = "preview-section__title";
  appendText(profileHead, "Struktur entri");
  profile.appendChild(profileHead);

  const profileGrid = document.createElement("div");
  profileGrid.className = "preview-section__grid";
  appendPreviewFieldRow(profileGrid, "Nama", entity.name, { faint: true });
  appendPreviewFieldRow(profileGrid, "Jenis kelamin", genderLabel(entity.gender));
  appendPreviewFieldRow(profileGrid, "Tanggal lahir", entity.dob, { faint: true });
  appendPreviewFieldRow(profileGrid, "Tempat lahir", entity.pob, { faint: true });
  appendPreviewFieldRow(profileGrid, "Pekerjaan", entity.occupation, { faint: true });
  appendPreviewFieldRow(profileGrid, "Sektor", sectorLabel(entity.sector));
  appendPreviewFieldRow(profileGrid, "Status", entity.maritalStatus);
  appendPreviewFieldRow(profileGrid, "Foto", entity.hasPhoto ? "Ada" : "Tidak ada");
  profile.appendChild(profileGrid);
  container.appendChild(profile);

  if (entity.identifiers?.length) {
    const idSection = document.createElement("section");
    idSection.className = "preview-section";
    const idHead = document.createElement("h3");
    idHead.className = "preview-section__title";
    appendText(idHead, `Identitas (${entity.identifiers.length})`);
    idSection.appendChild(idHead);

    const idList = document.createElement("ul");
    idList.className = "preview-id-list";
    for (const ident of entity.identifiers) {
      const li = document.createElement("li");
      li.className = "preview-id-item";

      const type = document.createElement("span");
      type.className = "preview-id-type";
      appendText(type, ident.type);

      const value = document.createElement("span");
      value.className = "preview-id-value";
      appendFaint(value, ident.value);

      li.append(type, value);
      idList.appendChild(li);
    }
    idSection.appendChild(idList);
    container.appendChild(idSection);
  }

  if (entity.documents?.length) {
    const docSection = document.createElement("section");
    docSection.className = "preview-section";
    const docHead = document.createElement("h3");
    docHead.className = "preview-section__title";
    appendText(docHead, `Dokumen sumber (${entity.documents.length})`);
    docSection.appendChild(docHead);

    const docList = document.createElement("div");
    docList.className = "preview-doc-list";
    for (const doc of entity.documents) {
      const card = document.createElement("article");
      card.className = "preview-doc-card";

      const head = document.createElement("div");
      head.className = "preview-doc-card__head";
      const ref = document.createElement("span");
      ref.className = "preview-doc-card__ref";
      appendText(ref, doc.ref);
      const when = document.createElement("span");
      when.className = "preview-doc-card__date";
      appendText(when, doc.importedAt || "—");
      head.append(ref, when);

      const title = document.createElement("div");
      title.className = "preview-doc-card__title";
      appendFaint(title, doc.title || "—");

      const context = document.createElement("div");
      context.className = "preview-doc-card__meta";
      const ctxLabel = document.createElement("span");
      ctxLabel.className = "preview-doc-card__label";
      appendText(ctxLabel, "Konteks");
      const ctxVal = document.createElement("span");
      appendFaint(ctxVal, doc.context || "—");

      const fileLabel = document.createElement("span");
      fileLabel.className = "preview-doc-card__label";
      appendText(fileLabel, "Berkas");
      const fileVal = document.createElement("span");
      appendFaint(fileVal, doc.filename || "—");

      context.append(ctxLabel, ctxVal, fileLabel, fileVal);
      card.append(head, title, context);
      docList.appendChild(card);
    }
    docSection.appendChild(docList);
    container.appendChild(docSection);
  }

  const metrics = document.createElement("section");
  metrics.className = "preview-section preview-section--metrics";
  const metricsHead = document.createElement("h3");
  metricsHead.className = "preview-section__title";
  appendText(metricsHead, "Metrik agregat");
  metrics.appendChild(metricsHead);
  const metricsWrap = document.createElement("div");
  metricsWrap.className = "preview-relations";
  metricsWrap.append(
    createPreviewChip(`Skor resolusi ${entity.resolutionScore ?? "—"}`, "intel"),
    createPreviewChip(`${entity.notesCount ?? 0} catatan`, "muted"),
  );
  metrics.appendChild(metricsWrap);
  container.appendChild(metrics);
}

function previewGraphShortLabel(text, max = 18) {
  const raw = String(text || "").trim();
  if (raw.length <= max) return raw;
  return `${raw.slice(0, max - 1)}…`;
}

function previewGraphLabelText(d) {
  if (!d) return "";
  if (d.nodeKind === "entity") return previewGraphShortLabel(d.entityRef || d.name, 14);
  if (d.nodeKind === "relation_link") {
    return previewGraphShortLabel(d.relationContext || relationLabel(d.relationKey), 16);
  }
  if (d.nodeKind === "relation") {
    return `${previewGraphShortLabel(relationLabel(d.relationKey), 10)}\n×${fmt(d.relationCount)}`;
  }
  if (d.nodeKind === "identifier") {
    return `${previewGraphShortLabel(d.identType, 10)}\n${previewGraphShortLabel(d.identValue, 12)}`;
  }
  if (d.nodeKind === "document") {
    return `${previewGraphShortLabel(d.docRef || "Dok", 8)}\n${previewGraphShortLabel(d.docTitle, 12)}`;
  }
  if (d.nodeKind === "identifier_overflow") return `+${fmt(d.overflowCount)} id`;
  if (d.nodeKind === "relation_overflow") return `+${fmt(d.overflowCount)}`;
  return previewGraphShortLabel(d.name, 14);
}

function previewGraphLabelOpts(d) {
  const isHub = d.nodeKind === "entity";
  return {
    show: true,
    position: "right",
    fontSize: isHub ? 9 : 8,
    fontWeight: isHub ? 700 : 500,
    lineHeight: isHub ? 12 : 11,
    color: isHub ? "#e8f4fc" : "#b8c9db",
    fontFamily: "'IBM Plex Mono', monospace",
    formatter: () => previewGraphLabelText(d),
  };
}

function previewGraphNodeStyle(fill, borderWidth = 1.5) {
  return {
    color: fill,
    borderColor: "rgba(255, 255, 255, 0.38)",
    borderWidth,
    shadowBlur: 6,
    shadowColor: "rgba(0, 0, 0, 0.45)",
  };
}

function previewNodeTitle(node) {
  if (!node) return "Relasi";
  if (node.nodeKind === "entity") return node.entityRef || "Entitas";
  if (node.nodeKind === "relation_link") return relationLabel(node.relationKey);
  if (node.nodeKind === "relation") return relationLabel(node.relationKey);
  if (node.nodeKind === "identifier") return node.identType || "Identitas";
  if (node.nodeKind === "document") return node.docRef || "Dokumen";
  if (node.nodeKind === "identifier_overflow") return "Identitas lain";
  if (node.nodeKind === "relation_overflow") return relationLabel(node.relationKey);
  return node.name || "Simpul";
}

function formatPreviewNodeFocusText(node, entity) {
  const lines = [];

  if (node.nodeKind === "entity") {
    lines.push(`(hub entitas) ${node.entityRef || entity?.ref || "—"}`);
    return lines.join("\n");
  }

  if (node.nodeKind === "relation_link" || node.nodeKind === "relation") {
    lines.push(`[relasi · ${relationLabel(node.relationKey)}]`);
    lines.push("");
    if (node.nodeKind === "relation_link") {
      logField(lines, "konteks", node.relationContext || node.name);
      logField(lines, "tipe", node.relationKey);
    } else {
      logField(lines, "jumlah_tautan", node.relationCount);
      logField(lines, "tipe", node.relationKey);
    }
    lines.push("");
    lines.push(`entitas: ${entity?.ref || "—"}`);
    return lines.join("\n");
  }

  if (node.nodeKind === "identifier") {
    lines.push("[identitas]");
    lines.push("");
    logField(lines, "tipe", node.identType);
    logField(lines, "nilai", node.identValue);
    lines.push("");
    lines.push(`entitas: ${entity?.ref || "—"}`);
    return lines.join("\n");
  }

  if (node.nodeKind === "identifier_overflow") {
    lines.push("[identitas · ringkasan]");
    lines.push("");
    lines.push(`  +${fmt(node.overflowCount)} identitas lain tidak digambar`);
    return lines.join("\n");
  }

  if (node.nodeKind === "relation_overflow") {
    lines.push(`[relasi · ${relationLabel(node.relationKey)} · ringkasan]`);
    lines.push("");
    lines.push(`  +${fmt(node.overflowCount)} tautan lain tidak digambar`);
    return lines.join("\n");
  }

  if (node.nodeKind === "document") {
    const doc = (entity?.documents || []).find((d) => d.ref === node.docRef);
    lines.push(`[dokumen · ${node.docRef || "—"}]`);
    lines.push("");
    logField(lines, "judul", doc?.title || node.docTitle);
    logField(lines, "konteks", doc?.context);
    logField(lines, "berkas", doc?.filename);
    logField(lines, "impor", doc?.importedAt);
    lines.push("");
    lines.push(`entitas: ${entity?.ref || "—"}`);
    return lines.join("\n");
  }

  lines.push(node.name || "—");
  return lines.join("\n");
}

function formatPreviewRelationPanelText(node, entity) {
  if (!entity) return "Pilih entri dari daftar kiri.";
  const parts = [formatEntityLog(entity)];
  if (node) {
    parts.push("", "--- simpul terpilih ---", formatPreviewNodeFocusText(node, entity));
  }
  return parts.join("\n");
}

function previewLogAppendSpan(parent, text, role, { color } = {}) {
  const span = document.createElement("span");
  span.className = `preview-log-${role}`;
  if (color) span.style.color = color;
  span.textContent = String(text ?? "");
  parent.appendChild(span);
}

function previewLogAppendLine(parent) {
  parent.appendChild(document.createTextNode("\n"));
}

function previewLogAppendKeyValue(parent, key, value) {
  if (value == null || value === "") return;
  previewLogAppendSpan(parent, key, "key");
  previewLogAppendSpan(parent, ": ", "punct");
  previewLogAppendSpan(parent, String(value), "value");
  previewLogAppendLine(parent);
}

function previewLogAppendEntityHeader(parent, ref) {
  previewLogAppendSpan(parent, `=== ${ref} ===`, "entity", { color: PREVIEW_GRAPH_KIND_COLOR.entity });
  previewLogAppendLine(parent);
}

function previewLogAppendSection(parent, title, color) {
  previewLogAppendSpan(parent, `[${title}]`, "section", { color });
  previewLogAppendLine(parent);
}

function previewLogAppendRelationEntry(parent, relationKey, suffix) {
  previewLogAppendSpan(parent, "  ", "punct");
  previewLogAppendSpan(parent, `${previewGraphRelationLegendName(relationKey)}${suffix}`, "relation", {
    color: previewGraphRelationColor(relationKey),
  });
  previewLogAppendLine(parent);
}

function renderEntityLogDom(parent, entity) {
  previewLogAppendEntityHeader(parent, entity.ref);
  previewLogAppendKeyValue(parent, "nama", entity.name);
  previewLogAppendKeyValue(parent, "jenis_kelamin", genderLabel(entity.gender));
  previewLogAppendKeyValue(parent, "tanggal_lahir", entity.dob);
  previewLogAppendKeyValue(parent, "tempat_lahir", entity.pob);
  previewLogAppendKeyValue(parent, "pekerjaan", entity.occupation);
  previewLogAppendKeyValue(parent, "sektor", sectorLabel(entity.sector));
  previewLogAppendKeyValue(parent, "status_nikah", entity.maritalStatus);
  previewLogAppendKeyValue(parent, "foto", entity.hasPhoto ? "ya" : "tidak");
  previewLogAppendKeyValue(parent, "jumlah_identitas", entity.identifierCount);
  previewLogAppendKeyValue(parent, "jumlah_relasi", entity.edgeCount);
  if (entity.resolutionScore != null) {
    previewLogAppendKeyValue(parent, "skor_resolusi", entity.resolutionScore);
  }
  if (entity.notesCount != null) {
    previewLogAppendKeyValue(parent, "catatan", entity.notesCount);
  }

  if (entity.identifiers?.length) {
    previewLogAppendLine(parent);
    previewLogAppendSection(parent, "identitas", PREVIEW_GRAPH_KIND_COLOR.identifier);
    for (const ident of entity.identifiers) {
      previewLogAppendSpan(parent, "  ", "punct");
      previewLogAppendSpan(parent, ident.type, "ident-type", { color: PREVIEW_GRAPH_KIND_COLOR.identifier });
      previewLogAppendSpan(parent, ": ", "punct");
      previewLogAppendSpan(parent, ident.value, "value");
      previewLogAppendLine(parent);
    }
  }

  if (entity.relations && Object.keys(entity.relations).length) {
    previewLogAppendLine(parent);
    previewLogAppendSection(parent, "relasi", PREVIEW_GRAPH_KIND_COLOR.relation);
    for (const [key, count] of Object.entries(entity.relations)) {
      previewLogAppendRelationEntry(parent, key, `: ${count}`);
    }
  }

  if (entity.relationLinks?.length) {
    previewLogAppendLine(parent);
    previewLogAppendSection(parent, "relasi · konteks", PREVIEW_GRAPH_KIND_COLOR.relation);
    for (const link of entity.relationLinks) {
      const color = previewGraphRelationColor(link.relation);
      previewLogAppendSpan(parent, "  ", "punct");
      previewLogAppendSpan(parent, previewGraphRelationLegendName(link.relation), "relation", { color });
      previewLogAppendSpan(parent, ": ", "punct");
      previewLogAppendSpan(parent, link.label, "value");
      previewLogAppendLine(parent);
    }
  }

  if (entity.documents?.length) {
    previewLogAppendLine(parent);
    previewLogAppendSection(parent, "dokumen", PREVIEW_GRAPH_KIND_COLOR.document);
    for (const doc of entity.documents) {
      const when = doc.importedAt ? ` @ ${doc.importedAt}` : "";
      previewLogAppendSpan(parent, "  ", "punct");
      previewLogAppendSpan(parent, `${doc.ref}${when}`, "document", { color: PREVIEW_GRAPH_KIND_COLOR.document });
      previewLogAppendLine(parent);
      previewLogAppendKeyValue(parent, "    judul", doc.title);
      previewLogAppendKeyValue(parent, "    konteks", doc.context);
      previewLogAppendKeyValue(parent, "    berkas", doc.filename);
    }
  }

  previewLogAppendLine(parent);
}

function renderPreviewNodeFocusDom(parent, node, entity) {
  if (node.nodeKind === "entity") {
    previewLogAppendSpan(parent, "(hub entitas) ", "punct");
    previewLogAppendSpan(parent, node.entityRef || entity?.ref || "—", "entity", {
      color: PREVIEW_GRAPH_KIND_COLOR.entity,
    });
    previewLogAppendLine(parent);
    return;
  }

  if (node.nodeKind === "relation_link" || node.nodeKind === "relation") {
    const color = previewGraphRelationColor(node.relationKey);
    previewLogAppendSection(parent, `relasi · ${previewGraphRelationLegendName(node.relationKey)}`, color);
    previewLogAppendLine(parent);
    if (node.nodeKind === "relation_link") {
      previewLogAppendKeyValue(parent, "konteks", node.relationContext || node.name);
      previewLogAppendKeyValue(parent, "tipe", node.relationKey);
    } else {
      previewLogAppendKeyValue(parent, "jumlah_tautan", node.relationCount);
      previewLogAppendKeyValue(parent, "tipe", node.relationKey);
    }
    previewLogAppendSpan(parent, "entitas: ", "punct");
    previewLogAppendSpan(parent, entity?.ref || "—", "entity", { color: PREVIEW_GRAPH_KIND_COLOR.entity });
    previewLogAppendLine(parent);
    return;
  }

  if (node.nodeKind === "identifier") {
    previewLogAppendSection(parent, "identitas", PREVIEW_GRAPH_KIND_COLOR.identifier);
    previewLogAppendLine(parent);
    previewLogAppendKeyValue(parent, "tipe", node.identType);
    previewLogAppendKeyValue(parent, "nilai", node.identValue);
    previewLogAppendLine(parent);
    previewLogAppendSpan(parent, "entitas: ", "punct");
    previewLogAppendSpan(parent, entity?.ref || "—", "entity", { color: PREVIEW_GRAPH_KIND_COLOR.entity });
    previewLogAppendLine(parent);
    return;
  }

  if (node.nodeKind === "identifier_overflow") {
    previewLogAppendSection(parent, "identitas · ringkasan", PREVIEW_GRAPH_KIND_COLOR.identifier);
    previewLogAppendLine(parent);
    previewLogAppendSpan(parent, `  +${fmt(node.overflowCount)} identitas lain tidak digambar`, "muted");
    previewLogAppendLine(parent);
    return;
  }

  if (node.nodeKind === "relation_overflow") {
    const color = previewGraphRelationColor(node.relationKey);
    previewLogAppendSection(
      parent,
      `relasi · ${previewGraphRelationLegendName(node.relationKey)} · ringkasan`,
      color,
    );
    previewLogAppendLine(parent);
    previewLogAppendSpan(parent, `  +${fmt(node.overflowCount)} tautan lain tidak digambar`, "muted");
    previewLogAppendLine(parent);
    return;
  }

  if (node.nodeKind === "document") {
    const doc = (entity?.documents || []).find((d) => d.ref === node.docRef);
    previewLogAppendSection(parent, `dokumen · ${node.docRef || "—"}`, PREVIEW_GRAPH_KIND_COLOR.document);
    previewLogAppendLine(parent);
    previewLogAppendKeyValue(parent, "judul", doc?.title || node.docTitle);
    previewLogAppendKeyValue(parent, "konteks", doc?.context);
    previewLogAppendKeyValue(parent, "berkas", doc?.filename);
    previewLogAppendKeyValue(parent, "impor", doc?.importedAt);
    previewLogAppendLine(parent);
    previewLogAppendSpan(parent, "entitas: ", "punct");
    previewLogAppendSpan(parent, entity?.ref || "—", "entity", { color: PREVIEW_GRAPH_KIND_COLOR.entity });
    previewLogAppendLine(parent);
    return;
  }

  previewLogAppendSpan(parent, node.name || "—", "value");
  previewLogAppendLine(parent);
}

function renderPreviewRelationPanelDom(parent, node, entity) {
  renderEntityLogDom(parent, entity);
  if (!node) return;
  previewLogAppendLine(parent);
  previewLogAppendSpan(parent, "--- simpul terpilih ---", "divider", { color: COLORS.muted });
  previewLogAppendLine(parent);
  renderPreviewNodeFocusDom(parent, node, entity);
}

function renderPreviewRelationText(node, entity) {
  const pre = document.getElementById("preview-log-detail");
  const title = document.getElementById("preview-relation-text-title");
  const hint = document.getElementById("preview-relation-text-hint");
  if (!pre) return;

  const plain = formatPreviewRelationPanelText(node, entity);
  pre.dataset.plainText = plain;
  pre.replaceChildren();
  if (entity) {
    renderPreviewRelationPanelDom(pre, node, entity);
  } else {
    pre.textContent = plain;
  }

  if (title) title.textContent = node ? previewNodeTitle(node) : entity?.ref || "Ringkasan entri";
  if (hint) {
    hint.textContent = node
      ? "Ringkasan lengkap + fokus simpul"
      : entity
        ? "Ringkasan lengkap entri tersensor"
        : "";
  }
}

/** Bangun nodes + links force-graph untuk panel SMP-R. */
function buildPreviewGraphData(entity) {
  if (!entity) return { nodes: [], links: [], categories: PREVIEW_GRAPH_CATEGORIES };

  const nodes = [];
  const links = [];
  const entityId = "entity-hub";

  nodes.push({
    id: entityId,
    name: entity.ref || "Entitas",
    category: 0,
    symbolSize: PREVIEW_GRAPH_NODE_SIZE.entity,
    entityRef: entity.ref,
    nodeKind: "entity",
    itemStyle: previewGraphNodeStyle(PREVIEW_GRAPH_KIND_COLOR.entity, 2),
    label: previewGraphLabelOpts({
      nodeKind: "entity",
      entityRef: entity.ref,
      name: entity.ref,
    }),
  });

  const seenIds = new Set();
  const identifiers = [];
  for (const ident of entity.identifiers || []) {
    const key = `${ident.type}\0${ident.value}`;
    if (seenIds.has(key)) continue;
    seenIds.add(key);
    identifiers.push(ident);
  }

  const idSlice = identifiers.slice(0, PREVIEW_GRAPH_MAX_IDENTIFIERS);
  const idOverflow = identifiers.length - idSlice.length;

  idSlice.forEach((ident, index) => {
    const nodeId = `ident-${index}`;
    nodes.push({
      id: nodeId,
      name: ident.type,
      category: 1,
      symbolSize: PREVIEW_GRAPH_NODE_SIZE.identifier,
      nodeKind: "identifier",
      identType: ident.type,
      identValue: ident.value,
      itemStyle: previewGraphNodeStyle(PREVIEW_GRAPH_KIND_COLOR.identifier),
      label: previewGraphLabelOpts({
        nodeKind: "identifier",
        identType: ident.type,
        identValue: ident.value,
      }),
    });
    links.push({ source: entityId, target: nodeId, linkKind: "has_identifier" });
  });

  if (idOverflow > 0) {
    const overflowId = "ident-overflow";
    nodes.push({
      id: overflowId,
      name: `+${idOverflow} identitas`,
      category: 1,
      symbolSize: PREVIEW_GRAPH_NODE_SIZE.overflow,
      nodeKind: "identifier_overflow",
      overflowCount: idOverflow,
      itemStyle: previewGraphNodeStyle("rgba(94, 200, 255, 0.65)"),
      label: previewGraphLabelOpts({ nodeKind: "identifier_overflow", overflowCount: idOverflow }),
    });
    links.push({ source: entityId, target: overflowId, linkKind: "has_identifier" });
  }

  const relationLinks = (entity.relationLinks || []).slice(0, PREVIEW_GRAPH_MAX_RELATION_LINKS);
  const shownRelationCounts = {};

  if (relationLinks.length) {
    relationLinks.forEach((link, index) => {
      const relKey = link.relation || "unknown";
      shownRelationCounts[relKey] = (shownRelationCounts[relKey] || 0) + 1;
      const nodeId = `rel-link-${index}`;
      const color = previewGraphRelationColor(relKey);
      nodes.push({
        id: nodeId,
        name: link.label || relationLabel(relKey),
        category: 2,
        symbolSize: PREVIEW_GRAPH_NODE_SIZE.relation,
        nodeKind: "relation_link",
        relationKey: relKey,
        relationContext: link.label,
        itemStyle: previewGraphNodeStyle(color),
        label: previewGraphLabelOpts({
          nodeKind: "relation_link",
          relationKey: relKey,
          relationContext: link.label,
        }),
      });
      links.push({ source: entityId, target: nodeId, linkKind: "has_relation" });
    });

    for (const [key, total] of Object.entries(entity.relations || {})) {
      const shown = shownRelationCounts[key] || 0;
      const overflow = total - shown;
      if (overflow <= 0) continue;
      const overflowId = `rel-overflow-${key}`;
      nodes.push({
        id: overflowId,
        name: `+${overflow} ${relationLabel(key)}`,
        category: 2,
        symbolSize: PREVIEW_GRAPH_NODE_SIZE.overflow,
        nodeKind: "relation_overflow",
        relationKey: key,
        overflowCount: overflow,
        itemStyle: previewGraphNodeStyle(previewGraphRelationColor(key), 1),
        label: previewGraphLabelOpts({
          nodeKind: "relation_overflow",
          relationKey: key,
          overflowCount: overflow,
        }),
      });
      links.push({ source: entityId, target: overflowId, linkKind: "has_relation", value: overflow });
    }
  } else {
    const relationEntries = Object.entries(entity.relations || {}).sort((a, b) => b[1] - a[1]);
    relationEntries.forEach(([key, count]) => {
      const nodeId = `rel-${key}`;
      const color = previewGraphRelationColor(key);
      nodes.push({
        id: nodeId,
        name: relationLabel(key),
        category: 2,
        symbolSize: PREVIEW_GRAPH_NODE_SIZE.relation,
        nodeKind: "relation",
        relationKey: key,
        relationCount: count,
        itemStyle: previewGraphNodeStyle(color),
        label: previewGraphLabelOpts({
          nodeKind: "relation",
          relationKey: key,
          relationCount: count,
        }),
      });
      links.push({
        source: entityId,
        target: nodeId,
        linkKind: "has_relation",
        value: count,
        lineStyle: { width: Math.min(6, 1.5 + Math.log10(Math.max(count, 1)) * 2) },
      });
    });
  }

  (entity.documents || []).forEach((doc, index) => {
    const nodeId = `doc-${index}`;
    nodes.push({
      id: nodeId,
      name: doc.ref || `Dokumen ${index + 1}`,
      category: 3,
      symbolSize: PREVIEW_GRAPH_NODE_SIZE.document,
      nodeKind: "document",
      docRef: doc.ref,
      docTitle: doc.title,
      itemStyle: previewGraphNodeStyle(PREVIEW_GRAPH_KIND_COLOR.document),
      label: previewGraphLabelOpts({
        nodeKind: "document",
        docRef: doc.ref,
        docTitle: doc.title,
      }),
    });
    links.push({ source: entityId, target: nodeId, linkKind: "source_document" });
    const docRel = nodes.find(
      (n) =>
        (n.nodeKind === "relation" || n.nodeKind === "relation_link") && n.relationKey === "document",
    );
    if (docRel) {
      links.push({ source: nodeId, target: docRel.id, linkKind: "document_relation", lineStyle: { type: "dashed", opacity: 0.45 } });
    }
  });

  return { nodes, links, categories: PREVIEW_GRAPH_CATEGORIES };
}

function formatPreviewGraphTooltip(params) {
  const d = params.data || {};
  if (params.dataType === "edge") {
    const kind = d.linkKind || "";
    const targetId = String(d.target || "");
    if (kind === "has_identifier") return "Entitas → identitas tersensor";
    if (kind === "has_relation") {
      const relKey = targetId.replace(/^rel-/, "");
      return `Entitas → ${relationLabel(relKey)} · <strong>${fmt(d.value || 0)}</strong> tautan`;
    }
    if (kind === "source_document") return "Entitas → dokumen sumber";
    if (kind === "document_relation") return "Dokumen ↔ relasi dokumen";
    return `${d.source} → ${d.target}`;
  }

  if (d.nodeKind === "entity") {
    return [`<strong>${d.entityRef || d.name}</strong>`, "Hub entitas sampel"].join("<br/>");
  }
  if (d.nodeKind === "identifier") {
    return [`<strong>${d.identType}</strong>`, previewGraphShortLabel(d.identValue, 40)].join("<br/>");
  }
  if (d.nodeKind === "identifier_overflow") {
    return `<strong>+${fmt(d.overflowCount)}</strong> identitas lain (tidak digambar)`;
  }
  if (d.nodeKind === "relation") {
    return [`<strong>${relationLabel(d.relationKey)}</strong>`, `${fmt(d.relationCount)} relasi di graf`].join("<br/>");
  }
  if (d.nodeKind === "relation_link") {
    return [`<strong>${relationLabel(d.relationKey)}</strong>`, previewGraphShortLabel(d.relationContext, 48)].join("<br/>");
  }
  if (d.nodeKind === "relation_overflow") {
    return [`<strong>${relationLabel(d.relationKey)}</strong>`, `+${fmt(d.overflowCount)} tautan lain (tidak digambar)`].join("<br/>");
  }
  if (d.nodeKind === "document") {
    return [`<strong>${d.docRef || d.name}</strong>`, previewGraphShortLabel(d.docTitle, 48)].join("<br/>");
  }
  return d.name || "";
}

function bindPreviewGraphClick(chart) {
  if (!chart || chart._dompengPreviewClickBound) return;
  chart._dompengPreviewClickBound = true;
  chart.on("click", (params) => {
    if (params.dataType !== "node" || !params.data) return;
    renderPreviewRelationText(params.data, previewGraphActiveEntity);
    chart.dispatchAction({
      type: "focusNodeAdjacency",
      seriesIndex: params.seriesIndex,
      dataIndex: params.dataIndex,
    });
    const cap = document.getElementById("preview-graph-caption");
    if (cap) cap.textContent = `Terpilih: ${previewNodeTitle(params.data)} · klik area kosong untuk reset`;
  });
  if (chart._dompengPreviewZrBound) return;
  chart._dompengPreviewZrBound = true;
  chart.getZr().on("click", (event) => {
    if (event.target) return;
    chart.dispatchAction({ type: "unfocusNodeAdjacency", seriesIndex: 0 });
    renderPreviewRelationText(null, previewGraphActiveEntity);
    const cap = document.getElementById("preview-graph-caption");
    if (cap && previewGraphActiveEntity) {
      const n = buildPreviewGraphData(previewGraphActiveEntity).nodes.length - 1;
      cap.textContent = `${fmt(n)} simpul · ringkasan lengkap di panel kanan`;
    }
  });
}

function buildPreviewRelationGraph(entity) {
  const el = document.getElementById("preview-relation-graph");
  const caption = document.getElementById("preview-graph-caption");
  if (!el) return null;

  const chart = initDompengEchart(el, DOMPENG_ECHART_STORE.previewGraph);
  if (!chart) return null;

  previewGraphActiveEntity = entity || null;

  if (!entity) {
    chart.setOption(
      {
        backgroundColor: "transparent",
        graphic: {
          type: "text",
          left: "center",
          top: "middle",
          style: {
            text: "Pilih entri di daftar kiri",
            fill: COLORS.muted,
            font: "600 12px 'IBM Plex Mono', monospace",
          },
        },
      },
      { notMerge: true },
    );
    if (caption) caption.textContent = "Pilih entri untuk melihat graf relasi";
    renderPreviewRelationText(null, null);
    return chart;
  }

  const { nodes, links, categories } = buildPreviewGraphData(entity);
  const legendItems = previewGraphLegendData(nodes);
  if (caption) {
    caption.textContent = `${fmt(nodes.length - 1)} simpul · label pada graf · ringkasan di panel kanan`;
  }
  renderPreviewRelationText(null, entity);

  if (!nodes.length) {
    chart.setOption(
      {
        backgroundColor: "transparent",
        graphic: {
          type: "text",
          left: "center",
          top: "middle",
          style: {
            text: "Tidak ada relasi untuk digambar",
            fill: COLORS.muted,
            font: "600 12px 'IBM Plex Mono', monospace",
          },
        },
      },
      { notMerge: true },
    );
    return chart;
  }

  chart.setOption(
    {
      backgroundColor: "transparent",
      animationDuration: 480,
      tooltip: {
        ...DOMPENG_ECHART_TOOLTIP,
        trigger: "item",
        formatter: formatPreviewGraphTooltip,
      },
      legend: {
        data: legendItems,
        bottom: 4,
        type: legendItems.length > 6 ? "scroll" : "plain",
        textStyle: {
          color: "#9eb4c8",
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 9,
        },
        itemWidth: 8,
        itemHeight: 8,
        itemGap: 10,
      },
      series: [
        {
          type: "graph",
          layout: "force",
          roam: true,
          draggable: true,
          categories,
          data: nodes,
          links,
          top: 12,
          bottom: legendItems.length > 4 ? 40 : 28,
          left: 8,
          right: 8,
          force: {
            repulsion: nodes.length > 14 ? 200 : 160,
            gravity: 0.12,
            edgeLength: [36, 96],
            friction: 0.58,
          },
          lineStyle: {
            color: "source",
            curveness: 0.18,
            opacity: 0.72,
            width: 1.5,
          },
          emphasis: {
            focus: "adjacency",
            scale: 1.35,
            lineStyle: { width: 3, opacity: 0.95 },
            itemStyle: {
              shadowBlur: 14,
              shadowColor: "rgba(78, 201, 255, 0.5)",
              borderWidth: 2.5,
            },
          },
          blur: {
            itemStyle: { opacity: 0.22 },
            lineStyle: { opacity: 0.12 },
          },
          label: {
            show: true,
            fontFamily: "'IBM Plex Mono', monospace",
          },
          labelLayout: {
            hideOverlap: true,
          },
        },
      ],
    },
    { notMerge: true },
  );

  bindPreviewGraphClick(chart);
  window.requestAnimationFrame(() => resizeDompengEchart(DOMPENG_ECHART_STORE.previewGraph));
  return chart;
}

function resizePreviewRelationGraph() {
  resizeDompengEchart(DOMPENG_ECHART_STORE.previewGraph);
}

function renderPreviewBrief(entities) {
  const meta = document.getElementById("preview-meta");
  if (!meta) return;

  const rows = entities || [];
  if (!rows.length) {
    meta.hidden = true;
    meta.textContent = "";
    return;
  }

  const totalDocs = rows.reduce((sum, e) => sum + (e.documentCount || 0), 0);
  const totalIds = rows.reduce((sum, e) => sum + (e.identifierCount || 0), 0);
  const withPhoto = rows.filter((e) => e.hasPhoto).length;
  const avgIds = Math.round(totalIds / rows.length);

  meta.hidden = false;
  meta.textContent = `${fmt(rows.length)} sampel · rata-rata ${fmt(avgIds)} identitas · ${fmt(totalDocs)} dok · ${fmt(withPhoto)} foto`;
}

function renderShowcaseEntities(entities) {
  const listEl = document.getElementById("preview-log-list");
  const detailEl = document.getElementById("preview-log-detail");
  const detailTitle = document.getElementById("preview-detail-title");
  const listMeta = document.getElementById("preview-list-meta");
  const copyBtn = document.getElementById("preview-copy-log");
  if (!listEl || !detailEl) return;

  const rows = entities || [];
  let activeIndex = -1;
  let visibleIndices = [];

  const moduleCaption = document.getElementById("preview-module-caption");
  if (moduleCaption) {
    moduleCaption.textContent = rows.length
      ? "Graf relasi (kiri) · detail teks per simpul (kanan) · data disamarkan"
      : "Belum ada sampel — jalankan ./summary.sh";
  }

  renderPreviewBrief(rows);

  const computeVisibleIndices = () => {
    const filters = getPreviewFilters();
    return rows.map((_, index) => index).filter((index) => previewEntityMatches(rows[index], filters));
  };

  const updateListMeta = () => {
    if (!listMeta) return;
    if (!rows.length) {
      listMeta.textContent = "0 entri";
      return;
    }
    const filters = getPreviewFilters();
    const hasFilter = Boolean(filters.query) || filters.type !== "all";
    const shown = visibleIndices.length;
    if (hasFilter) {
      listMeta.textContent = `${fmt(shown)} dari ${fmt(rows.length)} · ↑↓ navigasi`;
      return;
    }
    listMeta.textContent = `${fmt(rows.length)} entri · ↑↓ navigasi`;
  };

  const syncListSelection = () => {
    for (const btn of listEl.querySelectorAll(".preview-item")) {
      const index = Number(btn.dataset.index);
      const selected = index === activeIndex;
      btn.classList.toggle("is-active", selected);
      btn.setAttribute("aria-selected", selected ? "true" : "false");
      btn.tabIndex = selected ? 0 : -1;
    }
  };

  const showEmptyDetail = (message) => {
    previewGraphActiveEntity = null;
    if (detailEl) {
      detailEl.replaceChildren();
      detailEl.textContent = message;
      delete detailEl.dataset.plainText;
    }
    renderPreviewRelationText(null, null);
    if (detailTitle) detailTitle.textContent = "Detail entri";
    if (copyBtn) copyBtn.hidden = true;
    buildPreviewRelationGraph(null);
  };

  const setActiveEntity = (rowIndex, { focusList = false } = {}) => {
    if (rowIndex < 0 || rowIndex >= rows.length) return;
    activeIndex = rowIndex;
    const entity = rows[rowIndex];

    previewGraphActiveEntity = entity;
    buildPreviewRelationGraph(entity);
    if (detailTitle) {
      detailTitle.textContent = `${entity.ref} · ${entity.identifierCount} id · ${entity.edgeCount} rel`;
    }
    if (copyBtn) copyBtn.hidden = false;

    if (document.querySelector(".tab-panel.is-active")?.dataset.tab === "preview") {
      history.replaceState(null, "", `#pratinjau:${rowIndex + 1}`);
    }

    syncListSelection();
    if (focusList) {
      listEl.querySelector(`.preview-item[data-index="${rowIndex}"]`)?.focus();
    }
  };

  const moveWithinVisible = (delta) => {
    if (!visibleIndices.length) return;
    const pos = visibleIndices.indexOf(activeIndex);
    const nextPos = pos < 0 ? 0 : Math.max(0, Math.min(visibleIndices.length - 1, pos + delta));
    setActiveEntity(visibleIndices[nextPos], { focusList: true });
  };

  const renderListItems = () => {
    clear(listEl);
    visibleIndices = computeVisibleIndices();

    if (!visibleIndices.length) {
      const empty = document.createElement("p");
      empty.className = "preview-list-empty";
      empty.textContent = rows.length
        ? "Tidak ada sampel yang cocok dengan filter."
        : "Tidak ada sampel tersensor.";
      listEl.appendChild(empty);
      showEmptyDetail(rows.length ? "# tidak ada sampel yang cocok" : "# tidak ada sampel tersensor");
      updateListMeta();
      return;
    }

    for (const index of visibleIndices) {
      const item = createPreviewListItem(rows[index], index);
      item.addEventListener("click", () => setActiveEntity(index, { focusList: true }));
      listEl.appendChild(item);
    }

    updateListMeta();
  };

  const applyFilter = ({ preserveSelection = true } = {}) => {
    renderListItems();
    if (!visibleIndices.length) return;

    if (preserveSelection && visibleIndices.includes(activeIndex)) {
      setActiveEntity(activeIndex);
      return;
    }
    setActiveEntity(visibleIndices[0], { focusList: true });
  };

  if (listEl._dompengKeyHandler) listEl.removeEventListener("keydown", listEl._dompengKeyHandler);
  listEl._dompengKeyHandler = (event) => {
    if (!rows.length || !visibleIndices.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveWithinVisible(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveWithinVisible(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveEntity(visibleIndices[0], { focusList: true });
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveEntity(visibleIndices[visibleIndices.length - 1], { focusList: true });
    }
  };
  listEl.addEventListener("keydown", listEl._dompengKeyHandler);

  if (copyBtn) {
    if (copyBtn._dompengCopyHandler) copyBtn.removeEventListener("click", copyBtn._dompengCopyHandler);
    copyBtn._dompengCopyHandler = async () => {
      if (activeIndex < 0) return;
      const text =
        detailEl?.dataset.plainText || formatPreviewRelationPanelText(null, rows[activeIndex]);
      try {
        await navigator.clipboard.writeText(text);
        const prev = copyBtn.textContent;
        copyBtn.textContent = "Tersalin";
        window.setTimeout(() => {
          copyBtn.textContent = prev;
        }, 1400);
      } catch {
        copyBtn.textContent = "Gagal salin";
      }
    };
    copyBtn.addEventListener("click", copyBtn._dompengCopyHandler);
    copyBtn.hidden = rows.length === 0;
  }

  if (!rows.length) {
    showEmptyDetail("# tidak ada sampel tersensor");
    updateListMeta();
    previewFilterHandler = null;
    return;
  }

  previewFilterHandler = () => applyFilter({ preserveSelection: true });

  const hashState = typeof window.dashboardHashState === "function" ? window.dashboardHashState() : null;
  const requested = hashState?.id === "preview" ? Number(hashState.detail) - 1 : -1;
  if (requested >= 0 && requested < rows.length) {
    renderListItems();
    setActiveEntity(requested, { focusList: true });
  } else {
    applyFilter({ preserveSelection: false });
  }
}

function renderRecentDocsTable(docs, tbodyId, limit = 0) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  clear(tbody);

  const list = limit > 0 ? (docs || []).slice(0, limit) : docs || [];
  for (const doc of list) {
    const row = document.createElement("tr");

    const imported = document.createElement("td");
    imported.className = "timestamp";
    appendText(imported, dateLabel(doc.imported_at));

    const mentions = document.createElement("td");
    mentions.className = "num";
    appendText(mentions, fmt(doc.mentions));

    const title = document.createElement("td");
    title.className = "title-cell censored";
    appendFaint(title, doc.title || "—");

    row.append(imported, mentions, title);
    tbody.appendChild(row);
  }
}

function buildCoverageChart(coverage, canvasId = "coverage-chart") {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return null;
  if (typeof Chart === "undefined") {
    return null;
  }

  const existing = Chart.getChart(ctx);
  if (existing) existing.destroy();

  return new Chart(ctx, {
    type: "bar",
    data: {
      labels: coverage.map((c) => c.label),
      datasets: [
        {
          label: "Resolved entities",
          data: coverage.map((c) => c.value),
          backgroundColor: COVERAGE_COLORS,
          borderRadius: 2,
          borderSkipped: false,
        },
      ],
    },
    options: {
      ...chartDefaults,
      indexAxis: "y",
      plugins: {
        ...chartDefaults.plugins,
        legend: { display: false },
      },
      scales: {
        x: chartDefaults.scales.x,
        y: {
          ...chartDefaults.scales.y,
          grid: { display: false },
        },
      },
    },
  });
}

function queueCenterLabelPlugin(queue, { compact = false, ops = false } = {}) {
  return {
    id: "queueCenterLabel",
    beforeDraw(chart) {
      const { width, height, ctx } = chart;
      const total = (queue.pending || 0) + (queue.done || 0) + (queue.failed || 0) + (queue.processing || 0);
      const pct = total ? Math.round((queue.done / total) * 100) : 0;
      const pctSize = ops ? Math.min(20, width * 0.13) : compact ? Math.min(18, width * 0.14) : Math.min(22, width * 0.12);
      const labelSize = ops ? Math.max(8, width * 0.05) : compact ? Math.max(8, width * 0.055) : 9;
      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `700 ${pctSize}px "IBM Plex Mono", monospace`;
      ctx.fillStyle = "#00d4aa";
      ctx.fillText(ops ? fmt(total) : `${pct}%`, width / 2, height / 2 - (ops ? 6 : compact ? 5 : 6));
      ctx.font = `600 ${labelSize}px "IBM Plex Mono", monospace`;
      ctx.fillStyle = "#7a8fa8";
      ctx.fillText(ops ? "URL" : "SELESAI", width / 2, height / 2 + (ops ? 13 : compact ? 12 : 14));
      ctx.restore();
    },
  };
}

/** Segmen donut antrian — selalu tampil meski nilainya 0 (Chart.js mengabaikan slice 0). */
const QUEUE_CHART_SEGMENTS = [
  { label: "Menunggu", key: "pending", color: COLORS.amber },
  { label: "Selesai", key: "done", color: COLORS.intel },
  { label: "Gagal", key: "failed", color: COLORS.danger },
  { label: "Diproses", key: "processing", color: COLORS.cyan, optional: true },
];

function queueChartSegments(queue, { statusFilter = "all" } = {}) {
  const core = QUEUE_CHART_SEGMENTS.filter((s) => !s.optional);
  const extra = QUEUE_CHART_SEGMENTS.filter((s) => s.optional && (queue[s.key] || 0) > 0);
  const segments = [...core, ...extra];
  if (statusFilter === "all") return segments;
  return segments.filter((segment) => segment.key === statusFilter);
}

/** Nilai tampilan minimum agar slice 0 tetap terlihat di donut. */
function queueChartDisplayValues(rawValues) {
  const sum = rawValues.reduce((acc, v) => acc + v, 0);
  if (sum === 0) {
    return rawValues.map(() => 1);
  }
  const floor = sum * 0.012;
  return rawValues.map((v) => (v > 0 ? v : floor));
}

function buildQueueChart(queue, canvasId = "queue-chart", options = {}) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return null;
  if (typeof Chart === "undefined") {
    return null;
  }

  const existing = Chart.getChart(ctx);
  if (existing) existing.destroy();

  const statusFilter = options.statusFilter ?? getQueueFilter();
  const segments = queueChartSegments(queue, { statusFilter });
  if (!segments.length) return null;
  const labels = segments.map((s) => s.label);
  const colors = segments.map((s) => s.color);
  const rawValues = segments.map((s) => queue[s.key] || 0);
  const displayValues = queueChartDisplayValues(rawValues);
  const total = rawValues.reduce((acc, v) => acc + v, 0);

  const isAnalytics = canvasId === "queue-chart";
  const isOverview = canvasId === "overview-queue-chart";
  const isOps = canvasId === "ops-queue-donut";
  const plugins = {
    legend: { display: false },
    tooltip: {
      ...chartDefaults.plugins.tooltip,
      callbacks: {
        label(ctx) {
          const real = rawValues[ctx.dataIndex] ?? 0;
          const pct = total ? Math.round((real / total) * 100) : 0;
          return `${ctx.label}: ${fmt(real)} (${pct}%)`;
        },
      },
    },
  };

  const chartPlugins = [queueCenterLabelPlugin(queue, { compact: isOverview, ops: isOps })];

  return new Chart(ctx, {
    type: "doughnut",
    data: {
      labels,
      datasets: [
        {
          data: displayValues,
          backgroundColor: colors,
          borderColor: "#0b1118",
          borderWidth: isOps ? 3 : isAnalytics ? 4 : 3,
          hoverOffset: isOps ? 6 : isAnalytics ? 8 : 5,
          spacing: isOps ? 2 : isAnalytics ? 2 : 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: isOps ? "54%" : isAnalytics ? "56%" : isOverview ? "58%" : "60%",
      layout: { padding: isOps ? 6 : isAnalytics ? 6 : isOverview ? 8 : 4 },
      plugins,
    },
    plugins: chartPlugins,
  });
}

function resizeOpsQueueDonut() {
  const canvas = document.getElementById("ops-queue-donut");
  if (!canvas || typeof Chart === "undefined") return;
  const chart = Chart.getChart(canvas);
  if (chart?.resize) chart.resize();
}

/** Radar profil antrian di ringkasan GEO (sumbu = status URL, nilai = % dari total). */
function buildQueueRadarChart(queue, canvasId = "overview-queue-radar", options = {}) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;
  if (typeof Chart === "undefined") {
    renderQueueRadarFallback(queue, "overview-queue-radar-fallback");
    return null;
  }

  const fallback = document.getElementById("overview-queue-radar-fallback");
  if (fallback) {
    fallback.hidden = true;
    clear(fallback);
  }

  const existing = Chart.getChart(canvas);
  if (existing) existing.destroy();

  const statusFilter = options.statusFilter ?? getQueueFilter();
  const segments = queueChartSegments(queue, { statusFilter });
  if (!segments.length) return null;

  const total = queue.total || 0;
  const labels = segments.map((s) => s.label);
  const rawValues = segments.map((s) => queue[s.key] || 0);
  const pctValues = rawValues.map((v) => (total ? Math.round((v / total) * 1000) / 10 : 0));
  const pointColors = segments.map((s) => s.color);

  return new Chart(canvas, {
    type: "radar",
    data: {
      labels,
      datasets: [
        {
          label: "Antrian URL",
          data: pctValues,
          backgroundColor: "rgba(230, 168, 23, 0.18)",
          borderColor: COLORS.amber,
          borderWidth: 2,
          pointBackgroundColor: pointColors,
          pointBorderColor: "#0b1118",
          pointBorderWidth: 1,
          pointRadius: 4,
          pointHoverRadius: 5,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          ...chartDefaults.plugins.tooltip,
          callbacks: {
            label(ctx) {
              const raw = rawValues[ctx.dataIndex] ?? 0;
              return `${ctx.label}: ${fmt(raw)} (${ctx.formattedValue}%)`;
            },
            afterBody() {
              return total ? `Total antrian: ${fmt(total)} URL` : "";
            },
          },
        },
      },
      scales: {
        r: {
          beginAtZero: true,
          max: 100,
          ticks: {
            display: false,
            stepSize: 25,
          },
          grid: { color: COLORS.grid },
          angleLines: { color: COLORS.grid },
          pointLabels: {
            color: COLORS.muted,
            font: { family: "'IBM Plex Mono', monospace", size: 10, weight: "600" },
            padding: 6,
          },
        },
      },
    },
  });
}

function updateOverviewQueueRadarCaption(queue, statusFilter = "all") {
  const el = document.getElementById("overview-queue-radar-caption");
  if (!el) return;

  const total = queue.total || 0;
  if (!total) {
    el.textContent = "Belum ada URL di antrian unduhan";
    return;
  }

  const filterLabel = QUEUE_FILTER_LABELS[statusFilter];
  const items = queueSignalItems(queue);
  const visible =
    statusFilter === "all" ? items : items.filter((item) => item.key === statusFilter);

  const parts = visible.map(
    (item) => `${item.short} ${fmt(item.value)} (${pct(item.value, total)}%)`,
  );
  el.textContent =
    statusFilter === "all"
      ? parts.join(" · ")
      : `${filterLabel}: ${parts[0] || "—"} · total ${fmt(total)} URL`;
}

function renderQueueRadarFallback(queue, containerId = "overview-queue-radar-fallback") {
  const container = document.getElementById(containerId);
  const canvas = document.getElementById("overview-queue-radar");
  if (!container) return;
  clear(container);

  const total = queue.total || 0;
  const items = queueSignalItems(queue);

  if (canvas) canvas.hidden = true;
  container.hidden = false;

  if (!total) {
    const li = document.createElement("li");
    appendText(li, "Belum ada URL di antrian.");
    container.appendChild(li);
    return;
  }

  for (const item of items) {
    const li = document.createElement("li");
    appendText(li, `${item.label}: ${fmt(item.value)} (${pct(item.value, total)}%)`);
    container.appendChild(li);
  }
}

function renderOverviewQueueRadar(queue, options = {}) {
  const statusFilter = options.statusFilter ?? getQueueFilter();
  updateOverviewQueueRadarCaption(queue, statusFilter);
  const chart = buildQueueRadarChart(queue, "overview-queue-radar", { statusFilter });
  const canvas = document.getElementById("overview-queue-radar");
  if (chart && canvas) canvas.hidden = false;
}

let indexChartRowsCache = [];

function disposeIndexBarChart() {
  const chart = window[DOMPENG_ECHART_STORE.indexBar];
  if (!chart) return;
  try {
    chart.dispose();
  } catch {
    /* ignore */
  }
  window[DOMPENG_ECHART_STORE.indexBar] = null;
}

function indexVolumeRatio(entries, refs) {
  if (!entries) return "—";
  return `${(refs / entries).toFixed(2)}×`;
}

function indexVolumeCompact(value) {
  return fmt(value);
}

function indexVolumeBarHeight(value, max) {
  if (!max || !value) return 4;
  return Math.max(4, Math.round((value / max) * 100));
}

function createIndexVolumeColumn(row, maxEntries, maxRefs) {
  const shared = row.kind !== "unique";
  const entries = row.entries || 0;
  const refs = row.refs || 0;
  const ratio = indexVolumeRatio(entries, refs);
  const ratioHigh = entries > 0 && refs > entries;

  const col = document.createElement("article");
  col.className = `index-volume-col index-volume-col--${shared ? "shared" : "unique"}`;
  col.setAttribute("role", "listitem");
  col.title = `${row.type}: ${fmt(entries)} entri, ${fmt(refs)} referensi, rasio ${ratio}`;

  const bars = document.createElement("div");
  bars.className = "index-volume-col__bars";
  bars.setAttribute("aria-hidden", "true");

  for (const [tone, val, max, label] of [
    ["entries", entries, maxEntries, "Entri"],
    ["refs", refs, maxRefs, "Referensi"],
  ]) {
    const bar = document.createElement("div");
    bar.className = `index-volume-col__bar index-volume-col__bar--${tone}`;
    bar.title = `${label}: ${fmt(val)}`;

    const fill = document.createElement("span");
    fill.className = "index-volume-col__fill";
    fill.style.height = `${indexVolumeBarHeight(val, max)}%`;

    bar.appendChild(fill);
    bars.appendChild(bar);
  }

  const meta = document.createElement("div");
  meta.className = "index-volume-col__meta";

  const nums = document.createElement("p");
  nums.className = "index-volume-col__nums";
  appendText(nums, `${indexVolumeCompact(entries)} · ${indexVolumeCompact(refs)}`);

  const title = document.createElement("h3");
  title.className = "index-volume-col__title";
  appendText(title, row.type);

  const foot = document.createElement("p");
  foot.className = `index-volume-col__foot${ratioHigh ? " index-volume-col__foot--high" : ""}`;
  const kind = document.createElement("span");
  kind.className = "index-volume-col__kind";
  kind.title = shared ? "Indeks silang" : "Indeks unik";
  appendText(kind, shared ? "S" : "U");
  appendText(foot, ` · ${ratio}`);
  foot.prepend(kind);

  meta.append(nums, title, foot);
  col.append(bars, meta);
  return col;
}

/** 8 kolom vertikal: bar tipis entri (cyan) + referensi (amber) per tipe. */
function buildIndexBarChart(indexRows) {
  const cols = document.getElementById("index-volume-cols");
  const emptyEl = document.getElementById("index-volume-empty");
  if (!cols) return null;

  disposeIndexBarChart();

  indexChartRowsCache = [...(indexRows || [])]
    .filter((row) => (row.entries || 0) > 0 || (row.refs || 0) > 0)
    .sort((a, b) => (b.entries || 0) - (a.entries || 0));

  clear(cols);

  if (!indexChartRowsCache.length) {
    if (emptyEl) emptyEl.hidden = false;
    showChartFallbackTable("index-chart-modal");
    return null;
  }

  if (emptyEl) emptyEl.hidden = true;

  const maxEntries = Math.max(...indexChartRowsCache.map((row) => row.entries || 0), 1);
  const maxRefs = Math.max(...indexChartRowsCache.map((row) => row.refs || 0), 1);

  for (const row of indexChartRowsCache) {
    cols.appendChild(createIndexVolumeColumn(row, maxEntries, maxRefs));
  }

  return cols;
}

function resizeIndexBarChart() {
  /* grid kartu — tidak perlu resize canvas */
}

function changelogKindLabel(kind) {
  return CHANGELOG_KIND_LABELS[kind] || kind;
}

function changelogKindClass(kind) {
  const key = String(kind || "").toLowerCase();
  if (key === "added") return "changelog-kind--added";
  if (key === "changed") return "changelog-kind--changed";
  if (key === "fixed") return "changelog-kind--fixed";
  if (key === "removed") return "changelog-kind--removed";
  return "changelog-kind--default";
}

function appendChangelogItemText(li, text) {
  const parts = String(text).split(/(`[^`]+`)/g);
  for (const part of parts) {
    if (part.startsWith("`") && part.endsWith("`")) {
      const code = document.createElement("code");
      appendText(code, part.slice(1, -1));
      li.appendChild(code);
    } else if (part) {
      li.appendChild(document.createTextNode(part));
    }
  }
}

function renderChangelogHero(changelog, target = CHANGELOG_TARGETS.page) {
  const container = document.getElementById(target.heroId);
  if (!container) return;
  clear(container);

  const version = changelog.latestVersion || "—";
  const date = changelog.latestDate || "—";
  const total = changelog.totalReleases || 0;

  const main = document.createElement("div");
  main.className = "changelog-hero-main";

  const badge = document.createElement("span");
  badge.className = "changelog-hero-badge";
  appendText(badge, "CURRENT");

  const ver = document.createElement("span");
  ver.className = "changelog-hero-version";
  appendText(ver, version);

  const dt = document.createElement("span");
  dt.className = "changelog-hero-date";
  appendText(dt, date);

  main.append(badge, ver, dt);

  const aside = document.createElement("div");
  aside.className = "changelog-hero-aside";

  const releases = document.createElement("span");
  releases.className = "changelog-hero-stat";
  appendText(releases, `${fmt(total)} rilis`);

  const pipe = document.createElement("span");
  pipe.className = "changelog-hero-pipe";
  appendText(pipe, "summary.sh");

  aside.append(releases, pipe);
  container.append(main, aside);
}

function renderChangelogKindBar(summary, container) {
  const kinds = [
    { key: "Added", label: "Added", tone: "added" },
    { key: "Changed", label: "Changed", tone: "changed" },
    { key: "Fixed", label: "Fixed", tone: "fixed" },
    { key: "Removed", label: "Removed", tone: "removed" },
  ];
  const total = kinds.reduce((sum, k) => sum + (summary?.[k.key] || 0), 0) || 1;

  const bar = document.createElement("div");
  bar.className = "changelog-kind-bar";
  bar.setAttribute("role", "img");
  bar.setAttribute(
    "aria-label",
    kinds.map((k) => `${k.label} ${summary?.[k.key] || 0}`).join(", "),
  );

  for (const kind of kinds) {
    const count = summary?.[kind.key] || 0;
    if (!count) continue;
    const seg = document.createElement("span");
    seg.className = `changelog-kind-bar__seg changelog-kind-bar__seg--${kind.tone}`;
    seg.style.flexGrow = String(count);
    seg.title = `${kind.label}: ${fmt(count)}`;
    bar.appendChild(seg);
  }

  if (!bar.childElementCount) {
    const empty = document.createElement("span");
    empty.className = "changelog-kind-bar__seg changelog-kind-bar__seg--empty";
    empty.style.flexGrow = "1";
    bar.appendChild(empty);
  }

  container.appendChild(bar);
}

function renderChangelogSummary(changelog, target = CHANGELOG_TARGETS.page) {
  const container = document.getElementById(target.summaryId);
  if (!container) return;
  clear(container);

  const summary = changelog.summary || {};
  renderChangelogKindBar(summary, container);

  const grid = document.createElement("div");
  grid.className = "changelog-kpi-grid";

  const kpis = [
    { key: "Added", label: "Added", tone: "added" },
    { key: "Changed", label: "Changed", tone: "changed" },
    { key: "Fixed", label: "Fixed", tone: "fixed" },
    { key: "Removed", label: "Removed", tone: "removed" },
  ];

  for (const kpi of kpis) {
    const chip = document.createElement("article");
    chip.className = `changelog-kpi changelog-kpi--${kpi.tone}`;

    const label = document.createElement("span");
    label.className = "changelog-kpi-label";
    appendText(label, kpi.label);

    const value = document.createElement("span");
    value.className = "changelog-kpi-value";
    appendText(value, fmt(summary[kpi.key] || 0));

    chip.append(label, value);
    grid.appendChild(chip);
  }

  container.appendChild(grid);
}

function renderChangelogFeed(changelog, target = CHANGELOG_TARGETS.page) {
  const container = document.getElementById(target.feedId);
  if (!container) return;
  clear(container);

  const kindFilter = document.getElementById(target.filterId)?.value || "all";
  let releases = filterChangelogReleases(changelog, kindFilter);
  if (!releases.length) {
    releases = changelogFallbackReleases(changelog);
  }
  const feedCount = document.getElementById(target.feedCountId);
  if (feedCount) {
    feedCount.textContent = `${fmt(releases.length)} entri`;
  }

  for (const [index, release] of releases.entries()) {
    const itemCount = release.sections.reduce((sum, sec) => sum + sec.items.length, 0);
    const details = document.createElement("details");
    details.className = "changelog-release";
    if (index === 0) {
      details.open = true;
      details.classList.add("changelog-release--current");
    }

    const summary = document.createElement("summary");
    const marker = document.createElement("span");
    marker.className = "changelog-release-marker";
    marker.setAttribute("aria-hidden", "true");

    const main = document.createElement("span");
    main.className = "changelog-release-head";

    const version = document.createElement("span");
    version.className = "changelog-version";
    appendText(version, release.version);

    const date = document.createElement("span");
    date.className = "changelog-date";
    appendText(date, release.date);

    main.append(version, date);

    const meta = document.createElement("span");
    meta.className = "changelog-release-meta";

    if (index === 0) {
      const tag = document.createElement("span");
      tag.className = "changelog-release-tag";
      appendText(tag, "LATEST");
      meta.appendChild(tag);
    }

    const count = document.createElement("span");
    count.className = "changelog-count";
    appendText(count, `${itemCount} catatan`);
    meta.appendChild(count);

    summary.append(marker, main, meta);
    details.appendChild(summary);

    const body = document.createElement("div");
    body.className = "changelog-body";

    for (const section of release.sections) {
      const title = document.createElement("div");
      title.className = `changelog-section-title ${changelogKindClass(section.kind)}`;
      appendText(title, changelogKindLabel(section.kind));

      const list = document.createElement("ul");
      list.className = "changelog-items";
      for (const entry of section.items) {
        const li = document.createElement("li");
        if (/breaking/i.test(entry)) li.classList.add("is-breaking");
        appendChangelogItemText(li, entry);
        list.appendChild(li);
      }
      body.append(title, list);
    }

    details.appendChild(body);
    container.appendChild(details);
  }
}

function initChangelogFilter(changelog, target = CHANGELOG_TARGETS.page) {
  const filter = document.getElementById(target.filterId);
  if (!filter || filter.dataset.bound === "true") return;
  filter.dataset.bound = "true";
  filter.addEventListener("change", () => renderChangelogFeed(changelog, target));
}

function initChangelogModalTriggers() {
  if (document.documentElement.dataset.changelogModalInit === "true") return;
  document.documentElement.dataset.changelogModalInit = "true";
  document.addEventListener("click", (event) => {
    const trigger = event.target.closest(".js-changelog-open");
    if (!trigger) return;
    event.preventDefault();
    openChangelogModal();
  });
}

function syncChangelogVersionTriggers(changelog) {
  if (!changelog?.latestVersion) return;

  const versionUpper = changelog.latestVersion.toUpperCase();
  const versionLabel = changelog.latestVersion;

  const statusRow = document.getElementById("status-row");
  if (!statusRow) return;

  let pill = statusRow.querySelector(".status-pill--version");
  if (pill && pill.tagName !== "BUTTON") {
    const replacement = document.createElement("button");
    replacement.type = "button";
    replacement.id = "changelog-version-trigger";
    replacement.className = "status-pill status-pill--sync status-pill--version js-changelog-open";
    replacement.setAttribute("aria-label", `Versi ${versionLabel}. Buka riwayat perubahan.`);
    replacement.setAttribute("aria-haspopup", "dialog");
    replacement.setAttribute("aria-controls", "changelog-modal");
    replacement.textContent = versionUpper;
    pill.replaceWith(replacement);
    pill = replacement;
  }

  if (!pill) {
    pill = document.createElement("button");
    pill.type = "button";
    pill.id = "changelog-version-trigger";
    pill.className = "status-pill status-pill--sync status-pill--version js-changelog-open";
    pill.setAttribute("aria-label", `Versi ${versionLabel}. Buka riwayat perubahan.`);
    pill.setAttribute("aria-haspopup", "dialog");
    pill.setAttribute("aria-controls", "changelog-modal");
    appendText(pill, versionUpper);
    statusRow.appendChild(pill);
  } else {
    pill.id = "changelog-version-trigger";
    pill.classList.add("js-changelog-open");
    pill.setAttribute("aria-label", `Versi ${versionLabel}. Buka riwayat perubahan.`);
    pill.setAttribute("aria-haspopup", "dialog");
    pill.setAttribute("aria-controls", "changelog-modal");
    pill.textContent = versionUpper;
  }
}

function renderChangelog(changelog) {
  if (!changelog) return;
  for (const target of Object.values(CHANGELOG_TARGETS)) {
    renderChangelogHero(changelog, target);
    renderChangelogSummary(changelog, target);
    renderChangelogFeed(changelog, target);
    initChangelogFilter(changelog, target);
  }

  const captionText = changelog.latestVersion
    ? `${changelog.latestVersion} · ${changelog.latestDate} · ${fmt(changelog.totalReleases)} rilis`
    : null;

  const caption = document.getElementById("changelog-caption");
  if (caption && captionText) caption.textContent = captionText;

  const modalCaption = document.getElementById("changelog-modal-caption");
  if (modalCaption && captionText) modalCaption.textContent = captionText;

  syncChangelogVersionTriggers(changelog);
}

function updateGeoCityFilterMeta(matchedCount, totalCount, query) {
  const meta = document.getElementById("geo-city-filter-meta");
  if (!meta) return;
  if (!totalCount) {
    meta.textContent = "";
    return;
  }
  if (!query) {
    meta.textContent = `${fmt(totalCount)} kota`;
    return;
  }
  meta.textContent = `${fmt(matchedCount)} dari ${fmt(totalCount)} kota`;
}

function refreshGeoCityViews(geo, { fitMapBounds = false } = {}) {
  if (!geo) return;
  const query = getCityFilterQuery();
  const matched = filterCityClusters(geo.clusters, query);
  updateGeoCityFilterMeta(matched.length, geo.clusters?.length || 0, query);
  renderTopCities(geo, "overview-top-cities", 6);
  renderTopCities(geo, "geo-map-cities", query ? matched.length : geo.clusters.length);
  if (typeof window.applyDompengGeoCityFilter === "function") {
    window.applyDompengGeoCityFilter(query, { fitBounds: fitMapBounds });
  }
}

function renderTopCities(geo, containerId = "overview-top-cities", limit = 8) {
  const container = document.getElementById(containerId);
  if (!container) return;
  clear(container);
  if (!geo?.clusters?.length) {
    const empty = document.createElement("li");
    empty.className = "overview-city-empty";
    appendText(empty, "Belum ada data kota.");
    container.appendChild(empty);
    return;
  }

  const onGeoSidebar = containerId === "geo-map-cities";
  const filter = getCityFilterQuery();
  const matched = [...geo.clusters]
    .filter((city) => cityMatchesFilter(city, filter))
    .sort((a, b) => (b.count || 0) - (a.count || 0));
  const cities = matched.slice(0, filter ? matched.length : limit);
  const max = cities[0]?.count || 1;
  const totalEntities = matched.reduce((sum, city) => sum + (city.count || 0), 0);

  if (onGeoSidebar) {
    const sumEl = document.getElementById("geo-map-cities-sum");
    if (sumEl) {
      sumEl.textContent = `${fmt(totalEntities)} entitas · ${fmt(matched.length)} kota`;
    }
  }

  if (!cities.length) {
    const empty = document.createElement("li");
    empty.className = "overview-city-empty";
    appendText(empty, "Tidak ada kota yang cocok.");
    container.appendChild(empty);
    return;
  }

  for (const city of cities) {
    const li = document.createElement("li");
    li.className = "overview-city-item";
    if (onGeoSidebar) li.classList.add("geo-city-item");

    const head = document.createElement("button");
    head.type = "button";
    head.className = "overview-city-head";
    if (onGeoSidebar) head.classList.add("geo-city-item__btn");
    head.setAttribute("role", onGeoSidebar ? "option" : "button");
    head.title = `Fokus ke ${city.label}`;
    head.addEventListener("click", () => {
      if (!onGeoSidebar && typeof activateDashboardTab === "function") {
        activateDashboardTab("geo");
      }
      const detail = encodeURIComponent(city.key || city.label);
      history.replaceState(null, "", `#peta:${detail}`);
      window.setTimeout(() => {
        if (typeof window.focusDompengMapCity === "function") {
          window.focusDompengMapCity(city.key || city.label);
        }
      }, onGeoSidebar ? 80 : 180);
    });

    const name = document.createElement("span");
    name.className = "overview-city-name";
    appendText(name, city.label);

    const count = document.createElement("span");
    count.className = "overview-city-count";
    appendText(count, `${fmt(city.count)} entitas`);

    head.append(name, count);

    const track = document.createElement("div");
    track.className = "overview-city-track";
    const fill = document.createElement("span");
    fill.className = "overview-city-fill";
    fill.style.width = `${Math.max(6, Math.round((city.count / max) * 100))}%`;
    track.appendChild(fill);

    if (city.mergedCount > 1) {
      const meta = document.createElement("span");
      meta.className = "overview-city-meta";
      appendText(meta, `${city.mergedCount} kota · koordinat sama`);
      li.append(head, track, meta);
    } else {
      const prov = city.province ? city.province : "";
      if (prov) {
        const meta = document.createElement("span");
        meta.className = "overview-city-meta";
        appendText(meta, prov);
        li.append(head, track, meta);
      } else {
        li.append(head, track);
      }
    }

    container.appendChild(li);
  }
}

function initCityFilter() {
  const bind = (input) => {
    if (!input || input.dataset.bound === "true") return;
    input.dataset.bound = "true";
    input.addEventListener("input", (event) => {
      const source = event.target;
      syncCityFilterInputs(source.value, { skipId: source.id });
      if (!dashboardDataCache?.geo) return;
      const query = normalizeFilterQuery(source.value);
      if (typeof window.applyDompengGeoCityFilter === "function") {
        window.applyDompengGeoCityFilter(query, { fitBounds: false });
      }
      scheduleGeoCityViewsRefresh(dashboardDataCache.geo);
    });
  };
  bind(document.getElementById("overview-city-filter"));
  bind(document.getElementById("geo-city-filter"));
}

function initIndexFilters(data) {
  const search = document.getElementById("analytics-index-search");
  const kind = document.getElementById("analytics-index-kind-filter");
  const refreshNow = () => refreshIndexViews(data);
  const refreshSearch = debounce(refreshNow, DASHBOARD_FILTER_DEBOUNCE_MS);
  if (search && search.dataset.bound !== "true") {
    search.dataset.bound = "true";
    search.addEventListener("input", refreshSearch);
  }
  if (kind && kind.dataset.bound !== "true") {
    kind.dataset.bound = "true";
    kind.addEventListener("change", refreshNow);
  }
}

function refreshIndexViews(data) {
  if (!data) return;
  const allRows = data.indexRows || [];
  const filtered = filterIndexRows(allRows);
  const filters = getIndexFilters();
  const hasFilter = Boolean(filters.query) || filters.kind !== "all";

  const meta = document.getElementById("analytics-index-filter-meta");
  if (meta) {
    meta.textContent = hasFilter ? `${fmt(filtered.length)} dari ${fmt(allRows.length)} tipe` : `${fmt(allRows.length)} tipe`;
  }

  const capIdx = document.getElementById("analytics-index-caption");
  if (capIdx) {
    const shared = filtered.filter((r) => r.kind === "shared").length;
    const unique = filtered.length - shared;
    capIdx.textContent = hasFilter
      ? `${fmt(filtered.length)} tipe cocok · ${shared} silang · ${unique} unik`
      : `${shared} tipe silang · ${filtered.length - shared} tipe unik`;
  }

  const capIndex = document.getElementById("index-caption");
  const totals = hasFilter ? sumIndexTotals(filtered) : data.indexTotal;
  if (capIndex && totals) {
    const ratio = totals.entries > 0 ? (totals.refs / totals.entries).toFixed(2) : "—";
    capIndex.textContent = hasFilter
      ? `${fmt(filtered.length)} tipe · ${fmt(totals.entries)} entri · rasio ${ratio}×`
      : `${fmt(totals.entries)} entri · ${fmt(totals.refs)} referensi · rasio ${ratio}×`;
  }

  renderIndexFieldTable(filtered);
  buildIndexBarChart(filtered);
  window.requestAnimationFrame(resizeIndexBarChart);
  renderIndexStats(totals || { entries: 0, refs: 0 });
  renderIntelMetrics(data.intel, data.queue, filtered);

  const tableWrap = document.getElementById("index-chart-table");
  if (tableWrap) {
    renderDataTable(
      "index-chart-table",
      [
        { key: "type", label: "Tipe" },
        { key: "kind", label: "Mode" },
        { key: "entries", label: "Entri", numeric: true },
        { key: "refs", label: "Ref", numeric: true },
      ],
      filtered.map((row) => ({
        type: row.type,
        kind: row.kind === "unique" ? "UNIK" : "SILANG",
        entries: fmt(row.entries),
        refs: fmt(row.refs),
      })),
    );
  }
}

function initQueueFilters(data) {
  for (const select of document.querySelectorAll(".js-queue-filter")) {
    if (select.dataset.bound === "true") continue;
    select.dataset.bound = "true";
    select.addEventListener("change", () => {
      syncQueueFilterSelects(select.value);
      refreshQueueViews(data);
    });
  }
}

function refreshQueueViews(data) {
  if (!data?.queue) return;
  const statusFilter = getQueueFilter();
  const label = QUEUE_FILTER_LABELS[statusFilter] || statusFilter;
  const meta = document.getElementById("ops-queue-filter-meta");
  if (meta) {
    meta.textContent =
      statusFilter === "all"
        ? `${fmt(data.queue.total)} URL di antrian`
        : `Menyoroti: ${label}`;
  }

  const capSankey = document.getElementById("overview-sankey-caption");
  if (capSankey) {
    const summary = data.summary || {};
    const queue = data.queue || {};
    const geo = data.geo || {};
    capSankey.textContent = `${fmt(summary.documents)} dokumen → ${fmt(summary.persons)} entitas · ${fmt(geo.geocodedEntities)} terpetakan · ${fmt(queue.total)} URL antrian`;
  }

  if (document.getElementById("overview-sankey-chart")) {
    buildOverviewSankey(data);
  } else if (document.getElementById("overview-queue-chart")) {
    renderQueueSignal(data.queue, { statusFilter });
  }

  if (document.getElementById("overview-queue-radar")) {
    renderOverviewQueueRadar(data.queue, { statusFilter });
  }

  renderOpsStats(data, { statusFilter });
}

function initPreviewFilters() {
  const search = document.getElementById("preview-search");
  const type = document.getElementById("preview-type-filter");
  const refreshNow = () => {
    if (typeof previewFilterHandler === "function") previewFilterHandler();
  };
  const refreshSearch = debounce(refreshNow, DASHBOARD_FILTER_DEBOUNCE_MS);
  if (search && search.dataset.bound !== "true") {
    search.dataset.bound = "true";
    search.addEventListener("input", refreshSearch);
  }
  if (type && type.dataset.bound !== "true") {
    type.dataset.bound = "true";
    type.addEventListener("change", refreshNow);
  }
}

function renderOpsStatsLegend(queue, { statusFilter = "all" } = {}) {
  const list = document.getElementById("ops-stats-legend");
  if (!list) return;
  clear(list);

  const segments = queueChartSegments(queue, { statusFilter });
  const total = segments.reduce((sum, segment) => sum + (queue[segment.key] || 0), 0) || 1;

  for (const segment of segments) {
    const value = queue[segment.key] || 0;
    const li = document.createElement("li");
    li.className = "ops-stats-legend__item";
    if (statusFilter !== "all" && segment.key === statusFilter) {
      li.dataset.highlight = "true";
    }

    const dot = document.createElement("span");
    dot.className = "ops-stats-legend__dot";
    dot.style.background = segment.color;

    const label = document.createElement("span");
    label.className = "ops-stats-legend__label";
    appendText(label, segment.label);

    const meta = document.createElement("span");
    meta.className = "ops-stats-legend__meta";
    appendText(meta, `${fmt(value)} · ${pct(value, total)}%`);

    li.append(dot, label, meta);
    list.appendChild(li);
  }
}

function renderOpsStatsKpis(data) {
  const grid = document.getElementById("ops-stats-kpis");
  if (!grid) return;

  const { summary = {}, intel = {}, indexTotal = {}, geo = {} } = data;
  const cards = [
    {
      code: "D-01",
      label: "Dokumen publik",
      value: summary.documents,
      tone: "intel",
      hint: `${fmt(intel.sourceDocuments || summary.documents)} sumber`,
    },
    {
      code: "D-02",
      label: "Template",
      value: summary.templates,
      hint: "Pola ekstraksi",
    },
    {
      code: "D-03",
      label: "File selesai",
      value: summary.doneFiles,
      tone: "cyan",
      hint: `Riwayat ${fmt(summary.history)}`,
    },
    {
      code: "I-01",
      label: "Entri indeks",
      value: indexTotal.entries,
      hint: `${fmt(indexTotal.refs)} referensi`,
    },
    {
      code: "G-01",
      label: "Entitas geo",
      value: geo.geocodedEntities,
      tone: "cyan",
      hint: `${fmt(geo.mappedCities)} kota`,
    },
  ];

  clear(grid);
  for (const card of cards) {
    const article = document.createElement("article");
    article.className = "stat-card stat-card--compact";
    article.dataset.code = card.code;
    if (card.tone) article.dataset.tone = card.tone;

    const value = document.createElement("div");
    value.className = "stat-value";
    appendText(value, fmt(card.value));

    const label = document.createElement("div");
    label.className = "stat-label";
    appendText(label, card.label);

    article.append(value, label);
    if (card.hint) {
      const hint = document.createElement("div");
      hint.className = "stat-hint";
      appendText(hint, card.hint);
      article.append(hint);
    }
    grid.appendChild(article);
  }
}

function renderOpsStats(data, { statusFilter = getQueueFilter() } = {}) {
  const { queue = {} } = data;
  const chart = buildQueueChart(queue, "ops-queue-donut", { statusFilter });
  if (chart) {
    window.requestAnimationFrame(resizeOpsQueueDonut);
  }
  renderOpsStatsLegend(queue, { statusFilter });
  renderOpsStatsKpis(data);
}

function renderOpsDashboard(data) {
  const capStats = document.getElementById("ops-stats-caption");
  if (capStats && data.queue) {
    capStats.textContent = `${fmt(data.queue.total)} URL antrian · ${fmt(data.summary?.documents)} dokumen · ${fmt(data.indexTotal?.entries)} entri indeks`;
  }

  const capImport = document.getElementById("ops-import-caption");
  if (capImport && data.recentDocs) {
    const totalMentions = data.recentDocs.reduce((sum, doc) => sum + (doc.mentions || 0), 0);
    capImport.textContent = `${fmt(data.recentDocs.length)} impor terbaru · ${fmt(totalMentions)} entitas diekstrak`;
  }

  refreshQueueViews(data);
  renderRecentDocsTable(data.recentDocs, "ops-recent-docs");
}

const FILE_TYPE_MERGE_GROUPS = {
  excel: ["xls", "xlsx", "xlsm", "xlt", "xltx"],
  word: ["doc", "docx", "docm", "dot", "dotx", "dotm"],
  powerpoint: ["ppt", "pptx", "pptm", "pot", "potx", "pps", "ppsx"],
  html: ["html", "htm"],
  "opendocument-text": ["odt", "fodt", "sxw"],
  "opendocument-spreadsheet": ["ods", "fods", "sxc"],
  "opendocument-presentation": ["odp", "fodp", "sxi"],
};

const FILE_TYPE_LABELS = {
  pdf: "PDF",
  excel: "Excel",
  word: "Word",
  powerpoint: "PowerPoint",
  csv: "CSV",
  html: "HTML",
  txt: "Teks",
  json: "JSON",
  image: "Gambar",
  unknown: "Lainnya",
  "opendocument-text": "OpenDocument (teks)",
  "opendocument-spreadsheet": "OpenDocument (spreadsheet)",
  "opendocument-presentation": "OpenDocument (presentasi)",
};

function mergeFileTypeRows(rows) {
  const extToGroup = {};
  for (const [group, exts] of Object.entries(FILE_TYPE_MERGE_GROUPS)) {
    for (const ext of exts) extToGroup[ext] = group;
  }
  const counts = new Map();
  for (const item of rows || []) {
    const ext = (item.type || "unknown").toLowerCase();
    const key = extToGroup[ext] || ext;
    counts.set(key, (counts.get(key) || 0) + (item.count || 0));
  }
  return [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);
}

function fileTypeLabel(type) {
  const key = (type || "unknown").toLowerCase();
  if (FILE_TYPE_LABELS[key]) return FILE_TYPE_LABELS[key];
  if (key === "unknown") return "Lainnya";
  return `.${key}`;
}

function renderRankedCountTable(rows, tbody, { total, nameKey, formatName, nameClass = "" }) {
  if (!tbody) return;
  clear(tbody);

  const list = rows || [];
  const denom = total || list[0]?.count || 1;
  const max = list[0]?.count || 1;

  if (!list.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 3;
    cell.className = "analytics-empty";
    appendText(cell, "Belum ada data");
    row.appendChild(cell);
    tbody.appendChild(row);
    return;
  }

  for (const item of list) {
    const row = document.createElement("tr");

    const nameCell = document.createElement("td");
    if (nameClass) nameCell.className = nameClass;
    appendText(nameCell, formatName ? formatName(item[nameKey]) : item[nameKey]);

    const countCell = document.createElement("td");
    countCell.className = "num";
    appendText(countCell, fmt(item.count));

    const pctCell = document.createElement("td");
    pctCell.className = "num";
    const wrap = document.createElement("div");
    wrap.className = "analytics-bar-cell";
    const track = document.createElement("span");
    track.className = "analytics-bar-track";
    const fill = document.createElement("span");
    fill.className = "analytics-bar-fill";
    fill.style.width = `${Math.round((item.count / max) * 100)}%`;
    track.appendChild(fill);
    const pctLabel = document.createElement("span");
    pctLabel.className = "analytics-bar-pct";
    appendText(pctLabel, `${pct(item.count, denom)}%`);
    wrap.append(track, pctLabel);
    pctCell.appendChild(wrap);

    row.append(nameCell, countCell, pctCell);
    tbody.appendChild(row);
  }
}

function formatDomainSuffix(suffix) {
  const key = (suffix || "").replace(/^\./, "");
  return key ? `.${key}` : "—";
}

function renderSourceStats(sourceStats, documentsTotal) {
  const typesBody = document.getElementById("analytics-file-types-body");
  const suffixBody = document.getElementById("analytics-domain-suffixes-body");
  const cap = document.getElementById("analytics-sources-caption");
  if (!typesBody && !suffixBody) return;

  const stats = sourceStats || {};
  const docTotal = stats.documentsTotal || documentsTotal || 1;
  const idDocs = stats.documentsIdDomain || 0;
  const suffixRows = stats.domainSuffixes || stats.domains || [];

  if (cap) {
    const top = stats.topSuffix ? ` · terbanyak .${stats.topSuffix}` : "";
    cap.textContent = `${fmt(idDocs)} dokumen .go.id/.org.id · ${fmt(stats.documentsWithUrl || 0)} ber-URL${top}`;
  }

  renderRankedCountTable(mergeFileTypeRows(stats.fileTypes), typesBody, {
    total: docTotal,
    nameKey: "type",
    formatName: fileTypeLabel,
  });

  renderRankedCountTable(suffixRows, suffixBody, {
    total: idDocs || docTotal,
    nameKey: "suffix",
    formatName: formatDomainSuffix,
    nameClass: "suffix-cell",
  });
}

function renderCoverageTable(coverage, total) {
  const tbody = document.getElementById("analytics-coverage-body");
  if (!tbody) return;
  clear(tbody);

  const sorted = [...(coverage || [])].sort((a, b) => (b.value || 0) - (a.value || 0));
  const max = sorted[0]?.value || 1;

  for (const item of sorted) {
    const row = document.createElement("tr");

    const field = document.createElement("td");
    appendText(field, item.label);

    const count = document.createElement("td");
    count.className = "num";
    appendText(count, fmt(item.value));

    const pctCell = document.createElement("td");
    pctCell.className = "num";
    const wrap = document.createElement("div");
    wrap.className = "analytics-bar-cell";
    const track = document.createElement("span");
    track.className = "analytics-bar-track";
    const fill = document.createElement("span");
    fill.className = "analytics-bar-fill";
    fill.style.width = `${Math.round((item.value / max) * 100)}%`;
    track.appendChild(fill);
    const pctLabel = document.createElement("span");
    pctLabel.className = "analytics-bar-pct";
    appendText(pctLabel, `${item.pct ?? pct(item.value, total)}%`);
    wrap.append(track, pctLabel);
    pctCell.appendChild(wrap);

    row.append(field, count, pctCell);
    tbody.appendChild(row);
  }
}

function renderIndexFieldTable(indexRows) {
  const tbody = document.getElementById("analytics-index-body");
  if (!tbody) return;
  clear(tbody);

  const rows = indexRows || [];
  if (!rows.length) {
    const tr = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 4;
    cell.className = "analytics-empty analytics-empty--filter";
    appendText(cell, "Tidak ada tipe indeks yang cocok.");
    tr.appendChild(cell);
    tbody.appendChild(tr);
    return;
  }

  for (const row of rows) {
    const tr = document.createElement("tr");

    const type = document.createElement("td");
    appendText(type, row.type);

    const kind = document.createElement("td");
    const kindTag = document.createElement("span");
    kindTag.className = `index-kind index-kind--${row.kind === "unique" ? "unique" : "shared"}`;
    appendText(kindTag, row.kind === "unique" ? "UNIK" : "SILANG");
    kind.appendChild(kindTag);

    const entries = document.createElement("td");
    entries.className = "num";
    appendText(entries, fmt(row.entries));

    const refs = document.createElement("td");
    refs.className = "num";
    appendText(refs, fmt(row.refs));

    tr.append(type, kind, entries, refs);
    tbody.appendChild(tr);
  }
}

function renderIntelMetrics(intel, queue, indexRows = []) {
  const container = document.getElementById("analytics-intel-metrics");
  if (!container || !intel) return;
  clear(container);

  const dominantLabel = VECTOR_LABELS[intel.dominantVectorId] || intel.dominantVectorId;
  const shared = (indexRows || []).filter((r) => r.kind === "shared").length;
  const unique = (indexRows || []).length - shared;
  const items = isTechnicalMode() ? [
    { label: "Nodes", value: fmt(intel.graphNodes), hint: `${fmt(intel.graphEdges)} edges` },
    { label: "Source docs", value: fmt(intel.sourceDocuments), hint: "indexed documents" },
    { label: "Dominant", value: `${intel.dominantVectorPct}%`, hint: intel.dominantVectorId },
    { label: "Xref", value: `${intel.xrefRatio}×`, hint: `${intel.entityLinkRate} id/entity` },
    {
      label: "Pipeline",
      value: `${intel.pipelineSuccessPct}%`,
      hint: queue ? `${fmt(queue.pending)} pending · ${fmt(queue.failed)} failed` : "pipeline",
    },
    {
      label: "Fields",
      value: fmt((indexRows || []).length),
      hint: `${shared} shared · ${unique} unique`,
    },
  ] : [
    { label: "Entitas", value: fmt(intel.graphNodes), hint: `${fmt(intel.graphEdges)} referensi silang` },
    { label: "Dokumen", value: fmt(intel.sourceDocuments), hint: "sumber publik" },
    { label: "Dominan", value: `${intel.dominantVectorPct}%`, hint: dominantLabel },
    { label: "Keterhubungan", value: `${intel.xrefRatio}×`, hint: `${intel.entityLinkRate} identitas/entitas` },
    {
      label: "Unduhan",
      value: `${intel.pipelineSuccessPct}%`,
      hint: queue ? `${fmt(queue.pending)} antri · ${fmt(queue.failed)} gagal` : "pipeline",
    },
    {
      label: "Tipe field",
      value: fmt((indexRows || []).length),
      hint: `${shared} silang · ${unique} unik`,
    },
  ];

  for (const item of items) {
    const chip = document.createElement("div");
    chip.className = "intel-metric";

    const label = document.createElement("span");
    label.className = "intel-metric-label";
    appendText(label, item.label);

    const value = document.createElement("strong");
    value.className = "intel-metric-value";
    appendText(value, item.value);

    const hint = document.createElement("span");
    hint.className = "intel-metric-hint";
    appendText(hint, item.hint);

    chip.append(label, value, hint);
    container.appendChild(chip);
  }
}

function formatArtifactBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const DATA_GUIDE_ARTIFACT_ROWS = [
  { file: "data/stats.json", role: "Agregat dashboard: indeks, geo, antrian, changelog." },
  { file: "data/geo-clusters.json", role: "Cluster kota dan koordinat untuk tab Peta." },
  { file: "sitemap.xml", role: "Daftar URL untuk crawler dan SEO." },
  { file: "robots.txt", role: "Kebijakan akses crawler." },
];

function renderDataGuideArtifacts(data) {
  const kpiRoot = document.getElementById("data-guide-artifact-kpis");
  const tbody = document.getElementById("data-guide-artifacts-body");
  const meta = document.getElementById("data-guide-artifact-meta");
  if (!kpiRoot && !tbody && !meta) return;

  const summary = data.summary || {};

  if (kpiRoot) {
    clear(kpiRoot);
    const kpis = [
      { label: "Entitas", value: fmt(summary.persons), hint: "terindeks" },
      { label: "Dokumen", value: fmt(summary.documents), hint: "sumber publik" },
      { label: "Template", value: fmt(summary.templates), hint: "pola ekstraksi" },
      { label: "Histori", value: fmt(summary.history), hint: `${fmt(summary.doneFiles)} selesai` },
    ];
    for (const item of kpis) {
      const chip = document.createElement("div");
      chip.className = "intel-metric";
      if (item.hint) chip.title = item.hint;

      const label = document.createElement("span");
      label.className = "intel-metric-label";
      appendText(label, item.label);

      const value = document.createElement("strong");
      value.className = "intel-metric-value";
      appendText(value, item.value);

      chip.append(label, value);
      kpiRoot.appendChild(chip);
    }
  }

  if (tbody) {
    clear(tbody);
    const rows = Array.isArray(data.buildArtifacts) && data.buildArtifacts.length
      ? data.buildArtifacts
      : DATA_GUIDE_ARTIFACT_ROWS;
    for (const row of rows) {
      const tr = document.createElement("tr");
      const th = document.createElement("th");
      th.scope = "row";
      const sizeLabel = formatArtifactBytes(row.bytes);
      appendText(th, sizeLabel ? `${row.file} (${sizeLabel})` : row.file);
      const td = document.createElement("td");
      appendText(td, row.role);
      tr.append(th, td);
      tbody.appendChild(tr);
    }
  }

  if (meta) {
    clear(meta);
    const metaParts = [];
    if (data.updated) metaParts.push(`Diperbarui ${data.updated}`);
    if (data.redacted) metaParts.push("Sensor publik aktif");
    if (metaParts.length) appendText(meta, `${metaParts.join(" · ")} · `);
    appendText(meta, "Generator ");
    const code = document.createElement("code");
    code.textContent = "summary.sh";
    meta.append(code);
    const version = data.changelog?.latestVersion;
    if (version) appendText(meta, ` · ${version}`);
  }
}

function renderAnalyticsDashboard(data) {
  const capIndex = document.getElementById("index-caption");
  if (capIndex && data.indexTotal) {
    capIndex.textContent = `${fmt(data.indexTotal.entries)} entri · ${fmt(data.indexTotal.refs)} referensi`;
  }

  const capIdx = document.getElementById("analytics-index-caption");
  if (capIdx && data.indexRows?.length) {
    const shared = data.indexRows.filter((r) => r.kind === "shared").length;
    capIdx.textContent = `${shared} tipe silang · ${data.indexRows.length - shared} tipe unik`;
  }

  refreshIndexViews(data);
  renderSourceStats(data.sourceStats, data.summary?.documents);
}

function renderOverviewDashboard(data) {
  const capSankey = document.getElementById("overview-sankey-caption");
  if (capSankey) {
    const summary = data.summary || {};
    const queue = data.queue || {};
    const geo = data.geo || {};
    capSankey.textContent = `${fmt(summary.documents)} dokumen → ${fmt(summary.persons)} entitas · ${fmt(geo.geocodedEntities)} terpetakan · ${fmt(queue.total)} URL antrian`;
  }

  const capGeo = document.getElementById("overview-geo-caption");
  if (capGeo && data.geo) {
    capGeo.textContent = `${fmt(data.geo.geocodedEntities)} entitas di ${fmt(data.geo.mappedCities)} kota`;
  }

  buildOverviewSankey(data);
  renderTopCities(data.geo, "overview-top-cities", 6);
  if (data.queue) renderOverviewQueueRadar(data.queue);
  window.requestAnimationFrame(resizeOverviewSankey);
}

function ensureDompengGeoMap({ focus = null } = {}) {
  const geo = window.DOMPENG_PENDING_GEO;
  if (!geo?.clusters?.length || typeof initDompengGeoMap !== "function") return null;
  let map = window.DOMPENG_MAP;
  if (!map) {
    map = initDompengGeoMap(geo, {
      fitBounds: true,
      cityFilter: window.DOMPENG_GEO_CITY_FILTER || getCityFilterQuery(),
    });
  } else if (map.resize) {
    map.resize();
  }
  if (focus && typeof window.focusDompengMapCity === "function") {
    window.setTimeout(() => window.focusDompengMapCity(focus), 220);
  }
  return map;
}

function renderDashboardData(data) {
  if (data.intel) {
    renderIntelBrief(data.intel);
  }

  renderOverviewSummary(data);
  renderOverviewVolume(data);
  renderOverviewDashboard(data);
  initCityFilter();
  initIndexFilters(data);
  initQueueFilters(data);
  initPreviewFilters();
  refreshGeoCityViews(data.geo, { fitMapBounds: false });
  renderAccessibleDataTables(data);
  renderDataGuideArtifacts(data);
  renderAnalyticsDashboard(data);
  if (data.showcaseEntities?.length) {
    renderShowcaseEntities(data.showcaseEntities);
  }
  renderOpsDashboard(data);
  if (data.changelog) {
    renderChangelog(data.changelog);
  }
}

function showError(message) {
  const page = document.querySelector(".page");
  const banner = document.createElement("div");
  banner.className = "error-banner";
  appendText(banner, message);
  page.prepend(banner);
}

window.resizeOverviewSankey = resizeOverviewSankey;
window.resizeIndexBarChart = resizeIndexBarChart;
window.resizeOpsQueueDonut = resizeOpsQueueDonut;
window.resizePreviewRelationGraph = resizePreviewRelationGraph;

async function init() {
  try {
    const res = await fetch("data/stats.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`Gagal memuat data (${res.status})`);
    const data = await res.json();
    dashboardDataCache = data;
    window.DOMPENG_PENDING_GEO = data.geo;

    document.getElementById("updated").textContent = `Diperbarui · ${data.updated} · data disamarkan`;

    renderDashboardData(data);

    if (typeof window.setShareSnapshotFromData === "function") {
      window.setShareSnapshotFromData(data);
    }

    if (typeof markDashboardReady === "function") {
      markDashboardReady();
    } else {
      document.body.classList.add("dashboard-ready");
    }

    if (typeof window.onDashboardTabShown === "function") {
      const activeTab = document.querySelector(".tab-panel.is-active")?.dataset.tab;
      if (activeTab) window.onDashboardTabShown(activeTab);
    }

    const hashState = typeof window.dashboardHashState === "function" ? window.dashboardHashState() : null;
    if (hashState?.id && hashState.detail && typeof window.applyDashboardHashDetail === "function") {
      window.applyDashboardHashDetail(hashState.id, hashState.detail);
    }
  } catch (err) {
    document.getElementById("updated").textContent = "Data belum tersedia";
    showError(`${err.message}. Jalankan ./summary.sh dari repo utama untuk menghasilkan web/data/stats.json.`);
  }
}

document.addEventListener("DOMContentLoaded", init);
document.addEventListener("DOMContentLoaded", initDashboardViewMode);
document.addEventListener("DOMContentLoaded", initChartDataModals);
document.addEventListener("DOMContentLoaded", initChangelogModalTriggers);
window.ensureDompengGeoMap = ensureDompengGeoMap;
window.refreshIndexViews = refreshIndexViews;
window.refreshGeoCityViews = refreshGeoCityViews;
window.setCityFilterQuery = setCityFilterQuery;
