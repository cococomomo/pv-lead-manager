'use strict';

/**
 * Notfall: Benutzer per E-Mail finden (JSON-E-Mail, Login-Name oder SQLite-Kontakt-E-Mail),
 * Rolle auf admin setzen und Passwort überschreiben.
 *
 * Usage: node scripts/reset-admin.js <email> <neues_passwort>
 */
require('../src/load-env');
const { promoteToAdminAndResetPassword } = require('../src/users');

async function main() {
  const email = process.argv[2];
  const password = process.argv[3];
  if (!email || !password || String(password).length < 6) {
    console.error('Usage: node scripts/reset-admin.js <email> <neues_passwort>');
    process.exit(1);
  }
  await promoteToAdminAndResetPassword(email, password);
  console.log('OK: Benutzer als Admin gesetzt und Passwort aktualisiert.');
}

main().catch((e) => {
  console.error(e.message || String(e));
  process.exit(1);
});
