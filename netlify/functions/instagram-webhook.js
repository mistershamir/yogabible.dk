/**
 * Netlify Function: GET/POST /.netlify/functions/instagram-webhook
 *
 * Main webhook handler for Instagram Messaging API.
 *
 * GET  — Webhook verification (Meta challenge-response)
 * POST — Incoming webhook events:
 *   - messages        → Keyword DM automation
 *   - messaging_postbacks → Button click handling
 *   - comments        → Comment trigger automation (via mentions webhook)
 *   - story_mentions  → Story mention thank-you DM
 *   - story_replies   → Story reply thank-you DM
 *   - follows         → New follower welcome DM (delayed)
 *
 * Architecture:
 *   - Keywords are loaded from src/_data/dm-keywords.json (build-time bundled)
 *   - Templates are loaded from src/_data/dm-templates.json
 *   - Language detection: checks message text for Danish/English signals
 *   - All interactions are logged to Firestore for analytics
 */

const { verifySignature, sendTextThenCta, logInteraction, jsonResponse, getUserProfile, getConvoState, setConvoState, clearConvoState } = require('./shared/instagram-api');

// Load keyword and template data (bundled at deploy time)
const dmKeywords = require('../../src/_data/dm-keywords.json');
const dmTemplates = require('../../src/_data/dm-templates.json');

// ---------------------------------------------------------------------------
// Keyword matching
// ---------------------------------------------------------------------------

/**
 * Build a fast lookup map: alias (uppercase) → keyword config key
 */
function buildAliasMap() {
  const map = {};
  for (const [key, config] of Object.entries(dmKeywords.keywords)) {
    for (const alias of config.aliases) {
      map[alias.toUpperCase()] = key;
    }
  }
  return map;
}

const aliasMap = buildAliasMap();

/**
 * Match a message text against keyword aliases.
 * Tries exact match first, then checks if message starts with a keyword.
 */
