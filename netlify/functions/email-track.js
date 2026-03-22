/**
 * Email Tracking Endpoint — Yoga Bible
 * Handles open tracking (1x1 pixel) and click tracking (redirect).
 *
 * GET /.netlify/functions/email-track?t=open&cid=CAMPAIGN_ID&e=EMAIL_HASH
 *   → Returns 1x1 transparent GIF, logs open event
 *
 * GET /.netlify/functions/email-track?t=click&cid=CAMPAIGN_ID&e=EMAIL_HASH&url=ENCODED_URL
 *   → Logs click event, redirects to target URL
 *
 * GET /.netlify/functions/email-track?action=stats&cid=CAMPAIGN_ID
 *   → Returns campaign engagement stats (admin only)
 *
 * GET /.netlify/functions/email-track?action=contacts&cid=CAMPAIGN_ID&type=opened|clicked
 *   → Returns list of contacts who opened/clicked (admin only)
 *
 * Email hashes use first 12 chars of SHA256(email) for privacy — enough to match
 * without storing plain emails in tracking URLs.
 */

const crypto = require('crypto');
const { getDb } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');

// 1x1 transparent GIF
const PIXEL_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

function hashEmail(email) {
  return crypto.createHash('sha256').update(email.toLowerCase().trim()).digest('hex').slice(0, 12);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  const params = event.queryStringParameters || {};

  try {
    // Admin stats endpoints
    if (params.action === 'stats' || params.action === 'contacts') {
      const { requireAuth } = require('./shared/auth');
      const authResult = await requireAuth(event, ['admin', 'marketing']);
      if (authResult.error) return authResult.error;

      const db = getDb();

      if (params.action === 'stats') {
        return await handleStats(db, params);
      }
      if (params.action === 'contacts') {
        return await handleContactsList(db, params);
      }
    }

    // Public tracking endpoints (no auth — called from email clients)
    if (params.t === 'open') {
      return await handleOpen(params);
    }

    if (params.t === 'click') {
      return await handleClick(params);
    }

    return jsonResponse(400, { ok: false, error: 'Invalid request' });
  } catch (err) {
    console.error('[email-track] Error:', err);
    // For tracking pixels, always return the pixel even on error
    if (params.t === 'open') {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store, no-cache' },
        body: PIXEL_GIF.toString('base64'),
        isBase64Encoded: true
      };
    }
    if (params.t === 'click' && params.url) {
      return { statusCode: 302, headers: { Location: decodeURIComponent(params.url) }, body: '' };
    }
    return jsonResponse(500, { ok: false, error: err.message });
  }
};

// ─── Open tracking ───────────────────────────────────────────────────────────

async function handleOpen(params) {
  const { cid, e } = params;

  // Fire-and-forget: log the open event, don't block pixel delivery
  if (cid && e) {
    logEvent(cid, e, 'open').catch(() => {});
  }

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    },
    body: PIXEL_GIF.toString('base64'),
    isBase64Encoded: true
  };
}

// ─── Click tracking ──────────────────────────────────────────────────────────

async function handleClick(params) {
  const { cid, e, url } = params;
  const targetUrl = url ? decodeURIComponent(url) : 'https://yogabible.dk';

  // Basic URL validation to prevent open redirects
  try {
    const parsed = new URL(targetUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { statusCode: 302, headers: { Location: 'https://yogabible.dk' }, body: '' };
    }
  } catch {
    return { statusCode: 302, headers: { Location: 'https://yogabible.dk' }, body: '' };
  }

  // Fire-and-forget: log the click event
  if (cid && e) {
    logEvent(cid, e, 'click', targetUrl).catch(() => {});
  }

  return {
    statusCode: 302,
    headers: { Location: targetUrl },
    body: ''
  };
}

// ─── Log event to Firestore ──────────────────────────────────────────────────

async function logEvent(campaignId, emailHash, type, url) {
  const db = getDb();
  await db.collection('email_tracking').add({
    campaign_id: campaignId,
    email_hash: emailHash,
    type,                          // 'open' or 'click'
    url: url || null,
    timestamp: new Date().toISOString(),
    user_agent: null               // Could be enriched later
  });
}

// ─── Campaign stats ──────────────────────────────────────────────────────────

async function handleStats(db, params) {
  if (!params.cid) return jsonResponse(400, { ok: false, error: 'cid (campaign ID) is required' });

  const snap = await db.collection('email_tracking')
    .where('campaign_id', '==', params.cid)
    .get();

  const uniqueOpens = new Set();
  const uniqueClicks = new Set();
  let totalOpens = 0;
  let totalClicks = 0;
  const clickUrls = {};

  snap.forEach(doc => {
    const data = doc.data();
    if (data.type === 'open') {
      totalOpens++;
      uniqueOpens.add(data.email_hash);
    } else if (data.type === 'click') {
      totalClicks++;
      uniqueClicks.add(data.email_hash);
      if (data.url) {
        clickUrls[data.url] = (clickUrls[data.url] || 0) + 1;
      }
    }
  });

  return jsonResponse(200, {
    ok: true,
    stats: {
      unique_opens: uniqueOpens.size,
      total_opens: totalOpens,
      unique_clicks: uniqueClicks.size,
      total_clicks: totalClicks,
      click_urls: clickUrls
    }
  });
}

// ─── List contacts who opened/clicked ────────────────────────────────────────

async function handleContactsList(db, params) {
  if (!params.cid) return jsonResponse(400, { ok: false, error: 'cid is required' });
  const type = params.type || 'opened';

  const trackType = type === 'clicked' ? 'click' : 'open';
  const snap = await db.collection('email_tracking')
    .where('campaign_id', '==', params.cid)
    .where('type', '==', trackType)
    .get();

  // Collect unique email hashes
  const hashes = new Set();
  snap.forEach(doc => hashes.add(doc.data().email_hash));

  return jsonResponse(200, {
    ok: true,
    type,
    email_hashes: Array.from(hashes),
    count: hashes.size
  });
}

module.exports.hashEmail = hashEmail;
