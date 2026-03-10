/**
 * Appointments CRUD — Yoga Bible
 * Admin endpoint for managing appointments.
 *
 * GET    /.netlify/functions/appointments           → list all (with filters)
 * GET    /.netlify/functions/appointments?id=X      → single appointment
 * POST   /.netlify/functions/appointments           → create appointment (admin)
 * PUT    /.netlify/functions/appointments            → update appointment
 * DELETE /.netlify/functions/appointments?id=X      → delete appointment
 */

const crypto = require('crypto');
const { requireAuth } = require('./shared/auth');
const { getDb, getDoc, addDoc, updateDoc, deleteDoc, serverTimestamp } = require('./shared/firestore');
const { jsonResponse, optionsResponse, escapeHtml } = require('./shared/utils');
const { sendRawEmail, getSignatureHtml, getSignaturePlain } = require('./shared/email-service');
const { sendSMS, normalizePhone } = require('./shared/sms-service');
const { CONFIG } = require('./shared/config');

const COLLECTION = 'appointments';

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  // All admin endpoints require auth
  const user = await requireAuth(event, ['admin', 'marketing']);
  if (user.error) return user.error;

  try {
    switch (event.httpMethod) {
      case 'GET': return await handleGet(event);
      case 'POST': return await handlePost(event, user);
      case 'PUT': return await handlePut(event, user);
      case 'DELETE': return await handleDelete(event, user);
      default: return jsonResponse(405, { ok: false, error: 'Method not allowed' });
    }
  } catch (err) {
    console.error('[appointments] Error:', err.message);
    return jsonResponse(500, { ok: false, error: err.message });
  }
};

// ─── GET ────────────────────────────────────────────────────────────
async function handleGet(event) {
  const params = event.queryStringParameters || {};

  // Contact search (for appointment form autocomplete)
  if (params.action === 'search-contacts') {
    return await searchContacts(params.q || '');
  }

  // Single appointment
  if (params.id) {
    const doc = await getDoc(COLLECTION, params.id);
    if (!doc) return jsonResponse(404, { ok: false, error: 'Appointment not found' });
    return jsonResponse(200, { ok: true, data: doc });
  }

  // List with filters
  const db = getDb();
  let query = db.collection(COLLECTION);

  if (params.status) query = query.where('status', '==', params.status);
  if (params.type) query = query.where('type', '==', params.type);
  if (params.date_from) query = query.where('date', '>=', params.date_from);
  if (params.date_to) query = query.where('date', '<=', params.date_to);

  query = query.orderBy('date', 'desc');

  const limit = parseInt(params.limit) || 200;
  query = query.limit(limit);

  const snapshot = await query.get();
  const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  return jsonResponse(200, { ok: true, data });
}

// ─── POST ───────────────────────────────────────────────────────────
async function handlePost(event, user) {
  const body = JSON.parse(event.body || '{}');

  // ── Notify action: send confirmation email/SMS for an existing appointment ──
  if (body.action === 'notify') {
    return await handleNotify(body, user);
  }

  if (!body.date || !body.time || !body.client_name || !body.client_email) {
    return jsonResponse(400, { ok: false, error: 'Missing required fields: date, time, client_name, client_email' });
  }

  const doc = {
    date: body.date,
    time: body.time,
    duration: body.duration || 30,
    type: body.type || 'consultation',
    client_name: body.client_name,
    client_email: body.client_email,
    client_phone: body.client_phone || '',
    notes: body.notes || '',
    status: body.status || 'confirmed',
    location: body.location || 'studio',
    created_by: user.email,
    reminder_sent: false,
    reminder_24h_sent: false
  };

  const id = await addDoc(COLLECTION, doc);

  // Send confirmation notifications if requested
  const notifyResults = {};
  if (body.notify_email || body.notify_sms) {
    const appointment = { ...doc, id };
    if (body.notify_email) {
      try {
        await sendConfirmationEmail(id, appointment);
        notifyResults.email = 'sent';
        await updateDoc(COLLECTION, id, { confirmation_email_sent: true });
      } catch (err) {
        console.error('[appointments] Confirmation email error:', err.message);
        notifyResults.email = 'failed';
      }
    }
    if (body.notify_sms && appointment.client_phone) {
      try {
        await sendConfirmationSMS(appointment);
        notifyResults.sms = 'sent';
        await updateDoc(COLLECTION, id, { confirmation_sms_sent: true });
      } catch (err) {
        console.error('[appointments] Confirmation SMS error:', err.message);
        notifyResults.sms = 'failed';
      }
    }
  }

  return jsonResponse(201, { ok: true, id, notify: notifyResults });
}

