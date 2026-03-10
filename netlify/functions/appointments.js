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

const { requireAuth } = require('./shared/auth');
const { getDb, getDoc, addDoc, updateDoc, deleteDoc, serverTimestamp } = require('./shared/firestore');
const { jsonResponse, optionsResponse, escapeHtml } = require('./shared/utils');

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
  return jsonResponse(201, { ok: true, id });
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

// ─── CONTACT SEARCH ─────────────────────────────────────────────────
// Searches leads, applications, and career submissions for autocomplete
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
