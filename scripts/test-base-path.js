'use strict';

const assert = require('assert');
const { rewritePublicText, prefixRedirect } = require('../src/base-path');

const base = '/test';

function check(input, expected) {
  const out = rewritePublicText(input, base);
  assert.strictEqual(out, expected, `got ${out}`);
}

check("fetch('/api/stats')", "fetch('/test/api/stats')");
check('fetch("/api/auth/me")', 'fetch("/test/api/auth/me")');
check('api(`/api/leads/${id}/status`)', 'api(`/test/api/leads/${id}/status`)');
check("href=\"/offer\"", "href=\"/test/offer\"");
check("href=\"/\"", "href=\"/test/\"");
check("location.replace('/')", "location.replace('/test/')");
check("src=\"/layout-editor.js?v=1\"", "src=\"/test/layout-editor.js?v=1\"");
check("src=\"/map-pin-spread.js?v=1\"", "src=\"/test/map-pin-spread.js?v=1\"");
check("src=\"/offer-assets/noortec-logo.png\"", "src=\"/test/offer-assets/noortec-logo.png\"");
check("fetch('/test/api/stats')", "fetch('/test/api/stats')");
check("s.startsWith('//')", "s.startsWith('//')");
check('href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"', 'href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"');
check("encodeURIComponent('/profile')", "encodeURIComponent('/test/profile')");
check("return '/'", "return '/test/'");
check('{"photoUrl":"/api/sales-photos/ada"}', '{"photoUrl":"/test/api/sales-photos/ada"}');

assert.strictEqual(prefixRedirect('/login.html?next=%2F', base), '/test/login.html?next=%2F');
assert.strictEqual(prefixRedirect('/test/login.html', base), '/test/login.html');
assert.strictEqual(prefixRedirect('https://pvl.lifeco.at/', base), 'https://pvl.lifeco.at/');
assert.strictEqual(rewritePublicText("fetch('/api/stats')", ''), "fetch('/api/stats')");
assert.strictEqual(rewritePublicText('src="/offer-assets/noortec-logo.png"', base), 'src="/test/offer-assets/noortec-logo.png"');

const fs = require('fs');
const path = require('path');
const pub = path.join(__dirname, '../public');
for (const name of ['index.html', 'offer.html', 'login.html', 'admin.html', 'profile.html', 'layout-editor.js']) {
  const raw = fs.readFileSync(path.join(pub, name), 'utf8');
  const out = rewritePublicText(raw, base);
  assert.ok(!out.includes("fetch('/api/"), `${name} still has fetch('/api/`);
  assert.ok(!out.includes('fetch("/api/'), `${name} still has fetch("/api/`);
  assert.ok(!out.includes("api('/api/"), `${name} still has api('/api/`);
  assert.ok(!out.includes('apiFetch(\'/api/'), `${name} still has apiFetch single`);
  assert.ok(!out.includes('href="/offer"'), `${name} still has href="/offer"`);
  assert.ok(out.includes('https://unpkg.com/leaflet') || !raw.includes('https://unpkg.com/leaflet'), `${name} broke leaflet url`);
  assert.ok(!out.includes("'/test/test/"), `${name} double-prefixed`);
}

console.log('test-base-path: ok');
