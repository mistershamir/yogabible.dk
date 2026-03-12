/**
 * Email Templates API — Yoga Bible (Admin)
 * Authenticated endpoint for managing email templates.
 *
 * GET    /.netlify/functions/email-templates           — List all templates
 * GET    /.netlify/functions/email-templates?id=X      — Get single template
 * POST   /.netlify/functions/email-templates           — Create a new template
 * PUT    /.netlify/functions/email-templates?id=X      — Update an existing template
 * DELETE /.netlify/functions/email-templates?id=X      — Delete a template
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
      case 'POST':
        return createOne(db, event);
      case 'PUT':
        return updateOne(db, params.id, event);
      case 'DELETE':
        return deleteOne(db, params.id);
      default:
        return jsonResponse(405, { ok: false, error: 'Method not allowed' });
    }
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

  // Increment use_count on read
  await db.collection('email_templates').doc(id).update({
    use_count: (doc.data().use_count || 0) + 1
  });

  const updated = await db.collection('email_templates').doc(id).get();
  return jsonResponse(200, { ok: true, template: { id: updated.id, ...updated.data() } });
}

async function createOne(db, event) {
  const body = JSON.parse(event.body || '{}');

  if (!body.name) {
    return jsonResponse(400, { ok: false, error: 'Name is required' });
  }

  const now = new Date().toISOString();
  const data = {
    name: body.name,
    subject: body.subject || '',
    preheader: body.preheader || '',
    body_html: body.body_html || '',
    category: body.category || 'newsletter',
    tags: Array.isArray(body.tags) ? body.tags : [],
    created_at: now,
    updated_at: now,
    use_count: 0,
    active: true
  };

  const ref = await db.collection('email_templates').add(data);
  return jsonResponse(201, { ok: true, id: ref.id, template: { id: ref.id, ...data } });
}

async function updateOne(db, id, event) {
  if (!id) {
    return jsonResponse(400, { ok: false, error: 'Template ID is required' });
  }

  const doc = await db.collection('email_templates').doc(id).get();
  if (!doc.exists) {
    return jsonResponse(404, { ok: false, error: 'Template not found' });
  }

  const body = JSON.parse(event.body || '{}');
  const updates = { updated_at: new Date().toISOString() };

  const allowedFields = ['name', 'subject', 'preheader', 'body_html', 'category', 'tags', 'active'];
  allowedFields.forEach(field => {
    if (body[field] !== undefined) updates[field] = body[field];
  });

  await db.collection('email_templates').doc(id).update(updates);
  const updated = await db.collection('email_templates').doc(id).get();
  return jsonResponse(200, { ok: true, template: { id: updated.id, ...updated.data() } });
}

async function deleteOne(db, id) {
  if (!id) {
    return jsonResponse(400, { ok: false, error: 'Template ID is required' });
  }

  const doc = await db.collection('email_templates').doc(id).get();
  if (!doc.exists) {
    return jsonResponse(404, { ok: false, error: 'Template not found' });
  }

  await db.collection('email_templates').doc(id).delete();
  return jsonResponse(200, { ok: true, deleted: id });
}