// ─── PUT ────────────────────────────────────────────────────────────
async function handlePut(event, user) {
  const body = JSON.parse(event.body || '{}');
  if (!body.id) return jsonResponse(400, { ok: false, error: 'Missing id' });

  const allowed = [
    'date', 'time', 'duration', 'type', 'client_name', 'client_email',
    'client_phone', 'notes', 'status', 'location', 'reminder_sent',
    'reminder_24h_sent', 'cancelled_at', 'cancel_reason', 'rescheduled_from',
    'confirmed_at', 'suggested_date', 'suggested_time', 'admin_message',
    '_notes'
  ];

  const updates = {};
  for (const key of allowed) {
    if (body[key] !== undefined) updates[key] = body[key];
  }

  if (Object.keys(updates).length === 0) {
    return jsonResponse(400, { ok: false, error: 'No valid fields to update' });
  }

  updates.updated_by = user.email;
  await updateDoc(COLLECTION, body.id, updates);
  return jsonResponse(200, { ok: true });
}

// ─── DELETE ─────────────────────────────────────────────────────────
async function handleDelete(event, user) {
  const params = event.queryStringParameters || {};
  if (!params.id) return jsonResponse(400, { ok: false, error: 'Missing id' });

  if (user.role !== 'admin') {
    return jsonResponse(403, { ok: false, error: 'Only admins can delete appointments' });
  }

  await deleteDoc(COLLECTION, params.id);
  return jsonResponse(200, { ok: true });
}

// ─── NOTIFY (send confirmation email/SMS for existing appointment) ───
async function handleNotify(body, user) {
  if (!body.id) return jsonResponse(400, { ok: false, error: 'Missing appointment id' });

  const appointment = await getDoc(COLLECTION, body.id);
  if (!appointment) return jsonResponse(404, { ok: false, error: 'Appointment not found' });

  const results = {};

  if (body.email) {
    try {
      await sendConfirmationEmail(body.id, appointment);
      results.email = 'sent';
      await updateDoc(COLLECTION, body.id, { confirmation_email_sent: true });
    } catch (err) {
      console.error('[appointments] Notify email error:', err.message);
      results.email = 'failed';
      results.email_error = err.message;
    }
  }

  if (body.sms) {
    if (!appointment.client_phone) {
      results.sms = 'skipped';
      results.sms_error = 'No phone number';
    } else {
      try {
        await sendConfirmationSMS(appointment);
        results.sms = 'sent';
        await updateDoc(COLLECTION, body.id, { confirmation_sms_sent: true });
      } catch (err) {
        console.error('[appointments] Notify SMS error:', err.message);
        results.sms = 'failed';
        results.sms_error = err.message;
      }
    }
  }

  return jsonResponse(200, { ok: true, results });
}

// ─── EMAIL / SMS CONFIRMATION TEMPLATES ─────────────────────────────

const TOKEN_SECRET = process.env.UNSUBSCRIBE_SECRET || 'yb-appt-secret';

function generateToken(appointmentId, email) {
  return crypto.createHmac('sha256', TOKEN_SECRET)
    .update(appointmentId + ':' + email.toLowerCase().trim())
    .digest('hex');
}

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
  const location = appointment.location === 'online' ? 'Online' : 'Yoga Bible, Torvegade 66, 1400 København K';
  const title = (appointment.type_name_en || appointment.type || 'Appointment') + ' - Yoga Bible';

  return 'https://calendar.google.com/calendar/render?action=TEMPLATE' +
    '&text=' + encodeURIComponent(title) +
    '&dates=' + startStr + '/' + endStr +
    '&ctz=Europe/Copenhagen' +
    '&details=' + encodeURIComponent(title) +
    '&location=' + encodeURIComponent(location);
}

