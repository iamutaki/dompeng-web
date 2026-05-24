# Performance baseline — Fase 1 audit

**Branch:** `performance-optimization` (dibuat dari `main` @ `ceb298a88b`)  
**Tanggal audit:** 2026-05-25  
**Scope:** `web/` — dashboard statis DOMPENG (Cloudflare Workers + assets)

Tidak ada perubahan perilaku kode pada fase ini; dokumen ini menjadi titik balik sebelum Fase 2–4.

---

## 1. Ukuran aset lokal (uncompressed)

| Aset | Bytes | Catatan |
|------|------:|---------|
| `index.html` | 50,009 | Termasuk JSON-LD inline ~2.8 KB di `<head>` |
| `css/style.css` | ~150,528 | 7,450 baris; belum minify |
| `js/app.js` | ~145,408 | 4,367 baris; belum minify |
| `js/map.js` | ~29,696 | MapLibre wrapper |
| `js/tabs.js` | ~9,011 | Navigasi tab |
| `js/share.js` | ~8,192 | |
| `js/fmt.js` | ~2,662 | |
| `data/stats.json` | ~93,184 | Dimuat di `init()` |
| `data/geo-clusters.json` | ~22,528 | Duplikat subset geo di stats |
| `icon-512.png` | ~101,376 | Tidak di above-the-fold |
| `og-image-1200x630.png` | ~75,776 | Meta/OG saja |

**Total JS lokal (defer):** ~195 KB  
**Total data JSON first paint:** ~91 KB (`stats.json` saja via fetch)

---

## 2. Aset eksternal (render path)

### 2.1 Stylesheet — render-blocking

| URL | Masalah |
|-----|---------|
| `fonts.googleapis.com` (IBM Plex Sans/Mono) | Blocking CSS + DNS; 3 domain (googleapis, gstatic, font files) |
| `unpkg.com/.../maplibre-gl.css` | Blocking; dipakai hanya tab **Peta** |
| `css/style.css` | Blocking (wajar, kritis) |

`preconnect` sudah ada untuk Google Fonts (baris 38–39). **Belum** ada `preconnect` ke `cdn.jsdelivr.net` / `unpkg.com`.

### 2.2 Script — `defer` (tidak blocking parse, tetap diunduh semua)

| URL | Perkiraan | Dipakai saat |
|-----|-----------|--------------|
| `chart.js@4.4.7` (jsDelivr) | ~200 KB | Radar overview, donut ops |
| `echarts@5.6.0` (jsDelivr) | ~1 MB | Sankey overview, bar indeks |
| `maplibre-gl@4.7.1` (unpkg) | ~800 KB+ | Tab Peta |
| `js/*.js` lokal | ~195 KB | Selalu |

**Masalah utama:** ketiga library chart/map diunduh pada **setiap** kunjungan meski tab default hanya **Ringkasan**.

### 2.3 Gambar

- Tidak ada `<img>` di `index.html` (dashboard = canvas + DOM).
- `loading="lazy"` belum relevan untuk LCP; icon/OG tidak memengaruhi first paint.

---

## 3. Alur muat JavaScript (baseline perilaku)

```
DOMContentLoaded
  ├─ tabs.js      → initDashboardTabs
  ├─ share.js     → initDashboardShare
  ├─ map.js       → init jika DOMPENG_GEO (biasanya tidak)
  └─ app.js       → init()
        fetch("data/stats.json", { cache: "no-store" })  ← bypass cache browser
        renderDashboardData(data)
          ├─ renderOverviewDashboard → buildOverviewSankey (ECharts), renderOverviewQueueRadar (Chart.js)
          ├─ renderAnalyticsDashboard → refreshIndexViews → buildIndexBarChart (ECharts)  [tab tersembunyi]
          ├─ renderOpsDashboard → buildQueueChart (Chart.js)  [tab tersembunyi]
          └─ refreshGeoCityViews (peta lazy sampai tab/geo filter)
```

**6×** listener `DOMContentLoaded` tersebar di 4 file.

**119** atribut `id=` di `index.html` — jangan diubah/hapus tanpa cek `getElementById` di JS (~105 referensi di `app.js` saja).

---

## 4. CSS — temuan audit

| Metrik | Nilai |
|--------|-------|
| Baris | 7,450 |
| `@media` | 13 |
| `backdrop-filter` | 1 (blur 5px — modal overlay) |
| `content-visibility` | **0** |
| `will-change` | **0** |
| `font-display` di CSS lokal | **0** (bergantung pada `display=swap` di URL Google Fonts) |

### Struktur tab

- `.tab-panel { display: none }` — panel non-aktif tidak ditampilkan tetapi **tetap di DOM**.
- Chart di panel tersembunyi tetap di-**init** saat load (ECharts/Chart.js).

### Elemen visual berat

- `.scanline` — overlay fixed full viewport, `z-index: 9999`, repeating gradient (paint tetap).
- Background body: dual grid gradient 24×24px.

---

## 5. Cache (server vs client)

`web/src/worker.js` mengatur:

- `.json` → `max-age=300`
- `.css/.js` → `max-age=86400`

Namun `app.js` memaksa `fetch(..., { cache: "no-store" })` untuk `stats.json` → **selalu revalidate** di browser.

---

## 6. Metrik Lighthouse (belum diukur otomatis)

Jalankan manual sebelum Fase 2 (simpan skor di sini):

```bash
cd web && npx wrangler dev   # atau static server di :8787
# Chrome DevTools → Lighthouse → Performance (Mobile, Slow 4G)
```

| Metrik | Pre-optimization | Post (isi setelah Fase 4) |
|--------|------------------|---------------------------|
| Performance score | _TBD_ | |
| LCP | _TBD_ | |
| TBT | _TBD_ | |
| CLS | _TBD_ | |

---

## 7. Prioritas untuk fase berikutnya

### Fase 2 (2026-05-25) — Critical rendering path

- [x] `preconnect` / `dns-prefetch` ke CDN (jsDelivr, unpkg, CARTO basemap)
- [x] `preload` `css/style.css`; font Google non-blocking (`preload` + `onload`)
- [x] Hapus Chart.js / ECharts / MapLibre dari `<head>` → lazy via `js/load-libs.js`
- [x] Chart init per tab (`ensureDashboardTabCharts`) — overview saat load, lainnya on-demand
- [x] Hapus `cache: "no-store"` pada fetch `stats.json`
- [ ] Lighthouse ulang (§6)

### Fase 2b (JS — dampak terbesar, tanpa ubah `stats.json`)

### Fase 3 (CSS)

- [ ] `content-visibility: auto` pada `.tab-panel:not(.is-active)` atau board besar
- [ ] `contain` / `content-visibility` pada `.intel-module` di tab non-aktif
- [ ] `will-change: transform` hanya pada `#geo-map` saat tab geo aktif (opsional)
- [ ] Self-host font subset atau fallback system-ui untuk FCP

### Fase 4 (validasi)

- [ ] Bandingkan 119 `id` + class pengikat (`data-tab`, `data-chart-modal`, dll.)
- [ ] Smoke test 6 tab: Ringkasan, Peta, Indeks, Operasi, Sampel, Data
- [ ] Lighthouse ulang; isi tabel §6
- [ ] Commit ke `performance-optimization`

---

## 8. Rollback

```bash
git checkout main
# atau
git branch -D performance-optimization   # hanya jika ingin buang branch
```

Perubahan optimasi hanya di `web/` (+ dokumen ini); data pipeline / `stats.json` generator tidak disentuh di rencana ini.
