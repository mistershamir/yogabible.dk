/**
 * Social Saved Replies API — Yoga Bible
 * CRUD for saved/canned reply templates used in the inbox.
 *
 * GET  /.netlify/functions/social-saved-replies?action=list
 * POST /.netlify/functions/social-saved-replies  { action: 'create', name, text, category?, shortcut? }
 * POST /.netlify/functions/social-saved-replies  { action: 'update', id, name?, text?, category?, shortcut? }
 * POST /.netlify/functions/social-saved-replies  { action: 'delete', id }
 */

const { getDb, serverTimestamp } = require('./shared/firestore');
const { requireAuth } = require('./shared/auth');
const { jsonResponse, optionsResponse } = require('./shared/utils');

const COLLECTION = 'social_saved_replies';

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  const user = await requireAuth(event, ['admin']);
  if (user.error) return user.error;

  const params = event.queryStringParameters || {};
  const db = getDb();

  try {
    if (event.httpMethod === 'GET') {
      return listReplies(db);
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const action = body.action || params.action;

      switch (action) {
        case 'create': return createReply(db, body);
        case 'update': return updateReply(db, body);
        case 'delete': return deleteReply(db, body);
        default:
          return jsonResponse(400, { ok: false, error: `Unknown action: ${action}` });
      }
    }

    return jsonResponse(405, { ok: false, error: 'Method not allowed' });
  } catch (err) {
    console.error('[social-saved-replies] Error:', err);
    return jsonResponse(500, { ok: false, error: err.message });
  }
};


// ── List all saved replies ────────────────────────────────────────

async function listReplies(db) {
  const snap = await db.collection(COLLECTION)
    .orderBy('usageCount', 'desc')
    .limit(100)
    .get();

  const replies = [];
  snap.forEach(doc => {
    replies.push({ id: doc.id, ...doc.data() });
  });

  return jsonResponse(200, { ok: true, replies });
}


// ── Create a saved reply ──────────────────────────────────────────

async function createReply(db, body) {
  const { name, text, category, shortcut } = body;
  if (!name || !text) {
    return jsonResponse(400, { ok: false, error: 'Missing name or text' });
  }

  const doc = {
    name: name.trim(),
    text: text.trim(),
    category: category || 'general',
    shortcut: shortcut || '',
    usageCount: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  const ref = await db.collection(COLLECTION).add(doc);
  return jsonResponse(200, { ok: true, id: ref.id });
}


// ── Update a saved reply ──────────────────────────────────────────

async function updateReply(db, body) {
  const { id } = body;
  if (!id) return jsonResponse(400, { ok: false, error: 'Missing id' });

  const allowed = ['name', 'text', 'category', 'shortcut'];
  const updates = { updatedAt: serverTimestamp() };
  allowed.forEach(k => { if (body[k] !== undefined) updates[k] = body[k]; });

  // Increment usage count if flagged
  if (body.incrementUsage) {
    const doc = await db.collection(COLLECTION).doc(id).get();
    if (doc.exists) {
      updates.usageCount = (doc.data().usageCount || 0) + 1;
      updates.lastUsedAt = serverTimestamp();
    }
  }

  await db.collection(COLLECTION).doc(id).update(updates);
  return jsonResponse(200, { ok: true });
}


// ── Delete a saved reply ──────────────────────────────────────────

async function deleteReply(db, body) {
  const { id } = body;
  if (!id) return jsonResponse(400, { ok: false, error: 'Missing id' });

  await db.collection(COLLECTION).doc(id).delete();
  return jsonResponse(200, { ok: true });
}
