# DOMPENG Dashboard

Dashboard statis untuk visualisasi ringkasan data DOMPENG. Di-generate otomatis dari repo utama via `./summary.sh`.

## Struktur

```
web/
├── index.html              # Dashboard utama (SEO meta di-patch otomatis)
├── geo/index.html          # Halaman peta cluster kota (di-generate)
├── css/style.css           # Tema gelap OSINT
├── js/app.js               # Chart.js + render dashboard
├── js/map.js               # MapLibre city cluster map
├── data/stats.json         # Data dashboard — di-generate
├── data/geo-clusters.json  # Cluster kota — di-generate
├── data/id-city-coords.json # Lookup koordinat kota/provinsi
├── og-image.png          # OG/Twitter image — di-copy dari docs/ saat summary.sh
├── wrangler.toml         # Cloudflare Workers config
├── src/worker.js         # Worker: cache + security headers
├── deploy.sh             # summary.sh + wrangler deploy
├── package.json          # wrangler CLI
├── .assetsignore         # Exclude tooling dari asset upload
├── sitemap.xml             # Di-generate untuk SEO
├── robots.txt              # Di-generate untuk SEO
└── .nojekyll               # GitHub Pages: serve file apa adanya
```

## Update data

Dari root repo DOMPENG:

```bash
./summary.sh
```

Script akan menulis:

- `web/data/stats.json` — semua panel dashboard + geo + changelog
- `web/data/geo-clusters.json` — cluster kota untuk MapLibre
- `web/geo/index.html` — halaman peta dedicated
- `web/sitemap.xml` + `web/robots.txt` — SEO
- Patch SEO meta di `web/index.html` (title, description, JSON-LD, konten crawler)

### Canonical URL (SEO)

Set env `DOMPENG_SITE_URL` sebelum `./summary.sh` agar canonical, Open Graph, dan sitemap memakai domain production:

```bash
DOMPENG_SITE_URL=https://your-user.github.io/dompeng-web ./summary.sh
```

## Geo clustering (GEO-07)

Cluster dihitung dari `structured_address` level **city** pada person records:

- Agregat count entity per kota (tanpa PII individu)
- Bubble di peta MapLibre — ukuran & angka = jumlah entity
- Kota tanpa koordinat di-skip; fallback ke centroid provinsi jika ada di `id-city-coords.json`

Tambah kota baru di `web/data/id-city-coords.json` lalu jalankan ulang `./summary.sh`.

## Preview lokal

```bash
cd web
python3 -m http.server 8080
```

Buka http://localhost:8080

## Git submodule

Folder ini dirancang agar bisa dipisah menjadi repo sendiri (seperti `extension/`):

```bash
git submodule add https://github.com/<user>/dompeng-web web
```

Setelah submodule aktif, `./summary.sh` tetap menulis ke `web/`. Commit perubahan data di dalam submodule, lalu push repo web untuk deploy.

## Cloudflare Workers

Dashboard siap deploy sebagai **Workers Static Assets** + worker ringan untuk cache/security headers.

### Prasyarat

1. Akun Cloudflare
2. Node.js 18+
3. Login sekali: `npx wrangler login`

### Deploy

Dari root repo (regenerates data + deploy):

```bash
DOMPENG_SITE_URL=https://dompeng-dashboard.<account>.workers.dev ./web/deploy.sh
```

Atau manual:

```bash
./summary.sh
cd web
npm install
DOMPENG_SITE_URL=https://your-worker.workers.dev npm run deploy
```

### Preview lokal (Wrangler)

```bash
cd web
npm install
npm run dev
```

Buka URL yang ditampilkan Wrangler (biasanya `http://localhost:8787`).

### Konfigurasi

| File | Fungsi |
|------|--------|
| `wrangler.toml` | Nama worker, static assets, HTML trailing slash |
| `src/worker.js` | Cache headers + redirect `/geo` → `/geo/` |
| `.assetsignore` | Exclude `node_modules`, `src/`, tooling dari upload |
| `deploy.sh` | `./summary.sh` + `wrangler deploy` |

Ubah nama worker di `wrangler.toml` (`name = "dompeng-dashboard"`) sebelum deploy pertama.

Custom domain: Cloudflare Dashboard → Workers → dompeng-dashboard → Settings → Domains & Routes.

### SEO di Workers

Set `DOMPENG_SITE_URL` ke URL Workers/custom domain **sebelum** `./summary.sh` agar canonical, sitemap, dan Open Graph benar:

```bash
DOMPENG_SITE_URL=https://dompeng.example.com ./summary.sh
```

OG image disalin ke `web/og-image.png` otomatis (self-contained, tidak bergantung `docs/` repo utama).

## GitHub Pages

1. Push repo `web/` ke GitHub (standalone atau sebagai submodule)
2. **Settings → Pages → Source:** Deploy from branch `main`, folder `/ (root)`
3. Pastikan hasil `./summary.sh` ter-commit (`stats.json`, `geo/`, `sitemap.xml`)
4. URL: `https://<user>.github.io/<repo>/`

## Catatan

- Chart.js + MapLibre dimuat dari CDN (perlu koneksi internet saat preview)
- Data entity PII otomatis **disensor** sebelum ditulis ke `web/`
- Konten SEO static di `index.html` diperbarui setiap `./summary.sh` untuk crawler/search engine
