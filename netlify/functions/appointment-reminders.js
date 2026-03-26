/**
 * Appointment Reminders — Yoga Bible
 * Scheduled function that sends reminders for upcoming appointments.
 *
 * Runs via Netlify scheduled functions or can be triggered manually.
 * POST /.netlify/functions/appointment-reminders
 *
 * Sends:
 *  - 24-hour reminder email (the day before)
 *  - 24-hour reminder SMS to client (with cancel/reschedule links)
 *  - 24-hour reminder SMS to admin
 *  - 1-hour reminder email (same day)
 *  - Photo session preparation email (24h before, with styling guide)
 */

const crypto = require('crypto');
const { getDb, updateDoc } = require('./shared/firestore');
const { jsonResponse, optionsResponse, escapeHtml } = require('./shared/utils');
const { sendRawEmail, getSignatureHtml, getSignaturePlain } = require('./shared/email-service');
const { CONFIG } = require('./shared/config');
const { sendSMS, normalizePhone } = require('./shared/sms-service');

const COLLECTION = 'appointments';
const TOKEN_SECRET = process.env.UNSUBSCRIBE_SECRET || 'yb-appt-secret';
const ADMIN_PHONE = '+4553881209';

// Netlify scheduled function config
exports.config = {
  schedule: '0 7,12 * * *' // Run at 7am and 12pm Copenhagen time daily
};