function buildIcsContent(appointment, id) {
  const dateClean = appointment.date.replace(/-/g, '');
  const timeClean = appointment.time.replace(/:/g, '') + '00';
  const durationMin = appointment.duration || 30;
  const startMin = parseInt(appointment.time.split(':')[0]) * 60 + parseInt(appointment.time.split(':')[1]);
  const endMin = startMin + durationMin;
  const endTime = String(Math.floor(endMin / 60)).padStart(2, '0') + String(endMin % 60).padStart(2, '0') + '00';
  const location = appointment.location === 'online' ? 'Online' : 'Yoga Bible, Torvegade 66, 1400 København K';

  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Yoga Bible//Appointment//DA',
    'CALSCALE:GREGORIAN', 'METHOD:REQUEST', 'BEGIN:VEVENT',
    'DTSTART;TZID=Europe/Copenhagen:' + dateClean + 'T' + timeClean,
    'DTEND;TZID=Europe/Copenhagen:' + dateClean + 'T' + endTime,
    'SUMMARY:' + (appointment.type_name_en || appointment.type || 'Appointment') + ' - Yoga Bible',
    'LOCATION:' + location,
    'UID:' + id + '@yogabible.dk', 'STATUS:CONFIRMED',
    'BEGIN:VALARM', 'TRIGGER:-PT1H', 'ACTION:DISPLAY',
    'DESCRIPTION:Reminder', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'
  ].join('\r\n');
}

// Type label mapping (same as appointment-book.js defaults)
const TYPE_LABELS = {
  'info-session': { da: 'Gratis infomøde', en: 'Free Info Session' },
  'consultation': { da: 'Online konsultation', en: 'Online Consultation' },
  'intro-class': { da: 'Gratis prøvetime', en: 'Free Trial Class' },
  'photo-session': { da: 'Yoga Fotosession', en: 'Yoga Photo Session' }
};

async function sendConfirmationEmail(id, appointment) {
  const orange = '#f75c03';
  const baseUrl = CONFIG.SITE_URL;
  const token = generateToken(id, appointment.client_email);
  const manageUrl = baseUrl + '/appointment?id=' + id + '&email=' + encodeURIComponent(appointment.client_email) + '&token=' + token;
  const rescheduleUrl = manageUrl + '&action=reschedule';
  const cancelUrl = manageUrl + '&action=cancel';

  const typeDa = appointment.type_name_da || (TYPE_LABELS[appointment.type] || {}).da || appointment.type;
  const typeEn = appointment.type_name_en || (TYPE_LABELS[appointment.type] || {}).en || appointment.type;
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
    '<tr><td style="padding:6px 12px 6px 0;font-weight:bold;color:#6F6A66;width:100px;">Type:</td><td>' + escapeHtml(typeDa) + '</td></tr>' +
    '<tr><td style="padding:6px 12px 6px 0;font-weight:bold;color:#6F6A66;">Dato:</td><td>' + dateDa + '</td></tr>' +
    '<tr><td style="padding:6px 12px 6px 0;font-weight:bold;color:#6F6A66;">Tid:</td><td>' + appointment.time + '</td></tr>' +
    '<tr><td style="padding:6px 12px 6px 0;font-weight:bold;color:#6F6A66;">Varighed:</td><td>' + (appointment.duration || 30) + ' min</td></tr>' +
    '<tr><td style="padding:6px 12px 6px 0;font-weight:bold;color:#6F6A66;">Sted:</td><td>' + locationDa + '</td></tr>' +
    '</table>' +
    '</div>' +
    '<div style="margin:24px 0;text-align:center;">' +
    '<a href="' + rescheduleUrl + '" style="display:inline-block;padding:10px 24px;background:' + orange + ';color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;margin:0 6px;">Flyt aftale</a>' +
    '<a href="' + cancelUrl + '" style="display:inline-block;padding:10px 24px;background:#fff;color:#6F6A66;text-decoration:none;border-radius:8px;border:1px solid #E8E4E0;margin:0 6px;">Aflys aftale</a>' +
    '</div>' +
    '<div style="margin:16px 0;text-align:center;">' +
    '<a href="' + buildGoogleCalendarUrl(appointment, id) + '" style="display:inline-block;padding:8px 20px;background:#fff;color:#333;text-decoration:none;border-radius:8px;border:1px solid #E8E4E0;font-size:13px;">&#128197; Google Calendar</a>' +
    '</div>' +
    '<p style="font-size:12px;color:#aaa;text-align:center;margin:4px 0 16px;">En .ics kalenderfil er vedhæftet denne email (Apple Calendar, Outlook m.fl.)</p>' +
    '<p style="font-size:13px;color:#888;">&#127468;&#127463; Appointment confirmed: ' + dateEn + ' at ' + appointment.time + ' (' + (appointment.duration || 30) + ' min). ' + locationEn + '</p>' +
    '<p style="font-size:13px;color:#888;">To reschedule or cancel, use the buttons above or reply to this email.</p>' +
    getSignatureHtml() +
    '</div></div>';

  const text = 'Hej ' + appointment.client_name + ',\n\n' +
    'Din aftale er bekræftet!\n\n' +
    'Type: ' + typeDa + '\n' +
    'Dato: ' + dateDa + '\n' +
    'Tid: ' + appointment.time + '\n' +
    'Varighed: ' + (appointment.duration || 30) + ' min\n' +
    'Sted: ' + locationDa + '\n\n' +
    'Flyt aftale: ' + rescheduleUrl + '\n' +
    'Aflys aftale: ' + cancelUrl + '\n' +
    getSignaturePlain();

  const icsContent = buildIcsContent(appointment, id);

  return sendRawEmail({
    to: appointment.client_email,
    subject: '✅ Aftale bekræftet — ' + typeDa + ' (' + appointment.date + ')',
    html,
    text,
    attachments: [{
      filename: 'appointment.ics',
      content: icsContent,
      contentType: 'text/calendar; method=REQUEST'
    }]
  });
}

