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
