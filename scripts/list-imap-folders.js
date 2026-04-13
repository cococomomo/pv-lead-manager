'use strict';

require('dotenv').config();
const Imap = require('imap');

const imap = new Imap({
  user:     process.env.IMAP_USER,
  password: process.env.IMAP_PASSWORD,
  host:     process.env.IMAP_HOST,
  port:     parseInt(process.env.IMAP_PORT, 10) || 993,
  tls:      true,
  tlsOptions: { rejectUnauthorized: false },
});

imap.once('ready', () => {
  imap.getBoxes((err, boxes) => {
    if (err) { console.error('Error:', err.message); imap.end(); return; }
    printBoxes(boxes, '');
    imap.end();
  });
});

function printBoxes(boxes, prefix) {
  for (const [name, box] of Object.entries(boxes)) {
    const full = prefix ? `${prefix}${box.delimiter || '.'}${name}` : name;
    console.log(full);
    if (box.children) printBoxes(box.children, full);
  }
}

imap.once('error', err => console.error('Connection error:', err.message));
imap.once('end', () => console.log('\nDone.'));
imap.connect();
