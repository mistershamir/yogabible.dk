/**
 * Social Analytics API — Yoga Bible
 * Fetches and aggregates analytics from connected social media platforms.
 *
 * GET  /.netlify/functions/social-analytics?action=overview
 * GET  /.netlify/functions/social-analytics?action=post-metrics&postId=X
 * GET  /.netlify/functions/social-analytics?action=recent[&days=30]
 * POST /.netlify/functions/social-analytics  { action: 'sync' }
 */

const { getDb, serverTimestamp } = require('./shared/firestore');
const { requireAuth } = require('./shared/auth');
const { jsonResponse, optionsResponse } = require('./shared/utils');
const {
  getInstagramMetrics,
  getFacebookMetrics,
  getInstagramAccountInfo,
  getFacebookPageInfo
} = require('./shared/social-api');

const POSTS_COLLECTION = 'social_posts';
const ACCOUNTS_COLLECTION = 'social_accounts';
const ANALYTICS_COLLECTION = 'social_analytics';

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  const user = await requireAuth(event, ['admin']);
  if (user.error) return user.error;

  const params = event.queryStringParameters || {};
  const db = getDb();

  try {
    if (event.httpMethod === 'GET') {
      const action = params.action || 'overview';

      switch (action) {
        case 'overview': return getOverview(db, params);
        case 'post-metrics': return getPostMetrics(db, params);
        case 'recent': return getRecentMetrics(db, params);
        default:
          return jsonResponse(400, { ok: false, error: `Unknown action: ${action}` });
      }
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const action = body.action || params.action;

      if (action === 'sync') return syncMetrics(db);
      return jsonResponse(400, { ok: false, error: `Unknown action: ${action}` });
    }

    return jsonResponse(405, { ok: false, error: 'Method not allowed' });
  } catch (err) {
    console.error('[social-analytics] Error:', err);
    return jsonResponse(500, { ok: false, error: err.message });
  }
};


// ── Overview: aggregate stats across all platforms ───────────────

async function getOverview(db, params) {
  const days = parseInt(params.days) || 30;
  const since = new Date();
  since.setDate(since.getDate() - days);

  // Get follower counts from connected accounts
  const accountsSnap = await db.collection(ACCOUNTS_COLLECTION).get();
  let totalFollowers = 0;
  const platformFollowers = {};

  accountsSnap.forEach(doc => {
    const data = doc.data();
    const platform = data.platform || doc.id;
    const count = data.followerCount || 0;
    totalFollowers += count;
    platformFollowers[platform] = count;
  });

  // Count published posts in period
  let totalPosts = 0;
  try {
    const postsSnap = await db.collection(POSTS_COLLECTION)
      .where('status', '==', 'published')
      .where('publishedAt', '>=', since)
      .get();
    totalPosts = postsSnap.size;
  } catch (err) {
    // If index missing, count all published posts
    console.warn('[social-analytics] Index fallback for overview:', err.message);
    const allPublished = await db.collection(POSTS_COLLECTION)
      .where('status', '==', 'published')
      .get();
    totalPosts = allPublished.size;
  }

  // Aggregate engagement from stored analytics
  let totalReach = 0;
  let totalEngagement = 0;
  let engagementCount = 0;

  const analyticsSnap = await db.collection(ANALYTICS_COLLECTION)
    .where('fetchedAt', '>=', since)
    .limit(200)
    .get();

  analyticsSnap.forEach(doc => {
    const data = doc.data();
    const m = data.metrics || {};

    totalReach += (m.reach || m.post_reach || 0);

    const engagement = (m.likes || 0) + (m.comments || 0) + (m.shares || 0) + (m.saved || 0);
    const impressions = m.impressions || m.post_impressions || 1;
    if (impressions > 0) {
      totalEngagement += (engagement / impressions) * 100;
      engagementCount++;
    }
  });

  const avgEngagement = engagementCount > 0
    ? Math.round((totalEngagement / engagementCount) * 100) / 100
    : 0;

  return jsonResponse(200, {
    ok: true,
    overview: {
      totalFollowers,
      platformFollowers,
      totalPosts,
      totalReach,
      avgEngagement,
      period: days
    }
  });
}


// ── Post metrics: get metrics for a specific post ───────────────

async function getPostMetrics(db, params) {
  const { postId } = params;

  if (!postId) {
    return jsonResponse(400, { ok: false, error: 'Missing postId parameter' });
  }

  const postDoc = await db.collection(POSTS_COLLECTION).doc(postId).get();
  if (!postDoc.exists) {
    return jsonResponse(404, { ok: false, error: 'Post not found' });
  }

  const post = postDoc.data();
  const publishResults = post.publishResults || {};

  // Load connected accounts for API access
  const accountsSnap = await db.collection(ACCOUNTS_COLLECTION).get();
  const accounts = {};
  accountsSnap.forEach(doc => {
    accounts[doc.id] = doc.data();
  });

  const metrics = {};

  // Fetch metrics from each platform
  for (const [platform, result] of Object.entries(publishResults)) {
    if (platform.startsWith('_')) continue; // Skip internal keys like _scheduler_error
    if (!result.success || !result.id) continue;

    const account = accounts[platform];
    if (!account || !account.accessToken) continue;

    try {
      let platformMetrics;

      if (platform === 'instagram') {
        platformMetrics = await getInstagramMetrics(
          { accessToken: account.accessToken },
          result.id
        );
      } else if (platform === 'facebook') {
        platformMetrics = await getFacebookMetrics(
          { accessToken: account.accessToken },
          result.id
        );
      }

      if (platformMetrics && platformMetrics.success) {
        metrics[platform] = platformMetrics.metrics;

        // Store in analytics collection for future reference
        await db.collection(ANALYTICS_COLLECTION).doc(`${postId}_${platform}`).set({
          postId,
          platform,
          platformPostId: result.id,
          metrics: platformMetrics.metrics,
          fetchedAt: serverTimestamp()
        });
      } else {
        metrics[platform] = { error: platformMetrics?.error || 'Failed to fetch metrics' };
      }
    } catch (err) {
      console.error(`[social-analytics] Metrics error for ${platform}:`, err.message);
      metrics[platform] = { error: err.message };
    }
  }

  return jsonResponse(200, { ok: true, postId, metrics });
}


