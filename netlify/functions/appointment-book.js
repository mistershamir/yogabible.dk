/**
 * Appointment Booking — Yoga Bible (Public)
 * Public endpoint for clients to book, cancel, or reschedule appointments.
 *
 * POST /.netlify/functions/appointment-book
 *   action: "book"       → Create new appointment
 *   action: "cancel"     → Cancel appointment (requires token)
 *   action: "reschedule" → Reschedule appointment (requires token)
 *   action: "slots"      → Get available time slots for a date
 *   action: "settings"   → Get public booking settings (types, durations)
 */

const crypto = require('crypto');
const { getDb, addDoc, updateDoc, serverTimestamp } = require('./shared/firestore');
const { jsonResponse, optionsResponse, escapeHtml } = require('./shared/utils');
const { sendRawEmail, getSignatureHtml, getSignaturePlain } = require('./shared/email-service');
const { CONFIG } = require('./shared/config');

const COLLECTION = 'appointments';
const SETTINGS_COLLECTION = 'appointment_settings';
const TOKEN_SECRET = process.env.UNSUBSCRIBE_SECRET || 'yb-appt-secret';

// ─── Defaults ───────────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  types: [
    { id: 'info-session', name_da: 'Gratis infomøde', name_en: 'Free Info Session', duration: 30, color: '#f75c03' },
    { id: 'consultation', name_da: 'Online konsultation', name_en: 'Online Consultation', duration: 30, color: '#3f99a5' },
    { id: 'intro-class', name_da: 'Gratis prøvetime', name_en: 'Free Trial Class', duration: 60, color: '#4CAF50' }
  ],
  working_hours: { start: '09:00', end: '18:00' },
  slot_interval: 30, // minutes between slots
  blocked_days: [0], // 0=Sunday
  buffer_hours: 2,   // minimum hours before booking
  max_days_ahead: 60, // how far in advance
  timezone: 'Europe/Copenhagen'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();
  if (event.httpMethod !== 'POST') return jsonResponse(405, { ok: false, error: 'POST only' });

  try {
    const body = JSON.parse(event.body || '{}');
    const action = body.action;

    switch (action) {
      case 'slots': return await getSlots(body);
      case 'settings': return await getSettings();
      case 'book': return await bookAppointment(body);
      case 'cancel': return await cancelAppointment(body);
      case 'reschedule': return await rescheduleAppointment(body);
      default: return jsonResponse(400, { ok: false, error: 'Unknown action: ' + action });
    }
  } catch (err) {
    console.error('[appointment-book] Error:', err.message);
    return jsonResponse(500, { ok: false, error: err.message });
  }
};

// ─── Token helpers ──────────────────────────────────────────────────
function generateToken(appointmentId, email) {
  const hmac = crypto.createHmac('sha256', TOKEN_SECRET);
  hmac.update(appointmentId + ':' + email.toLowerCase().trim());
  return hmac.digest('hex');
}

function verifyToken(appointmentId, email, token) {
  return generateToken(appointmentId, email) === token;
}

// ─── Get Settings ───────────────────────────────────────────────────
async function getSettings() {
  try {
    const db = getDb();
    const doc = await db.collection(SETTINGS_COLLECTION).doc('default').get();
    if (doc.exists) {
      return jsonResponse(200, { ok: true, data: doc.data() });
    }
  } catch (e) {
    console.log('[appointment-book] Settings not found, using defaults');
  }
  return jsonResponse(200, { ok: true, data: DEFAULT_SETTINGS });
}

