'use strict';

/**
 * Passwort für bestehenden Benutzer setzen (nur Server/Shell).
 * Usage: node scripts/reset-password.js <username> <neuesPasswort>
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { resetUserPassword } = require('../src/users');

async function main() {
  const username = process.argv[2];
  const password = process.argv[3];
  if (!username || !password) {
    console.error('Usage: node scripts/reset-password.js <username> <neuesPasswort>');
    process.exit(1);
  }
  await resetUserPassword(username, password);
  console.log('Passwort aktualisiert:', username);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
