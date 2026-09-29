'use strict';

const fs = require('fs');
const path = require('path');
const { getDb, getProjectRoot } = require('./database');

const PHOTOS_DIR_REL = path.join('data', 'sales-photos');
const MAX_BYTES = 5 * 1024 * 1024;

const EXT_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

function ensurePhotosDir() {
  const abs = path.join(getProjectRoot(), PHOTOS_DIR_REL);
  fs.mkdirSync(abs, { recursive: true });
  return abs;
}

/** Safe filesystem stem from username (keeps unicode letters/digits). */
function safePhotoStem(username) {
  const raw = String(username || '').trim().toLowerCase();
  const stem = raw.replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/^_+|_+$/g, '');
  return stem || 'user';
}

function photoUrlForUsername(username) {
  const u = String(username || '').trim();
  if (!u) return null;
  return `/api/sales-photos/${encodeURIComponent(u)}`;
}

function detectImageKind(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { mime: 'image/jpeg', ext: '.jpg' };
  }
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { mime: 'image/png', ext: '.png' };
  }
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46
    && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) {
    return { mime: 'image/webp', ext: '.webp' };
  }
  return null;
}

/**
 * Parse data-URL or raw base64 into a Buffer.
 * @param {unknown} image
 * @returns {{ buf: Buffer, mimeHint: string | null }}
 */
function parseImagePayload(image) {
  if (Buffer.isBuffer(image)) return { buf: image, mimeHint: null };
  const s = String(image || '').trim();
  if (!s) throw new Error('Bild fehlt');
  const m = s.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
  if (m) {
    return { buf: Buffer.from(m[2], 'base64'), mimeHint: m[1].toLowerCase() };
  }
  return { buf: Buffer.from(s, 'base64'), mimeHint: null };
}

function absFromRel(rel) {
  if (!rel) return null;
  return path.isAbsolute(rel) ? rel : path.join(getProjectRoot(), rel);
}

function getPhotoPathFromDb(username) {
  const u = String(username || '').trim();
  if (!u) return null;
  const row = getDb().prepare(
    'SELECT photo_path FROM users WHERE lower(username) = lower(?)',
  ).get(u);
  const rel = row && row.photo_path ? String(row.photo_path).trim() : '';
  return rel || null;
}

function setPhotoPathInDb(username, relPath) {
  const u = String(username || '').trim();
  if (!u) throw new Error('Benutzername fehlt');
  const db = getDb();
  const ex = db.prepare('SELECT 1 AS x FROM users WHERE lower(username) = lower(?)').get(u);
  if (!ex) throw new Error('Benutzerprofil nicht gefunden');
  db.prepare(
    'UPDATE users SET photo_path = ? WHERE lower(username) = lower(?)',
  ).run(relPath == null ? '' : String(relPath), u);
}

function unlinkQuiet(abs) {
  if (!abs) return;
  try { fs.unlinkSync(abs); } catch (_) { /* ignore */ }
}

/**
 * Speichert / ersetzt das Vertriebler-Foto.
 * @param {string} username
 * @param {unknown} image — data-URL oder base64
 * @returns {{ photoPath: string, photoUrl: string }}
 */
function saveSalesPhoto(username, image) {
  const u = String(username || '').trim();
  if (!u) throw new Error('Benutzername fehlt');
  const { buf, mimeHint } = parseImagePayload(image);
  if (!buf || buf.length < 32) throw new Error('Ungültiges Bild');
  if (buf.length > MAX_BYTES) throw new Error('Bild zu groß (max. 5 MB)');

  const kind = detectImageKind(buf);
  if (!kind) throw new Error('Nur JPEG, PNG oder WebP erlaubt');
  if (mimeHint && EXT_BY_MIME[mimeHint] && EXT_BY_MIME[mimeHint] !== kind.ext) {
    // Trust magic bytes; ignore mismatched data-URL mime.
  }

  ensurePhotosDir();
  const prevRel = getPhotoPathFromDb(u);
  const stem = safePhotoStem(u);
  const rel = path.join(PHOTOS_DIR_REL, `${stem}${kind.ext}`);
  const abs = path.join(getProjectRoot(), rel);
  fs.writeFileSync(abs, buf);

  if (prevRel && path.normalize(prevRel) !== path.normalize(rel)) {
    unlinkQuiet(absFromRel(prevRel));
  }
  setPhotoPathInDb(u, rel);
  return { photoPath: rel, photoUrl: photoUrlForUsername(u) };
}

/**
 * Entfernt Foto aus Dateisystem und DB.
 * @param {string} username
 */
function deleteSalesPhoto(username) {
  const u = String(username || '').trim();
  if (!u) throw new Error('Benutzername fehlt');
  const prevRel = getPhotoPathFromDb(u);
  if (prevRel) unlinkQuiet(absFromRel(prevRel));
  setPhotoPathInDb(u, '');
  return { ok: true, photoUrl: null, photoPath: null };
}

/**
 * Absolute Datei für GET / Serving; null wenn fehlend.
 * @param {string} username
 */
function getSalesPhotoAbsPath(username) {
  const rel = getPhotoPathFromDb(username);
  if (!rel) return null;
  const abs = absFromRel(rel);
  if (!abs || !fs.existsSync(abs)) return null;
  return abs;
}

function photoFieldsForProfile(username, photoPathRel) {
  const rel = photoPathRel != null
    ? String(photoPathRel || '').trim()
    : (getPhotoPathFromDb(username) || '');
  if (!rel) {
    return { photoPath: null, photoUrl: null };
  }
  const abs = absFromRel(rel);
  if (!abs || !fs.existsSync(abs)) {
    return { photoPath: null, photoUrl: null };
  }
  return {
    photoPath: rel,
    photoUrl: photoUrlForUsername(username),
  };
}

module.exports = {
  PHOTOS_DIR_REL,
  MAX_BYTES,
  ensurePhotosDir,
  photoUrlForUsername,
  saveSalesPhoto,
  deleteSalesPhoto,
  getSalesPhotoAbsPath,
  getPhotoPathFromDb,
  photoFieldsForProfile,
  detectImageKind,
};
