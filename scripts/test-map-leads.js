'use strict';

const assert = require('assert');
const { chooseNominatimHit, isCoarseGeocodeHit } = require('../src/geocode-nominatim');
const { geocodeAddressCascade } = require('../src/geocode-address-cascade');
const { layoutMapMarkers, spreadZoomFor } = require('../public/map-pin-spread');

const postcode = {
  lat: '48.1521104',
  lon: '16.3876195',
  type: 'postal_code',
  class: 'boundary',
  addresstype: 'postcode',
};
const amenity = {
  lat: '48.1963247',
  lon: '16.3682773',
  type: 'restaurant',
  class: 'amenity',
  addresstype: 'amenity',
};
const house = {
  lat: '48.1842816',
  lon: '16.3726780',
  type: 'house',
  class: 'place',
  addresstype: 'place',
};

assert.strictEqual(isCoarseGeocodeHit(postcode), true);
assert.strictEqual(isCoarseGeocodeHit(house), false);

const precise = chooseNominatimHit([postcode, amenity, house], { preciseOnly: true });
assert.ok(precise, 'Straße darf nicht auf den PLZ-Mittelpunkt fallen');
assert.strictEqual(precise.type, 'house');
assert.notStrictEqual(precise.lat, 48.1521104);

assert.strictEqual(chooseNominatimHit([postcode], { preciseOnly: true }), null);
const coarseOk = chooseNominatimHit([postcode], { preciseOnly: false });
assert.ok(coarseOk && Math.abs(coarseOk.lat - 48.1521104) < 1e-6);

const noWait = async () => {};

(async () => {
  const calls = [];
  const missedStreet = await geocodeAddressCascade(
    { strasse: 'Beispielgasse 9', plz: '1100', ort: 'Wien' },
    {
      delay: noWait,
      lookup: async (q, opts) => {
        calls.push({ q, preciseOnly: !!(opts && opts.preciseOnly) });
        if (opts && opts.preciseOnly) return null;
        return { lat: 48.1521104, lon: 16.3876195, type: 'postal_code' };
      },
    },
  );
  assert.strictEqual(calls[0].preciseOnly, true);
  assert.strictEqual(calls.length, 2);
  assert.ok(calls[1].q.includes('1100'));
  assert.strictEqual(missedStreet.label, 'Fallback PLZ/Ort geocodiert');

  const plzOnly = [];
  const onlyZip = await geocodeAddressCascade(
    { strasse: '', plz: '1100', ort: '' },
    {
      delay: noWait,
      lookup: async (q) => {
        plzOnly.push(q);
        return { lat: 48.15, lon: 16.38 };
      },
    },
  );
  assert.strictEqual(plzOnly.length, 1);
  assert.ok(plzOnly[0].includes('1100'));
  assert.strictEqual(onlyZip.label, 'Fallback PLZ geocodiert');
  assert.strictEqual(onlyZip.lat, 48.15);

  const exactCalls = [];
  const exact = await geocodeAddressCascade(
    { strasse: 'Laxenburger Straße 2', plz: '1100', ort: 'Wien' },
    {
      delay: noWait,
      lookup: async (q, opts) => {
        exactCalls.push(opts);
        return { lat: 48.1842816, lon: 16.372678, type: 'house' };
      },
    },
  );
  assert.strictEqual(exactCalls.length, 1);
  assert.strictEqual(exact.label, 'Exakte Adresse geocodiert');

  const shared = { lat: 48.15211, lng: 16.38762 };
  const far = layoutMapMarkers([
    { key: 'old', ...shared, z: 10 },
    { key: 'new', ...shared, z: 6000 },
    { key: 'other', lat: 48.2, lng: 16.3, z: 1 },
  ], { zoom: 9 });
  assert.strictEqual(far.hasCoincident, true);
  assert.strictEqual(far.markers.length, 2);
  const stack = far.markers.find((m) => m.count > 1);
  assert.ok(stack);
  assert.strictEqual(stack.key, 'new', 'neuester Lead bleibt der sichtbare Stapel-Pin');
  assert.strictEqual(stack.count, 2);
  assert.strictEqual(stack.clustered, true);

  const near = layoutMapMarkers([
    { key: 'a', ...shared, z: 1 },
    { key: 'b', ...shared, z: 2 },
  ], { zoom: 16 });
  assert.strictEqual(near.markers.length, 2);
  assert.ok(near.markers.every((m) => m.clustered === false && m.count === 1));
  const dLat = Math.abs(near.markers[0].lat - near.markers[1].lat);
  const dLng = Math.abs(near.markers[0].lng - near.markers[1].lng);
  assert.ok(dLat > 0.00005 || dLng > 0.00005, 'nahe Zoomstufe zeichnet getrennte Pins');
  const drift = Math.hypot(
    (near.markers[0].lat - shared.lat) * 111320,
    (near.markers[0].lng - shared.lng) * 111320 * Math.cos(shared.lat * Math.PI / 180),
  );
  assert.ok(drift < 400, `Versatz bleibt im Viertel, war ${drift.toFixed(0)} m`);

  const alone = layoutMapMarkers([{ key: 'solo', lat: 48.1, lng: 16.2, z: 3 }], { zoom: 9 });
  assert.strictEqual(alone.hasCoincident, false);
  assert.strictEqual(alone.markers[0].lat, 48.1);
  assert.ok(spreadZoomFor(48.15) >= 13 && spreadZoomFor(48.15) <= 16);

  console.log('test-map-leads: ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