async function sendConfirmationSMS(appointment) {
  const phone = normalizePhone(appointment.client_phone);
  if (!phone) throw new Error('Invalid phone number');

  const typeDa = appointment.type_name_da || (TYPE_LABELS[appointment.type] || {}).da || appointment.type;
  const locationDa = appointment.location === 'online' ? 'Online' : 'Yoga Bible, Torvegade 66';
  const firstName = (appointment.client_name || '').split(' ')[0];

  const message = 'Hej ' + firstName + '! Din aftale er bekraeftet: ' +
    typeDa + ' d. ' + appointment.date + ' kl. ' + appointment.time +
    ' (' + (appointment.duration || 30) + ' min) — ' + locationDa +
    '. Vi glaeder os til at se dig! — Yoga Bible';

  return sendSMS(phone, message);
}

// ─── CONTACT SEARCH ─────────────────────────────────────────────────
// Searches leads, applications, careers, and registered users for autocomplete
async function searchContacts(query) {
  if (!query || query.length < 2) {
    return jsonResponse(400, { ok: false, error: 'Query too short (min 2 chars)' });
  }

  const db = getDb();
  const q = query.toLowerCase().trim();
  const contacts = [];
  const seen = new Set(); // dedupe by email

  // Helper: add contact if matches query and not already seen
  function tryAdd(doc, source) {
    const d = doc.data ? doc.data() : doc;
    const email = (d.email || '').toLowerCase().trim();
    const firstName = (d.first_name || d.firstName || '').trim();
    const lastName = (d.last_name || d.lastName || '').trim();
    const name = firstName && lastName ? `${firstName} ${lastName}` : (d.name || d.client_name || firstName || '').trim();
    const phone = (d.phone || d.client_phone || '').trim();

    if (!email && !name) return;

    // Match against name, email, or phone
    const searchable = `${name} ${email} ${phone}`.toLowerCase();
    if (!searchable.includes(q)) return;

    if (email && seen.has(email)) return;
    if (email) seen.add(email);

    contacts.push({
      name: name,
      email: email,
      phone: phone,
      source: source,
      type: d.type || d.ytt_program_type || '',
      status: d.status || ''
    });
  }

  try {
    // Search leads collection
    const leadsSnap = await db.collection('leads').limit(500).get();
    leadsSnap.forEach(doc => tryAdd(doc, 'lead'));

    // Search applications collection
    const appsSnap = await db.collection('applications').limit(500).get();
    appsSnap.forEach(doc => tryAdd(doc, 'application'));

    // Search career submissions
    const careersSnap = await db.collection('careers').limit(200).get();
    careersSnap.forEach(doc => tryAdd(doc, 'career'));

    // Search registered users (Firebase auth users stored in Firestore)
    const usersSnap = await db.collection('users').limit(500).get();
    usersSnap.forEach(doc => tryAdd(doc, 'user'));

    // Sort: exact matches first, then alphabetically
    contacts.sort((a, b) => {
      const aExact = a.name.toLowerCase().startsWith(q) || a.email.toLowerCase().startsWith(q) ? 0 : 1;
      const bExact = b.name.toLowerCase().startsWith(q) || b.email.toLowerCase().startsWith(q) ? 0 : 1;
      if (aExact !== bExact) return aExact - bExact;
      return (a.name || a.email).localeCompare(b.name || b.email);
    });

    return jsonResponse(200, { ok: true, contacts: contacts.slice(0, 20) });
  } catch (err) {
    console.error('[appointments] Contact search error:', err.message);
    return jsonResponse(500, { ok: false, error: err.message });
  }
}
