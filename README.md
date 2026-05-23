# DOMPENG — Dashboard Publik

**Repositori:** [github.com/iamutaki/dompeng-web](https://github.com/iamutaki/dompeng-web)

Dashboard statis berbahasa Indonesia untuk memantau ringkasan publik DOMPENG tanpa mengekspos PII mentah. Semua angka dan grafik diambil dari pipeline utama lewat `./summary.sh` di root repo.

**Sekilas:** peta agregat entitas per kota (MapLibre), metrik entitas & dokumen publik, kelengkapan field identitas tersensor (telepon, email, NIK, dll.), indeks pencarian, status unduhan dokumen, sampel struktur data tersensor, dokumen terbaru, dan catatan versi.

## Isi halaman

| Bagian | Isi |
|--------|-----|
| **Peta sebaran kota** | Bubble agregat jumlah entitas per kota (tab **Peta** di dashboard) |
| **Ringkasan utama** | Kartu metrik cepat (person, dokumen, foto, template, dll.) |
| **Kelengkapan field** | Chart batang — berapa entitas punya telepon, email, NIK, ID karyawan, foto |
| **Status unduhan** | Donut antrian URL dokumen (pending, selesai, gagal) |
| **Indeks pencarian** | Chart entri indeks per tipe (`name`, `phone`, `email`, …) |
| **Sampel tersensor** | Contoh struktur entitas + dokumen publik; nama/judul/telepon/NIK disamarkan |
| **Dokumen terbaru** | Tabel impor terakhir dengan judul publik ter-redaksi |
| **Catatan pembaruan** | Cuplikan `CHANGELOGS.md` versi terbaru |

## Privasi & data

- File `data/stats.json` dan `data/geo-clusters.json` **hanya berisi agregat atau field yang sudah disensor** sebelum ditulis ke `web/`.
- UI menampilkan badge **Agregat** dan **Tersensor**; sampel publik memakai sensor ketat (`faint_*`): nama/NIK/NPWP/telepon/email hanya menyisakan bentuk samar minimal.
- Koordinat kota di `data/id-city-coords.json` bersifat referensi geografis, bukan data individu.

## Struktur folder

```
web/
├── index.html              # Dashboard utama (+ blok SEO di-patch oleh summary)
├── css/style.css           # Tema gelap OSINT
├── js/app.js               # Chart.js + render panel
├── js/map.js               # MapLibre — cluster kota
├── data/
│   ├── stats.json          # Sumber data dashboard (di-generate)
│   ├── geo-clusters.json   # Cluster per kota (di-generate)
│   └── id-city-coords.json # Lookup lat/lon kota/provinsi (manual)
├── home.png                # Preview share sosmed / OG / Twitter / JSON-LD
├── sitemap.xml, robots.txt # SEO (di-generate)
├── wrangler.toml           # Cloudflare Workers static assets
├── src/worker.js           # Cache + security headers
├── deploy.sh               # summary.sh + wrangler deploy
└── package.json            # Wrangler CLI
```

Chart.js dan MapLibre GL dimuat dari CDN — preview lokal membutuhkan internet.

## Memperbarui data

Dari **root** repo DOMPENG:

```bash
./summary.sh
```

Menulis antara lain:

- `web/data/stats.json` — semua panel + changelog
- `web/data/geo-clusters.json` — agregat per kota untuk peta
- `web/sitemap.xml`, `robots.txt`
- Patch meta SEO di `index.html` (title, description, JSON-LD, konten crawler)

### URL kanonik (SEO)

Set `DOMPENG_SITE_URL` sebelum `./summary.sh` agar canonical, Open Graph, dan sitemap memakai domain production:

```bash
DOMPENG_SITE_URL=https://example.com ./summary.sh
```

## Peta kota (geo clustering)

Cluster dihitung dari `structured_address` level **city** pada person records:

- Satu bubble = jumlah entity di kota itu (tanpa daftar individu)
- Kota tanpa koordinat di-skip; fallback ke centroid provinsi jika ada di `id-city-coords.json`

Tambah kota di `data/id-city-coords.json`, lalu jalankan ulang `./summary.sh`.

Basemap peta memakai **CARTO Dark Matter** (`basemaps.cartocdn.com`) — CDN global, tanpa API key, tema gelap. Ganti provider lewat `window.DOMPENG_MAP_STYLE` sebelum `map.js` dimuat jika perlu.

## Preview lokal

```bash
cd web
python3 -m http.server 8080
```

Buka http://localhost:8080

Alternatif dengan Wrangler (lebih dekat ke production):

```bash
cd web
npm install
npm run dev
```

## Deploy

### Cloudflare Workers (disarankan di repo ini)

```bash
DOMPENG_SITE_URL=https://dompeng-dashboard.<account>.workers.dev ./web/deploy.sh
```

Atau manual: `./summary.sh` → `cd web` → `npm install` → `npm run deploy`.

| File | Fungsi |
|------|--------|
| `wrangler.toml` | Nama worker + static assets |
| `src/worker.js` | Cache + security headers |
| `.assetsignore` | Exclude `node_modules`, `src/`, tooling dari upload |

Custom domain: Cloudflare Dashboard → Workers → Settings → Domains & Routes.

### GitHub Pages

1. Push isi `web/` ke repo GitHub (standalone atau submodule)
2. **Settings → Pages** → branch `main`, folder `/ (root)`
3. Commit hasil `./summary.sh` (`stats.json`, `sitemap.xml`, dll.)

## Submodule

Folder `web/` di root DOMPENG di-link sebagai submodule ke [iamutaki/dompeng-web](https://github.com/iamutaki/dompeng-web). `./summary.sh` tetap menulis ke path `web/`; commit & push di submodule untuk publish dashboard.

## Deskripsi singkat (untuk About repo / link)

> Dashboard publik DOMPENG: ringkasan entitas tersensor, peta agregat per kota, kelengkapan field, indeks pencarian, dan status antrian dokumen publik — data sensitif disamarkan, diperbarui otomatis dari pipeline utama.
