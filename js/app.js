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

function fmt(n) {
  return Number(n).toLocaleString("en-US");
}

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

function showChartFallbackTables() {
  document.body.classList.add("charts-unavailable");
  for (const detail of document.querySelectorAll(".chart-data-table")) {
    detail.open = true;
  }
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
  indexChord: "DOMPENG_INDEX_CHORD",
};

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
    showChartFallbackTables();
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

  if (entity.relations && Object.keys(entity.relations).length) {
    const relSection = document.createElement("section");
    relSection.className = "preview-section";
    const relHead = document.createElement("h3");
    relHead.className = "preview-section__title";
    appendText(relHead, "Relasi graf");
    relSection.appendChild(relHead);

    const relWrap = document.createElement("div");
    relWrap.className = "preview-relations";
    const sorted = Object.entries(entity.relations).sort((a, b) => b[1] - a[1]);
    for (const [key, count] of sorted) {
      relWrap.append(createPreviewChip(`${relationLabel(key)} · ${count}`, "cyan"));
    }
    relSection.appendChild(relWrap);
    container.appendChild(relSection);
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

function renderPreviewBrief(entities) {
  const brief = document.getElementById("preview-brief");
  if (!brief) return;
  clear(brief);

  const rows = entities || [];
  if (!rows.length) {
    brief.hidden = true;
    return;
  }
  brief.hidden = false;

  const totalDocs = rows.reduce((sum, e) => sum + (e.documentCount || 0), 0);
  const totalIds = rows.reduce((sum, e) => sum + (e.identifierCount || 0), 0);
  const withPhoto = rows.filter((e) => e.hasPhoto).length;
  const avgIds = Math.round(totalIds / rows.length);

  const cards = [
    { label: "Sampel tersensor", value: fmt(rows.length), hint: "variasi struktur data" },
    { label: "Rata-rata identitas", value: fmt(avgIds), hint: "per entitas" },
    { label: "Dokumen terhubung", value: fmt(totalDocs), hint: "di semua sampel" },
    { label: "Dengan foto", value: fmt(withPhoto), hint: `dari ${fmt(rows.length)} entitas` },
  ];

  for (const card of cards) {
    const article = document.createElement("article");
    article.className = "brief-card";

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
    brief.appendChild(article);
  }
}

function renderShowcaseEntities(entities) {
  const listEl = document.getElementById("preview-log-list");
  const detailEl = document.getElementById("preview-log-detail");
  const detailSections = document.getElementById("preview-detail-sections");
  const detailTitle = document.getElementById("preview-detail-title");
  const listMeta = document.getElementById("preview-list-meta");
  const copyBtn = document.getElementById("preview-copy-log");
  if (!listEl || !detailEl) return;

  const rows = entities || [];
  let activeIndex = -1;
  let visibleIndices = [];

  const previewMeta = document.getElementById("preview-meta");
  if (previewMeta) {
    previewMeta.textContent = rows.length ? `${fmt(rows.length)} sampel` : "—";
    previewMeta.hidden = rows.length === 0;
  }

  const moduleCaption = document.getElementById("preview-module-caption");
  if (moduleCaption) {
    moduleCaption.textContent = rows.length
      ? "Data disamarkan untuk publik · gunakan panel kiri untuk memilih entri"
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
    if (detailSections) clear(detailSections);
    detailEl.textContent = message;
    if (detailTitle) detailTitle.textContent = "Detail entri";
    if (copyBtn) copyBtn.hidden = true;
  };

  const setActiveEntity = (rowIndex, { focusList = false } = {}) => {
    if (rowIndex < 0 || rowIndex >= rows.length) return;
    activeIndex = rowIndex;
    const entity = rows[rowIndex];

    detailEl.textContent = formatEntityLog(entity);
    renderPreviewDetailSections(entity, detailSections);
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
      const text = formatEntityLog(rows[activeIndex]);
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
    showChartFallbackTables();
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

function queueCenterLabelPlugin(queue, { compact = false } = {}) {
  return {
    id: "queueCenterLabel",
    beforeDraw(chart) {
      const { width, height, ctx } = chart;
      const total = (queue.pending || 0) + (queue.done || 0) + (queue.failed || 0) + (queue.processing || 0);
      const pct = total ? Math.round((queue.done / total) * 100) : 0;
      const pctSize = compact ? Math.min(18, width * 0.14) : Math.min(22, width * 0.12);
      const labelSize = compact ? Math.max(8, width * 0.055) : 9;
      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `700 ${pctSize}px "IBM Plex Mono", monospace`;
      ctx.fillStyle = "#00d4aa";
      ctx.fillText(`${pct}%`, width / 2, height / 2 - (compact ? 5 : 6));
      ctx.font = `600 ${labelSize}px "IBM Plex Mono", monospace`;
      ctx.fillStyle = "#7a8fa8";
      ctx.fillText("SELESAI", width / 2, height / 2 + (compact ? 12 : 14));
      ctx.restore();
    },
  };
}

/** Segmen donut antrian — selalu tampil meski nilainya 0 (Chart.js mengabaikan slice 0). */
const QUEUE_CHART_SEGMENTS = [
  { label: "Menunggu", key: "pending", color: COLORS.amber },
  { label: "Berhasil", key: "done", color: COLORS.intel },
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
    showChartFallbackTables();
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

  return new Chart(ctx, {
    type: "doughnut",
    data: {
      labels,
      datasets: [
        {
          data: displayValues,
          backgroundColor: colors,
          borderColor: "#0b1118",
          borderWidth: isAnalytics ? 4 : 3,
          hoverOffset: isAnalytics ? 8 : 5,
          spacing: isAnalytics ? 2 : 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: isAnalytics ? "56%" : isOverview ? "58%" : "60%",
      layout: { padding: isAnalytics ? 6 : isOverview ? 8 : 4 },
      plugins,
    },
    plugins: [queueCenterLabelPlugin(queue, { compact: isOverview })],
  });
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

const INDEX_TREEMAP_SHARED_TONES = ["#00d4aa", "#00b894", "#00a07a", "#4ec9ff", "#3ab8e8"];
const INDEX_TREEMAP_UNIQUE_TONES = ["#e6a817", "#d49a14", "#c28a11", "#ff7eb3", "#e86a9f"];

function indexTreemapLeafColor(kind, index) {
  const palette = kind === "unique" ? INDEX_TREEMAP_UNIQUE_TONES : INDEX_TREEMAP_SHARED_TONES;
  return palette[index % palette.length];
}

function indexTreemapLeaf(row, totalEntries, kindIndex) {
  const entries = row.entries || 0;
  const refs = row.refs || 0;
  const ratio = entries > 0 ? refs / entries : 0;
  return {
    name: row.type,
    value: entries,
    entries,
    refs,
    ratio,
    rowKind: row.kind,
    pctTotal: totalEntries > 0 ? (entries / totalEntries) * 100 : 0,
    itemStyle: {
      color: indexTreemapLeafColor(row.kind, kindIndex),
      borderColor: "rgba(255, 255, 255, 0.14)",
      borderWidth: 1,
    },
  };
}

/** Hierarki treemap: Silang / Unik → tipe (luas = entri). */
function buildIndexTreemapData(indexRows) {
  const rows = (indexRows || []).filter((row) => (row.entries || 0) > 0);
  const totalEntries = rows.reduce((sum, row) => sum + (row.entries || 0), 0);
  const shared = { name: "Silang", children: [] };
  const unique = { name: "Unik", children: [] };
  let sharedIdx = 0;
  let uniqueIdx = 0;

  for (const row of rows) {
    if (row.kind === "unique") {
      unique.children.push(indexTreemapLeaf(row, totalEntries, uniqueIdx++));
    } else {
      shared.children.push(indexTreemapLeaf(row, totalEntries, sharedIdx++));
    }
  }

  shared.children.sort((a, b) => b.value - a.value);
  unique.children.sort((a, b) => b.value - a.value);

  const data = [];
  if (shared.children.length) {
    data.push({
      ...shared,
      itemStyle: { color: "rgba(0, 212, 170, 0.22)", borderColor: "rgba(0, 212, 170, 0.45)", borderWidth: 2 },
    });
  }
  if (unique.children.length) {
    data.push({
      ...unique,
      itemStyle: { color: "rgba(230, 168, 23, 0.2)", borderColor: "rgba(230, 168, 23, 0.45)", borderWidth: 2 },
    });
  }

  return { data, totalEntries };
}

function formatIndexTreemapTooltip(params) {
  const d = params.data || {};
  if (d.children?.length) {
    const groupEntries = d.children.reduce((sum, child) => sum + (child.value || 0), 0);
    return [
      `<strong>${params.name}</strong>`,
      `${fmt(groupEntries)} entri · ${d.children.length} tipe`,
    ].join("<br/>");
  }

  const mode = d.rowKind === "unique" ? "Unik" : "Silang";
  const ratio = d.entries > 0 ? `${d.ratio.toFixed(2)}×` : "—";
  return [
    `<strong>${d.name}</strong>`,
    `Mode: ${mode}`,
    `Entri: <strong>${fmt(d.entries)}</strong> (${(d.pctTotal || 0).toFixed(1)}% total)`,
    `Referensi: <strong>${fmt(d.refs)}</strong>`,
    `Rasio ref/entri: <strong>${ratio}</strong>`,
  ].join("<br/>");
}

function indexTreemapLeafLabel(params) {
  const d = params.data || {};
  if (d.children?.length) return "";
  if ((d.pctTotal || 0) < 1.8) return d.name.length <= 10 ? d.name : "";
  if ((d.pctTotal || 0) < 5) return d.name;
  return `${d.name}\n${fmt(d.entries)}`;
}

function buildIndexTreemap(indexRows) {
  const el = document.getElementById("index-treemap-chart");
  if (!el) return null;

  const chart = initDompengEchart(el, DOMPENG_ECHART_STORE.indexTreemap);
  if (!chart) {
    showChartFallbackTables();
    return null;
  }

  if (!(indexRows || []).length) {
    chart.setOption(
      {
        backgroundColor: "transparent",
        graphic: {
          type: "text",
          left: "center",
          top: "middle",
          style: {
            text: "Tidak ada tipe indeks cocok",
            fill: COLORS.muted,
            font: "600 12px 'IBM Plex Mono', monospace",
          },
        },
      },
      { notMerge: true },
    );
    return chart;
  }

  const { data } = buildIndexTreemapData(indexRows);
  const labelFont = "'IBM Plex Mono', monospace";

  chart.setOption(
    {
      backgroundColor: "transparent",
      animationDuration: 480,
      animationEasing: "cubicOut",
      tooltip: {
        ...DOMPENG_ECHART_TOOLTIP,
        trigger: "item",
        formatter: formatIndexTreemapTooltip,
      },
      series: [
        {
          type: "treemap",
          roam: false,
          nodeClick: false,
          breadcrumb: { show: false },
          left: 2,
          right: 2,
          top: 2,
          bottom: 2,
          label: {
            show: true,
            formatter: indexTreemapLeafLabel,
            color: "#e8f0f8",
            fontFamily: labelFont,
            fontSize: 11,
            fontWeight: 600,
            lineHeight: 14,
          },
          upperLabel: {
            show: true,
            height: 26,
            color: "#f0f6fc",
            fontFamily: labelFont,
            fontSize: 11,
            fontWeight: 700,
          },
          itemStyle: {
            borderRadius: 3,
            gapWidth: 3,
          },
          emphasis: {
            focus: "descendant",
            label: { fontSize: 12 },
            itemStyle: {
              borderColor: "rgba(78, 201, 255, 0.75)",
              borderWidth: 2,
              shadowBlur: 12,
              shadowColor: "rgba(78, 201, 255, 0.35)",
            },
          },
          levels: [
            {
              itemStyle: {
                borderColor: "rgba(0, 0, 0, 0.45)",
                borderWidth: 2,
                gapWidth: 4,
              },
              upperLabel: { show: true },
            },
            {
              colorSaturation: [0.72, 1],
              itemStyle: {
                borderColor: "rgba(255, 255, 255, 0.1)",
                borderWidth: 1,
                gapWidth: 2,
              },
              label: { fontSize: 10 },
            },
          ],
          data,
        },
      ],
    },
    { notMerge: true },
  );

  window.requestAnimationFrame(() => resizeDompengEchart(DOMPENG_ECHART_STORE.indexTreemap));
  return chart;
}

function resizeIndexTreemap() {
  resizeDompengEchart(DOMPENG_ECHART_STORE.indexTreemap);
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

function renderChangelogHero(changelog) {
  const container = document.getElementById("changelog-hero");
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

function renderChangelogSummary(changelog) {
  const container = document.getElementById("changelog-summary");
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

function renderChangelogFeed(changelog) {
  const container = document.getElementById("changelog-feed");
  if (!container) return;
  clear(container);

  const kindFilter = document.getElementById("changelog-kind-filter")?.value || "all";
  const releases = (changelog.releases || [])
    .map((release) => ({
      ...release,
      sections: kindFilter === "all"
        ? release.sections
        : release.sections.filter((section) => section.kind === kindFilter),
    }))
    .filter((release) => release.sections.length > 0);
  const feedCount = document.getElementById("changelog-feed-count");
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

function initChangelogFilter(changelog) {
  const filter = document.getElementById("changelog-kind-filter");
  if (!filter || filter.dataset.bound === "true") return;
  filter.dataset.bound = "true";
  filter.addEventListener("change", () => renderChangelogFeed(changelog));
}

function renderChangelog(changelog) {
  if (!changelog) return;
  renderChangelogHero(changelog);
  renderChangelogSummary(changelog);
  renderChangelogFeed(changelog);
  initChangelogFilter(changelog);

  const caption = document.getElementById("changelog-caption");
  if (caption && changelog.latestVersion) {
    caption.textContent = `${changelog.latestVersion} · ${changelog.latestDate} · ${fmt(changelog.totalReleases)} rilis`;
  }

  const statusRow = document.getElementById("status-row");
  if (statusRow && changelog.latestVersion && !statusRow.querySelector(".status-pill--version")) {
    const pill = document.createElement("span");
    pill.className = "status-pill status-pill--sync status-pill--version";
    appendText(pill, changelog.latestVersion.toUpperCase());
    statusRow.appendChild(pill);
  }
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
    capIndex.textContent = `${fmt(totals.entries)} entri · ${fmt(totals.refs)} referensi`;
  }

  renderIndexFieldTable(filtered);
  buildIndexTreemap(filtered);
  window.requestAnimationFrame(resizeIndexTreemap);
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

function renderOpsStats(data, { statusFilter = getQueueFilter() } = {}) {
  const grid = document.getElementById("ops-stats-grid");
  if (!grid) return;

  const { summary = {}, queue = {}, intel = {}, indexTotal = {}, geo = {} } = data;
  const queueTotal = queue.total || 1;

  const cards = [
    {
      code: "Q-01",
      key: "pending",
      label: "Antrian menunggu",
      value: queue.pending,
      tone: "amber",
      hint: `${pct(queue.pending, queueTotal)}% · ${fmt(queue.processing || 0)} diproses`,
    },
    {
      code: "Q-02",
      key: "done",
      label: "Unduhan selesai",
      value: queue.done,
      tone: "intel",
      hint: intel.pipelineSuccessPct != null ? `Pipeline ${intel.pipelineSuccessPct}% sukses` : `${pct(queue.done, queueTotal)}%`,
    },
    {
      code: "Q-03",
      key: "failed",
      label: "Unduhan gagal",
      value: queue.failed,
      tone: queue.failed > 0 ? "danger" : undefined,
      hint: intel.pipelineFailurePct != null ? `Kegagalan ${intel.pipelineFailurePct}%` : `${pct(queue.failed, queueTotal)}%`,
    },
    {
      code: "Q-04",
      key: "processing",
      label: "Sedang diproses",
      value: queue.processing,
      tone: "cyan",
      hint: `${pct(queue.processing || 0, queueTotal)}% dari antrian`,
      hidden: !(queue.processing > 0),
    },
    {
      code: "D-01",
      label: "Dokumen publik",
      value: summary.documents,
      tone: "intel",
      hint: `${fmt(intel.sourceDocuments || summary.documents)} sumber terindeks`,
      queueOnly: false,
    },
    {
      code: "D-02",
      label: "Template ekstraksi",
      value: summary.templates,
      hint: "Pola parsing dokumen",
    },
    {
      code: "D-03",
      label: "File selesai",
      value: summary.doneFiles,
      tone: "cyan",
      hint: `Riwayat ${fmt(summary.history)} file`,
    },
    {
      code: "I-01",
      label: "Entri indeks",
      value: indexTotal.entries,
      hint: `${fmt(indexTotal.refs)} referensi silang`,
    },
    {
      code: "G-01",
      label: "Entitas berlokasi",
      value: geo.geocodedEntities,
      tone: "cyan",
      hint: `${fmt(geo.mappedCities)} kota · ${fmt(geo.entitiesWithCity)} punya kota`,
    },
  ];

  const visible = cards.filter((card) => {
    if (card.hidden) return false;
    if (statusFilter === "all") return true;
    return card.key === statusFilter;
  });

  clear(grid);
  if (!visible.length) {
    const empty = document.createElement("p");
    empty.className = "overview-city-empty";
    appendText(empty, "Tidak ada metrik untuk status ini.");
    grid.appendChild(empty);
    return;
  }

  for (const card of visible) {
    const article = document.createElement("article");
    article.className = "stat-card";
    article.dataset.code = card.code;
    if (card.tone) article.dataset.tone = card.tone;
    if (card.key && card.key === statusFilter) article.dataset.highlight = "true";

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

function renderAnalyticsDashboard(data) {
  const capIndex = document.getElementById("index-caption");
  if (capIndex && data.indexTotal) {
    capIndex.textContent = `${fmt(data.indexTotal.entries)} entri · ${fmt(data.indexTotal.refs)} referensi`;
  }

  const capCov = document.getElementById("analytics-coverage-caption");
  if (capCov && data.coverageTotal) {
    capCov.textContent = `${fmt(data.coverageTotal)} entitas · ${data.coverage?.length || 0} field`;
  }

  const capIdx = document.getElementById("analytics-index-caption");
  if (capIdx && data.indexRows?.length) {
    const shared = data.indexRows.filter((r) => r.kind === "shared").length;
    capIdx.textContent = `${shared} tipe silang · ${data.indexRows.length - shared} tipe unik`;
  }

  refreshIndexViews(data);
  renderCoverageTable(data.coverage, data.coverageTotal || 1);
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
window.resizeIndexTreemap = resizeIndexTreemap;

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
window.ensureDompengGeoMap = ensureDompengGeoMap;
window.refreshIndexViews = refreshIndexViews;
window.refreshGeoCityViews = refreshGeoCityViews;
window.setCityFilterQuery = setCityFilterQuery;
