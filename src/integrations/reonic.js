'use strict';

require('../load-env');
const fs = require('fs');
const path = require('path');
const { getProjectRoot } = require('../database');

/** @param {string} s */
function trim(s) {
  return String(s ?? '').trim();
}

function splitNachnameVorname(namen) {
  const raw = trim(namen);
  if (!raw) return { firstName: '-', lastName: '-' };
  if (raw.includes(',')) {
    const [a, b] = raw.split(',').map((x) => trim(x));
    return { lastName: a || '-', firstName: b || '-' };
  }
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return { firstName: '-', lastName: parts[0] };
  return { lastName: parts[0], firstName: parts.slice(1).join(' ') };
}

function splitStrasseUndHausnummer(strasse) {
  const s = trim(strasse);
  if (!s) return { street: '', streetNumber: '' };
  const m = s.match(/^(.*?)[\s,]+(\d+[a-zA-Z\-\/]*)$/);
  if (m) return { street: trim(m[1]) || s, streetNumber: trim(m[2]) };
  return { street: s, streetNumber: '' };
}

function normalizeCountryForApi(land) {
  const l = trim(land).toLowerCase();
  if (!l) return 'Austria';
  const map = {
    österreich: 'Austria',
    oesterreich: 'Austria',
    at: 'Austria',
    deutschland: 'Germany',
    germany: 'Germany',
    de: 'Germany',
    schweiz: 'Switzerland',
    ch: 'Switzerland',
  };
  if (map[l]) return map[l];
  return trim(land) || 'Austria';
}

function buildAuthorizationHeader() {
  const key = trim(process.env.REONIC_API_KEY || '');
  if (!key) return '';
  if (/^(basic|bearer)\s+/i.test(key)) return key;
  const basic = Buffer.from(`${key}:`, 'utf8').toString('base64');
  return `Basic ${basic}`;
}

function getCreateRequestUrl() {
  const override = trim(process.env.REONIC_API_URL || '');
  if (override && /h360\/request\/create/i.test(override)) {
    return override.replace(/\/$/, '');
  }
  const base = trim(process.env.REONIC_API_BASE_URL || '') || 'https://app.reonic.de';
  const clientId = trim(process.env.REONIC_CLIENT_ID || '');
  if (!clientId) return '';
  const b = base.replace(/\/$/, '');
  return `${b}/integrations/${encodeURIComponent(clientId)}/h360/request/create`;
}

function reonicCreateConfigured() {
  return !!(trim(process.env.REONIC_API_KEY || '') && trim(process.env.REONIC_CLIENT_ID || '') && getCreateRequestUrl());
}

/**
 * Request-Body laut REONIC REST „Create Request“ (latLng XOR addressToGeocode).
 * @param {object} row — SQLite-Zeile `leads`
 */
function buildH360CreateRequestBody(row) {
  const { firstName, lastName } = splitNachnameVorname(row.namen);
  const { street, streetNumber } = splitStrasseUndHausnummer(row.strasse);
  const lat = row.latitude != null && Number.isFinite(Number(row.latitude)) ? Number(row.latitude) : null;
  const lng = row.longitude != null && Number.isFinite(Number(row.longitude)) ? Number(row.longitude) : null;
  const hasCoords = lat != null && lng != null && !(lat === 0 && lng === 0);

  const info = trim(row.info);
  const notizen = trim(row.notizen);
  const quelle = trim(row.quelle);
  const anfrage = trim(row.anfrage);
  const noteParts = [
    info ? `Kundenanfrage (Info):\n${info}` : null,
    notizen ? `Notizen:\n${notizen}` : null,
    quelle ? `Quelle: ${quelle}` : null,
    anfrage ? `Anfrage-Nr.: ${anfrage}` : null,
  ].filter(Boolean);
  const note = noteParts.join('\n\n') || 'Lead aus NOORTEC Vertriebs-Dashboard';

  const body = {
    firstName,
    lastName,
    email: trim(row.email) || undefined,
    phone: trim(row.telefon) || undefined,
    country: normalizeCountryForApi(row.land),
    postcode: trim(row.plz) || undefined,
    city: trim(row.ort) || undefined,
    street: street || undefined,
    streetNumber: streetNumber || undefined,
    message: info ? info.slice(0, 2000) : 'PV-Anfrage (NOORTEC)',
    note: note.slice(0, 8000),
    leadSourceName: 'NOORTEC Vertriebs-Dashboard',
  };

  if (hasCoords) {
    body.latLng = { lat, lng };
  } else {
    body.addressToGeocode = {
      country: body.country,
      postcode: body.postcode || '',
      city: body.city || '',
      street: body.street || '',
      streetNumber: body.streetNumber || '',
    };
  }

  return body;
}

function logIntegrationError(payload) {
  const root = getProjectRoot();
  const dir = path.join(root, 'data');
  fs.mkdirSync(dir, { recursive: true });
  const line = `${JSON.stringify({ ts: new Date().toISOString(), integration: 'reonic', ...payload })}\n`;
  fs.appendFileSync(path.join(dir, 'integration_errors.log'), line, 'utf8');
}

/**
 * POST /integrations/{clientId}/h360/request/create
 * @param {object} row — SQLite `leads`-Zeile
 * @returns {Promise<{ ok: true, status: number } | { ok: false, status: number, error: string }>}
 */
async function postReonicH360CreateRequest(row) {
  const url = getCreateRequestUrl();
  const auth = buildAuthorizationHeader();
  if (!url || !auth) {
    return { ok: false, status: 0, error: 'REONIC nicht konfiguriert (REONIC_CLIENT_ID / REONIC_API_KEY / Basis-URL)' };
  }

  const body = buildH360CreateRequestBody(row);
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'X-Authorization': auth,
    'User-Agent': 'NOORTEC-pv-lead-manager/reonic-integration',
  };

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  } catch (e) {
    const msg = (e && e.message) ? String(e.message) : String(e);
    logIntegrationError({ phase: 'fetch', error: msg, leadId: row.id });
    return { ok: false, status: 0, error: msg };
  }

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    const err = `HTTP ${res.status}: ${t.slice(0, 1200)}`;
    logIntegrationError({
      phase: 'response',
      status: res.status,
      error: err,
      leadId: row.id,
      email: trim(row.email),
    });
    return { ok: false, status: res.status, error: err };
  }

  return { ok: true, status: res.status };
}

module.exports = {
  reonicCreateConfigured,
  buildH360CreateRequestBody,
  postReonicH360CreateRequest,
  getCreateRequestUrl,
  logIntegrationError,
};
