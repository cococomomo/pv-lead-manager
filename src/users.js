'use strict';

const fs = require('fs').promises;
const path = require('path');
const bcrypt = require('bcryptjs');

const USERS_PATH = path.join(__dirname, '../data/users.json');

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
    role: u.role === 'admin' ? 'admin' : 'sales',
    email: u.email || '',
  };
}

async function listUsersSafe() {
  return (await readUsers()).map((u) => ({
    username: u.username,
    role: u.role === 'admin' ? 'admin' : 'sales',
    email: u.email || '',
  }));
}

async function createUser({ username, password, email, role = 'sales' }) {
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
    email: String(email || '').trim(),
    role: role === 'admin' ? 'admin' : 'sales',
  });
  await writeUsers(users);
}

async function deleteUser(username, actorUsername) {
  const users = await readUsers();
  const idx = users.findIndex((x) => String(x.username).toLowerCase() === String(username).toLowerCase());
  if (idx < 0) throw new Error('Benutzer nicht gefunden');
  if (String(users[idx].username).toLowerCase() === String(actorUsername).toLowerCase()) {
    throw new Error('Eigenes Konto nicht löschbar');
  }
  const admins = users.filter((x) => x.role === 'admin');
  if (users[idx].role === 'admin' && admins.length <= 1) {
    throw new Error('Letzter Admin kann nicht gelöscht werden');
  }
  users.splice(idx, 1);
  await writeUsers(users);
}

async function userCount() {
  return (await readUsers()).length;
}

module.exports = {
  readUsers,
  verifyLogin,
  listUsersSafe,
  createUser,
  deleteUser,
  userCount,
  USERS_PATH,
};
