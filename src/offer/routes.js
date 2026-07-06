'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');

const catalog = require('./catalog');
const { getLlmPublic, saveLlmSettings, getLlmConfig } = require('../app-settings');
const { parseOfferCommand, chatCompletionJson } = require('./ai-offer');
const { generateOfferPdf, appendVollmacht } = require('./pdf');
const { buildEmailText, buildEmailTextAI, buildEml, safeFileBase, buildSummaryTitle } = require('./email');

const PUBLIC_DIR = path.join(__dirname, '../../public');
const DATA_DIR = path.join(__dirname, '../../data');
const COUNTER_FILE = path.join(DATA_DIR, 'offer-counter.json');

function pad4(n) {
  return String(n).padStart(4, '0');
}

/** Aktueller Zählerstand für DIESES Jahr. Jahreswechsel → Reset auf 1. */
function readCounter() {
  const year = new Date().getFullYear();
  try {
    const j = JSON.parse(fs.readFileSync(COUNTER_FILE, 'utf8'));
    if (parseInt(j.year, 10) === year) {
      const n = parseInt(j.next, 10);
      if (Number.isFinite(n) && n > 0) return { year, next: n };
    }
  } catch (_) { /* ignore */ }
  return { year, next: 1 };
}

function writeCounter(next, year) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(COUNTER_FILE, JSON.stringify({ year: year || new Date().getFullYear(), next }, null, 2));
  } catch (err) {
    console.error('[NOORTEC] offer-counter schreiben fehlgeschlagen:', err.message);
  }
}

/** Angebotsnummer im Format JAHR-NNNN (z. B. 2026-0001). */
function formatOfferNumber(c) {
  return `${c.year}-${pad4(c.next)}`;
}

/** Vertriebskontakt aus Session-Profil, mit Override und Env-Fallbacks. */
function resolveVertrieb(req, getProfile, override = {}) {
  let prof = {};
  try { prof = getProfile(req.session.user.username) || {}; } catch (_) { /* ignore */ }
  return {
    name: (override.name || prof.voller_name || process.env.MY_NAME || 'Cosimo Lippe').trim(),
    email: (override.email || prof.email_kontakt || process.env.MY_EMAIL || 'vertrieb@noortec.at').trim(),
    phone: (override.phone || prof.telefon || process.env.MY_PHONE || '+43 676 707 55 25').trim(),
  };
}

function buildOfferFromBody(req, getProfile, body) {
  const angebotsnummer = String(body.angebotsnummer || '').trim() || formatOfferNumber(readCounter());
  const datum = String(body.datum || '').trim() || new Date().toLocaleDateString('de-DE');
  const vertrieb = resolveVertrieb(req, getProfile, body.vertrieb || {});
  const cfg = body.config && typeof body.config === 'object' ? body.config : {};
  const config = {
    brand: cfg.brand,
    kwp: cfg.kwp,
    speicher: cfg.speicher,
    speicherZusatz: Array.isArray(cfg.speicherZusatz) ? cfg.speicherZusatz : undefined,
    dach: cfg.dach,
    dachSegmente: Array.isArray(cfg.dachSegmente) ? cfg.dachSegmente : undefined,
    moduleType: cfg.moduleType,
    moduleCount: cfg.moduleCount,
    speicherGesamt: cfg.speicherGesamt,
    optionen: Array.isArray(cfg.optionen) ? cfg.optionen : undefined,
    inkludierteOptionen: cfg.inkludierteOptionen || [],
    standardOptionen: cfg.standardOptionen,
    bruttoOverride: cfg.bruttoOverride,
    inverterModel: cfg.inverterModel,
    angebotsnummer,
    datum,
    vertrieb,
  };
  return { offer: catalog.computeOffer(config), angebotsnummer };
}

function customerFromBody(body) {
  const c = body.customer && typeof body.customer === 'object' ? body.customer : {};
  const s = (v) => (v == null ? '' : String(v).trim());
  return {
    name: s(c.name), street: s(c.street), zip: s(c.zip),
    city: s(c.city), email: s(c.email), phone: s(c.phone),
  };
}

function maybeBumpCounter(angebotsnummer) {
  // Trailing laufende Nummer extrahieren (Format JAHR-NNNN), Jahr aus Präfix.
  const s = String(angebotsnummer);
  const m = s.match(/(\d{4})\D+(\d+)\s*$/) || s.match(/(\d+)\s*$/);
  const cur = readCounter();
  let year = cur.year;
  let used;
  if (m && m.length === 3) { year = parseInt(m[1], 10) || year; used = parseInt(m[2], 10); }
  else if (m) { used = parseInt(m[1], 10); }
  if (Number.isFinite(used) && year === cur.year && used >= cur.next) writeCounter(used + 1, year);
}

