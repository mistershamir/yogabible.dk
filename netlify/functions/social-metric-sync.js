/**
 * Social Metric Sync — Yoga Bible
 * Scheduled function that auto-syncs metrics for published posts every 6 hours.
 *
 * Configured in netlify.toml:
 *   [functions."social-metric-sync"]
 *     schedule = "0 */6 * * *"
 */

const { getDb, serverTimestamp } = require('./shared/firestore');
const {
  getInstagramMetrics,
  getFacebookMetrics
} = require('./shared/social-api');

const POSTS_COLLECTION = 'social_posts';
const ACCOUNTS_COLLECTION = 'social_accounts';
const ANALYTICS_COLLECTION = 'social_analytics';

exports.handler = async (event) => {
  const db = getDb();
  const since = new Date();
  since.setDate(since.getDate() - 30);

  try {
    // Load connected accounts
    const accountsSnap = await db.collection(ACCOUNTS_COLLECTION).get();
    const accounts = {};
    accountsSnap.forEach(doc => { accounts[doc.id] = doc.data(); });

    if (Object.keys(accounts).length === 0) {
      console.log('[social-metric-sync] No connected accounts');
      return { statusCode: 200, body: JSON.stringify({ ok: true, synced: 0 }) };
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
      console.warn('[social-metric-sync] Index fallback:', err.message);
      postsSnap = await db.collection(POSTS_COLLECTION)
        .where('status', '==', 'published')
        .limit(100)
        .get();
    }

    if (postsSnap.empty) {
      console.log('[social-metric-sync] No published posts to sync');
      await updateLastSync(db, 0, 0);
      return { statusCode: 200, body: JSON.stringify({ ok: true, synced: 0 }) };
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
          // TikTok and LinkedIn don't have free metrics APIs yet

          if (platformMetrics && platformMetrics.success) {
            await db.collection(ANALYTICS_COLLECTION).doc(`${doc.id}_${platform}`).set({
              postId: doc.id,
              platform,
              platformPostId: result.id,
              metrics: platformMetrics.metrics,
              fetchedAt: serverTimestamp()
            });
            synced++;
          } else if (platformMetrics) {
            errors.push({ postId: doc.id, platform, error: platformMetrics.error });
          }
        } catch (err) {
          errors.push({ postId: doc.id, platform, error: err.message });
        }
      }
    }

    await updateLastSync(db, synced, errors.length);

    const summary = { ok: true, synced, errors: errors.length, errorDetails: errors.slice(0, 10) };
    console.log('[social-metric-sync] Done:', JSON.stringify({ synced, errors: errors.length }));
    return { statusCode: 200, body: JSON.stringify(summary) };
  } catch (err) {
    console.error('[social-metric-sync] Error:', err);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};

async function updateLastSync(db, synced, errors) {
  try {
    await db.collection('system').doc('social_metric_sync').set({
      lastRun: serverTimestamp(),
      synced,
      errors,
      updatedAt: serverTimestamp()
    });
  } catch (err) {
    console.warn('[social-metric-sync] Could not update last sync:', err.message);
  }
}
