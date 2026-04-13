'use strict';
/** Prüft, ob refresh_token + credentials noch bei Google gültig sind (kein Output von Secrets). */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const credPath = path.join(__dirname, '../auth/google-credentials.json');
const tokPath = path.join(__dirname, '../auth/google-token.json');
const raw = JSON.parse(fs.readFileSync(credPath, 'utf8'));
const c = raw.installed || raw.web;
const t = JSON.parse(fs.readFileSync(tokPath, 'utf8'));
const o = new google.auth.OAuth2(c.client_id, c.client_secret);
o.setCredentials(t);
o.refreshAccessToken()
  .then(() => {
    console.log('GOOGLE_REFRESH_OK');
    process.exit(0);
  })
  .catch((e) => {
    console.log('GOOGLE_REFRESH_ERR', e.message);
    process.exit(1);
  });
