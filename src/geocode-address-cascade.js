'use strict';

const { geocodeNominatimOnce } = require('./geocode-nominatim');

const NOMINATIM_DELAY_MS = 1500;

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Nominatim-Kaskade (Österreich): volle Adresse → PLZ+Ort.
 * Ohne Treffer: lat/lon bleiben null (kein städtischer Fallback).
 * @param {{ strasse?: string, plz?: string, ort?: string }} parts — bereits getrimmte Strings
 * @returns {Promise<{ lat: number|null, lon: number|null, label: string, nominatimHit: boolean }>}
 */
async function geocodeAddressCascade(parts) {
  const strasse = String(parts.strasse || '').trim();
  const plz = String(parts.plz || '').trim();
  const ort = String(parts.ort || '').trim();
  const region = 'Österreich';

  if (strasse) {
    const qA = `${strasse}, ${plz} ${ort}, ${region}`.replace(/\s+/g, ' ').replace(/ ,/g, ',').trim();
    await delay(NOMINATIM_DELAY_MS);
    const hitA = await geocodeNominatimOnce(qA);
    if (hitA) {
      return { lat: hitA.lat, lon: hitA.lon, label: 'Exakte Adresse geocodiert', nominatimHit: true };
    }
  }

  if (ort) {
    const qB = `${plz} ${ort}, ${region}`.replace(/\s+/g, ' ').trim();
    await delay(NOMINATIM_DELAY_MS);
    const hitB = await geocodeNominatimOnce(qB);
    if (hitB) {
      return { lat: hitB.lat, lon: hitB.lon, label: 'Fallback Stadtzentrum geocodiert', nominatimHit: true };
    }
  }

  return {
    lat: null,
    lon: null,
    label: 'Kein Nominatim-Treffer — keine Koordinaten gesetzt',
    nominatimHit: false,
  };
}

module.exports = { geocodeAddressCascade, NOMINATIM_DELAY_MS };
