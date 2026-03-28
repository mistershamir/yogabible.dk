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

const FB_API = 'https://graph.facebook.com/v21.0';
const COMPETITORS_COLLECTION = 'social_competitors';
const SNAPSHOTS_COLLECTION = 'social_competitor_snapshots';
const ACCOUNTS_COLLECTION = 'social_accounts';

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

  const validPlatforms = ['instagram', 'facebook', 'tiktok', 'linkedin', 'youtube', 'pinterest'];
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
// Uses Instagram Business Discovery API to fetch public competitor profiles.
// Requires our own connected IG account token for the business_discovery endpoint.

async function refreshCompetitors(db) {
  const snap = await db.collection(COMPETITORS_COLLECTION).get();

  if (snap.empty) {
    return jsonResponse(200, { ok: true, message: 'No competitors tracked', refreshed: [] });
  }

  // Load our connected account tokens for API access
  const accountsSnap = await db.collection(ACCOUNTS_COLLECTION).get();
  const accounts = {};
  accountsSnap.forEach(doc => { accounts[doc.id] = doc.data(); });

  const refreshed = [];
  const errors = [];

  for (const doc of snap.docs) {
    const data = doc.data();

    try {
      let liveData = null;

      if (data.platform === 'instagram' && accounts.instagram) {
        liveData = await fetchInstagramCompetitor(accounts.instagram, data.handle);
      } else if (data.platform === 'facebook' && accounts.facebook) {
        liveData = await fetchFacebookCompetitor(accounts.facebook, data.handle);
      }

      // Build update with live data or preserve existing
      const update = {
        lastRefreshed: serverTimestamp()
      };

      if (liveData) {
        update.followerCount = liveData.followers ?? data.followerCount;
        update.postCount = liveData.mediaCount ?? data.postCount;
        update.name = liveData.name || data.name;
        update.profilePicture = liveData.profilePicture || data.profilePicture;
        if (liveData.avgLikes !== undefined) update.avgLikes = liveData.avgLikes;
        if (liveData.avgComments !== undefined) update.avgComments = liveData.avgComments;
        if (liveData.engagementRate !== undefined) update.engagementRate = liveData.engagementRate;
      }

      await doc.ref.update(update);

      // Store daily snapshot for historical trending
      await db.collection(SNAPSHOTS_COLLECTION).add({
        competitorId: doc.id,
        platform: data.platform,
        followerCount: update.followerCount ?? data.followerCount ?? 0,
        postCount: update.postCount ?? data.postCount ?? 0,
        engagementRate: update.engagementRate ?? data.engagementRate ?? 0,
        avgLikes: update.avgLikes ?? data.avgLikes ?? 0,
        avgComments: update.avgComments ?? data.avgComments ?? 0,
        capturedAt: serverTimestamp()
      });

      refreshed.push({
        id: doc.id, handle: data.handle, platform: data.platform,
        followers: update.followerCount ?? data.followerCount
      });
    } catch (err) {
      console.error(`[social-competitors] Refresh error for ${data.handle}:`, err.message);
      errors.push({ id: doc.id, handle: data.handle, error: err.message });
    }
  }

  console.log('[social-competitors] Refreshed:', refreshed.length, 'errors:', errors.length);
  return jsonResponse(200, { ok: true, refreshed, errors });
}


// ── Instagram Business Discovery ────────────────────────────────
// Uses our own IG Business account to look up public competitor profiles.

async function fetchInstagramCompetitor(ourAccount, handle) {
  const { accessToken, igAccountId } = ourAccount;
  if (!accessToken || !igAccountId) return null;

  try {
    // Business discovery endpoint — fetches public profile data
    const fields = 'username,name,followers_count,media_count,profile_picture_url,media.limit(12){like_count,comments_count,timestamp}';
    const url = `${FB_API}/${igAccountId}?fields=business_discovery.fields(${fields})&username=${encodeURIComponent(handle)}&access_token=${accessToken}`;

    const res = await fetch(url);
    const data = await res.json();

    if (data.error) {
      console.warn('[social-competitors] IG discovery error for', handle, ':', data.error.message);
      return null;
    }

    const bd = data.business_discovery;
    if (!bd) return null;

    // Calculate average engagement from recent posts
    const recentMedia = bd.media?.data || [];
    let totalLikes = 0, totalComments = 0;
    for (const post of recentMedia) {
      totalLikes += post.like_count || 0;
      totalComments += post.comments_count || 0;
    }

    const postCount = recentMedia.length || 1;
    const avgLikes = Math.round(totalLikes / postCount);
    const avgComments = Math.round(totalComments / postCount);
    const followers = bd.followers_count || 0;
    const engagementRate = followers > 0
      ? parseFloat(((totalLikes + totalComments) / postCount / followers * 100).toFixed(2))
      : 0;

    return {
      name: bd.name || bd.username,
      followers: bd.followers_count || 0,
      mediaCount: bd.media_count || 0,
      profilePicture: bd.profile_picture_url || null,
      avgLikes,
      avgComments,
      engagementRate
    };
  } catch (err) {
    console.error('[social-competitors] IG fetch error for', handle, ':', err.message);
    return null;
  }
}


// ── Facebook Page lookup ────────────────────────────────────────

async function fetchFacebookCompetitor(ourAccount, handle) {
  const { accessToken } = ourAccount;
  if (!accessToken) return null;

  try {
    // Try searching for the page by name/handle
    const url = `${FB_API}/${handle}?fields=name,fan_count,followers_count,picture&access_token=${accessToken}`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.error) {
      console.warn('[social-competitors] FB lookup error for', handle, ':', data.error.message);
      return null;
    }

    return {
      name: data.name || handle,
      followers: data.followers_count || data.fan_count || 0,
      profilePicture: data.picture?.data?.url || null
    };
  } catch (err) {
    console.error('[social-competitors] FB fetch error for', handle, ':', err.message);
    return null;
  }
}
