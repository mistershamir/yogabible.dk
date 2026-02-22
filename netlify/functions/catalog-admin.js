/**
 * Course Catalog Admin API — Yoga Bible
 * Admin-only CRUD for the course_catalog Firestore collection.
 *
 * GET    /.netlify/functions/catalog-admin           — list all (including inactive)
 * GET    /.netlify/functions/catalog-admin?id=X      — get single item
 * POST   /.netlify/functions/catalog-admin           — create new item
 * PUT    /.netlify/functions/catalog-admin           — update item
 * DELETE /.netlify/functions/catalog-admin           — delete item
 */

const { getDb } = require('./shared/firestore');
const { requireAuth } = require('./shared/auth');
const { jsonResponse, optionsResponse } = require('./shared/utils');

const ALLOWED_FIELDS = [
  'course_id', 'course_name', 'category', 'track',
  'cohort_id', 'cohort_label', 'start_date', 'end_date',
  'capacity', 'waitlist_enabled', 'active', 'external_only', 'external_url',
  'payment_url_full', 'payment_url_deposit',
  'price_full', 'currency', 'deposit_amount',
  'allow_deposit', 'allow_instalments', 'max_instalments',
  'notes', 'sort_key', 'open_status'
];

const INT_FIELDS = ['capacity', 'price_full', 'max_instalments'];
const BOOL_FIELDS = ['waitlist_enabled', 'active', 'external_only', 'allow_deposit', 'allow_instalments'];

function coerceTypes(obj) {
  for (const f of INT_FIELDS) {
    if (obj[f] !== undefined) obj[f] = parseInt(obj[f]) || 0;
  }
  for (const f of BOOL_FIELDS) {
    if (obj[f] !== undefined) obj[f] = Boolean(obj[f]);
  }
  return obj;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  const user = await requireAuth(event, ['admin']);
  if (user.error) return user.error;

  const params = event.queryStringParameters || {};
  const db = getDb();

  try {
    switch (event.httpMethod) {
      case 'GET':
        return params.id ? getOne(db, params.id) : getAll(db, params);
      case 'POST': {
        const body = JSON.parse(event.body || '{}');
        if (body.action === 'bulkDelete') return bulkDelete(db, body);
        if (body.action === 'bulkUpdate') return bulkUpdate(db, body, user);
        return create(db, event, user);
      }
      case 'PUT':
        return update(db, event, user);
      case 'DELETE':
        return remove(db, event);
      default:
        return jsonResponse(405, { ok: false, error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('[catalog-admin] Error:', error);
    return jsonResponse(500, { ok: false, error: error.message });
  }
};

async function getAll(db, params) {
  let query = db.collection('course_catalog');

  if (params.category) query = query.where('category', '==', params.category);
  if (params.active !== undefined) {
    query = query.where('active', '==', params.active === 'true');
  }
  if (params.course_id) query = query.where('course_id', '==', params.course_id);

  const snapshot = await query.get();
  const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  // Sort client-side to avoid composite index requirements
  items.sort((a, b) => {
    const courseComp = (a.course_id || '').localeCompare(b.course_id || '');
    if (courseComp !== 0) return courseComp;
    return String(a.sort_key || '').localeCompare(String(b.sort_key || ''));
  });

  return jsonResponse(200, { ok: true, items, count: items.length });
}

async function getOne(db, id) {
  const doc = await db.collection('course_catalog').doc(id).get();
  if (!doc.exists) {
    return jsonResponse(404, { ok: false, error: 'Catalog item not found' });
  }
  return jsonResponse(200, { ok: true, item: { id: doc.id, ...doc.data() } });
}

async function create(db, event, user) {
  const data = JSON.parse(event.body || '{}');
  if (!data.course_id) {
    return jsonResponse(400, { ok: false, error: 'course_id is required' });
  }
  if (!data.course_name) {
    return jsonResponse(400, { ok: false, error: 'course_name is required' });
  }

  const item = {
    created_at: new Date(),
    updated_at: new Date(),
    created_by: user.email
  };

  for (const key of ALLOWED_FIELDS) {
    if (data[key] !== undefined) item[key] = data[key];
  }
  coerceTypes(item);

  const ref = await db.collection('course_catalog').add(item);
  console.log(`[catalog-admin] Created ${ref.id} (${item.course_id} / ${item.cohort_label})`);

  return jsonResponse(201, { ok: true, id: ref.id, item: { id: ref.id, ...item } });
}

async function update(db, event, user) {
  const data = JSON.parse(event.body || '{}');
  if (!data.id) {
    return jsonResponse(400, { ok: false, error: 'id is required' });
  }

  const docRef = db.collection('course_catalog').doc(data.id);
  const doc = await docRef.get();
  if (!doc.exists) {
    return jsonResponse(404, { ok: false, error: 'Catalog item not found' });
  }

  const updates = { updated_at: new Date(), updated_by: user.email };
  for (const key of ALLOWED_FIELDS) {
    if (data[key] !== undefined) updates[key] = data[key];
  }
  coerceTypes(updates);

  await docRef.update(updates);
  const updated = await docRef.get();

  console.log(`[catalog-admin] Updated ${data.id}`);
  return jsonResponse(200, { ok: true, item: { id: updated.id, ...updated.data() } });
}

async function remove(db, event) {
  const data = JSON.parse(event.body || '{}');
  if (!data.id) {
    return jsonResponse(400, { ok: false, error: 'id is required' });
  }

  const docRef = db.collection('course_catalog').doc(data.id);
  const doc = await docRef.get();
  if (!doc.exists) {
    return jsonResponse(404, { ok: false, error: 'Catalog item not found' });
  }

  await docRef.delete();
  console.log(`[catalog-admin] Deleted ${data.id}`);
  return jsonResponse(200, { ok: true, message: 'Catalog item deleted' });
}

async function bulkDelete(db, data) {
  const ids = data.ids;
  if (!Array.isArray(ids) || ids.length === 0) {
    return jsonResponse(400, { ok: false, error: 'ids array is required' });
  }
  if (ids.length > 100) {
    return jsonResponse(400, { ok: false, error: 'Maximum 100 items per bulk delete' });
  }

  const batch = db.batch();
  ids.forEach(id => {
    batch.delete(db.collection('course_catalog').doc(id));
  });
  await batch.commit();

  console.log(`[catalog-admin] Bulk deleted ${ids.length} items`);
  return jsonResponse(200, { ok: true, deleted: ids.length });
}

async function bulkUpdate(db, data, user) {
  const ids = data.ids;
  const updates = data.updates;
  if (!Array.isArray(ids) || ids.length === 0) {
    return jsonResponse(400, { ok: false, error: 'ids array is required' });
  }
  if (!updates || typeof updates !== 'object') {
    return jsonResponse(400, { ok: false, error: 'updates object is required' });
  }
  if (ids.length > 100) {
    return jsonResponse(400, { ok: false, error: 'Maximum 100 items per bulk update' });
  }

  // Only allow whitelisted fields
  const safeUpdates = { updated_at: new Date(), updated_by: user.email };
  for (const key of ALLOWED_FIELDS) {
    if (updates[key] !== undefined) safeUpdates[key] = updates[key];
  }
  coerceTypes(safeUpdates);

  const batch = db.batch();
  ids.forEach(id => {
    batch.update(db.collection('course_catalog').doc(id), safeUpdates);
  });
  await batch.commit();

  console.log(`[catalog-admin] Bulk updated ${ids.length} items`);
  return jsonResponse(200, { ok: true, updated: ids.length });
}
