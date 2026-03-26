/**
 * Email Tracking Endpoint — Yoga Bible
 * Handles open tracking (1x1 pixel) and click tracking (redirect).
 *
 * === Lead-level tracking (sequences, welcome emails) ===
 * GET ?t=open&lid=LEAD_ID&src=seq:ID:step
 *   → Returns 1x1 GIF, logs open on lead doc (email_engagement)
 *
 * GET ?t=click&lid=LEAD_ID&url=ENCODED_URL&src=seq:ID:step
 *   → Logs click, sets yb_lid cookie (for site tracking), redirects
 *
 * === Campaign-level tracking (bulk campaigns) ===
 * GET ?t=open&cid=CAMPAIGN_ID&e=EMAIL_HASH
 * GET ?t=click&cid=CAMPAIGN_ID&e=EMAIL_HASH&url=ENCODED_URL
 *
 * === Admin endpoints ===
 * GET ?action=stats&cid=CAMPAIGN_ID
 * GET ?action=contacts&cid=CAMPAIGN_ID&type=opened|clicked
 */

const crypto = require('crypto');
const { getDb } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');
const admin = require('firebase-admin');

// 1x1 transparent GIF
const PIXEL_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

const REENGAGEMENT_THRESHOLD_DAYS = 7;

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
      if (params.action === 'stats') return await handleStats(db, params);
      if (params.action === 'contacts') return await handleContactsList(db, params);
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
  const { cid, e, lid, src } = params;

  // Lead-level tracking (fire-and-forget)
  if (lid) {
    logLeadOpen(lid, src).catch(() => {});
  }
  // Campaign-level tracking (fire-and-forget)
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
  const { cid, e, lid, url, src } = params;
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

  // Lead-level click tracking (fire-and-forget)
  if (lid) {
    logLeadClick(lid, targetUrl, src).catch(() => {});
  }
  // Campaign-level tracking (fire-and-forget)
  if (cid && e) {
    logEvent(cid, e, 'click', targetUrl).catch(() => {});
  }

  // Set yb_lid cookie for website behavior tracking (1 year expiry)
  var cookieHeaders = {};
  if (lid) {
    cookieHeaders['Set-Cookie'] = 'yb_lid=' + encodeURIComponent(lid) +
      '; Max-Age=31536000; Path=/; SameSite=Lax; Secure';
  }

  return {
    statusCode: 302,
    headers: Object.assign({ Location: targetUrl }, cookieHeaders),
    body: ''
  };
}

// ─── Lead-level engagement logging ──────────────────────────────────────────

async function logLeadOpen(leadId, source) {
  var db = getDb();
  var now = admin.firestore.Timestamp.now();

  var leadRef = db.collection('leads').doc(leadId);
  var leadDoc = await leadRef.get();
  if (!leadDoc.exists) return;

  var lead = leadDoc.data();

  // Check for re-engagement
  var reEngagement = checkReEngagement(lead, 'email_open', source);

  var updates = {
    'email_engagement.total_opens': admin.firestore.FieldValue.increment(1),
    'email_engagement.last_opened': now,
    'email_engagement.opens': admin.firestore.FieldValue.arrayUnion({
      at: now.toDate().toISOString(),
      src: source || null
    }),
    last_activity: now,
    updated_at: now
  };

  if (reEngagement) {
    updates.re_engaged = true;
    updates.re_engaged_at = now;
    updates.re_engagement_events = admin.firestore.FieldValue.arrayUnion(reEngagement);
  }

  await leadRef.update(updates);
}

async function logLeadClick(leadId, url, source) {
  var db = getDb();
  var now = admin.firestore.Timestamp.now();

  var leadRef = db.collection('leads').doc(leadId);
  var leadDoc = await leadRef.get();
  if (!leadDoc.exists) return;

  var lead = leadDoc.data();

  // Check for re-engagement
  var reEngagement = checkReEngagement(lead, 'email_click', url);

  var updates = {
    'email_engagement.total_clicks': admin.firestore.FieldValue.increment(1),
    'email_engagement.last_clicked': now,
    'email_engagement.clicks': admin.firestore.FieldValue.arrayUnion({
      url: url,
      at: now.toDate().toISOString(),
      src: source || null
    }),
    last_activity: now,
    updated_at: now
  };

  if (reEngagement) {
    updates.re_engaged = true;
    updates.re_engaged_at = now;
    updates.re_engagement_events = admin.firestore.FieldValue.arrayUnion(reEngagement);
  }

  await leadRef.update(updates);
}

// ─── Re-engagement detection ─────────────────────────────────────────────────

function checkReEngagement(lead, trigger, detail) {
  var lastActivity = lead.last_activity;
  if (!lastActivity) return null;

  var lastMs = lastActivity.toDate ? lastActivity.toDate().getTime() : new Date(lastActivity).getTime();
  var daysSince = (Date.now() - lastMs) / (1000 * 60 * 60 * 24);

  if (daysSince >= REENGAGEMENT_THRESHOLD_DAYS) {
    return {
      at: new Date().toISOString(),
      trigger: trigger,
      detail: detail || null,
      days_inactive: Math.round(daysSince)
    };
  }
  return null;
}

// ─── Campaign-level event log (existing) ─────────────────────────────────────

async function logEvent(campaignId, emailHash, type, url) {
  const db = getDb();
  await db.collection('email_tracking').add({
    campaign_id: campaignId,
    email_hash: emailHash,
    type,
    url: url || null,
    timestamp: new Date().toISOString(),
    user_agent: null
  });
}

// ─── Campaign stats (existing) ───────────────────────────────────────────────

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
      if (data.url) clickUrls[data.url] = (clickUrls[data.url] || 0) + 1;
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

async function handleContactsList(db, params) {
  if (!params.cid) return jsonResponse(400, { ok: false, error: 'cid is required' });
  const type = params.type || 'opened';
  const trackType = type === 'clicked' ? 'click' : 'open';
  const snap = await db.collection('email_tracking')
    .where('campaign_id', '==', params.cid)
    .where('type', '==', trackType)
    .get();

  const hashes = new Set();
  snap.forEach(doc => hashes.add(doc.data().email_hash));

  return jsonResponse(200, { ok: true, type, email_hashes: Array.from(hashes), count: hashes.size });
}

module.exports.hashEmail = hashEmail;