function generateToken(appointmentId, email) {
  const hmac = crypto.createHmac('sha256', TOKEN_SECRET);
  hmac.update(appointmentId + ':' + email.toLowerCase().trim());
  return hmac.digest('hex');
}

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
    let sentSms = 0;
    let sentPhotoPrep = 0;

    for (const doc of snapshot.docs) {
      const appt = { id: doc.id, ...doc.data() };
      const apptDateTime = new Date(appt.date + 'T' + appt.time + ':00');
      const hoursUntil = (apptDateTime.getTime() - now.getTime()) / (1000 * 60 * 60);

      // 24-hour reminder: between 20-28 hours before
      if (hoursUntil > 20 && hoursUntil <= 28 && !appt.reminder_24h_sent) {
        // Email reminder to client
        await send24hReminder(appt);

        // SMS reminder to client (with manage links)
        await sendClientReminderSMS(appt).catch(err => {
          console.error('[appointment-reminders] Client SMS error (non-blocking):', err.message);
        });

        // SMS reminder to admin
        await sendAdminReminderSMS(appt).catch(err => {
          console.error('[appointment-reminders] Admin SMS error (non-blocking):', err.message);
        });
        sentSms++;

        // Photo session: send preparation email
        if (appt.type === 'photo-session' && !appt.photo_prep_sent) {
          await sendPhotoSessionPrepEmail(appt).catch(err => {
            console.error('[appointment-reminders] Photo prep email error (non-blocking):', err.message);
          });
          await updateDoc(COLLECTION, appt.id, { photo_prep_sent: true });
          sentPhotoPrep++;
        }

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

    console.log('[appointment-reminders] Sent ' + sent24h + ' 24h reminders, ' + sent1h + ' 1h reminders, ' + sentSms + ' SMS pairs, ' + sentPhotoPrep + ' photo prep emails');

    return jsonResponse(200, {
      ok: true,
      reminders_24h: sent24h,
      reminders_1h: sent1h,
      sms_sent: sentSms,
      photo_prep_sent: sentPhotoPrep,
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

function formatDateEn(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return days[d.getDay()] + ', ' + months[d.getMonth()] + ' ' + d.getDate();
}

// ═══════════════════════════════════════════════════════════════════
// SMS REMINDERS
// ═══════════════════════════════════════════════════════════════════

// ─── Client SMS Reminder (24h before) ──────────────────────────────
async function sendClientReminderSMS(appt) {
  const phone = normalizePhone(appt.client_phone);
  if (!phone) {
    console.log('[appointment-reminders] No valid phone for client SMS, skipping');
    return;
  }

  const token = generateToken(appt.id, appt.client_email);
  const baseUrl = CONFIG.SITE_URL;
  const manageUrl = baseUrl + '/appointment?id=' + appt.id + '&email=' + encodeURIComponent(appt.client_email) + '&token=' + token;
  const locationShort = appt.location === 'online' ? 'Online' : 'Christianshavn, Torvegade 66';

  const message = 'Hej ' + (appt.client_name || '').split(' ')[0] + '! ' +
    'Paamindelse: ' + (appt.type_name_da || 'Aftale') + ' i morgen kl. ' + appt.time + ' — ' + locationShort + '. ' +
    'Flyt/aflys: ' + manageUrl + ' — Yoga Bible';

  const result = await sendSMS(phone, message);
  if (result.success) {
    console.log('[appointment-reminders] Client reminder SMS sent to ' + phone);
  } else {
    console.log('[appointment-reminders] Client SMS failed: ' + result.error);
  }
  return result;
}

// ─── Admin SMS Reminder (24h before) ───────────────────────────────
async function sendAdminReminderSMS(appt) {
  const locationShort = appt.location === 'online' ? 'Online' : 'Studio';

  const message = 'Aftale i morgen: ' + (appt.client_name || 'Ukendt') + ' — ' +
    (appt.type_name_da || appt.type) + ' kl. ' + appt.time + ' (' + locationShort + '). ' +
    'Tlf: ' + (appt.client_phone || 'N/A');

  const result = await sendSMS(ADMIN_PHONE, message);
  if (result.success) {
    console.log('[appointment-reminders] Admin reminder SMS sent');
  } else {
    console.log('[appointment-reminders] Admin SMS failed: ' + result.error);
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════
// EMAIL REMINDERS
// ═══════════════════════════════════════════════════════════════════

// ─── 24-Hour Reminder Email ────────────────────────────────────────
async function send24hReminder(appt) {
  const orange = '#f75c03';
  const locationDa = appt.location === 'online' ? 'Online' : 'Christianshavn, Torvegade 66, 1400 København K';

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
    '<p style="font-size:13px;color:#888;">&#127468;&#127463; Reminder: You have an appointment tomorrow at ' + appt.time + '. ' + (appt.location === 'online' ? 'Online meeting.' : 'Christianshavn, Torvegade 66, 1400 Copenhagen.') + '</p>' +
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

// ─── 1-Hour Reminder Email ─────────────────────────────────────────
async function send1hReminder(appt) {
  const orange = '#f75c03';
  const locationDa = appt.location === 'online' ? 'Online' : 'Christianshavn, Torvegade 66, 1400 København K';

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

// ═══════════════════════════════════════════════════════════════════
// PHOTO SESSION PREPARATION EMAIL
// ═══════════════════════════════════════════════════════════════════

async function sendPhotoSessionPrepEmail(appt) {
  const orange = '#f75c03';
  const dark = '#0F0F0F';
  const muted = '#6F6A66';
  const border = '#E8E4E0';
  const lightBg = '#F5F3F0';
  const warmWhite = '#FFFCF9';

  const dateDa = formatDateDa(appt.date);
  const dateEn = formatDateEn(appt.date);

  // Tip item builder — clean card-style
  function tip(emoji, titleDa, descDa) {
    return '<tr><td style="padding:12px 0;border-bottom:1px solid ' + border + ';">' +
      '<table cellpadding="0" cellspacing="0" border="0" style="width:100%;"><tr>' +
      '<td style="width:40px;vertical-align:top;padding-top:2px;font-size:22px;">' + emoji + '</td>' +
      '<td style="vertical-align:top;">' +
      '<p style="margin:0 0 2px;font-weight:700;color:' + dark + ';font-size:15px;">' + titleDa + '</p>' +
      '<p style="margin:0;color:' + muted + ';font-size:14px;line-height:1.5;">' + descDa + '</p>' +
      '</td></tr></table></td></tr>';
  }

  const html = '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:' + dark + ';line-height:1.65;font-size:16px;max-width:600px;margin:0 auto;">' +

    // Header
    '<div style="background:' + dark + ';padding:28px 32px;border-radius:12px 12px 0 0;">' +
    '<p style="color:' + orange + ';font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin:0 0 8px;">&#128247; GUIDE</p>' +
    '<h1 style="color:#fff;margin:0;font-size:24px;line-height:1.3;">Sådan forbereder du dig til en yogafotosession</h1>' +
    '</div>' +

    // Body
    '<div style="background:' + warmWhite + ';padding:28px 32px;border:1px solid ' + border + ';border-top:none;border-radius:0 0 12px 12px;">' +

    '<p>Hej <strong>' + escapeHtml(appt.client_name) + '</strong>,</p>' +
    '<p>Vi glæder os til din fotosession i morgen, <strong>' + dateDa + '</strong> kl. <strong>' + appt.time + '</strong>!</p>' +
    '<p>Du behøver ikke "præstere" — vi guider dig roligt igennem. Med lidt forberedelse får du et endnu stærkere resultat.</p>' +

    // Pinterest moodboard tip — highlighted
    '<div style="background:' + lightBg + ';border-left:3px solid ' + orange + ';border-radius:0 8px 8px 0;padding:16px 20px;margin:20px 0;">' +
    '<p style="margin:0 0 6px;font-weight:700;color:' + dark + ';font-size:15px;">&#128204; Lav et lille moodboard</p>' +
    '<p style="margin:0;color:' + muted + ';font-size:14px;line-height:1.55;">Hop på <a href="https://www.pinterest.com/search/pins/?q=yoga%20photography" style="color:' + orange + ';font-weight:600;">Pinterest</a> og søg på "yoga photography", "yoga poses", eller "yoga portraits". Gem 10–15 billeder der rammer din stil — poser, stemninger, lys, vinkler. Lav et album du kan vise os inden vi starter. Det gør det meget nemmere for os at ramme præcis det udtryk, du drømmer om.</p>' +
    '</div>' +

    // Tips grid
    '<table cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:20px 0;">' +
    tip('&#128167;', 'Kom hydreret', 'Drik vand i timerne op til — det hjælper både energi og udtryk.') +
    tip('&#128085;', 'Medbring 2–3 outfits', 'Vi har omklædning. Tænk i forskellige looks: klassisk, farver, lag.') +
    tip('&#128140;', 'Kom frisk', 'En enkel "clean" stil fungerer bedst. Undgå tunge cremer/olie før session.') +
    tip('&#129336;', 'Giv dig tid til at varme op', 'Du får ro til at lande i kroppen, så dybere stillinger føles trygge.') +
    tip('&#127890;', 'Tag dit eget gear med, hvis du vil', 'Vi har måtte, men du er velkommen til at medbringe egen måtte/props.') +
    '</table>' +

    // Final note
    '<p style="margin-top:20px;">Vi sørger for resten — lys, vinkler og stemning. Du skal bare møde op, være dig selv og nyde det.</p>' +

    '<div style="text-align:center;margin:24px 0;">' +
    '<a href="https://www.pinterest.com/search/pins/?q=yoga%20photography%20poses" style="display:inline-block;padding:12px 28px;background:' + orange + ';color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;">&#128204; Find inspiration på Pinterest</a>' +
    '</div>' +

    // English summary
    '<div style="background:' + lightBg + ';border-radius:8px;padding:16px 20px;margin:20px 0;">' +
    '<p style="font-size:13px;color:#888;margin:0 0 6px;">&#127468;&#127463; <strong>Preparing for your yoga photo session</strong></p>' +
    '<p style="font-size:13px;color:#888;margin:0;line-height:1.5;">' +
    'We\'re looking forward to seeing you tomorrow, ' + dateEn + ' at ' + appt.time + '! ' +
    'A great way to prepare: browse <a href="https://www.pinterest.com/search/pins/?q=yoga%20photography" style="color:' + orange + ';">Pinterest</a> for "yoga photography" — save 10–15 images that match your vision (poses, mood, lighting). ' +
    'Also: stay hydrated, bring 2–3 outfits, keep makeup minimal, warm up before we start, and bring your own mat/props if you prefer. We\'ll handle the rest — just show up and enjoy it!</p>' +
    '</div>' +

    getSignatureHtml() +
    '</div></div>';

  const text = 'Hej ' + appt.client_name + ',\n\n' +
    'Vi glaeder os til din fotosession i morgen, ' + dateDa + ' kl. ' + appt.time + '!\n\n' +
    'FORBEREDELSE:\n' +
    '- Lav et moodboard: Gaa paa Pinterest, soeg "yoga photography", gem 10-15 billeder der rammer din stil\n' +
    '- Kom hydreret\n' +
    '- Medbring 2-3 outfits\n' +
    '- Kom frisk (undgaa tunge cremer/olie)\n' +
    '- Giv dig tid til at varme op\n' +
    '- Tag dit eget gear med, hvis du vil\n\n' +
    'Vi soerger for resten!\n\n' +
    getSignaturePlain();

  return sendRawEmail({
    to: appt.client_email,
    subject: '📷 I morgen: Din yogafotosession — sådan forbereder du dig',
    html,
    text
  });
}
