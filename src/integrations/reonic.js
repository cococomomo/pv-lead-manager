'use strict';

/**
 * Reonic REST API v2 — Basis: `https://api.reonic.de/rest/v2`
 * Authentifizierung: Header `x-authorization` (Wert in der Regel `Basic <Base64>`), siehe `.env.example`.
 *
 * In dieser App umgesetzt:
 *   POST `/rest/v2/clients/{clientId}/h360/offers` — Lead als Angebot übermitteln (`postReonicRestV2Offer`).
 * Optionaler Verbindungstest: `testReonicRestV2Connection` gegen dieselbe Offer-URL.
 *
 * In der Reonic-OpenAPI-Dokumentation zusätzlich vorhanden, hier nicht angebunden:
 *   Kontakte (`/clients/{clientId}/contacts`), Aktivitäten (`/activities/status`), …
 *
 * Legacy (falls per ENV): H360 `POST …/integrations/{clientId}/h360/request/create` auf `app.reonic.de`.
 */
require('../load-env');
const fs = require('fs');
const path = require('path');
const { getProjectRoot } = require('../database');

/** @param {string} s */
function trim(s) {
  return String(s ?? '').trim();
}

const { splitNachnameVorname: splitLeadName } = require('../offer/names');

function splitNachnameVorname(namen) {
  const { vorname, nachname } = splitLeadName(namen);
  return {
    firstName: vorname || '-',
    lastName: nachname || '-',
  };
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

// ── REST API v2: POST /rest/v2/clients/{clientId}/offers ───────────────────

function getRestV2ApiBase() {
  const b = trim(process.env.REONIC_REST_API_BASE || '') || 'https://api.reonic.de';
  return b.replace(/\/$/, '');
}

function getRestV2ClientId() {
  return trim(process.env.REONIC_REST_CLIENT_ID || '') || '6a8ea480-3152-49f9-aa1a-2c87d21774a0';
}

/**
 * REONIC_API_KEY aus .env: häufig mit Windows-\r, Anführungszeichen oder Leerzeichen am Ende.
 * Optional: REONIC_V2_KEY als Alias.
 * Reonic erwartet im Header `x-authorization` oft den vollen Wert inkl. `Basic …` (Base64).
 * Wurde nur die Base64-Kette ohne Präfix eingetragen, setzen wir `Basic ` davor.
 */
function normalizeReonicRestV2ApiKeyFromEnv() {
  let k = trim(process.env.REONIC_API_KEY || process.env.REONIC_V2_KEY || '');
  k = k.replace(/\r/g, '');
  if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) {
    k = k.slice(1, -1);
  }
  return trim(k);
}

function looksLikeBase64TokenWithoutPrefix(s) {
  const t = trim(s);
  if (t.length < 32 || /\s/.test(t)) return false;
  return /^[A-Za-z0-9+/]+=*$/.test(t);
}

/** Wert für Header `x-authorization` / `X-Authorization` (REST v2). */
function buildRestV2XAuthorizationHeader() {
  const key = normalizeReonicRestV2ApiKeyFromEnv();
  if (!key) return '';
  if (/^(basic|bearer)\s+/i.test(key)) return key;
  if (looksLikeBase64TokenWithoutPrefix(key)) return `Basic ${key}`;
  return key;
}

/** Gemeinsame Auth-Header (manche Proxys/Gateways lesen nur `Authorization`). */
function reonicRestV2AuthHeaders() {
  const auth = buildRestV2XAuthorizationHeader();
  if (!auth) return null;
  return {
    Accept: 'application/json',
    'x-authorization': auth,
    'X-Authorization': auth,
    Authorization: auth,
  };
}

function reonicV2OffersConfigured() {
  return !!(normalizeReonicRestV2ApiKeyFromEnv() && getRestV2ClientId());
}

function getRestV2OffersPostUrl() {
  const cid = getRestV2ClientId();
  if (!cid) return '';
  /** Reonic REST: Angebote unter `h360`-Pfad (ohne `h360` liefert die API 404 „Cannot POST …/offers“). */
  return `${getRestV2ApiBase()}/rest/v2/clients/${encodeURIComponent(cid)}/h360/offers`;
}

