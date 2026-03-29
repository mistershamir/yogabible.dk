/**
 * Social Inbox API — Yoga Bible
 * Unified inbox for comments and conversations across social platforms.
 *
 * GET  /.netlify/functions/social-inbox?action=comments[&days=7]
 * GET  /.netlify/functions/social-inbox?action=conversations
 * GET  /.netlify/functions/social-inbox?action=thread&id=X&platform=Y
 * POST /.netlify/functions/social-inbox  { action: 'reply-comment', commentId, text, platform }
 * POST /.netlify/functions/social-inbox  { action: 'reply-message', conversationId, text, platform }
 * POST /.netlify/functions/social-inbox  { action: 'mark-read', ids: [...] }
 * POST /.netlify/functions/social-inbox  { action: 'analyze-sentiment', items: [...] }
 */

const { getDb, serverTimestamp } = require('./shared/firestore');
const { requireAuth } = require('./shared/auth');
const { jsonResponse, optionsResponse } = require('./shared/utils');
const {
  getInstagramComments,
  replyToInstagramComment,
  getFacebookComments,
  replyToFacebookComment,
  getInstagramConversations,
  getFacebookConversations,
  sendFacebookMessage
} = require('./shared/social-api');

const POSTS_COLLECTION = 'social_posts';
const ACCOUNTS_COLLECTION = 'social_accounts';
const INBOX_COLLECTION = 'social_inbox';

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  const user = await requireAuth(event, ['admin']);
  if (user.error) return user.error;

  const params = event.queryStringParameters || {};
  const db = getDb();

  try {
    if (event.httpMethod === 'GET') {
      const action = params.action || 'comments';

      switch (action) {
        case 'comments': return getCommentsInbox(db, params);
        case 'conversations': return getConversationsInbox(db);
        case 'thread': return getThread(db, params);
        default:
          return jsonResponse(400, { ok: false, error: `Unknown action: ${action}` });
      }
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const action = body.action || params.action;

      switch (action) {
        case 'reply-comment': return replyToComment(db, body);
        case 'reply-message': return replyToMessage(db, body);
        case 'mark-read': return markRead(db, body);
        case 'analyze-sentiment': return analyzeSentimentBatch(db, body);
        default:
          return jsonResponse(400, { ok: false, error: `Unknown action: ${action}` });
      }
    }

    return jsonResponse(405, { ok: false, error: 'Method not allowed' });
  } catch (err) {
    console.error('[social-inbox] Error:', err);
    return jsonResponse(500, { ok: false, error: err.message });
  }
};


// ── Comments Inbox: fetch comments from all published posts ─────

