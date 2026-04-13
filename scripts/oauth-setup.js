#!/usr/bin/env node
/**
 * OAuth2 Setup Script
 * Generates auth/google-token.json by running the OAuth2 consent flow.
 * Starts a local callback server, opens the browser, and saves the token.
 */

'use strict';

const http = require('http');
const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

const CREDENTIALS_PATH = path.join(__dirname, '../auth/google-credentials.json');
const TOKEN_PATH = path.join(__dirname, '../auth/google-token.json');
const PORT = 3334;

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/gmail.send',
];

if (!fs.existsSync(CREDENTIALS_PATH)) {
  console.error('ERROR: auth/google-credentials.json not found.');
  process.exit(1);
}

const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));
const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;

// Muss 1:1 in Google Cloud → Client → „Autorisierte Weiterleitungs-URIs“ stehen (localhost ≠ 127.0.0.1).
const redirectUri = `http://127.0.0.1:${PORT}/oauth2callback`;
const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirectUri);

const authUrl = oAuth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: SCOPES,
  prompt: 'consent', // force refresh_token to be returned
});

console.log('\n=== Google OAuth2 Setup ===\n');
console.log('Redirect-URI (in Google Cloud → OAuth-Client eintragen, exakt so):');
console.log('  ' + redirectUri + '\n');
console.log('Im Browser öffnen:\n');
console.log(authUrl);
console.log('');
if (process.platform === 'win32') {
  exec(`start "" "${authUrl}"`);
} else {
  console.log(
    'Tipp: Läuft dieses Skript per SSH auf dem Server, der Browser aber auf deinem PC, zuerst\n' +
    '  ssh -L ' + PORT + ':127.0.0.1:' + PORT + ' user@server\n' +
    'dann die URL oben im **lokalen** Browser öffnen (Google leitet auf ' + redirectUri + ' → Tunnel → Server).\n'
  );
}
console.log('Warte auf Callback auf ' + redirectUri + ' …\n');

// Local HTTP server to catch the OAuth callback
const server = http.createServer(async (req, res) => {
  if (!req.url.startsWith('/oauth2callback')) return;

  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error) {
    res.writeHead(400, { 'Content-Type': 'text/html' });
    res.end(`<h2>Fehler: ${error}</h2><p>Bitte versuche es erneut.</p>`);
    console.error('OAuth error:', error);
    server.close();
    process.exit(1);
  }

  if (!code) {
    res.writeHead(400, { 'Content-Type': 'text/html' });
    res.end('<h2>Kein Code erhalten.</h2>');
    server.close();
    process.exit(1);
  }

  try {
    const { tokens } = await oAuth2Client.getToken(code);
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <html><body style="font-family:sans-serif;padding:2rem">
        <h2>✅ Login erfolgreich!</h2>
        <p>Das Token wurde gespeichert unter: <code>auth/google-token.json</code></p>
        <p>Du kannst dieses Fenster schließen.</p>
      </body></html>
    `);

    console.log('✅ Token saved to auth/google-token.json');
    console.log('   Scopes granted:', tokens.scope);
    server.close();
    process.exit(0);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/html' });
    res.end(`<h2>Fehler beim Token-Abruf</h2><pre>${err.message}</pre>`);
    console.error('Token exchange failed:', err.message);
    server.close();
    process.exit(1);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  /* nur Loopback — mit ssh -L 3334:127.0.0.1:3334 vom PC aus erreichbar */
});

server.on('error', (err) => {
  console.error('Server error:', err.message);
  process.exit(1);
});
