'use strict';

const fs = require('fs').promises;
const path = require('path');
const bcrypt = require('bcryptjs');
const {
  getProfile,
  isProfileComplete,
  upsertProfile,
  ensureSqliteUserStub,
  deleteSqliteUserByUsername,
} = require('./user-profile');
const { getDb } = require('./database');

const USERS_PATH = path.join(__dirname, '../data/users.json');

function normalizeUserRole(role) {
  const r = String(role || '').trim().toLowerCase();
  if (r === 'admin') return 'admin';
  if (r === 'setter') return 'setter';
  return 'sales';
}

async function readUsers() {
  try {
    const raw = await fs.readFile(USERS_PATH, 'utf8');
    const j = JSON.parse(raw);
    return Array.isArray(j.users) ? j.users : [];
  } catch {
    return [];
  }
}

async function writeUsers(users) {
  await fs.mkdir(path.dirname(USERS_PATH), { recursive: true });
  await fs.writeFile(USERS_PATH, `${JSON.stringify({ users }, null, 2)}\n`, 'utf8');
}

async function findUser(username) {
  const u = String(username || '').trim().toLowerCase();
  if (!u) return null;
  return (await readUsers()).find((x) => String(x.username || '').toLowerCase() === u) || null;
}

function normalizeCalendarPreference(pref) {
  const v = String(pref || '').toLowerCase();
  if (v === 'outlook' || v === 'apple') return v;
  return 'google';
}

async function verifyLogin(username, password) {
  const u = await findUser(username);
  if (!u || !u.passwordHash) return null;
  try {
    if (!bcrypt.compareSync(String(password || ''), u.passwordHash)) return null;
  } catch {
    return null;
  }
  return {
    username: u.username,
    role: normalizeUserRole(u.role),
    email: u.email || '',
    calendarPreference: normalizeCalendarPreference(u.calendarPreference),
  };
}

/** Für Admin-Konsole: Login, Rolle, Kontakt aus SQLite-Profil + numerische User-Id. */
async function listUsersAdminDetail() {
  const jsonUsers = await readUsers();
  const db = getDb();
  const out = [];
  for (const u of jsonUsers) {
    const un = String(u.username || '').trim();
    if (!un) continue;
    ensureSqliteUserStub(un);
    const row = db.prepare('SELECT id FROM users WHERE lower(username) = lower(?)').get(un);
    const prof = getProfile(un) || {};
    out.push({
      id: row && row.id != null ? Number(row.id) : null,
      username: un,
      role: normalizeUserRole(u.role),
      email: String(u.email || '').trim(),
      voller_name: String(prof.voller_name || '').trim(),
      telefon: String(prof.telefon || '').trim(),
      email_kontakt: String(prof.email_kontakt || '').trim(),
    });
  }
  out.sort((a, b) => a.username.localeCompare(b.username, 'de'));
  return out;
}

async function getUserRole(username) {
  const u = await findUser(username);
  return u ? normalizeUserRole(u.role) : null;
}

async function createUser({
  username,
  password,
  email,
  role = 'sales',
  voller_name,
  telefon,
  email_kontakt,
  mailbox_password,
}) {
  const name = String(username || '').trim();
  if (!name || !password || String(password).length < 6) {
    throw new Error('username und Passwort (min. 6 Zeichen) erforderlich');
  }
  const users = await readUsers();
  if (users.some((x) => String(x.username).toLowerCase() === name.toLowerCase())) {
    throw new Error('Benutzername existiert bereits');
  }
  users.push({
    username: name,
    passwordHash: bcrypt.hashSync(String(password), 12),
    email: String(email_kontakt || email || '').trim(),
    role: normalizeUserRole(role),
    calendarPreference: 'google',
  });
  await writeUsers(users);
  ensureSqliteUserStub(name);
  const profPatch = {
    voller_name: voller_name !== undefined ? String(voller_name ?? '').trim() : '',
    telefon: telefon !== undefined ? String(telefon ?? '').trim() : '',
    email_kontakt: email_kontakt !== undefined ? String(email_kontakt ?? '').trim() : '',
  };
  if (mailbox_password !== undefined && String(mailbox_password).length > 0) {
    profPatch.smtp_pass = String(mailbox_password);
  }
  upsertProfile(name, profPatch);
}

/**
 * Admin: JSON-Felder + Profil aktualisieren (ohne Passwort).
 * @param {string} username
 * @param {{ email?: string, role?: string, voller_name?: string, telefon?: string, email_kontakt?: string }} patch
 */
async function updateUserAdminFields(username, patch) {
  const name = String(username || '').trim();
  if (!name) throw new Error('Benutzername fehlt');
  const users = await readUsers();
  const idx = users.findIndex((x) => String(x.username).toLowerCase() === name.toLowerCase());
  if (idx < 0) throw new Error('Benutzer nicht gefunden');
  if (patch.email !== undefined) users[idx].email = String(patch.email ?? '').trim();
  if (patch.role !== undefined) users[idx].role = normalizeUserRole(patch.role);
  const p = {};
  if (patch.voller_name !== undefined) p.voller_name = patch.voller_name;
  if (patch.telefon !== undefined) p.telefon = patch.telefon;
  if (patch.email_kontakt !== undefined) {
    p.email_kontakt = patch.email_kontakt;
    users[idx].email = String(patch.email_kontakt ?? '').trim();
  }
  await writeUsers(users);
  ensureSqliteUserStub(name);
  if (Object.keys(p).length) upsertProfile(name, p);
}

