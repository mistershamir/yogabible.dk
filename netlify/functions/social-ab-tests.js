/**
 * Social A/B Testing API — Yoga Bible
 * Create and manage A/B tests for social media posts.
 *
 * GET  /.netlify/functions/social-ab-tests?action=list
 * GET  /.netlify/functions/social-ab-tests?action=detail&id=X
 * POST /.netlify/functions/social-ab-tests  { action: 'create', name, platform, variants: [...] }
 * POST /.netlify/functions/social-ab-tests  { action: 'update-metrics', id, variantIndex, metrics }
 * POST /.netlify/functions/social-ab-tests  { action: 'declare-winner', id, winnerIndex }
 * POST /.netlify/functions/social-ab-tests  { action: 'delete', id }
 */

const { getDb, serverTimestamp } = require('./shared/firestore');
const { requireAuth } = require('./shared/auth');
const { jsonResponse, optionsResponse } = require('./shared/utils');

const COLLECTION = 'social_ab_tests';

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  const user = await requireAuth(event, ['admin']);
  if (user.error) return user.error;

  const params = event.queryStringParameters || {};
  const db = getDb();

  try {
    if (event.httpMethod === 'GET') {
      const action = params.action || 'list';
      if (action === 'list') return listTests(db, params);
      if (action === 'detail') return getTestDetail(db, params);
      return jsonResponse(400, { ok: false, error: `Unknown action: ${action}` });
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const action = body.action || params.action;

      switch (action) {
        case 'create': return createTest(db, body, user);
        case 'update-metrics': return updateMetrics(db, body);
        case 'declare-winner': return declareWinner(db, body);
        case 'delete': return deleteTest(db, body);
        default:
          return jsonResponse(400, { ok: false, error: `Unknown action: ${action}` });
      }
    }

    return jsonResponse(405, { ok: false, error: 'Method not allowed' });
  } catch (err) {
    console.error('[social-ab-tests] Error:', err);
    return jsonResponse(500, { ok: false, error: err.message });
  }
};


// ── List all A/B tests ────────────────────────────────────────────

async function listTests(db, params) {
  const filter = params.status || 'all';

  let query = db.collection(COLLECTION).orderBy('createdAt', 'desc').limit(50);

  if (filter !== 'all') {
    query = db.collection(COLLECTION)
      .where('status', '==', filter)
      .orderBy('createdAt', 'desc')
      .limit(50);
  }

  const snap = await query.get();
  const tests = [];

  snap.forEach(doc => {
    const d = doc.data();
    tests.push({
      id: doc.id,
      name: d.name,
      platform: d.platform,
      status: d.status || 'active',
      variantCount: (d.variants || []).length,
      winnerIndex: d.winnerIndex ?? null,
      createdAt: d.createdAt?.toDate?.() || d.createdAt,
      completedAt: d.completedAt?.toDate?.() || d.completedAt || null,
      totalEngagement: (d.variants || []).reduce((sum, v) => {
        const m = v.metrics || {};
        return sum + (m.likes || 0) + (m.comments || 0) + (m.shares || 0);
      }, 0)
    });
  });

  return jsonResponse(200, { ok: true, tests });
}


// ── Get test detail with full variant data ────────────────────────

async function getTestDetail(db, params) {
  const { id } = params;
  if (!id) return jsonResponse(400, { ok: false, error: 'Missing test id' });

  const doc = await db.collection(COLLECTION).doc(id).get();
  if (!doc.exists) return jsonResponse(404, { ok: false, error: 'Test not found' });

  const d = doc.data();

  return jsonResponse(200, {
    ok: true,
    test: {
      id: doc.id,
      name: d.name,
      platform: d.platform,
      status: d.status || 'active',
      winnerIndex: d.winnerIndex ?? null,
      variants: (d.variants || []).map((v, i) => ({
        index: i,
        label: v.label || `Variant ${String.fromCharCode(65 + i)}`,
        caption: v.caption || '',
        imageUrl: v.imageUrl || null,
        postId: v.postId || null,
        metrics: v.metrics || { likes: 0, comments: 0, shares: 0, reach: 0, impressions: 0 },
        isWinner: d.winnerIndex === i
      })),
      notes: d.notes || '',
      createdAt: d.createdAt?.toDate?.() || d.createdAt,
      createdBy: d.createdBy || '',
      completedAt: d.completedAt?.toDate?.() || d.completedAt || null
    }
  });
}


