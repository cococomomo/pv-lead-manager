'use strict';

const { geocodeNominatimOnce } = require('./geocode-nominatim');

const NOMINATIM_DELAY_MS = 1500;

const WIEN_ZENTRUM_1 = { lat: 48.2082, lon: 16.3738 };

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Nominatim-Kaskade (Österreich): volle Adresse → PLZ+Ort → Wien-Fix.
 * @param {{ strasse?: string, plz?: string, ort?: string }} parts — bereits getrimmte Strings
 * @returns {Promise<{ lat: number, lon: number, label: string, nominatimHit: boolean }>}
 *   `nominatimHit` false, wenn nur Wien-Fallback ohne Treffer aus der API.
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
    lat: WIEN_ZENTRUM_1.lat,
    lon: WIEN_ZENTRUM_1.lon,
    label: 'Fallback Wien-Zentrum (fixe Koordinaten Stephansplatz-Nähe)',
    nominatimHit: false,
  };
}

module.exports = { geocodeAddressCascade, WIEN_ZENTRUM_1, NOMINATIM_DELAY_MS };
