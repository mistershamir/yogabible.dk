/**
 * Netlify Function: GET/POST /.netlify/functions/instagram-webhook
 *
 * Main webhook handler for Instagram Messaging API.
 *
 * GET  — Webhook verification (Meta challenge-response)
 * POST — Incoming webhook events:
 *   - First-time DM detection → Personalized welcome greeting
 *
 * Strategy: Instagram does NOT send follow webhook events. Instead we detect
 * when someone sends their first-ever DM (including Ice Breaker taps) and
 * respond with a personalized welcome greeting. This achieves the same
 * "welcome new follower" effect that ManyChat provides.
 *
 * All keyword auto-replies are disabled — the user replies manually for now.
 * Re-enable them by uncommenting the relevant sections below.
 */

const { verifySignature, sendTextThenCta, logInteraction, jsonResponse, getUserProfile } = require('./shared/instagram-api');

// Load template data (bundled at deploy time)
const dmTemplates = require('../../src/_data/dm-templates.json');

// ---------------------------------------------------------------------------
// Language detection from name/username
// ---------------------------------------------------------------------------

function looksScandinavian(name) {
  if (!name) return false;
  return /[æøåäöü]/i.test(name) || /sen$|sson$|ström$|dahl$|berg$/i.test(name);
}

// ---------------------------------------------------------------------------
// First-time sender tracking — in-memory per warm container
// Tracks senders we've already greeted so we don't re-greet them.
// ---------------------------------------------------------------------------
const greetedSenders = new Map();
const GREETED_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

function hasBeenGreeted(senderId) {
  const ts = greetedSenders.get(senderId);
  if (!ts) return false;
  if (Date.now() - ts > GREETED_TTL) {
    greetedSenders.delete(senderId);
    return false;
  }
  return true;
}

function markGreeted(senderId) {
  // Prune old entries
  const now = Date.now();
  if (greetedSenders.size > 1000) {
    for (const [id, ts] of greetedSenders) {
      if (now - ts > GREETED_TTL) greetedSenders.delete(id);
    }
  }
  greetedSenders.set(senderId, now);
}

// ---------------------------------------------------------------------------
// Welcome greeting handler
// ---------------------------------------------------------------------------

/**
 * Send personalized welcome greeting to a first-time DM sender.
 * 1. Fetch user profile to get their real name
 * 2. Detect likely language from name/username
 * 3. Send personalized bilingual greeting
 */
async function sendWelcomeGreeting(senderId) {
  const profile = await getUserProfile(senderId);
  const firstName = profile?.firstName || null;
  const name = profile?.name || null;
  const username = profile?.username || null;

  // Detect language: Scandinavian names → Danish, otherwise English
  const lang = looksScandinavian(name) || looksScandinavian(username) ? 'da' : 'en';

  // Choose template and personalize with name
  let template;
  if (firstName) {
    template = dmTemplates.welcome_new_follower[lang] || dmTemplates.welcome_new_follower.da;
  } else {
    template = dmTemplates.welcome_fallback[lang] || dmTemplates.welcome_fallback.da;
  }

  const text = template.text.replace('{{name}}', firstName || '');
  const cta = template.cta_text ? template : null;

  await sendTextThenCta(senderId, text, cta?.cta_text, cta?.cta_url);

  await logInteraction({
    type: 'first_dm_welcome',
    senderId,
    keyword: '',
    language: lang,
    response: 'welcome',
    source: 'first_dm',
    name: firstName || username || ''
  });

  console.log('[ig-webhook] Welcome sent to', username || senderId, '(lang:', lang + ')');
}

// ---------------------------------------------------------------------------
// Duplicate message guard
// ---------------------------------------------------------------------------
const processedMessages = new Map();
const DEDUP_TTL = 5 * 60 * 1000; // 5 minutes

function isDuplicate(messageId) {
  if (!messageId) return false;
  const now = Date.now();
  for (const [id, ts] of processedMessages) {
    if (now - ts > DEDUP_TTL) processedMessages.delete(id);
  }
  if (processedMessages.has(messageId)) return true;
  processedMessages.set(messageId, now);
  return false;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
exports.handler = async function (event) {
  // ----- GET: Webhook verification -----
  if (event.httpMethod === 'GET') {
    const params = event.queryStringParameters || {};
    const mode = params['hub.mode'];
    const token = params['hub.verify_token'];
    const challenge = params['hub.challenge'];

    if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
      console.log('[ig-webhook] Verification successful');
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'text/plain' },
        body: challenge
      };
    }

    console.warn('[ig-webhook] Verification failed — token mismatch');
    return jsonResponse(403, { error: 'Verification failed' });
  }

  // ----- POST: Incoming webhook events -----
  if (event.httpMethod === 'POST') {
    // Verify signature
    const signature = event.headers['x-hub-signature-256'] || event.headers['X-Hub-Signature-256'];
    if (process.env.META_APP_SECRET && !verifySignature(event.body, signature)) {
      console.warn('[ig-webhook] Invalid signature');
      return jsonResponse(403, { error: 'Invalid signature' });
    }

    let body;
    try {
      body = JSON.parse(event.body);
    } catch (err) {
      console.error('[ig-webhook] Invalid JSON body');
      return jsonResponse(400, { error: 'Invalid JSON' });
    }

    if (body.object !== 'instagram') {
      console.log('[ig-webhook] Ignoring non-Instagram object:', body.object);
      return jsonResponse(200, { received: true });
    }

    const igAccountId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
    const entries = body.entry || [];

    for (const entry of entries) {

      // --- Messaging events: first-DM welcome greeting ---
      const messaging = entry.messaging || [];
      for (const msgEvent of messaging) {
        try {
          const senderId = msgEvent.sender?.id;

          // Skip if no sender, if it's our own echo, or if sender is our account
          if (!senderId) continue;
          if (msgEvent.message?.is_echo) continue;
          if (senderId === igAccountId) continue;

          const msgId = msgEvent.message?.mid || msgEvent.postback?.mid;
          if (isDuplicate(msgId)) continue;

          console.log('[ig-webhook] Message from:', senderId, '— text:', (msgEvent.message?.text || '(no text)').substring(0, 50));

          // Check if this is a first-time sender we haven't greeted yet
          if (!hasBeenGreeted(senderId)) {
            markGreeted(senderId);
            await sendWelcomeGreeting(senderId);
          }

          // Keyword auto-replies DISABLED — user replies manually for now.
          // Uncomment to re-enable:
          // await handleKeywordReply(senderId, msgEvent.message?.text);

        } catch (err) {
          console.error('[ig-webhook] Error handling message:', err.message);
        }
      }

      // --- Changes events (follows — kept for future if Meta enables it) ---
      const changes = entry.changes || [];
      for (const change of changes) {
        try {
          if (change.field === 'follows') {
            const value = change.value || {};
            const followerId = value.from?.id || value.sender_id;
            if (followerId && !hasBeenGreeted(followerId)) {
              markGreeted(followerId);
              await sendWelcomeGreeting(followerId);
            }
          }
        } catch (err) {
          console.error('[ig-webhook] Error handling change:', change.field, err.message);
        }
      }
    }

    return jsonResponse(200, { received: true });
  }

  // ----- OPTIONS: CORS preflight -----
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: require('./shared/instagram-api').corsHeaders, body: '' };
  }

  return jsonResponse(405, { error: 'Method not allowed' });
};
