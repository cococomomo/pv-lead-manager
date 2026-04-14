'use strict';

const { getDb } = require('./database');
const { encryptSecret, decryptSecret } = require('./secret-crypto');

/**
 * @param {string} username
 * @returns {object | null} — inkl. smtp_pass (verschlüsselt), nur serverintern
 */
function getProfileRow(username) {
  const u = String(username || '').trim();
  if (!u) return null;
  const db = getDb();
  return db.prepare(`
    SELECT username, voller_name, telefon, email_kontakt,
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
  const passSet = !!(String(row.smtp_host || '').trim()
    && String(row.smtp_user || '').trim()
    && String(row.smtp_pass || '').trim());
  return {
    username: row.username,
    voller_name: String(row.voller_name ?? '').trim(),
    telefon: String(row.telefon ?? '').trim(),
    email_kontakt: String(row.email_kontakt ?? '').trim(),
    smtp_host: String(row.smtp_host ?? '').trim(),
    smtp_port: String(row.smtp_port ?? '587').trim() || '587',
    smtp_user: String(row.smtp_user ?? '').trim(),
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
 * @param {string} username
 */
function getProfileForMailSend(username) {
  const row = getProfileRow(username);
  if (!row) return null;
  const host = String(row.smtp_host || '').trim();
  const user = String(row.smtp_user || '').trim();
  const pass = decryptSecret(String(row.smtp_pass || ''));
  if (!host || !user || !pass) return null;
  return {
    voller_name: String(row.voller_name || '').trim(),
    telefon: String(row.telefon || '').trim(),
    email_kontakt: String(row.email_kontakt || '').trim(),
    smtp: {
      host,
      port: (() => {
        const p = parseInt(String(row.smtp_port || '587').trim(), 10);
        return Number.isFinite(p) && p > 0 ? p : 587;
      })(),
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
  const smtp_host = fields.smtp_host !== undefined
    ? String(fields.smtp_host ?? '').trim()
    : String(cur.smtp_host ?? '').trim();
  const smtp_port = fields.smtp_port !== undefined
    ? String(fields.smtp_port ?? '587').trim() || '587'
    : (String(cur.smtp_port ?? '587').trim() || '587');
  const smtp_user = fields.smtp_user !== undefined
    ? String(fields.smtp_user ?? '').trim()
    : String(cur.smtp_user ?? '').trim();

  let smtp_pass = String(cur.smtp_pass ?? '');
  if (fields.smtp_pass === '') {
    smtp_pass = '';
  } else if (fields.smtp_pass != null && String(fields.smtp_pass).length > 0) {
    smtp_pass = encryptSecret(String(fields.smtp_pass));
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

module.exports = {
  getProfile,
  getProfileRow,
  isProfileComplete,
  isProfileCompleteRow,
  upsertProfile,
  getProfileForMailSend,
  userSmtpFullyConfigured,
};
