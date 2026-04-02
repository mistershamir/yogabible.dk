// Social Mentions Monitor — Yoga Bible
// Tracks @mentions, tagged posts, and brand keyword mentions across platforms.
// GET  /.netlify/functions/social-mentions?action=list[&days=7]
// GET  /.netlify/functions/social-mentions?action=stats
// POST /.netlify/functions/social-mentions  { action: 'refresh' }
// POST /.netlify/functions/social-mentions  { action: 'mark-read', ids: [...] }
// POST /.netlify/functions/social-mentions  { action: 'update-keywords', keywords: [...] }
// Also runs as a scheduled function every 2 hours: schedule = "0 */2 * * *"

const { getDb, serverTimestamp } = require('./shared/firestore');
const { requireAuth } = require('./shared/auth');
const { jsonResponse, optionsResponse } = require('./shared/utils');

const MENTIONS_COLLECTION = 'social_mentions';
const ACCOUNTS_COLLECTION = 'social_accounts';
const CONFIG_DOC_PATH = 'system/social_mentions_config';

const FB_API = 'https://graph.facebook.com/v21.0';

// Default brand keywords to monitor
const DEFAULT_KEYWORDS = [
  'yogabible', 'yoga bible', 'yogabibledk',
  'torvegade 66', 'torvegade66',
  'yoga copenhagen teacher training'
];

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  const db = getDb();

  // Scheduled invocation — refresh mentions
  if (!event.httpMethod || event.httpMethod === 'GET' && !event.queryStringParameters?.action) {
    // Could be a scheduled trigger
    if (!event.queryStringParameters || !event.queryStringParameters.action) {
      return refreshMentions(db);
    }
  }

  // Auth required for all API calls
  const user = await requireAuth(event, ['admin']);
  if (user.error) return user.error;

  try {
    if (event.httpMethod === 'GET') {
      const params = event.queryStringParameters || {};
      switch (params.action) {
        case 'list': return listMentions(db, params);
        case 'stats': return getMentionStats(db, params);
        default:
          return jsonResponse(400, { ok: false, error: `Unknown action: ${params.action}` });
      }
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      switch (body.action) {
        case 'refresh': return refreshMentions(db);
        case 'mark-read': return markMentionsRead(db, body);
        case 'update-keywords': return updateKeywords(db, body);
        default:
          return jsonResponse(400, { ok: false, error: `Unknown action: ${body.action}` });
      }
    }

    return jsonResponse(405, { ok: false, error: 'Method not allowed' });
  } catch (err) {
    console.error('[social-mentions] Error:', err);
    return jsonResponse(500, { ok: false, error: err.message });
  }
};


// ── Refresh: fetch new mentions from all platforms ──────────────

async function refreshMentions(db) {
  const accounts = await loadAccounts(db);
  const config = await loadConfig(db);
  let totalNew = 0;

  // Get existing mention IDs to avoid duplicates
  const existingSnap = await db.collection(MENTIONS_COLLECTION)
    .orderBy('createdAt', 'desc')
    .limit(500)
    .get();
  const existingIds = new Set();
  existingSnap.forEach(doc => {
    const d = doc.data();
    if (d.platformMentionId) existingIds.add(d.platformMentionId);
  });

  // Instagram: tagged media + mentions
  if (accounts.instagram && accounts.instagram.accessToken) {
    try {
      const igMentions = await fetchInstagramMentions(accounts.instagram, existingIds);
      for (const mention of igMentions) {
        await db.collection(MENTIONS_COLLECTION).add({
          ...mention,
          read: false,
          createdAt: serverTimestamp()
        });
        totalNew++;
      }
    } catch (err) {
      console.error('[social-mentions] IG fetch error:', err.message);
    }
  }

  // Facebook: page mentions + tagged posts
  if (accounts.facebook && accounts.facebook.accessToken) {
    try {
      const fbMentions = await fetchFacebookMentions(accounts.facebook, existingIds);
      for (const mention of fbMentions) {
        await db.collection(MENTIONS_COLLECTION).add({
          ...mention,
          read: false,
          createdAt: serverTimestamp()
        });
        totalNew++;
      }
    } catch (err) {
      console.error('[social-mentions] FB fetch error:', err.message);
    }
  }

  // Update last refresh time
  await db.doc(CONFIG_DOC_PATH).set({
    lastRefresh: serverTimestamp(),
    lastNewCount: totalNew,
    keywords: config.keywords || DEFAULT_KEYWORDS
  }, { merge: true });

  console.log(`[social-mentions] Refresh complete: ${totalNew} new mentions`);
  return jsonResponse(200, { ok: true, newMentions: totalNew });
}