// ─── Get Available Slots ────────────────────────────────────────────
async function getSlots(body) {
  const { date, type } = body;
  if (!date) return jsonResponse(400, { ok: false, error: 'Date required' });

  // Load settings
  let settings = DEFAULT_SETTINGS;
  try {
    const db = getDb();
    const doc = await db.collection(SETTINGS_COLLECTION).doc('default').get();
    if (doc.exists) settings = { ...DEFAULT_SETTINGS, ...doc.data() };
  } catch (e) { /* use defaults */ }

  // Check if day is blocked
  const dayOfWeek = new Date(date + 'T12:00:00').getDay();
  if ((settings.blocked_days || []).includes(dayOfWeek)) {
    return jsonResponse(200, { ok: true, data: { slots: [], blocked: true } });
  }

  // Check blocked dates
  if ((settings.blocked_dates || []).includes(date)) {
    return jsonResponse(200, { ok: true, data: { slots: [], blocked: true } });
  }

  // Get existing appointments for the date
  const db = getDb();
  const snapshot = await db.collection(COLLECTION)
    .where('date', '==', date)
    .where('status', 'in', ['confirmed', 'rescheduled'])
    .get();

  const booked = snapshot.docs.map(d => {
    const data = d.data();
    return { time: data.time, duration: data.duration || 30 };
  });

  // Determine duration for requested type
  const typeConfig = (settings.types || DEFAULT_SETTINGS.types).find(t => t.id === type);
  const duration = typeConfig ? typeConfig.duration : 30;

  // Generate slots
  const { start, end } = settings.working_hours || DEFAULT_SETTINGS.working_hours;
  const interval = settings.slot_interval || 30;
  const [startH, startM] = start.split(':').map(Number);
  const [endH, endM] = end.split(':').map(Number);
  const startMin = startH * 60 + startM;
  const endMin = endH * 60 + endM;

  // Calculate buffer
  const now = new Date();
  const bufferHours = settings.buffer_hours || 2;
  const bufferTime = new Date(now.getTime() + bufferHours * 60 * 60 * 1000);
  const isToday = date === now.toISOString().slice(0, 10);

  const slots = [];
  for (let m = startMin; m + duration <= endMin; m += interval) {
    const hh = String(Math.floor(m / 60)).padStart(2, '0');
    const mm = String(m % 60).padStart(2, '0');
    const slotTime = hh + ':' + mm;

    // Check buffer for today
    if (isToday) {
      const slotDate = new Date(date + 'T' + slotTime + ':00');
      if (slotDate <= bufferTime) continue;
    }

    // Check conflicts with existing bookings
    const slotStart = m;
    const slotEnd = m + duration;
    const conflict = booked.some(b => {
      const [bh, bm] = b.time.split(':').map(Number);
      const bookedStart = bh * 60 + bm;
      const bookedEnd = bookedStart + (b.duration || 30);
      return slotStart < bookedEnd && slotEnd > bookedStart;
    });

    slots.push({ time: slotTime, available: !conflict });
  }

  return jsonResponse(200, { ok: true, data: { slots, date } });
}

// ─── Book Appointment ───────────────────────────────────────────────
async function bookAppointment(body) {
  const { date, time, type, name, email, phone, message } = body;

  if (!date || !time || !name || !email) {
    return jsonResponse(400, { ok: false, error: 'Missing required fields' });
  }

  // Validate email format
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonResponse(400, { ok: false, error: 'Invalid email format' });
  }

  // Load settings for type info
  let settings = DEFAULT_SETTINGS;
  try {
    const db = getDb();
    const doc = await db.collection(SETTINGS_COLLECTION).doc('default').get();
    if (doc.exists) settings = { ...DEFAULT_SETTINGS, ...doc.data() };
  } catch (e) { /* defaults */ }

  const typeConfig = (settings.types || DEFAULT_SETTINGS.types).find(t => t.id === type) || settings.types[0];
  const duration = typeConfig ? typeConfig.duration : 30;

  // Create appointment document
  const appointmentData = {
    date,
    time,
    duration,
    type: type || 'info-session',
    type_name_da: typeConfig.name_da,
    type_name_en: typeConfig.name_en,
    client_name: name.trim(),
    client_email: email.toLowerCase().trim(),
    client_phone: phone || '',
    message: message || '',
    status: 'confirmed',
    location: type === 'consultation' ? 'online' : 'studio',
    source: body.source || 'website',
    reminder_sent: false,
    reminder_24h_sent: false
  };

  const id = await addDoc(COLLECTION, appointmentData);
  const token = generateToken(id, email);

  // Send confirmation email to client
  await sendClientConfirmation(id, appointmentData, token).catch(err => {
    console.error('[appointment-book] Client email error (non-blocking):', err.message);
  });

  // Send admin notification
  await sendAdminNotification(id, appointmentData).catch(err => {
    console.error('[appointment-book] Admin email error (non-blocking):', err.message);
  });

  return jsonResponse(201, { ok: true, id, token });
}

