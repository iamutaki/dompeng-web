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

function renderIntelBrief(intel) {
  const container = document.getElementById("intel-brief");
  clear(container);

  const dominantLabel = VECTOR_LABELS[intel.dominantVectorId] || "Data profil";
  const cards = [
    {
      label: "Total profil orang",
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
      hint: `Rata-rata ${intel.entityLinkRate} identitas per profil`,
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

function renderStats(summary) {
  const cards = [
    { code: "N-01", value: summary.persons, label: "Profil orang", tone: "intel" },
    { code: "N-02", value: summary.documents, label: "Dokumen internet", tone: "intel" },
    { code: "N-03", value: summary.templates, label: "Template ekstraksi" },
    { code: "N-04", value: summary.history, label: "Riwayat file", tone: "cyan" },
    { code: "N-05", value: summary.doneFiles, label: "File selesai diproses" },
    { code: "N-06", value: summary.photos, label: "Foto profil", tone: "amber" },
  ];

  const grid = document.getElementById("stats-grid");
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
    grid.appendChild(article);
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
  appendText(left, "Proporsi kelengkapan profil");
  const right = document.createElement("span");
  appendText(right, top.label ? `${top.label} · ${top.pct}% profil` : "");
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

function renderIndexStats(indexTotal) {
  const container = document.getElementById("index-stats");
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

function renderShowcaseEntities(entities) {
  const container = document.getElementById("entity-showcase");
  if (!container) return;
  clear(container);

  const previewMeta = document.getElementById("preview-meta");
  if (previewMeta) {
    const n = entities?.length || 0;
    previewMeta.textContent = `${fmt(n)} contoh profil · gulir untuk melihat semua`;
    previewMeta.hidden = n === 0;
  }

  for (const entity of entities) {
    const card = document.createElement("article");
    card.className = "entity-card entity-card--row";

    const main = document.createElement("div");
    main.className = "entity-row-main";

    const identity = document.createElement("div");
    identity.className = "entity-row-identity";

    const head = document.createElement("div");
    head.className = "entity-card-head";
    const ref = document.createElement("span");
    ref.className = "entity-ref";
    appendText(ref, entity.ref);
    head.appendChild(ref);

    const score = document.createElement("div");
    score.className = "entity-score";
    const docHint = entity.documentCount ? ` · ${entity.documentCount} dokumen` : "";
    appendText(score, `${entity.identifierCount} identitas · ${entity.edgeCount} relasi${docHint}`);
    head.appendChild(score);

    const name = document.createElement("div");
    name.className = "entity-name";
    appendFaint(name, entity.name || "—");

    const meta = document.createElement("div");
    meta.className = "entity-meta";
    const metaItems = [
      entity.gender,
      entity.sector,
      entity.maritalStatus,
      entity.dob,
      entity.pob,
    ].filter(Boolean);
    for (const item of metaItems) {
      const chip = document.createElement("span");
      chip.className = "entity-chip";
      if (item === entity.dob || item === entity.pob) {
        appendFaint(chip, String(item));
      } else {
        appendText(chip, String(item));
      }
      meta.appendChild(chip);
    }
    if (entity.hasPhoto) {
      const chip = document.createElement("span");
      chip.className = "entity-chip entity-chip--intel";
      appendText(chip, "Ada foto");
      meta.appendChild(chip);
    }

    identity.append(head, name, meta);

    const idList = document.createElement("div");
    idList.className = "entity-id-list";
    for (const ident of entity.identifiers || []) {
      const row = document.createElement("div");
      row.className = "entity-id-row";
      const type = document.createElement("span");
      type.className = "entity-id-type";
      appendText(type, ident.type);
      const value = document.createElement("span");
      value.className = "entity-id-value";
      appendFaint(value, ident.value);
      row.append(type, value);
      idList.appendChild(row);
    }

    const idsCol = document.createElement("div");
    idsCol.className = "entity-row-ids";
    idsCol.appendChild(idList);

    const graph = document.createElement("div");
    graph.className = "entity-graph";
    const graphLine = document.createElement("div");
    const strong = document.createElement("strong");
    appendText(strong, `${entity.edgeCount}`);
    graphLine.appendChild(strong);
    graphLine.appendChild(document.createTextNode(" relasi · "));
    appendText(graphLine, `${entity.identifierCount} identitas terisi`);
    graph.appendChild(graphLine);

    const relations = document.createElement("div");
    relations.className = "entity-relations";
    for (const [key, count] of Object.entries(entity.relations || {})) {
      const tag = document.createElement("span");
      tag.className = "relation-tag";
      appendText(tag, `${relationLabel(key)} ×${count}`);
      relations.appendChild(tag);
    }
    graph.appendChild(relations);

    if (entity.occupation) {
      const occ = document.createElement("div");
      occ.className = "entity-occupation";
      appendFaint(occ, entity.occupation);
      graph.appendChild(occ);
    }

    const graphCol = document.createElement("div");
    graphCol.className = "entity-row-graph";
    graphCol.appendChild(graph);

    main.append(identity, idsCol, graphCol);
    card.appendChild(main);

    if (entity.documents?.length) {
      const docsRow = document.createElement("div");
      docsRow.className = "entity-row-docs";

      const docLabel = document.createElement("div");
      docLabel.className = "entity-docs-label";
      appendText(docLabel, "Dokumen internet");
      docsRow.appendChild(docLabel);

      const docList = document.createElement("div");
      docList.className = "entity-row-doc-list";

      for (const doc of entity.documents) {
        const row = document.createElement("div");
        row.className = "entity-doc-row";

        const docHead = document.createElement("div");
        docHead.className = "entity-doc-head";
        const docRef = document.createElement("span");
        docRef.className = "entity-doc-ref";
        appendText(docRef, doc.ref);
        if (doc.importedAt) {
          const docDate = document.createElement("span");
          docDate.className = "entity-doc-date";
          appendText(docDate, doc.importedAt);
          docHead.append(docRef, docDate);
        } else {
          docHead.appendChild(docRef);
        }

        const docTitle = document.createElement("div");
        docTitle.className = "entity-doc-title";
        appendFaint(docTitle, doc.title);

        row.append(docHead, docTitle);

        if (doc.context) {
          const ctx = document.createElement("div");
          ctx.className = "entity-doc-context";
          appendFaint(ctx, doc.context);
          row.appendChild(ctx);
        }
        if (doc.filename) {
          const file = document.createElement("div");
          file.className = "entity-doc-file";
          appendFaint(file, doc.filename);
          row.appendChild(file);
        }

        docList.appendChild(row);
      }

      docsRow.appendChild(docList);
      card.appendChild(docsRow);
    }

    container.appendChild(card);
  }
}

function renderRecentDocs(docs) {
  const tbody = document.getElementById("recent-docs");
  if (!tbody) return;
  clear(tbody);

  for (const doc of docs) {
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

function queueCenterLabelPlugin(queue) {
  return {
    id: "queueCenterLabel",
    beforeDraw(chart) {
      const { width, height, ctx } = chart;
      const total = (queue.pending || 0) + (queue.done || 0) + (queue.failed || 0) + (queue.processing || 0);
      const pct = total ? Math.round((queue.done / total) * 100) : 0;
      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = '700 1.35rem "IBM Plex Mono", monospace';
      ctx.fillStyle = "#00d4aa";
      ctx.fillText(`${pct}%`, width / 2, height / 2 - 6);
      ctx.font = '600 0.5625rem "IBM Plex Mono", monospace';
      ctx.fillStyle = "#7a8fa8";
      ctx.fillText("SELESAI", width / 2, height / 2 + 14);
      ctx.restore();
    },
  };
}

function buildQueueChart(queue, canvasId = "queue-chart") {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return null;
  const labels = ["Menunggu", "Berhasil", "Gagal"];
  const values = [queue.pending, queue.done, queue.failed];
  const colors = [COLORS.amber, COLORS.intel, COLORS.danger];
  if (queue.processing > 0) {
    labels.push("Processing");
    values.push(queue.processing);
    colors.push(COLORS.cyan);
  }

  const isAnalytics = canvasId === "queue-chart";
  const plugins = {
    legend: { display: false },
    tooltip: chartDefaults.plugins.tooltip,
  };

  return new Chart(ctx, {
    type: "doughnut",
    data: {
      labels,
      datasets: [
        {
          data: values,
          backgroundColor: colors,
          borderColor: "#0b1118",
          borderWidth: isAnalytics ? 4 : 3,
          hoverOffset: isAnalytics ? 6 : 4,
          spacing: isAnalytics ? 2 : 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: isAnalytics ? "58%" : "64%",
      layout: isAnalytics ? { padding: 4 } : undefined,
      plugins,
    },
    plugins: isAnalytics ? [queueCenterLabelPlugin(queue)] : [],
  });
}

function buildIndexChart(indexRows) {
  const ctx = document.getElementById("index-chart");
  return new Chart(ctx, {
    type: "bar",
    data: {
      labels: indexRows.map((r) => r.type),
      datasets: [
        {
          label: "Entri",
          data: indexRows.map((r) => r.entries),
          backgroundColor: COLORS.intel,
          borderRadius: 2,
        },
        {
          label: "Referensi",
          data: indexRows.map((r) => r.refs),
          backgroundColor: COLORS.cyan,
          borderRadius: 2,
        },
      ],
    },
    options: {
      ...chartDefaults,
      scales: {
        x: {
          ...chartDefaults.scales.x,
          grid: { display: false },
        },
        y: chartDefaults.scales.y,
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

function renderChangelogSummary(changelog) {
  const container = document.getElementById("changelog-summary");
  if (!container) return;
  clear(container);

  const added = changelog.summary?.Added || 0;
  const changed = changelog.summary?.Changed || 0;
  const fixed = changelog.summary?.Fixed || 0;

  const cards = [
    {
      label: "Versi terbaru",
      value: changelog.latestVersion || "—",
      hint: changelog.latestDate || "Tanpa tanggal",
    },
    {
      label: "Total rilis",
      value: fmt(changelog.totalReleases || 0),
      hint: `${(changelog.releases || []).length} ditampilkan di bawah`,
    },
    {
      label: "Fitur baru",
      value: fmt(added),
      hint: "Sepanjang riwayat changelog",
    },
    {
      label: "Perbaikan",
      value: fmt(fixed),
      hint: `${fmt(changed)} perubahan tercatat`,
    },
  ];

  for (const card of cards) {
    const stat = document.createElement("article");
    stat.className = "changelog-stat";

    const label = document.createElement("div");
    label.className = "changelog-stat-label";
    appendText(label, card.label);

    const value = document.createElement("div");
    value.className = "changelog-stat-value";
    appendText(value, card.value);

    const hint = document.createElement("div");
    hint.className = "changelog-stat-hint";
    appendText(hint, card.hint);

    stat.append(label, value, hint);
    container.appendChild(stat);
  }
}

function renderChangelogFeed(changelog) {
  const container = document.getElementById("changelog-feed");
  if (!container) return;
  clear(container);

  for (const [index, release] of (changelog.releases || []).entries()) {
    const itemCount = release.sections.reduce((sum, sec) => sum + sec.items.length, 0);
    const details = document.createElement("details");
    details.className = "changelog-release";
    if (index === 0) details.open = true;

    const summary = document.createElement("summary");
    const left = document.createElement("span");
    const version = document.createElement("span");
    version.className = "changelog-version";
    appendText(version, release.version);
    const date = document.createElement("span");
    date.className = "changelog-date";
    appendText(date, release.date);
    left.append(version, date);

    const count = document.createElement("span");
    count.className = "changelog-count";
    appendText(count, `${itemCount} catatan`);

    summary.append(left, count);
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

function renderChangelog(changelog) {
  if (!changelog) return;
  renderChangelogSummary(changelog);
  renderChangelogFeed(changelog);

  const caption = document.getElementById("changelog-caption");
  if (caption && changelog.latestVersion) {
    caption.textContent =
      `Versi terbaru ${changelog.latestVersion} (${changelog.latestDate}) · ${changelog.totalReleases} rilis total`;
  }

  const kicker = document.querySelector(".dashboard-kicker");
  if (kicker && changelog.latestVersion) {
    kicker.textContent = `Versi ${changelog.latestVersion}`;
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

  const cities = [...geo.clusters].sort((a, b) => (b.count || 0) - (a.count || 0)).slice(0, limit);
  const max = cities[0]?.count || 1;

  for (const city of cities) {
    const li = document.createElement("li");
    li.className = "overview-city-item";

    const head = document.createElement("div");
    head.className = "overview-city-head";

    const name = document.createElement("span");
    name.className = "overview-city-name";
    appendText(name, city.label);

    const count = document.createElement("span");
    count.className = "overview-city-count";
    appendText(count, `${fmt(city.count)} orang`);

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

function renderOverviewRecentDocs(docs, limit = 8) {
  const tbody = document.getElementById("overview-recent-docs");
  if (!tbody) return;
  clear(tbody);

  for (const doc of (docs || []).slice(0, limit)) {
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

function renderOverviewDashboard(data) {
  const capCov = document.getElementById("overview-coverage-caption");
  if (capCov) {
    capCov.textContent = `Kelengkapan dari ${fmt(data.coverageTotal)} profil orang`;
  }

  const capQueue = document.getElementById("overview-queue-caption");
  if (capQueue && data.queue) {
    capQueue.textContent = `${fmt(data.queue.total)} URL · ${pct(data.queue.done, data.queue.total)}% selesai`;
  }

  const capGeo = document.getElementById("overview-geo-caption");
  if (capGeo && data.geo) {
    capGeo.textContent = `${fmt(data.geo.geocodedEntities)} orang di ${fmt(data.geo.mappedCities)} kota`;
  }

  renderUsageBar(data.coverage, data.coverageTotal || 1, "overview-coverage-bar");
  renderQueueStats(data.queue, "overview-queue-stats");
  renderTopCities(data.geo);
  renderOverviewRecentDocs(data.recentDocs);
  buildCoverageChart(data.coverage, "overview-coverage-chart");
  buildQueueChart(data.queue, "overview-queue-chart");
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

    document.getElementById("updated").textContent = `Diperbarui · ${data.updated} · data disamarkan`;

    if (data.intel) {
      renderIntelBrief(data.intel);
    }

    document.getElementById("coverage-caption").textContent =
      `Kelengkapan data dari ${fmt(data.coverageTotal)} profil orang`;
    document.getElementById("queue-caption").textContent =
      `Antrian unduhan · ${fmt(data.queue.total)} URL dipantau`;

    renderStats(data.summary);
    renderOverviewDashboard(data);
    if (data.showcaseEntities?.length) {
      renderShowcaseEntities(data.showcaseEntities);
    }
    renderUsageBar(data.coverage, data.coverageTotal || 1);
    renderQueueStats(data.queue);
    renderIndexStats(data.indexTotal);
    renderRecentDocs(data.recentDocs);
    if (data.changelog) {
      renderChangelog(data.changelog);
    }

    if (data.geo?.clusters?.length && typeof initDompengGeoMap === "function") {
      initDompengGeoMap(data.geo, { fitBounds: true });
    }

    buildCoverageChart(data.coverage);
    buildQueueChart(data.queue);
    buildIndexChart(data.indexRows);

    if (typeof onDashboardTabShown === "function") {
      const active = document.querySelector(".tab-panel.is-active");
      if (active?.dataset.tab) onDashboardTabShown(active.dataset.tab);
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
