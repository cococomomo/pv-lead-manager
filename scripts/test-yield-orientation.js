#!/usr/bin/env node
/**
 * Ausrichtung der Stundenbilanz: Hangseite des Belegungsplans, gradgenau, inkl. Nord.
 * Run: node scripts/test-yield-orientation.js
 */
'use strict';

const https = require('https');
const {
  editorAzimuthToPvgis,
  groupsFromPlan,
  groupsFromOffer,
  selectYieldGroups,
  simulateBattery,
  FALLBACK_ORIENTATION_NOTE,
} = require('../src/offer/yield-balance');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed += 1;
    console.log('  ok  ', msg);
  } else {
    failed += 1;
    console.error('  FAIL', msg);
  }
}

function approx(a, b, eps) {
  return Math.abs(Number(a) - Number(b)) < (eps != null ? eps : 1e-6);
}

function aspectOf(plan) {
  const groups = groupsFromPlan(plan, 455);
  if (groups.length !== 1) return { groups, aspect: null, tilt: null };
  return {
    groups,
    aspect: editorAzimuthToPvgis(groups[0].editorAzimuth),
    tilt: groups[0].tilt,
    kwp: groups[0].kwp,
  };
}

function isNorth(aspect) {
  return Math.abs(Math.abs(aspect) - 180) < 1;
}

/** Quadrat um Ebenfurth. Erste Kante = Traufe, Innenraum auf der Firstseite. */
function squareRoof(edge, interior) {
  const lat0 = 47.8779;
  const lng0 = 16.3678;
  const mLat = 1 / 111320;
  const mLng = 1 / (111320 * Math.cos((lat0 * Math.PI) / 180));
  const half = 20;
  const east = { dLat: 0, dLng: half * mLng };
  const north = { dLat: half * mLat, dLng: 0 };
  const dirs = {
    east,
    west: { dLat: -east.dLat, dLng: -east.dLng },
    north,
    south: { dLat: -north.dLat, dLng: -north.dLng },
  };
  const along = dirs[edge.along];
  const inward = dirs[interior];
  const origin = {
    lat: lat0 - inward.dLat / 2 - along.dLat / 2,
    lng: lng0 - inward.dLng / 2 - along.dLng / 2,
  };
  const p1 = { lat: origin.lat + along.dLat, lng: origin.lng + along.dLng };
  const p2 = { lat: p1.lat + inward.dLat, lng: p1.lng + inward.dLng };
  const p3 = { lat: origin.lat + inward.dLat, lng: origin.lng + inward.dLng };
  const ring = [origin, p1, p2, p3];
  const center = {
    lat: ring.reduce((s, p) => s + p.lat, 0) / 4,
    lng: ring.reduce((s, p) => s + p.lng, 0) / 4,
  };
  return { ring, center, edgeAngleDeg: edge.azimuth };
}

function planWith({ edge, interior, tilt, count, extra }) {
  const roof = squareRoof(edge, interior);
  const n = count || 1;
  const modules = [];
  for (let i = 0; i < n; i += 1) {
    modules.push({
      lat: roof.center.lat,
      lng: roof.center.lng,
      azimuth: roof.edgeAngleDeg,
      tilt,
      physWidthM: 1.134,
      physHeightM: 1.8,
      widthM: 1.134,
      heightM: 1.8 * Math.cos(((tilt == null ? 30 : tilt) * Math.PI) / 180),
      ...(extra || {}),
    });
  }
  return {
    meta: { tilt: 30 },
    roofs: [{ ring: roof.ring, tilt: tilt == null ? 30 : tilt, edgeAngleDeg: roof.edgeAngleDeg }],
    modules,
  };
}

console.log('cardinal downslope → PVGIS aspect');
{
  const south = aspectOf(planWith({
    edge: { along: 'east', azimuth: 0 },
    interior: 'north',
    tilt: 30,
  }));
  assert(approx(south.aspect, 0, 1), `south eave, downslope south, tilt 30 → aspect 0 (got ${south.aspect})`);
  assert(approx(south.tilt, 30, 0.01), `tilt stays 30° (got ${south.tilt})`);

  const southMirrored = aspectOf(planWith({
    edge: { along: 'west', azimuth: 180 },
    interior: 'north',
    tilt: 30,
  }));
  assert(approx(southMirrored.aspect, 0, 1), `eave drawn the other way still faces south (got ${southMirrored.aspect})`);
  const oldMirror = editorAzimuthToPvgis(180 - 90);
  assert(isNorth(oldMirror), 'old eave-minus-90 on that draw points north');
  assert(!isNorth(southMirrored.aspect), 'yield does not keep that mirror');

  const north = aspectOf(planWith({
    edge: { along: 'east', azimuth: 0 },
    interior: 'south',
    tilt: 30,
  }));
  assert(isNorth(north.aspect), `north stays ±180 (got ${north.aspect})`);
  assert(north.aspect !== 0, 'north is not flipped to south');

  const east = aspectOf(planWith({
    edge: { along: 'north', azimuth: 90 },
    interior: 'west',
    tilt: 30,
  }));
  assert(approx(east.aspect, -90, 1), `east → −90 (got ${east.aspect})`);

  const west = aspectOf(planWith({
    edge: { along: 'north', azimuth: 90 },
    interior: 'east',
    tilt: 30,
  }));
  assert(approx(west.aspect, 90, 1), `west → +90 (got ${west.aspect})`);
}

