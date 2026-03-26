/**
 * Social Competitors API — Yoga Bible
 * Track and compare competitor social media accounts.
 *
 * GET  /.netlify/functions/social-competitors?action=list
 * GET  /.netlify/functions/social-competitors?action=snapshots&id=X&days=30
 * POST /.netlify/functions/social-competitors  { action: 'add', platform, handle, name? }
 * POST /.netlify/functions/social-competitors  { action: 'remove', id }
 * POST /.netlify/functions/social-competitors  { action: 'refresh' }
 */

const { getDb, serverTimestamp } = require('./shared/firestore');
const { requireAuth } = require('./shared/auth');
const { jsonResponse, optionsResponse } = require('./shared/utils');

const COMPETITORS_COLLECTION = 'social_competitors';
const SNAPSHOTS_COLLECTION = 'social_competitor_snapshots';

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  const user = await requireAuth(event, ['admin']);
  if (user.error) return user.error;

  const params = event.queryStringParameters || {};
  const db = getDb();

  try {
    if (event.httpMethod === 'GET') {
      const action = params.action || 'list';
      if (action === 'list') return listCompetitors(db);
      if (action === 'snapshots') return getSnapshots(db, params);
      return jsonResponse(400, { ok: false, error: `Unknown action: ${action}` });
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const action = body.action || params.action;

      switch (action) {
        case 'add': return addCompetitor(db, body);
        case 'remove': return removeCompetitor(db, body);
        case 'refresh': return refreshCompetitors(db);
        default:
          return jsonResponse(400, { ok: false, error: `Unknown action: ${action}` });
      }
    }

    return jsonResponse(405, { ok: false, error: 'Method not allowed' });
  } catch (err) {
    console.error('[social-competitors] Error:', err);
    return jsonResponse(500, { ok: false, error: err.message });
  }
};


// ── List all tracked competitors ──────────────────────────────────

async function listCompetitors(db) {
  const snap = await db.collection(COMPETITORS_COLLECTION)
    .orderBy('addedAt', 'desc')
    .get();

  const competitors = [];
  snap.forEach(doc => {
    const d = doc.data();
    competitors.push({
      id: doc.id,
      platform: d.platform,
      handle: d.handle,
      name: d.name || d.handle,
      followerCount: d.followerCount || 0,
      followingCount: d.followingCount || 0,
      postCount: d.postCount || 0,
      engagementRate: d.engagementRate || 0,
      avgLikes: d.avgLikes || 0,
      avgComments: d.avgComments || 0,
      profilePicture: d.profilePicture || null,
      lastRefreshed: d.lastRefreshed?.toDate?.() || d.lastRefreshed || null,
      addedAt: d.addedAt?.toDate?.() || d.addedAt || null
    });
  });

  return jsonResponse(200, { ok: true, competitors });
}


// ── Get historical snapshots for a competitor ─────────────────────

async function getSnapshots(db, params) {
  const { id } = params;
  if (!id) return jsonResponse(400, { ok: false, error: 'Missing competitor id' });

  const days = parseInt(params.days) || 30;
  const since = new Date();
  since.setDate(since.getDate() - days);

  let snap;
  try {
    snap = await db.collection(SNAPSHOTS_COLLECTION)
      .where('competitorId', '==', id)
      .where('capturedAt', '>=', since)
      .orderBy('capturedAt', 'asc')
      .limit(100)
      .get();
  } catch (err) {
    snap = await db.collection(SNAPSHOTS_COLLECTION)
      .where('competitorId', '==', id)
      .orderBy('capturedAt', 'desc')
      .limit(60)
      .get();
  }

  const snapshots = [];
  snap.forEach(doc => {
    const d = doc.data();
    snapshots.push({
      date: d.capturedAt?.toDate?.() || d.capturedAt,
      followers: d.followerCount || 0,
      posts: d.postCount || 0,
      engagementRate: d.engagementRate || 0,
      avgLikes: d.avgLikes || 0,
      avgComments: d.avgComments || 0
    });
  });

  return jsonResponse(200, { ok: true, snapshots });
}


