#!/usr/bin/env bash
# Testinstanz aktualisieren. Nur im Checkout /root/pv-lead-manager-test ausführen.
# Startet ausschließlich pm2-App „pv-lead-manager-test“ (Port 3081).
# Production (pv-lead-manager, Port 3080, Branch master) wird nicht angefasst.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ "$(basename "$ROOT")" != "pv-lead-manager-test" ]]; then
  echo "Abbruch: dieses Skript nur in /root/pv-lead-manager-test ausführen (aktuell: $ROOT)." >&2
  exit 1
fi

git fetch origin test/offer-preview
git checkout test/offer-preview
git pull --ff-only origin test/offer-preview
npm ci --omit=dev

if ! command -v pm2 >/dev/null 2>&1; then
  echo "PM2 nicht installiert — Testinstanz manuell starten: PORT=3081 node src/server.js" >&2
  exit 1
fi

# Niemals die Production-App neu starten.
if pm2 describe pv-lead-manager-test >/dev/null 2>&1; then
  pm2 restart pv-lead-manager-test --update-env
else
  pm2 start ecosystem.test.config.cjs --only pv-lead-manager-test
fi
pm2 save
echo "OK. Testinstanz pv-lead-manager-test (Port 3081). Production pv-lead-manager nicht neu gestartet."
