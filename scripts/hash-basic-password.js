'use strict';

/**
 * Erzeugt einen bcrypt-Hash für BASIC_AUTH_PASS_BCRYPT in der .env
 * Usage: node scripts/hash-basic-password.js <passwort>
 *    or: npm run hash-basic-password -- lippe
 */
const bcrypt = require('bcryptjs');

const pass = process.argv[2] || '';
if (!pass) {
  console.error('Usage: npm run hash-basic-password -- <passwort>');
  process.exit(1);
}

console.log(bcrypt.hashSync(pass, 12));
