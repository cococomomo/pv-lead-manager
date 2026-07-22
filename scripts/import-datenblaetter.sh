#!/usr/bin/env bash
# Importiert Datenblatt-PDFs aus einem Quellordner (z. B. nach SCP vom Windows-PC)
# in public/datenblaetter/ mit stabilen Dateinamen.
set -euo pipefail
SRC="${1:-/tmp/datenblaetter-upload}"
DEST="/root/pv-lead-manager/public/datenblaetter"
mkdir -p "$DEST"

copy_match() {
  local pattern="$1"
  local target="$2"
  local found
  found="$(find "$SRC" -maxdepth 2 -type f -iname "$pattern" 2>/dev/null | head -1 || true)"
  if [[ -n "$found" ]]; then
    cp -f "$found" "$DEST/$target"
    echo "OK  $target  ←  $(basename "$found")"
  else
    echo "MISS $target  (gesucht: $pattern)"
  fi
}

copy_match '*Reserva*DE*.pdf' 'fronius-reserva.pdf'
copy_match '*GEN24*3*10*DE*.pdf' 'fronius-symo-gen24-3-10.pdf'
copy_match '*GEN24SC*12*DE*.pdf' 'fronius-symo-gen24sc-12.pdf'
copy_match '*Sigen*Hybrid*.pdf' 'sigen-hybrid-wechselrichter.pdf'
copy_match '*Sigen*Batterie*.pdf' 'sigen-batterie.pdf'
copy_match '*AIKO*MCE54*.pdf' 'aiko-mce54mb-460-490w.pdf'
copy_match '*DAS-DH108ND*.pdf' 'das-dh108nd-440-465.pdf'

echo "---"
ls -lh "$DEST"
