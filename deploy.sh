#!/usr/bin/env bash
# deploy.sh — Regenerate dashboard data, then deploy to Cloudflare Workers
#
# Usage:
#   DOMPENG_SITE_URL=https://dompeng-dashboard.<account>.workers.dev ./deploy.sh
#
# Requires: Node.js, npm, wrangler login (once)

set -euo pipefail

WEB="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$WEB")"

cd "$ROOT"
if [[ -z "${DOMPENG_SITE_URL:-}" ]]; then
  echo "Note: set DOMPENG_SITE_URL for absolute canonical/OG URLs in SEO meta."
fi
./summary.sh

cd "$WEB"
if [[ ! -d node_modules/wrangler ]]; then
  npm install
fi
npm run deploy

echo ""
echo "Deployed. Set custom domain in Cloudflare dashboard if needed."
