'use strict';

const COARSE_TYPES = new Set([
  'postcode',
  'postal_code',
  'administrative',
  'city',
  'town',
  'village',
  'municipality',
  'county',
  'state',
  'country',
  'suburb',
  'neighbourhood',
  'quarter',
  'borough',
  'district',
]);

const HOUSE_TYPES = new Set(['house', 'building', 'residential', 'apartments', 'address', 'yes']);

function isCoarseGeocodeHit(hit) {
  if (!hit) return true;
  const type = String(hit.type || '').toLowerCase();
  const addresstype = String(hit.addresstype || '').toLowerCase();
  const className = String(hit.className || hit.class || '').toLowerCase();
  if (COARSE_TYPES.has(type) || COARSE_TYPES.has(addresstype)) return true;
  if (className === 'boundary' && (type === 'postal_code' || type === 'administrative' || addresstype === 'postcode')) {
    return true;
  }
  return false;
}

/**
 * @param {Array<object>} rawHits Nominatim-JSON
 * @param {{ preciseOnly?: boolean }} [opts]
 * Haus/Gebäude vor einem POI. Bei preciseOnly kein PLZ- oder Orts-Treffer.
 */
function chooseNominatimHit(rawHits, opts) {
  const hits = [];
  for (const h of rawHits || []) {
    if (!h) continue;
    const lat = parseFloat(h.lat);
    const lon = parseFloat(h.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    hits.push({
      lat,
      lon,
      type: String(h.type || '').toLowerCase(),
      addresstype: String(h.addresstype || '').toLowerCase(),
      className: String(h.class || h.className || '').toLowerCase(),
    });
  }
  const preciseOnly = !!(opts && opts.preciseOnly);
  const pool = preciseOnly ? hits.filter((h) => !isCoarseGeocodeHit(h)) : hits;
  if (!pool.length) return null;
  const house = pool.find((h) => (
    HOUSE_TYPES.has(h.type)
    || HOUSE_TYPES.has(h.addresstype)
    || h.className === 'building'
  ));
  return house || pool[0];
}

/**
 * Einmal Nominatim (OSM) — nur mit User-Agent (Nutzungsbedingungen).
 * @param {string} query
 * @param {{ preciseOnly?: boolean }} [opts]
 * @returns {Promise<{ lat: number, lon: number, type?: string, addresstype?: string, className?: string } | null>}
 */
async function geocodeNominatimOnce(query, opts) {
  const q = String(query || '').trim();
  if (!q) return null;
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=5&countrycodes=at`;
  const res = await fetch(url, {
    headers: {
      'Accept-Language': 'de',
      'User-Agent': 'pv-lead-manager/1.0 (https://github.com/cococomomo/pv-lead-manager)',
    },
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => []);
  if (!Array.isArray(data)) return null;
  return chooseNominatimHit(data, opts);
}

module.exports = {
  geocodeNominatimOnce,
  chooseNominatimHit,
  isCoarseGeocodeHit,
};
