/**
 * Campaign Log Endpoint — Yoga Bible
 * Stores and retrieves campaign send history.
 *
 * POST /.netlify/functions/campaign-log — Save a campaign record
 * GET  /.netlify/functions/campaign-log — List past campaigns (paginated)
 */

const { requireAuth } = require('./shared/auth');
const { getDb } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  // Auth check — admin or marketing
  const authResult = await requireAuth(event, ['admin', 'marketing']);
  if (authResult.error) return authResult.error;

  const db = getDb();

  try {
    if (event.httpMethod === 'POST') {
      return await handleCreate(db, event);
    }

    if (event.httpMethod === 'GET') {
      return await handleList(db, event);
    }

    return jsonResponse(405, { ok: false, error: 'Method not allowed' });
  } catch (err) {
    console.error('[campaign-log] Error:', err);
    return jsonResponse(500, { ok: false, error: err.message });
  }
};

async function handleCreate(db, event) {
  const payload = JSON.parse(event.body || '{}');

  if (!payload.type) {
    return jsonResponse(400, { ok: false, error: 'type is required (sms or email)' });
  }

  const record = {
    type: payload.type,                          // 'sms' or 'email'
    templateId: payload.templateId || null,
    subject: payload.subject || '',
    recipientCount: payload.recipientCount || 0,
    results: payload.results || {},              // { sent, failed, skipped, scheduled }
    schedule: payload.schedule || 'now',
    sentAt: payload.sentAt || new Date().toISOString(),
    createdAt: new Date().toISOString(),
    sentBy: event.headers['x-user-email'] || 'unknown'
  };

  const ref = await db.collection('campaigns').add(record);

  return jsonResponse(200, {
    ok: true,
    campaignId: ref.id,
    record
  });
}

async function handleList(db, event) {
  const params = event.queryStringParameters || {};
  const limit = Math.min(parseInt(params.limit) || 20, 100);
  const offset = parseInt(params.offset) || 0;

  let query = db.collection('campaigns')
    .orderBy('createdAt', 'desc')
    .limit(limit);

  if (offset > 0) {
    // Simple offset via extra fetch — fine for small datasets
    const skipSnap = await db.collection('campaigns')
      .orderBy('createdAt', 'desc')
      .limit(offset)
      .get();

    if (!skipSnap.empty) {
      const lastDoc = skipSnap.docs[skipSnap.docs.length - 1];
      query = query.startAfter(lastDoc);
    }
  }

  const snap = await query.get();
  const campaigns = [];

  snap.forEach(doc => {
    campaigns.push({
      id: doc.id,
      ...doc.data()
    });
  });

  return jsonResponse(200, {
    ok: true,
    campaigns,
    count: campaigns.length,
    hasMore: campaigns.length === limit
  });
}