function buildFullAddressLine(streetLine, zipCode, city, country) {
  const parts = [streetLine, zipCode, city, country].filter((x) => trim(x));
  return parts.length ? parts.join(', ') : '';
}

/**
 * Freitext für Reonic: alle Kontext-Felder, damit Reonic intern mappen kann.
 * @param {object} row — SQLite-Zeile `leads`
 */
function buildLeadNotesFreetext(row) {
  const lines = [];
  const push = (label, val) => {
    const v = trim(val);
    if (v) lines.push(`${label}: ${v}`);
  };
  push('Info', row.info);
  push('Notizen', row.notizen);
  push('Quelle', row.quelle);
  push('Anfrage-Nr.', row.anfrage);
  push('Betreuer', row.betreuer);
  push('Status', row.status);
  push('Termin', row.termin);
  push('Termintyp', row.termin_typ);
  push('Meet-Link', row.meet_link);
  push('Nachfass bis', row.nachfass_bis);
  if (row.latitude != null && row.longitude != null
    && Number.isFinite(Number(row.latitude)) && Number.isFinite(Number(row.longitude))) {
    lines.push(`Koordinaten: ${row.latitude}, ${row.longitude}`);
  }
  return lines.join('\n').trim() || 'Lead aus NOORTEC Vertriebs-Dashboard';
}

/**
 * Native Mapping bei Reonic: Stammdaten + strukturierte Adresse + `notes` als Freitext.
 * @param {object} row — SQLite-Zeile `leads`
 */
function buildRestV2OfferBody(row) {
  const { firstName, lastName } = splitNachnameVorname(row.namen);
  const { street, streetNumber } = splitStrasseUndHausnummer(row.strasse);
  const streetLine = [street, streetNumber].filter(Boolean).join(' ').trim();
  const zipCode = trim(row.plz) || undefined;
  const city = trim(row.ort) || undefined;
  const country = normalizeCountryForApi(row.land);
  const fullAddress = buildFullAddressLine(streetLine, zipCode, city, country);

  const info = trim(row.info);
  const notes = buildLeadNotesFreetext(row);

  const lat = row.latitude != null && Number.isFinite(Number(row.latitude)) ? Number(row.latitude) : null;
  const lng = row.longitude != null && Number.isFinite(Number(row.longitude)) ? Number(row.longitude) : null;
  const hasCoords = lat != null && lng != null && !(lat === 0 && lng === 0);

  const body = {
    firstName,
    lastName,
    email: trim(row.email) || undefined,
    phone: trim(row.telefon) || undefined,
    street: streetLine || undefined,
    streetNumber: streetNumber || undefined,
    zipCode,
    postcode: zipCode,
    city,
    country,
    address: fullAddress || undefined,
    notes: notes.slice(0, 32000),
    message: info ? info.slice(0, 2000) : 'PV-Anfrage (NOORTEC Vertriebs-Dashboard)',
    leadSourceName: 'NOORTEC Vertriebs-Dashboard',
  };

  if (hasCoords) {
    body.latLng = { lat, lng };
  } else if (streetLine || zipCode || city) {
    body.addressToGeocode = {
      country,
      postcode: zipCode || '',
      city: city || '',
      street: street || '',
      streetNumber: streetNumber || '',
    };
  }

  return body;
}

function extractReonicIdFromResponseJson(j) {
  if (!j || typeof j !== 'object') return '';
  const o = j;
  const cand = o.id ?? o.offerId ?? (o.data && o.data.id) ?? (o.result && o.result.id);
  if (cand == null) return '';
  const s = String(cand).trim();
  return s.length > 512 ? s.slice(0, 512) : s;
}

/**
 * POST https://api.reonic.de/rest/v2/clients/{clientId}/offers
 * @param {object} row — SQLite `leads`-Zeile
 */
