'use strict';

/** Einheitliches Anfrage-Nummernformat (mind. 4 Stellen, z. B. 0001). */
function formatAnfrageNumber(n) {
  const i = Math.floor(Number(n));
  if (!Number.isFinite(i) || i < 1) return '0001';
  return String(i).padStart(4, '0');
}

module.exports = { formatAnfrageNumber };
