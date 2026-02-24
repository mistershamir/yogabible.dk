/**
 * SMS Conversations API — Yoga Bible (Admin)
 * Authenticated endpoint for reading SMS conversation threads.
 *
 * GET  /.netlify/functions/sms-conversations?lead_id=X  — Get all messages for a lead
 * PUT  /.netlify/functions/sms-conversations             — Mark messages as read
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
        return getConversation(db, params);
      case 'PUT':
        return markAsRead(db, event);
      default:
        return jsonResponse(405, { ok: false, error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('[sms-conversations] Error:', error);
    return jsonResponse(500, { ok: false, error: error.message });
  }
};

async function getConversation(db, params) {
  if (!params.lead_id) {
    return jsonResponse(400, { ok: false, error: 'lead_id is required' });
  }

  const snap = await db.collection('leads').doc(params.lead_id)
    .collection('sms_messages')
    .orderBy('timestamp', 'asc')
    .limit(100)
    .get();

  const messages = snap.docs.map(doc => ({
    id: doc.id,
    ...doc.data(),
    timestamp: doc.data().timestamp && doc.data().timestamp.toDate
      ? doc.data().timestamp.toDate().toISOString()
      : doc.data().timestamp
  }));

  return jsonResponse(200, { ok: true, messages, count: messages.length });
}

async function markAsRead(db, event) {
  const data = JSON.parse(event.body || '{}');
  if (!data.lead_id) {
    return jsonResponse(400, { ok: false, error: 'lead_id is required' });
  }

  const leadRef = db.collection('leads').doc(data.lead_id);

  // Find all unread messages and mark them read
  const unreadSnap = await leadRef.collection('sms_messages')
    .where('read', '==', false)
    .get();

  if (!unreadSnap.empty) {
    const batch = db.batch();
    unreadSnap.forEach(doc => {
      batch.update(doc.ref, { read: true });
    });
    await batch.commit();
  }

  // Clear unread flag on lead
  await leadRef.update({ has_unread_sms: false });

  return jsonResponse(200, { ok: true, marked: unreadSnap.size });
}
