'use strict';

/**
 * Karten-/Geocode-Provider-Registry (erweiterbar).
 * V1 aktiv: basemap.at Orthofoto, Esri World Imagery, OSM + Nominatim.
 * Stubs: Google / Bing / Apple / Custom-Upload (später).
 */

const MAP_PROVIDERS = [
  {
    id: 'basemap_at',
    label: 'basemap.at Orthofoto',
    type: 'raster',
    enabled: true,
    maxZoom: 20, // native; Client kann bis 23 über maxNativeZoom hochskalieren
    // Leaflet URL template (xyz)
    url: 'https://mapsneu.wien.gv.at/basemap/bmaporthofoto30cm/normal/google3857/{z}/{y}/{x}.jpeg',
    attribution: '© basemap.at',
  },
  {
    id: 'esri_world',
    label: 'Esri World Imagery',
    type: 'raster',
    enabled: true,
    maxZoom: 19,
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles © Esri',
  },
  {
    id: 'osm',
    label: 'OpenStreetMap',
    type: 'raster',
    enabled: true,
    maxZoom: 19,
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap',
  },
  {
    id: 'google_sat',
    label: 'Google Satellite (später)',
    type: 'raster',
    enabled: false,
    url: null,
    attribution: 'Google',
  },
  {
    id: 'bing_sat',
    label: 'Bing Aerial (später)',
    type: 'raster',
    enabled: false,
    url: null,
    attribution: 'Bing',
  },
  {
    id: 'apple_maps',
    label: 'Apple Maps (später)',
    type: 'raster',
    enabled: false,
    url: null,
    attribution: 'Apple',
  },
  {
    id: 'custom_upload',
    label: 'Eigenes Luftbild (später)',
    type: 'upload',
    enabled: false,
    url: null,
    attribution: '',
  },
];

const GEOCODE_PROVIDERS = [
  {
    id: 'photon',
    label: 'Photon (Komoot) Autocomplete',
    type: 'geocode',
    enabled: true,
  },
  {
    id: 'nominatim',
    label: 'OpenStreetMap Nominatim',
    type: 'geocode',
    enabled: true,
  },
  {
    id: 'google_geocode',
    label: 'Google Geocoding (später)',
    type: 'geocode',
    enabled: false,
  },
];

/** Österreich-BBox für Photon-Bias (lon,lat). */
const AT_BBOX = '9.48,46.37,17.21,49.02';
const AT_CENTER = { lat: 48.2082, lon: 16.3738 };

/** Modul-Außenmaße (m) für Auto-Layout – näherungsweise Glas-Glas-Module. */
const MODULE_DIMENSIONS = {
  das: { wp: 455, widthM: 1.134, heightM: 1.800, depthMm: 30, label: 'DAS-DH108ND-455' },
  aiko: { wp: 490, widthM: 1.134, heightM: 1.762, depthMm: 30, label: 'Aiko 490 Wp' },
};

function listMapProviders() {
  return MAP_PROVIDERS.map((p) => ({
    id: p.id,
    label: p.label,
    type: p.type,
    enabled: !!p.enabled,
    maxZoom: p.maxZoom || 19,
    url: p.enabled ? p.url : null,
    attribution: p.attribution || '',
  }));
}

function listGeocodeProviders() {
  return GEOCODE_PROVIDERS.map((p) => ({
    id: p.id,
    label: p.label,
    type: p.type,
    enabled: !!p.enabled,
  }));
}

function getMapProvider(id) {
  return MAP_PROVIDERS.find((p) => p.id === id) || null;
}

function getModuleDimensions(moduleType) {
  const key = String(moduleType || 'das').toLowerCase();
  return MODULE_DIMENSIONS[key] || MODULE_DIMENSIONS.das;
}

