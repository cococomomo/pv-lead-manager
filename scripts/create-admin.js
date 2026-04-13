'use strict';

/**
 * Ersten Admin-Benutzer anlegen (ohne Web-UI).
 * Usage: node scripts/create-admin.js <username> <password> [email]
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { createUser } = require('../src/users');

async function main() {
  const username = process.argv[2];
  const password = process.argv[3];
  const email = process.argv[4] || '';
  if (!username || !password) {
    console.error('Usage: node scripts/create-admin.js <username> <password> [email]');
    process.exit(1);
  }
  await createUser({ username, password, email, role: 'admin' });
  console.log('Admin user created:', username);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
