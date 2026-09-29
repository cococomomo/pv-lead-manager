#!/usr/bin/env node
/**
 * Tests: Modul-Neigung / projizierte Größe / Multi-Dach-Ertrags-Hilfen.
 * Run: node scripts/test-layout-tilt.js
 */
'use strict';

const {
  resolveModuleTiltForYield,
  summarizeLayoutTilts,
  projectedModuleFootprint,
  syncModuleProjectedSize,
} = require('../src/offer/layout-tilt');

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

console.log('projectedModuleFootprint');
{
  const flat = projectedModuleFootprint(1.134, 1.8, 0, 0, false);
  assert(approx(flat.widthM, 1.134), 'flat: width = phys width');
  assert(approx(flat.heightM, 1.8), 'flat: height = phys height');

  const t45 = projectedModuleFootprint(1.134, 1.8, 45, 0, false);
  assert(approx(t45.heightM, 1.8 * Math.cos(Math.PI / 4)), '45° foreshortens along-slope');
  assert(approx(t45.widthM, 1.134), '45° keeps eave width');
}

console.log('syncModuleProjectedSize preserves phys dims when tilt changes (roof switch)');
{
  const m = {
    physWidthM: 1.134,
    physHeightM: 1.8,
    tilt: 10,
    tiltCross: 0,
    landscape: false,
  };
  syncModuleProjectedSize(m, { tilt: 10 });
  const h10 = m.heightM;
  syncModuleProjectedSize(m, { tilt: 40 });
  assert(approx(m.physWidthM, 1.134) && approx(m.physHeightM, 1.8), 'phys dims unchanged after tilt change');
  assert(approx(m.tilt, 40), 'tilt updated to destination roof');
  assert(m.heightM < h10, 'projected height shrinks when tilt increases');
  assert(approx(m.heightM, 1.8 * Math.cos((40 * Math.PI) / 180)), 'height = phys * cos(tilt)');
}

console.log('syncModuleProjectedSize does not bake tilt=0 when only catalog fallback needed');
{
  const m = { physWidthM: 1.134, physHeightM: 1.8, tilt: 35 };
  syncModuleProjectedSize(m, { fallbackTilt: 30 });
  assert(approx(m.tilt, 35), 'existing module tilt kept when opts.tilt omitted');
}

console.log('resolveModuleTiltForYield / summarizeLayoutTilts multi-roof');
{
  const roofs = [
    {
      tilt: 15,
      ring: [
        { lat: 48.0, lng: 16.0 },
        { lat: 48.0, lng: 16.001 },
        { lat: 48.001, lng: 16.001 },
        { lat: 48.001, lng: 16.0 },
      ],
    },
    {
      tilt: 42,
      ring: [
        { lat: 48.0, lng: 16.002 },
        { lat: 48.0, lng: 16.003 },
        { lat: 48.001, lng: 16.003 },
        { lat: 48.001, lng: 16.002 },
      ],
    },
  ];
  const modules = [
    { lat: 48.0005, lng: 16.0005, tilt: 15 },
    { lat: 48.0005, lng: 16.0025, tilt: 42 },
    { lat: 48.0005, lng: 16.0025 }, // tilt missing → roof
  ];
  const r0 = resolveModuleTiltForYield(modules[0], roofs, { tilt: 30 });
  assert(r0.source === 'module' && approx(r0.tilt, 15), 'module-owned tilt preferred');

  const r2 = resolveModuleTiltForYield(modules[2], roofs, { tilt: 30 });
  assert(r2.source === 'roof' && approx(r2.tilt, 42), 'missing module tilt → containing roof');

  const summary = summarizeLayoutTilts({ meta: { tilt: 30 }, roofs, modules });
  assert(summary.roofCount === 2, 'two roofs');
  assert(summary.moduleCount === 3, 'three modules');
  assert(summary.distinctTilts.length === 2, 'two distinct tilts (15 and 42)');
  const counts = Object.fromEntries(summary.distinctTilts.map((d) => [d.tilt, d.count]));
  assert(counts[15] === 1 && counts[42] === 2, 'tilt bucket counts');
}

console.log('inter-roof move simulation (phys + reproject)');
{
  // Module starts on flat-ish roof, then adopts steep roof tilt like endModuleDrag sync
  const m = {
    lat: 48.0,
    lng: 16.0,
    physWidthM: 1.134,
    physHeightM: 1.8,
    tilt: 12,
    tiltCross: 0,
    azimuth: 90,
    landscape: false,
  };
  syncModuleProjectedSize(m, { tilt: 12 });
  const sizeBefore = { w: m.widthM, h: m.heightM, tilt: m.tilt, az: m.azimuth };
  // drop onto 40° roof – orientation kept, tilt/size updated
  syncModuleProjectedSize(m, { tilt: 40, tiltCross: 0 });
  assert(approx(m.azimuth, sizeBefore.az), 'azimuth persists across roof move');
  assert(approx(m.tilt, 40), 'tilt adopts destination roof');
  assert(approx(m.physWidthM, 1.134), 'phys size persists');
  assert(!approx(m.heightM, sizeBefore.h), 'projected size updates with new tilt');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