// ─── Cancel Appointment ─────────────────────────────────────────────
async function cancelAppointment(body) {
  const { id, email, token, reason } = body;
  if (!id || !email || !token) {
    return jsonResponse(400, { ok: false, error: 'Missing id, email, or token' });
  }

  if (!verifyToken(id, email, token)) {
    return jsonResponse(403, { ok: false, error: 'Invalid token' });
  }

  const doc = await require('./shared/firestore').getDoc(COLLECTION, id);
  if (!doc) return jsonResponse(404, { ok: false, error: 'Appointment not found' });
  if (doc.status === 'cancelled') return jsonResponse(400, { ok: false, error: 'Already cancelled' });

  await updateDoc(COLLECTION, id, {
    status: 'cancelled',
    cancel_reason: reason || '',
    cancelled_at: new Date().toISOString()
  });

  // Send cancellation confirmation
  await sendCancellationEmail(doc).catch(err => {
    console.error('[appointment-book] Cancel email error:', err.message);
  });

  // Notify admin
  await sendAdminCancellationNotice(doc).catch(err => {
    console.error('[appointment-book] Admin cancel notice error:', err.message);
  });

  return jsonResponse(200, { ok: true });
}

// ─── Reschedule Appointment ─────────────────────────────────────────
async function rescheduleAppointment(body) {
  const { id, email, token, new_date, new_time } = body;
  if (!id || !email || !token || !new_date || !new_time) {
    return jsonResponse(400, { ok: false, error: 'Missing required fields' });
  }

  if (!verifyToken(id, email, token)) {
    return jsonResponse(403, { ok: false, error: 'Invalid token' });
  }

  const doc = await require('./shared/firestore').getDoc(COLLECTION, id);
  if (!doc) return jsonResponse(404, { ok: false, error: 'Appointment not found' });
  if (doc.status === 'cancelled') return jsonResponse(400, { ok: false, error: 'Cannot reschedule cancelled appointment' });

  const oldDate = doc.date;
  const oldTime = doc.time;

  await updateDoc(COLLECTION, id, {
    date: new_date,
    time: new_time,
    status: 'rescheduled',
    rescheduled_from: oldDate + ' ' + oldTime,
    reminder_sent: false,
    reminder_24h_sent: false
  });

  const newToken = generateToken(id, email);

  // Send reschedule confirmation
  await sendRescheduleEmail({ ...doc, date: new_date, time: new_time }, oldDate, oldTime, id, newToken).catch(err => {
    console.error('[appointment-book] Reschedule email error:', err.message);
  });

  // Notify admin
  await sendAdminRescheduleNotice(doc, new_date, new_time).catch(err => {
    console.error('[appointment-book] Admin reschedule notice error:', err.message);
  });

  return jsonResponse(200, { ok: true, token: newToken });
}

// ═══════════════════════════════════════════════════════════════════
// EMAIL TEMPLATES
// ═══════════════════════════════════════════════════════════════════

function formatDateDa(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const days = ['søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag'];
  const months = ['januar', 'februar', 'marts', 'april', 'maj', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'december'];
  return days[d.getDay()] + ' d. ' + d.getDate() + '. ' + months[d.getMonth()] + ' ' + d.getFullYear();
}

function formatDateEn(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return days[d.getDay()] + ', ' + months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
}

function buildIcsContent(appointment, id) {
  const dateClean = appointment.date.replace(/-/g, '');
  const timeClean = appointment.time.replace(/:/g, '') + '00';
  const durationMin = appointment.duration || 30;
  const endH = Math.floor((parseInt(appointment.time.split(':')[0]) * 60 + parseInt(appointment.time.split(':')[1]) + durationMin) / 60);
  const endM = (parseInt(appointment.time.split(':')[0]) * 60 + parseInt(appointment.time.split(':')[1]) + durationMin) % 60;
  const endTime = String(endH).padStart(2, '0') + String(endM).padStart(2, '0') + '00';
  const location = appointment.location === 'online' ? 'Online (link sendes separat)' : 'Yoga Bible, Torvegade 66, 1400 København K';

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Yoga Bible//Appointment//DA',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    'DTSTART;TZID=Europe/Copenhagen:' + dateClean + 'T' + timeClean,
    'DTEND;TZID=Europe/Copenhagen:' + dateClean + 'T' + endTime,
    'SUMMARY:' + (appointment.type_name_en || 'Appointment') + ' - Yoga Bible',
    'DESCRIPTION:' + (appointment.type_name_en || 'Appointment') + ' at Yoga Bible',
    'LOCATION:' + location,
    'UID:' + id + '@yogabible.dk',
    'STATUS:CONFIRMED',
    'BEGIN:VALARM',
    'TRIGGER:-PT1H',
    'ACTION:DISPLAY',
    'DESCRIPTION:Reminder: ' + (appointment.type_name_en || 'Appointment') + ' at Yoga Bible',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');
}

