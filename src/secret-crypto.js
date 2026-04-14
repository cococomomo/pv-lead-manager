'use strict';

const crypto = require('crypto');
require('./load-env');

function deriveKeyMaterial() {
  const p = String(process.env.PVL_ENCRYPTION_KEY || '').trim();
  if (p.length >= 32) return crypto.createHash('sha256').update(p, 'utf8').digest();
  const s = String(process.env.SESSION_SECRET || '').trim();
  if (s.length >= 16) return crypto.createHash('sha256').update(s, 'utf8').digest();
  return null;
}

/**
 * @param {string} plain
 * @returns {string} base64(iv+tag+ciphertext)
 */
function encryptSecret(plain) {
  const key = deriveKeyMaterial();
  if (!key) {
    throw new Error('PVL_ENCRYPTION_KEY (mind. 32 Zeichen) oder SESSION_SECRET für SMTP-Passwort-Verschlüsselung setzen');
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

/**
 * @param {string} b64
 * @returns {string}
 */
function decryptSecret(b64) {
  if (!b64 || !String(b64).trim()) return '';
  const key = deriveKeyMaterial();
  if (!key) return '';
  try {
    const buf = Buffer.from(String(b64), 'base64');
    if (buf.length < 28) return '';
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const data = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

module.exports = { encryptSecret, decryptSecret, deriveKeyMaterial };
