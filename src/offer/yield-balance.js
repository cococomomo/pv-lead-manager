'use strict';

/**
 * Stundenbilanz: PVGIS-SARAH3 (seriescalc, loss 14 %) + H0 + Speicher.
 * Autarkie und Eigenverbrauch nur aus Direktverbrauch und Entladung.
 * Kein stiller kWp×1050-Ersatz.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const h0Tables = require('./h0-profile.json');

const PVGIS_URL = 'https://re.jrc.ec.europa.eu/api/v5_3/seriescalc';
const LOSS_PCT = 14;
const CACHE_DIR = path.join(__dirname, '../../data/pvgis-cache');
const ETA = Math.sqrt(0.9);
const NEAR_KM = 150;
const MONTH_LABELS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

function mod(n, m) {
  return ((n % m) + m) % m;
}

/** Editor: Ost = 0°, mathematisch gegen den Uhrzeigersinn. PVGIS: Süd = 0, Ost = −90, West = +90. */
function editorAzimuthToPvgis(editorDeg) {
  const compass = mod(90 - Number(editorDeg), 360);
  let aspect = compass - 180;
  aspect = mod(aspect + 180, 360) - 180;
  if (aspect <= -180) aspect = 180;
  return aspect;
}

function dynamise(t) {
  return -3.916649251e-10 * t ** 4
    + 3.2e-7 * t ** 3
    - 7.02e-5 * t ** 2
    + 0.0021 * t
    + 1.24;
}

