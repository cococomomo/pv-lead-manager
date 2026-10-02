'use strict';

/**
 * Leere Luftbildkachel und Kartenfolge.
 * Der Ortho-Renderer fällt von einer weißen oder fehlgeschlagenen basemap.at-Kachel
 * auf Esri. Fetch ist gemockt, die Aussage hängt nicht am Netz.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const mapProviders = require('../src/offer/map-providers');
const { renderLayoutOrthoPng } = require('../src/offer/layout-ortho-render');

function solidPng(r, g, b, w = 16, h = 16) {
  const png = new PNG({ width: w, height: h });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = r;
    png.data[i + 1] = g;
    png.data[i + 2] = b;
    png.data[i + 3] = 255;
  }
  return PNG.sync.write(png);
}

function variedBrightPng() {
  const w = 16;
  const h = 16;
  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const v = ((x + y) % 2 === 0) ? 255 : 246;
      png.data[i] = v;
      png.data[i + 1] = v;
      png.data[i + 2] = v;
      png.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

function photoPng() {
  const w = 16;
  const h = 16;
  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      png.data[i] = (x * 17) % 220;
      png.data[i + 1] = (y * 11) % 180;
      png.data[i + 2] = 40 + ((x * y) % 80);
      png.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

function rgbaFromPng(buf) {
  const png = PNG.sync.read(buf);
  return { width: png.width, height: png.height, data: png.data };
}

function plan() {
  return {
    basemapProvider: 'basemap_at',
    roofs: [{
      ring: [
        { lat: 48.2, lng: 16.3 },
        { lat: 48.2, lng: 16.3012 },
        { lat: 48.201, lng: 16.3012 },
        { lat: 48.201, lng: 16.3 },
      ],
    }],
    modules: [],
  };
}

function hostOf(url) {
  if (url.includes('mapsneu.wien.gv.at')) return 'basemap';
  if (url.includes('arcgisonline.com')) return 'esri';
  if (url.includes('openstreetmap.org')) return 'osm';
  return 'other';
}

async function renderWith(fetchTile, basemapProvider) {
  const urls = [];
  const buf = await renderLayoutOrthoPng(plan(), {
    basemapProvider: basemapProvider || 'basemap_at',
    zoom: 18,
    longEdgePx: 64,
    jpegQuality: 60,
    fetchTile: async (url) => {
      urls.push(String(url));
      return fetchTile(String(url));
    },
  });
  return { buf, urls };
}

function assertEsriOnlyAfterProbe(urls) {
  const hosts = urls.map(hostOf);
  assert.ok(hosts.includes('basemap'), 'basemap.at wird zuerst geprüft');
  assert.ok(hosts.includes('esri'), 'Esri wird geladen');
  assert.ok(!hosts.includes('osm'), 'OpenStreetMap bleibt aus, wenn Esri ein Bild hat');
  const firstEsri = hosts.indexOf('esri');
  assert.ok(firstEsri > 0, 'Esri kommt nach der basemap-Prüfung');
  assert.ok(!hosts.slice(firstEsri).includes('basemap'), 'danach kein Flickenteppich aus basemap');
  assert.ok(hosts.slice(0, firstEsri).every((h) => h === 'basemap'), 'vorher nur die leere basemap-Kachel');
}

async function main() {
  assert.deepStrictEqual(mapProviders.rasterFallbackIds(), ['basemap_at', 'esri_world', 'osm']);
  assert.deepStrictEqual(
    mapProviders.rasterTryOrder('esri_world'),
    ['esri_world', 'osm', 'basemap_at'],
  );
  assert.deepStrictEqual(
    mapProviders.rasterTryOrder('osm'),
    ['osm', 'basemap_at', 'esri_world'],
  );
  assert.deepStrictEqual(
    mapProviders.rasterTryOrder('unbekannt'),
    ['basemap_at', 'esri_world', 'osm'],
  );
  assert.ok(!mapProviders.rasterFallbackIds().includes('google_sat'));

  assert.strictEqual(mapProviders.isEmptyTileImage(null), true, 'kein Bild');
  assert.strictEqual(mapProviders.isEmptyTileImage({ width: 0, height: 0, data: Buffer.alloc(0) }), true);
  assert.strictEqual(mapProviders.isEmptyTileImage(rgbaFromPng(solidPng(253, 253, 253))), true, 'RGB 253');
  assert.strictEqual(mapProviders.isEmptyTileImage(rgbaFromPng(solidPng(180, 180, 180))), false, 'grau ist kein leeres Luftbild');
  assert.strictEqual(
    mapProviders.isEmptyTileImage(rgbaFromPng(variedBrightPng())),
    false,
    'hoher Mittelwert mit Kontrast bleibt ein Bild',
  );
  assert.strictEqual(mapProviders.isEmptyTileImage(rgbaFromPng(photoPng())), false);

  const white = solidPng(253, 253, 253);
  const photo = photoPng();

  const blank = await renderWith((url) => {
    if (hostOf(url) === 'basemap') return white;
    if (hostOf(url) === 'esri') return photo;
    throw new Error('OSM sollte nicht angefragt werden: ' + url);
  });
  assert.strictEqual(blank.buf.basemapProvider, 'esri_world');
  assert.ok(blank.buf[0] === 0xff && blank.buf[1] === 0xd8, 'JPEG');
  assertEsriOnlyAfterProbe(blank.urls);

  const failed = await renderWith((url) => {
    if (hostOf(url) === 'basemap') throw new Error('HTTP 404');
    if (hostOf(url) === 'esri') return photo;
    throw new Error('OSM sollte nicht angefragt werden: ' + url);
  });
  assert.strictEqual(failed.buf.basemapProvider, 'esri_world');
  assertEsriOnlyAfterProbe(failed.urls);

  const notImage = await renderWith((url) => {
    if (hostOf(url) === 'basemap') return Buffer.from('keine kachel');
    if (hostOf(url) === 'esri') return photo;
    throw new Error('OSM sollte nicht angefragt werden: ' + url);
  });
  assert.strictEqual(notImage.buf.basemapProvider, 'esri_world');
  assertEsriOnlyAfterProbe(notImage.urls);

  const kept = await renderWith((url) => {
    if (hostOf(url) === 'basemap') return photo;
    throw new Error('nächste Karte unnötig: ' + url);
  });
  assert.strictEqual(kept.buf.basemapProvider, 'basemap_at');
  assert.ok(kept.urls.every((url) => hostOf(url) === 'basemap'));

  const root = path.join(__dirname, '..');
  const editor = fs.readFileSync(path.join(root, 'public/layout-editor.js'), 'utf8');
  const setAt = editor.indexOf('setProviders(p)');
  assert.ok(setAt > 0);
  const setFn = editor.slice(setAt, setAt + 700);
  assert.ok(setFn.includes('makeTileLayer'), 'setProviders legt Fallback-Layer an');
  const makeAt = editor.indexOf('function makeTileLayer');
  assert.ok(makeAt > 0 && makeAt < setAt);
  const makeFn = editor.slice(makeAt, makeAt + 450);
  assert.ok(makeFn.includes('crossOrigin: true'), 'Fallback-Layer bleiben für den Snapshot lesbar');
  assert.ok(editor.includes("layer.on('tileerror'"), 'fehlende Kachel wechselt die Karte');
  assert.ok(editor.includes('isEmptyTileImage'), 'weiße Kachel wird geprüft');
  assert.ok(editor.includes("'basemap_at', 'esri_world', 'osm'"));

  const html = fs.readFileSync(path.join(root, 'public/offer.html'), 'utf8');
  assert.ok(html.includes('layout-editor.js?v=20261001-kartenfolge'));
  assert.ok(html.includes('>Angebot fertigstellen</button>'));
  assert.ok(html.includes('>Diesen Text in der E-Mail öffnen</button>'));
  assert.ok(html.includes('der Browser die Datei nicht in den Entwurf legen kann'));
  assert.ok(html.includes('id="layout-basemap-hint"'));

  console.log('ok test-map-fallback');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
