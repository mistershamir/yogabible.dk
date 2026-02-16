/**
 * Applications CRUD API — Yoga Bible (Admin)
 * Authenticated endpoint for managing applications.
 *
 * GET    /.netlify/functions/applications          — List all
 * GET    /.netlify/functions/applications?id=X     — Get single
 * PUT    /.netlify/functions/applications          — Update
 * DELETE /.netlify/functions/applications          — Delete (admin only)
 */

const { getDb } = require('./shared/firestore');
const { requireAuth } = require('./shared/auth');
const { jsonResponse, optionsResponse } = require('./shared/utils');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  const user = await requireAuth(event, ['admin', 'marketing']);
  if (user.error) return user.error;

  const params = event.queryStringParameters || {};
  const db = getDb();

  try {
    switch (event.httpMethod) {
      case 'GET':
        return params.id ? getOne(db, params.id) : getAll(db, params);
      case 'PUT':
        return update(db, event, user);
      case 'DELETE':
        if (user.role !== 'admin') {
          return jsonResponse(403, { ok: false, error: 'Only admins can delete applications' });
        }
        return remove(db, event);
      default:
        return jsonResponse(405, { ok: false, error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('[applications] Error:', error);
    return jsonResponse(500, { ok: false, error: error.message });
  }
};

async function getAll(db, params) {
  let query = db.collection('applications');

  if (params.status) query = query.where('status', '==', params.status);
  if (params.type) query = query.where('type', '==', params.type);

  query = query.orderBy('created_at', 'desc');

  const limit = Math.min(parseInt(params.limit) || 500, 1000);
  query = query.limit(limit);

  const snapshot = await query.get();
  const applications = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  return jsonResponse(200, { ok: true, applications, count: applications.length });
}

async function getOne(db, id) {
  const doc = await db.collection('applications').doc(id).get();
  if (!doc.exists) {
    return jsonResponse(404, { ok: false, error: 'Application not found' });
  }
  return jsonResponse(200, { ok: true, application: { id: doc.id, ...doc.data() } });
}

async function update(db, event, user) {
  const data = JSON.parse(event.body || '{}');
  if (!data.id) {
    return jsonResponse(400, { ok: false, error: 'Application ID is required' });
  }

  const docRef = db.collection('applications').doc(data.id);
  const doc = await docRef.get();
  if (!doc.exists) {
    return jsonResponse(404, { ok: false, error: 'Application not found' });
  }

  const updates = { updated_at: new Date(), updated_by: user.email };
  const allowed = [
    'status', 'notes', 'payment_choice', 'track',
    'cohort_id', 'cohort_label', 'bundle_type'
  ];

  for (const key of allowed) {
    if (data[key] !== undefined) {
      updates[key] = data[key];
    }
  }

  await docRef.update(updates);
  const updated = await docRef.get();
  return jsonResponse(200, { ok: true, application: { id: updated.id, ...updated.data() } });
}

async function remove(db, event) {
  const data = JSON.parse(event.body || '{}');
  if (!data.id) {
    return jsonResponse(400, { ok: false, error: 'Application ID is required' });
  }

  const docRef = db.collection('applications').doc(data.id);
  const doc = await docRef.get();
  if (!doc.exists) {
    return jsonResponse(404, { ok: false, error: 'Application not found' });
  }

  await docRef.delete();
  return jsonResponse(200, { ok: true, message: 'Application deleted' });
}
