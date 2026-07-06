'use strict';

require('./load-env');
const nodemailer = require('nodemailer');
const { getProfileForMailSend } = require('./user-profile');

function looksLikeEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim());
}

function resolveSmtpHost() {
  return String(process.env.SMTP_HOST || process.env.DEFAULT_SMTP_HOST || '').trim();
}

function resolveSmtpPort() {
  return parseInt(String(process.env.SMTP_PORT || process.env.DEFAULT_SMTP_PORT || '587'), 10) || 587;
}

/**
 * SMTP-Modi:
 * - ssl/true/1/on => direkte TLS-Verbindung (üblich Port 465)
 * - tls/starttls  => STARTTLS erzwingen (typisch Port 587)
 * - leer/auto     => Port-basiert (465 => secure, sonst opportunistisch)
 */
function resolveSmtpSecurity(modeRaw, port) {
  const mode = String(modeRaw || '').trim().toLowerCase();
  if (mode === 'ssl' || mode === 'true' || mode === '1' || mode === 'on') {
    return { secure: true, requireTLS: false };
  }
  if (mode === 'tls' || mode === 'starttls') {
    return { secure: false, requireTLS: true };
  }
  return { secure: port === 465, requireTLS: false };
}

/** Zentraler SMTP aus .env (Fallback, z. B. vertrieb@noortec.at). */
function smtpConfigured() {
  const h = resolveSmtpHost();
  const u = (process.env.SMTP_USER || '').trim();
  const p = String(process.env.SMTP_PASS || '');
  return !!(h && u && p.length);
}

function createCentralSmtpTransport() {
  const host = resolveSmtpHost();
  const port = resolveSmtpPort();
  const sec = resolveSmtpSecurity(process.env.SMTP_SECURE, port);
  return nodemailer.createTransport({
    host,
    port,
    secure: sec.secure,
    requireTLS: sec.requireTLS,
    auth: {
      user: process.env.SMTP_USER.trim(),
      pass: process.env.SMTP_PASS,
    },
  });
}

function createTransportFromUserSmtp(s) {
  const port = s.port;
  const sec = resolveSmtpSecurity(process.env.SMTP_SECURE, port);
  return nodemailer.createTransport({
    host: s.host,
    port,
    secure: sec.secure,
    requireTLS: sec.requireTLS,
    auth: { user: s.user, pass: s.pass },
  });
}

/**
 * @param {{ username?: string }} [opts] — bei username: persönliches SMTP falls vollständig, sonst .env
 * @returns {Promise<{ transporter: import('nodemailer').Transporter, from: string, replyTo?: string }>}
 */
async function getMailSender(opts = {}) {
  const un = opts && opts.username ? String(opts.username).trim() : '';
  if (un) {
    const pm = getProfileForMailSend(un);
    if (pm) {
      const transporter = createTransportFromUserSmtp(pm.smtp);
      const fromAddr = looksLikeEmail(pm.email_kontakt) ? pm.email_kontakt.trim() : pm.smtp.user;
      const fromName = (pm.voller_name || un).replace(/"/g, "'").slice(0, 80) || 'NOORTEC';
      return {
        transporter,
        from: `"${fromName}" <${fromAddr}>`,
        replyTo: looksLikeEmail(pm.email_kontakt) ? pm.email_kontakt.trim() : undefined,
      };
    }
  }
  const fromName = process.env.MY_NAME || 'NOORTEC';
  if (!smtpConfigured()) {
    throw new Error(
      'Kein persönliches Postfach hinterlegt und zentraler Versand nicht konfiguriert (SMTP_HOST, SMTP_USER, SMTP_PASS in der .env; für Profil-Versand zusätzlich DEFAULT_SMTP_HOST und DEFAULT_SMTP_PORT).'
    );
  }
  const addr = (process.env.MAIL_FROM || process.env.SMTP_USER || '').trim();
  if (!addr) throw new Error('MAIL_FROM oder SMTP_USER als Absender-Adresse setzen');
  return {
    transporter: createCentralSmtpTransport(),
    from: `"${fromName.replace(/"/g, "'")}" <${addr}>`,
  };
}

/** Kann mindestens eine Versandroute nutzen (User-SMTP oder .env)? */
function canSendMail(username) {
  const u = String(username || '').trim();
  if (u && getProfileForMailSend(u)) return true;
  return smtpConfigured();
}

async function verifySmtpInline({ host, port, user, pass }) {
  const p = parseInt(String(port || '587'), 10) || 587;
  const sec = resolveSmtpSecurity(process.env.SMTP_SECURE, p);
  const t = nodemailer.createTransport({
    host: String(host).trim(),
    port: p,
    secure: sec.secure,
    requireTLS: sec.requireTLS,
    auth: { user: String(user).trim(), pass: String(pass) },
  });
  try {
    await t.verify();
  } catch (err) {
    const msg = err && err.message ? String(err.message) : String(err);
    throw new Error(`SMTP-Verbindung fehlgeschlagen (${host}:${p}): ${msg}`);
  }
}

async function verifySavedUserSmtp(username) {
  const pm = getProfileForMailSend(String(username || '').trim());
  if (!pm) throw new Error('Kein vollständiges persönliches SMTP im Profil gespeichert');
  const t = createTransportFromUserSmtp(pm.smtp);
  await t.verify();
}

module.exports = {
  getMailSender,
  smtpConfigured,
  canSendMail,
  createCentralSmtpTransport,
  createTransportFromUserSmtp,
  verifySmtpInline,
  verifySavedUserSmtp,
};
