#!/usr/bin/env bash
# Nach DB-Kopie: alte WAL/SHM-Dateien entfernen, sonst kann SQLite einen leeren/falschen
# Stand anzeigen (Hauptdatei ersetzt, WAL noch vom alten Stand).
set -euo pipefail
LEGACY_DIR="${1:-/opt/pv-lead-manager/data}"
TARGET_DIR="${2:-/root/pv-lead-manager/data}"
LEGACY_DB="$LEGACY_DIR/leads.db"
TARGET_DB="$TARGET_DIR/leads.db"
if [[ ! -f "$LEGACY_DB" ]]; then
  echo "Quelle fehlt: $LEGACY_DB" >&2
  exit 1
fi
mkdir -p "$TARGET_DIR"
STAMP=$(date +%Y%m%d%H%M%S)
if [[ -f "$TARGET_DB" ]]; then
  cp -a "$TARGET_DB" "$TARGET_DB.pre-restore-$STAMP"
fi
echo "Stoppe PM2 pvl-manager (falls vorhanden) …"
pm2 stop pvl-manager 2>/dev/null || true
sleep 1
rm -f "$TARGET_DB-wal" "$TARGET_DB-shm"
cp -a "$LEGACY_DB" "$TARGET_DB"
chmod 644 "$TARGET_DB" 2>/dev/null || true
echo "Restauriert: $TARGET_DB ($(sqlite3 "$TARGET_DB" 'SELECT COUNT(*) FROM leads;') Zeilen in leads)"
echo "Starte PM2 …"
PORT="${PORT:-3080}" pm2 restart pvl-manager --update-env
echo "Fertig."
