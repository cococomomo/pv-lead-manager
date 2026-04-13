'use strict';

require('dotenv').config();
const { google } = require('googleapis');
const path = require('path');
const { getMailSender } = require('./mail-transport');

const CREDENTIALS_PATH = path.join(__dirname, '../auth/google-credentials.json');
const TOKEN_PATH = path.join(__dirname, '../auth/google-token.json');

let _auth = null;

function leadAddressLine(lead) {
  const parts = [lead.street, lead.zip, lead.city].filter(Boolean);
  return parts.length ? parts.join(', ') : '';
}

async function getAuth() {
  if (_auth) return _auth;

  const credentials = require(CREDENTIALS_PATH);
  const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

  const token = require(TOKEN_PATH);
  oAuth2Client.setCredentials(token);
  _auth = oAuth2Client;
  return _auth;
}

// Schedule a consultation appointment 3 business days from now at 10:00
function getAppointmentDate() {
  const date = new Date();
  let added = 0;
  while (added < 3) {
    date.setDate(date.getDate() + 1);
    const day = date.getDay();
    if (day !== 0 && day !== 6) added++; // skip weekends
  }
  date.setHours(10, 0, 0, 0);
  return date;
}

async function createCalendarEvent(lead, startDate) {
  const auth = await getAuth();
  const calendar = google.calendar({ version: 'v3', auth });

  const endDate = new Date(startDate);
  endDate.setMinutes(endDate.getMinutes() + 60);

  const addr = leadAddressLine(lead);
  const mapsLine = addr ? `${addr}, Österreich` : '';

  const event = {
    summary: `PV Beratung – ${lead.name || lead.email}`,
    location: mapsLine || undefined,
    description: [
      `Anfrage von: ${lead.name || 'Unbekannt'}`,
      `E-Mail: ${lead.email || '-'}`,
      `Telefon: ${lead.phone || '-'}`,
      `Adresse: ${addr || '-'}`,
      `Google Maps: ${mapsLine ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsLine)}` : '-'}`,
      '',
      `Details / Anfrage: ${lead.info || '-'}`,
    ].join('\n'),
    start: { dateTime: startDate.toISOString(), timeZone: 'Europe/Vienna' },
    end: { dateTime: endDate.toISOString(), timeZone: 'Europe/Vienna' },
    attendees: [
      { email: process.env.MY_EMAIL, displayName: process.env.MY_NAME },
      ...(lead.email ? [{ email: lead.email, displayName: lead.name || '' }] : []),
    ],
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'email', minutes: 60 },
        { method: 'popup', minutes: 30 },
      ],
    },
  };

  const res = await calendar.events.insert({
    calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
    resource: event,
    sendUpdates: 'all',
  });

  return res.data;
}

async function sendConfirmationEmail(lead, appointmentDate, calendarEvent) {
  const { transporter, from } = await getMailSender(getAuth);

  const dateStr = appointmentDate.toLocaleString('de-AT', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Vienna',
  });

  const mailOptions = {
    from,
    to: lead.email,
    subject: `Ihre PV-Anfrage – Beratungstermin am ${dateStr}`,
    text: [
      `Sehr geehrte/r ${lead.name || 'Interessent/in'},`,
      '',
      'vielen Dank für Ihre Anfrage zur Photovoltaikanlage.',
      '',
      'Ich freue mich, Ihnen einen Beratungstermin anbieten zu können:',
      `📅 ${dateStr}`,
      '',
      'Ich werde mich bei Ihnen melden, um den Termin zu bestätigen.',
      '',
      'Bei Fragen erreichen Sie mich unter:',
      `📞 ${process.env.MY_PHONE || ''}`,
      `✉️  ${process.env.MY_EMAIL || ''}`,
      '',
      process.env.EMAIL_SIGNATURE || `Mit freundlichen Grüßen,\n${process.env.MY_NAME}`,
    ].join('\n'),
  };

  await transporter.sendMail(mailOptions);
  console.log(`Confirmation email sent to ${lead.email}`);
}

async function scheduleAppointment(lead, emailData) {
  try {
    const appointmentDate = getAppointmentDate();
    const calendarEvent = await createCalendarEvent(lead, appointmentDate);
    console.log(`Calendar event created: ${calendarEvent.htmlLink}`);

    if (lead.email) {
      await sendConfirmationEmail(lead, appointmentDate, calendarEvent);
    }

    return { appointmentDate, calendarEvent };
  } catch (err) {
    console.error('Scheduling error:', err.message);
    return null;
  }
}

module.exports = {
  scheduleAppointment,
  createCalendarEvent,
  sendConfirmationEmail,
  leadAddressLine,
  getAuth,
};