async function getCommentsInbox(db, params) {
  const days = parseInt(params.days) || 7;
  const since = new Date();
  since.setDate(since.getDate() - days);

  // Load connected accounts
  const accounts = await loadAccounts(db);
  if (Object.keys(accounts).length === 0) {
    return jsonResponse(200, { ok: true, comments: [], message: 'No connected accounts' });
  }

  // Get recently published posts
  let postsSnap;
  try {
    postsSnap = await db.collection(POSTS_COLLECTION)
      .where('status', '==', 'published')
      .where('publishedAt', '>=', since)
      .orderBy('publishedAt', 'desc')
      .limit(50)
      .get();
  } catch (err) {
    postsSnap = await db.collection(POSTS_COLLECTION)
      .where('status', '==', 'published')
      .orderBy('publishedAt', 'desc')
      .limit(50)
      .get();
  }

  if (postsSnap.empty) {
    return jsonResponse(200, { ok: true, comments: [] });
  }

  // Load read status from Firestore
  const readSnap = await db.collection(INBOX_COLLECTION)
    .where('type', '==', 'comment')
    .get();
  const readIds = new Set();
  readSnap.forEach(doc => {
    if (doc.data().read) readIds.add(doc.id);
  });

  const allComments = [];

  for (const doc of postsSnap.docs) {
    const post = doc.data();
    const publishResults = post.publishResults || {};
    const caption = (post.caption || '').substring(0, 60);

    // Build a list of platform→postId pairs to fetch comments for
    const platformPostIds = [];

    // From publishResults (posts published via our system)
    for (const [platform, result] of Object.entries(publishResults)) {
      if (platform.startsWith('_') || !result.success || !result.id) continue;
      platformPostIds.push({ platform, platformPostId: result.id });
    }

    // From imported posts (imported from IG/FB)
    if (post.importedPlatformId && post.platforms && post.platforms.length > 0) {
      const platform = post.platforms[0];
      // Avoid duplicates
      if (!platformPostIds.find(p => p.platformPostId === post.importedPlatformId)) {
        platformPostIds.push({ platform, platformPostId: post.importedPlatformId });
      }
    }

    for (const { platform, platformPostId } of platformPostIds) {
      const account = accounts[platform];
      if (!account || !account.accessToken) continue;

      try {
        let commentsData;

        if (platform === 'instagram') {
          commentsData = await getInstagramComments(
            { accessToken: account.accessToken },
            platformPostId
          );
        } else if (platform === 'facebook') {
          commentsData = await getFacebookComments(
            { accessToken: account.accessToken },
            platformPostId
          );
        }

        if (commentsData && commentsData.success) {
          (commentsData.comments || []).forEach(c => {
            const commentId = `${platform}_${c.id}`;
            allComments.push({
              id: commentId,
              commentId: c.id,
              platform,
              postId: doc.id,
              postCaption: caption,
              platformPostId: platformPostId,
              text: c.text || c.message || '',
              author: c.username || (c.from ? c.from.name : 'Unknown'),
              authorId: c.from ? c.from.id : null,
              timestamp: c.timestamp || c.created_time,
              replies: (c.replies ? c.replies.data : (c.comments ? c.comments.data : [])) || [],
              read: readIds.has(commentId),
              type: 'comment'
            });
          });
        }
      } catch (err) {
        console.warn(`[social-inbox] Comments error for ${platform}/${doc.id}:`, err.message);
      }
    }
  }

  // ── Second pass: fetch comments from page-level posts (includes ads) ──
  // This catches ad posts and any organic posts not tracked in social_posts
  const seenPlatformPostIds = new Set(
    allComments.map(c => c.platformPostId)
  );

  for (const [platform, account] of Object.entries(accounts)) {
    if (!account.accessToken) continue;

    try {
      let pagePostIds = [];

      if (platform === 'instagram' && account.igAccountId) {
        // Fetch recent IG media (includes promoted/boosted posts)
        const igUrl = `https://graph.facebook.com/v21.0/${account.igAccountId}/media?fields=id,caption,timestamp,media_type&limit=50&access_token=${account.accessToken}`;
        const igRes = await fetch(igUrl);
        const igData = await igRes.json();
        if (igData.data) {
          pagePostIds = igData.data
            .filter(m => {
              const ts = new Date(m.timestamp || 0);
              return ts >= since && !seenPlatformPostIds.has(m.id);
            })
            .map(m => ({ id: m.id, caption: (m.caption || '').substring(0, 60) }));
        }

        // Also fetch ad posts with comments via the page's ads
        if (account.pageId) {
          try {
            const adUrl = `https://graph.facebook.com/v21.0/${account.pageId}/ads_posts?fields=id,message,created_time,is_published&limit=30&access_token=${account.accessToken}`;
            const adRes = await fetch(adUrl);
            const adData = await adRes.json();
            if (adData.data) {
              const adPostIds = adData.data
                .filter(p => {
                  const ts = new Date(p.created_time || 0);
                  return ts >= since && !seenPlatformPostIds.has(p.id);
                })
                .map(p => ({ id: p.id, caption: (p.message || 'Ad').substring(0, 60), isAd: true }));
              // These are FB ad posts — fetch as facebook comments
              for (const adPost of adPostIds) {
                if (seenPlatformPostIds.has(adPost.id)) continue;
                seenPlatformPostIds.add(adPost.id);
                try {
                  const commentsData = await getFacebookComments({ accessToken: account.accessToken }, adPost.id);
                  if (commentsData && commentsData.success) {
                    (commentsData.comments || []).forEach(c => {
                      const commentId = `facebook_${c.id}`;
                      if (allComments.find(x => x.id === commentId)) return;
                      allComments.push({
                        id: commentId,
                        commentId: c.id,
                        platform: 'facebook',
                        postId: null,
                        postCaption: '📢 ' + adPost.caption,
                        platformPostId: adPost.id,
                        text: c.message || '',
                        author: c.from ? c.from.name : 'Unknown',
                        authorId: c.from ? c.from.id : null,
                        timestamp: c.created_time,
                        replies: (c.comments ? c.comments.data : []) || [],
                        read: readIds.has(commentId),
                        type: 'comment',
                        isAd: true
                      });
                    });
                  }
                } catch (e) { /* skip individual ad post errors */ }
              }
            }
          } catch (e) {
            console.warn('[social-inbox] Ad posts fetch error:', e.message);
          }
        }

        // Fetch IG comments for page-level posts not already seen
        for (const post of pagePostIds) {
          if (seenPlatformPostIds.has(post.id)) continue;
          seenPlatformPostIds.add(post.id);
          try {
            const commentsData = await getInstagramComments({ accessToken: account.accessToken }, post.id);
            if (commentsData && commentsData.success && commentsData.comments.length > 0) {
              commentsData.comments.forEach(c => {
                const commentId = `instagram_${c.id}`;
                if (allComments.find(x => x.id === commentId)) return;
                allComments.push({
                  id: commentId,
                  commentId: c.id,
                  platform: 'instagram',
                  postId: null,
                  postCaption: post.caption,
                  platformPostId: post.id,
                  text: c.text || '',
                  author: c.username || 'Unknown',
                  authorId: null,
                  timestamp: c.timestamp,
                  replies: (c.replies ? c.replies.data : []) || [],
                  read: readIds.has(commentId),
                  type: 'comment'
                });
              });
            }
          } catch (e) { /* skip individual post errors */ }
        }

      } else if (platform === 'facebook' && account.pageId) {
        // Fetch recent FB page posts (includes organic + boosted + ads)
        const fbUrl = `https://graph.facebook.com/v21.0/${account.pageId}/published_posts?fields=id,message,created_time&limit=50&access_token=${account.accessToken}`;
        const fbRes = await fetch(fbUrl);
        const fbData = await fbRes.json();
        if (fbData.data) {
          pagePostIds = fbData.data
            .filter(p => {
              const ts = new Date(p.created_time || 0);
              return ts >= since && !seenPlatformPostIds.has(p.id);
            })
            .map(p => ({ id: p.id, caption: (p.message || '').substring(0, 60) }));
        }

        // Also fetch ad posts specifically
        try {
          const adUrl = `https://graph.facebook.com/v21.0/${account.pageId}/ads_posts?fields=id,message,created_time,is_published&limit=30&access_token=${account.accessToken}`;
          const adRes = await fetch(adUrl);
          const adData = await adRes.json();
          if (adData.data) {
            adData.data.forEach(p => {
              const ts = new Date(p.created_time || 0);
              if (ts >= since && !seenPlatformPostIds.has(p.id)) {
                pagePostIds.push({ id: p.id, caption: '📢 ' + (p.message || 'Ad').substring(0, 60), isAd: true });
              }
            });
          }
        } catch (e) {
          console.warn('[social-inbox] FB ad posts fetch error:', e.message);
        }

        for (const post of pagePostIds) {
          if (seenPlatformPostIds.has(post.id)) continue;
          seenPlatformPostIds.add(post.id);
          try {
            const commentsData = await getFacebookComments({ accessToken: account.accessToken }, post.id);
            if (commentsData && commentsData.success && commentsData.comments.length > 0) {
              commentsData.comments.forEach(c => {
                const commentId = `facebook_${c.id}`;
                if (allComments.find(x => x.id === commentId)) return;
                allComments.push({
                  id: commentId,
                  commentId: c.id,
                  platform: 'facebook',
                  postId: null,
                  postCaption: post.caption,
                  platformPostId: post.id,
                  text: c.message || '',
                  author: c.from ? c.from.name : 'Unknown',
                  authorId: c.from ? c.from.id : null,
                  timestamp: c.created_time,
                  replies: (c.comments ? c.comments.data : []) || [],
                  read: readIds.has(commentId),
                  type: 'comment',
                  isAd: post.isAd || false
                });
              });
            }
          } catch (e) { /* skip individual post errors */ }
        }
      }
    } catch (err) {
      console.warn(`[social-inbox] Page-level comments error for ${platform}:`, err.message);
    }
  }

  // Sort by timestamp (newest first)
  allComments.sort((a, b) => {
    const ta = new Date(a.timestamp || 0);
    const tb = new Date(b.timestamp || 0);
    return tb - ta;
  });

  return jsonResponse(200, {
    ok: true,
    comments: allComments,
    unread: allComments.filter(c => !c.read).length
  });
}


