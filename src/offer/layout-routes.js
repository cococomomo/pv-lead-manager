'use strict';

const fs = require('fs');
const path = require('path');
const persist = require('./persist');
const mapProviders = require('./map-providers');

/**
 * Layout-/Geo-/Angebotsversions-Routen.
 * @param {import('express').Express} app
 */
function mountLayoutOfferPersistRoutes(app) {
  app.get('/api/geo/providers', (_req, res) => {
    res.json({
      map: mapProviders.listMapProviders(),
      geocode: mapProviders.listGeocodeProviders(),
      moduleDimensions: mapProviders.MODULE_DIMENSIONS,
    });
  });

  app.get('/api/geo/search', async (req, res) => {
    try {
      const q = String(req.query.q || '').trim();
      const results = await mapProviders.geocodeSearch(q, {
        countrycodes: String(req.query.countrycodes || 'at'),
        limit: Math.min(12, Number(req.query.limit) || 8),
      });
      res.json({ ok: true, results });
    } catch (err) {
      console.error('[NOORTEC] /api/geo/search:', err.message);
      res.status(400).json({ error: err.message || String(err) });
    }
  });

  app.get('/api/geo/housenumbers', async (req, res) => {
    try {
      const bbox = {
        south: Number(req.query.south),
        west: Number(req.query.west),
        north: Number(req.query.north),
        east: Number(req.query.east),
      };
      const results = await mapProviders.fetchHousenumbers(bbox);
      res.json({ ok: true, results });
    } catch (err) {
      console.error('[NOORTEC] /api/geo/housenumbers:', err.message);
      res.status(400).json({ error: err.message || String(err) });
    }
  });

  app.get('/api/layouts', (req, res) => {
    try {
      const leadId = req.query.leadId != null ? Number(req.query.leadId) : null;
      const email = String(req.query.email || '').trim();
      let list = [];
      if (Number.isFinite(leadId)) list = persist.listLayoutsForLead(leadId);
      else if (email) list = persist.listLayoutsForEmail(email);
      res.json({ ok: true, layouts: list });
    } catch (err) {
      res.status(400).json({ error: err.message || String(err) });
    }
  });

  app.get('/api/layouts/:id', (req, res) => {
    const layout = persist.getLayout(req.params.id);
    if (!layout) return res.status(404).json({ error: 'nicht gefunden' });
    res.json({ ok: true, layout });
  });

  app.post('/api/layouts', (req, res) => {
    try {
      const body = req.body || {};
      const createdBy = (req.session && req.session.user && req.session.user.username) || '';
      const layout = persist.createLayout(body, createdBy);
      res.json({ ok: true, layout });
    } catch (err) {
      console.error('[NOORTEC] POST /api/layouts:', err.message);
      res.status(400).json({ error: err.message || String(err) });
    }
  });

  app.patch('/api/layouts/:id', (req, res) => {
    try {
      const layout = persist.updateLayout(req.params.id, req.body || {});
      if (!layout) return res.status(404).json({ error: 'nicht gefunden' });
      res.json({ ok: true, layout });
    } catch (err) {
      res.status(400).json({ error: err.message || String(err) });
    }
  });

  app.delete('/api/layouts/:id', (req, res) => {
    const ok = persist.deleteLayout(req.params.id);
    if (!ok) return res.status(404).json({ error: 'nicht gefunden' });
    res.json({ ok: true });
  });

  app.post('/api/layouts/:id/snapshot', async (req, res) => {
    try {
      const body = req.body || {};
      const data = body.image || body.data || body.snapshot;
      let layout = persist.getLayout(req.params.id);
      if (!layout) return res.status(404).json({ error: 'nicht gefunden' });

      if (data) {
        try {
          persist.saveLayoutSnapshot(req.params.id, data);
          layout = persist.getLayout(req.params.id);
        } catch (e) {
          console.warn('[NOORTEC] Client-Snapshot:', e.message);
        }
      }

      // Immer zusätzlich Orthofoto serverseitig rendern (Haus + Satellit)
      if (layout.plan && (
        (layout.plan.modules && layout.plan.modules.length)
        || (layout.plan.roofs && layout.plan.roofs.length)
        || (layout.plan.roof && layout.plan.roof.length)
      )) {
        try {
          const { renderLayoutOrthoPng } = require('./layout-ortho-render');
          const png = await renderLayoutOrthoPng(layout.plan, {
            basemapProvider: layout.basemapProvider || 'basemap_at',
          });
          if (png && png.length > 100) {
            persist.saveLayoutSnapshotBuffer(req.params.id, png);
            if (png.basemapProvider) persist.rememberLayoutBasemap(req.params.id, png.basemapProvider);
            layout = persist.getLayout(req.params.id);
          }
        } catch (e) {
          console.warn('[NOORTEC] Ortho-Snapshot:', e.message);
        }
      }

      res.json({
        ok: true,
        snapshotPath: layout.snapshotPath,
        snapshotUrl: layout.snapshotUrl,
        layout,
      });
    } catch (err) {
      console.error('[NOORTEC] snapshot:', err.message);
      res.status(400).json({ error: err.message || String(err) });
    }
  });

  app.get('/api/layouts/:id/snapshot-file', (req, res) => {
    const abs = persist.getLayoutSnapshotAbsPath(req.params.id);
    if (!abs || !fs.existsSync(abs)) return res.status(404).json({ error: 'kein Snapshot' });
    const fd = fs.openSync(abs, 'r');
    const head = Buffer.alloc(3);
    fs.readSync(fd, head, 0, 3, 0);
    fs.closeSync(fd);
    if (head[0] === 0xff && head[1] === 0xd8) res.type('image/jpeg');
    else if (head[0] === 0x89 && head[1] === 0x50) res.type('image/png');
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.sendFile(path.resolve(abs));
  });

  app.get('/api/leads/:id/layouts', (req, res) => {
    try {
      const layouts = persist.listLayoutsForLead(req.params.id);
      res.json({ ok: true, layouts });
    } catch (err) {
      res.status(400).json({ error: err.message || String(err) });
    }
  });

  app.get('/api/leads/:id/offers', (req, res) => {
    try {
      const offers = persist.listOffersForLead(req.params.id);
      res.json({ ok: true, offers });
    } catch (err) {
      res.status(400).json({ error: err.message || String(err) });
    }
  });

  app.get('/api/offer/versions', (req, res) => {
    try {
      const leadId = req.query.leadId != null ? Number(req.query.leadId) : null;
      const email = String(req.query.email || '').trim();
      let list = [];
      if (Number.isFinite(leadId)) list = persist.listOffersForLead(leadId);
      else if (email) list = persist.listOffersForEmail(email);
      res.json({ ok: true, offers: list });
    } catch (err) {
      res.status(400).json({ error: err.message || String(err) });
    }
  });

  app.post('/api/offer/versions', async (req, res) => {
    try {
      const body = req.body || {};
      const createdBy = (req.session && req.session.user && req.session.user.username) || '';
      let customerVersion = body.customerVersion != null ? Number(body.customerVersion) : NaN;
      if (!Number.isFinite(customerVersion) || customerVersion < 1) {
        customerVersion = persist.peekNextCustomerVersion(body.leadId, body.customerEmail || (body.customer && body.customer.email));
      }
      let filenameBase = String(body.filenameBase || '').trim();
      if (!filenameBase && body.customer) {
        const { buildOfferFilenameBase } = require('./email');
        filenameBase = buildOfferFilenameBase(body.customer, body.angebotsnummer, customerVersion);
      }
      const version = await persist.saveOfferVersion({
        ...body,
        customerVersion,
        filenameBase,
        customerEmail: body.customerEmail || (body.customer && body.customer.email) || '',
      }, createdBy);
      res.json({ ok: true, version });
    } catch (err) {
      console.error('[NOORTEC] POST /api/offer/versions:', err.message);
      res.status(400).json({ error: err.message || String(err) });
    }
  });

  app.get('/api/offer/versions/:id', (req, res) => {
    const version = persist.getOfferVersion(req.params.id);
    if (!version) return res.status(404).json({ error: 'nicht gefunden' });
    res.json({ ok: true, version });
  });

  app.get('/api/offer/versions/:id/pdf-file', (req, res) => {
    const version = persist.getOfferVersion(req.params.id);
    const abs = persist.getOfferPdfAbsPath(req.params.id);
    if (!abs || !fs.existsSync(abs)) return res.status(404).json({ error: 'kein PDF' });
    const name = (version && version.filenameBase)
      ? `${version.filenameBase}.pdf`
      : `angebot-${req.params.id}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${name}"`);
    res.sendFile(path.resolve(abs));
  });

  app.get('/api/offer/sent-lead-ids', (_req, res) => {
    try {
      // Pin-Badge nur. Der Status kommt erst von der Ja-Frage nach dem Versand.
      const ids = [...persist.leadIdsWithSentOffers()];
      res.json({ ok: true, leadIds: ids, synced: 0 });
    } catch (err) {
      res.status(400).json({ error: err.message || String(err) });
    }
  });
}

module.exports = { mountLayoutOfferPersistRoutes };