function isLeap(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function easterSundayUtc(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(year, month - 1, day);
}

function austrianHolidaySet(year) {
  const set = new Set();
  const add = (month, day) => set.add(Date.UTC(year, month - 1, day));
  add(1, 1);
  add(1, 6);
  add(5, 1);
  add(8, 15);
  add(10, 26);
  add(11, 1);
  add(12, 8);
  add(12, 25);
  add(12, 26);
  const easter = easterSundayUtc(year);
  const day = 86400000;
  set.add(easter + day);
  set.add(easter + 39 * day);
  set.add(easter + 50 * day);
  set.add(easter + 60 * day);
  return set;
}

function seasonOf(month, day) {
  const md = month * 100 + day;
  if (md >= 515 && md <= 914) return 'summer';
  if ((md >= 321 && md <= 514) || (md >= 915 && md <= 1031)) return 'transition';
  return 'winter';
}

/** Stündliche H0-Gewichte (BDEW, dynamisiert), Summe 1. Index = Stunde ab 1. Januar. */
function h0HourlyWeights(year) {
  const holidays = austrianHolidaySet(year);
  const weights = [];
  let quarterIndex = 0;
  const days = isLeap(year) ? 366 : 365;
  for (let doy = 0; doy < days; doy += 1) {
    const dt = new Date(Date.UTC(year, 0, 1 + doy));
    const month = dt.getUTCMonth() + 1;
    const day = dt.getUTCDate();
    const season = seasonOf(month, day);
    let bdew = dt.getUTCDay();
    bdew = bdew === 0 ? 7 : bdew;
    if (holidays.has(Date.UTC(year, month - 1, day))) bdew = 7;
    const key = bdew === 6 ? 'sa' : (bdew === 7 ? 'su' : 'wd');
    const quarters = h0Tables[season][key];
    for (let hour = 0; hour < 24; hour += 1) {
      let sum = 0;
      for (let qh = 0; qh < 4; qh += 1) {
        const t = (quarterIndex + 1) / 96;
        sum += quarters[hour * 4 + qh] * dynamise(t);
        quarterIndex += 1;
      }
      weights.push(sum);
    }
  }
  const total = weights.reduce((s, v) => s + v, 0) || 1;
  return weights.map((w) => w / total);
}

function scaleLoad(annualKwh, weights) {
  const year = Math.max(0, Number(annualKwh) || 0);
  return weights.map((w) => year * w);
}

/**
 * Stündlicher Speicher. Nutzbare kWh = Kapazität. Round-Trip 90 %.
 * Leistungslimit = min(WR-AC, 0,5 × Kapazität). Start-SOC 0.
 */
function simulateBattery(pv, load, opts) {
  const capacity = Math.max(0, Number(opts && opts.capacityKwh) || 0);
  const acKw = Number(opts && opts.inverterAcKw);
  const halfCap = 0.5 * capacity;
  const powerLimit = capacity > 0
    ? Math.min(Number.isFinite(acKw) && acKw > 0 ? acKw : halfCap, halfCap)
    : 0;
  let soc = 0;
  let direct = 0;
  let charge = 0;
  let discharge = 0;
  let feedIn = 0;
  let grid = 0;
  let pvSum = 0;
  let loadSum = 0;
  const n = Math.min(pv.length, load.length);
  for (let i = 0; i < n; i += 1) {
    const epv = Math.max(0, Number(pv[i]) || 0);
    const l = Math.max(0, Number(load[i]) || 0);
    const d = Math.min(epv, l);
    const surplus = epv - d;
    const deficit = l - d;
    let chargeFromPv = 0;
    let dischargeToLoad = 0;
    if (capacity > 0 && powerLimit > 0) {
      const room = Math.max(0, (capacity - soc) / ETA);
      chargeFromPv = Math.min(surplus, powerLimit, room);
      soc += chargeFromPv * ETA;
      const deliverable = Math.max(0, soc * ETA);
      dischargeToLoad = Math.min(deficit, powerLimit, deliverable);
      soc -= dischargeToLoad / ETA;
      if (soc < 1e-9) soc = 0;
      if (soc > capacity) soc = capacity;
    }
    direct += d;
    charge += chargeFromPv;
    discharge += dischargeToLoad;
    feedIn += surplus - chargeFromPv;
    grid += deficit - dischargeToLoad;
    pvSum += epv;
    loadSum += l;
  }
  const pvR = Math.round(pvSum);
  const loadR = Math.round(loadSum);
  let directR = Math.round(direct);
  let chargeR = Math.round(charge);
  let dischargeR = Math.round(discharge);
  if (directR + chargeR > pvR) chargeR = Math.max(0, pvR - directR);
  if (directR > pvR) directR = pvR;
  let feedR = pvR - directR - chargeR;
  if (feedR < 0) {
    chargeR = Math.max(0, chargeR + feedR);
    feedR = pvR - directR - chargeR;
  }
  if (directR + dischargeR > loadR) dischargeR = Math.max(0, loadR - directR);
  const gridR = loadR - directR - dischargeR;
  const served = directR + dischargeR;
  return {
    annualYield: pvR,
    household: loadR,
    direct: directR,
    charge: chargeR,
    discharge: dischargeR,
    feedIn: feedR,
    grid: gridR,
    autarky: loadR > 0 ? served / loadR : 0,
    selfConsumption: pvR > 0 ? served / pvR : 0,
  };
}

function cacheKey(lat, lon, tilt, aspect) {
  return [
    Number(lat).toFixed(2),
    Number(lon).toFixed(2),
    String(Math.round(Number(tilt))),
    String(Math.round(Number(aspect))),
    'sarah3',
    String(LOSS_PCT),
  ].join('_');
}

function readIndex() {
  const p = path.join(CACHE_DIR, 'index.json');
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch (_) {
    return [];
  }
}

function writeIndex(entries) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const p = path.join(CACHE_DIR, 'index.json');
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(entries));
  fs.renameSync(tmp, p);
}

function readSeriesFile(key) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, `${key}.json`), 'utf8'));
    if (!data || !Array.isArray(data.p) || !data.p.length) return null;
    return data;
  } catch (_) {
    return null;
  }
}