// ─── Client Confirmation ────────────────────────────────────────────
async function sendClientConfirmation(id, appointment, token) {
  const orange = '#f75c03';
  const baseUrl = CONFIG.SITE_URL;
  const manageUrl = baseUrl + '/appointment?id=' + id + '&email=' + encodeURIComponent(appointment.client_email) + '&token=' + token;
  const cancelUrl = manageUrl + '&action=cancel';
  const rescheduleUrl = manageUrl + '&action=reschedule';

  const dateDa = formatDateDa(appointment.date);
  const dateEn = formatDateEn(appointment.date);
  const locationDa = appointment.location === 'online' ? 'Online (link sendes separat)' : 'Yoga Bible, Torvegade 66, 1400 København K';
  const locationEn = appointment.location === 'online' ? 'Online (link sent separately)' : 'Yoga Bible, Torvegade 66, 1400 København K';

  const html = '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;line-height:1.65;font-size:16px;max-width:600px;margin:0 auto;">' +
    '<div style="background:' + orange + ';padding:24px 32px;border-radius:12px 12px 0 0;">' +
    '<h1 style="color:#fff;margin:0;font-size:22px;">&#128197; Aftale bekræftet</h1>' +
    '</div>' +
    '<div style="background:#FFFCF9;padding:28px 32px;border:1px solid #E8E4E0;border-top:none;border-radius:0 0 12px 12px;">' +
    '<p>Hej <strong>' + escapeHtml(appointment.client_name) + '</strong>,</p>' +
    '<p>Din aftale er nu bekræftet! Her er detaljerne:</p>' +
    '<div style="background:#F5F3F0;border-radius:8px;padding:16px 20px;margin:16px 0;">' +
    '<table style="width:100%;border-collapse:collapse;font-size:15px;">' +
    '<tr><td style="padding:6px 12px 6px 0;font-weight:bold;color:#6F6A66;width:100px;">Type:</td><td>' + escapeHtml(appointment.type_name_da || appointment.type) + '</td></tr>' +
    '<tr><td style="padding:6px 12px 6px 0;font-weight:bold;color:#6F6A66;">Dato:</td><td>' + dateDa + '</td></tr>' +
    '<tr><td style="padding:6px 12px 6px 0;font-weight:bold;color:#6F6A66;">Tid:</td><td>' + appointment.time + '</td></tr>' +
    '<tr><td style="padding:6px 12px 6px 0;font-weight:bold;color:#6F6A66;">Varighed:</td><td>' + appointment.duration + ' min</td></tr>' +
    '<tr><td style="padding:6px 12px 6px 0;font-weight:bold;color:#6F6A66;">Sted:</td><td>' + locationDa + '</td></tr>' +
    '</table>' +
    '</div>' +
    '<div style="margin:24px 0;text-align:center;">' +
    '<a href="' + rescheduleUrl + '" style="display:inline-block;padding:10px 24px;background:' + orange + ';color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;margin:0 6px;">Flyt aftale</a>' +
    '<a href="' + cancelUrl + '" style="display:inline-block;padding:10px 24px;background:#fff;color:#6F6A66;text-decoration:none;border-radius:8px;border:1px solid #E8E4E0;margin:0 6px;">Aflys aftale</a>' +
    '</div>' +
    '<p style="font-size:13px;color:#888;">&#127468;&#127463; Appointment confirmed: ' + dateEn + ' at ' + appointment.time + ' (' + (appointment.duration || 30) + ' min). ' + locationEn + '</p>' +
    '<p style="font-size:13px;color:#888;">To reschedule or cancel, use the buttons above or reply to this email.</p>' +
    getSignatureHtml() +
    '</div>' +
    '</div>';

  const text = 'Hej ' + appointment.client_name + ',\n\n' +
    'Din aftale er bekræftet!\n\n' +
    'Type: ' + (appointment.type_name_da || appointment.type) + '\n' +
    'Dato: ' + dateDa + '\n' +
    'Tid: ' + appointment.time + '\n' +
    'Varighed: ' + appointment.duration + ' min\n' +
    'Sted: ' + locationDa + '\n\n' +
    'Flyt aftale: ' + rescheduleUrl + '\n' +
    'Aflys aftale: ' + cancelUrl + '\n' +
    getSignaturePlain();

  // Build ICS attachment
  const icsContent = buildIcsContent(appointment, id);

  return sendRawEmail({
    to: appointment.client_email,
    subject: '✅ Aftale bekræftet — ' + (appointment.type_name_da || 'Yoga Bible') + ' (' + appointment.date + ')',
    html,
    text,
    attachments: [{
      filename: 'appointment.ics',
      content: icsContent,
      contentType: 'text/calendar; method=REQUEST'
    }]
  });
}