/** Häufige Orts-Tippfehler / Varianten (AT). */
const PLACE_ALIASES = {
  schwächert: 'Schwechat',
  schwaechert: 'Schwechat',
  swechat: 'Schwechat',
  schwechat: 'Schwechat',
  wien: 'Wien',
  vienna: 'Wien',
  linz: 'Linz',
  graz: 'Graz',
  salzburg: 'Salzburg',
  innsbruck: 'Innsbruck',
  klosterneuburg: 'Klosterneuburg',
  brunn: 'Brunn am Gebirge',
  mödling: 'Mödling',
  moedling: 'Mödling',
  baden: 'Baden',
  stpoelten: 'St. Pölten',
  'st pölten': 'St. Pölten',
  'st. pölten': 'St. Pölten',
};

function foldUmlauts(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss');
}

function levenshtein(a, b) {
  const s = foldUmlauts(a);
  const t = foldUmlauts(b);
  if (s === t) return 0;
  const m = s.length;
  const n = t.length;
  if (!m) return n;
  if (!n) return m;
  const row = new Array(n + 1);
  for (let j = 0; j <= n; j++) row[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = i - 1;
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = row[j];
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return row[n];
}

function similarToken(a, b, maxDist) {
  const fa = foldUmlauts(a);
  const fb = foldUmlauts(b);
  if (!fa || !fb) return false;
  if (fa === fb) return true;
  if (fa.includes(fb) || fb.includes(fa)) return true;
  const max = maxDist != null ? maxDist : (Math.max(fa.length, fb.length) <= 5 ? 1 : 2);
  return levenshtein(fa, fb) <= max;
}

/** Kompaktes Label: „Straße Nr, PLZ Ort“ */
function formatPhotonLabel(p) {
  const street = p.street || '';
  const hn = p.housenumber || '';
  const streetLine = street && hn ? `${street} ${hn}` : (street || p.name || '');
  const place = p.city || p.town || p.village || p.municipality || '';
  const loc = [p.postcode, place].filter(Boolean).join(' ');
  if (streetLine && loc) return `${streetLine}, ${loc}`;
  if (streetLine) return streetLine;
  if (p.name && loc) return `${p.name}, ${loc}`;
  return p.name || loc || '';
}

function formatNominatimLabel(hit, fallback) {
  const a = hit.address || {};
  const road = a.road || a.pedestrian || a.footway || a.path || '';
  const hn = a.house_number || '';
  const streetLine = road && hn ? `${road} ${hn}` : (road || '');
  const place = a.city || a.town || a.village || a.municipality || a.suburb || '';
  const loc = [a.postcode, place].filter(Boolean).join(' ');
  if (streetLine && loc) return `${streetLine}, ${loc}`;
  if (streetLine) return streetLine;
  if (loc) return loc;
  // Nie das lange display_name zurückgeben – kürzen
  const dn = String(hit.display_name || fallback || '');
  const parts = dn.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2) {
    // oft: Nr, Straße, …, PLZ, Land → umbauen
    const maybeHn = /^\d+[a-zA-Z]?$/.test(parts[0]) ? parts[0] : '';
    const maybeStreet = maybeHn ? parts[1] : parts[0];
    const plz = parts.find((p) => /^\d{4}$/.test(p)) || '';
    const ort = parts.find((p, i) => i > 1 && !/^\d{4}$/.test(p) && !/österreich|austria|niederösterreich|wien|bezirk|katastral/i.test(p)) || '';
    const line = maybeHn ? `${maybeStreet} ${maybeHn}` : maybeStreet;
    const shortLoc = [plz, ort].filter(Boolean).join(' ');
    if (line && shortLoc) return `${line}, ${shortLoc}`;
    if (line) return line;
  }
  return parts.slice(0, 2).join(', ') || dn;
}

/**
 * Normalisiert Eingaben: Kommas egal, Str./Strasse → Straße, Orts-Aliases.
 */