// ── Add a competitor to track ─────────────────────────────────────

async function addCompetitor(db, body) {
  const { platform, handle, name } = body;
  if (!platform || !handle) {
    return jsonResponse(400, { ok: false, error: 'Missing platform or handle' });
  }

  const validPlatforms = ['instagram', 'facebook', 'tiktok', 'linkedin'];
  if (!validPlatforms.includes(platform)) {
    return jsonResponse(400, { ok: false, error: `Invalid platform. Supported: ${validPlatforms.join(', ')}` });
  }

  // Check for duplicate
  const existing = await db.collection(COMPETITORS_COLLECTION)
    .where('platform', '==', platform)
    .where('handle', '==', handle.toLowerCase().replace('@', ''))
    .get();

  if (!existing.empty) {
    return jsonResponse(400, { ok: false, error: 'This competitor is already being tracked' });
  }

  const competitorData = {
    platform,
    handle: handle.toLowerCase().replace('@', ''),
    name: name || handle,
    followerCount: 0,
    followingCount: 0,
    postCount: 0,
    engagementRate: 0,
    avgLikes: 0,
    avgComments: 0,
    profilePicture: null,
    addedAt: serverTimestamp(),
    lastRefreshed: null
  };

  const ref = await db.collection(COMPETITORS_COLLECTION).add(competitorData);

  return jsonResponse(200, {
    ok: true,
    id: ref.id,
    competitor: { id: ref.id, ...competitorData }
  });
}


// ── Remove a competitor ───────────────────────────────────────────

async function removeCompetitor(db, body) {
  const { id } = body;
  if (!id) return jsonResponse(400, { ok: false, error: 'Missing competitor id' });

  const docRef = db.collection(COMPETITORS_COLLECTION).doc(id);
  const doc = await docRef.get();

  if (!doc.exists) {
    return jsonResponse(404, { ok: false, error: 'Competitor not found' });
  }

  await docRef.delete();

  // Also clean up snapshots
  const snaps = await db.collection(SNAPSHOTS_COLLECTION)
    .where('competitorId', '==', id)
    .limit(500)
    .get();

  if (!snaps.empty) {
    const batch = db.batch();
    snaps.forEach(s => batch.delete(s.ref));
    await batch.commit();
  }

  return jsonResponse(200, { ok: true, removed: id });
}


// ── Refresh competitor metrics ────────────────────────────────────
// Note: Public API data only — uses public profile scraping approach
// For production, integrate with platform APIs or a third-party service

async function refreshCompetitors(db) {
  const snap = await db.collection(COMPETITORS_COLLECTION).get();

  if (snap.empty) {
    return jsonResponse(200, { ok: true, message: 'No competitors tracked', refreshed: [] });
  }

  const refreshed = [];
  const errors = [];

  for (const doc of snap.docs) {
    const data = doc.data();

    try {
      // For now, create a snapshot of current values
      // In production, this would call platform APIs or scraping services
      const snapshot = {
        competitorId: doc.id,
        platform: data.platform,
        followerCount: data.followerCount || 0,
        postCount: data.postCount || 0,
        engagementRate: data.engagementRate || 0,
        avgLikes: data.avgLikes || 0,
        avgComments: data.avgComments || 0,
        capturedAt: serverTimestamp()
      };

      await db.collection(SNAPSHOTS_COLLECTION).add(snapshot);

      await doc.ref.update({ lastRefreshed: serverTimestamp() });
      refreshed.push({ id: doc.id, handle: data.handle, platform: data.platform });
    } catch (err) {
      console.error(`[social-competitors] Refresh error for ${data.handle}:`, err.message);
      errors.push({ id: doc.id, handle: data.handle, error: err.message });
    }
  }

  return jsonResponse(200, { ok: true, refreshed, errors });
}
