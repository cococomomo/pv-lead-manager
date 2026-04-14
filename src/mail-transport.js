'use strict';

require('./load-env');
const nodemailer = require('nodemailer');
const { getProfileForMailSend } = require('./user-profile');

function looksLikeEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim());
}

/** Zentraler SMTP aus .env (Fallback, z. B. vertrieb@noortec.at). */
function smtpConfigured() {
  const h = (process.env.SMTP_HOST || '').trim();
  const u = (process.env.SMTP_USER || '').trim();
  const p = String(process.env.SMTP_PASS || '');
  return !!(h && u && p.length);
}

function createCentralSmtpTransport() {
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const secure = process.env.SMTP_SECURE === '1' || port === 465;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST.trim(),
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER.trim(),
      pass: process.env.SMTP_PASS,
    },
  });
}

function createTransportFromUserSmtp(s) {
  const port = s.port;
  const secure = port === 465 || process.env.SMTP_SECURE === '1';
  return nodemailer.createTransport({
    host: s.host,
    port,
    secure,
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
      'Kein persönliches SMTP hinterlegt und zentraler Versand nicht konfiguriert (SMTP_HOST, SMTP_USER, SMTP_PASS in der .env).'
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
  const t = nodemailer.createTransport({
    host: String(host).trim(),
    port: p,
    secure: p === 465 || process.env.SMTP_SECURE === '1',
    auth: { user: String(user).trim(), pass: String(pass) },
  });
  await t.verify();
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