console.log('19.11 kWp south 30° is not the west-60° result');
{
  const plan = planWith({
    edge: { along: 'east', azimuth: 0 },
    interior: 'north',
    tilt: 30,
    count: 42,
  });
  const row = aspectOf(plan);
  assert(row.groups.length === 1, 'one orientation group');
  assert(approx(row.kwp, 19.11, 0.02), `42 × 455 Wp = 19.11 kWp (got ${row.kwp})`);
  assert(approx(row.aspect, 0, 1) && approx(row.tilt, 30, 0.01), 'parameters are south 30°, not west 60°');
  const west60Kwh = 19.11 * 804;
  assert(Math.abs(west60Kwh - 15323) < 400, 'west 60° is the ~15,300 kWh failure');
  assert(!(Math.abs(row.aspect - 90) < 5 && Math.abs(row.tilt - 60) < 5), 'group is not west 60°');
}

console.log('not snapped to a cardinal, not coarser than 1°');
{
  const base = squareRoof({ along: 'east', azimuth: 0 }, 'north');
  const lat0 = base.center.lat;
  const lng0 = base.center.lng;
  const mLat = 1 / 111320;
  const mLng = 1 / (111320 * Math.cos((lat0 * Math.PI) / 180));
  const rot = 15 * Math.PI / 180;
  const ring = base.ring.map((p) => {
    const x = (p.lng - lng0) / mLng;
    const y = (p.lat - lat0) / mLat;
    const xr = x * Math.cos(rot) - y * Math.sin(rot);
    const yr = x * Math.sin(rot) + y * Math.cos(rot);
    return { lat: lat0 + yr * mLat, lng: lng0 + xr * mLng };
  });
  const plan = {
    meta: { tilt: 30 },
    roofs: [{ ring, tilt: 30, edgeAngleDeg: 15 }],
    modules: [{
      lat: lat0,
      lng: lng0,
      azimuth: 15,
      tilt: 30,
    }],
  };
  const row = aspectOf(plan);
  assert(Math.abs(row.aspect - (-15)) < 1, `15° off south stays about −15° (got ${row.aspect})`);
  assert(Math.abs(row.aspect) > 5, 'not snapped to south');
}

console.log('tilt is the roof pitch, not the map size and not doubled');
{
  const roof = squareRoof({ along: 'east', azimuth: 0 }, 'north');
  const plan = {
    meta: { tilt: 30 },
    roofs: [{ ring: roof.ring, tilt: 25, edgeAngleDeg: 0 }],
    modules: [{
      lat: roof.center.lat,
      lng: roof.center.lng,
      azimuth: 0,
      tilt: 30,
      physHeightM: 1.8,
      heightM: 1.8 * Math.cos((60 * Math.PI) / 180),
      physWidthM: 1.134,
      widthM: 1.134,
    }],
  };
  const row = aspectOf(plan);
  assert(approx(row.tilt, 30, 0.01), `module pitch 30° wins over a 60° foreshortening (got ${row.tilt})`);

  const fromRoof = {
    meta: { tilt: 30 },
    roofs: [{ ring: roof.ring, tilt: 25, edgeAngleDeg: 0 }],
    modules: [{
      lat: roof.center.lat,
      lng: roof.center.lng,
      azimuth: 0,
      physHeightM: 1.8,
      heightM: 1.8 * Math.cos((30 * Math.PI) / 180),
    }],
  };
  const roofRow = aspectOf(fromRoof);
  assert(approx(roofRow.tilt, 25, 0.01), `missing module tilt uses the roof pitch 25° (got ${roofRow.tilt})`);
}

