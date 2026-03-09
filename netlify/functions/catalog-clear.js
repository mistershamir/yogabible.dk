/**
 * Catalog Clear — Emergency reset
 * Deletes ALL items from course_catalog collection.
 * Admin-only. POST /.netlify/functions/catalog-clear?confirm=DELETE_ALL
 */

const { getDb } = require('./shared/firestore');
const { requireAuth } = require('./shared/auth');
const { jsonResponse, optionsResponse } = require('./shared/utils');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { ok: false, error: 'POST only' });
  }

  const user = await requireAuth(event, ['admin']);
  if (user.error) return user.error;

  const params = event.queryStringParameters || {};
  if (params.confirm !== 'DELETE_ALL') {
    return jsonResponse(400, { ok: false, error: 'Pass ?confirm=DELETE_ALL to proceed' });
  }

  const db = getDb();

  // Get all docs and delete in batches
  const snapshot = await db.collection('course_catalog').get();
  const docCount = snapshot.size;

  if (docCount === 0) {
    return jsonResponse(200, { ok: true, deleted: 0, message: 'Collection already empty' });
  }

  const batchSize = 500;
  let deleted = 0;

  const docs = snapshot.docs;
  for (let i = 0; i < docs.length; i += batchSize) {
    const batch = db.batch();
    const chunk = docs.slice(i, i + batchSize);

    for (const doc of chunk) {
      batch.delete(doc.ref);
    }

    await batch.commit();
    deleted += chunk.length;
  }

  console.log(`[catalog-clear] Deleted ${deleted} items by ${user.email}`);

  return jsonResponse(200, {
    ok: true,
    deleted,
    message: `Cleared ${deleted} catalog items. Run catalog-seed to repopulate.`
  });
};