function matchKeyword(text) {
  if (!text) return null;
  const normalized = text.trim().toUpperCase();

  // Exact match
  if (aliasMap[normalized]) return aliasMap[normalized];

  // Check if message starts with a keyword (e.g., "200HR please" → "200HR")
  for (const alias of Object.keys(aliasMap)) {
    if (normalized.startsWith(alias + ' ') || normalized.startsWith(alias + '!') || normalized.startsWith(alias + '?')) {
      return aliasMap[alias];
    }
  }

  // Check if any keyword appears as a standalone word in the message
  for (const alias of Object.keys(aliasMap)) {
    if (alias.length >= 3) { // Only match keywords 3+ chars to avoid false positives
      const regex = new RegExp('\\b' + alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
      if (regex.test(normalized)) return aliasMap[alias];
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------

const DANISH_SIGNALS = [
  'hej', 'tak', 'jeg', 'vil', 'gerne', 'kan', 'hvad', 'hvordan',
  'uddannelse', 'uger', 'kursus', 'pris', 'skema', 'ansøg',
  'ønsker', 'mere', 'info', 'venligst', 'mange'
];

const ENGLISH_SIGNALS = [
  'hi', 'hello', 'thanks', 'want', 'would', 'like', 'how', 'what',
  'training', 'weeks', 'course', 'price', 'schedule', 'apply',
  'please', 'more', 'information', 'interested'
];

/**
 * Detect language from message text.
 * Returns 'da' or 'en'. Defaults to 'da' (Danish primary market).
 */
function detectLanguage(text) {
  if (!text) return 'da';
  const lower = text.toLowerCase();
  const words = lower.split(/\s+/);

  let daScore = 0;
  let enScore = 0;

  for (const word of words) {
    if (DANISH_SIGNALS.includes(word)) daScore++;
    if (ENGLISH_SIGNALS.includes(word)) enScore++;
  }

  // Danish characters are a strong signal
  if (/[æøå]/i.test(text)) daScore += 3;

  return enScore > daScore ? 'en' : 'da';
}

// ---------------------------------------------------------------------------
// Conversation flow keywords — these trigger the onboarding flow steps
// ---------------------------------------------------------------------------
const INTEREST_PRACTICE = ['PRAKSIS', 'PRACTICE', 'PRAKTIK', 'DEEPEN', 'FORDYBE', '1'];
const INTEREST_TEACHER = ['LÆRER', 'TEACHER', 'UNDERVISER', 'TEACHING', 'YOGALÆRER', '2'];
const INTEREST_BOTH = ['BEGGE', 'BOTH', 'ALLE', 'ALL', '3'];
const LOCATION_LOCAL = ['LOKAL', 'LOCAL', 'KØBENHAVN', 'COPENHAGEN', 'CPH', 'KBH'];
const LOCATION_INTL = ['INTERNATIONAL', 'INTL', 'ABROAD', 'UDLAND', 'TRAVEL', 'REJSE'];

/**
 * Detect if a username/name looks Scandinavian (heuristic for language default).
 */
function looksScandinavian(name) {
  if (!name) return false;
  return /[æøåäöü]/i.test(name) || /sen$|sson$|ström$|dahl$|berg$/i.test(name);
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

/**
 * Handle incoming DM message — conversation flow + keyword matching
 */
async function handleMessage(senderId, message) {
  const text = message.text || '';
  const normalized = text.trim().toUpperCase();
  const lang = detectLanguage(text);

  // --- Check if user is in a conversation flow ---
  const convo = getConvoState(senderId);

  if (convo && convo.step === 'awaiting_interest') {
    // User is responding to "what interests you?" question
    const convoLang = convo.lang || lang;

    if (INTEREST_PRACTICE.includes(normalized) || INTEREST_PRACTICE.some(k => normalized.includes(k))) {
      const template = dmTemplates.interest_practice[convoLang] || dmTemplates.interest_practice.da;
      await sendTextThenCta(senderId, template.text);
      setConvoState(senderId, { step: 'awaiting_location', lang: convoLang, interest: 'practice' });
      await logInteraction({ type: 'convo_interest', senderId, keyword: 'practice', language: convoLang, response: 'interest_practice', source: 'dm' });
      return;
    }

    if (INTEREST_TEACHER.includes(normalized) || INTEREST_TEACHER.some(k => normalized.includes(k))) {
      const template = dmTemplates.interest_teacher[convoLang] || dmTemplates.interest_teacher.da;
      await sendTextThenCta(senderId, template.text);
      setConvoState(senderId, { step: 'awaiting_location', lang: convoLang, interest: 'teacher' });
      await logInteraction({ type: 'convo_interest', senderId, keyword: 'teacher', language: convoLang, response: 'interest_teacher', source: 'dm' });
      return;
    }

    if (INTEREST_BOTH.includes(normalized) || INTEREST_BOTH.some(k => normalized.includes(k))) {
      const template = dmTemplates.interest_both[convoLang] || dmTemplates.interest_both.da;
      await sendTextThenCta(senderId, template.text);
      setConvoState(senderId, { step: 'awaiting_location', lang: convoLang, interest: 'both' });
      await logInteraction({ type: 'convo_interest', senderId, keyword: 'both', language: convoLang, response: 'interest_both', source: 'dm' });
      return;
    }

    // Didn't match an interest — fall through to normal keyword matching
    // (user might type "200HR" instead of answering the question)
  }

  if (convo && convo.step === 'awaiting_location') {
    // User is responding to "are you local or international?" question
    const convoLang = convo.lang || lang;

    if (LOCATION_LOCAL.includes(normalized) || LOCATION_LOCAL.some(k => normalized.includes(k))) {
      const template = dmTemplates.location_local[convoLang] || dmTemplates.location_local.da;
      await sendTextThenCta(senderId, template.text, template.cta_text, template.cta_url);
      clearConvoState(senderId);
      await logInteraction({ type: 'convo_location', senderId, keyword: 'local', language: convoLang, response: 'location_local', source: 'dm' });
      return;
    }

    if (LOCATION_INTL.includes(normalized) || LOCATION_INTL.some(k => normalized.includes(k))) {
      const template = dmTemplates.location_international[convoLang] || dmTemplates.location_international.da;
      await sendTextThenCta(senderId, template.text, template.cta_text, template.cta_url);
      clearConvoState(senderId);
      await logInteraction({ type: 'convo_location', senderId, keyword: 'international', language: convoLang, response: 'location_international', source: 'dm' });
      return;
    }

    // Didn't match a location — fall through to normal keyword matching
  }

  // --- Normal keyword matching (works whether in convo flow or not) ---
  const keywordKey = matchKeyword(text);

  if (keywordKey) {
    // Matched a keyword — clear any conversation state and send response
    clearConvoState(senderId);
    const keywordConfig = dmKeywords.keywords[keywordKey];
    const response = keywordConfig[lang] || keywordConfig.da;

    await sendTextThenCta(senderId, response.text, response.cta_text, response.cta_url);

    await logInteraction({
      type: 'keyword_dm',
      senderId,
      keyword: keywordKey,
      language: lang,
      response: 'matched',
      source: 'dm'
    });
  } else {
    // No keyword match — send fallback
    const fallback = dmTemplates.fallback[lang] || dmTemplates.fallback.da;

    await sendTextThenCta(senderId, fallback.text, fallback.cta_text, fallback.cta_url);

    await logInteraction({
      type: 'fallback_dm',
      senderId,
      keyword: text.substring(0, 100),
      language: lang,
      response: 'fallback',
      source: 'dm'
    });
  }
}

/**
 * Handle comment with keyword — auto-DM the commenter
 * Instagram sends comment webhooks; we DM the user who commented.
 */
async function handleComment(senderId, commentText, mediaId) {
  const keywordKey = matchKeyword(commentText);
  if (!keywordKey) return; // Only auto-DM on keyword comments

  const lang = detectLanguage(commentText);
  const keywordConfig = dmKeywords.keywords[keywordKey];
  const response = keywordConfig[lang] || keywordConfig.da;

  // Build comment-trigger intro + keyword response
  const commentIntro = dmTemplates.comment_trigger[lang] || dmTemplates.comment_trigger.da;
  const introText = commentIntro.text
    .replace('{{keyword}}', keywordKey)
    .replace('{{url}}', response.cta_url);

  const fullText = introText + '\n\n' + response.text;

  await sendTextThenCta(senderId, fullText, response.cta_text, response.cta_url);

  await logInteraction({
    type: 'comment_trigger',
    senderId,
    keyword: keywordKey,
    language: lang,
    response: 'matched',
    source: 'comment',
    mediaId: mediaId || ''
  });
}

/**
 * Handle story mention — thank the user with a DM
 */
async function handleStoryMention(senderId) {
  const lang = 'da'; // Default to Danish for story mentions
  const template = dmTemplates.story_mention_thanks[lang];

  await sendTextThenCta(senderId, template.text, template.cta_text, template.cta_url);

  await logInteraction({
    type: 'story_mention',
    senderId,
    keyword: '',
    language: lang,
    response: 'story_thanks',
    source: 'story_mention'
  });
}

/**
 * Handle story reply — thank the user with a DM
 */
async function handleStoryReply(senderId, replyText) {
  const lang = detectLanguage(replyText);

  // Check if the reply contains a keyword
  const keywordKey = matchKeyword(replyText);

  if (keywordKey) {
    // Keyword in story reply — send keyword response
    const keywordConfig = dmKeywords.keywords[keywordKey];
    const response = keywordConfig[lang] || keywordConfig.da;
    await sendTextThenCta(senderId, response.text, response.cta_text, response.cta_url);
  } else {
    // Generic story reply thanks
    const template = dmTemplates.story_reply_thanks[lang] || dmTemplates.story_reply_thanks.da;
    await sendTextThenCta(senderId, template.text, template.cta_text, template.cta_url);
  }

  await logInteraction({
    type: 'story_reply',
    senderId,
    keyword: keywordKey || replyText.substring(0, 100),
    language: lang,
    response: keywordKey ? 'matched' : 'story_reply_thanks',
    source: 'story_reply'
  });
}

/**
 * Handle new follower — personalized welcome DM with conversation starter.
 * 1. Fetch user profile to get their real name
 * 2. Detect likely language from name/username
 * 3. Send personalized greeting asking about their interest
 * 4. Set conversation state to track the flow
 */
async function handleNewFollower(senderId) {
  // Fetch user profile for personalization
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
    // No name available — use fallback without {{name}}
    template = dmTemplates.welcome_fallback[lang] || dmTemplates.welcome_fallback.da;
  }

  const text = template.text.replace('{{name}}', firstName || '');

  await sendTextThenCta(senderId, text);

  // Set conversation state — awaiting interest response
  setConvoState(senderId, { step: 'awaiting_interest', lang });

  await logInteraction({
    type: 'new_follower',
    senderId,
    keyword: '',
    language: lang,
    response: 'welcome_convo',
    source: 'follow',
    name: firstName || username || ''
  });
}

// ---------------------------------------------------------------------------
// Duplicate message guard — prevent double-processing within warm container
// ---------------------------------------------------------------------------
const processedMessages = new Map();
const DEDUP_TTL = 5 * 60 * 1000; // 5 minutes

function isDuplicate(messageId) {
  if (!messageId) return false;

  // Prune old entries
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

    // Must be an Instagram webhook
    if (body.object !== 'instagram') {
      console.log('[ig-webhook] Ignoring non-Instagram object:', body.object);
      return jsonResponse(200, { received: true });
    }

    // Process each entry
    const entries = body.entry || [];
    for (const entry of entries) {

      // --- Messaging events ---
      const messaging = entry.messaging || [];
      for (const event of messaging) {
        const senderId = event.sender?.id;
        if (!senderId) continue;

        // Skip messages from ourselves (echo)
        if (event.message?.is_echo) continue;

        // Dedup
        const msgId = event.message?.mid || event.postback?.mid;
        if (isDuplicate(msgId)) {
          console.log('[ig-webhook] Skipping duplicate:', msgId);
          continue;
        }

        try {
          if (event.message) {
            // Check for story reply
            if (event.message.reply_to?.story) {
              await handleStoryReply(senderId, event.message.text || '');
            } else {
              await handleMessage(senderId, event.message);
            }
          } else if (event.postback) {
            // Button postback — treat payload as a keyword
            await handleMessage(senderId, { text: event.postback.payload || '' });
          }
        } catch (err) {
          console.error('[ig-webhook] Error handling message:', err.message);
        }
      }

      // --- Changes events (comments, story mentions, follows) ---
      const changes = entry.changes || [];
      for (const change of changes) {
        try {
          if (change.field === 'comments') {
            const value = change.value || {};
            const commenterId = value.from?.id;
            const commentText = value.text || '';
            const mediaId = value.media?.id || '';

            if (commenterId) {
              await handleComment(commenterId, commentText, mediaId);
            }
          } else if (change.field === 'story_insights' || change.field === 'mentions') {
            // Story mention
            const value = change.value || {};
            const mentionerId = value.sender_id || value.from?.id;
            if (mentionerId) {
              await handleStoryMention(mentionerId);
            }
          } else if (change.field === 'follows') {
            // New follower (not available in all API versions — depends on permissions)
            const value = change.value || {};
            const followerId = value.from?.id || value.sender_id;
            if (followerId) {
              await handleNewFollower(followerId);
            }
          }
        } catch (err) {
          console.error('[ig-webhook] Error handling change:', change.field, err.message);
        }
      }
    }

    // Always return 200 to Meta (they retry on non-200)
    return jsonResponse(200, { received: true });
  }

  // ----- OPTIONS: CORS preflight -----
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: require('./shared/instagram-api').corsHeaders, body: '' };
  }

  return jsonResponse(405, { error: 'Method not allowed' });
};
