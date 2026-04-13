'use strict';

const nodemailer = require('nodemailer');
const { getAuth } = require('./calendar');

/**
 * Zugangsdaten an Vertriebler senden (Gmail OAuth wie im Kalender-Modul).
 */
async function sendLoginCredentialsEmail(toEmail, loginUrl, username, passwordPlain) {
  const addr = String(toEmail || '').trim();
  if (!addr) return { skipped: true, reason: 'no_email' };

  const auth = await getAuth();
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      type: 'OAuth2',
      user: process.env.MY_EMAIL,
      clientId: auth._clientId,
      clientSecret: auth._clientSecret,
      refreshToken: auth.credentials.refresh_token,
      accessToken: auth.credentials.access_token,
    },
  });

  const fromName = process.env.MY_NAME || 'PV Lead Manager';
  const fromMail = process.env.MY_EMAIL;
  if (!fromMail) throw new Error('MY_EMAIL fehlt für den Mailversand');

  const text = [
    'Hallo,',
    '',
    'für den PV Lead Manager wurde ein Zugang für dich eingerichtet:',
    '',
    `Anmeldung: ${loginUrl}`,
    `Benutzername: ${username}`,
    `Passwort: ${passwordPlain}`,
    '',
    'Bitte das Passwort nach dem ersten Login aus Sicherheitsgründen ändern (über Admin, sobald verfügbar) bzw. geheim halten.',
    '',
    process.env.EMAIL_SIGNATURE || `Mit freundlichen Grüßen,\n${fromName}`,
  ].join('\n');

  await transporter.sendMail({
    from: `"${fromName}" <${fromMail}>`,
    to: addr,
    subject: 'Zugang PV Lead Manager',
    text,
  });
  console.log(`Welcome login mail sent to ${addr}`);
  return { skipped: false };
}

module.exports = { sendLoginCredentialsEmail };
