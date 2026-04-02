/**
 * Social Media Upload — Bunny Stream video management
 *
 * POST  { action: 'create-video', title }     → Create video entry, return TUS upload credentials
 * GET   ?action=list                           → List all uploaded videos
 * GET   ?action=get&id=VIDEO_ID                → Get single video details
 * POST  { action: 'delete', videoId }          → Delete video from Bunny Stream + Firestore
 * POST  { action: 'trim', videoId, start, end }→ Create trimmed version (future)
 */

const { getDb, serverTimestamp } = require('./shared/firestore');
const { requireAuth } = require('./shared/auth');
const { jsonResponse, optionsResponse } = require('./shared/utils');
const crypto = require('crypto');

const LIBRARY_ID = process.env.BUNNY_STREAM_LIBRARY_ID || '627306';
const API_KEY = process.env.BUNNY_STREAM_API_KEY;
const CDN_HOST = process.env.BUNNY_STREAM_CDN_HOST || 'vz-4f2e2677-3b6.b-cdn.net';
const COLLECTION = 'social_media';

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  const user = await requireAuth(event, ['admin']);
  if (user.error) return user.error;

  const params = event.queryStringParameters || {};

  try {
    if (event.httpMethod === 'GET') {
      const action = params.action || 'list';
      if (action === 'get') return getVideo(params.id);
      return listVideos();
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const action = body.action || params.action;

      switch (action) {
        case 'create-video': return createVideo(body, user);
        case 'delete': return deleteVideo(body.videoId);
        case 'update-meta': return updateVideoMeta(body);
        default:
          return jsonResponse(400, { ok: false, error: `Unknown action: ${action}` });
      }
    }

    return jsonResponse(405, { ok: false, error: 'Method not allowed' });
  } catch (err) {
    console.error('[social-media-upload] Error:', err);
    return jsonResponse(500, { ok: false, error: err.message });
  }
};

/**
 * Create a video entry in Bunny Stream and return TUS upload credentials.
 * The client uploads directly to Bunny via TUS protocol (bypasses Netlify timeout).
 */
