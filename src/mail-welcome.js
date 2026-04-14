'use strict';

require('./load-env');
const { getMailSender } = require('./mail-transport');

/**
 * Zugangsdaten per E-Mail über SMTP (SMTP_* in der .env).
 */
async function sendLoginCredentialsEmail(toEmail, loginUrl, username, passwordPlain) {
  const addr = String(toEmail || '').trim();
  if (!addr) return { skipped: true, reason: 'no_email' };

  const { transporter, from } = await getMailSender();

  const text = [
    'Hallo,',
    '',
    'für das NOORTEC Vertriebs-Dashboard wurde ein Zugang für dich eingerichtet:',
    '',
    `Anmeldung: ${loginUrl}`,
    `Benutzername: ${username}`,
    `Passwort: ${passwordPlain}`,
    '',
    'Bitte das Passwort nach dem ersten Login aus Sicherheitsgründen ändern (über Admin, sobald verfügbar) bzw. geheim halten.',
    '',
    process.env.EMAIL_SIGNATURE || `Mit freundlichen Grüßen,\n${process.env.MY_NAME || 'NOORTEC'}`,
  ].join('\n');

  await transporter.sendMail({
    from,
    to: addr,
    subject: 'Zugang NOORTEC Vertriebs-Dashboard',
    text,
  });
  console.log(`Welcome login mail sent to ${addr}`);
  return { skipped: false };
}

module.exports = { sendLoginCredentialsEmail };
