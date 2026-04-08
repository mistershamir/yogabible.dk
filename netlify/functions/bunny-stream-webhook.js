/**
 * Bunny Stream Webhook — handles video encoding status updates
 * POST /.netlify/functions/bunny-stream-webhook
 *
 * Bunny Stream sends callbacks when video status changes:
 * - VideoId: the GUID of the video
 * - Status: 0=created, 1=uploaded, 2=processing, 3=transcoding, 4=finished, 5=error
 *
 * Security: Verifies HMAC-SHA256 signature via BUNNY_WEBHOOK_SECRET env var.
 * Set this secret in both Bunny Stream webhook config and Netlify env vars.
 */

const { getDb, serverTimestamp } = require('./shared/firestore');
const crypto = require('crypto');

const STATUS_MAP = {
  0: 'created',
  1: 'uploaded',
  2: 'processing',
  3: 'encoding',
  4: 'ready',
  5: 'failed'
};

exports.handler = async (event) => {
  // CORS
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // Verify webhook signature using BUNNY_WEBHOOK_SECRET
  const webhookSecret = process.env.BUNNY_WEBHOOK_SECRET;
  if (webhookSecret) {
    const rawBody = event.body || '';
    const expectedSig = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
    const providedSig = (event.headers['webhook-signature'] || event.headers['Webhook-Signature'] || '').toLowerCase();
    if (!providedSig || providedSig !== expectedSig) {
      console.warn('[bunny-stream-webhook] Invalid or missing webhook signature');
      return { statusCode: 401, body: JSON.stringify({ error: 'Invalid webhook signature' }) };
    }
  } else {
    console.warn('[bunny-stream-webhook] BUNNY_WEBHOOK_SECRET not set — skipping signature verification. Set this env var for security.');
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const videoId = body.VideoGuid || body.VideoId;
    const status = body.Status;

    if (!videoId) {
      console.warn('[bunny-stream-webhook] Missing VideoGuid/VideoId in payload:', JSON.stringify(body));
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing video ID' }) };
    }

    console.log(`[bunny-stream-webhook] Video ${videoId} status: ${status} (${STATUS_MAP[status] || 'unknown'})`);

    const db = getDb();
    const docRef = db.collection('social_media').doc(videoId);
    const doc = await docRef.get();

    const cdnHost = process.env.BUNNY_STREAM_CDN_HOST || 'vz-4f2e2677-3b6.b-cdn.net';

    const updateData = {
      status: STATUS_MAP[status] || 'unknown',
      updatedAt: serverTimestamp()
    };

    // When encoding is finished, populate media URLs
    if (status === 4) {
      updateData.thumbnailUrl = `https://${cdnHost}/${videoId}/thumbnail.jpg`;
      updateData.hlsUrl = `https://${cdnHost}/${videoId}/playlist.m3u8`;
      updateData.mp4Url = `https://${cdnHost}/${videoId}/play_720p.mp4`;
      updateData.previewUrl = `https://${cdnHost}/${videoId}/preview.webp`;
      updateData.encodedAt = serverTimestamp();

      // Try to get video details from Bunny API for duration/dimensions
      try {
        const libraryId = process.env.BUNNY_STREAM_LIBRARY_ID || '627306';
        const apiKey = process.env.BUNNY_STREAM_API_KEY;
        if (apiKey) {
          const res = await fetch(`https://video.bunnycdn.com/library/${libraryId}/videos/${videoId}`, {
            headers: { AccessKey: apiKey }
          });
          if (res.ok) {
            const videoData = await res.json();
            if (videoData.length) updateData.duration = videoData.length;
            if (videoData.width) updateData.width = videoData.width;
            if (videoData.height) updateData.height = videoData.height;
            if (videoData.storageSize) updateData.fileSize = videoData.storageSize;
          }
        }
      } catch (err) {
        console.warn('[bunny-stream-webhook] Could not fetch video details:', err.message);
      }
    }

    if (doc.exists) {
      await docRef.update(updateData);
    } else {
      // Create doc if it doesn't exist (e.g., uploaded directly via Bunny dashboard)
      updateData.videoId = videoId;
      updateData.libraryId = process.env.BUNNY_STREAM_LIBRARY_ID || '627306';
      updateData.title = body.VideoTitle || 'Untitled';
      updateData.createdAt = serverTimestamp();
      await docRef.set(updateData);
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, videoId, status: STATUS_MAP[status] })
    };
  } catch (err) {
    console.error('[bunny-stream-webhook] Error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
