/**
 * Social Analytics API — Yoga Bible
 * Fetches and aggregates analytics from connected social media platforms.
 *
 * GET  /.netlify/functions/social-analytics?action=overview[&days=30]
 * GET  /.netlify/functions/social-analytics?action=post-metrics&postId=X
 * GET  /.netlify/functions/social-analytics?action=recent[&days=30]
 * GET  /.netlify/functions/social-analytics?action=top-posts[&days=30&limit=5]
 * GET  /.netlify/functions/social-analytics?action=best-times[&days=90]
 * GET  /.netlify/functions/social-analytics?action=engagement-trend[&days=30]
 * GET  /.netlify/functions/social-analytics?action=platform-breakdown[&days=30]
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
        case 'top-posts': return getTopPosts(db, params);
        case 'best-times': return getBestTimes(db, params);
        case 'engagement-trend': return getEngagementTrend(db, params);
        case 'platform-breakdown': return getPlatformBreakdown(db, params);
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
    console.warn('[social-analytics] Index fallback for overview:', err.message);
    const allPublished = await db.collection(POSTS_COLLECTION)
      .where('status', '==', 'published')
      .get();
    totalPosts = allPublished.size;
  }

  // Aggregate engagement from stored analytics
  let totalReach = 0;
  let totalImpressions = 0;
  let totalLikes = 0;
  let totalComments = 0;
  let totalShares = 0;
  let totalSaved = 0;
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
    totalImpressions += (m.impressions || m.post_impressions || 0);
    totalLikes += (m.likes || 0);
    totalComments += (m.comments || 0);
    totalShares += (m.shares || 0);
    totalSaved += (m.saved || 0);

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
      totalImpressions,
      totalLikes,
      totalComments,
      totalShares,
      totalSaved,
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


// ── Top Posts: highest engagement posts ──────────────────────────

async function getTopPosts(db, params) {
  const days = parseInt(params.days) || 30;
  const limit = Math.min(parseInt(params.limit) || 5, 20);
  const since = new Date();
  since.setDate(since.getDate() - days);

  // Get all analytics in period
  const analyticsSnap = await db.collection(ANALYTICS_COLLECTION)
    .where('fetchedAt', '>=', since)
    .limit(200)
    .get();

  if (analyticsSnap.empty) {
    return jsonResponse(200, { ok: true, topPosts: [], period: days });
  }

  // Group by postId and sum engagement
  const postMap = {};
  analyticsSnap.forEach(doc => {
    const d = doc.data();
    const pid = d.postId;
    if (!postMap[pid]) {
      postMap[pid] = { postId: pid, totalEngagement: 0, totalReach: 0, platforms: {}, bestPlatform: null };
    }
    const m = d.metrics || {};
    const eng = (m.likes || 0) + (m.comments || 0) + (m.shares || 0) + (m.saved || 0);
    postMap[pid].totalEngagement += eng;
    postMap[pid].totalReach += (m.reach || m.post_reach || 0);
    postMap[pid].platforms[d.platform] = {
      likes: m.likes || 0,
      comments: m.comments || 0,
      shares: m.shares || 0,
      saved: m.saved || 0,
      reach: m.reach || m.post_reach || 0
    };
  });

  // Sort by engagement and take top N
  const sorted = Object.values(postMap)
    .sort((a, b) => b.totalEngagement - a.totalEngagement)
    .slice(0, limit);

  // Fetch post details
  const topPosts = [];
  for (const item of sorted) {
    try {
      const postDoc = await db.collection(POSTS_COLLECTION).doc(item.postId).get();
      if (postDoc.exists) {
        const data = postDoc.data();
        topPosts.push({
          id: item.postId,
          caption: (data.caption || '').substring(0, 120),
          media: (data.media || [])[0] || null,
          platforms: data.platforms || [],
          publishedAt: data.publishedAt?.toDate?.() || data.publishedAt,
          totalEngagement: item.totalEngagement,
          totalReach: item.totalReach,
          platformMetrics: item.platforms
        });
      }
    } catch (err) {
      console.warn('[social-analytics] Top post fetch error:', err.message);
    }
  }

  return jsonResponse(200, { ok: true, topPosts, period: days });
}


// ── Best Times: analyze posting time vs engagement ──────────────

async function getBestTimes(db, params) {
  const days = parseInt(params.days) || 90;
  const since = new Date();
  since.setDate(since.getDate() - days);

  // Get published posts with their timestamps
  let postsSnap;
  try {
    postsSnap = await db.collection(POSTS_COLLECTION)
      .where('status', '==', 'published')
      .where('publishedAt', '>=', since)
      .limit(200)
      .get();
  } catch (err) {
    postsSnap = await db.collection(POSTS_COLLECTION)
      .where('status', '==', 'published')
      .limit(200)
      .get();
  }

  if (postsSnap.empty) {
    return jsonResponse(200, { ok: true, bestTimes: { byHour: [], byDay: [] }, period: days });
  }

  // Build post map for engagement lookup
  const postTimestamps = {};
  postsSnap.forEach(doc => {
    const data = doc.data();
    const ts = data.publishedAt?.toDate?.() || (data.publishedAt ? new Date(data.publishedAt) : null);
    if (ts) postTimestamps[doc.id] = ts;
  });

  // Get analytics for these posts
  const analyticsSnap = await db.collection(ANALYTICS_COLLECTION)
    .where('fetchedAt', '>=', since)
    .limit(500)
    .get();

  // Aggregate by hour and day of week
  const hourBuckets = Array.from({ length: 24 }, () => ({ count: 0, engagement: 0, reach: 0 }));
  const dayBuckets = Array.from({ length: 7 }, () => ({ count: 0, engagement: 0, reach: 0 }));
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  analyticsSnap.forEach(doc => {
    const d = doc.data();
    const ts = postTimestamps[d.postId];
    if (!ts) return;

    const m = d.metrics || {};
    const eng = (m.likes || 0) + (m.comments || 0) + (m.shares || 0) + (m.saved || 0);
    const reach = m.reach || m.post_reach || 0;

    const hour = ts.getHours();
    hourBuckets[hour].count++;
    hourBuckets[hour].engagement += eng;
    hourBuckets[hour].reach += reach;

    const day = ts.getDay();
    dayBuckets[day].count++;
    dayBuckets[day].engagement += eng;
    dayBuckets[day].reach += reach;
  });

  // Calculate averages
  const byHour = hourBuckets.map((b, i) => ({
    hour: i,
    label: `${String(i).padStart(2, '0')}:00`,
    posts: b.count,
    avgEngagement: b.count > 0 ? Math.round(b.engagement / b.count) : 0,
    avgReach: b.count > 0 ? Math.round(b.reach / b.count) : 0
  }));

  const byDay = dayBuckets.map((b, i) => ({
    day: i,
    label: dayNames[i],
    posts: b.count,
    avgEngagement: b.count > 0 ? Math.round(b.engagement / b.count) : 0,
    avgReach: b.count > 0 ? Math.round(b.reach / b.count) : 0
  }));

  // Find best hour and day
  const bestHour = byHour.reduce((best, h) => h.avgEngagement > best.avgEngagement ? h : best, byHour[0]);
  const bestDay = byDay.reduce((best, d) => d.avgEngagement > best.avgEngagement ? d : best, byDay[0]);

  return jsonResponse(200, {
    ok: true,
    bestTimes: { byHour, byDay, bestHour, bestDay },
    period: days
  });
}


// ── Engagement Trend: daily engagement over time ────────────────

async function getEngagementTrend(db, params) {
  const days = parseInt(params.days) || 30;
  const since = new Date();
  since.setDate(since.getDate() - days);

  // Get published posts with timestamps
  let postsSnap;
  try {
    postsSnap = await db.collection(POSTS_COLLECTION)
      .where('status', '==', 'published')
      .where('publishedAt', '>=', since)
      .limit(200)
      .get();
  } catch (err) {
    postsSnap = await db.collection(POSTS_COLLECTION)
      .where('status', '==', 'published')
      .limit(200)
      .get();
  }

  const postDates = {};
  postsSnap.forEach(doc => {
    const data = doc.data();
    const ts = data.publishedAt?.toDate?.() || (data.publishedAt ? new Date(data.publishedAt) : null);
    if (ts) {
      const dateStr = ts.toISOString().split('T')[0];
      postDates[doc.id] = dateStr;
    }
  });

  // Get analytics
  const analyticsSnap = await db.collection(ANALYTICS_COLLECTION)
    .where('fetchedAt', '>=', since)
    .limit(500)
    .get();

  // Aggregate by date
  const dateBuckets = {};
  analyticsSnap.forEach(doc => {
    const d = doc.data();
    const dateStr = postDates[d.postId];
    if (!dateStr) return;

    if (!dateBuckets[dateStr]) {
      dateBuckets[dateStr] = { date: dateStr, posts: 0, likes: 0, comments: 0, shares: 0, reach: 0, engagement: 0 };
    }

    const m = d.metrics || {};
    dateBuckets[dateStr].likes += (m.likes || 0);
    dateBuckets[dateStr].comments += (m.comments || 0);
    dateBuckets[dateStr].shares += (m.shares || 0);
    dateBuckets[dateStr].reach += (m.reach || m.post_reach || 0);
    dateBuckets[dateStr].engagement += (m.likes || 0) + (m.comments || 0) + (m.shares || 0) + (m.saved || 0);
  });

  // Count posts per date
  Object.values(postDates).forEach(dateStr => {
    if (dateBuckets[dateStr]) dateBuckets[dateStr].posts++;
  });

  // Fill in missing dates with zeros
  const trend = [];
  const current = new Date(since);
  const today = new Date();
  while (current <= today) {
    const dateStr = current.toISOString().split('T')[0];
    trend.push(dateBuckets[dateStr] || { date: dateStr, posts: 0, likes: 0, comments: 0, shares: 0, reach: 0, engagement: 0 });
    current.setDate(current.getDate() + 1);
  }

  return jsonResponse(200, { ok: true, trend, period: days });
}


// ── Platform Breakdown: per-platform totals ─────────────────────

async function getPlatformBreakdown(db, params) {
  const days = parseInt(params.days) || 30;
  const since = new Date();
  since.setDate(since.getDate() - days);

  const analyticsSnap = await db.collection(ANALYTICS_COLLECTION)
    .where('fetchedAt', '>=', since)
    .limit(300)
    .get();

  const platforms = {};
  analyticsSnap.forEach(doc => {
    const d = doc.data();
    const p = d.platform;
    if (!platforms[p]) {
      platforms[p] = { platform: p, posts: 0, likes: 0, comments: 0, shares: 0, saved: 0, reach: 0, impressions: 0 };
    }
    const m = d.metrics || {};
    platforms[p].posts++;
    platforms[p].likes += (m.likes || 0);
    platforms[p].comments += (m.comments || 0);
    platforms[p].shares += (m.shares || 0);
    platforms[p].saved += (m.saved || 0);
    platforms[p].reach += (m.reach || m.post_reach || 0);
    platforms[p].impressions += (m.impressions || m.post_impressions || 0);
  });

  // Calculate engagement rate per platform
  Object.values(platforms).forEach(p => {
    const eng = p.likes + p.comments + p.shares + p.saved;
    p.totalEngagement = eng;
    p.engagementRate = p.impressions > 0 ? Math.round((eng / p.impressions) * 10000) / 100 : 0;
  });

  return jsonResponse(200, {
    ok: true,
    platforms: Object.values(platforms).sort((a, b) => b.totalEngagement - a.totalEngagement),
    period: days
  });
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
