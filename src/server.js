'use strict';

require('dotenv').config();
const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const { getAllLeads, updateLeadField, archiveLead } = require('./sheets');

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 3080;
const DATA_DIR = path.join(__dirname, '../data');
const VERT_FILE = path.join(DATA_DIR, 'vertriebler.json');

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
  const token = process.env.ADMIN_TOKEN;
  if (!token || req.headers.authorization !== `Bearer ${token}`) {
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
  console.log(`PV Lead Manager running at http://localhost:${PORT}`);
});

module.exports = app;
