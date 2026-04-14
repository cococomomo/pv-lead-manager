#!/usr/bin/env bash
# Auf dem Linux-Server im Projektroot ausführen (einmal chmod +x).
# Nutzung: ./scripts/on-server-update.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
git pull origin master
npm ci --omit=dev
if command -v pm2 >/dev/null 2>&1; then
  # Web: pv-lead-manager (Standard) oder älter pvl-manager
  if pm2 describe pv-lead-manager >/dev/null 2>&1; then
    pm2 restart pv-lead-manager --update-env
  elif pm2 describe pvl-manager >/dev/null 2>&1; then
    pm2 restart pvl-manager --update-env
  else
    pm2 start ecosystem.config.cjs --only pv-lead-manager
  fi
  # Früherer IMAP-Dauer-Poller (pv-lead-poll) entfällt — Sync im NOORTEC-Dashboard.
  pm2 delete pv-lead-poll 2>/dev/null || true
  pm2 save 2>/dev/null || true
else
  echo "PM2 nicht installiert — App manuell neu starten (z. B. systemctl oder node src/server.js)."
fi
echo "OK. Prüfe APP_BASE_URL=https://pvl.lifeco.at, SESSION_COOKIE_SECURE=1 und .env auf dem Server."
