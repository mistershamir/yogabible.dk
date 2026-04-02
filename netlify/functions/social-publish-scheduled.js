/**
 * Social Publish Scheduled — Yoga Bible
 * Scheduled function that publishes social posts whose scheduledAt time has passed.
 *
 * Runs every 5 minutes. Picks up posts with status 'scheduled' or 'approved'
 * whose scheduledAt is in the past and attempts to publish them to all target platforms.
 *
 * Configured in netlify.toml:
 *   [functions."social-publish-scheduled"]
 *     schedule = "*/5 * * * *"
 */

const { getDb, serverTimestamp } = require('./shared/firestore');
const { jsonResponse } = require('./shared/utils');
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

exports.handler = async () => {
  const db = getDb();

  try {
    const now = new Date();

    // Find posts that are due for publishing
    let scheduledSnap;
    try {
      scheduledSnap = await db.collection(POSTS_COLLECTION)
        .where('status', 'in', ['scheduled', 'approved'])
        .where('scheduledAt', '<=', now)
        .limit(10)
        .get();
    } catch (indexErr) {
      // Composite index may not exist — fall back to single filter + client-side check
      console.warn('[social-publish] Compound query needs index, using fallback:', indexErr.message);
      scheduledSnap = await db.collection(POSTS_COLLECTION)
        .where('status', 'in', ['scheduled', 'approved'])
        .limit(20)
        .get();
    }

    if (scheduledSnap.empty) {
      return jsonResponse(200, { ok: true, published: 0 });
    }

    // Load connected accounts
    const accountsSnap = await db.collection(ACCOUNTS_COLLECTION).get();
    const accounts = {};
    accountsSnap.forEach(doc => { accounts[doc.id] = doc.data(); });

    let published = 0;
    let failed = 0;

    for (const doc of scheduledSnap.docs) {
      const post = doc.data();

      // Client-side date check (needed when index fallback is used)
      const scheduledAt = post.scheduledAt?.toDate ? post.scheduledAt.toDate() : new Date(post.scheduledAt || 0);
      if (scheduledAt > now) continue;

      const platforms = post.platforms || [];
      const publishResults = {};
      let anySuccess = false;

      // Build post object for platform APIs
      const postPayload = {
        caption: post.caption || '',
        hashtags: post.hashtags || [],
        media: post.media || post.mediaUrls || [],
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
                await db.collection(ACCOUNTS_COLLECTION).doc('youtube').update({
                  accessToken: result.refreshedToken
                });
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

          console.log(`[social-publish] ${platform} for ${doc.id}: ${result.success ? 'OK' : result.error}`);
        } catch (err) {
          publishResults[platform] = { success: false, error: err.message };
          console.error(`[social-publish] ${platform} exception for ${doc.id}:`, err.message);
        }
      }

      // Update post status
      const updateData = {
        publishResults,
        updatedAt: serverTimestamp()
      };

      if (anySuccess) {
        updateData.status = 'published';
        updateData.publishedAt = serverTimestamp();
        published++;
      } else {
        updateData.status = 'failed';
        updateData.failedAt = serverTimestamp();
        updateData.failReason = Object.values(publishResults).map(r => r.error).filter(Boolean).join('; ');
        failed++;
      }

      await db.collection(POSTS_COLLECTION).doc(doc.id).update(updateData);
    }

    console.log(`[social-publish] Done: ${published} published, ${failed} failed`);
    return jsonResponse(200, { ok: true, published, failed });
  } catch (err) {
    console.error('[social-publish] Error:', err);
    return jsonResponse(500, { ok: false, error: err.message });
  }
};
