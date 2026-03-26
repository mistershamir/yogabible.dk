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
const { runSpamChecks } = require('./shared/spam-check');

const COLLECTION = 'appointments';
const SETTINGS_COLLECTION = 'appointment_settings';
const TOKEN_SECRET = process.env.UNSUBSCRIBE_SECRET || 'yb-appt-secret';

// Types that require admin approval (request-based, not instant confirmation)
const REQUEST_TYPES = ['intro-class', 'photo-session'];

// ─── Defaults ───────────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  types: [
    { id: 'info-session', name_da: 'Gratis infomøde', name_en: 'Free Info Session', duration: 30, color: '#f75c03' },
    { id: 'consultation', name_da: 'Online konsultation', name_en: 'Online Consultation', duration: 30, color: '#3f99a5' },
    { id: 'intro-class', name_da: 'Gratis prøvetime', name_en: 'Free Trial Class', duration: 60, color: '#4CAF50', request_only: true },
    { id: 'photo-session', name_da: 'Yoga Fotosession', name_en: 'Yoga Photo Session', duration: 60, color: '#1a1a1a', request_only: true }
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
      case 'photo-request': return await photoSessionRequest(body);
      case 'confirm-request': return await confirmRequest(body);
      case 'suggest-alternative': return await suggestAlternative(body);
      case 'accept-suggestion': return await acceptSuggestion(body);
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

  // ── Spam protection ─────────────────────────────────────────────
  const spamReason = await runSpamChecks({
    honeypotValue: body._hp,
    formOpenedAt:  body.formOpenedAt,
    db:            getDb(),
    collection:    COLLECTION,
    emailField:    'client_email',
    email,
    windowHours:   1
  });
  if (spamReason) {
    console.warn(`[appointment-book:book] Spam rejected (${spamReason}): ${email}`);
    return jsonResponse(201, { ok: true, id: 'spam', token: '', isRequest: false });
  }
  // ────────────────────────────────────────────────────────────────

  // Load settings for type info
  let settings = DEFAULT_SETTINGS;
  try {
    const db = getDb();
    const doc = await db.collection(SETTINGS_COLLECTION).doc('default').get();
    if (doc.exists) settings = { ...DEFAULT_SETTINGS, ...doc.data() };
  } catch (e) { /* defaults */ }

  const typeConfig = (settings.types || DEFAULT_SETTINGS.types).find(t => t.id === type) || settings.types[0];
  const duration = typeConfig ? typeConfig.duration : 30;

  const isRequest = REQUEST_TYPES.includes(type);

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
    status: isRequest ? 'pending_request' : 'confirmed',
    location: type === 'consultation' ? 'online' : 'studio',
    source: body.source || 'website',
    reminder_sent: false,
    reminder_24h_sent: false
  };

  const id = await addDoc(COLLECTION, appointmentData);
  const token = generateToken(id, email);

  if (isRequest) {
    // Request-based: send "request received" emails
    await sendRequestReceivedEmail(id, appointmentData).catch(err => {
      console.error('[appointment-book] Request received email error (non-blocking):', err.message);
    });
    await sendAdminRequestNotification(id, appointmentData, token).catch(err => {
      console.error('[appointment-book] Admin request email error (non-blocking):', err.message);
    });
  } else {
    // Direct booking: send confirmation emails
    await sendClientConfirmation(id, appointmentData, token).catch(err => {
      console.error('[appointment-book] Client email error (non-blocking):', err.message);
    });
    await sendAdminNotification(id, appointmentData).catch(err => {
      console.error('[appointment-book] Admin email error (non-blocking):', err.message);
    });
  }

  return jsonResponse(201, { ok: true, id, token, isRequest });
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

