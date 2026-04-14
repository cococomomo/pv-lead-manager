'use strict';

/**
 * Einmal Nominatim (OSM) — nur mit User-Agent (Nutzungsbedingungen).
 * @returns {{ lat: number, lon: number } | null}
 */
async function geocodeNominatimOnce(query) {
  const q = String(query || '').trim();
  if (!q) return null;
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1&countrycodes=at`;
  const res = await fetch(url, {
    headers: {
      'Accept-Language': 'de',
      'User-Agent': 'pv-lead-manager/1.0 (https://github.com/cococomomo/pv-lead-manager)',
    },
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => []);
  const hit = Array.isArray(data) && data[0];
  if (!hit || hit.lat == null || hit.lon == null) return null;
  const lat = parseFloat(hit.lat);
  const lon = parseFloat(hit.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

module.exports = { geocodeNominatimOnce };
