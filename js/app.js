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
      appendText(td, row[col.key] ?? "—");
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
  const coverageTotal = data.coverageTotal || 1;
  renderDataTable(
    "overview-coverage-table",
    [
      { key: "label", label: "Field" },
      { key: "value", label: "Entitas", numeric: true },
      { key: "pct", label: "%" , numeric: true },
    ],
    (data.coverage || []).map((item) => ({
      label: item.label,
      value: fmt(item.value),
      pct: `${pct(item.value, coverageTotal)}%`,
    })),
  );

  const queue = data.queue || {};
  const queueTotal = queue.total || 1;
  renderDataTable(
    "overview-queue-table",
    [
      { key: "label", label: "Status" },
      { key: "value", label: "URL", numeric: true },
      { key: "pct", label: "%", numeric: true },
    ],
    [
      ["Menunggu", queue.pending || 0],
      ["Diproses", queue.processing || 0],
      ["Selesai", queue.done || 0],
      ["Gagal", queue.failed || 0],
    ].map(([label, value]) => ({ label, value: fmt(value), pct: `${pct(value, queueTotal)}%` })),
  );

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

  const groups = [
    {
      title: "Dataset",
      items: [
        {
          code: "N-02",
          label: "Dokumen publik",
          value: summary.documents,
          tone: "intel",
          hint: `${fmt(intel.sourceDocuments || summary.documents)} sumber`,
        },
        {
          code: "N-03",
          label: "Template",
          value: summary.templates,
          hint: "pola ekstraksi",
        },
        {
          code: "N-05",
          label: "File selesai",
          value: summary.doneFiles,
          tone: "cyan",
          hint: `riwayat ${fmt(summary.history)}`,
        },
        {
          code: "N-06",
          label: "Foto tersensor",
          value: summary.photos,
          tone: "amber",
          hint: `${photoPct}% entitas`,
        },
      ],
    },
    {
      title: "Indeks",
      items: [
        {
          code: "I-01",
          label: "Entri indeks",
          value: indexTotal.entries,
          tone: "intel",
          hint: `${fmt(indexRows.length)} tipe field`,
        },
        {
          code: "I-02",
          label: "Referensi",
          value: indexTotal.refs,
          tone: "cyan",
          hint: "silang antar entitas",
        },
        {
          code: "G-01",
          label: "Edge graf",
          value: intel.graphEdges,
          hint: `${intel.entityLinkRate ?? "—"} identitas/entitas`,
        },
        {
          code: "G-02",
          label: "Vektor aktif",
          value: intel.activeVectors,
          hint: topCoverage ? `terkuat ${topCoverage.label}` : "kelengkapan",
        },
      ],
    },
    {
      title: "Operasi",
      items: [
        {
          code: "GEO-1",
          label: "Orang di peta",
          value: geo.geocodedEntities,
          tone: "cyan",
          hint: `${fmt(geo.mappedCities)} kota terpetakan`,
        },
        {
          code: "GEO-2",
          label: "Punya data kota",
          value: geo.entitiesWithCity,
          hint: `${pct(geo.entitiesWithCity, entityTotal)}% entitas`,
        },
        {
          code: "GEO-3",
          label: "Kota unik",
          value: geo.uniqueCities,
          hint: `${fmt(geo.mappedCities)} punya koordinat`,
        },
        {
          code: "Q-01",
          label: "Antrian URL",
          value: queue.total,
          tone: "amber",
          hint: `${fmt(queue.pending)} menunggu · ${fmt(queue.failed)} gagal`,
        },
      ],
    },
  ];

  clear(container);
  container.className = "volume-panel";

  for (const group of groups) {
    const section = document.createElement("section");
    section.className = "volume-group";

    const title = document.createElement("h4");
    title.className = "volume-group__title";
    appendText(title, group.title);
    section.appendChild(title);

    const grid = document.createElement("div");
    grid.className = "volume-group__grid";
    for (const item of group.items) {
      grid.appendChild(createVolumeStatCard(item));
    }
    section.appendChild(grid);
    container.appendChild(section);
  }

  const capVol = document.getElementById("overview-volume-caption");
  if (capVol) {
    capVol.textContent = [
      `${fmt(summary.documents)} dok`,
      `${fmt(indexTotal.entries)} entri`,
      `${fmt(geo.geocodedEntities)} di peta`,
      `${pct(queue.done, queueTotal)}% unduhan`,
    ].join(" · ");
  }
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

