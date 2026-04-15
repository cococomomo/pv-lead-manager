'use strict';

require('./load-env');
const { getMailSender } = require('./mail-transport');

/**
 * Zugangsdaten per E-Mail über SMTP (SMTP_* in der .env).
 */
async function sendLoginCredentialsEmail(toEmail, loginUrl, username, passwordPlain) {
  return sendNoortecWelcomeOnboardingEmail({
    toEmail,
    loginUrl,
    appUrl: loginUrl.replace(/\/login\.html.*$/i, '') || loginUrl,
    username,
    passwordPlain,
  });
}

/**
 * Willkommen nach Admin-Anlage: System-SMTP, NOORTEC, Link zur App, Profil-Hinweis.
 */
async function sendNoortecWelcomeOnboardingEmail({
  toEmail,
  appUrl,
  loginUrl,
  username,
  passwordPlain,
}) {
  const addr = String(toEmail || '').trim();
  if (!addr) return { skipped: true, reason: 'no_email' };

  const { transporter, from } = await getMailSender();
  const app = String(appUrl || '').replace(/\/$/, '') || 'https://pvl.lifeco.at';
  const login = String(loginUrl || '').trim() || `${app}/login.html`;

  const text = [
    'Hallo und herzlich willkommen bei NOORTEC,',
    '',
    `Ihr Zugang zum NOORTEC Vertriebs-Dashboard: ${app}`,
    `Anmeldung: ${login}`,
    '',
    `Benutzername (Login): ${username}`,
    `Passwort (bitte nach dem ersten Login ändern): ${passwordPlain}`,
    '',
    'Bitte vervollständigen Sie Ihr Profil unter /profile (Name, Telefon, Kontakt-E-Mail und optional Postfach-Passwort für persönlichen Kunden-E-Mail-Versand).',
    '',
    process.env.EMAIL_SIGNATURE || `Mit freundlichen Grüßen,\n${process.env.MY_NAME || 'NOORTEC'}`,
  ].join('\n');

  await transporter.sendMail({
    from,
    to: addr,
    subject: 'Willkommen bei NOORTEC — Zugang Vertriebs-Dashboard',
    text,
  });
  console.log(`NOORTEC welcome mail sent to ${addr}`);
  return { skipped: false };
}

module.exports = { sendLoginCredentialsEmail, sendNoortecWelcomeOnboardingEmail };