function writeSeries(entry) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const file = path.join(CACHE_DIR, `${entry.key}.json`);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({
    key: entry.key,
    lat: entry.lat,
    lon: entry.lon,
    tilt: entry.tilt,
    aspect: entry.aspect,
    year: entry.year,
    p: entry.p,
    savedAt: entry.savedAt,
  }));
  fs.renameSync(tmp, file);
  const index = readIndex().filter((e) => e.key !== entry.key);
  index.push({
    key: entry.key,
    lat: entry.lat,
    lon: entry.lon,
    tilt: entry.tilt,
    aspect: entry.aspect,
    year: entry.year,
    savedAt: entry.savedAt,
  });
  writeIndex(index);
}

function haversineKm(aLat, aLon, bLat, bLon) {
  const r = 6371;
  const dLat = deg2rad(bLat - aLat);
  const dLon = deg2rad(bLon - aLon);
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(deg2rad(aLat)) * Math.cos(deg2rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(s)));
}

function deg2rad(d) {
  return (d * Math.PI) / 180;
}

function nearestCache(lat, lon, tilt, aspect) {
  const index = readIndex();
  let best = null;
  for (const meta of index) {
    if (meta.lat == null || meta.lon == null) continue;
    const km = (lat == null || lon == null)
      ? 0
      : haversineKm(lat, lon, meta.lat, meta.lon);
    if (lat != null && km > NEAR_KM) continue;
    const tiltPen = Math.abs(Number(meta.tilt) - Number(tilt)) * 2;
    const aspectPen = Math.abs(Number(meta.aspect) - Number(aspect));
    const score = km + tiltPen + aspectPen * 0.2;
    if (!best || score < best.score) best = { meta, km, score };
  }
  if (!best && lat == null) {
    const latest = index.slice().sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)))[0];
    if (latest) best = { meta: latest, km: null, score: 0 };
  }
  if (!best) return null;
  const series = readSeriesFile(best.meta.key);
  if (!series) return null;
  return { series, km: best.km, meta: best.meta };
}

function fetchJson(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'NOORTEC-PVL/1.0', Accept: 'application/json' },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode !== 200) {
          reject(new Error(`PVGIS HTTP ${res.statusCode}`));
          return;
        }
        try { resolve(JSON.parse(text)); } catch (e) { reject(e); }
      });
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('PVGIS timeout'));
    });
    req.on('error', reject);
  });
}

function parsePvgisTime(s) {
  const m = String(s || '').match(/^(\d{4})(\d{2})(\d{2}):(\d{2})/);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]), hour: Number(m[4]) };
}

async function fetchPvgis(lat, lon, tilt, aspect) {
  const url = new URL(PVGIS_URL);
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lon', String(lon));
  url.searchParams.set('startyear', '2023');
  url.searchParams.set('endyear', '2023');
  url.searchParams.set('pvcalculation', '1');
  url.searchParams.set('peakpower', '1');
  url.searchParams.set('loss', String(LOSS_PCT));
  url.searchParams.set('mountingplace', 'free');
  url.searchParams.set('angle', String(tilt));
  url.searchParams.set('aspect', String(aspect));
  url.searchParams.set('outputformat', 'json');
  url.searchParams.set('browser', '0');
  url.searchParams.set('raddatabase', 'PVGIS-SARAH3');
  const data = await fetchJson(url.toString(), 25000);
  const hourly = data && data.outputs && data.outputs.hourly;
  if (!Array.isArray(hourly) || hourly.length < 8000) throw new Error('PVGIS ohne Stundenreihe');
  const db = data.inputs && data.inputs.meteo_data && data.inputs.meteo_data.radiation_db;
  if (db && String(db).toUpperCase().indexOf('SARAH3') < 0) throw new Error('PVGIS nicht SARAH3');
  const p = hourly.map((row) => Number(row.P) || 0);
  const first = parsePvgisTime(hourly[0].time);
  return {
    p,
    year: first ? first.year : 2023,
    months: hourly.map((row) => {
      const t = parsePvgisTime(row.time);
      return t ? t.month : 1;
    }),
  };
}

