'use strict';

require('./load-env');
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const CREDENTIALS_PATH = path.join(__dirname, '../auth/google-credentials.json');
/** Muss in der Google Cloud Console als Weiterleitungs-URI eingetragen sein (OAuth-Setup). */
const DEFAULT_REDIRECT = 'http://127.0.0.1:3334/oauth2callback';

/**
 * client_id + client_secret: zuerst GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET aus .env,
 * sonst auth/google-credentials.json (installed oder web).
 * redirectUri: GOOGLE_OAUTH_REDIRECT_URI, sonst erste URI aus der JSON-Datei, sonst DEFAULT_REDIRECT.
 */
function resolveGoogleOAuthConfig() {
  const id = String(process.env.GOOGLE_CLIENT_ID || '').trim();
  const secret = String(process.env.GOOGLE_CLIENT_SECRET || '').trim();
  const redirectFromEnv = String(process.env.GOOGLE_OAUTH_REDIRECT_URI || '').trim();

  if (id && secret) {
    return {
      client_id: id,
      client_secret: secret,
      redirectUri: redirectFromEnv || DEFAULT_REDIRECT,
    };
  }

  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error(
      'Google OAuth: GOOGLE_CLIENT_ID und GOOGLE_CLIENT_SECRET in .env setzen oder auth/google-credentials.json anlegen.'
    );
  }
  const raw = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
  const c = raw.installed || raw.web;
  if (!c?.client_id || !c?.client_secret) {
    throw new Error('auth/google-credentials.json: client_id / client_secret fehlen');
  }
  const redirectUri =
    redirectFromEnv ||
    (Array.isArray(c.redirect_uris) && c.redirect_uris[0]) ||
    DEFAULT_REDIRECT;
  return { client_id: c.client_id, client_secret: c.client_secret, redirectUri };
}

function createGoogleOAuth2Client() {
  const { client_id, client_secret, redirectUri } = resolveGoogleOAuthConfig();
  return new google.auth.OAuth2(client_id, client_secret, redirectUri);
}

module.exports = {
  createGoogleOAuth2Client,
  resolveGoogleOAuthConfig,
  CREDENTIALS_PATH,
  DEFAULT_REDIRECT,
};
