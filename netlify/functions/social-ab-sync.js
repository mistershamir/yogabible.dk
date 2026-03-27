/**
 * Social A/B Test Metric Sync — Yoga Bible
 * Scheduled function that pulls real metrics from platforms
 * for active A/B tests with linked post IDs.
 *
 * Runs every 6 hours via netlify.toml:
 *   [functions."social-ab-sync"]
 *     schedule = "0 */6 * * *"
 */

const { getDb, serverTimestamp } = require('./shared/firestore');
const { jsonResponse } = require('./shared/utils');
const {
  getInstagramMetrics,
  getFacebookMetrics
} = require('./shared/social-api');

const AB_COLLECTION = 'social_ab_tests';
const POSTS_COLLECTION = 'social_posts';
const ACCOUNTS_COLLECTION = 'social_accounts';

exports.handler = async () => {
  const db = getDb();

  try {
    // Find active A/B tests
    const testsSnap = await db.collection(AB_COLLECTION)
      .where('status', '==', 'active')
      .get();

    if (testsSnap.empty) {
      return jsonResponse(200, { ok: true, message: 'No active A/B tests' });
    }

    // Load connected accounts
    const accountsSnap = await db.collection(ACCOUNTS_COLLECTION).get();
    const accounts = {};
    accountsSnap.forEach(doc => { accounts[doc.id] = doc.data(); });

    let synced = 0;
    let errors = 0;

    for (const testDoc of testsSnap.docs) {
      const test = testDoc.data();
      const variants = test.variants || [];
      const platform = test.platform;
      let updated = false;

      for (let i = 0; i < variants.length; i++) {
        const variant = variants[i];
        const postId = variant.postId;

        if (!postId) continue;

        try {
          // Load the social post to get the platform-specific publish ID
          const postDoc = await db.collection(POSTS_COLLECTION).doc(postId).get();
          if (!postDoc.exists) continue;

          const post = postDoc.data();
          const publishResults = post.publishResults || {};
          const platformResult = publishResults[platform];

          if (!platformResult || !platformResult.success || !platformResult.id) continue;

          const publishedId = platformResult.id;
          const account = accounts[platform];

          if (!account || !account.accessToken) continue;

          let metrics = null;

          if (platform === 'instagram') {
            const result = await getInstagramMetrics(
              { accessToken: account.accessToken },
              publishedId
            );
            if (result.success) {
              metrics = {
                likes: result.metrics.likes || 0,
                comments: result.metrics.comments || 0,
                shares: result.metrics.shares || result.metrics.saved || 0,
                reach: result.metrics.reach || 0,
                impressions: result.metrics.impressions || 0
              };
            }
          } else if (platform === 'facebook') {
            const result = await getFacebookMetrics(
              { accessToken: account.accessToken },
              publishedId
            );
            if (result.success) {
              metrics = {
                likes: result.metrics.likes || 0,
                comments: result.metrics.comments || 0,
                shares: result.metrics.shares || 0,
                reach: result.metrics.reach || 0,
                impressions: result.metrics.impressions || 0
              };
            }
          }

          if (metrics) {
            variants[i].metrics = metrics;
            updated = true;
          }
        } catch (err) {
          console.error(`[social-ab-sync] Error syncing variant ${i} of test ${testDoc.id}:`, err.message);
          errors++;
        }
      }

      if (updated) {
        // Calculate engagement totals for easy comparison
        for (const variant of variants) {
          const m = variant.metrics || {};
          variant.totalEngagement = (m.likes || 0) + (m.comments || 0) + (m.shares || 0);
        }

        await testDoc.ref.update({
          variants,
          lastSyncedAt: serverTimestamp()
        });
        synced++;
      }
    }

    console.log(`[social-ab-sync] Synced ${synced} tests, ${errors} errors`);
    return jsonResponse(200, { ok: true, synced, errors });
  } catch (err) {
    console.error('[social-ab-sync] Error:', err);
    return jsonResponse(500, { ok: false, error: err.message });
  }
};