async function createVideo(body, user) {
  if (!API_KEY) {
    return jsonResponse(500, { ok: false, error: 'BUNNY_STREAM_API_KEY not configured' });
  }

  const title = body.title || 'Untitled';

  // 1. Create video entry in Bunny Stream
  const res = await fetch(`https://video.bunnycdn.com/library/${LIBRARY_ID}/videos`, {
    method: 'POST',
    headers: {
      AccessKey: API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ title })
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error('[social-media-upload] Bunny create error:', errText);
    return jsonResponse(res.status, { ok: false, error: 'Failed to create video in Bunny Stream' });
  }

  const video = await res.json();
  const videoId = video.guid;

  // 2. Generate TUS upload authentication
  // Bunny TUS auth uses SHA256 of: library_id + api_key + expiration_time + video_id
  const expirationTime = Math.floor(Date.now() / 1000) + 86400; // 24 hours
  const signaturePayload = LIBRARY_ID + API_KEY + expirationTime + videoId;
  const authSignature = crypto.createHash('sha256').update(signaturePayload).digest('hex');

  // 3. Save to Firestore
  const db = getDb();
  await db.collection(COLLECTION).doc(videoId).set({
    videoId,
    libraryId: LIBRARY_ID,
    title,
    status: 'uploading',
    uploadedBy: user.email,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  console.log(`[social-media-upload] Created video ${videoId} (${title}) for ${user.email}`);

  return jsonResponse(200, {
    ok: true,
    videoId,
    tusUploadUrl: `https://video.bunnycdn.com/tusupload`,
    authSignature,
    authExpiration: expirationTime,
    libraryId: LIBRARY_ID
  });
}

/**
 * List all uploaded videos from Firestore + Bunny Stream API fallback
 */
async function listVideos() {
  if (!API_KEY) {
    return jsonResponse(500, { ok: false, error: 'BUNNY_STREAM_API_KEY not configured' });
  }

  // Always fetch from Bunny Stream API for fresh status
  let videos = [];
  try {
    const res = await fetch(`https://video.bunnycdn.com/library/${LIBRARY_ID}/videos?page=1&itemsPerPage=100&orderBy=date`, {
      headers: { AccessKey: API_KEY }
    });
    if (res.ok) {
      const data = await res.json();
      const items = data.items || [];
      videos = items.map(v => {
        const statusMap = { 0: 'uploading', 1: 'uploading', 2: 'uploading', 3: 'encoding', 4: 'ready', 5: 'ready', 6: 'failed' };
        return {
          videoId: v.guid,
          title: v.title || 'Untitled',
          status: statusMap[v.status] || 'unknown',
          duration: v.length,
          width: v.width,
          height: v.height,
          fileSize: v.storageSize,
          thumbnailUrl: `https://${CDN_HOST}/${v.guid}/thumbnail.jpg`,
          mp4Url: `https://${CDN_HOST}/${v.guid}/play_720p.mp4`,
          hlsUrl: `https://${CDN_HOST}/${v.guid}/playlist.m3u8`,
          createdAt: v.dateUploaded
        };
      });
    }
  } catch (e) {
    console.warn('[social-media-upload] Bunny Stream API error:', e.message);
  }

  return jsonResponse(200, { ok: true, videos });
}

/**
 * Get single video details
 */
async function getVideo(videoId) {
  if (!videoId) return jsonResponse(400, { ok: false, error: 'Missing video ID' });

  const db = getDb();
  const doc = await db.collection(COLLECTION).doc(videoId).get();

  if (!doc.exists) {
    // Try fetching from Bunny directly
    if (API_KEY) {
      try {
        const res = await fetch(`https://video.bunnycdn.com/library/${LIBRARY_ID}/videos/${videoId}`, {
          headers: { AccessKey: API_KEY }
        });
        if (res.ok) {
          const data = await res.json();
          return jsonResponse(200, {
            ok: true,
            video: {
              videoId,
              title: data.title,
              status: data.status === 4 ? 'ready' : 'encoding',
              duration: data.length,
              width: data.width,
              height: data.height,
              fileSize: data.storageSize,
              thumbnailUrl: `https://${CDN_HOST}/${videoId}/thumbnail.jpg`,
              mp4Url: `https://${CDN_HOST}/${videoId}/play_720p.mp4`,
              hlsUrl: `https://${CDN_HOST}/${videoId}/playlist.m3u8`
            }
          });
        }
      } catch (e) { /* fall through */ }
    }
    return jsonResponse(404, { ok: false, error: 'Video not found' });
  }

  return jsonResponse(200, { ok: true, video: { id: doc.id, ...doc.data() } });
}

/**
 * Delete video from Bunny Stream and Firestore
 */
async function deleteVideo(videoId) {
  if (!videoId) return jsonResponse(400, { ok: false, error: 'Missing video ID' });

  // Delete from Bunny Stream
  if (API_KEY) {
    try {
      await fetch(`https://video.bunnycdn.com/library/${LIBRARY_ID}/videos/${videoId}`, {
        method: 'DELETE',
        headers: { AccessKey: API_KEY }
      });
    } catch (err) {
      console.warn('[social-media-upload] Bunny delete error:', err.message);
    }
  }

  // Delete from Firestore
  const db = getDb();
  await db.collection(COLLECTION).doc(videoId).delete();

  console.log(`[social-media-upload] Deleted video ${videoId}`);
  return jsonResponse(200, { ok: true, deleted: videoId });
}

/**
 * Update video metadata (title, tags, etc.)
 */
async function updateVideoMeta(body) {
  const { videoId, title, tags } = body;
  if (!videoId) return jsonResponse(400, { ok: false, error: 'Missing video ID' });

  const db = getDb();
  const updateData = { updatedAt: serverTimestamp() };
  if (title) updateData.title = title;
  if (tags) updateData.tags = tags;

  await db.collection(COLLECTION).doc(videoId).update(updateData);

  // Also update in Bunny Stream
  if (API_KEY && title) {
    try {
      await fetch(`https://video.bunnycdn.com/library/${LIBRARY_ID}/videos/${videoId}`, {
        method: 'POST',
        headers: { AccessKey: API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title })
      });
    } catch (e) { /* non-critical */ }
  }

  return jsonResponse(200, { ok: true, videoId });
}