// ── Create a new A/B test ─────────────────────────────────────────

async function createTest(db, body, user) {
  const { name, platform, variants, notes } = body;

  if (!name) return jsonResponse(400, { ok: false, error: 'Missing test name' });
  if (!platform) return jsonResponse(400, { ok: false, error: 'Missing platform' });
  if (!variants || !Array.isArray(variants) || variants.length < 2) {
    return jsonResponse(400, { ok: false, error: 'Need at least 2 variants' });
  }
  if (variants.length > 5) {
    return jsonResponse(400, { ok: false, error: 'Maximum 5 variants allowed' });
  }

  const testData = {
    name,
    platform,
    status: 'active',
    winnerIndex: null,
    notes: notes || '',
    variants: variants.map((v, i) => ({
      label: v.label || `Variant ${String.fromCharCode(65 + i)}`,
      caption: v.caption || '',
      imageUrl: v.imageUrl || null,
      postId: v.postId || null,
      metrics: { likes: 0, comments: 0, shares: 0, reach: 0, impressions: 0 }
    })),
    createdAt: serverTimestamp(),
    createdBy: user.email,
    completedAt: null
  };

  const ref = await db.collection(COLLECTION).add(testData);

  return jsonResponse(200, { ok: true, id: ref.id });
}


// ── Update metrics for a variant ──────────────────────────────────

async function updateMetrics(db, body) {
  const { id, variantIndex, metrics } = body;
  if (!id || variantIndex === undefined || !metrics) {
    return jsonResponse(400, { ok: false, error: 'Missing id, variantIndex, or metrics' });
  }

  const docRef = db.collection(COLLECTION).doc(id);
  const doc = await docRef.get();
  if (!doc.exists) return jsonResponse(404, { ok: false, error: 'Test not found' });

  const data = doc.data();
  const variants = data.variants || [];

  if (variantIndex < 0 || variantIndex >= variants.length) {
    return jsonResponse(400, { ok: false, error: 'Invalid variant index' });
  }

  // Merge metrics
  variants[variantIndex].metrics = {
    ...(variants[variantIndex].metrics || {}),
    ...metrics
  };

  await docRef.update({ variants, updatedAt: serverTimestamp() });

  return jsonResponse(200, { ok: true, updated: true });
}


// ── Declare a winner ──────────────────────────────────────────────

async function declareWinner(db, body) {
  const { id, winnerIndex } = body;
  if (!id || winnerIndex === undefined) {
    return jsonResponse(400, { ok: false, error: 'Missing id or winnerIndex' });
  }

  const docRef = db.collection(COLLECTION).doc(id);
  const doc = await docRef.get();
  if (!doc.exists) return jsonResponse(404, { ok: false, error: 'Test not found' });

  const data = doc.data();
  if (winnerIndex < 0 || winnerIndex >= (data.variants || []).length) {
    return jsonResponse(400, { ok: false, error: 'Invalid winner index' });
  }

  await docRef.update({
    winnerIndex,
    status: 'completed',
    completedAt: serverTimestamp()
  });

  return jsonResponse(200, { ok: true, winner: winnerIndex });
}


// ── Delete a test ─────────────────────────────────────────────────

async function deleteTest(db, body) {
  const { id } = body;
  if (!id) return jsonResponse(400, { ok: false, error: 'Missing test id' });

  const docRef = db.collection(COLLECTION).doc(id);
  const doc = await docRef.get();
  if (!doc.exists) return jsonResponse(404, { ok: false, error: 'Test not found' });

  await docRef.delete();
  return jsonResponse(200, { ok: true, deleted: id });
}
