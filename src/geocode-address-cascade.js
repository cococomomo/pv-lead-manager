'use strict';

const { geocodeNominatimOnce } = require('./geocode-nominatim');

const NOMINATIM_DELAY_MS = 1500;

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Nominatim-Kaskade (Österreich): Straße nur als Haus/Gebäude, sonst PLZ+Ort oder nur PLZ.
 * Ohne jeden Treffer bleiben lat/lon null (kein festes Wien-Zentrum).
 * @param {{ strasse?: string, plz?: string, ort?: string }} parts
 * @param {{ lookup?: Function, delay?: Function }} [deps] nur für Tests
 * @returns {Promise<{ lat: number|null, lon: number|null, label: string, nominatimHit: boolean }>}
 */
async function geocodeAddressCascade(parts, deps) {
  const strasse = String(parts.strasse || '').trim();
  const plz = String(parts.plz || '').trim();
  const ort = String(parts.ort || '').trim();
  const region = 'Österreich';
  const lookup = (deps && deps.lookup) || geocodeNominatimOnce;
  const wait = (deps && deps.delay) || delay;

  if (strasse) {
    const qA = `${strasse}, ${plz} ${ort}, ${region}`.replace(/\s+/g, ' ').replace(/ ,/g, ',').trim();
    await wait(NOMINATIM_DELAY_MS);
    const hitA = await lookup(qA, { preciseOnly: true });
    if (hitA && hitA.lat != null && hitA.lon != null) {
      return { lat: hitA.lat, lon: hitA.lon, label: 'Exakte Adresse geocodiert', nominatimHit: true };
    }
  }

  if (plz || ort) {
    const qB = `${[plz, ort].filter(Boolean).join(' ')}, ${region}`.replace(/\s+/g, ' ').trim();
    await wait(NOMINATIM_DELAY_MS);
    const hitB = await lookup(qB, { preciseOnly: false });
    if (hitB && hitB.lat != null && hitB.lon != null) {
      const label = strasse
        ? 'Fallback PLZ/Ort geocodiert'
        : (ort ? 'Fallback Stadtzentrum geocodiert' : 'Fallback PLZ geocodiert');
      return { lat: hitB.lat, lon: hitB.lon, label, nominatimHit: true };
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