// ─── Admin Notification ─────────────────────────────────────────────
async function sendAdminNotification(id, appointment) {
  const html = '<div style="font-family:monospace;font-size:14px;line-height:1.6;">' +
    '<h3 style="color:#f75c03;">&#128197; Ny aftale booket</h3>' +
    '<table style="border-collapse:collapse;">' +
    '<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Navn:</td><td>' + escapeHtml(appointment.client_name) + '</td></tr>' +
    '<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Email:</td><td>' + escapeHtml(appointment.client_email) + '</td></tr>' +
    '<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Telefon:</td><td>' + escapeHtml(appointment.client_phone || '—') + '</td></tr>' +
    '<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Type:</td><td>' + escapeHtml(appointment.type_name_da || appointment.type) + '</td></tr>' +
    '<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Dato:</td><td>' + appointment.date + ' kl. ' + appointment.time + '</td></tr>' +
    '<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Varighed:</td><td>' + appointment.duration + ' min</td></tr>' +
    '<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Kilde:</td><td>' + escapeHtml(appointment.source || 'website') + '</td></tr>' +
    (appointment.message ? '<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Besked:</td><td>' + escapeHtml(appointment.message) + '</td></tr>' : '') +
    '</table></div>';

  return sendRawEmail({
    to: CONFIG.EMAIL_ADMIN,
    subject: '📅 Ny aftale: ' + appointment.client_name + ' — ' + appointment.date + ' kl. ' + appointment.time,
    html,
    text: 'Ny aftale: ' + appointment.client_name + ' (' + appointment.client_email + ') — ' + appointment.date + ' ' + appointment.time
  });
}

// ─── Cancellation Email ─────────────────────────────────────────────
async function sendCancellationEmail(appointment) {
  const orange = '#f75c03';
  const html = '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;line-height:1.65;font-size:16px;max-width:600px;margin:0 auto;">' +
    '<div style="background:#6F6A66;padding:24px 32px;border-radius:12px 12px 0 0;">' +
    '<h1 style="color:#fff;margin:0;font-size:22px;">&#10060; Aftale aflyst</h1>' +
    '</div>' +
    '<div style="background:#FFFCF9;padding:28px 32px;border:1px solid #E8E4E0;border-top:none;border-radius:0 0 12px 12px;">' +
    '<p>Hej <strong>' + escapeHtml(appointment.client_name) + '</strong>,</p>' +
    '<p>Din aftale den <strong>' + formatDateDa(appointment.date) + '</strong> kl. <strong>' + appointment.time + '</strong> er nu aflyst.</p>' +
    '<p>Vil du booke en ny tid? Du er altid velkommen:</p>' +
    '<div style="text-align:center;margin:20px 0;">' +
    '<a href="' + CONFIG.SITE_URL + '/link" style="display:inline-block;padding:12px 28px;background:' + orange + ';color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;">Book ny aftale</a>' +
    '</div>' +
    '<p style="font-size:13px;color:#888;">&#127468;&#127463; Your appointment on ' + formatDateEn(appointment.date) + ' at ' + appointment.time + ' has been cancelled.</p>' +
    getSignatureHtml() +
    '</div></div>';

  return sendRawEmail({
    to: appointment.client_email,
    subject: '❌ Aftale aflyst — ' + appointment.date,
    html,
    text: 'Hej ' + appointment.client_name + ',\n\nDin aftale den ' + appointment.date + ' kl. ' + appointment.time + ' er nu aflyst.\n\nBook ny aftale: ' + CONFIG.SITE_URL + '/link\n' + getSignaturePlain()
  });
}

