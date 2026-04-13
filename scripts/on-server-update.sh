#!/usr/bin/env bash
# Auf dem Linux-Server im Projektroot ausführen (einmal chmod +x).
# Nutzung: ./scripts/on-server-update.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
git pull origin master
npm ci --omit=dev
if command -v pm2 >/dev/null 2>&1; then
  pm2 restart pv-lead-manager 2>/dev/null || pm2 start ecosystem.config.cjs
  pm2 save 2>/dev/null || true
else
  echo "PM2 nicht installiert — App manuell neu starten (z. B. systemctl oder node src/server.js)."
fi
echo "OK. Prüfe APP_BASE_URL und .env auf dem Server."
