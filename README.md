# DOMPENG Dashboard

Dashboard statis untuk visualisasi ringkasan data DOMPENG. Di-generate otomatis dari repo utama via `./summary.sh`.

## Struktur

```
web/
├── index.html          # Halaman dashboard
├── css/style.css       # Tema gelap, layout responsif
├── js/app.js           # Chart.js + render dari stats.json
├── data/stats.json     # Data — di-generate oleh summary.sh (jangan edit manual)
└── .nojekyll           # GitHub Pages: serve file apa adanya
```

## Update data

Dari root repo DOMPENG:

```bash
./summary.sh
```

Script akan menulis `web/data/stats.json` plus README dan PNG dashboard.

## Preview lokal

```bash
cd web
python3 -m http.server 8080
```

Buka http://localhost:8080

## Git submodule

Folder ini dirancang agar bisa dipisah menjadi repo sendiri (seperti `extension/`):

```bash
# Di repo DOMPENG (setelah repo web dibuat di GitHub)
git submodule add https://github.com/<user>/dompeng-web web
```

Setelah submodule aktif, `./summary.sh` tetap menulis ke `web/data/stats.json`. Commit perubahan data di dalam submodule, lalu push repo web untuk deploy.

## GitHub Pages

1. Push repo `web/` ke GitHub (standalone atau sebagai submodule)
2. **Settings → Pages → Source:** Deploy from branch `main`, folder `/ (root)`
3. Pastikan `data/stats.json` ter-commit (hasil `./summary.sh`)
4. URL: `https://<user>.github.io/<repo>/`

### Otomatisasi (opsional)

Tambahkan workflow di repo web yang pull stats dari repo utama, atau commit `stats.json` dari CI parent repo setelah `./summary.sh`.

## Catatan

- Chart.js dimuat dari CDN (perlu koneksi internet saat preview)
- **`stats.json`** di-generate otomatis oleh `./summary.sh` (README + PNG + web data)
- **CHANGELOGS.md** di-parse ke `stats.json` → panel **DEV-06 Development Log** di dashboard
- Data entity PII otomatis **disensor** sebelum ditulis ke `web/`
- **Entity Graph Showcase (GRH-05):** 12 entity paling kaya identifier/relasi — semua field PII diganti blok `█`, hanya struktur graph yang ditampilkan
