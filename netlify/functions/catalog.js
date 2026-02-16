/**
 * Course Catalog Endpoint — Yoga Bible
 * Public endpoint returning active courses from Firestore.
 *
 * GET /.netlify/functions/catalog
 */

const { getDb } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();
  if (event.httpMethod !== 'GET') return jsonResponse(405, { ok: false, error: 'Method not allowed' });

  try {
    const db = getDb();
    const snap = await db.collection('course_catalog')
      .where('active', '==', true)
      .get();

    const catalog = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    return jsonResponse(200, { ok: true, catalog, count: catalog.length });
  } catch (error) {
    console.error('Catalog error:', error);
    return jsonResponse(500, { ok: false, error: 'System error' });
  }
};