function normalizeAddressQuery(query) {
  let s = String(query || '').trim();
  s = s.replace(/[;|]/g, ',').replace(/\s*,\s*/g, ', ').replace(/\s+/g, ' ');
  // Abkürzungen
  s = s.replace(/str\./gi, 'straße');
  s = s.replace(/\bstrasse\b/gi, 'straße');
  s = s.replace(/\bstraße\b/gi, 'straße');
  // „Schumeyer Straße“ / „Schuhmeierstr“ → zusammengeschrieben (Photon matcht besser)
  s = s.replace(/(\S+)\s+straße\b/gi, '$1straße');
  s = s.replace(/(\w)str\b/gi, '$1straße');
  s = s.replace(/(\S+)\s+gasse\b/gi, '$1gasse');
  s = s.replace(/(\S+)\s+weg\b/gi, '$1weg');
  s = s.replace(/(\S+)\s+platz\b/gi, '$1platz');

  // Orts-Aliases / Fuzzy auf letztem Token (nach Komma oder letztes Wort ohne PLZ)
  const aliasKeys = Object.keys(PLACE_ALIASES);
  const replacePlace = (token) => {
    const raw = String(token || '').replace(/[.,]/g, '').trim();
    if (!raw || /^\d{4}$/.test(raw)) return token;
    const folded = foldUmlauts(raw);
    if (PLACE_ALIASES[folded] || PLACE_ALIASES[raw.toLowerCase()]) {
      return PLACE_ALIASES[folded] || PLACE_ALIASES[raw.toLowerCase()];
    }
    for (const key of aliasKeys) {
      if (similarToken(raw, key, key.length <= 6 ? 2 : 3)) return PLACE_ALIASES[key];
    }
    return token;
  };

  // Nach Komma: Ortsteil
  if (s.includes(',')) {
    const bits = s.split(',').map((b) => b.trim()).filter(Boolean);
    if (bits.length >= 2) {
      const last = bits[bits.length - 1];
      const lastParts = last.split(/\s+/);
      // „2320 Schwechat“ oder „Schwechat“
      if (lastParts.length === 1) bits[bits.length - 1] = replacePlace(lastParts[0]);
      else if (lastParts.length >= 2 && /^\d{4}$/.test(lastParts[0])) {
        bits[bits.length - 1] = `${lastParts[0]} ${replacePlace(lastParts.slice(1).join(' '))}`;
      } else {
        bits[bits.length - 1] = lastParts.map(replacePlace).join(' ');
      }
      s = bits.join(', ');
    }
  } else {
    const toks = s.split(/\s+/);
    if (toks.length >= 2) {
      const last = toks[toks.length - 1];
      if (!/^\d+[a-zA-Z]?$/.test(last) && !/^\d{4}$/.test(last)) {
        toks[toks.length - 1] = replacePlace(last);
        s = toks.join(' ');
      }
    }
  }
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Mehrere Suchvarianten: mit/ohne Komma, mit/ohne PLZ, Nr vor/nach Straße.
 */
function expandAddressQueryVariants(query) {
  const raw = String(query || '').trim();
  const norm = normalizeAddressQuery(raw);
  const variants = [];
  const add = (v) => {
    const t = String(v || '').replace(/\s+/g, ' ').trim();
    if (t.length >= 2 && !variants.includes(t)) variants.push(t);
  };
  add(raw);
  add(norm);
  add(norm.replace(/,/g, ' '));
  add(norm.replace(/\s*,\s*/g, ' '));

  // „straße“ ↔ „strasse“
  add(norm.replace(/straße/gi, 'strasse'));
  add(norm.replace(/strasse/gi, 'straße'));

  // Ohne PLZ
  add(norm.replace(/\b\d{4}\b/g, ' ').replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').replace(/^,\s*|,\s*$/g, '').trim());

  // „35 Schuhmeierstraße Schwechat“ → „Schuhmeierstraße 35 Schwechat“
  const noComma = norm.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  const m = noComma.match(/^(\d+[a-zA-Z]?)\s+(.+?)\s+(\d{4}\s+)?(.+)$/);
  if (m) {
    const hn = m[1];
    const mid = m[2];
    const plz = (m[3] || '').trim();
    const place = m[4];
    // mid könnte Straße sein
    if (/straße|strasse|gasse|weg|platz/i.test(mid) || mid.length > 3) {
      add([mid, hn, plz, place].filter(Boolean).join(' '));
      add(`${mid} ${hn}, ${[plz, place].filter(Boolean).join(' ')}`);
    }
  }

  // „Straße 35 Ort“ → „Straße 35, Ort“
  const m2 = noComma.match(/^(.+?)\s+(\d+[a-zA-Z]?)\s+(\d{4}\s+)?(.+)$/);
  if (m2) {
    const street = m2[1];
    const hn = m2[2];
    const plz = (m2[3] || '').trim();
    const place = m2[4];
    add(`${street} ${hn}, ${[plz, place].filter(Boolean).join(' ')}`);
    add(`${street} ${hn} ${[plz, place].filter(Boolean).join(' ')}`);
  }

  return variants.slice(0, 8);
}

function scoreHit(hit, query) {
  const q = foldUmlauts(normalizeAddressQuery(query)).replace(/,/g, ' ');
  const label = foldUmlauts(hit.label || '');
  const qTokens = q.split(/\s+/).filter((t) => t.length > 1);
  let score = 0;
  for (const t of qTokens) {
    if (/^\d{4}$/.test(t)) {
      if (label.includes(t)) score += 4;
      continue;
    }
    if (/^\d+[a-z]?$/.test(t)) {
      // Hausnummer: als eigenes Token im Label
      if (new RegExp(`(?:^|\\s)${t}(?:\\s|,|$)`).test(label)) score += 5;
      continue;
    }
    if (label.includes(t)) score += 3;
    else {
      // Fuzzy gegen Label-Tokens
      const lTokens = label.split(/[\s,]+/);
      if (lTokens.some((lt) => similarToken(t, lt, t.length <= 6 ? 2 : 3))) score += 2;
    }
  }
  // Hausnummer-Treffer bevorzugen
  if (hit.raw && (hit.raw.housenumber || (hit.raw.address && hit.raw.address.house_number))) score += 2;
  if (/\d/.test(hit.label || '')) score += 1;
  return score;
}

function dedupeHits(hits, limit) {
  const seen = new Set();
  const out = [];
  for (const h of hits) {
    const key = `${h.label}|${Number(h.lat).toFixed(5)}|${Number(h.lng).toFixed(5)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label: h.label, lat: h.lat, lng: h.lng, raw: h.raw });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Photon Autocomplete (besser für Straßen/Hausnummern als reines Nominatim-q).
 * @returns {Promise<Array<{label, lat, lng, raw}>>}
 */
async function geocodePhoton(query, { limit = 8, countrycodes = 'at' } = {}) {
  const q = String(query || '').trim();
  if (!q || q.length < 2) return [];
  const url = new URL('https://photon.komoot.io/api/');
  url.searchParams.set('q', q);
  url.searchParams.set('limit', String(Math.min(15, Math.max(limit * 2, 8))));
  url.searchParams.set('lang', 'de');
  url.searchParams.set('lat', String(AT_CENTER.lat));
  url.searchParams.set('lon', String(AT_CENTER.lon));
  url.searchParams.set('bbox', AT_BBOX);

  const res = await fetch(url.toString(), {
    headers: {
      'User-Agent': 'NOORTEC-PV-Lead-Manager/1.0 (office@noortec.at)',
      Accept: 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Photon HTTP ${res.status}`);
  const data = await res.json();
  const features = Array.isArray(data.features) ? data.features : [];

  let mapped = features.map((f) => {
    const p = f.properties || {};
    const coords = (f.geometry && f.geometry.coordinates) || [];
    const lng = Number(coords[0]);
    const lat = Number(coords[1]);
    const cc = String(p.countrycode || '').toUpperCase();
    return {
      label: formatPhotonLabel(p),
      lat,
      lng,
      countrycode: cc,
      raw: p,
    };
  }).filter((h) => Number.isFinite(h.lat) && Number.isFinite(h.lng) && h.label);

  const preferCc = String(countrycodes || '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  if (preferCc.length) {
    const filtered = mapped.filter((h) => preferCc.includes(h.countrycode));
    if (!filtered.length) return [];
    mapped = filtered;
  }

  return dedupeHits(mapped, limit);
}

/**
 * Nominatim-Suche (AT-Fokus). Serverseitig mit User-Agent.
 * @returns {Promise<Array<{label, lat, lng, raw}>>}
 */
async function geocodeNominatim(query, { countrycodes = 'at', limit = 6 } = {}) {
  const q = String(query || '').trim();
  if (!q || q.length < 3) return [];
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', q);
  url.searchParams.set('format', 'json');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('limit', String(limit));
  if (countrycodes) url.searchParams.set('countrycodes', countrycodes);

  const res = await fetch(url.toString(), {
    headers: {
      'User-Agent': 'NOORTEC-PV-Lead-Manager/1.0 (office@noortec.at)',
      Accept: 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  const arr = await res.json();
  if (!Array.isArray(arr)) return [];
  return arr.map((hit) => ({
    label: formatNominatimLabel(hit, q),
    lat: Number(hit.lat),
    lng: Number(hit.lon),
    raw: hit,
  })).filter((h) => Number.isFinite(h.lat) && Number.isFinite(h.lng));
}

/**
 * Autocomplete: Varianten parallel (Photon), Ranking, Nominatim-Fallback.
 */
async function geocodeSearch(query, opts = {}) {
  const limit = opts.limit || 8;
  const countrycodes = opts.countrycodes || 'at';
  const variants = expandAddressQueryVariants(query);
  const collected = [];

  // Parallel, aber max. 4 Varianten
  const batch = variants.slice(0, 4);
  const photonResults = await Promise.all(
    batch.map((v) => geocodePhoton(v, { limit: Math.max(limit, 6), countrycodes }).catch(() => []))
  );
  photonResults.forEach((arr) => collected.push(...arr));

  if (!collected.length) {
    for (const v of batch.slice(0, 2)) {
      try {
        const nom = await geocodeNominatim(v, { countrycodes, limit });
        collected.push(...nom);
        if (collected.length) break;
      } catch (err) {
        console.warn('[NOORTEC] Nominatim geocode:', err.message);
      }
    }
  }

  collected.sort((a, b) => scoreHit(b, query) - scoreHit(a, query));
  return dedupeHits(collected, limit);
}

/**
 * OSM-Hausnummern im Kartenausschnitt (Overpass).
 * @returns {Promise<Array<{lat, lng, number, street}>>}
 */
async function fetchHousenumbers(bbox) {
  const south = Number(bbox.south);
  const west = Number(bbox.west);
  const north = Number(bbox.north);
  const east = Number(bbox.east);
  if (![south, west, north, east].every(Number.isFinite)) {
    throw new Error('Ungültige bbox');
  }
  // Fläche begrenzen (zu große Queries vermeiden)
  const latSpan = Math.abs(north - south);
  const lngSpan = Math.abs(east - west);
  if (latSpan > 0.04 || lngSpan > 0.06) {
    return [];
  }

  const ql = `[out:json][timeout:20];(node["addr:housenumber"](${south},${west},${north},${east});way["addr:housenumber"](${south},${west},${north},${east}););out center tags;`;
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'NOORTEC-PV-Lead-Manager/1.0 (office@noortec.at)',
      Accept: 'application/json',
    },
    body: `data=${encodeURIComponent(ql)}`,
  });
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
  const data = await res.json();
  const elements = Array.isArray(data.elements) ? data.elements : [];
  const out = [];
  const seen = new Set();
  for (const el of elements) {
    const tags = el.tags || {};
    const number = String(tags['addr:housenumber'] || '').trim();
    if (!number) continue;
    const lat = Number(el.lat != null ? el.lat : (el.center && el.center.lat));
    const lng = Number(el.lon != null ? el.lon : (el.center && el.center.lon));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const key = `${number}|${lat.toFixed(5)}|${lng.toFixed(5)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      lat,
      lng,
      number,
      street: String(tags['addr:street'] || '').trim(),
    });
    if (out.length >= 400) break;
  }
  return out;
}

module.exports = {
  MAP_PROVIDERS,
  GEOCODE_PROVIDERS,
  MODULE_DIMENSIONS,
  listMapProviders,
  listGeocodeProviders,
  getMapProvider,
  getModuleDimensions,
  normalizeAddressQuery,
  expandAddressQueryVariants,
  geocodeNominatim,
  geocodePhoton,
  geocodeSearch,
  fetchHousenumbers,
};