async function seriesForGroup(lat, lon, tilt, aspect) {
  const key = (lat != null && lon != null) ? cacheKey(lat, lon, tilt, aspect) : null;
  const exact = key ? readSeriesFile(key) : null;
  if (lat == null || lon == null) {
    const near = nearestCache(null, null, tilt, aspect);
    if (near) {
      return {
        p: near.series.p,
        year: near.series.year,
        months: null,
        source: 'cache-area',
        km: near.km,
      };
    }
    return { error: 'no-site' };
  }
  try {
    const fresh = await fetchPvgis(lat, lon, tilt, aspect);
    writeSeries({
      key,
      lat,
      lon,
      tilt,
      aspect,
      year: fresh.year,
      p: fresh.p,
      savedAt: new Date().toISOString(),
    });
    return { p: fresh.p, year: fresh.year, months: fresh.months, source: 'pvgis' };
  } catch (err) {
    if (exact) return { p: exact.p, year: exact.year, months: null, source: 'cache', km: 0 };
    const near = nearestCache(lat, lon, tilt, aspect);
    if (near) {
      return {
        p: near.series.p,
        year: near.series.year,
        months: null,
        source: 'cache-nearby',
        km: near.km,
      };
    }
    return { error: err.message || 'pvgis' };
  }
}

function monthsFromIndex(year, len) {
  const out = [];
  for (let i = 0; i < len; i += 1) {
    const dt = new Date(Date.UTC(year, 0, 1, i));
    if (dt.getUTCFullYear() !== year) break;
    out.push(dt.getUTCMonth() + 1);
  }
  return out;
}

function averagePoint(points) {
  const pts = (points || []).filter((p) => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)));
  if (!pts.length) return null;
  const lat = pts.reduce((s, p) => s + Number(p.lat), 0) / pts.length;
  const lon = pts.reduce((s, p) => s + Number(p.lng), 0) / pts.length;
  return { lat, lon };
}

function siteFromLayout(plan, layoutRow) {
  const modules = plan && Array.isArray(plan.modules) ? plan.modules : [];
  const fromModules = averagePoint(modules);
  if (fromModules) return { ...fromModules, source: 'layout' };
  const roofs = [];
  if (plan && Array.isArray(plan.roofs)) {
    plan.roofs.forEach((r) => (r.ring || []).forEach((p) => roofs.push(p)));
  }
  if (plan && Array.isArray(plan.roof)) plan.roof.forEach((p) => roofs.push(p));
  const fromRoof = averagePoint(roofs);
  if (fromRoof) return { ...fromRoof, source: 'layout' };
  if (plan && plan.center && plan.center.lat != null && plan.center.lng != null) {
    return { lat: Number(plan.center.lat), lon: Number(plan.center.lng), source: 'layout' };
  }
  if (layoutRow && layoutRow.lat != null && layoutRow.lng != null) {
    return { lat: Number(layoutRow.lat), lon: Number(layoutRow.lng), source: 'layout' };
  }
  return null;
}

function norm360(d) {
  const x = Number(d) % 360;
  return x < 0 ? x + 360 : x;
}

function groupsFromPlan(plan, moduleWp) {
  const modules = plan && Array.isArray(plan.modules) ? plan.modules : [];
  if (!modules.length) return [];
  const wp = Number(moduleWp) > 0 ? Number(moduleWp) : 455;
  const map = new Map();
  modules.forEach((m) => {
    if (!m) return;
    const tilt = Number.isFinite(Number(m.tilt)) ? Number(m.tilt) : 30;
    const editorAz = Number.isFinite(Number(m.facingAzimuth))
      ? Number(m.facingAzimuth)
      : norm360((Number(m.azimuth) || 0) - 90);
    const key = `${tilt.toFixed(1)}|${Math.round(editorAz)}`;
    const prev = map.get(key) || { tilt, editorAzimuth: editorAz, kwp: 0, count: 0 };
    prev.kwp += wp / 1000;
    prev.count += 1;
    map.set(key, prev);
  });
  return [...map.values()];
}

