/**
 * Instagram Graph API - Shared Helper
 * Centralizes Meta API calls, rate limiting, and Firestore logging.
 */

const crypto = require('crypto');

const IG_API_BASE = 'https://graph.instagram.com/v21.0';
const FB_API_BASE = 'https://graph.facebook.com/v21.0';

// ---------------------------------------------------------------------------
// Rate limiter — simple in-memory sliding window (per warm container)
// Instagram Platform Rate Limits: 200 calls/user/hour for messaging
// ---------------------------------------------------------------------------
const rateLimitWindow = 60 * 60 * 1000; // 1 hour
const rateLimitMax = 180; // leave headroom below 200
let requestLog = [];

function isRateLimited() {
  const now = Date.now();
  requestLog = requestLog.filter(t => now - t < rateLimitWindow);
  if (requestLog.length >= rateLimitMax) {
    console.warn('[ig-api] Rate limit reached:', requestLog.length, 'requests in window');
    return true;
  }
  requestLog.push(now);
  return false;
}

// ---------------------------------------------------------------------------
// Signature verification — validate webhook payloads from Meta
// ---------------------------------------------------------------------------
function verifySignature(payload, signature) {
  if (!signature || !process.env.META_APP_SECRET) return false;
  const expected = 'sha256=' + crypto
    .createHmac('sha256', process.env.META_APP_SECRET)
    .update(payload, 'utf8')
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

// ---------------------------------------------------------------------------
// Send Instagram DM via Graph API
// ---------------------------------------------------------------------------
async function sendMessage(recipientId, text, ctaText, ctaUrl) {
  if (isRateLimited()) {
    console.error('[ig-api] Skipping send — rate limited');
    return { error: 'rate_limited' };
  }

  const igAccountId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
  const accessToken = process.env.META_ACCESS_TOKEN;

  if (!igAccountId || !accessToken) {
    console.error('[ig-api] Missing INSTAGRAM_BUSINESS_ACCOUNT_ID or META_ACCESS_TOKEN');
    return { error: 'missing_config' };
  }

  // Build message payload
  const message = {};

  if (ctaText && ctaUrl) {
    // Generic template with CTA button
    message.attachment = {
      type: 'template',
      payload: {
        template_type: 'generic',
        elements: [{
          title: text.substring(0, 80), // Title limit 80 chars
          subtitle: text.length > 80 ? text.substring(80, 160) : undefined,
          default_action: {
            type: 'web_url',
            url: ctaUrl
          },
          buttons: [{
            type: 'web_url',
            url: ctaUrl,
            title: ctaText.substring(0, 20) // Button title limit 20 chars
          }]
        }]
      }
    };
  } else {
    message.text = text;
  }

  const url = `${IG_API_BASE}/${igAccountId}/messages`;
  console.log('[ig-api] POST', url, 'to recipient:', recipientId);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message,
        access_token: accessToken
      })
    });

    const data = await res.json();

    if (!res.ok) {
      console.error('[ig-api] Send failed:', res.status, JSON.stringify(data));
      return { error: data.error?.message || 'Send failed', status: res.status };
    }

    console.log('[ig-api] Message sent:', data.message_id || data.id);
    return { success: true, messageId: data.message_id || data.id };
  } catch (err) {
    console.error('[ig-api] Network error:', err.message);
    return { error: err.message };
  }
}

/**
 * Send a plain text DM (for longer messages that exceed template limits).
 * Followed by a separate CTA button message if provided.
 */
async function sendTextThenCta(recipientId, text, ctaText, ctaUrl) {
  if (isRateLimited()) {
    console.error('[ig-api] Skipping send — rate limited');
    return { error: 'rate_limited' };
  }

  const igAccountId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
  const accessToken = process.env.META_ACCESS_TOKEN;

  if (!igAccountId || !accessToken) {
    console.error('[ig-api] Missing INSTAGRAM_BUSINESS_ACCOUNT_ID or META_ACCESS_TOKEN');
    return { error: 'missing_config' };
  }

  const url = `${IG_API_BASE}/${igAccountId}/messages`;

  // 1. Send text message
  try {
    const textRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text },
        access_token: accessToken
      })
    });

    const textData = await textRes.json();
    if (!textRes.ok) {
      console.error('[ig-api] Text send failed:', textRes.status, JSON.stringify(textData));
      return { error: textData.error?.message || 'Text send failed', status: textRes.status };
    }

    console.log('[ig-api] Text message sent:', textData.message_id || textData.id);
  } catch (err) {
    console.error('[ig-api] Text send network error:', err.message);
    return { error: err.message };
  }

  // 2. Send CTA button if provided
  if (ctaText && ctaUrl) {
    if (isRateLimited()) return { success: true, note: 'text_only_rate_limited' };

    try {
      const ctaRes = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient: { id: recipientId },
          message: {
            attachment: {
              type: 'template',
              payload: {
                template_type: 'button',
                text: ctaText,
                buttons: [{
                  type: 'web_url',
                  url: ctaUrl,
                  title: ctaText.substring(0, 20)
                }]
              }
            }
          },
          access_token: accessToken
        })
      });

      const ctaData = await ctaRes.json();
      if (!ctaRes.ok) {
        console.error('[ig-api] CTA send failed:', ctaRes.status, JSON.stringify(ctaData));
        // Text was sent, CTA failed — still partial success
        return { success: true, note: 'text_sent_cta_failed' };
      }

      console.log('[ig-api] CTA sent:', ctaData.message_id || ctaData.id);
    } catch (err) {
      console.error('[ig-api] CTA send network error:', err.message);
      return { success: true, note: 'text_sent_cta_network_error' };
    }
  }

  return { success: true };
}