// ─── Photo Session Request ────────────────────────────────────────
async function photoSessionRequest(body) {
  const { name, email, phone, message, preferred_slots, location_pref, lang } = body;

  if (!name || !email || !preferred_slots || preferred_slots.length < 1) {
    return jsonResponse(400, { ok: false, error: 'Missing required fields (name, email, at least 1 date/time)' });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonResponse(400, { ok: false, error: 'Invalid email format' });
  }

  // ── Spam protection ─────────────────────────────────────────────
  const spamReason = await runSpamChecks({
    honeypotValue: body._hp,
    formOpenedAt:  body.formOpenedAt,
    db:            getDb(),
    collection:    COLLECTION,
    emailField:    'client_email',
    email,
    windowHours:   2
  });
  if (spamReason) {
    console.warn(`[appointment-book:photo] Spam rejected (${spamReason}): ${email}`);
    return jsonResponse(201, { ok: true, id: 'spam', token: '', isRequest: true });
  }
  // ────────────────────────────────────────────────────────────────

  const appointmentData = {
    date: preferred_slots[0].date,
    time: preferred_slots[0].time,
    duration: 60,
    type: 'photo-session',
    type_name_da: 'Yoga Fotosession',
    type_name_en: 'Yoga Photo Session',
    client_name: name.trim(),
    client_email: email.toLowerCase().trim(),
    client_phone: phone || '',
    message: message || '',
    location_pref: location_pref || 'studio',
    lang: lang || 'da',
    preferred_slots: preferred_slots, // [{date, time}, {date, time}, {date, time}]
    status: 'pending_request',
    location: 'studio',
    source: body.source || 'website-photo',
    reminder_sent: false,
    reminder_24h_sent: false
  };

  const id = await addDoc(COLLECTION, appointmentData);
  const token = generateToken(id, email);

  // Send request-received email to client
  await sendPhotoRequestReceivedEmail(id, appointmentData).catch(err => {
    console.error('[appointment-book] Photo request email error (non-blocking):', err.message);
  });

  // Send admin notification with the 3 options
  await sendAdminPhotoRequestNotification(id, appointmentData, token).catch(err => {
    console.error('[appointment-book] Admin photo request email error (non-blocking):', err.message);
  });

  return jsonResponse(201, { ok: true, id, token, isRequest: true });
}

// ─── Confirm Request (admin approves) ────────────────────────────
async function confirmRequest(body) {
  const { id, admin_token, slot_index } = body;
  if (!id || !admin_token) {
    return jsonResponse(400, { ok: false, error: 'Missing id or admin_token' });
  }

  // Verify admin token
  const expectedToken = crypto.createHmac('sha256', TOKEN_SECRET).update('admin-confirm:' + id).digest('hex');
  if (admin_token !== expectedToken) {
    return jsonResponse(403, { ok: false, error: 'Invalid admin token' });
  }

  const doc = await require('./shared/firestore').getDoc(COLLECTION, id);
  if (!doc) return jsonResponse(404, { ok: false, error: 'Appointment not found' });
  if (doc.status !== 'pending_request') return jsonResponse(400, { ok: false, error: 'Not a pending request' });

  // If photo-session with slot_index, pick that slot
  let confirmedDate = doc.date;
  let confirmedTime = doc.time;
  if (doc.preferred_slots && typeof slot_index === 'number' && doc.preferred_slots[slot_index]) {
    confirmedDate = doc.preferred_slots[slot_index].date;
    confirmedTime = doc.preferred_slots[slot_index].time;
  }

  await updateDoc(COLLECTION, id, {
    status: 'confirmed',
    date: confirmedDate,
    time: confirmedTime,
    confirmed_at: new Date().toISOString()
  });

  const confirmedDoc = { ...doc, date: confirmedDate, time: confirmedTime, status: 'confirmed' };
  const clientToken = generateToken(id, doc.client_email);

  // Send confirmation email to client
  await sendClientConfirmation(id, confirmedDoc, clientToken).catch(err => {
    console.error('[appointment-book] Confirm request email error:', err.message);
  });

  return jsonResponse(200, { ok: true, confirmed: true, date: confirmedDate, time: confirmedTime, duration: doc.duration });
}

// ─── Suggest Alternative (admin proposes different date/time) ─────
async function suggestAlternative(body) {
  const { id, admin_token, suggested_date, suggested_time, admin_message } = body;
  if (!id || !admin_token || !suggested_date || !suggested_time) {
    return jsonResponse(400, { ok: false, error: 'Missing required fields' });
  }

  const expectedToken = crypto.createHmac('sha256', TOKEN_SECRET).update('admin-confirm:' + id).digest('hex');
  if (admin_token !== expectedToken) {
    return jsonResponse(403, { ok: false, error: 'Invalid admin token' });
  }

  const doc = await require('./shared/firestore').getDoc(COLLECTION, id);
  if (!doc) return jsonResponse(404, { ok: false, error: 'Appointment not found' });

  await updateDoc(COLLECTION, id, {
    suggested_date,
    suggested_time,
    admin_message: admin_message || '',
    status: 'awaiting_client'
  });

  // Send suggestion email to client with accept link
  const acceptToken = generateToken(id, doc.client_email);
  await sendSuggestionEmail({ ...doc, suggested_date, suggested_time, admin_message }, id, acceptToken).catch(err => {
    console.error('[appointment-book] Suggestion email error:', err.message);
  });

  return jsonResponse(200, { ok: true });
}

