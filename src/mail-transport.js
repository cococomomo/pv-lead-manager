'use strict';

require('./load-env');
const nodemailer = require('nodemailer');

/** Versand per SMTP (z. B. vertrieb@… beim Hoster) — IMAP dient nur dem Empfang, nicht dem Senden. */
function smtpConfigured() {
  const h = (process.env.SMTP_HOST || '').trim();
  const u = (process.env.SMTP_USER || '').trim();
  const p = String(process.env.SMTP_PASS || '');
  return !!(h && u && p.length);
}

function createSmtpTransport() {
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

/**
 * @returns {{ transporter: import('nodemailer').Transporter, from: string }}
 */
async function getMailSender() {
  const fromName = process.env.MY_NAME || 'PV Lead Manager';
  if (!smtpConfigured()) {
    throw new Error(
      'SMTP_HOST, SMTP_USER, SMTP_PASS in der .env setzen (E-Mail-Versand; Gmail/OAuth wurde entfernt).'
    );
  }
  const addr = (process.env.MAIL_FROM || process.env.SMTP_USER || '').trim();
  if (!addr) throw new Error('MAIL_FROM oder SMTP_USER als Absender-Adresse setzen');
  return {
    transporter: createSmtpTransport(),
    from: `"${fromName}" <${addr}>`,
  };
}

module.exports = { getMailSender, smtpConfigured };