// ── Conversations Inbox: fetch DMs from all platforms ────────────

async function getConversationsInbox(db) {
  const accounts = await loadAccounts(db);
  if (Object.keys(accounts).length === 0) {
    return jsonResponse(200, { ok: true, conversations: [] });
  }

  // Load read status
  const readSnap = await db.collection(INBOX_COLLECTION)
    .where('type', '==', 'conversation')
    .get();
  const readIds = new Set();
  readSnap.forEach(doc => {
    if (doc.data().read) readIds.add(doc.id);
  });

  const allConversations = [];

  for (const [platform, account] of Object.entries(accounts)) {
    if (!account.accessToken) continue;

    try {
      let convData;

      if (platform === 'instagram' && account.igAccountId) {
        convData = await getInstagramConversations({
          accessToken: account.accessToken,
          igAccountId: account.igAccountId
        });
      } else if (platform === 'facebook' && account.pageId) {
        convData = await getFacebookConversations({
          accessToken: account.accessToken,
          pageId: account.pageId
        });
      }

      if (convData && convData.success) {
        (convData.conversations || []).forEach(conv => {
          const convId = `${platform}_${conv.id}`;
          const messages = conv.messages ? conv.messages.data || [] : [];
          const lastMsg = messages[0];
          const participants = conv.participants ? conv.participants.data || [] : [];

          allConversations.push({
            id: convId,
            conversationId: conv.id,
            platform,
            participants: participants.map(p => p.name || p.username || 'Unknown'),
            lastMessage: lastMsg ? (lastMsg.message || '') : '',
            lastMessageFrom: lastMsg && lastMsg.from ? lastMsg.from.name : '',
            lastMessageAt: lastMsg ? (lastMsg.created_time || '') : '',
            messageCount: messages.length,
            read: readIds.has(convId),
            type: 'conversation'
          });
        });
      }
    } catch (err) {
      console.warn(`[social-inbox] Conversations error for ${platform}:`, err.message);
    }
  }

  // Sort by last message time
  allConversations.sort((a, b) => {
    const ta = new Date(a.lastMessageAt || 0);
    const tb = new Date(b.lastMessageAt || 0);
    return tb - ta;
  });

  return jsonResponse(200, {
    ok: true,
    conversations: allConversations,
    unread: allConversations.filter(c => !c.read).length
  });
}