function renderQueueStats(queue, containerId = "queue-stats") {
  const total = queue.total || 1;
  const items = [
    { label: "Menunggu", value: queue.pending, color: COLORS.amber },
    { label: "Berhasil", value: queue.done, color: COLORS.intel },
    { label: "Gagal", value: queue.failed, color: COLORS.danger },
  ];
  if (queue.processing > 0) {
    items.push({ label: "Sedang diproses", value: queue.processing, color: COLORS.cyan });
  }

  const container = document.getElementById(containerId);
  if (!container) return;
  clear(container);

  for (const item of items) {
    const row = document.createElement("div");
    row.className = "queue-stat";

    const dot = document.createElement("span");
    dot.className = "queue-stat-dot";
    dot.style.background = item.color;

    const label = document.createElement("span");
    label.className = "queue-stat-label";
    appendText(label, item.label);

    const value = document.createElement("span");
    value.className = "queue-stat-value";
    appendText(value, `${fmt(item.value)} · ${pct(item.value, total)}%`);

    row.append(dot, label, value);
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

  const updateListMeta = () => {
    if (!listMeta) return;
    if (!rows.length) {
      listMeta.textContent = "0 entri";
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
    visibleIndices = rows.map((_, index) => index);

    if (!visibleIndices.length) {
      const empty = document.createElement("p");
      empty.className = "preview-list-empty";
      empty.textContent = "Tidak ada sampel tersensor.";
      listEl.appendChild(empty);
      showEmptyDetail("# tidak ada sampel tersensor");
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
    return;
  }

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

function queueChartSegments(queue) {
  const core = QUEUE_CHART_SEGMENTS.filter((s) => !s.optional);
  const extra = QUEUE_CHART_SEGMENTS.filter((s) => s.optional && (queue[s.key] || 0) > 0);
  return [...core, ...extra];
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

function buildQueueChart(queue, canvasId = "queue-chart") {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return null;
  if (typeof Chart === "undefined") {
    showChartFallbackTables();
    return null;
  }

  const existing = Chart.getChart(ctx);
  if (existing) existing.destroy();

  const segments = queueChartSegments(queue);
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

function buildIndexChart(indexRows) {
  const ctx = document.getElementById("index-chart");
  if (!ctx) return null;
  if (typeof Chart === "undefined") {
    showChartFallbackTables();
    return null;
  }

  const existing = Chart.getChart(ctx);
  if (existing) existing.destroy();

  const rows = indexRows || [];
  const labels = rows.map((r) => r.type);
  const wrap = ctx.closest(".chart-wrap--analytics-index");
  if (wrap) {
    const rowHeight = 32;
    wrap.style.minHeight = `${Math.max(220, rows.length * rowHeight + 56)}px`;
  }

  return new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Entri",
          data: rows.map((r) => r.entries),
          backgroundColor: COLORS.intel,
          borderRadius: 2,
          borderSkipped: false,
        },
        {
          label: "Referensi",
          data: rows.map((r) => r.refs),
          backgroundColor: COLORS.cyan,
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
        legend: {
          ...chartDefaults.plugins.legend,
          position: "top",
          align: "end",
        },
      },
      scales: {
        x: {
          ...chartDefaults.scales.x,
          grid: { color: COLORS.grid },
        },
        y: {
          ...chartDefaults.scales.y,
          grid: { display: false },
          ticks: {
            ...chartDefaults.scales.y.ticks,
            autoSkip: false,
          },
        },
      },
    },
  });
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

function renderTopCities(geo, containerId = "overview-top-cities", limit = 8) {
  const container = document.getElementById(containerId);
  if (!container || !geo?.clusters?.length) return;
  clear(container);

  const filter = (document.getElementById("overview-city-filter")?.value || "").trim().toLowerCase();
  const matched = [...geo.clusters]
    .filter((city) => {
      if (!filter) return true;
      return `${city.label || ""} ${city.province || ""}`.toLowerCase().includes(filter);
    })
    .sort((a, b) => (b.count || 0) - (a.count || 0));
  const cities = matched.slice(0, filter ? 20 : limit);
  const max = cities[0]?.count || 1;

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

    const head = document.createElement("button");
    head.type = "button";
    head.className = "overview-city-head";
    head.title = `Buka ${city.label} di peta`;
    head.addEventListener("click", () => {
      if (typeof activateDashboardTab === "function") {
        activateDashboardTab("geo");
      }
      const detail = encodeURIComponent(city.key || city.label);
      history.replaceState(null, "", `#peta:${detail}`);
      window.setTimeout(() => {
        if (typeof window.focusDompengMapCity === "function") {
          window.focusDompengMapCity(city.key || city.label);
        }
      }, 180);
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
  const input = document.getElementById("overview-city-filter");
  if (!input || input.dataset.bound === "true") return;
  input.dataset.bound = "true";
  input.addEventListener("input", () => {
    if (dashboardDataCache?.geo) renderTopCities(dashboardDataCache.geo);
  });
}

function renderOpsStats(data) {
  const grid = document.getElementById("ops-stats-grid");
  if (!grid) return;

  const { summary = {}, queue = {}, intel = {}, indexTotal = {}, geo = {} } = data;
  const queueTotal = queue.total || 1;

  const cards = [
    {
      code: "Q-01",
      label: "Antrian menunggu",
      value: queue.pending,
      tone: "amber",
      hint: `${pct(queue.pending, queueTotal)}% · ${fmt(queue.processing || 0)} diproses`,
    },
    {
      code: "Q-02",
      label: "Unduhan selesai",
      value: queue.done,
      tone: "intel",
      hint: intel.pipelineSuccessPct != null ? `Pipeline ${intel.pipelineSuccessPct}% sukses` : `${pct(queue.done, queueTotal)}%`,
    },
    {
      code: "Q-03",
      label: "Unduhan gagal",
      value: queue.failed,
      tone: queue.failed > 0 ? "danger" : undefined,
      hint: intel.pipelineFailurePct != null ? `Kegagalan ${intel.pipelineFailurePct}%` : `${pct(queue.failed, queueTotal)}%`,
    },
    {
      code: "D-01",
      label: "Dokumen publik",
      value: summary.documents,
      tone: "intel",
      hint: `${fmt(intel.sourceDocuments || summary.documents)} sumber terindeks`,
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

  clear(grid);
  for (const card of cards) {
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

  renderOpsStats(data);
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

  for (const row of indexRows || []) {
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

  buildIndexChart(data.indexRows);
  renderIndexStats(data.indexTotal);
  renderCoverageTable(data.coverage, data.coverageTotal || 1);
  renderSourceStats(data.sourceStats, data.summary?.documents);
  renderIndexFieldTable(data.indexRows);
  renderIntelMetrics(data.intel, data.queue, data.indexRows);
}

function renderOverviewDashboard(data) {
  const capCov = document.getElementById("overview-coverage-caption");
  if (capCov) {
    capCov.textContent = `Kelengkapan dari ${fmt(data.coverageTotal)} entitas terindeks`;
  }

  const capQueue = document.getElementById("overview-queue-caption");
  if (capQueue && data.queue) {
    capQueue.textContent = `${fmt(data.queue.total)} URL · ${pct(data.queue.done, data.queue.total)}% selesai`;
  }

  const capGeo = document.getElementById("overview-geo-caption");
  if (capGeo && data.geo) {
    capGeo.textContent = `${fmt(data.geo.geocodedEntities)} entitas di ${fmt(data.geo.mappedCities)} kota`;
  }

  renderUsageBar(data.coverage, data.coverageTotal || 1, "overview-coverage-bar");
  renderQueueStats(data.queue, "overview-queue-stats");
  renderTopCities(data.geo);
  buildCoverageChart(data.coverage, "overview-coverage-chart");
  buildQueueChart(data.queue, "overview-queue-chart");
}

function ensureDompengGeoMap({ focus = null } = {}) {
  const geo = window.DOMPENG_PENDING_GEO;
  if (!geo?.clusters?.length || typeof initDompengGeoMap !== "function") return null;
  let map = window.DOMPENG_MAP;
  if (!map) {
    map = initDompengGeoMap(geo, { fitBounds: true });
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

async function init() {
  try {
    const res = await fetch("data/stats.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`Gagal memuat data (${res.status})`);
    const data = await res.json();
    dashboardDataCache = data;
    window.DOMPENG_PENDING_GEO = data.geo;

    document.getElementById("updated").textContent = `Diperbarui · ${data.updated} · data disamarkan`;

    renderDashboardData(data);

    if (typeof onDashboardTabShown === "function") {
      const active = document.querySelector(".tab-panel.is-active");
      if (active?.dataset.tab) onDashboardTabShown(active.dataset.tab);
    }

    if (typeof window.setShareSnapshotFromData === "function") {
      window.setShareSnapshotFromData(data);
    }

    if (typeof markDashboardReady === "function") {
      markDashboardReady();
    } else {
      document.body.classList.add("dashboard-ready");
    }
  } catch (err) {
    document.getElementById("updated").textContent = "Data belum tersedia";
    showError(`${err.message}. Jalankan ./summary.sh dari repo utama untuk menghasilkan web/data/stats.json.`);
  }
}

document.addEventListener("DOMContentLoaded", init);
document.addEventListener("DOMContentLoaded", initDashboardViewMode);
window.ensureDompengGeoMap = ensureDompengGeoMap;
