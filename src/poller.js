'use strict';

require('./load-env');
const imaps = require('imap-simple');
const { simpleParser } = require('mailparser');
const cron = require('node-cron');
const { extractLead } = require('./extractor');
const { appendLead, leadExists } = require('./sheets');
const { scheduleAppointment } = require('./calendar');

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

async function pollEmails() {
  console.log(`[${new Date().toISOString()}] Polling emails...`);
  let connection;

  try {
    connection = await imaps.connect(imapConfig);
    await connection.openBox(`INBOX.${process.env.IMAP_FOLDER || 'Leads'}`);

    const searchCriteria = ['UNSEEN'];
    const fetchOptions = {
      bodies: ['HEADER', 'TEXT', ''],
      markSeen: true,
    };

    const messages = await connection.search(searchCriteria, fetchOptions);
    console.log(`Found ${messages.length} unread message(s).`);

    for (const message of messages) {
      try {
        const all = message.parts.find((p) => p.which === '');
        if (!all || all.body == null) {
          console.log('Message has no full body part, skipping.');
          continue;
        }
        const parsed = await simpleParser(all.body);

        const emailData = {
          from: parsed.from?.text || '',
          subject: parsed.subject || '',
          date: parsed.date?.toISOString() || new Date().toISOString(),
          text: parsed.text || '',
          html: parsed.html || '',
        };

        console.log(`Processing email: "${emailData.subject}" from ${emailData.from}`);

        // Extract lead data via Claude
        const lead = await extractLead(emailData);
        if (!lead) {
          console.log('No lead data extracted, skipping.');
          continue;
        }

        // Deduplicate by email address
        if (lead.email && await leadExists(lead.email)) {
          console.log(`Lead ${lead.email} already exists, skipping.`);
          continue;
        }

        // Write to Google Sheets
        await appendLead(lead);
        console.log(`Lead saved: ${lead.name} <${lead.email}>`);

        // Schedule appointment and send confirmation
        if (lead.email) {
          await scheduleAppointment(lead, emailData);
        }
      } catch (err) {
        console.error('Error processing message:', err.message);
      }
    }
  } catch (err) {
    console.error('IMAP error:', err.message);
  } finally {
    if (connection) connection.end();
  }
}

// Run immediately on start, then twice daily at 08:00 and 18:00
pollEmails();
cron.schedule('0 8,18 * * *', pollEmails);

console.log('Poller started: once now, then daily at 08:00 and 18:00 (server time).');
