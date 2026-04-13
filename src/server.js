'use strict';

require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const { getAllLeads, updateLeadField, archiveLead } = require('./sheets');

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 3080;
const DATA_DIR = path.join(__dirname, '../data');
const VERT_FILE = path.join(DATA_DIR, 'vertriebler.json');

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

/** Basic Auth aktiv, wenn User + (Klartextpasswort ODER bcrypt-Hash) gesetzt */
function basicAuthConfigured() {
  const u = process.env.BASIC_AUTH_USER;
  const plain = process.env.BASIC_AUTH_PASS;
  const hashed = (process.env.BASIC_AUTH_PASS_BCRYPT || '').trim();
  if (!u || (!plain && !hashed)) return false;
  if (hashed && !hashed.startsWith('$2')) {
    console.warn('BASIC_AUTH_PASS_BCRYPT sollte mit $2a$, $2b$ oder $2y$ beginnen (bcrypt).');
  }
  return true;
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
  if (!basicAuthConfigured()) return next();

  const creds = parseBasicAuth(req.headers.authorization);
  if (!verifyBasicCreds(creds)) {
    res.setHeader('WWW-Authenticate', 'Basic realm="PV Lead Manager"');
    return res.status(401).send('Authentifizierung erforderlich');
  }
  next();
}

app.use(basicAuthMiddleware);
app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(__dirname, '../public')));

// GET all leads
app.get('/api/leads', async (req, res) => {
  try {
    res.json(await getAllLeads());
  } catch (err) {
    console.error('GET /api/leads error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PATCH a single field (Betreut Durch, Notizen, Status, …)
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

// POST archive (copy to Cosimo tab, delete from Leads)
app.post('/api/leads/:email/archive', async (req, res) => {
  try {
    await archiveLead(decodeURIComponent(req.params.email));
    res.json({ ok: true });
  } catch (err) {
    console.error('POST archive error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

async function readVertriebler() {
  try {
    const raw = await fs.readFile(VERT_FILE, 'utf8');
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return [...new Set(arr.filter((x) => typeof x === 'string').map((x) => x.trim()).filter(Boolean))];
  } catch {
    return (process.env.VERTIEBER_NAMES || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
}

app.get('/api/vertriebler', async (req, res) => {
  try {
    res.json(await readVertriebler());
  } catch (err) {
    console.error('GET /api/vertriebler error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/vertriebler', async (req, res) => {
  const hasBasic = basicAuthConfigured();
  const token = process.env.ADMIN_TOKEN;
  const authHeader = req.headers.authorization || '';

  let allowed = false;
  if (hasBasic) {
    const creds = parseBasicAuth(authHeader);
    if (verifyBasicCreds(creds)) allowed = true;
  } else if (token && authHeader === `Bearer ${token}`) {
    allowed = true;
  }

  if (!allowed) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { names } = req.body;
  if (!Array.isArray(names) || names.some((n) => typeof n !== 'string')) {
    return res.status(400).json({ error: 'names must be an array of strings' });
  }
  const clean = [...new Set(names.map((n) => n.trim()).filter(Boolean))].slice(0, 20);
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(VERT_FILE, `${JSON.stringify(clean, null, 2)}\n`, 'utf8');
    res.json({ ok: true, names: clean });
  } catch (err) {
    console.error('POST /api/admin/vertriebler error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, () => {
  const authHint = basicAuthConfigured() ? ' (Basic-Auth aktiv)' : '';
  console.log(`PV Lead Manager running at http://localhost:${PORT}${authHint}`);
});

module.exports = app;
