/**
 * Agent Knowledge Base Admin API — Yoga Bible
 * Admin-only CRUD for the agent_knowledge Firestore collection.
 *
 * GET    /.netlify/functions/knowledge-admin                — list all sections
 * GET    /.netlify/functions/knowledge-admin?id=X           — get single section
 * GET    /.netlify/functions/knowledge-admin?brand=X        — filter by brand
 * POST   /.netlify/functions/knowledge-admin                — create new section
 * PUT    /.netlify/functions/knowledge-admin                — update section
 * DELETE /.netlify/functions/knowledge-admin?id=X           — delete section
 */

const { getDb, serverTimestamp } = require('./shared/firestore');
const { requireAuth } = require('./shared/auth');
const { jsonResponse, optionsResponse } = require('./shared/utils');

const COLLECTION = 'agent_knowledge';

const BRANDS = ['yoga-bible', 'hot-yoga-cph', 'vibro-yoga'];

const ALLOWED_FIELDS = [
  'brand', 'section_key', 'title', 'content', 'sort_order', 'active'
];

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
      case 'POST':
        return create(db, event, user);
      case 'PUT':
        return update(db, event, user);
      case 'DELETE':
        return remove(db, params);
      default:
        return jsonResponse(405, { ok: false, error: 'Method not allowed' });
    }
  } catch (err) {
    console.error('[knowledge-admin] Error:', err);
    return jsonResponse(500, { ok: false, error: err.message });
  }
};


// ── GET all sections ────────────────────────────────────
async function getAll(db, params) {
  let query = db.collection(COLLECTION).orderBy('brand').orderBy('sort_order');

  if (params.brand && BRANDS.includes(params.brand)) {
    query = db.collection(COLLECTION)
      .where('brand', '==', params.brand)
      .orderBy('sort_order');
  }

  const snap = await query.get();
  const items = [];
  snap.forEach(doc => items.push({ id: doc.id, ...doc.data() }));
  return jsonResponse(200, { ok: true, items });
}


// ── GET single section ──────────────────────────────────
async function getOne(db, id) {
  const doc = await db.collection(COLLECTION).doc(id).get();
  if (!doc.exists) return jsonResponse(404, { ok: false, error: 'Not found' });
  return jsonResponse(200, { ok: true, item: { id: doc.id, ...doc.data() } });
}


// ── POST create section ─────────────────────────────────
async function create(db, event, user) {
  const body = JSON.parse(event.body || '{}');
  const data = {};

  for (const field of ALLOWED_FIELDS) {
    if (body[field] !== undefined) data[field] = body[field];
  }

  if (!data.brand || !BRANDS.includes(data.brand)) {
    return jsonResponse(400, { ok: false, error: `brand must be one of: ${BRANDS.join(', ')}` });
  }
  if (!data.section_key || !data.title) {
    return jsonResponse(400, { ok: false, error: 'section_key and title are required' });
  }

  data.active = data.active !== false;
  data.sort_order = data.sort_order || 0;
  data.content = data.content || '';
  data.created_at = serverTimestamp();
  data.updated_at = serverTimestamp();
  data.created_by = user.email;

  const ref = await db.collection(COLLECTION).add(data);
  return jsonResponse(201, { ok: true, id: ref.id });
}


// ── PUT update section ──────────────────────────────────
async function update(db, event, user) {
  const body = JSON.parse(event.body || '{}');
  const { id, ...fields } = body;

  if (!id) return jsonResponse(400, { ok: false, error: 'id is required' });

  const docRef = db.collection(COLLECTION).doc(id);
  const doc = await docRef.get();
  if (!doc.exists) return jsonResponse(404, { ok: false, error: 'Not found' });

  const data = {};
  for (const field of ALLOWED_FIELDS) {
    if (fields[field] !== undefined) data[field] = fields[field];
  }

  if (data.brand && !BRANDS.includes(data.brand)) {
    return jsonResponse(400, { ok: false, error: `brand must be one of: ${BRANDS.join(', ')}` });
  }

  data.updated_at = serverTimestamp();
  data.updated_by = user.email;

  await docRef.update(data);
  return jsonResponse(200, { ok: true, id });
}


// ── DELETE section ──────────────────────────────────────
async function remove(db, params) {
  if (!params.id) return jsonResponse(400, { ok: false, error: 'id is required' });
  const docRef = db.collection(COLLECTION).doc(params.id);
  const doc = await docRef.get();
  if (!doc.exists) return jsonResponse(404, { ok: false, error: 'Not found' });
  await docRef.delete();
  return jsonResponse(200, { ok: true, deleted: params.id });
}