function groupsFromOffer(offer) {
  const cfg = (offer && offer.config) || {};
  const kwp = Number(cfg.kwpCalculated != null ? cfg.kwpCalculated : cfg.kwp) || 0;
  if (!(kwp > 0)) return [];
  const segs = Array.isArray(cfg.dachSegmente) && cfg.dachSegmente.length
    ? cfg.dachSegmente
    : [{ key: cfg.dach, label: cfg.dach, modules: cfg.moduleCount }];
  const totalMods = segs.reduce((s, seg) => s + (Number(seg.modules) || 0), 0);
  const groups = [];
  segs.forEach((seg) => {
    const mods = Number(seg.modules) || 0;
    const share = totalMods > 0 ? (mods > 0 ? mods / totalMods : 0) : (1 / segs.length);
    if (!(share > 0)) return;
    const segKwp = kwp * share;
    const label = `${seg.key || ''} ${seg.label || seg.dach || ''}`.toLowerCase();
    const flat = /flach|freifl/.test(label);
    const eastWest = /ost-?\s*west/.test(label);
    if (eastWest) {
      groups.push({ tilt: 10, editorAzimuth: 0, kwp: segKwp / 2 });
      groups.push({ tilt: 10, editorAzimuth: 180, kwp: segKwp / 2 });
    } else if (flat) {
      groups.push({ tilt: 10, editorAzimuth: 270, kwp: segKwp });
    } else {
      groups.push({ tilt: 30, editorAzimuth: 270, kwp: segKwp });
    }
  });
  return groups;
}

function unavailable(note) {
  return {
    available: false,
    source: 'unavailable',
    note,
    annualYield: 0,
    household: 0,
    direct: 0,
    charge: 0,
    discharge: 0,
    feedIn: 0,
    grid: 0,
    autarky: null,
    selfConsumption: null,
    monthly: MONTH_LABELS.map((month) => ({ month, kwh: 0 })),
  };
}

async function geocodeCustomer(customer) {
  if (!customer) return null;
  const street = String(customer.street || '').trim();
  const zip = String(customer.zip || '').trim();
  const city = String(customer.city || '').trim();
  const q = [street, [zip, city].filter(Boolean).join(' '), 'Österreich'].filter(Boolean).join(', ');
  if (q.replace(/österreich/i, '').trim().length < 3) return null;
  try {
    const url = new URL('https://photon.komoot.io/api/');
    url.searchParams.set('q', q);
    url.searchParams.set('limit', '1');
    url.searchParams.set('lang', 'de');
    const data = await fetchJson(url.toString(), 8000);
    const f = data && data.features && data.features[0];
    const coords = f && f.geometry && f.geometry.coordinates;
    if (!coords || coords.length < 2) return null;
    const lon = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { lat, lon, source: 'address' };
  } catch (_) {
    return null;
  }
}

/**
 * @returns {Promise<object>} balance for computeEconomics
 */
