'use strict';

const { getDb } = require('./database');
const { encryptSecret, decryptSecret } = require('./secret-crypto');

function looksLikeEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim());
}

/** Persönlicher Versand: Host/Port aus .env (DEFAULT_SMTP_* bevorzugt, sonst SMTP_*). */
function resolveDefaultSmtpServer() {
  const host = (process.env.DEFAULT_SMTP_HOST || process.env.SMTP_HOST || '').trim();
  const portRaw = process.env.DEFAULT_SMTP_PORT || process.env.SMTP_PORT || '587';
  const port = parseInt(String(portRaw).trim(), 10) || 587;
  return { host, port };
}

/**
 * @param {string} username
 * @returns {object | null} — inkl. smtp_pass (verschlüsselt), nur serverintern
 */
function getProfileRow(username) {
  const u = String(username || '').trim();
  if (!u) return null;
  const db = getDb();
  return db.prepare(`
    SELECT id, username, voller_name, telefon, email_kontakt,
      smtp_host, smtp_port, smtp_user, smtp_pass
    FROM users WHERE lower(username) = lower(?)
  `).get(u) || null;
}

/**
 * Öffentliche Profilfelder (kein SMTP-Passwort).
 * @param {string} username
 */
function getProfile(username) {
  const row = getProfileRow(username);
  if (!row) return null;
  const { host } = resolveDefaultSmtpServer();
  const passSet = !!(String(row.smtp_pass || '').trim()
    && looksLikeEmail(row.email_kontakt)
    && !!host);
  return {
    id: row.id != null ? Number(row.id) : null,
    username: row.username,
    voller_name: String(row.voller_name ?? '').trim(),
    telefon: String(row.telefon ?? '').trim(),
    email_kontakt: String(row.email_kontakt ?? '').trim(),
    smtp_pass_configured: passSet,
  };
}

function isProfileCompleteRow(row) {
  if (!row) return false;
  return !!String(row.voller_name || '').trim()
    && !!String(row.telefon || '').trim()
    && !!String(row.email_kontakt || '').trim();
}

function isProfileComplete(username) {
  return isProfileCompleteRow(getProfileRow(username));
}

/**
 * Persönliches SMTP für Versand (entschlüsselt). Sonst null.
 * Host/Port aus Umgebung; Login-Name = Kontakt-E-Mail.
 * @param {string} username
 */
function getProfileForMailSend(username) {
  const row = getProfileRow(username);
  if (!row) return null;
  const { host, port } = resolveDefaultSmtpServer();
  const user = String(row.email_kontakt || '').trim();
  const pass = decryptSecret(String(row.smtp_pass || ''));
  if (!host || !looksLikeEmail(user) || !pass) return null;
  return {
    voller_name: String(row.voller_name || '').trim(),
    telefon: String(row.telefon || '').trim(),
    email_kontakt: String(row.email_kontakt || '').trim(),
    smtp: {
      host,
      port,
      user,
      pass,
    },
  };
}

function userSmtpFullyConfigured(username) {
  return !!getProfileForMailSend(username);
}

/**
 * @param {string} username
 * @param {Record<string, unknown>} fields
 */
function upsertProfile(username, fields) {
  const u = String(username || '').trim();
  if (!u) throw new Error('Benutzername fehlt');
  const cur = getProfileRow(u) || {};
  const voller_name = fields.voller_name !== undefined
    ? String(fields.voller_name ?? '').trim()
    : String(cur.voller_name ?? '').trim();
  const telefon = fields.telefon !== undefined
    ? String(fields.telefon ?? '').trim()
    : String(cur.telefon ?? '').trim();
  const email_kontakt = fields.email_kontakt !== undefined
    ? String(fields.email_kontakt ?? '').trim()
    : String(cur.email_kontakt ?? '').trim();

  let smtp_pass = String(cur.smtp_pass ?? '');
  if (fields.smtp_pass === '') {
    smtp_pass = '';
  } else if (fields.smtp_pass != null && String(fields.smtp_pass).length > 0) {
    smtp_pass = encryptSecret(String(fields.smtp_pass));
  }

  const { host, port } = resolveDefaultSmtpServer();
  let smtp_host = '';
  let smtp_port = '587';
  let smtp_user = '';
  if (String(smtp_pass || '').trim() && looksLikeEmail(email_kontakt) && host) {
    smtp_host = host;
    smtp_port = String(port);
    smtp_user = email_kontakt.trim();
  }

  const db = getDb();
  db.prepare(`
    INSERT INTO users (username, voller_name, telefon, email_kontakt, smtp_host, smtp_port, smtp_user, smtp_pass)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(username) DO UPDATE SET
      voller_name = excluded.voller_name,
      telefon = excluded.telefon,
      email_kontakt = excluded.email_kontakt,
      smtp_host = excluded.smtp_host,
      smtp_port = excluded.smtp_port,
      smtp_user = excluded.smtp_user,
      smtp_pass = excluded.smtp_pass
  `).run(u, voller_name, telefon, email_kontakt, smtp_host, smtp_port, smtp_user, smtp_pass);
}

/** Leere SQLite-Zeile für Login (nach JSON-Anlage); id wird automatisch vergeben. */
function ensureSqliteUserStub(username) {
  const un = String(username || '').trim();
  if (!un) return;
  const db = getDb();
  const ex = db.prepare('SELECT 1 AS x FROM users WHERE lower(username) = lower(?)').get(un);
  if (ex) return;
  db.prepare(`
    INSERT INTO users (username, voller_name, telefon, email_kontakt, smtp_host, smtp_port, smtp_user, smtp_pass)
    VALUES (?, '', '', '', '', '587', '', '')
  `).run(un);
}

function deleteSqliteUserByUsername(username) {
  const un = String(username || '').trim();
  if (!un) return;
  const db = getDb();
  db.prepare('DELETE FROM users WHERE lower(username) = lower(?)').run(un);
}

module.exports = {
  getProfile,
  getProfileRow,
  isProfileComplete,
  isProfileCompleteRow,
  upsertProfile,
  getProfileForMailSend,
  userSmtpFullyConfigured,
  ensureSqliteUserStub,
  deleteSqliteUserByUsername,
  resolveDefaultSmtpServer,
  looksLikeEmail,
};
