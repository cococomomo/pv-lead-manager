#!/usr/bin/env node
/**
 * Dachzeile aus dem Belegungsplan: Neigung unter 3° oder Ost-West-Paare.
 * Run: node scripts/test-layout-roof-label.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { roofLabelForLayout } = require('../public/layout-roof-label');

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

const eastWestPairs = [
  { tilt: 10, eastWest: true },
  { tilt: 10, eastWest: true },
];

console.log('tilt under 3° or east-west pairs');
{
  assert(
    roofLabelForLayout('Flachdach', { tilt: 2.9 }) === 'Flachdach Ost-West',
    'Flachdach, tilt 2.9° → Flachdach Ost-West'
  );
  assert(
    roofLabelForLayout('Ziegel', { tilt: 0 }) === 'Flachdach Ost-West',
    'tilt 0° → Flachdach Ost-West'
  );
  assert(
    roofLabelForLayout('Flachdach', { tilt: 10, modules: eastWestPairs }) === 'Flachdach Ost-West',
    'east-west module pairs → Flachdach Ost-West'
  );
  assert(
    roofLabelForLayout('Ziegel', { tilt: 35, modules: eastWestPairs }) === 'Flachdach Ost-West',
    'steep roof with east-west pairs → Flachdach Ost-West'
  );
  assert(
    roofLabelForLayout('Flachdach', { tilt: 3 }) === 'Flachdach',
    'tilt 3° is not under 3° and stays Flachdach'
  );
}

console.log('Freifläche base');
{
  assert(
    roofLabelForLayout('Freifläche', { tilt: 1 }) === 'Freifläche Ost-West',
    'Freifläche, tilt under 3° → Freifläche Ost-West'
  );
  assert(
    roofLabelForLayout('Freifläche Süd', { tilt: 12, modules: eastWestPairs }) === 'Freifläche Ost-West',
    'Freifläche with east-west pairs → Freifläche Ost-West'
  );
  assert(
    roofLabelForLayout('Freifläche', { tilt: 20, eastWest: true }) === 'Freifläche Ost-West',
    'explicit eastWest flag on Freifläche → Freifläche Ost-West'
  );
}

console.log('steep tile stays Ziegel');
{
  assert(
    roofLabelForLayout('Ziegel', { tilt: 30 }) === 'Ziegel',
    'Ziegel 30° stays Ziegel'
  );
  assert(
    roofLabelForLayout('Ziegel', { tilt: 35, modules: [{ tilt: 35, eastWest: false }] }) === 'Ziegel',
    'steep tile modules without east-west stay Ziegel'
  );
  assert(
    roofLabelForLayout('Ziegel', { tilt: 45, roofs: [{ tilt: 45 }] }) === 'Ziegel',
    'steep roof polygon stays Ziegel'
  );
}

console.log('offer toolbar markers');
{
  const html = fs.readFileSync(path.join(__dirname, '../public/offer.html'), 'utf8');
  ['c-street', 'c-zip', 'c-city', 'layout-address'].forEach((id) => {
    const re = new RegExp(`id="${id}"[^>]*>`);
    const tag = (html.match(re) || [''])[0];
    assert(/autocomplete="one-time-code"/.test(tag), `${id} autocomplete is not an address token`);
    assert(/data-lpignore="true"/.test(tag), `${id} data-lpignore`);
    assert(/data-1p-ignore="true"/.test(tag), `${id} data-1p-ignore`);
  });
  assert(html.includes('Modulabstand'), 'Abstand renamed to Modulabstand');
  assert(html.includes('>Modulplanung<'), 'module step label Modulplanung');
  assert(!html.includes('id="layout-btn-auto"'), 'Auto button removed');
  assert(!html.includes('id="layout-auto-portrait"'), 'Hochformat button removed');
  assert(!html.includes('Flachdachbelegung'), 'Flachdachbelegung button removed');
  assert(!html.includes('id="layout-auto-eastwest"'), 'Ost-West button removed');
  assert(!/>Abstand m</.test(html), 'old Abstand m label gone');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