// ── Instagram: fetch tagged media and mentions ──────────────────

async function fetchInstagramMentions(account, existingIds) {
  const { accessToken, igAccountId } = account;
  if (!igAccountId) return [];

  const mentions = [];

  // 1. Tagged media (posts where @yogabible is tagged)
  try {
    const taggedRes = await fetch(
      `${FB_API}/${igAccountId}/tags?fields=id,caption,media_type,media_url,permalink,timestamp,username&limit=25&access_token=${accessToken}`
    );
    const taggedData = await taggedRes.json();

    if (taggedData.data) {
      for (const post of taggedData.data) {
        const mentionId = `ig_tag_${post.id}`;
        if (existingIds.has(mentionId)) continue;

        mentions.push({
          platform: 'instagram',
          type: 'tag',
          platformMentionId: mentionId,
          author: post.username || 'Unknown',
          text: post.caption || '',
          mediaUrl: post.media_url || null,
          mediaType: post.media_type || 'IMAGE',
          permalink: post.permalink || null,
          mentionedAt: post.timestamp ? new Date(post.timestamp) : new Date()
        });
      }
    }
  } catch (err) {
    console.warn('[social-mentions] IG tags error:', err.message);
  }

  // 2. Mentioned media (stories/posts that @mention the account)
  try {
    const mentionRes = await fetch(
      `${FB_API}/${igAccountId}/mentioned_media?fields=id,caption,media_type,media_url,permalink,timestamp&limit=25&access_token=${accessToken}`
    );
    const mentionData = await mentionRes.json();

    if (mentionData.data) {
      for (const post of mentionData.data) {
        const mentionId = `ig_mention_${post.id}`;
        if (existingIds.has(mentionId)) continue;

        mentions.push({
          platform: 'instagram',
          type: 'mention',
          platformMentionId: mentionId,
          author: 'Unknown', // mentioned_media doesn't return username
          text: post.caption || '',
          mediaUrl: post.media_url || null,
          mediaType: post.media_type || 'IMAGE',
          permalink: post.permalink || null,
          mentionedAt: post.timestamp ? new Date(post.timestamp) : new Date()
        });
      }
    }
  } catch (err) {
    console.warn('[social-mentions] IG mentions error:', err.message);
  }

  return mentions;
}


// ── Facebook: fetch page mentions and tagged posts ──────────────

async function fetchFacebookMentions(account, existingIds) {
  const { accessToken, pageId } = account;
  if (!pageId) return [];

  const mentions = [];

  // 1. Posts that tag the page
  try {
    const taggedRes = await fetch(
      `${FB_API}/${pageId}/tagged?fields=id,message,from{name,id},created_time,permalink_url,type&limit=25&access_token=${accessToken}`
    );
    const taggedData = await taggedRes.json();

    if (taggedData.data) {
      for (const post of taggedData.data) {
        const mentionId = `fb_tag_${post.id}`;
        if (existingIds.has(mentionId)) continue;

        mentions.push({
          platform: 'facebook',
          type: 'tag',
          platformMentionId: mentionId,
          author: post.from ? post.from.name : 'Unknown',
          authorId: post.from ? post.from.id : null,
          text: post.message || '',
          permalink: post.permalink_url || null,
          mentionedAt: post.created_time ? new Date(post.created_time) : new Date()
        });
      }
    }
  } catch (err) {
    console.warn('[social-mentions] FB tags error:', err.message);
  }

  return mentions;
}


// ── List mentions ───────────────────────────────────────────────