async function postReonicRestV2Offer(row) {
  const url = getRestV2OffersPostUrl();
  const auth = buildRestV2XAuthorizationHeader();
  if (!url || !auth) {
    return { ok: false, status: 0, error: 'REONIC REST v2 nicht konfiguriert (REONIC_API_KEY)' };
  }

  const body = buildRestV2OfferBody(row);
  const headers = {
    ...reonicRestV2AuthHeaders(),
    'Content-Type': 'application/json',
    'User-Agent': 'NOORTEC-pv-lead-manager/reonic-rest-v2',
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
    logIntegrationError({ phase: 'fetch_v2_offers', error: msg, leadId: row.id });
    return { ok: false, status: 0, error: msg };
  }

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    const err = `HTTP ${res.status}: ${t.slice(0, 1200)}`;
    logIntegrationError({
      phase: 'response_v2_offers',
      status: res.status,
      error: err,
      leadId: row.id,
      email: trim(row.email),
    });
    return { ok: false, status: res.status, error: err };
  }

  let reonicId = '';
  const ct = String(res.headers.get('content-type') || '');
  if (ct.includes('application/json')) {
    const j = await res.json().catch(() => null);
    reonicId = extractReonicIdFromResponseJson(j);
  } else {
    await res.text().catch(() => '');
  }

  return { ok: true, status: res.status, reonicId };
}

/**
 * Prüft TLS, Basis-URL und API-Key (ohne Lead anzulegen): GET/HEAD auf die Offers-URL.
 * @returns {Promise<{ ok: true, message: string } | { ok: false, error: string }>}
 */
async function testReonicRestV2Connection() {
  if (!reonicV2OffersConfigured()) {
    return { ok: false, error: 'REONIC nicht konfiguriert (REONIC_API_KEY / REONIC_REST_CLIENT_ID)' };
  }
  const url = getRestV2OffersPostUrl();
  const auth = buildRestV2XAuthorizationHeader();
  if (!url || !auth) {
    return { ok: false, error: 'REONIC REST v2 nicht konfiguriert (REONIC_API_KEY)' };
  }
  const headers = {
    ...reonicRestV2AuthHeaders(),
    'User-Agent': 'NOORTEC-pv-lead-manager/reonic-test',
  };
  async function doFetch(method) {
    try {
      return await fetch(url, { method, headers });
    } catch (e) {
      const msg = (e && e.message) ? String(e.message) : String(e);
      return { __err: msg };
    }
  }
  let res = await doFetch('GET');
  if (res && res.__err) {
    return { ok: false, error: res.__err };
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, error: 'Fehler: API-Key prüfen (HTTP ' + res.status + ')' };
  }
  if (res.status === 405) {
    return { ok: true, message: 'Verbindung OK' };
  }
  if (res.status === 404) {
    const res2 = await doFetch('HEAD');
    if (res2 && res2.__err) {
      return { ok: false, error: res2.__err };
    }
    if (res2.status === 401 || res2.status === 403) {
      return { ok: false, error: 'Fehler: API-Key prüfen (HTTP ' + res2.status + ')' };
    }
    if (res2.status === 405 || res2.status === 200 || res2.status === 204) {
      return { ok: true, message: 'Verbindung OK' };
    }
    return { ok: false, error: 'Fehler: Endpoint nicht gefunden (Client-ID oder REONIC_REST_API_BASE prüfen)' };
  }
  if (res.status >= 200 && res.status < 500) {
    return { ok: true, message: 'Verbindung OK' };
  }
  const t = await res.text().catch(() => '');
  return { ok: false, error: 'Fehler: HTTP ' + res.status + ' — ' + t.slice(0, 200) };
}

module.exports = {
  reonicCreateConfigured,
  buildH360CreateRequestBody,
  postReonicH360CreateRequest,
  getCreateRequestUrl,
  logIntegrationError,
  reonicV2OffersConfigured,
  buildRestV2OfferBody,
  postReonicRestV2Offer,
  getRestV2OffersPostUrl,
  testReonicRestV2Connection,
};
