/**
 * Appointment Reminders — Yoga Bible
 * Scheduled function that sends reminders for upcoming appointments.
 *
 * Runs via Netlify scheduled functions or can be triggered manually.
 * POST /.netlify/functions/appointment-reminders
 *
 * Sends:
 *  - 24-hour reminder (the day before)
 *  - 1-hour reminder (same day)
 */

const { getDb, updateDoc } = require('./shared/firestore');
const { jsonResponse, optionsResponse, escapeHtml } = require('./shared/utils');
const { sendRawEmail, getSignatureHtml, getSignaturePlain } = require('./shared/email-service');
const { CONFIG } = require('./shared/config');

const COLLECTION = 'appointments';

// Netlify scheduled function config
exports.config = {
  schedule: '0 7,12 * * *' // Run at 7am and 12pm Copenhagen time daily
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  console.log('[appointment-reminders] Running reminder check...');

  try {
    const now = new Date();
    const db = getDb();

    // Get all confirmed/rescheduled appointments in the next 48 hours
    const today = now.toISOString().slice(0, 10);
    const twoDaysLater = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const snapshot = await db.collection(COLLECTION)
      .where('status', 'in', ['confirmed', 'rescheduled'])
      .where('date', '>=', today)
      .where('date', '<=', twoDaysLater)
      .get();

    let sent24h = 0;
    let sent1h = 0;

    for (const doc of snapshot.docs) {
      const appt = { id: doc.id, ...doc.data() };
      const apptDateTime = new Date(appt.date + 'T' + appt.time + ':00');
      const hoursUntil = (apptDateTime.getTime() - now.getTime()) / (1000 * 60 * 60);

      // 24-hour reminder: between 20-28 hours before
      if (hoursUntil > 20 && hoursUntil <= 28 && !appt.reminder_24h_sent) {
        await send24hReminder(appt);
        await updateDoc(COLLECTION, appt.id, { reminder_24h_sent: true });
        sent24h++;
      }

      // 1-hour reminder: between 0.5-1.5 hours before
      if (hoursUntil > 0.5 && hoursUntil <= 1.5 && !appt.reminder_sent) {
        await send1hReminder(appt);
        await updateDoc(COLLECTION, appt.id, { reminder_sent: true });
        sent1h++;
      }
    }

    console.log('[appointment-reminders] Sent ' + sent24h + ' 24h reminders, ' + sent1h + ' 1h reminders');

    return jsonResponse(200, {
      ok: true,
      reminders_24h: sent24h,
      reminders_1h: sent1h,
      total_upcoming: snapshot.size
    });
  } catch (err) {
    console.error('[appointment-reminders] Error:', err.message);
    return jsonResponse(500, { ok: false, error: err.message });
  }
};

// ─── Date Formatting ────────────────────────────────────────────────
function formatDateDa(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const days = ['søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag'];
  const months = ['januar', 'februar', 'marts', 'april', 'maj', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'december'];
  return days[d.getDay()] + ' d. ' + d.getDate() + '. ' + months[d.getMonth()];
}

// ─── 24-Hour Reminder ───────────────────────────────────────────────
async function send24hReminder(appt) {
  const orange = '#f75c03';
  const locationDa = appt.location === 'online' ? 'Online' : 'Yoga Bible, Torvegade 66, 1400 København K';

  const html = '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;line-height:1.65;font-size:16px;max-width:600px;margin:0 auto;">' +
    '<div style="background:' + orange + ';padding:24px 32px;border-radius:12px 12px 0 0;">' +
    '<h1 style="color:#fff;margin:0;font-size:22px;">&#128276; Påmindelse: Aftale i morgen</h1>' +
    '</div>' +
    '<div style="background:#FFFCF9;padding:28px 32px;border:1px solid #E8E4E0;border-top:none;border-radius:0 0 12px 12px;">' +
    '<p>Hej <strong>' + escapeHtml(appt.client_name) + '</strong>,</p>' +
    '<p>Venlig påmindelse om din aftale i morgen:</p>' +
    '<div style="background:#F5F3F0;border-radius:8px;padding:16px 20px;margin:16px 0;">' +
    '<p style="margin:4px 0;"><strong>' + escapeHtml(appt.type_name_da || appt.type) + '</strong></p>' +
    '<p style="margin:4px 0;">&#128197; ' + formatDateDa(appt.date) + ' kl. ' + appt.time + '</p>' +
    '<p style="margin:4px 0;">&#128205; ' + locationDa + '</p>' +
    '</div>' +
    (appt.location !== 'online' ? '<p style="font-size:14px;color:#666;">&#128663; <a href="' + CONFIG.STUDIO_MAPS_URL + '" style="color:' + orange + ';">Se rute til studiet</a></p>' : '') +
    '<p style="font-size:13px;color:#888;">&#127468;&#127463; Reminder: You have an appointment tomorrow at ' + appt.time + '. ' + (appt.location === 'online' ? 'Online meeting.' : 'Yoga Bible, Torvegade 66, Copenhagen.') + '</p>' +
    getSignatureHtml() +
    '</div></div>';

  const text = 'Hej ' + appt.client_name + ',\n\nPåmindelse: Du har en aftale i morgen.\n\n' +
    (appt.type_name_da || appt.type) + '\n' +
    formatDateDa(appt.date) + ' kl. ' + appt.time + '\n' +
    locationDa + '\n' + getSignaturePlain();

  return sendRawEmail({
    to: appt.client_email,
    subject: '🔔 Påmindelse: Aftale i morgen kl. ' + appt.time + ' — Yoga Bible',
    html,
    text
  });
}

// ─── 1-Hour Reminder ────────────────────────────────────────────────
async function send1hReminder(appt) {
  const orange = '#f75c03';
  const locationDa = appt.location === 'online' ? 'Online' : 'Yoga Bible, Torvegade 66, 1400 København K';

  const html = '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;line-height:1.65;font-size:16px;max-width:600px;margin:0 auto;">' +
    '<div style="background:' + orange + ';padding:24px 32px;border-radius:12px 12px 0 0;">' +
    '<h1 style="color:#fff;margin:0;font-size:22px;">&#9200; Din aftale starter snart!</h1>' +
    '</div>' +
    '<div style="background:#FFFCF9;padding:28px 32px;border:1px solid #E8E4E0;border-top:none;border-radius:0 0 12px 12px;">' +
    '<p>Hej <strong>' + escapeHtml(appt.client_name) + '</strong>,</p>' +
    '<p>Din aftale starter om ca. 1 time:</p>' +
    '<div style="background:#F5F3F0;border-radius:8px;padding:16px 20px;margin:16px 0;">' +
    '<p style="margin:4px 0;font-size:18px;font-weight:bold;color:' + orange + ';">' + appt.time + '</p>' +
    '<p style="margin:4px 0;">' + escapeHtml(appt.type_name_da || appt.type) + '</p>' +
    '<p style="margin:4px 0;">&#128205; ' + locationDa + '</p>' +
    '</div>' +
    (appt.location !== 'online' ? '<p><a href="' + CONFIG.STUDIO_MAPS_URL + '" style="color:' + orange + ';font-weight:bold;">&#128663; Åbn rute i Google Maps</a></p>' : '') +
    getSignatureHtml() +
    '</div></div>';

  return sendRawEmail({
    to: appt.client_email,
    subject: '⏰ Om 1 time: ' + (appt.type_name_da || 'Aftale') + ' kl. ' + appt.time,
    html,
    text: 'Hej ' + appt.client_name + ',\n\nDin aftale starter om ca. 1 time!\n\nKl. ' + appt.time + ' — ' + locationDa + '\n' + getSignaturePlain()
  });
}