// ─── Admin Cancel Notice ────────────────────────────────────────────
async function sendAdminCancellationNotice(appointment) {
  return sendRawEmail({
    to: CONFIG.EMAIL_ADMIN,
    subject: '❌ Aftale aflyst: ' + appointment.client_name + ' — ' + appointment.date,
    html: '<p><strong>' + escapeHtml(appointment.client_name) + '</strong> (' + escapeHtml(appointment.client_email) + ') har aflyst sin aftale den ' + appointment.date + ' kl. ' + appointment.time + '.</p>',
    text: appointment.client_name + ' har aflyst sin aftale den ' + appointment.date + ' kl. ' + appointment.time
  });
}

// ─── Reschedule Email ───────────────────────────────────────────────
async function sendRescheduleEmail(appointment, oldDate, oldTime, id, token) {
  const orange = '#f75c03';
  const baseUrl = CONFIG.SITE_URL;
  const manageUrl = baseUrl + '/appointment?id=' + id + '&email=' + encodeURIComponent(appointment.client_email) + '&token=' + token;

  const icsContent = buildIcsContent(appointment, id);

  const html = '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;line-height:1.65;font-size:16px;max-width:600px;margin:0 auto;">' +
    '<div style="background:' + orange + ';padding:24px 32px;border-radius:12px 12px 0 0;">' +
    '<h1 style="color:#fff;margin:0;font-size:22px;">&#128260; Aftale flyttet</h1>' +
    '</div>' +
    '<div style="background:#FFFCF9;padding:28px 32px;border:1px solid #E8E4E0;border-top:none;border-radius:0 0 12px 12px;">' +
    '<p>Hej <strong>' + escapeHtml(appointment.client_name) + '</strong>,</p>' +
    '<p>Din aftale er blevet flyttet:</p>' +
    '<div style="background:#F5F3F0;border-radius:8px;padding:16px 20px;margin:16px 0;">' +
    '<p style="color:#999;text-decoration:line-through;margin:0 0 8px;">Tidligere: ' + formatDateDa(oldDate) + ' kl. ' + oldTime + '</p>' +
    '<p style="color:' + orange + ';font-weight:bold;margin:0;">Ny tid: ' + formatDateDa(appointment.date) + ' kl. ' + appointment.time + '</p>' +
    '</div>' +
    '<div style="margin:20px 0;text-align:center;">' +
    '<a href="' + manageUrl + '&action=cancel" style="display:inline-block;padding:10px 20px;background:#fff;color:#6F6A66;text-decoration:none;border-radius:8px;border:1px solid #E8E4E0;">Aflys aftale</a>' +
    '</div>' +
    '<p style="font-size:13px;color:#888;">&#127468;&#127463; Your appointment has been rescheduled to ' + formatDateEn(appointment.date) + ' at ' + appointment.time + '.</p>' +
    getSignatureHtml() +
    '</div></div>';

  return sendRawEmail({
    to: appointment.client_email,
    subject: '🔄 Aftale flyttet — ny tid: ' + appointment.date + ' kl. ' + appointment.time,
    html,
    text: 'Din aftale er flyttet.\nTidligere: ' + oldDate + ' ' + oldTime + '\nNy: ' + appointment.date + ' ' + appointment.time + '\n' + getSignaturePlain(),
    attachments: [{
      filename: 'appointment.ics',
      content: icsContent,
      contentType: 'text/calendar; method=REQUEST'
    }]
  });
}

// ─── Admin Reschedule Notice ────────────────────────────────────────
async function sendAdminRescheduleNotice(appointment, newDate, newTime) {
  return sendRawEmail({
    to: CONFIG.EMAIL_ADMIN,
    subject: '🔄 Aftale flyttet: ' + appointment.client_name + ' — ' + newDate + ' kl. ' + newTime,
    html: '<p><strong>' + escapeHtml(appointment.client_name) + '</strong> har flyttet sin aftale fra ' + appointment.date + ' ' + appointment.time + ' til <strong>' + newDate + ' kl. ' + newTime + '</strong>.</p>',
    text: appointment.client_name + ' har flyttet sin aftale til ' + newDate + ' kl. ' + newTime
  });
}
