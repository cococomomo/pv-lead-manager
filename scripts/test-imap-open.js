'use strict';

require('dotenv').config();
const imaps = require('imap-simple');

const config = {
  imap: {
    host:     process.env.IMAP_HOST,
    port:     parseInt(process.env.IMAP_PORT, 10) || 993,
    user:     process.env.IMAP_USER,
    password: process.env.IMAP_PASSWORD,
    tls:      true,
    tlsOptions: { rejectUnauthorized: false },
    authTimeout: 10000,
  },
};

(async () => {
  let connection;
  try {
    connection = await imaps.connect(config);
    console.log('Connected OK');
    const folder = `INBOX.${process.env.IMAP_FOLDER || 'Leads'}`;
    console.log(`Opening: ${folder}`);
    await connection.openBox(folder);
    console.log('Box opened OK');
    const messages = await connection.search(['UNSEEN'], { bodies: [], markSeen: false });
    console.log(`Unread messages: ${messages.length}`);
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    if (connection) connection.end();
  }
})();
