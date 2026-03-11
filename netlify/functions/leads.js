/**
 * Leads CRUD API — Yoga Bible (Admin)
 * Authenticated endpoint for Lead Manager.
 *
 * GET    /.netlify/functions/leads          — List all leads (with filters)
 * GET    /.netlify/functions/leads?id=X     — Get single lead
 * POST   /.netlify/functions/leads          — Create lead
 * PUT    /.netlify/functions/leads          — Update lead
 * DELETE /.netlify/functions/leads          — Delete lead (admin only)
 */

const { getDb } = require('./shared/firestore');
const { requireAuth } = require('./shared/auth');
const { jsonResponse, optionsResponse } = require('./shared/utils');
const { sendLeadStatusEvent } = require('./shared/meta-events');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  // Auth required for all operations
  const user = await requireAuth(event, ['admin', 'marketing']);
  if (user.error) return user.error;

  const params = event.queryStringParameters || {};
  const db = getDb();

  try {
    switch (event.httpMethod) {
      case 'GET':
        return params.id ? getOne(db, params.id) : getAll(db, params);
      case 'POST':
        return create(db, event, user);
      case 'PUT':
        return update(db, event, user);
      case 'DELETE':
        if (user.role !== 'admin') {
          return jsonResponse(403, { ok: false, error: 'Only admins can delete leads' });
        }
        return remove(db, event);
      default:
        return jsonResponse(405, { ok: false, error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('[leads] Error:', error);
    return jsonResponse(500, { ok: false, error: error.message });
  }
};

async function getAll(db, params) {
  let query = db.collection('leads');

  // Filters
  if (params.status) query = query.where('status', '==', params.status);
  if (params.type) query = query.where('type', '==', params.type);
  if (params.source) query = query.where('source', '==', params.source);

  // Order by created_at desc (newest first)
  query = query.orderBy('created_at', 'desc');

  // Pagination
  const limit = Math.min(parseInt(params.limit) || 500, 1000);
  query = query.limit(limit);

  const snapshot = await query.get();
  const leads = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  return jsonResponse(200, { ok: true, leads, count: leads.length });
}

async function getOne(db, id) {
  const doc = await db.collection('leads').doc(id).get();
  if (!doc.exists) {
    return jsonResponse(404, { ok: false, error: 'Lead not found' });
  }
  return jsonResponse(200, { ok: true, lead: { id: doc.id, ...doc.data() } });
}

async function create(db, event, user) {
  const data = JSON.parse(event.body || '{}');
  if (!data.email) {
    return jsonResponse(400, { ok: false, error: 'Email is required' });
  }

  const lead = {
    email: data.email.toLowerCase().trim(),
    first_name: data.first_name || '',
    last_name: data.last_name || '',
    phone: data.phone || '',
    type: data.type || '',
    ytt_program_type: data.ytt_program_type || '',
    program: data.program || '',
    course_id: data.course_id || '',
    cohort_label: data.cohort_label || '',
    preferred_month: data.preferred_month || '',
    accommodation: data.accommodation || '',
    city_country: data.city_country || '',
    housing_months: data.housing_months || '',
    service: data.service || '',
    subcategories: data.subcategories || '',
    message: data.message || '',
    source: data.source || 'Manual entry',
    status: data.status || 'New',
    sub_status: data.sub_status || '',
    priority: data.priority || '',
    temperature: data.temperature || '',
    notes: data.notes || '',
    converted: false,
    converted_at: null,
    application_id: null,
    unsubscribed: false,
    call_attempts: 0,
    sms_status: '',
    last_contact: null,
    followup_date: data.followup_date || null,
    created_at: new Date(),
    updated_at: new Date(),
    created_by: user.email
  };

  const ref = await db.collection('leads').add(lead);
  return jsonResponse(201, { ok: true, id: ref.id, lead: { id: ref.id, ...lead } });
}

async function update(db, event, user) {
  const data = JSON.parse(event.body || '{}');
  if (!data.id) {
    return jsonResponse(400, { ok: false, error: 'Lead ID is required' });
  }

  const docRef = db.collection('leads').doc(data.id);
  const doc = await docRef.get();
  if (!doc.exists) {
    return jsonResponse(404, { ok: false, error: 'Lead not found' });
  }

  // Only update provided fields
  const updates = { updated_at: new Date(), updated_by: user.email };
  const allowed = [
    'first_name', 'last_name', 'phone', 'type', 'ytt_program_type',
    'program', 'course_id', 'cohort_label', 'preferred_month',
    'accommodation', 'city_country', 'housing_months', 'service',
    'subcategories', 'message', 'source', 'status', 'sub_status',
    'priority', 'temperature', 'notes',
    'converted', 'converted_at', 'application_id', 'unsubscribed',
    'call_attempts', 'sms_status', 'last_contact', 'followup_date',
    'has_unread_sms', 'last_sms_at'
  ];

  for (const key of allowed) {
    if (data[key] !== undefined) {
      updates[key] = data[key];
    }
  }

  await docRef.update(updates);
  const updated = await docRef.get();
  const updatedLead = { id: updated.id, ...updated.data() };

  // Send Meta CAPI event for trackable status changes (Qualified, Converted, etc.)
  if (updates.status || updates.converted !== undefined) {
    sendLeadStatusEvent(updatedLead, data.id, updates)
      .catch(e => console.error('[leads] Meta CAPI status event failed:', e.message));
  }

  return jsonResponse(200, { ok: true, lead: updatedLead });
}

async function remove(db, event) {
  const data = JSON.parse(event.body || '{}');
  if (!data.id) {
    return jsonResponse(400, { ok: false, error: 'Lead ID is required' });
  }

  const docRef = db.collection('leads').doc(data.id);
  const doc = await docRef.get();
  if (!doc.exists) {
    return jsonResponse(404, { ok: false, error: 'Lead not found' });
  }

  await docRef.delete();
  return jsonResponse(200, { ok: true, message: 'Lead deleted' });
}
