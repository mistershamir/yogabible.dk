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

    for (const [platform, result] of Object.entries(publishResults)) {
      if (platform.startsWith('_') || !result.success || !result.id) continue;

      const account = accounts[platform];
      if (!account || !account.accessToken) continue;

      try {
        let commentsData;

        if (platform === 'instagram') {
          commentsData = await getInstagramComments(
            { accessToken: account.accessToken },
            result.id
          );
        } else if (platform === 'facebook') {
          commentsData = await getFacebookComments(
            { accessToken: account.accessToken },
            result.id
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
              platformPostId: result.id,
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


// ── Helper: load connected accounts ─────────────────────────────

async function loadAccounts(db) {
  const snap = await db.collection(ACCOUNTS_COLLECTION).get();
  const accounts = {};
  snap.forEach(doc => {
    accounts[doc.id] = doc.data();
  });
  return accounts;
}