async function getUserPublic(username) {
  const u = await findUser(username);
  if (!u) return null;
  ensureSqliteUserStub(u.username);
  const prof = getProfile(u.username) || {};
  const voller_name = String(prof.voller_name ?? '').trim();
  const telefon = String(prof.telefon ?? '').trim();
  const email_kontakt = String(prof.email_kontakt ?? '').trim();
  return {
    username: u.username,
    role: normalizeUserRole(u.role),
    calendarPreference: normalizeCalendarPreference(u.calendarPreference),
    id: prof.id != null ? Number(prof.id) : null,
    voller_name,
    telefon,
    email_kontakt,
    smtp_pass_configured: !!prof.smtp_pass_configured,
    profileComplete: isProfileComplete(u.username),
  };
}

async function updateCalendarPreference(username, pref) {
  const name = String(username || '').trim();
  if (!name) throw new Error('Benutzername fehlt');
  const users = await readUsers();
  const idx = users.findIndex((x) => String(x.username).toLowerCase() === name.toLowerCase());
  if (idx < 0) throw new Error('Benutzer nicht gefunden');
  users[idx].calendarPreference = normalizeCalendarPreference(pref);
  await writeUsers(users);
}

async function deleteUser(username, actorUsername) {
  const users = await readUsers();
  const idx = users.findIndex((x) => String(x.username).toLowerCase() === String(username).toLowerCase());
  if (idx < 0) throw new Error('Benutzer nicht gefunden');
  if (String(users[idx].username).toLowerCase() === String(actorUsername).toLowerCase()) {
    throw new Error('Eigenes Konto nicht löschbar');
  }
  const admins = users.filter((x) => normalizeUserRole(x.role) === 'admin');
  if (normalizeUserRole(users[idx].role) === 'admin' && admins.length <= 1) {
    throw new Error('Letzter Admin kann nicht gelöscht werden');
  }
  const removed = users[idx].username;
  users.splice(idx, 1);
  await writeUsers(users);
  deleteSqliteUserByUsername(removed);
}

async function userCount() {
  return (await readUsers()).length;
}

async function resetUserPassword(username, newPassword) {
  const name = String(username || '').trim();
  if (!name || !newPassword || String(newPassword).length < 6) {
    throw new Error('Benutzername und neues Passwort (min. 6 Zeichen) erforderlich');
  }
  const users = await readUsers();
  const idx = users.findIndex((x) => String(x.username).toLowerCase() === name.toLowerCase());
  if (idx < 0) throw new Error('Benutzer nicht gefunden');
  users[idx].passwordHash = bcrypt.hashSync(String(newPassword), 12);
  await writeUsers(users);
}

/**
 * CLI / Notfall: Nutzer per E-Mail (JSON `email`, Login-Name oder SQLite `email_kontakt`) finden,
 * Rolle Admin setzen und Passwort überschreiben.
 * @param {string} emailOrUsername
 * @param {string} newPassword
 */
async function promoteToAdminAndResetPassword(emailOrUsername, newPassword) {
  const key = String(emailOrUsername || '').trim().toLowerCase();
  if (!key || !newPassword || String(newPassword).length < 6) {
    throw new Error('E-Mail und neues Passwort (mind. 6 Zeichen) erforderlich');
  }
  const users = await readUsers();
  const db = getDb();
  let idx = users.findIndex((x) => {
    const un = String(x.username || '').trim().toLowerCase();
    const em = String(x.email || '').trim().toLowerCase();
    return un === key || em === key;
  });
  if (idx < 0) {
    for (let i = 0; i < users.length; i += 1) {
      const un = String(users[i].username || '').trim();
      const row = db.prepare('SELECT email_kontakt FROM users WHERE lower(username) = lower(?)').get(un);
      const ek = String(row && row.email_kontakt ? row.email_kontakt : '').trim().toLowerCase();
      if (ek === key) {
        idx = i;
        break;
      }
    }
  }
  if (idx < 0) throw new Error('Kein Benutzer mit dieser E-Mail oder diesem Namen gefunden');
  users[idx].role = 'admin';
  users[idx].passwordHash = bcrypt.hashSync(String(newPassword), 12);
  await writeUsers(users);
}

module.exports = {
  readUsers,
  verifyLogin,
  listUsersAdminDetail,
  getUserRole,
  createUser,
  updateUserAdminFields,
  deleteUser,
  userCount,
  resetUserPassword,
  promoteToAdminAndResetPassword,
  getUserPublic,
  updateCalendarPreference,
  normalizeCalendarPreference,
  normalizeUserRole,
};