console.log('layout wins, including pure north; fallback stays labeled');
{
  const northPlan = planWith({
    edge: { along: 'east', azimuth: 0 },
    interior: 'south',
    tilt: 35,
  });
  const offer = { config: { kwp: 19.11, dach: 'Ziegel', moduleCount: 42, moduleWp: 455 } };
  const picked = selectYieldGroups(northPlan, offer, 455);
  assert(picked.source === 'layout', 'north layout is used');
  assert(isNorth(editorAzimuthToPvgis(picked.groups[0].editorAzimuth)), 'north layout is not replaced by south');
  assert(approx(picked.groups[0].tilt, 35, 0.01), 'north layout keeps its own pitch');

  const empty = selectYieldGroups({ modules: [] }, offer, 455);
  assert(empty.source === 'fallback', 'no modules → fallback');
  assert(empty.groups[0].source === 'fallback', 'fallback group is marked');
  assert(String(empty.groups[0].label).indexOf('Ohne Belegungsplan') === 0, 'fallback label says there is no layout');
  assert(approx(editorAzimuthToPvgis(empty.groups[0].editorAzimuth), 0, 0.01), 'ziegel fallback remains south');
  assert(FALLBACK_ORIENTATION_NOTE.indexOf('Nord') >= 0, 'fallback note says a layout still wins for north');
  const labeled = groupsFromOffer(offer);
  assert(labeled.length === 1 && labeled[0].label, 'groupsFromOffer keeps a label');
}

console.log('east-west modules keep their own facing');
{
  const roof = squareRoof({ along: 'north', azimuth: 90 }, 'east');
  const plan = {
    roofs: [{ ring: roof.ring, tilt: 10, edgeAngleDeg: 90 }],
    modules: [
      {
        lat: roof.center.lat, lng: roof.center.lng, azimuth: 90, tilt: 10,
        eastWest: true, facingAzimuth: 0,
      },
      {
        lat: roof.center.lat, lng: roof.center.lng, azimuth: 90, tilt: 10,
        eastWest: true, facingAzimuth: 180,
      },
    ],
  };
  const groups = groupsFromPlan(plan, 455);
  const aspects = groups.map((g) => editorAzimuthToPvgis(g.editorAzimuth)).sort((a, b) => a - b);
  assert(groups.length === 2, 'east and west stay apart');
  assert(approx(aspects[0], -90, 1) && approx(aspects[1], 90, 1), `east-west aspects −90 and +90 (got ${aspects.join(', ')})`);
}

console.log('12 kW inverter does not clip the annual PV sum');
{
  const pv = new Array(24).fill(20);
  const load = new Array(24).fill(1);
  const sim = simulateBattery(pv, load, { capacityKwh: 12, inverterAcKw: 12 });
  assert(sim.annualYield === 480, `annual PV stays 480 kWh above a 12 kW limit (got ${sim.annualYield})`);
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'NOORTEC-PVL/1.0', Accept: 'application/json' },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        try { resolve(JSON.parse(text)); } catch (e) { reject(e); }
      });
    });
    req.setTimeout(40000, () => {
      req.destroy(new Error('timeout'));
    });
    req.on('error', reject);
  });
}

async function pvgisSpecific(lat, lon, tilt, aspect) {
  const url = new URL('https://re.jrc.ec.europa.eu/api/v5_3/seriescalc');
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lon', String(lon));
  url.searchParams.set('startyear', '2023');
  url.searchParams.set('endyear', '2023');
  url.searchParams.set('pvcalculation', '1');
  url.searchParams.set('peakpower', '1');
  url.searchParams.set('loss', '14');
  url.searchParams.set('mountingplace', 'free');
  url.searchParams.set('angle', String(tilt));
  url.searchParams.set('aspect', String(aspect));
  url.searchParams.set('outputformat', 'json');
  url.searchParams.set('browser', '0');
  url.searchParams.set('raddatabase', 'PVGIS-SARAH3');
  const data = await fetchJson(url.toString());
  const hourly = data && data.outputs && data.outputs.hourly;
  if (!Array.isArray(hourly) || hourly.length < 8000) throw new Error('no series');
  const kwhPerKwp = hourly.reduce((s, row) => s + (Number(row.P) || 0), 0) / 1000;
  return kwhPerKwp;
}

async function main() {
  console.log('PVGIS-SARAH3 Ebenfurth, 19.11 kWp south 30°');
  try {
    const specific = await pvgisSpecific(47.8779, 16.3678, 30, 0);
    const annual = 19.11 * specific;
    console.log(`  specific ${specific.toFixed(1)} kWh/kWp → ${annual.toFixed(0)} kWh`);
    assert(Math.abs(annual - 15323) > 2000, `annual ${annual.toFixed(0)} kWh is not near 15,300`);
    assert(specific > 1050, `south 30° specific yield above the west-roof band (got ${specific.toFixed(1)})`);
  } catch (err) {
    failed += 1;
    console.error('  FAIL PVGIS check', err && err.message ? err.message : err);
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main();
