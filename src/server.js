'use strict';

require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const session = require('express-session');
const FileStore = require('session-file-store')(session);

const { getAllLeads, updateLeadField, archiveLead, getLeadsSheetDebug } = require('./sheets');
const {
  verifyLogin,
  listUsersSafe,
  createUser,
  deleteUser,
  userCount,
} = require('./users');
const { sendLoginCredentialsEmail } = require('./mail-welcome');

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 3080;
const DATA_DIR = path.join(__dirname, '../data');
app.set('trust proxy', 1);

const SESSION_SECRET = process.env.SESSION_SECRET;
const sessionOn = !!(SESSION_SECRET && String(SESSION_SECRET).length >= 16);

if (sessionOn) {
  app.use(session({
    store: new FileStore({
      path: path.join(DATA_DIR, 'sessions'),
      ttl: 86400 * 14,
      retries: 0,
      logFn: () => {},
    }),
    name: 'pvl.sid',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      maxAge: 7 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      secure: process.env.SESSION_COOKIE_SECURE === '1' || process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    },
  }));
}

function safeEqStr(expected, received) {
  try {
    const a = Buffer.from(String(expected), 'utf8');
    const b = Buffer.from(String(received), 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function parseBasicAuth(header) {
  if (!header || !header.startsWith('Basic ')) return null;
  try {
    const raw = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const i = raw.indexOf(':');
    if (i < 0) return null;
    return { user: raw.slice(0, i), pass: raw.slice(i + 1) };
  } catch {
    return null;
  }
}

function basicAuthConfigured() {
  const u = process.env.BASIC_AUTH_USER;
  const plain = process.env.BASIC_AUTH_PASS;
  const hashed = (process.env.BASIC_AUTH_PASS_BCRYPT || '').trim();
  return !!(u && (plain || hashed));
}

function verifyBasicCreds(creds) {
  if (!creds) return false;
  const u = process.env.BASIC_AUTH_USER;
  if (!u || !safeEqStr(u, creds.user)) return false;
  const hash = (process.env.BASIC_AUTH_PASS_BCRYPT || '').trim();
  if (hash) {
    try {
      return bcrypt.compareSync(creds.pass, hash);
    } catch {
      return false;
    }
  }
  const plain = process.env.BASIC_AUTH_PASS;
  if (plain) return safeEqStr(plain, creds.pass);
  return false;
}

function basicAuthMiddleware(req, res, next) {
  if (sessionOn) return next();
  if (!basicAuthConfigured()) return next();
  const creds = parseBasicAuth(req.headers.authorization);
  if (!verifyBasicCreds(creds)) {
    res.setHeader('WWW-Authenticate', 'Basic realm="PV Lead Manager"');
    return res.status(401).send('Authentifizierung erforderlich');
  }
  next();
}

function allowAdmin(req) {
  if (req.session && req.session.user && req.session.user.role === 'admin') return true;
  const token = process.env.ADMIN_TOKEN;
  if (token && req.headers.authorization === `Bearer ${token}`) return true;
  if (!sessionOn && basicAuthConfigured()) {
    const creds = parseBasicAuth(req.headers.authorization);
    if (verifyBasicCreds(creds)) return true;
  }
  return false;
}

function requireApiSession(req, res, next) {
  if (!sessionOn) return next();
  if (req.session && req.session.user) return next();
  return res.status(401).json({ error: 'login_required' });
}

function requireWebSession(req, res, next) {
  if (!sessionOn) return next();
  if (req.session && req.session.user) return next();
  const q = req.originalUrl && req.originalUrl !== '/' ? `?next=${encodeURIComponent(req.originalUrl)}` : '';
  return res.redirect(302, `/login.html${q}`);
}

app.use(basicAuthMiddleware);
app.use(express.json({ limit: '128kb' }));

// ── Auth (öffentlich wenn Session aktiv) ───────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  if (!sessionOn) {
    return res.status(503).json({ error: 'SESSION_SECRET nicht gesetzt (mind. 16 Zeichen)' });
  }
  const { username, password } = req.body || {};
  const user = await verifyLogin(username, password);
  if (!user) return res.status(401).json({ error: 'invalid_credentials' });
  req.session.user = { username: user.username, role: user.role };
  res.json({ ok: true, user: { username: user.username, role: user.role } });
});

app.post('/api/auth/logout', (req, res) => {
  if (req.session) {
    req.session.destroy((err) => {
      if (err) console.error('session destroy:', err.message);
      res.json({ ok: true });
    });
  } else {
    res.json({ ok: true });
  }
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session || !req.session.user) return res.json({ user: null });
  res.json({ user: req.session.user });
});

