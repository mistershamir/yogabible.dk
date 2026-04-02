/**
 * Social Publish API — Yoga Bible
 * Publishes a social media post to connected platforms.
 *
 * POST /.netlify/functions/social-publish  { postId, platforms? }
 */

const { getDb, serverTimestamp } = require('./shared/firestore');
const { requireAuth } = require('./shared/auth');
const { jsonResponse, optionsResponse } = require('./shared/utils');
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

/**
 * Publish a post to its target platforms.
 * Loads account credentials from Firestore, calls platform APIs,
 * and updates the post document with results.
 *
 * @param {Object} db - Firestore instance
 * @param {string} postId - Post document ID
 * @param {string[]|null} platformFilter - Optional subset of platforms to publish to
 * @returns {{ ok: boolean, results: Object, status: string }}
 */
async function publishPost(db, postId, platformFilter) {
  // Load post
  const postRef = db.collection(POSTS_COLLECTION).doc(postId);
  const postDoc = await postRef.get();

  if (!postDoc.exists) {
    return { ok: false, error: 'Post not found', statusCode: 404 };
  }

  const post = postDoc.data();

  // Block re-publishing unless there are platform failures to retry
  if (post.status === 'published' && !platformFilter) {
    const prevResults = post.publishResults || {};
    const hasFailure = Object.values(prevResults).some(r => !r.success);
    if (!hasFailure && Object.keys(prevResults).length > 0) {
      return { ok: false, error: 'Post is already published to all platforms', statusCode: 400 };
    }
    console.log('[social-publish] Re-publishing for', postId);
  }

  // Determine which platforms to publish to
  const targetPlatforms = platformFilter
    ? platformFilter.filter(p => (post.platforms || []).includes(p))
    : (post.platforms || []);

  if (targetPlatforms.length === 0) {
    return { ok: false, error: 'No valid platforms to publish to', statusCode: 400 };
  }

  // Load connected accounts
  const accountsSnap = await db.collection(ACCOUNTS_COLLECTION).get();
  const accounts = {};
  accountsSnap.forEach(doc => {
    accounts[doc.id] = doc.data();
  });

  // Publish to each platform
  const results = {};
  let anySuccess = false;
  let allFailed = true;

  for (const platform of targetPlatforms) {
    const account = accounts[platform];

    if (!account || !account.accessToken) {
      results[platform] = { success: false, error: `No connected ${platform} account` };
      continue;
    }

    // Use platform-specific caption if available
    const platformPost = { ...post };
    if (post.platformCaptions && post.platformCaptions[platform]) {
      platformPost.caption = post.platformCaptions[platform];
    }

    try {
      let result;

      if (platform === 'instagram') {
        result = await publishToInstagram(
          { accessToken: account.accessToken, igAccountId: account.igAccountId },
          platformPost
        );
      } else if (platform === 'facebook') {
        result = await publishToFacebook(
          { accessToken: account.accessToken, pageId: account.pageId },
          platformPost
        );
      } else if (platform === 'tiktok') {
        result = await publishToTikTok(
          { accessToken: account.accessToken },
          platformPost
        );
      } else if (platform === 'linkedin') {
        result = await publishToLinkedIn(
          { accessToken: account.accessToken, organizationId: account.organizationId },
          platformPost
        );
      } else if (platform === 'youtube') {
        result = await publishToYouTube(
          { accessToken: account.accessToken, refreshToken: account.refreshToken },
          platformPost
        );
        // If YouTube refreshed its token, update Firestore
        if (result.refreshedToken) {
          await db.collection(ACCOUNTS_COLLECTION).doc('youtube').update({
            accessToken: result.refreshedToken
          });
        }
      } else if (platform === 'pinterest') {
        result = await publishToPinterest(
          { accessToken: account.accessToken, boardId: account.boardId },
          platformPost
        );
      } else {
        result = { success: false, error: `Unsupported platform: ${platform}` };
      }

      results[platform] = result;

      if (result.success) {
        anySuccess = true;
        allFailed = false;
      }
    } catch (err) {
      console.error(`[social-publish] ${platform} error:`, err);
      results[platform] = { success: false, error: err.message };
    }
  }

  // Merge new results with any existing publishResults
  const existingResults = post.publishResults || {};
  const mergedResults = { ...existingResults, ...results };

  // Determine overall status
  let newStatus;
  if (allFailed) {
    newStatus = 'failed';
  } else {
    newStatus = 'published';
  }

  // Update post document
  const updateData = {
    publishResults: mergedResults,
    status: newStatus,
    updatedAt: serverTimestamp()
  };

  if (anySuccess) {
    updateData.publishedAt = serverTimestamp();
  }

  await postRef.update(updateData);

  console.log('[social-publish] Post', postId, 'status:', newStatus, 'results:', JSON.stringify(results));

  return { ok: true, results, status: newStatus, statusCode: 200 };
}


exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { ok: false, error: 'Method not allowed' });
  }

  const user = await requireAuth(event, ['admin']);
  if (user.error) return user.error;

  const db = getDb();

  try {
    const body = JSON.parse(event.body || '{}');
    const { postId, platforms } = body;

    if (!postId) {
      return jsonResponse(400, { ok: false, error: 'Missing postId' });
    }

    const platformFilter = Array.isArray(platforms) && platforms.length > 0 ? platforms : null;
    const result = await publishPost(db, postId, platformFilter);

    return jsonResponse(result.statusCode, {
      ok: result.ok,
      error: result.error,
      results: result.results,
      status: result.status
    });
  } catch (err) {
    console.error('[social-publish] Error:', err);
    return jsonResponse(500, { ok: false, error: err.message });
  }
};

// Export publishPost for use by the scheduler
exports.publishPost = publishPost;
