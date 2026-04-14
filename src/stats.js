'use strict';

const { getDb } = require('./database');

/** Erste 10 Zeichen YYYY-MM-DD für date()-Vergleiche (ISO oder SQLite-datetime). */
function datePrefixExpr(col) {
  return `substr(trim(coalesce(${col}, '')), 1, 10)`;
}

/**
 * Dashboard-Zahlen aus SQLite (alle Zeilen in `leads`, inkl. Archiv).
 * Neu: nach created_at (Datum-Präfix).
 * Erledigt: archiviert nach archived_at in Zeitraum ODER finaler Status + last_updated im Zeitraum.
 */
function getDashboardStats() {
  const db = getDb();

  const totalLeads = db.prepare('SELECT COUNT(*) AS c FROM leads').get().c;

  const newWeek = db.prepare(`
    SELECT COUNT(*) AS c FROM leads
    WHERE length(trim(coalesce(created_at, ''))) >= 10
      AND date(${datePrefixExpr('created_at')}) >= date('now', '-7 days')
  `).get().c;

  const newMonth = db.prepare(`
    SELECT COUNT(*) AS c FROM leads
    WHERE length(trim(coalesce(created_at, ''))) >= 10
      AND date(${datePrefixExpr('created_at')}) >= date('now', '-30 days')
  `).get().c;

  const refWhen = `trim(coalesce(nullif(trim(last_updated), ''), nullif(trim(created_at), ''), ''))`;

  const doneWeek = db.prepare(`
    SELECT COUNT(*) AS c FROM leads
    WHERE
      (
        length(trim(coalesce(archived_at, ''))) >= 10
        AND date(${datePrefixExpr('archived_at')}) >= date('now', '-7 days')
      )
      OR
      (
        (archived_at IS NULL OR trim(archived_at) = '')
        AND trim(status) IN ('Termin vereinbart', 'Lead verloren')
        AND length(${refWhen}) >= 10
        AND date(substr(${refWhen}, 1, 10)) >= date('now', '-7 days')
      )
  `).get().c;

  const doneMonth = db.prepare(`
    SELECT COUNT(*) AS c FROM leads
    WHERE
      (
        length(trim(coalesce(archived_at, ''))) >= 10
        AND date(${datePrefixExpr('archived_at')}) >= date('now', '-30 days')
      )
      OR
      (
        (archived_at IS NULL OR trim(archived_at) = '')
        AND trim(status) IN ('Termin vereinbart', 'Lead verloren')
        AND length(${refWhen}) >= 10
        AND date(substr(${refWhen}, 1, 10)) >= date('now', '-30 days')
      )
  `).get().c;

  const missingMapCoords = db.prepare(`
    SELECT COUNT(*) AS c FROM leads
    WHERE (archived_at IS NULL OR archived_at = '')
      AND (
        latitude IS NULL OR longitude IS NULL
        OR latitude = 0 OR longitude = 0
      )
  `).get().c;

  return {
    totalLeads,
    newWeek,
    newMonth,
    doneWeek,
    doneMonth,
    missingMapCoords,
  };
}

module.exports = { getDashboardStats };
