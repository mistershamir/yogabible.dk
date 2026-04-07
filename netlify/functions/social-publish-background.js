/**
 * Social Publish API — Yoga Bible
 * Publishes a social media post to connected platforms.
 *
 * POST /.netlify/functions/social-publish  { postId, platforms? }
 */

const https = require('https');
const { getDb, serverTimestamp } = require('./shared/firestore');
const { requireAuth } = require('./shared/auth');
const { jsonResponse, optionsResponse } = require('./shared/utils');
const {
  publishToInstagram,
  publishToFacebook,
  publishToTikTok,
  refreshTikTokToken,
  publishToLinkedIn,
  publishToYouTube,
  publishToPinterest
} = require('./shared/social-api');

const POSTS_COLLECTION = 'social_posts';
const ACCOUNTS_COLLECTION = 'social_accounts';

const BUNNY_STORAGE_ZONE = process.env.BUNNY_STORAGE_ZONE || 'yogabible';
const BUNNY_STORAGE_KEY = process.env.BUNNY_STORAGE_API_KEY || '';
const BUNNY_CDN_HOST = process.env.BUNNY_CDN_HOST || 'yogabible.b-cdn.net';
const BUNNY_STREAM_CDN = process.env.BUNNY_STREAM_CDN_HOST || 'vz-4f2e2677-3b6.b-cdn.net';
const BUNNY_STREAM_API_KEY = process.env.BUNNY_STREAM_API_KEY || '';
const BUNNY_STREAM_LIBRARY_ID = process.env.BUNNY_STREAM_LIBRARY_ID || '627306';

/**
 * Extract Bunny Stream video ID from a CDN URL.
 * e.g. "https://vz-4f2e2677-3b6.b-cdn.net/abc123/play_720p.mp4" → "abc123"
 */
function extractStreamVideoId(url) {
  const match = url.match(/b-cdn\.net\/([a-f0-9-]+)\//);
  return match ? match[1] : null;
}

/**
 * If a media URL is from Bunny Stream (vz-*.b-cdn.net), download it via
 * the Bunny Stream API (which bypasses token auth) and re-upload to
 * Bunny Storage (yogabible.b-cdn.net) so social platforms can access it.
 */
async function ensurePublicMediaUrl(mediaUrl) {
  // Only process Bunny Stream URLs
  if (!mediaUrl.includes(BUNNY_STREAM_CDN)) return mediaUrl;

  console.log('[social-publish] Copying Bunny Stream video to Storage:', mediaUrl);

  try {
    const videoId = extractStreamVideoId(mediaUrl);
    if (!videoId) {
      console.error('[social-publish] Could not extract video ID from:', mediaUrl);
      return mediaUrl;
    }

    // Use Bunny Stream API to get the direct download URL (bypasses CDN token auth)
    const apiRes = await fetch(
      `https://video.bunnycdn.com/library/${BUNNY_STREAM_LIBRARY_ID}/videos/${videoId}`,
      { headers: { AccessKey: BUNNY_STREAM_API_KEY } }
    );
    if (!apiRes.ok) {
      console.error('[social-publish] Stream API error:', apiRes.status);
      return mediaUrl;
    }
    const videoInfo = await apiRes.json();

    // Try the direct download URL from Bunny Stream API
    // Format: https://video.bunnycdn.com/library/{libId}/videos/{videoId}/play
    const downloadUrl = `https://video.bunnycdn.com/library/${BUNNY_STREAM_LIBRARY_ID}/videos/${videoId}/play`;
    console.log('[social-publish] Fetching video via API download URL');

    const videoRes = await fetch(downloadUrl, {
      headers: { AccessKey: BUNNY_STREAM_API_KEY },
      redirect: 'follow'
    });

    if (!videoRes.ok) {
      // Fallback: try original URL with Referer header (some CDN configs allow this)
      console.log('[social-publish] API download failed, trying CDN with Referer');
      const cdnRes = await fetch(mediaUrl, {
        headers: { Referer: 'https://yogabible.dk/' }
      });
      if (!cdnRes.ok) {
        console.error('[social-publish] All download methods failed');
        return mediaUrl;
      }
      var videoBuffer = Buffer.from(await cdnRes.arrayBuffer());
    } else {
      var videoBuffer = Buffer.from(await videoRes.arrayBuffer());
    }

    if (videoBuffer.length < 1000) {
      console.error('[social-publish] Downloaded file too small:', videoBuffer.length, 'bytes — likely an error page');
      return mediaUrl;
    }

    const fileName = 'social-' + Date.now() + '.mp4';
    const storagePath = 'yoga-bible-DK/social-imports/' + fileName;

    // Upload to Bunny Storage
    await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'storage.bunnycdn.com',
        path: '/' + BUNNY_STORAGE_ZONE + '/' + storagePath,
        method: 'PUT',
        headers: {
          'AccessKey': BUNNY_STORAGE_KEY,
          'Content-Type': 'video/mp4',
          'Content-Length': videoBuffer.length
        }
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve();
          else reject(new Error('Storage upload failed: ' + res.statusCode + ' ' + data));
        });
      });
      req.on('error', reject);
      req.setTimeout(120000, () => { req.destroy(); reject(new Error('Storage upload timeout')); });
      req.write(videoBuffer);
      req.end();
    });

    const publicUrl = 'https://' + BUNNY_CDN_HOST + '/' + storagePath;
    console.log('[social-publish] Video copied to public URL:', publicUrl);
    return publicUrl;
  } catch (err) {
    console.error('[social-publish] Failed to copy video:', err.message);
    return mediaUrl;
  }
}

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

  // If media includes Bunny Stream URLs, copy to Bunny Storage for public access
  let publicMedia = post.media || [];
  if (publicMedia.some(url => url.includes(BUNNY_STREAM_CDN))) {
    const resolved = [];
    for (const url of publicMedia) {
      resolved.push(await ensurePublicMediaUrl(url));
    }
    publicMedia = resolved;
    console.log('[social-publish] Resolved media URLs:', publicMedia);
  }

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

    // Use platform-specific caption if available, and resolved media URLs
    const platformPost = { ...post, media: publicMedia };
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
        // Auto-refresh TikTok token if refresh token exists
        let ttToken = account.accessToken;
        if (account.refreshToken) {
          const refreshed = await refreshTikTokToken(account.refreshToken);
          if (refreshed) {
            ttToken = refreshed.accessToken;
            // Update stored tokens in Firestore
            await db.collection('social_accounts').doc('tiktok').update({
              accessToken: refreshed.accessToken,
              refreshToken: refreshed.refreshToken,
              lastTokenRefresh: serverTimestamp()
            });
          }
        }
        result = await publishToTikTok(
          { accessToken: ttToken },
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
