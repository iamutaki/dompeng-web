# DOMPENG — Dashboard Publik

Dashboard statis berbahasa Indonesia untuk memantau ringkasan database DOMPENG tanpa mengekspos PII mentah. Semua angka dan grafik diambil dari pipeline utama lewat `./summary.sh` di root repo.

**Sekilas:** peta sebaran orang per kota (MapLibre), metrik profil & dokumen, kelengkapan identitas (telepon, email, NIK, dll.), indeks pencarian, status unduhan dokumen, sample profil ter-redaksi, dokumen terbaru, dan catatan versi.

## Isi halaman

| Bagian | Isi |
|--------|-----|
| **Peta sebaran kota** | Bubble agregat jumlah orang per kota (`/`, link ke `/geo/`) |
| **Ringkasan utama** | Kartu metrik cepat (person, dokumen, foto, template, dll.) |
| **Kelengkapan profil** | Chart batang — berapa profil punya telepon, email, NIK, ID karyawan, foto |
| **Status unduhan** | Donut antrian URL dokumen (pending, selesai, gagal) |
| **Indeks pencarian** | Chart entri indeks per tipe (`name`, `phone`, `email`, …) |
| **Contoh profil** | Sample orang + dokumen sumber; nama/judul/telepon/NIK disamarkan |
| **Dokumen terbaru** | Tabel impor terakhir dengan judul publik ter-redaksi |
| **Catatan pembaruan** | Cuplikan `CHANGELOGS.md` versi terbaru |

Halaman dedicated peta: [`geo/index.html`](geo/index.html) — peta penuh dengan statistik cluster.

## Privasi & data

- File `data/stats.json` dan `data/geo-clusters.json` **hanya berisi agregat atau field yang sudah disensor** sebelum ditulis ke `web/`.
- UI menampilkan badge **Data disamarkan**; teks bebas (judul, nama sample) melewati redaksi pola telepon/NIK.
- Koordinat kota di `data/id-city-coords.json` bersifat referensi geografis, bukan data orang.

## Struktur folder

```
web/
├── index.html              # Dashboard utama (+ blok SEO di-patch oleh summary)
├── geo/index.html          # Peta kota (di-generate)
├── css/style.css           # Tema gelap OSINT
├── js/app.js               # Chart.js + render panel
├── js/map.js               # MapLibre — cluster kota
├── data/
│   ├── stats.json          # Sumber data dashboard (di-generate)
│   ├── geo-clusters.json   # Cluster per kota (di-generate)
│   └── id-city-coords.json # Lookup lat/lon kota/provinsi (manual)
├── og-image.png            # OG/Twitter (disalin dari docs/ saat summary)
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
- `web/geo/index.html`, `sitemap.xml`, `robots.txt`
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
| `src/worker.js` | Cache headers, redirect `/geo` → `/geo/` |
| `.assetsignore` | Exclude `node_modules`, `src/`, tooling dari upload |

Custom domain: Cloudflare Dashboard → Workers → Settings → Domains & Routes.

### GitHub Pages

1. Push isi `web/` ke repo GitHub (standalone atau submodule)
2. **Settings → Pages** → branch `main`, folder `/ (root)`
3. Commit hasil `./summary.sh` (`stats.json`, `geo/`, `sitemap.xml`, dll.)

## Submodule (opsional)

Folder `web/` bisa dipisah ke repo `dompeng-web` dan di-link sebagai submodule — `./summary.sh` tetap menulis ke path `web/` di root. Commit & push di repo web untuk publish.

## Deskripsi singkat (untuk About repo / link)

> Dashboard publik DOMPENG: ringkasan profil orang, peta sebaran per kota, kelengkapan identitas, indeks pencarian, dan status antrian dokumen — data sensitif disamarkan, diperbarui otomatis dari pipeline utama.