// ─── Accept Suggestion (client accepts admin's proposed time) ─────
async function acceptSuggestion(body) {
  const { id, email, token } = body;
  if (!id || !email || !token) {
    return jsonResponse(400, { ok: false, error: 'Missing required fields' });
  }

  if (!verifyToken(id, email, token)) {
    return jsonResponse(403, { ok: false, error: 'Invalid token' });
  }

  const doc = await require('./shared/firestore').getDoc(COLLECTION, id);
  if (!doc) return jsonResponse(404, { ok: false, error: 'Appointment not found' });
  if (doc.status !== 'awaiting_client') return jsonResponse(400, { ok: false, error: 'Not awaiting client response' });

  await updateDoc(COLLECTION, id, {
    date: doc.suggested_date,
    time: doc.suggested_time,
    status: 'confirmed',
    confirmed_at: new Date().toISOString()
  });

  const confirmedDoc = { ...doc, date: doc.suggested_date, time: doc.suggested_time };
  const clientToken = generateToken(id, email);

  // Send confirmation to client
  await sendClientConfirmation(id, confirmedDoc, clientToken).catch(err => {
    console.error('[appointment-book] Accept suggestion email error:', err.message);
  });

  // Notify admin
  await sendRawEmail({
    to: CONFIG.EMAIL_ADMIN,
    subject: '✅ Anmodning accepteret: ' + doc.client_name + ' — ' + doc.suggested_date + ' kl. ' + doc.suggested_time,
    html: '<p><strong>' + escapeHtml(doc.client_name) + '</strong> har accepteret den foreslåede tid: <strong>' + doc.suggested_date + ' kl. ' + doc.suggested_time + '</strong>.</p>',
    text: doc.client_name + ' har accepteret den foreslåede tid: ' + doc.suggested_date + ' kl. ' + doc.suggested_time
  }).catch(err => {
    console.error('[appointment-book] Admin accept notice error:', err.message);
  });

  return jsonResponse(200, { ok: true, date: doc.suggested_date, time: doc.suggested_time, duration: doc.duration });
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
  const location = appointment.location === 'online' ? 'Online (link sendes separat)' : 'Yoga Bible, Christianshavn, Torvegade 66, 1400 København K';

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

function buildAdminIcsContent(appointment, id) {
  const dateClean = appointment.date.replace(/-/g, '');
  const timeClean = appointment.time.replace(/:/g, '') + '00';
  const durationMin = appointment.duration || 30;
  const endH = Math.floor((parseInt(appointment.time.split(':')[0]) * 60 + parseInt(appointment.time.split(':')[1]) + durationMin) / 60);
  const endM = (parseInt(appointment.time.split(':')[0]) * 60 + parseInt(appointment.time.split(':')[1]) + durationMin) % 60;
  const endTime = String(endH).padStart(2, '0') + String(endM).padStart(2, '0') + '00';
  const location = appointment.location === 'online' ? 'Online' : 'Yoga Bible, Christianshavn, Torvegade 66, 1400 København K';
  const summary = (appointment.type_name_da || 'Aftale') + ' — ' + (appointment.client_name || 'Klient');
  const description = (appointment.type_name_en || 'Appointment') + '\\n' +
    'Client: ' + (appointment.client_name || '') + '\\n' +
    'Email: ' + (appointment.client_email || '') + '\\n' +
    'Phone: ' + (appointment.client_phone || '—') +
    (appointment.message ? '\\nMessage: ' + appointment.message : '');

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Yoga Bible//Appointment Admin//DA',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    'DTSTART;TZID=Europe/Copenhagen:' + dateClean + 'T' + timeClean,
    'DTEND;TZID=Europe/Copenhagen:' + dateClean + 'T' + endTime,
    'SUMMARY:' + summary,
    'DESCRIPTION:' + description,
    'LOCATION:' + location,
    'UID:admin-' + id + '@yogabible.dk',
    'STATUS:CONFIRMED',
    'BEGIN:VALARM',
    'TRIGGER:-PT1H',
    'ACTION:DISPLAY',
    'DESCRIPTION:Om 1 time: ' + summary,
    'END:VALARM',
    'BEGIN:VALARM',
    'TRIGGER:-PT15M',
    'ACTION:DISPLAY',
    'DESCRIPTION:Om 15 min: ' + summary,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');
}

function buildGoogleCalendarUrl(appointment, id) {
  const dateClean = appointment.date.replace(/-/g, '');
  const h = parseInt(appointment.time.split(':')[0]);
  const m = parseInt(appointment.time.split(':')[1]);
  const durationMin = appointment.duration || 30;
  const endMin = h * 60 + m + durationMin;
  const endH = Math.floor(endMin / 60);
  const endM = endMin % 60;
  const startStr = dateClean + 'T' + String(h).padStart(2, '0') + String(m).padStart(2, '0') + '00';
  const endStr = dateClean + 'T' + String(endH).padStart(2, '0') + String(endM).padStart(2, '0') + '00';
  const location = appointment.location === 'online' ? 'Online' : 'Yoga Bible, Christianshavn, Torvegade 66, 1400 København K';
  const title = (appointment.type_name_en || 'Appointment') + ' - Yoga Bible';

  return 'https://calendar.google.com/calendar/render?action=TEMPLATE' +
    '&text=' + encodeURIComponent(title) +
    '&dates=' + startStr + '/' + endStr +
    '&ctz=Europe/Copenhagen' +
    '&details=' + encodeURIComponent(title) +
    '&location=' + encodeURIComponent(location);
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
  const locationDa = appointment.location === 'online' ? 'Online (link sendes separat)' : 'Christianshavn, Torvegade 66, 1400 København K';
  const locationEn = appointment.location === 'online' ? 'Online (link sent separately)' : 'Christianshavn, Torvegade 66, 1400 Copenhagen';

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
    '<div style="margin:16px 0;text-align:center;">' +
    '<a href="' + buildGoogleCalendarUrl(appointment, id) + '" style="display:inline-block;padding:8px 20px;background:#fff;color:#333;text-decoration:none;border-radius:8px;border:1px solid #E8E4E0;font-size:13px;margin:0 4px;">&#128197; Google Calendar</a>' +
    '</div>' +
    '<p style="font-size:12px;color:#aaa;text-align:center;margin:4px 0 16px;">' + 'En .ics kalenderfil er vedhæftet denne email (Apple Calendar, Outlook m.fl.)' + '</p>' +
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
  const locationDa = appointment.location === 'online' ? 'Online' : 'Christianshavn, Torvegade 66, 1400 København K';

  const html = '<div style="font-family:monospace;font-size:14px;line-height:1.6;">' +
    '<h3 style="color:#f75c03;">&#128197; Ny aftale booket</h3>' +
    '<table style="border-collapse:collapse;">' +
    '<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Navn:</td><td>' + escapeHtml(appointment.client_name) + '</td></tr>' +
    '<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Email:</td><td>' + escapeHtml(appointment.client_email) + '</td></tr>' +
    '<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Telefon:</td><td>' + escapeHtml(appointment.client_phone || '—') + '</td></tr>' +
    '<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Type:</td><td>' + escapeHtml(appointment.type_name_da || appointment.type) + '</td></tr>' +
    '<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Dato:</td><td>' + appointment.date + ' kl. ' + appointment.time + '</td></tr>' +
    '<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Varighed:</td><td>' + appointment.duration + ' min</td></tr>' +
    '<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Sted:</td><td>' + locationDa + '</td></tr>' +
    '<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Kilde:</td><td>' + escapeHtml(appointment.source || 'website') + '</td></tr>' +
    (appointment.message ? '<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Besked:</td><td>' + escapeHtml(appointment.message) + '</td></tr>' : '') +
    '</table>' +
    '<p style="font-size:12px;color:#999;margin-top:12px;">📎 Kalenderfil vedhæftet — åbn den for at tilføje til din kalender med påmindelse.</p>' +
    '</div>';

  // Build admin ICS with client name in summary + 1h + 15min reminders
  const icsContent = buildAdminIcsContent(appointment, id);

  return sendRawEmail({
    to: CONFIG.EMAIL_ADMIN,
    subject: '📅 Ny aftale: ' + appointment.client_name + ' — ' + appointment.date + ' kl. ' + appointment.time,
    html,
    text: 'Ny aftale: ' + appointment.client_name + ' (' + appointment.client_email + ') — ' + appointment.date + ' ' + appointment.time + ' — ' + locationDa,
    attachments: [{
      filename: 'appointment.ics',
      content: icsContent,
      contentType: 'text/calendar; method=REQUEST'
    }]
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
    '<div style="margin:16px 0;text-align:center;">' +
    '<a href="' + buildGoogleCalendarUrl(appointment, id) + '" style="display:inline-block;padding:8px 20px;background:#fff;color:#333;text-decoration:none;border-radius:8px;border:1px solid #E8E4E0;font-size:13px;">&#128197; Google Calendar</a>' +
    '</div>' +
    '<p style="font-size:12px;color:#aaa;text-align:center;margin:4px 0 16px;">En opdateret .ics kalenderfil er vedhæftet / An updated .ics file is attached</p>' +
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
  // Build updated ICS for admin calendar
  const updatedAppt = { ...appointment, date: newDate, time: newTime };
  const icsContent = buildAdminIcsContent(updatedAppt, appointment.id || 'reschedule');

  return sendRawEmail({
    to: CONFIG.EMAIL_ADMIN,
    subject: '🔄 Aftale flyttet: ' + appointment.client_name + ' — ' + newDate + ' kl. ' + newTime,
    html: '<p><strong>' + escapeHtml(appointment.client_name) + '</strong> har flyttet sin aftale fra ' + appointment.date + ' ' + appointment.time + ' til <strong>' + newDate + ' kl. ' + newTime + '</strong>.</p>' +
      '<p style="font-size:12px;color:#999;">📎 Opdateret kalenderfil vedhæftet.</p>',
    text: appointment.client_name + ' har flyttet sin aftale til ' + newDate + ' kl. ' + newTime,
    attachments: [{
      filename: 'appointment.ics',
      content: icsContent,
      contentType: 'text/calendar; method=REQUEST'
    }]
  });
}

// ═══════════════════════════════════════════════════════════════════
// REQUEST-BASED EMAIL TEMPLATES
// ═══════════════════════════════════════════════════════════════════

// ─── Request Received — Client (intro-class) ────────────────────
async function sendRequestReceivedEmail(id, appointment) {
  const orange = '#f75c03';
  const dateDa = formatDateDa(appointment.date);
  const dateEn = formatDateEn(appointment.date);

  const html = '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;line-height:1.65;font-size:16px;max-width:600px;margin:0 auto;">' +
    '<div style="background:' + orange + ';padding:24px 32px;border-radius:12px 12px 0 0;">' +
    '<h1 style="color:#fff;margin:0;font-size:22px;">&#128233; Anmodning modtaget</h1>' +
    '</div>' +
    '<div style="background:#FFFCF9;padding:28px 32px;border:1px solid #E8E4E0;border-top:none;border-radius:0 0 12px 12px;">' +
    '<p>Hej <strong>' + escapeHtml(appointment.client_name) + '</strong>,</p>' +
    '<p>Tak for din anmodning! Vi har modtaget din foresporgsel om en <strong>' + escapeHtml(appointment.type_name_da) + '</strong>.</p>' +
    '<p>Vi gennemgar din anmodning og vender tilbage med en bekraeftelse hurtigst muligt.</p>' +
    '<div style="background:#F5F3F0;border-radius:8px;padding:16px 20px;margin:16px 0;">' +
    '<table style="width:100%;border-collapse:collapse;font-size:15px;">' +
    '<tr><td style="padding:6px 12px 6px 0;font-weight:bold;color:#6F6A66;width:100px;">Type:</td><td>' + escapeHtml(appointment.type_name_da) + '</td></tr>' +
    '<tr><td style="padding:6px 12px 6px 0;font-weight:bold;color:#6F6A66;">Onsket dato:</td><td>' + dateDa + '</td></tr>' +
    '<tr><td style="padding:6px 12px 6px 0;font-weight:bold;color:#6F6A66;">Onsket tid:</td><td>' + appointment.time + '</td></tr>' +
    '</table>' +
    '</div>' +
    '<p style="font-size:14px;color:#6F6A66;">Vi kontakter dig inden for 24 timer. Har du sporgsmal i mellemtiden, er du velkommen til at skrive til os.</p>' +
    '<p style="font-size:13px;color:#888;">&#127468;&#127463; Request received for ' + escapeHtml(appointment.type_name_en) + ' on ' + dateEn + ' at ' + appointment.time + '. We\'ll review and get back to you shortly.</p>' +
    getSignatureHtml() +
    '</div></div>';

  return sendRawEmail({
    to: appointment.client_email,
    subject: '📩 Anmodning modtaget — ' + (appointment.type_name_da) + ' (' + appointment.date + ')',
    html,
    text: 'Hej ' + appointment.client_name + ',\n\nTak for din anmodning om en ' + appointment.type_name_da + '.\n\nOnsket dato: ' + dateDa + '\nOnsket tid: ' + appointment.time + '\n\nVi gennemgar din anmodning og vender tilbage hurtigst muligt.\n' + getSignaturePlain()
  });
}

// ─── Request Notification — Admin (intro-class) ─────────────────
async function sendAdminRequestNotification(id, appointment, clientToken) {
  const adminToken = crypto.createHmac('sha256', TOKEN_SECRET).update('admin-confirm:' + id).digest('hex');
  const baseUrl = CONFIG.SITE_URL;
  const confirmUrl = baseUrl + '/appointment?action=admin-confirm&id=' + id + '&admin_token=' + adminToken;

  const html = '<div style="font-family:monospace;font-size:14px;line-height:1.6;">' +
    '<h3 style="color:#f75c03;">&#128233; Ny anmodning (kræver godkendelse)</h3>' +
    '<table style="border-collapse:collapse;">' +
    '<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Navn:</td><td>' + escapeHtml(appointment.client_name) + '</td></tr>' +
    '<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Email:</td><td>' + escapeHtml(appointment.client_email) + '</td></tr>' +
    '<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Telefon:</td><td>' + escapeHtml(appointment.client_phone || '—') + '</td></tr>' +
    '<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Type:</td><td>' + escapeHtml(appointment.type_name_da) + '</td></tr>' +
    '<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Onsket dato:</td><td>' + appointment.date + ' kl. ' + appointment.time + '</td></tr>' +
    '<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Varighed:</td><td>' + appointment.duration + ' min</td></tr>' +
    (appointment.message ? '<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Besked:</td><td>' + escapeHtml(appointment.message) + '</td></tr>' : '') +
    '</table>' +
    '<div style="margin:20px 0;">' +
    '<a href="' + confirmUrl + '" style="display:inline-block;padding:12px 28px;background:#f75c03;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;">Godkend anmodning</a>' +
    '</div>' +
    '<p style="font-size:12px;color:#999;">Du kan ogsa administrere anmodningen i admin-panelet under Aftaler.</p>' +
    '</div>';

  return sendRawEmail({
    to: CONFIG.EMAIL_ADMIN,
    subject: '📩 Ny anmodning: ' + appointment.client_name + ' — ' + appointment.type_name_da + ' (' + appointment.date + ')',
    html,
    text: 'Ny anmodning fra ' + appointment.client_name + ' (' + appointment.client_email + ') — ' + appointment.type_name_da + ' den ' + appointment.date + ' kl. ' + appointment.time + '\n\nGodkend: ' + confirmUrl
  });
}

// ─── Photo Request Received — Client ────────────────────────────
async function sendPhotoRequestReceivedEmail(id, appointment) {
  const orange = '#f75c03';
  const isEn = appointment.lang === 'en';
  const slots = appointment.preferred_slots || [];
  const cancelToken = generateToken(id, appointment.client_email);
  const baseUrl = CONFIG.SITE_URL;
  const cancelUrl = baseUrl + '/appointment?id=' + id + '&email=' + encodeURIComponent(appointment.client_email) + '&token=' + cancelToken + '&action=cancel';

  let slotsHtml = '';
  let slotsText = '';
  slots.forEach(function(s, i) {
    const label = isEn ? 'Option ' + (i + 1) : 'Forslag ' + (i + 1);
    const dateStr = isEn ? formatDateEn(s.date) + ' at ' + s.time : formatDateDa(s.date) + ' kl. ' + s.time;
    slotsHtml += '<tr><td style="padding:8px 16px 8px 0;font-weight:700;color:' + orange + ';white-space:nowrap;vertical-align:top;">' + label + '</td><td style="padding:8px 0;color:#1a1a1a;">' + dateStr + '</td></tr>';
    slotsText += label + ': ' + s.date + (isEn ? ' at ' : ' kl. ') + s.time + '\n';
  });

  const t = {
    subject: isEn ? '📷 Photo session — request received' : '📷 Fotosession — anmodning modtaget',
    greeting: isEn ? 'Hi' : 'Hej',
    p1: isEn
      ? 'Thank you for your interest in a <strong>yoga photo session</strong> at Yoga Bible!'
      : 'Tak for din interesse i en <strong>yoga fotosession</strong> hos Yoga Bible!',
    p2: isEn
      ? 'We\'ve received your request and will get back to you within <strong>24–48 hours</strong> with a confirmation — or suggest an alternative time for your approval.'
      : 'Vi har modtaget din anmodning og vender tilbage inden for <strong>24–48 timer</strong> med en bekræftelse — eller foreslår et alternativt tidspunkt, som du kan godkende.',
    slotsTitle: isEn ? 'Your preferred times' : 'Dine foretrukne tidspunkter',
    locationLabel: isEn ? 'Location' : 'Lokation',
    locationVal: appointment.location_pref === 'on-location'
      ? (isEn ? 'On-location (to be confirmed)' : 'On-location (aftales nærmere)')
      : (isEn ? 'Yoga Bible Studio · Christianshavn, Copenhagen' : 'Yoga Bible Studio · Christianshavn, København'),
    whatNext: isEn ? 'What happens next?' : 'Hvad sker der nu?',
    step1: isEn ? 'We review your preferred times' : 'Vi gennemgår dine foretrukne tidspunkter',
    step2: isEn ? 'You\'ll receive a confirmation email with the final date' : 'Du modtager en bekræftelsesmail med den endelige dato',
    step3: isEn ? 'If needed, we\'ll suggest an alternative — you can accept or reply' : 'Hvis nødvendigt foreslår vi et alternativ — du kan acceptere eller svare',
    cancelLabel: isEn ? 'Changed your mind? Cancel request' : 'Fortrudt? Annuller anmodning',
    textPlainGreeting: isEn ? 'Hi ' : 'Hej ',
    textPlainThanks: isEn ? 'Thank you for your photo session request!' : 'Tak for din fotosession-anmodning!',
    textPlainReply: isEn ? 'We\'ll get back to you within 24-48 hours.' : 'Vi vender tilbage inden for 24-48 timer.'
  };

  const html = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f5f3f0;">' +
    '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;line-height:1.65;font-size:16px;max-width:600px;margin:0 auto;padding:20px;">' +

    // Header with dark background + orange accent line
    '<div style="background:#1a1a1a;padding:28px 32px 24px;border-radius:12px 12px 0 0;">' +
    '<div style="width:40px;height:3px;background:' + orange + ';border-radius:2px;margin-bottom:16px;"></div>' +
    '<h1 style="color:#fff;margin:0;font-size:20px;font-weight:700;letter-spacing:-0.02em;">Yoga Bible · Photography</h1>' +
    '</div>' +

    // Orange accent bar
    '<div style="height:3px;background:' + orange + ';"></div>' +

    // Body
    '<div style="background:#fff;padding:32px;border:1px solid #E8E4E0;border-top:none;">' +
    '<p style="margin:0 0 16px;">' + t.greeting + ' <strong>' + escapeHtml(appointment.client_name) + '</strong>,</p>' +
    '<p style="margin:0 0 16px;">' + t.p1 + '</p>' +
    '<p style="margin:0 0 24px;">' + t.p2 + '</p>' +

    // Slots card
    '<div style="background:#FFFCF9;border:1px solid #E8E4E0;border-radius:10px;padding:20px 24px;margin:0 0 24px;">' +
    '<p style="font-weight:700;margin:0 0 12px;font-size:13px;text-transform:uppercase;letter-spacing:0.08em;color:#6F6A66;">' + t.slotsTitle + '</p>' +
    '<table style="width:100%;border-collapse:collapse;font-size:15px;">' + slotsHtml + '</table>' +
    '<div style="margin-top:12px;padding-top:12px;border-top:1px solid #E8E4E0;">' +
    '<span style="font-size:13px;font-weight:700;color:#6F6A66;">' + t.locationLabel + ':</span> ' +
    '<span style="font-size:13px;color:#1a1a1a;">' + t.locationVal + '</span>' +
    '</div>' +
    '</div>' +

    // What happens next — 3 steps
    '<p style="font-weight:700;margin:0 0 10px;font-size:14px;color:#1a1a1a;">' + t.whatNext + '</p>' +
    '<table style="width:100%;border-collapse:collapse;font-size:14px;color:#6F6A66;margin:0 0 24px;">' +
    '<tr><td style="padding:4px 10px 4px 0;color:' + orange + ';font-weight:700;vertical-align:top;">1.</td><td style="padding:4px 0;">' + t.step1 + '</td></tr>' +
    '<tr><td style="padding:4px 10px 4px 0;color:' + orange + ';font-weight:700;vertical-align:top;">2.</td><td style="padding:4px 0;">' + t.step2 + '</td></tr>' +
    '<tr><td style="padding:4px 10px 4px 0;color:' + orange + ';font-weight:700;vertical-align:top;">3.</td><td style="padding:4px 0;">' + t.step3 + '</td></tr>' +
    '</table>' +

    // Cancel link
    '<div style="text-align:center;margin:24px 0 8px;">' +
    '<a href="' + cancelUrl + '" style="font-size:13px;color:#999;text-decoration:underline;">' + t.cancelLabel + '</a>' +
    '</div>' +

    getSignatureHtml() +
    '</div>' +

    // Footer
    '<div style="background:#1a1a1a;padding:16px 32px;border-radius:0 0 12px 12px;text-align:center;">' +
    '<p style="margin:0;font-size:12px;color:rgba(255,255,255,.4);">Yoga Bible · Torvegade 66 · 1400 K\u00f8benhavn K</p>' +
    '</div>' +

    '</div></body></html>';

  const text = t.textPlainGreeting + appointment.client_name + ',\n\n' +
    t.textPlainThanks + '\n\n' +
    t.slotsTitle + ':\n' + slotsText + '\n' +
    t.textPlainReply + '\n' +
    '\n' + t.cancelLabel + ': ' + cancelUrl + '\n' +
    getSignaturePlain();

  return sendRawEmail({
    to: appointment.client_email,
    subject: t.subject,
    html,
    text
  });
}

// ─── Photo Request Notification — Admin ─────────────────────────
async function sendAdminPhotoRequestNotification(id, appointment, clientToken) {
  const adminToken = crypto.createHmac('sha256', TOKEN_SECRET).update('admin-confirm:' + id).digest('hex');
  const baseUrl = CONFIG.SITE_URL;
  const slots = appointment.preferred_slots || [];

  let slotsHtml = '';
  slots.forEach(function(s, i) {
    const confirmUrl = baseUrl + '/appointment?action=admin-confirm&id=' + id + '&admin_token=' + adminToken + '&slot=' + i;
    slotsHtml += '<tr>' +
      '<td style="padding:6px 12px 6px 0;font-weight:bold;">Forslag ' + (i + 1) + ':</td>' +
      '<td>' + s.date + ' kl. ' + s.time + '</td>' +
      '<td style="padding-left:12px;"><a href="' + confirmUrl + '" style="color:#f75c03;font-weight:bold;">Godkend</a></td>' +
      '</tr>';
  });

  const adminPanelUrl = baseUrl + '/admin/#appointments';

  const html = '<div style="font-family:monospace;font-size:14px;line-height:1.6;">' +
    '<h3 style="color:#1a1a1a;">&#128247; Ny fotosession-anmodning</h3>' +
    '<table style="border-collapse:collapse;">' +
    '<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Navn:</td><td>' + escapeHtml(appointment.client_name) + '</td></tr>' +
    '<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Email:</td><td>' + escapeHtml(appointment.client_email) + '</td></tr>' +
    '<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Telefon:</td><td>' + escapeHtml(appointment.client_phone || '—') + '</td></tr>' +
    (appointment.location_pref ? '<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Lokation:</td><td>' + escapeHtml(appointment.location_pref) + '</td></tr>' : '') +
    (appointment.message ? '<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Besked:</td><td>' + escapeHtml(appointment.message) + '</td></tr>' : '') +
    '</table>' +
    '<h4 style="margin:16px 0 8px;">Foretrukne tidspunkter:</h4>' +
    '<table style="border-collapse:collapse;">' +
    slotsHtml +
    '</table>' +
    '<div style="margin:20px 0;">' +
    '<a href="' + adminPanelUrl + '" style="display:inline-block;padding:10px 20px;background:#6F6A66;color:#fff;text-decoration:none;border-radius:8px;">Administrer i admin-panelet</a>' +
    '</div>' +
    '<p style="font-size:12px;color:#999;">Åbn aftalen i admin-panelet for at godkende, foreslå alternativ tid, eller kontakte klienten.</p>' +
    '</div>';

  return sendRawEmail({
    to: CONFIG.EMAIL_ADMIN,
    subject: '📷 Ny fotosession-anmodning: ' + appointment.client_name,
    html,
    text: 'Ny fotosession-anmodning fra ' + appointment.client_name + ' (' + appointment.client_email + ')'
  });
}

// ─── Suggestion Email — Client (admin suggests alternative) ─────
async function sendSuggestionEmail(appointment, id, acceptToken) {
  const orange = '#f75c03';
  const baseUrl = CONFIG.SITE_URL;
  const acceptUrl = baseUrl + '/appointment?action=accept-suggestion&id=' + id + '&email=' + encodeURIComponent(appointment.client_email) + '&token=' + acceptToken;

  const html = '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;line-height:1.65;font-size:16px;max-width:600px;margin:0 auto;">' +
    '<div style="background:' + orange + ';padding:24px 32px;border-radius:12px 12px 0 0;">' +
    '<h1 style="color:#fff;margin:0;font-size:22px;">&#128197; Forslag til ny tid</h1>' +
    '</div>' +
    '<div style="background:#FFFCF9;padding:28px 32px;border:1px solid #E8E4E0;border-top:none;border-radius:0 0 12px 12px;">' +
    '<p>Hej <strong>' + escapeHtml(appointment.client_name) + '</strong>,</p>' +
    '<p>Tak for din anmodning. Vi kan desvaerre ikke imodekomme de foreslåede tidspunkter, men vi vil gerne foreslå:</p>' +
    '<div style="background:#F5F3F0;border-radius:8px;padding:16px 20px;margin:16px 0;text-align:center;">' +
    '<p style="font-size:18px;font-weight:bold;color:' + orange + ';margin:0;">' + formatDateDa(appointment.suggested_date) + '</p>' +
    '<p style="font-size:20px;font-weight:bold;margin:4px 0 0;">kl. ' + appointment.suggested_time + '</p>' +
    '</div>' +
    (appointment.admin_message ? '<p style="font-style:italic;color:#6F6A66;">"' + escapeHtml(appointment.admin_message) + '"</p>' : '') +
    '<div style="text-align:center;margin:24px 0;">' +
    '<a href="' + acceptUrl + '" style="display:inline-block;padding:12px 28px;background:' + orange + ';color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;">Accepter denne tid</a>' +
    '</div>' +
    '<p style="font-size:14px;color:#6F6A66;">Passer denne tid ikke? Du er velkommen til at svare på denne email, så finder vi en anden losning.</p>' +
    '<p style="font-size:13px;color:#888;">&#127468;&#127463; We\'d like to suggest an alternative time: ' + formatDateEn(appointment.suggested_date) + ' at ' + appointment.suggested_time + '. Click the button above to accept.</p>' +
    getSignatureHtml() +
    '</div></div>';

  return sendRawEmail({
    to: appointment.client_email,
    subject: '📅 Forslag til ny tid — ' + (appointment.type_name_da || 'Yoga Bible'),
    html,
    text: 'Hej ' + appointment.client_name + ',\n\nVi foreslår en ny tid: ' + appointment.suggested_date + ' kl. ' + appointment.suggested_time + '\n\nAccepter: ' + acceptUrl + '\n' + getSignaturePlain()
  });
}
