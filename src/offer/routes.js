'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');

const catalog = require('./catalog');
const { getLlmPublic, saveLlmSettings, getLlmConfig } = require('../app-settings');
const { parseOfferCommand, chatCompletionJson } = require('./ai-offer');
const { generateOfferPdf, appendVollmacht } = require('./pdf');
const { buildEmailText, buildEmailTextAI, buildMailtoUrl, safeFileBase, buildSummaryTitle, buildOfferFilenameBase } = require('./email');
const { resolveCustomerNames } = require('./names');
const klimaLeads = require('../klima-leads');
const persist = require('./persist');
const mapProviders = require('./map-providers');
const { renderLayoutOrthoPng } = require('./layout-ortho-render');

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
    includePv: cfg.includePv,
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
    inverterKw: cfg.inverterKw != null ? Number(cfg.inverterKw) : undefined,
    klima: cfg.klima,
    offerNotes: Array.isArray(cfg.offerNotes) ? cfg.offerNotes : undefined,
    offerNote: cfg.offerNote,
    angebotsnummer,
    datum,
    vertrieb,
  };
  return { offer: catalog.computeOffer(config), angebotsnummer };
}

function customerFromBody(body) {
  const c = body.customer && typeof body.customer === 'object' ? body.customer : {};
  const s = (v) => (v == null ? '' : String(v).trim());
  const names = resolveCustomerNames({
    vorname: s(c.vorname),
    nachname: s(c.nachname),
    name: s(c.name),
  });
  return {
    vorname: names.vorname,
    nachname: names.nachname,
    name: names.displayName || s(c.name),
    street: s(c.street),
    zip: s(c.zip),
    city: s(c.city),
    email: s(c.email),
    phone: s(c.phone),
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
      brands: catalog.listBrands(),
      pricelist: catalog.PRICELIST,
      pvOnlyNetto: catalog.PV_ONLY_NETTO,
      modulesPerKwp: catalog.MODULES_PER_KWP,
      dachOptions: Object.keys(catalog.DACH_AUFSCHLAG).map((k) => ({
        key: k, aufschlag: catalog.DACH_AUFSCHLAG[k],
      })),
      dachLabels: catalog.DACH_LABELS,
      inverters: {
        sigenergy: catalog.listInverters('sigenergy'),
        fronius: catalog.listInverters('fronius'),
        huawei: catalog.listInverters('huawei'),
        fronius_symo: catalog.listInverters('fronius_symo'),
      },
      storageExtensions: catalog.STORAGE_EXTENSIONS,
      speicherBlock: catalog.SPEICHERBLOCK,
      extraModulePrice: catalog.EXTRA_MODULE_PRICE,
      extraModulePriceNetto: catalog.EXTRA_MODULE_PRICE,
      mwstRate: catalog.MWST_RATE,
      klimaCatalog: catalog.KLIMA_CATALOG,
      klimaExtras: catalog.KLIMA_EXTRAS,
      klimaPackages: catalog.KLIMA_PACKAGES,
      moduleWpByType: Object.fromEntries(
        Object.keys(catalog.MODULE_TYPES).map((k) => [k, catalog.MODULE_TYPES[k].wp])
      ),
      options: Object.keys(catalog.OPTIONS).map((k) => ({
        key: k, label: catalog.OPTIONS[k].label, price: catalog.OPTIONS[k].price,
        alwaysIncluded: !!catalog.OPTIONS[k].alwaysIncluded,
        perModule: !!catalog.OPTIONS[k].perModule,
      })),
      optimiererUnitPrice: catalog.OPTIMIERER_UNIT_PRICE,
      moduleTypes: Object.keys(catalog.MODULE_TYPES).map((k) => ({
        id: k, label: `${catalog.MODULE_TYPES[k].model} (${catalog.MODULE_TYPES[k].wp} Wp)`,
      })),
      moduleDimensions: mapProviders.MODULE_DIMENSIONS,
      mapProviders: mapProviders.listMapProviders(),
    });
  });

  /** Preisdifferenz-Upgrades für aktuelle Marke/kWp/Basis-Speicher. */
  app.get('/api/offer/storage-upgrades', (req, res) => {
    try {
      const brand = catalog.normalizeBrand(req.query.brand);
      const kwp = catalog.snapKwp(brand, req.query.kwp);
      const from = Number(String(req.query.from || '').replace(',', '.'));
      const upgrades = catalog.brandHasStorage(brand)
        ? catalog.listStorageUpgrades(brand, kwp, from)
        : [];
      const extensions = catalog.brandHasStorage(brand)
        ? catalog.listStorageExtensionOptions(brand)
        : [];
      res.json({ ok: true, brand, kwp, fromKwh: from, upgrades, extensions, hasStorage: catalog.brandHasStorage(brand) });
    } catch (err) {
      res.status(400).json({ error: err.message || String(err) });
    }
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
        customer: (() => {
          const raw = String(lead['Nachname + Vorname'] || '').trim();
          const names = resolveCustomerNames({ name: raw });
          return {
            vorname: names.vorname,
            nachname: names.nachname,
            name: names.displayName || raw,
            street: String(lead['Straße'] || '').trim(),
            zip: String(lead.PLZ || '').trim(),
            city: String(lead.Ort || '').trim(),
            email: String(lead['E-Mail'] || '').trim(),
            phone: String(lead.Telefon || '').trim(),
          };
        })(),
        leadId: lead.pvlDbId != null ? Number(lead.pvlDbId) : (lead.id != null ? Number(lead.id) : null),
        info,
      });
    } catch (err) {
      res.status(500).json({ error: err.message || String(err) });
    }
  });

  // KI: Freitext → Kundendaten + Anforderungen (+ optionale Rückfragen)
  app.post('/api/offer/parse', async (req, res) => {
    try {
      const parsed = await parseOfferCommand(String((req.body || {}).command || ''));
      res.json({ ok: true, ...parsed });
    } catch (err) {
      console.error('[NOORTEC] /api/offer/parse:', err.message);
      res.status(400).json({ error: err.message || String(err) });
    }
  });

  /** Schema-Vorschau für künftigen Klimalead-Import (noch ohne Persistenz). */
  app.get('/api/klima/lead-schema', (req, res) => {
    res.json({
      ok: true,
      interestTypes: klimaLeads.LEAD_INTEREST_TYPES,
      fields: klimaLeads.KLIMA_LEAD_FIELDS,
      packages: catalog.KLIMA_PACKAGES.map((p) => ({
        id: p.id, label: p.label, outdoorKw: p.outdoorKw, priceBrutto: p.priceBrutto,
      })),
      note: 'Import-Endpunkt folgt – diese Struktur ist die Basis für CSV/Webhook.',
    });
  });

  app.post('/api/klima/normalize-lead', (req, res) => {
    try {
      const normalized = klimaLeads.normalizeKlimaLeadRow(req.body || {});
      res.json({ ok: true, lead: normalized });
    } catch (err) {
      res.status(400).json({ error: err.message || String(err) });
    }
  });

  // Live-Berechnung (Vorschau-Zahlen)
  app.post('/api/offer/plan-storage', (req, res) => {
    try {
      const b = req.body || {};
      const brand = catalog.normalizeBrand(b.brand);
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
  // Vollmacht: immer bei PV/Kombi, nie bei reinem Klima (Server erzwingt das).
  app.post('/api/offer/pdf', async (req, res) => {
    try {
      const body = req.body || {};
      // Nach Wiederöffnen: beim nächsten Finalize neue Nummer aus dem Zähler
      if (body.finalize && body.allocateNewNumber) {
        body.angebotsnummer = formatOfferNumber(readCounter());
      }
      const { offer, angebotsnummer } = buildOfferFromBody(req, getProfile, body);
      const customer = customerFromBody(body);
      const leadIdNum = body.leadId != null ? Number(body.leadId) : null;
      const customerVersion = persist.peekNextCustomerVersion(
        Number.isFinite(leadIdNum) ? leadIdNum : null,
        customer.email,
      );
      const fileBase = safeFileBase(customer, angebotsnummer, customerVersion);

      // Optional: Belegungsplan-Snapshot / Plan-JSON fürs PDF
      let layoutSnapshotAbs = null;
      let layoutPlan = null;
      let layoutPlanId = body.layoutPlanId != null ? Number(body.layoutPlanId) : null;
      if (!Number.isFinite(layoutPlanId) && body.leadId != null) {
        // Fallback: neuestes Layout zum Lead
        try {
          const list = persist.listLayoutsForLead(Number(body.leadId));
          if (list && list[0]) layoutPlanId = Number(list[0].id);
        } catch (_) { /* ignore */ }
      }
      if (Number.isFinite(layoutPlanId)) {
        layoutSnapshotAbs = persist.getLayoutSnapshotAbsPath(layoutPlanId);
        if (layoutSnapshotAbs && !fs.existsSync(layoutSnapshotAbs)) layoutSnapshotAbs = null;
        const layoutRow = persist.getLayout(layoutPlanId);
        if (layoutRow && layoutRow.plan) layoutPlan = layoutRow.plan;

        // Orthofoto-Render serverseitig (Haus + Satellit + Module) – unabhängig vom Browser-Snapshot
        if (layoutPlan && (
          (Array.isArray(layoutPlan.modules) && layoutPlan.modules.length)
          || (Array.isArray(layoutPlan.roofs) && layoutPlan.roofs.length)
          || (Array.isArray(layoutPlan.roof) && layoutPlan.roof.length)
        )) {
          try {
            const png = await renderLayoutOrthoPng(layoutPlan, {
              basemapProvider: (layoutRow && layoutRow.basemapProvider) || 'basemap_at',
            });
            if (png && png.length > 100) {
              persist.saveLayoutSnapshotBuffer(layoutPlanId, png);
              layoutSnapshotAbs = persist.getLayoutSnapshotAbsPath(layoutPlanId);
              if (layoutSnapshotAbs && !fs.existsSync(layoutSnapshotAbs)) layoutSnapshotAbs = null;
            }
          } catch (e) {
            console.warn('[NOORTEC] Ortho-Belegungsplan:', e.message);
          }
        }
      }

      let pdf = await generateOfferPdf(offer, customer, body.texts || {}, {
        layoutSnapshotPath: layoutSnapshotAbs,
        layoutPlan,
        baseUrl: process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`,
      });
      const kind = (offer.meta && offer.meta.offerKind) || 'pv';
      const isPvOffer = kind === 'pv' || kind === 'combo'
        || (offer.config && offer.config.includePv !== false && Number(offer.config.moduleCount) > 0);
      const attachVollmacht = isPvOffer && body.appendVollmacht !== false;
      if (attachVollmacht) pdf = await appendVollmacht(pdf);
      if (body.finalize) maybeBumpCounter(angebotsnummer);

      let savedVersion = null;
      // Persistenz: Angebotsversion speichern (finalize = sent, sonst optional draft)
      if (body.finalize || body.saveVersion) {
        try {
          const createdBy = (req.session && req.session.user && req.session.user.username) || '';
          savedVersion = persist.saveOfferVersion({
            leadId: Number.isFinite(leadIdNum) ? leadIdNum : null,
            customerEmail: customer.email,
            angebotsnummer,
            customerVersion,
            filenameBase: fileBase,
            status: body.finalize ? 'sent' : 'draft',
            config: body.config || {},
            variants: body.variants || [],
            emailSubject: body.subject || '',
            emailBody: body.body || '',
            layoutPlanId: Number.isFinite(layoutPlanId) ? layoutPlanId : null,
          }, createdBy);
          if (savedVersion) {
            try { persist.saveOfferPdfFile(savedVersion.id, pdf); } catch (e) {
              console.warn('[NOORTEC] PDF speichern:', e.message);
            }
          }
        } catch (e) {
          console.warn('[NOORTEC] Angebotsversion speichern:', e.message);
        }
      }

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${fileBase}.pdf"`);
      res.setHeader('X-Angebotsnummer', angebotsnummer);
      res.setHeader('X-Customer-Version', String(customerVersion));
      res.setHeader('X-Filename-Base', fileBase);
      if (savedVersion) res.setHeader('X-Offer-Version-Id', String(savedVersion.id));
      // CORS-ähnliche Exposure für Frontend-Header-Lesen (same-origin reicht meist)
      res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-Angebotsnummer, X-Customer-Version, X-Filename-Base, X-Offer-Version-Id');
      res.send(pdf);
    } catch (err) {
      console.error('[NOORTEC] /api/offer/pdf:', err.message);
      res.status(400).json({ error: err.message || String(err) });
    }
  });

  // E-Mail-Text – standardmäßig immer per KI (Fallback: Vorlage)
  app.post('/api/offer/email-text', async (req, res) => {
    try {
      const body = req.body || {};
      const { offer } = buildOfferFromBody(req, getProfile, body);
      const customer = customerFromBody(body);
      const salutationOverride = (() => {
        const s = String(body.salutationOverride || body.anrede || '').toLowerCase().trim();
        if (s === 'herr' || s === 'frau') return s;
        // aus Klartext "Anrede: Herr" im Command
        const cmd = String(body.command || '');
        if (/\bAnrede:\s*Herr\b/i.test(cmd) || /\bHerr\b/i.test(String(body.salutationHint || ''))) {
          if (/\bAnrede:\s*Herr\b/i.test(cmd)) return 'herr';
        }
        if (/\bAnrede:\s*Frau\b/i.test(cmd)) return 'frau';
        return null;
      })();
      const params = {
        customer,
        offer,
        extraText: body.extraText || '',
        command: body.command || '',
        salutationOverride,
      };
      const useAI = body.useAI !== false;
      const out = useAI ? await buildEmailTextAI(params) : { ...buildEmailText(params), source: 'template' };
      const nextV = persist.peekNextCustomerVersion(
        body.leadId != null ? Number(body.leadId) : null,
        customer.email,
      );
      res.json({
        ok: true,
        ...out,
        summaryTitle: buildSummaryTitle(customer, offer.meta.angebotsnummer, nextV),
        filenameBase: buildOfferFilenameBase(customer, offer.meta.angebotsnummer, nextV),
        customerVersion: nextV,
      });
    } catch (err) {
      console.error('[NOORTEC] /api/offer/email-text:', err.message);
      res.status(400).json({ error: err.message || String(err) });
    }
  });

  // Outlook-Compose-Link; PDF wird separat heruntergeladen.
  app.post('/api/offer/outlook-draft', async (req, res) => {
    try {
      const body = req.body || {};
      if (body.allocateNewNumber) {
        body.angebotsnummer = formatOfferNumber(readCounter());
      }
      const { offer, angebotsnummer } = buildOfferFromBody(req, getProfile, body);
      const customer = customerFromBody(body);
      let subject = String(body.subject || '').trim();
      let mailBody = String(body.body || '').trim();
      if (!subject || !mailBody) {
        const salutationOverride = (() => {
          const s = String(body.salutationOverride || body.anrede || '').toLowerCase().trim();
          if (s === 'herr' || s === 'frau') return s;
          if (/\bAnrede:\s*Herr\b/i.test(String(body.command || ''))) return 'herr';
          if (/\bAnrede:\s*Frau\b/i.test(String(body.command || ''))) return 'frau';
          return null;
        })();
        const params = {
          customer,
          offer,
          extraText: body.extraText || '',
          command: body.command || '',
          salutationOverride,
        };
        const useAI = body.useAI !== false;
        const txt = useAI ? await buildEmailTextAI(params) : buildEmailText(params);
        subject = subject || txt.subject;
        mailBody = mailBody || txt.body;
      }

      const nextV = persist.peekNextCustomerVersion(
        body.leadId != null ? Number(body.leadId) : null,
        customer.email,
      );
      const fileBase = safeFileBase(customer, angebotsnummer, nextV);
      res.json({
        ok: true,
        mailtoUrl: buildMailtoUrl({
          to: customer.email,
          subject,
          body: mailBody,
        }),
        attachmentFilename: `${fileBase}.pdf`,
        angebotsnummer,
        customerVersion: nextV,
        filenameBase: fileBase,
        offerKind: (offer.meta && offer.meta.offerKind) || 'pv',
        appendVollmacht: ((offer.meta && offer.meta.offerKind) || 'pv') !== 'klima',
      });
    } catch (err) {
      console.error('[NOORTEC] /api/offer/outlook-draft:', err.message);
      res.status(400).json({ error: err.message || String(err) });
    }
  });
}

module.exports = { mountOfferRoutes };