// ── Thread: get full comment thread or conversation messages ─────

async function getThread(db, params) {
  const { id, platform } = params;
  if (!id || !platform) {
    return jsonResponse(400, { ok: false, error: 'Missing id or platform' });
  }

  const accounts = await loadAccounts(db);
  const account = accounts[platform];
  if (!account || !account.accessToken) {
    return jsonResponse(400, { ok: false, error: `No account for ${platform}` });
  }

  // For comments, fetch replies
  if (params.type === 'comment') {
    try {
      let url;
      if (platform === 'instagram') {
        url = `https://graph.facebook.com/v21.0/${id}/replies?fields=id,text,username,timestamp&access_token=${account.accessToken}`;
      } else {
        url = `https://graph.facebook.com/v21.0/${id}/comments?fields=id,message,from,created_time&access_token=${account.accessToken}`;
      }
      const res = await fetch(url);
      const data = await res.json();
      if (data.error) return jsonResponse(200, { ok: true, thread: [] });
      return jsonResponse(200, { ok: true, thread: data.data || [] });
    } catch (err) {
      return jsonResponse(200, { ok: true, thread: [], error: err.message });
    }
  }

  // For conversations, fetch messages
  try {
    const url = `https://graph.facebook.com/v21.0/${id}?fields=messages{id,message,from,created_time}&access_token=${account.accessToken}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.error) return jsonResponse(200, { ok: true, thread: [] });
    return jsonResponse(200, { ok: true, thread: data.messages ? data.messages.data || [] : [] });
  } catch (err) {
    return jsonResponse(200, { ok: true, thread: [], error: err.message });
  }
}


// ── Reply to Comment ────────────────────────────────────────────

async function replyToComment(db, body) {
  const { commentId, text, platform } = body;
  if (!commentId || !text || !platform) {
    return jsonResponse(400, { ok: false, error: 'Missing commentId, text, or platform' });
  }

  const accounts = await loadAccounts(db);
  const account = accounts[platform];
  if (!account || !account.accessToken) {
    return jsonResponse(400, { ok: false, error: `No account for ${platform}` });
  }

  let result;
  if (platform === 'instagram') {
    result = await replyToInstagramComment({ accessToken: account.accessToken }, commentId, text);
  } else if (platform === 'facebook') {
    result = await replyToFacebookComment({ accessToken: account.accessToken }, commentId, text);
  } else {
    return jsonResponse(400, { ok: false, error: `Replies not supported for ${platform}` });
  }

  if (result && result.success) {
    return jsonResponse(200, { ok: true, replyId: result.id });
  }
  return jsonResponse(500, { ok: false, error: result?.error || 'Reply failed' });
}


// ── Reply to Message ────────────────────────────────────────────

async function replyToMessage(db, body) {
  const { conversationId, text, platform } = body;
  if (!conversationId || !text || !platform) {
    return jsonResponse(400, { ok: false, error: 'Missing conversationId, text, or platform' });
  }

  const accounts = await loadAccounts(db);
  const account = accounts[platform];
  if (!account || !account.accessToken) {
    return jsonResponse(400, { ok: false, error: `No account for ${platform}` });
  }

  if (platform === 'facebook') {
    const result = await sendFacebookMessage({ accessToken: account.accessToken }, conversationId, text);
    if (result && result.success) {
      return jsonResponse(200, { ok: true, messageId: result.id });
    }
    return jsonResponse(500, { ok: false, error: result?.error || 'Send failed' });
  }

  return jsonResponse(400, { ok: false, error: `DM replies not yet supported for ${platform}` });
}


// ── Mark Read ───────────────────────────────────────────────────

async function markRead(db, body) {
  const { ids } = body;
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return jsonResponse(400, { ok: false, error: 'Missing ids array' });
  }

  const batch = db.batch();
  ids.forEach(id => {
    batch.set(db.collection(INBOX_COLLECTION).doc(id), {
      read: true,
      type: id.includes('conv_') ? 'conversation' : 'comment',
      readAt: serverTimestamp()
    }, { merge: true });
  });

  await batch.commit();
  return jsonResponse(200, { ok: true, marked: ids.length });
}


// ── Analyze Sentiment (batch) ──────────────────────────────────

async function analyzeSentimentBatch(db, body) {
  const { items } = body;
  if (!Array.isArray(items) || items.length === 0) {
    return jsonResponse(400, { ok: false, error: 'Missing items array' });
  }

  // Call the social-ai endpoint for sentiment analysis
  const https = require('https');

  const aiBody = JSON.stringify({
    action: 'analyze-sentiment',
    items: items.slice(0, 20)
  });

  // Internal call to social-ai
  const { claudeRequest, parseJsonResponse } = require('./shared/social-ai-helpers');

  const prompt = `Analyze the sentiment of these social media comments/messages. For each item, return:
- sentiment: "positive", "negative", "neutral", or "question"
- intent: "praise", "complaint", "purchase_intent", "support_request", "spam", "question", "feedback", or "other"
- urgency: "high", "medium", or "low" (high = needs immediate response)
- summary: 1-sentence summary
- suggested_action: brief recommended action

Items to analyze:
${items.slice(0, 20).map((item, i) => `${i + 1}. [${item.platform || 'unknown'}] ${item.author || 'Unknown'}: "${(item.text || '').substring(0, 300)}"`).join('\n')}

Return JSON: { "results": [ { "index": 0, "sentiment": "...", "intent": "...", "urgency": "...", "summary": "...", "suggested_action": "..." } ] }`;

  try {
    const aiResult = await callClaude(prompt);
    const parsed = parseAiJson(aiResult);

    // Store sentiment data in Firestore for items with high urgency or negative sentiment
    const alerts = [];
    if (parsed && parsed.results) {
      for (const r of parsed.results) {
        if (r.urgency === 'high' || r.sentiment === 'negative' || r.intent === 'purchase_intent') {
          const item = items[r.index];
          if (item) {
            alerts.push({
              ...r,
              text: (item.text || '').substring(0, 200),
              author: item.author || 'Unknown',
              platform: item.platform || 'unknown',
              inboxId: item.id || null
            });
          }
        }
      }

      // Store alerts for Telegram notification pickup
      if (alerts.length > 0) {
        await db.collection('social_sentiment_alerts').add({
          alerts,
          createdAt: serverTimestamp(),
          notified: false
        });
      }
    }

    return jsonResponse(200, {
      ok: true,
      results: parsed ? parsed.results : [],
      alertCount: alerts.length
    });
  } catch (err) {
    console.error('[social-inbox] Sentiment analysis error:', err);
    return jsonResponse(200, { ok: true, results: [], error: err.message });
  }
}

// Lightweight Claude call for sentiment (avoids circular dependency with social-ai)
function callClaude(prompt) {
  const https = require('https');
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }]
    });

    const opts = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY || '',
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const text = parsed.content?.[0]?.text || '';
          resolve(text);
        } catch (e) {
          reject(new Error('Failed to parse AI response'));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function parseAiJson(text) {
  try {
    // Strip markdown fences if present
    const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    return JSON.parse(cleaned);
  } catch (e) {
    return null;
  }
}


// ── Helper: load connected accounts ─────────────────────────────

async function loadAccounts(db) {
  const snap = await db.collection(ACCOUNTS_COLLECTION).get();
  const accounts = {};
  snap.forEach(doc => {
    accounts[doc.id] = doc.data();
  });
  return accounts;
}
