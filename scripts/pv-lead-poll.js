#!/usr/bin/env node
'use strict';

/**
 * NOORTEC — einmaliger IMAP-Import (CLI / npm run poll).
 * Dauerbetrieb per PM2 ist nicht vorgesehen; im Dashboard: „Leads jetzt synchronisieren“ (POST /api/sync-leads).
 */
require('../src/load-env');
const { pollEmails } = require('../src/poller.js');

pollEmails()
  .then(({ importedCount }) => {
    console.log(`[NOORTEC] CLI-Poll fertig, neue Leads: ${importedCount}`);
    process.exit(0);
  })
  .catch((e) => {
    console.error('[NOORTEC] CLI-Poll fehlgeschlagen:', e && e.message ? e.message : e);
    process.exit(1);
  });
