'use strict';
/** Prüft, ob refresh_token + credentials noch bei Google gültig sind (kein Output von Secrets). */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const { createGoogleOAuth2Client } = require('../src/google-client');

const tokPath = path.join(__dirname, '../auth/google-token.json');
const t = JSON.parse(fs.readFileSync(tokPath, 'utf8'));
const o = createGoogleOAuth2Client();
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