// ── Recent: get metrics for recently published posts ────────────

async function getRecentMetrics(db, params) {
  const days = parseInt(params.days) || 30;
  const since = new Date();
  since.setDate(since.getDate() - days);

  // Get recently published posts
  let postsSnap;
  try {
    postsSnap = await db.collection(POSTS_COLLECTION)
      .where('status', '==', 'published')
      .where('publishedAt', '>=', since)
      .orderBy('publishedAt', 'desc')
      .limit(50)
      .get();
  } catch (err) {
    console.warn('[social-analytics] Index fallback for recent:', err.message);
    postsSnap = await db.collection(POSTS_COLLECTION)
      .where('status', '==', 'published')
      .orderBy('publishedAt', 'desc')
      .limit(50)
      .get();
  }

  if (postsSnap.empty) {
    return jsonResponse(200, { ok: true, posts: [], period: days });
  }

  // Load stored analytics for these posts
  const postIds = postsSnap.docs.map(d => d.id);
  const posts = [];

  for (const doc of postsSnap.docs) {
    const data = doc.data();

    // Fetch stored analytics
    const analyticsSnap = await db.collection(ANALYTICS_COLLECTION)
      .where('postId', '==', doc.id)
      .get();

    const analytics = {};
    analyticsSnap.forEach(aDoc => {
      const aData = aDoc.data();
      analytics[aData.platform] = {
        metrics: aData.metrics,
        fetchedAt: aData.fetchedAt?.toDate?.() || aData.fetchedAt
      };
    });

    posts.push({
      id: doc.id,
      caption: (data.caption || '').substring(0, 100),
      platforms: data.platforms || [],
      publishedAt: data.publishedAt?.toDate?.() || data.publishedAt || null,
      media: (data.media || []).length,
      analytics
    });
  }

  return jsonResponse(200, { ok: true, posts, period: days });
}


// ── Sync: fetch latest metrics for all recent published posts ───

async function syncMetrics(db) {
  const since = new Date();
  since.setDate(since.getDate() - 30);

  // Load connected accounts
  const accountsSnap = await db.collection(ACCOUNTS_COLLECTION).get();
  const accounts = {};
  accountsSnap.forEach(doc => {
    accounts[doc.id] = doc.data();
  });

  if (Object.keys(accounts).length === 0) {
    return jsonResponse(200, { ok: true, message: 'No connected accounts', synced: 0 });
  }

  // Get published posts from the last 30 days
  let postsSnap;
  try {
    postsSnap = await db.collection(POSTS_COLLECTION)
      .where('status', '==', 'published')
      .where('publishedAt', '>=', since)
      .limit(100)
      .get();
  } catch (err) {
    console.warn('[social-analytics] Index fallback for sync:', err.message);
    postsSnap = await db.collection(POSTS_COLLECTION)
      .where('status', '==', 'published')
      .limit(100)
      .get();
  }

  if (postsSnap.empty) {
    return jsonResponse(200, { ok: true, message: 'No published posts to sync', synced: 0 });
  }

  let synced = 0;
  const errors = [];

  for (const doc of postsSnap.docs) {
    const post = doc.data();
    const publishResults = post.publishResults || {};

    for (const [platform, result] of Object.entries(publishResults)) {
      if (platform.startsWith('_')) continue;
      if (!result.success || !result.id) continue;

      const account = accounts[platform];
      if (!account || !account.accessToken) continue;

      try {
        let platformMetrics;

        if (platform === 'instagram') {
          platformMetrics = await getInstagramMetrics(
            { accessToken: account.accessToken },
            result.id
          );
        } else if (platform === 'facebook') {
          platformMetrics = await getFacebookMetrics(
            { accessToken: account.accessToken },
            result.id
          );
        }

        if (platformMetrics && platformMetrics.success) {
          await db.collection(ANALYTICS_COLLECTION).doc(`${doc.id}_${platform}`).set({
            postId: doc.id,
            platform,
            platformPostId: result.id,
            metrics: platformMetrics.metrics,
            fetchedAt: serverTimestamp()
          });
          synced++;
        } else {
          errors.push({ postId: doc.id, platform, error: platformMetrics?.error });
        }
      } catch (err) {
        errors.push({ postId: doc.id, platform, error: err.message });
      }
    }
  }

  console.log(`[social-analytics] Sync complete: ${synced} synced, ${errors.length} errors`);
  return jsonResponse(200, { ok: true, synced, errors });
}
