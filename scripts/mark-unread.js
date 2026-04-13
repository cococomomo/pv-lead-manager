#!/usr/bin/env node
'use strict';

require('dotenv').config();
const imaps = require('imap-simple');

const imapConfig = {
  imap: {
    host: process.env.IMAP_HOST,
    port: parseInt(process.env.IMAP_PORT, 10) || 993,
    user: process.env.IMAP_USER,
    password: process.env.IMAP_PASSWORD,
    tls: true,
    tlsOptions: { rejectUnauthorized: false },
    authTimeout: 10000,
  },
};

async function markAllUnread() {
  const folder = `INBOX.${process.env.IMAP_FOLDER || 'Leads'}`;
  console.log(`Connecting to ${process.env.IMAP_HOST}...`);

  const connection = await imaps.connect(imapConfig);
  await connection.openBox(folder);

  const messages = await connection.search(['SEEN'], { bodies: [], markSeen: false });
  console.log(`Found ${messages.length} read message(s) — marking as unread...`);

  for (const msg of messages) {
    const uid = msg.attributes.uid;
    await connection.delFlags(uid, ['\\Seen']);
  }

  console.log(`Done. ${messages.length} message(s) marked as unread.`);
  connection.end();
}

markAllUnread().catch(err => { console.error(err.message); process.exit(1); });