// Geschützte API + HTML (Session ODER nur Basic ohne Session)
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    if (req.path === '/api/auth/login' && req.method === 'POST') return next();
    if (req.path === '/api/auth/logout' && req.method === 'POST') return next();
    if (req.path === '/api/auth/bootstrap-admin' && req.method === 'POST') return next();
    if (req.path === '/api/auth/me') return next();
    if (!sessionOn) return next();
    return requireApiSession(req, res, next);
  }
  if (req.path === '/login.html' || req.path === '/login') return next();
  if (!sessionOn) return next();
  return requireWebSession(req, res, next);
});

app.use(express.static(path.join(__dirname, '../public')));

app.get('/api/leads', async (req, res) => {
  try {
    res.json(await getAllLeads());
  } catch (err) {
    console.error('GET /api/leads error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/debug/leads-sheet', async (req, res) => {
  try {
    const dbg = await getLeadsSheetDebug();
    const leads = await getAllLeads();
    res.json({ ...dbg, leadRowCount: leads.length });
  } catch (err) {
    console.error('GET /api/debug/leads-sheet error:', err.message);
    let dbg = {};
    try {
      dbg = await getLeadsSheetDebug();
    } catch (_) { /* ignore */ }
    res.status(500).json({ ...dbg, error: err.message });
  }
});

app.patch('/api/leads/:email/field', async (req, res) => {
  const { column, value } = req.body;
  if (!column) return res.status(400).json({ error: 'column is required' });
  try {
    await updateLeadField(decodeURIComponent(req.params.email), column, value ?? '');
    res.json({ ok: true });
  } catch (err) {
    console.error('PATCH field error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/leads/:email/archive', async (req, res) => {
  try {
    await archiveLead(decodeURIComponent(req.params.email));
    res.json({ ok: true });
  } catch (err) {
    console.error('POST archive error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Namen für „Betreut durch“-Chips = alle Benutzer (Login-Namen), sortiert */
async function readBetreutChipNames() {
  try {
    const users = await listUsersSafe();
    const names = [...new Set(users.map((u) => String(u.username || '').trim()).filter(Boolean))];
    names.sort((a, b) => a.localeCompare(b, 'de'));
    return names;
  } catch {
    return [];
  }
}

app.get('/api/vertriebler', async (req, res) => {
  try {
    res.json(await readBetreutChipNames());
  } catch (err) {
    console.error('GET /api/vertriebler error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/users', async (req, res) => {
  if (!allowAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    res.json({ users: await listUsersSafe() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/users', async (req, res) => {
  if (!allowAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  const { username, password, email, role, sendEmail } = req.body || {};
  try {
    await createUser({
      username,
      password,
      email,
      role: role === 'admin' ? 'admin' : 'sales',
    });
    const base = (process.env.APP_BASE_URL || '').replace(/\/$/, '') || `${req.protocol}://${req.get('host')}`;
    if (sendEmail && email) {
      try {
        await sendLoginCredentialsEmail(email, `${base}/login.html`, username, password);
      } catch (e) {
        console.error('Welcome mail failed:', e.message);
        return res.status(201).json({
          ok: true,
          warning: `Benutzer angelegt, E-Mail-Versand fehlgeschlagen: ${e.message}`,
        });
      }
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/admin/users/delete', async (req, res) => {
  if (!allowAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  const { username } = req.body || {};
  const actor = req.session?.user?.username || 'token';
  try {
    await deleteUser(username, actor);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/auth/bootstrap-admin', async (req, res) => {
  if (!sessionOn) return res.status(503).json({ error: 'SESSION_SECRET fehlt' });
  const n = await userCount();
  if (n > 0) return res.status(403).json({ error: 'Bereits Benutzer vorhanden' });
  const { username, password, email, setupToken } = req.body || {};
  if (!setupToken || setupToken !== process.env.SETUP_TOKEN) {
    return res.status(403).json({ error: 'Ungültiges Setup-Token' });
  }
  try {
    await createUser({ username, password, email, role: 'admin' });
    req.session.user = { username: String(username).trim(), role: 'admin' };
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).type('text/plain').send('Not Found');
  }
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, () => {
  const parts = [];
  if (sessionOn) parts.push('Session-Login');
  if (!sessionOn && basicAuthConfigured()) parts.push('Basic-Auth');
  const pub = (process.env.APP_BASE_URL || '').replace(/\/$/, '');
  const local = `http://127.0.0.1:${PORT}`;
  if (pub) {
    console.log(`PV Lead Manager listening ${local}${parts.length ? ` (${parts.join(', ')})` : ''} · live ${pub}`);
  } else {
    console.log(`PV Lead Manager ${local}${parts.length ? ` (${parts.join(', ')})` : ''} — set APP_BASE_URL=https://pvl.lifeco.at for production links`);
  }
});

module.exports = app;
