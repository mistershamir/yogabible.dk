/**
 * Email Templates API — Yoga Bible (Admin)
 * Authenticated endpoint for managing email templates.
 *
 * GET /.netlify/functions/email-templates           — List all templates
 * GET /.netlify/functions/email-templates?id=X      — Get single template
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
    if (event.httpMethod === 'GET') {
      return params.id ? getOne(db, params.id) : getAll(db, params);
    }
    return jsonResponse(405, { ok: false, error: 'Method not allowed' });
  } catch (error) {
    console.error('[email-templates] Error:', error);
    return jsonResponse(500, { ok: false, error: error.message });
  }
};

async function getAll(db, params) {
  let query = db.collection('email_templates');

  if (params.category) query = query.where('category', '==', params.category);
  if (params.active !== undefined) query = query.where('active', '==', params.active === 'true');

  const snapshot = await query.get();
  const templates = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  return jsonResponse(200, { ok: true, templates, count: templates.length });
}

async function getOne(db, id) {
  const doc = await db.collection('email_templates').doc(id).get();
  if (!doc.exists) {
    return jsonResponse(404, { ok: false, error: 'Template not found' });
  }
  return jsonResponse(200, { ok: true, template: { id: doc.id, ...doc.data() } });
}