async function computeOfferBalance({ offer, customer, layoutPlan, layoutRow, householdKwh } = {}) {
  const cfg = (offer && offer.config) || {};
  const moduleWp = Number(cfg.moduleWp) || 455;
  let groups = groupsFromPlan(layoutPlan, moduleWp);
  if (!groups.length) groups = groupsFromOffer(offer);
  if (!groups.length) {
    return unavailable('Keine Modulleistung für die Stundenberechnung.');
  }

  let site = siteFromLayout(layoutPlan, layoutRow);
  if (!site) site = await geocodeCustomer(customer);

  const fetched = await Promise.all(groups.map(async (g) => {
    const aspect = editorAzimuthToPvgis(g.editorAzimuth);
    const tilt = Math.max(0, Math.min(90, Number(g.tilt) || 0));
    const series = await seriesForGroup(site && site.lat, site && site.lon, tilt, aspect);
    return { group: g, aspect, tilt, series };
  }));
  if (fetched.some((f) => !f.series || !f.series.p)) {
    return unavailable('Die stündliche Ertragsberechnung (PVGIS-SARAH3) war nicht verfügbar und es liegt kein gespeicherter Datensatz für diese Gegend vor. Es wird kein pauschaler Jahresertrag angesetzt.');
  }

  const year = fetched[0].series.year || 2023;
  const len = fetched[0].series.p.length;
  const pv = new Array(len).fill(0);
  for (const f of fetched) {
    const p = f.series.p;
    const n = Math.min(len, p.length);
    for (let i = 0; i < n; i += 1) {
      pv[i] += (f.group.kwp * p[i]) / 1000;
    }
  }
  const household = Number(householdKwh);
  const annualLoad = Number.isFinite(household) && household > 0 ? household : 4500;
  const weights = h0HourlyWeights(year);
  const alignedWeights = weights.length === len ? weights : h0HourlyWeights(len > 8700 && len < 8800 ? 2023 : year);
  const loadWeights = alignedWeights.length >= len ? alignedWeights.slice(0, len) : alignedWeights;
  while (loadWeights.length < len) loadWeights.push(0);
  const wSum = loadWeights.reduce((s, v) => s + v, 0) || 1;
  const load = loadWeights.map((w) => annualLoad * (w / wSum));

  const sim = simulateBattery(pv, load, {
    capacityKwh: Number(cfg.speicher) || 0,
    inverterAcKw: Number(cfg.inverterKw) || 0,
  });

  const months = fetched[0].series.months && fetched[0].series.months.length === len
    ? fetched[0].series.months
    : monthsFromIndex(year, len);
  const monthKwh = new Array(12).fill(0);
  for (let i = 0; i < len; i += 1) {
    const m = months[i] || 1;
    monthKwh[m - 1] += pv[i];
  }
  const monthly = MONTH_LABELS.map((month, i) => ({ month, kwh: Math.round(monthKwh[i]) }));
  const monthSum = monthly.reduce((s, row) => s + row.kwh, 0);
  if (monthSum !== sim.annualYield && monthly.length) {
    monthly[monthly.length - 1].kwh += sim.annualYield - monthSum;
  }

  const sources = new Set(fetched.map((f) => f.series.source));
  let source = 'pvgis';
  let note = '';
  if (sources.has('cache-area') || !site) {
    source = 'cache-area';
    note = 'Kein Standort aus Belegungsplan oder Adresse. Verwendet wurde der letzte gespeicherte PVGIS-Datensatz dieser Gegend.';
  } else if (sources.has('cache-nearby') || sources.has('cache')) {
    source = sources.has('cache-nearby') ? 'cache-nearby' : 'cache';
    const km = fetched.map((f) => f.series.km).filter((k) => Number.isFinite(k));
    const maxKm = km.length ? Math.max(...km) : 0;
    note = maxKm > 1
      ? `PVGIS war kurz nicht erreichbar. Verwendet wurde der letzte gespeicherte Datensatz dieser Gegend (etwa ${Math.round(maxKm)} km).`
      : 'PVGIS war kurz nicht erreichbar. Verwendet wurde der gespeicherte Datensatz für diesen Standort.';
  }

  return {
    available: true,
    source,
    note,
    site: site || null,
    ...sim,
    monthly,
    lossPct: LOSS_PCT,
    groups: groups.map((g) => ({
      tilt: g.tilt,
      editorAzimuth: g.editorAzimuth,
      pvgisAspect: editorAzimuthToPvgis(g.editorAzimuth),
      kwp: Math.round(g.kwp * 100) / 100,
    })),
  };
}

module.exports = {
  editorAzimuthToPvgis,
  h0HourlyWeights,
  scaleLoad,
  simulateBattery,
  computeOfferBalance,
  groupsFromPlan,
  groupsFromOffer,
  unavailable,
  MONTH_LABELS,
  ETA,
};
