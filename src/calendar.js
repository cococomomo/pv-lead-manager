'use strict';

require('./load-env');
const { getMailSender } = require('./mail-transport');

function leadAddressLine(lead) {
  const parts = [lead.street, lead.zip, lead.city].filter(Boolean);
  return parts.length ? parts.join(', ') : '';
}

// Beratungstermin: 3 Werktage ab jetzt, 10:00
function getAppointmentDate() {
  const date = new Date();
  let added = 0;
  while (added < 3) {
    date.setDate(date.getDate() + 1);
    const day = date.getDay();
    if (day !== 0 && day !== 6) added++;
  }
  date.setHours(10, 0, 0, 0);
  return date;
}

async function sendConfirmationEmail(lead, appointmentDate) {
  const { transporter, from } = await getMailSender();

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

/** Nach neuem Lead: Bestätigungs-Mail per SMTP (kein Google Kalender). */
async function scheduleAppointment(lead) {
  try {
    const appointmentDate = getAppointmentDate();
    if (lead.email) {
      await sendConfirmationEmail(lead, appointmentDate);
    }
    return { appointmentDate, calendarEvent: null };
  } catch (err) {
    console.error('Scheduling error:', err.message);
    return null;
  }
}

module.exports = {
  scheduleAppointment,
  sendConfirmationEmail,
  leadAddressLine,
};