// ---------------------------------------------------------------------------
// Firestore logging — log DM interactions for analytics
// Uses Firebase REST API (no SDK dependency needed in serverless)
// ---------------------------------------------------------------------------
async function logInteraction(data) {
  const projectId = 'yoga-bible-dk-com';

  // Use service account or skip if not configured
  // In production, use FIREBASE_SERVICE_ACCOUNT_KEY env var
  // For now, log to console as fallback
  const entry = {
    timestamp: new Date().toISOString(),
    ...data
  };

  console.log('[ig-api] Interaction:', JSON.stringify(entry));

  // Firestore REST API write (if credentials available)
  if (!process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) {
    console.log('[ig-api] No FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY — skipping Firestore write');
    return;
  }

  try {
    const serviceAccount = {
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
      private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    };

    // Create JWT for Firestore access
    const jwt = await createFirestoreJwt(serviceAccount);
    if (!jwt) return;

    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/instagram_interactions`;

    const firestoreDoc = {
      fields: {
        timestamp: { timestampValue: entry.timestamp },
        type: { stringValue: entry.type || 'unknown' },
        senderId: { stringValue: entry.senderId || '' },
        keyword: { stringValue: entry.keyword || '' },
        language: { stringValue: entry.language || 'da' },
        response: { stringValue: entry.response || '' },
        source: { stringValue: entry.source || 'dm' }
      }
    };

    const res = await fetch(firestoreUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwt}`
      },
      body: JSON.stringify(firestoreDoc)
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('[ig-api] Firestore write failed:', res.status, errText.substring(0, 200));
    } else {
      console.log('[ig-api] Logged to Firestore');
    }
  } catch (err) {
    console.error('[ig-api] Firestore logging error:', err.message);
  }
}

/**
 * Create a short-lived JWT for Firestore REST API access.
 * Uses Google's OAuth2 token endpoint with service account credentials.
 */
async function createFirestoreJwt(serviceAccount) {
  try {
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      iss: serviceAccount.client_email,
      sub: serviceAccount.client_email,
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
      scope: 'https://www.googleapis.com/auth/datastore'
    })).toString('base64url');

    const signInput = `${header}.${payload}`;
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(signInput);
    const signature = sign.sign(serviceAccount.private_key, 'base64url');
    const jwt = `${signInput}.${signature}`;

    // Exchange JWT for access token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
    });

    if (!tokenRes.ok) {
      console.error('[ig-api] Google OAuth token exchange failed:', tokenRes.status);
      return null;
    }

    const tokenData = await tokenRes.json();
    return tokenData.access_token;
  } catch (err) {
    console.error('[ig-api] JWT creation error:', err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// User profile fetching — get name, username from Instagram Graph API
// ---------------------------------------------------------------------------
async function getUserProfile(userId) {
  const accessToken = process.env.META_ACCESS_TOKEN;
  if (!accessToken || !userId) return null;

  try {
    const res = await fetch(
      `${IG_API_BASE}/${userId}?fields=name,username&access_token=${accessToken}`
    );
    const data = await res.json();

    if (!res.ok) {
      console.log('[ig-api] Profile fetch failed for', userId, ':', data.error?.message || res.status);
      return null;
    }

    console.log('[ig-api] Profile fetched:', data.username || userId, '— name:', data.name || '(none)');
    return {
      name: data.name || null,
      username: data.username || null,
      firstName: data.name ? data.name.split(' ')[0] : null
    };
  } catch (err) {
    console.log('[ig-api] Profile fetch error:', err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Conversation state — in-memory per warm container
// Tracks where each user is in a conversation flow.
// Key: senderId, Value: { step, lang, interest, timestamp }
// Auto-expires after 24 hours.
// ---------------------------------------------------------------------------
const conversationState = new Map();
const CONVO_TTL = 24 * 60 * 60 * 1000; // 24 hours

function getConvoState(senderId) {
  const state = conversationState.get(senderId);
  if (!state) return null;
  if (Date.now() - state.timestamp > CONVO_TTL) {
    conversationState.delete(senderId);
    return null;
  }
  return state;
}

function setConvoState(senderId, state) {
  // Prune old entries (keep map small)
  const now = Date.now();
  if (conversationState.size > 500) {
    for (const [id, s] of conversationState) {
      if (now - s.timestamp > CONVO_TTL) conversationState.delete(id);
    }
  }
  conversationState.set(senderId, { ...state, timestamp: now });
}

function clearConvoState(senderId) {
  conversationState.delete(senderId);
}

// ---------------------------------------------------------------------------
// CORS + JSON response helpers (match mb-api.js pattern)
// ---------------------------------------------------------------------------
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
};

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders
    },
    body: JSON.stringify(body)
  };
}

module.exports = {
  IG_API_BASE,
  FB_API_BASE,
  verifySignature,
  sendMessage,
  sendTextThenCta,
  logInteraction,
  isRateLimited,
  getUserProfile,
  getConvoState,
  setConvoState,
  clearConvoState,
  corsHeaders,
  jsonResponse
};
