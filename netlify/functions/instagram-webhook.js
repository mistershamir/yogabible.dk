/**
 * Netlify Function: GET/POST /.netlify/functions/instagram-webhook
 *
 * Main webhook handler for Instagram Messaging API.
 *
 * GET  — Webhook verification (Meta challenge-response)
 * POST — Incoming webhook events:
 *   - follows → New follower welcome DM (personalized, bilingual)
 *   - follows → Match follower to existing lead → update social_engagement
 *
 * Currently ONLY the new follower greeting is active.
 * All other auto-replies (keyword DMs, comments, story mentions) are disabled.
 * Re-enable them by uncommenting the relevant sections below.
 */

const { verifySignature, sendTextThenCta, logInteraction, jsonResponse, getUserProfile } = require('./shared/instagram-api');
const { getDb } = require('./shared/firestore');
const { FieldValue } = require('firebase-admin/firestore');

// Load template data (bundled at deploy time)
const dmTemplates = require('../../src/_data/dm-templates.json');

// ---------------------------------------------------------------------------
// Language detection from name/username
// ---------------------------------------------------------------------------

/**
 * Detect if a name looks Scandinavian (heuristic for language default).
 */
function looksScandinavian(name) {
  if (!name) return false;
  return /[æøåäöü]/i.test(name) || /sen$|sson$|ström$|dahl$|berg$/i.test(name);
}

// ---------------------------------------------------------------------------
// Lead matching — link Instagram followers to existing leads in Firestore
// ---------------------------------------------------------------------------

/**
 * Try to match an Instagram follower to an existing lead.
 * Matching strategy (in order of confidence):
 *   1. Lead already has instagram_user_id matching this follower
 *   2. Lead has instagram_username matching the follower's username
 *   3. Fuzzy name match: lead.first_name matches follower's firstName
 *      (only if unique — skip if multiple leads share the name)
 *
 * If matched, updates the lead's social_engagement field.
 */
async function matchFollowerToLead(senderId, profile) {
  if (!profile) return null;

  try {
    const db = getDb();
    const leadsRef = db.collection('leads');
    var matchedId = null;
    var matchedDoc = null;

    // Strategy 1: exact ig_user_id match (previously linked)
    if (senderId) {
      var snap1 = await leadsRef.where('instagram_user_id', '==', String(senderId)).limit(1).get();
      if (!snap1.empty) {
        matchedId = snap1.docs[0].id;
        matchedDoc = snap1.docs[0].data();
      }
    }

    // Strategy 2: username match
    if (!matchedId && profile.username) {
      var snap2 = await leadsRef.where('instagram_username', '==', profile.username.toLowerCase()).limit(1).get();
      if (!snap2.empty) {
        matchedId = snap2.docs[0].id;
        matchedDoc = snap2.docs[0].data();
      }
    }

    // Strategy 3: first name match (only if unique)
    if (!matchedId && profile.firstName) {
      var nameNorm = profile.firstName.toLowerCase().trim();
      var snap3 = await leadsRef.where('first_name_lower', '==', nameNorm).limit(2).get();
      if (snap3.size === 1) {
        matchedId = snap3.docs[0].id;
        matchedDoc = snap3.docs[0].data();
      }
      // If 0 or 2+, skip — not confident enough
    }

    if (!matchedId) {
      console.log('[ig-webhook] No lead match for follower:', profile.username || senderId);
      return null;
    }

    console.log('[ig-webhook] Matched follower @' + (profile.username || senderId) + ' to lead ' + matchedId + ' (' + (matchedDoc.email || '') + ')');

    // Update lead with social engagement data
    var now = new Date();
    var updateData = {
      'social_engagement.instagram_followed': true,
      'social_engagement.instagram_followed_at': now,
      'social_engagement.instagram_user_id': String(senderId),
      last_activity: now
    };
    if (profile.username) {
      updateData.instagram_username = profile.username.toLowerCase();
      updateData.instagram_user_id = String(senderId);
      updateData['social_engagement.instagram_username'] = profile.username;
    }

    // Add instagram to platforms array (merge, don't overwrite)
    var existingPlatforms = (matchedDoc.social_engagement && matchedDoc.social_engagement.platforms) || [];
    if (!existingPlatforms.includes('instagram')) {
      updateData['social_engagement.platforms'] = [...existingPlatforms, 'instagram'];
    }

    await leadsRef.doc(matchedId).update(updateData);
    console.log('[ig-webhook] Updated lead ' + matchedId + ' with Instagram follow');

    return matchedId;
  } catch (err) {
    console.error('[ig-webhook] Lead matching error:', err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// New follower handler — the only active auto-reply
// ---------------------------------------------------------------------------

/**
 * Handle new follower — personalized welcome DM + lead matching.
 * 1. Fetch user profile to get their real name
 * 2. Detect likely language from name/username
 * 3. Send personalized bilingual greeting
 * 4. Try to match follower to an existing lead
 */
async function handleNewFollower(senderId) {
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

  // Try to link this follower to an existing lead (non-blocking)
  var matchedLeadId = await matchFollowerToLead(senderId, profile).catch(function (err) {
    console.error('[ig-webhook] Lead match failed (non-blocking):', err.message);
    return null;
  });

  await logInteraction({
    type: 'new_follower',
    senderId,
    keyword: '',
    language: lang,
    response: 'welcome',
    source: 'follow',
    name: firstName || username || '',
    matched_lead_id: matchedLeadId || null
  });
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

    const entries = body.entry || [];
    for (const entry of entries) {

      // --- Messaging events (DISABLED — manual replies only) ---
      // Uncomment below to re-enable keyword auto-replies:
      /*
      const messaging = entry.messaging || [];
      for (const msgEvent of messaging) {
        const senderId = msgEvent.sender?.id;
        if (!senderId || msgEvent.message?.is_echo) continue;
        const msgId = msgEvent.message?.mid || msgEvent.postback?.mid;
        if (isDuplicate(msgId)) continue;
        // handleMessage(senderId, msgEvent.message);
      }
      */

      // --- Changes events (follows only) ---
      const changes = entry.changes || [];
      for (const change of changes) {
        try {
          if (change.field === 'follows') {
            const value = change.value || {};
            const followerId = value.from?.id || value.sender_id;
            if (followerId) {
              await handleNewFollower(followerId);
            }
          }
          // Comments and story mentions DISABLED for now
          // Uncomment to re-enable:
          // if (change.field === 'comments') { ... }
          // if (change.field === 'story_insights' || change.field === 'mentions') { ... }
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