/**
 * Registriert alle Angebots-Routen auf der bestehenden Express-App.
 * @param {import('express').Express} app
 * @param {{ getProfile: Function, getLeadByEmail: Function }} deps
 */
function mountOfferRoutes(app, deps) {
  const { getProfile, getLeadByEmail } = deps;

  /** Admin per Session-Rolle oder Bearer ADMIN_TOKEN. */
  function isAdmin(req) {
    if (req.session && req.session.user && req.session.user.role === 'admin') return true;
    const token = String(process.env.ADMIN_TOKEN || '').trim();
    return !!(token && req.headers.authorization === `Bearer ${token}`);
  }

  // Seite (durch globale Session-Pflicht in server.js geschützt)
  app.get(['/offer', '/offer/'], (req, res) => {
    res.set('Cache-Control', 'no-store, max-age=0');
    res.sendFile(path.join(PUBLIC_DIR, 'offer.html'));
  });

  // Aktueller Vertriebskontakt (angemeldeter User) für die Anzeige im Formular
  app.get('/api/offer/vertrieb', (req, res) => {
    res.json({ vertrieb: resolveVertrieb(req, getProfile) });
  });

  // ── Admin: KI-Einstellungen (API-Key etc. ohne .env-Bearbeitung) ──────────
  app.get('/api/admin/ai-settings', (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
    res.json(getLlmPublic());
  });

  app.post('/api/admin/ai-settings', (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
    const b = req.body || {};
    try {
      const out = saveLlmSettings({
        provider: b.provider,
        model: b.model,
        baseUrl: b.baseUrl,
        // '' = unverändert; null = löschen (Fallback .env); String = neuer Key
        apiKey: b.clearApiKey ? null : (b.apiKey !== undefined ? b.apiKey : undefined),
      });
      res.json({ ok: true, ...out });
    } catch (err) {
      res.status(400).json({ error: err.message || String(err) });
    }
  });

  app.post('/api/admin/ai-settings/test', async (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const cfg = getLlmConfig();
      if (!cfg.apiKey) return res.status(400).json({ error: 'Kein API-Key gesetzt.' });
      const out = await chatCompletionJson(
        'Antworte ausschließlich mit JSON: {"ok": true}.',
        'Verbindungstest. Gib {"ok": true} zurück.',
      );
      const works = /"ok"\s*:\s*true/i.test(String(out));
      res.json({ ok: works, provider: cfg.provider, model: cfg.model, raw: String(out).slice(0, 200) });
    } catch (err) {
      res.status(400).json({ error: err.message || String(err) });
    }
  });

  // Katalog/Stammdaten für die Eingabemaske
  app.get('/api/offer/catalog', (req, res) => {
    res.json({
      brands: [
        { id: 'sigenergy', label: 'Sigenergy' },
        { id: 'fronius', label: 'Fronius' },
      ],
      pricelist: catalog.PRICELIST,
      modulesPerKwp: catalog.MODULES_PER_KWP,
      dachOptions: Object.keys(catalog.DACH_AUFSCHLAG).map((k) => ({
        key: k, aufschlag: catalog.DACH_AUFSCHLAG[k],
      })),
      dachLabels: ['Ziegel', 'Welleternit', 'Trapezblech', 'Schindel-Eternit', 'Rhombus', 'Biberschwanz', 'Wiener Tasche', 'Prefa', 'Flachdach'],
      storageExtensions: catalog.STORAGE_EXTENSIONS,
      extraModulePrice: catalog.EXTRA_MODULE_PRICE,
      options: Object.keys(catalog.OPTIONS).map((k) => ({
        key: k, label: catalog.OPTIONS[k].label, price: catalog.OPTIONS[k].price,
        alwaysIncluded: !!catalog.OPTIONS[k].alwaysIncluded,
      })),
      moduleTypes: Object.keys(catalog.MODULE_TYPES).map((k) => ({
        id: k, label: `${catalog.MODULE_TYPES[k].model} (${catalog.MODULE_TYPES[k].wp} Wp)`,
      })),
    });
  });

  app.get('/api/offer/next-number', (req, res) => {
    res.json({ angebotsnummer: formatOfferNumber(readCounter()) });
  });

  // Lead-Daten für Vorbefüllung ("Angebot senden" beim Kunden)
  app.get('/api/offer/lead', async (req, res) => {
    const email = String(req.query.email || '').trim();
    if (!email) return res.status(400).json({ error: 'email erforderlich' });
    try {
      const lead = await getLeadByEmail(email);
      if (!lead) return res.status(404).json({ error: 'Lead nicht gefunden' });
      const info = [lead.Info, lead.Notizen].filter(Boolean).join(' \n').trim();
      res.json({
        customer: {
          name: String(lead['Nachname + Vorname'] || '').trim(),
          street: String(lead['Straße'] || '').trim(),
          zip: String(lead.PLZ || '').trim(),
          city: String(lead.Ort || '').trim(),
          email: String(lead['E-Mail'] || '').trim(),
          phone: String(lead.Telefon || '').trim(),
        },
        info,
      });
    } catch (err) {
      res.status(500).json({ error: err.message || String(err) });
    }
  });

  // KI: Freitext → Kundendaten + Anforderungen
  app.post('/api/offer/parse', async (req, res) => {
    try {
      const parsed = await parseOfferCommand(String((req.body || {}).command || ''));
      res.json({ ok: true, ...parsed });
    } catch (err) {
      console.error('[NOORTEC] /api/offer/parse:', err.message);
      res.status(400).json({ error: err.message || String(err) });
    }
  });

  // Live-Berechnung (Vorschau-Zahlen)
  app.post('/api/offer/plan-storage', (req, res) => {
    try {
      const b = req.body || {};
      const brand = (b.brand === 'fronius') ? 'fronius' : 'sigenergy';
      const kwp = catalog.snapKwp(brand, b.kwp);
      const plan = catalog.planStorage(brand, kwp, b.speicherGesamt);
      res.json({ ok: true, ...plan });
    } catch (err) {
      res.status(400).json({ error: err.message || String(err) });
    }
  });

  app.post('/api/offer/compute', (req, res) => {
    try {
      const { offer, angebotsnummer } = buildOfferFromBody(req, getProfile, req.body || {});
      res.json({ ok: true, angebotsnummer, offer });
    } catch (err) {
      console.error('[NOORTEC] /api/offer/compute:', err.message);
      res.status(400).json({ error: err.message || String(err) });
    }
  });

  // PDF (Vorschau & Download)
  app.post('/api/offer/pdf', async (req, res) => {
    try {
      const body = req.body || {};
      const { offer, angebotsnummer } = buildOfferFromBody(req, getProfile, body);
      const customer = customerFromBody(body);
      let pdf = await generateOfferPdf(offer, customer, body.texts || {});
      if (body.appendVollmacht !== false) pdf = await appendVollmacht(pdf);
      if (body.finalize) maybeBumpCounter(angebotsnummer);
      const fileBase = safeFileBase(customer, angebotsnummer);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${fileBase}.pdf"`);
      res.send(pdf);
    } catch (err) {
      console.error('[NOORTEC] /api/offer/pdf:', err.message);
      res.status(400).json({ error: err.message || String(err) });
    }
  });

  // E-Mail-Text (Template oder KI)
  app.post('/api/offer/email-text', async (req, res) => {
    try {
      const body = req.body || {};
      const { offer } = buildOfferFromBody(req, getProfile, body);
      const customer = customerFromBody(body);
      const params = {
        customer, offer,
        contactType: body.contactType || null,
        extraText: body.extraText || '',
      };
      const out = body.useAI ? await buildEmailTextAI(params) : { ...buildEmailText(params), source: 'template' };
      res.json({ ok: true, ...out, summaryTitle: buildSummaryTitle(customer, offer.meta.angebotsnummer) });
    } catch (err) {
      console.error('[NOORTEC] /api/offer/email-text:', err.message);
      res.status(400).json({ error: err.message || String(err) });
    }
  });

  // .eml-Entwurf (Outlook) mit PDF-Anhang
  app.post('/api/offer/eml', async (req, res) => {
    try {
      const body = req.body || {};
      const { offer, angebotsnummer } = buildOfferFromBody(req, getProfile, body);
      const customer = customerFromBody(body);
      let pdf = await generateOfferPdf(offer, customer, body.texts || {});
      if (body.appendVollmacht !== false) pdf = await appendVollmacht(pdf);

      let subject = String(body.subject || '').trim();
      let mailBody = String(body.body || '').trim();
      if (!subject || !mailBody) {
        const params = { customer, offer, contactType: body.contactType || null, extraText: body.extraText || '' };
        const txt = body.useAI ? await buildEmailTextAI(params) : buildEmailText(params);
        subject = subject || txt.subject;
        mailBody = mailBody || txt.body;
      }

      const vertrieb = resolveVertrieb(req, getProfile, body.vertrieb || {});
      const fileBase = safeFileBase(customer, angebotsnummer);
      const eml = buildEml({
        to: customer.email,
        from: vertrieb.email,
        subject,
        body: mailBody,
        attachments: [{ filename: `${fileBase}.pdf`, content: pdf, contentType: 'application/pdf' }],
      });
      maybeBumpCounter(angebotsnummer);
      res.setHeader('Content-Type', 'message/rfc822');
      res.setHeader('Content-Disposition', `attachment; filename="${fileBase}.eml"`);
      res.send(eml);
    } catch (err) {
      console.error('[NOORTEC] /api/offer/eml:', err.message);
      res.status(400).json({ error: err.message || String(err) });
    }
  });
}

module.exports = { mountOfferRoutes };