async function listMentions(db, params) {
  const days = parseInt(params.days) || 30;
  const since = new Date();
  since.setDate(since.getDate() - days);

  const type = params.type; // 'tag', 'mention', or all
  const platform = params.platform; // 'instagram', 'facebook', or all

  let query = db.collection(MENTIONS_COLLECTION)
    .where('mentionedAt', '>=', since)
    .orderBy('mentionedAt', 'desc')
    .limit(100);

  const snap = await query.get();

  let mentions = [];
  snap.forEach(doc => {
    const d = doc.data();
    // Client-side filter for type and platform (Firestore compound index limitations)
    if (type && d.type !== type) return;
    if (platform && d.platform !== platform) return;
    mentions.push({
      id: doc.id,
      ...d,
      mentionedAt: d.mentionedAt?.toDate ? d.mentionedAt.toDate().toISOString() : d.mentionedAt,
      createdAt: d.createdAt?.toDate ? d.createdAt.toDate().toISOString() : d.createdAt
    });
  });

  const unread = mentions.filter(m => !m.read).length;

  // Load config for last refresh time
  const config = await loadConfig(db);

  return jsonResponse(200, {
    ok: true,
    mentions,
    unread,
    lastRefresh: config.lastRefresh?.toDate ? config.lastRefresh.toDate().toISOString() : null,
    keywords: config.keywords || DEFAULT_KEYWORDS
  });
}


// ── Mention stats ───────────────────────────────────────────────

async function getMentionStats(db, params) {
  const days = parseInt(params.days) || 30;
  const since = new Date();
  since.setDate(since.getDate() - days);

  const snap = await db.collection(MENTIONS_COLLECTION)
    .where('mentionedAt', '>=', since)
    .get();

  const stats = {
    total: 0,
    byPlatform: {},
    byType: {},
    byDay: {},
    topMentioners: {}
  };

  snap.forEach(doc => {
    const d = doc.data();
    stats.total++;

    // By platform
    stats.byPlatform[d.platform] = (stats.byPlatform[d.platform] || 0) + 1;

    // By type
    stats.byType[d.type] = (stats.byType[d.type] || 0) + 1;

    // By day
    const date = d.mentionedAt?.toDate ? d.mentionedAt.toDate() : new Date(d.mentionedAt);
    const dayStr = date.toISOString().split('T')[0];
    stats.byDay[dayStr] = (stats.byDay[dayStr] || 0) + 1;

    // Top mentioners
    if (d.author && d.author !== 'Unknown') {
      stats.topMentioners[d.author] = (stats.topMentioners[d.author] || 0) + 1;
    }
  });

  // Sort top mentioners
  const sortedMentioners = Object.entries(stats.topMentioners)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }));

  return jsonResponse(200, {
    ok: true,
    stats: {
      ...stats,
      topMentioners: sortedMentioners
    }
  });
}


// ── Mark mentions as read ───────────────────────────────────────

async function markMentionsRead(db, body) {
  const { ids } = body;
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return jsonResponse(400, { ok: false, error: 'Missing ids array' });
  }

  const batch = db.batch();
  ids.forEach(id => {
    batch.update(db.collection(MENTIONS_COLLECTION).doc(id), {
      read: true,
      readAt: serverTimestamp()
    });
  });
  await batch.commit();

  return jsonResponse(200, { ok: true, marked: ids.length });
}


// ── Update monitored keywords ───────────────────────────────────

async function updateKeywords(db, body) {
  const { keywords } = body;
  if (!keywords || !Array.isArray(keywords)) {
    return jsonResponse(400, { ok: false, error: 'Missing keywords array' });
  }

  await db.doc(CONFIG_DOC_PATH).set({
    keywords: keywords.filter(k => k.trim()),
    updatedAt: serverTimestamp()
  }, { merge: true });

  return jsonResponse(200, { ok: true, keywords });
}


// ── Helpers ─────────────────────────────────────────────────────

async function loadAccounts(db) {
  const snap = await db.collection(ACCOUNTS_COLLECTION).get();
  const accounts = {};
  snap.forEach(doc => { accounts[doc.id] = doc.data(); });
  return accounts;
}

async function loadConfig(db) {
  try {
    const doc = await db.doc(CONFIG_DOC_PATH).get();
    return doc.exists ? doc.data() : {};
  } catch (e) {
    return {};
  }
}
