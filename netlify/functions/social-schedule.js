/**
 * Social Schedule Processor — Yoga Bible
 * Scheduled function that runs every 5 minutes to publish due posts.
 *
 * NOTE: This function delegates to social-publish-scheduled which handles
 * the actual publishing logic. This is a lightweight wrapper to avoid
 * cross-function require() issues on Netlify.
 *
 * Configured in netlify.toml:
 *   [functions."social-schedule"]
 *     schedule = "*/5 * * * *"
 */

const { getDb, serverTimestamp } = require('./shared/firestore');
const {
  publishToInstagram,
  publishToFacebook,
  publishToTikTok,
  publishToLinkedIn,
  publishToYouTube,
  publishToPinterest
} = require('./shared/social-api');

const POSTS_COLLECTION = 'social_posts';
const ACCOUNTS_COLLECTION = 'social_accounts';

exports.handler = async (event) => {
  const db = getDb();
  const now = new Date();

  try {
    // Query posts that are scheduled and due for publishing
    let snap;
    try {
      snap = await db.collection(POSTS_COLLECTION)
        .where('status', '==', 'scheduled')
        .where('scheduledAt', '<=', now)
        .limit(20)
        .get();
    } catch (indexErr) {
      console.warn('[social-schedule] Compound query needs index, using fallback:', indexErr.message);
      snap = await db.collection(POSTS_COLLECTION)
        .where('status', '==', 'scheduled')
        .limit(30)
        .get();
    }

    if (snap.empty) {
      console.log('[social-schedule] No due posts');
      return { statusCode: 200, body: JSON.stringify({ ok: true, processed: 0 }) };
    }

    // Load connected accounts
    const accountsSnap = await db.collection(ACCOUNTS_COLLECTION).get();
    const accounts = {};
    accountsSnap.forEach(doc => { accounts[doc.id] = doc.data(); });

    console.log(`[social-schedule] Found ${snap.size} due post(s)`);

    const results = [];

    for (const doc of snap.docs) {
      const post = doc.data();
      const postId = doc.id;

      // Check scheduledAt is actually past (needed for fallback query)
      const scheduledAt = post.scheduledAt?.toDate ? post.scheduledAt.toDate() : new Date(post.scheduledAt || 0);
      if (scheduledAt > now) continue;

      const platforms = post.platforms || [];
      const publishResults = {};
      let anySuccess = false;

      const postPayload = {
        caption: post.caption || '',
        hashtags: post.hashtags || [],
        media: post.mediaUrls || [],
        mediaType: post.mediaType || 'auto',
        firstComment: post.firstComment || '',
        location: post.location || null
      };

      for (const platform of platforms) {
        const account = accounts[platform];
        if (!account || !account.accessToken) {
          publishResults[platform] = { success: false, error: 'Account not connected' };
          continue;
        }

        try {
          let result;
          switch (platform) {
            case 'instagram':
              result = await publishToInstagram(account, postPayload);
              break;
            case 'facebook':
              result = await publishToFacebook(account, postPayload);
              break;
            case 'tiktok':
              result = await publishToTikTok(account, postPayload);
              break;
            case 'linkedin':
              result = await publishToLinkedIn(account, postPayload);
              break;
            case 'youtube':
              result = await publishToYouTube(account, postPayload);
              if (result.refreshedToken) {
                await db.collection(ACCOUNTS_COLLECTION).doc('youtube').update({ accessToken: result.refreshedToken });
              }
              break;
            case 'pinterest':
              result = await publishToPinterest(account, postPayload);
              break;
            default:
              result = { success: false, error: `Unsupported platform: ${platform}` };
          }
          publishResults[platform] = result;
          if (result.success) anySuccess = true;
          console.log(`[social-schedule] ${platform} for ${postId}: ${result.success ? 'OK' : result.error}`);
        } catch (err) {
          publishResults[platform] = { success: false, error: err.message };
          console.error(`[social-schedule] ${platform} exception for ${postId}:`, err.message);
        }
      }

      // Update post status
      const updateData = { publishResults, updatedAt: serverTimestamp() };
      if (anySuccess) {
        updateData.status = 'published';
        updateData.publishedAt = serverTimestamp();
      } else {
        updateData.status = 'failed';
        updateData.failedAt = serverTimestamp();
        updateData.failReason = Object.values(publishResults).map(r => r.error).filter(Boolean).join('; ');
      }

      await db.collection(POSTS_COLLECTION).doc(postId).update(updateData);
      results.push({ postId, ok: anySuccess, status: updateData.status });
    }

    const summary = {
      ok: true,
      processed: results.length,
      succeeded: results.filter(r => r.ok).length,
      failed: results.filter(r => !r.ok).length
    };
    console.log('[social-schedule] Summary:', JSON.stringify(summary));
    return { statusCode: 200, body: JSON.stringify(summary) };
  } catch (err) {
    console.error('[social-schedule] Error:', err);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
