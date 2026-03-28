/**
 * Social Posts CRUD API — Yoga Bible
 * Admin-only CRUD for the social_posts Firestore collection.
 *
 * GET  /.netlify/functions/social-posts?action=list[&status=&platform=&from=&to=]
 * GET  /.netlify/functions/social-posts?action=get&id=X
 * POST /.netlify/functions/social-posts  { action: 'create', ... }
 * POST /.netlify/functions/social-posts  { action: 'update', id, ... }
 * POST /.netlify/functions/social-posts  { action: 'delete', id }
 * POST /.netlify/functions/social-posts  { action: 'bulk-delete', ids[] }
 */

const { getDb, serverTimestamp } = require('./shared/firestore');
const { requireAuth } = require('./shared/auth');
const { jsonResponse, optionsResponse } = require('./shared/utils');

const COLLECTION = 'social_posts';
const ANALYTICS_SUB = 'social_analytics';
const VALID_STATUSES = ['draft', 'pending_review', 'approved', 'scheduled', 'published', 'failed', 'recycled'];
const VALID_PLATFORMS = ['instagram', 'facebook', 'tiktok', 'linkedin', 'youtube', 'pinterest'];

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  const user = await requireAuth(event, ['admin']);
  if (user.error) return user.error;

  const params = event.queryStringParameters || {};
  const db = getDb();

  try {
    if (event.httpMethod === 'GET') {
      const action = params.action || 'list';
      if (action === 'get') return getPost(db, params.id);
      return listPosts(db, params);
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const action = body.action || params.action;

      switch (action) {
        case 'create': return createPost(db, body, user);
        case 'update': return updatePost(db, body);
        case 'delete': return deletePost(db, body.id);
        case 'bulk-delete': return bulkDeletePosts(db, body.ids);
        case 'bulk-update': return bulkUpdatePosts(db, body.ids, body.fields);
        case 'bulk-duplicate': return bulkDuplicatePosts(db, body.ids, user);
        case 'import-from-platform': return importFromPlatform(db, body, user);
        default:
          return jsonResponse(400, { ok: false, error: `Unknown action: ${action}` });
      }
    }

    return jsonResponse(405, { ok: false, error: 'Method not allowed' });
  } catch (err) {
    console.error('[social-posts] Error:', err);
    return jsonResponse(500, { ok: false, error: err.message });
  }
};


// ── List posts with filters ─────────────────────────────────────

async function listPosts(db, params) {
  let query = db.collection(COLLECTION);

  if (params.status && VALID_STATUSES.includes(params.status)) {
    query = query.where('status', '==', params.status);
  }

  if (params.platform && VALID_PLATFORMS.includes(params.platform)) {
    query = query.where('platforms', 'array-contains', params.platform);
  }

  if (params.from) {
    const fromDate = new Date(params.from);
    if (!isNaN(fromDate)) {
      query = query.where('scheduledAt', '>=', fromDate);
    }
  }

  if (params.to) {
    const toDate = new Date(params.to);
    if (!isNaN(toDate)) {
      query = query.where('scheduledAt', '<=', toDate);
    }
  }

  // Order by createdAt (all docs have this field, unlike scheduledAt)
  query = query.orderBy('createdAt', 'desc').limit(100);

  let snap;
  try {
    snap = await query.get();
  } catch (indexErr) {
    // If composite index missing, fall back to simpler query
    console.warn('[social-posts] Index fallback:', indexErr.message);
    snap = await db.collection(COLLECTION)
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get();
  }

  const posts = [];
  snap.forEach(doc => {
    const data = doc.data();
    posts.push({
      id: doc.id,
      ...data,
      scheduledAt: data.scheduledAt?.toDate?.() || data.scheduledAt || null,
      publishedAt: data.publishedAt?.toDate?.() || data.publishedAt || null,
      createdAt: data.createdAt?.toDate?.() || data.createdAt || null,
      updatedAt: data.updatedAt?.toDate?.() || data.updatedAt || null
    });
  });

  return jsonResponse(200, { ok: true, posts });
}


// ── Get single post with analytics ──────────────────────────────

async function getPost(db, id) {
  if (!id) return jsonResponse(400, { ok: false, error: 'Missing id parameter' });

  const doc = await db.collection(COLLECTION).doc(id).get();
  if (!doc.exists) return jsonResponse(404, { ok: false, error: 'Post not found' });

  const data = doc.data();

  // Fetch analytics subcollection
  const analyticsSnap = await db.collection(COLLECTION).doc(id)
    .collection(ANALYTICS_SUB).get();
  const analytics = [];
  analyticsSnap.forEach(aDoc => {
    analytics.push({ id: aDoc.id, ...aDoc.data() });
  });

  return jsonResponse(200, {
    ok: true,
    post: {
      id: doc.id,
      ...data,
      scheduledAt: data.scheduledAt?.toDate?.() || data.scheduledAt || null,
      publishedAt: data.publishedAt?.toDate?.() || data.publishedAt || null,
      createdAt: data.createdAt?.toDate?.() || data.createdAt || null,
      updatedAt: data.updatedAt?.toDate?.() || data.updatedAt || null
    },
    analytics
  });
}


// ── Create new post ─────────────────────────────────────────────

async function createPost(db, body, user) {
  const {
    caption, platforms, media, hashtags, hashtagSet,
    status, scheduledAt, firstComment, location, altTexts, mediaType,
    contentPillar, platformCaptions
  } = body;

  if (!caption && (!media || media.length === 0)) {
    return jsonResponse(400, { ok: false, error: 'Post must have a caption or media' });
  }

  const postStatus = status && VALID_STATUSES.includes(status) ? status : 'draft';

  const postData = {
    caption: caption || '',
    platforms: Array.isArray(platforms) ? platforms.filter(p => VALID_PLATFORMS.includes(p)) : [],
    media: Array.isArray(media) ? media : [],
    hashtags: Array.isArray(hashtags) ? hashtags : [],
    hashtagSet: hashtagSet || null,
    status: postStatus,
    scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
    publishedAt: null,
    publishResults: {},
    firstComment: firstComment || '',
    location: location || '',
    altTexts: altTexts || {},
    mediaType: mediaType || 'auto',
    contentPillar: contentPillar || '',
    platformCaptions: platformCaptions || {},
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: user.email
  };

  const ref = await db.collection(COLLECTION).add(postData);
  console.log('[social-posts] Created:', ref.id);

  return jsonResponse(201, { ok: true, id: ref.id });
}


// ── Update existing post ────────────────────────────────────────

async function updatePost(db, body) {
  const { id, ...fields } = body;
  if (!id) return jsonResponse(400, { ok: false, error: 'Missing post id' });

  const docRef = db.collection(COLLECTION).doc(id);
  const doc = await docRef.get();
  if (!doc.exists) return jsonResponse(404, { ok: false, error: 'Post not found' });

  // Only allow updating known fields
  const allowed = [
    'caption', 'platforms', 'media', 'hashtags', 'hashtagSet',
    'status', 'scheduledAt', 'firstComment', 'location', 'altTexts', 'mediaType',
    'approvedBy', 'approvedAt', 'recycleConfig', 'videoThumbnails', 'adSuggestion',
    'contentPillar', 'evergreenCandidate', 'platformCaptions'
  ];

  const update = { updatedAt: serverTimestamp() };

  for (const key of allowed) {
    if (fields[key] !== undefined) {
      if (key === 'scheduledAt' && fields[key]) {
        update[key] = new Date(fields[key]);
      } else if (key === 'platforms' && Array.isArray(fields[key])) {
        update[key] = fields[key].filter(p => VALID_PLATFORMS.includes(p));
      } else if (key === 'status' && VALID_STATUSES.includes(fields[key])) {
        update[key] = fields[key];
      } else if (key !== 'status' && key !== 'platforms') {
        update[key] = fields[key];
      }
    }
  }

  await docRef.update(update);
  console.log('[social-posts] Updated:', id);

  return jsonResponse(200, { ok: true, id });
}


// ── Delete single post ──────────────────────────────────────────

async function deletePost(db, id) {
  if (!id) return jsonResponse(400, { ok: false, error: 'Missing post id' });

  const docRef = db.collection(COLLECTION).doc(id);
  const doc = await docRef.get();
  if (!doc.exists) return jsonResponse(404, { ok: false, error: 'Post not found' });

  // Delete analytics subcollection
  const analyticsSnap = await docRef.collection(ANALYTICS_SUB).get();
  if (!analyticsSnap.empty) {
    const batch = db.batch();
    analyticsSnap.forEach(aDoc => batch.delete(aDoc.ref));
    await batch.commit();
  }

  await docRef.delete();
  console.log('[social-posts] Deleted:', id);

  return jsonResponse(200, { ok: true, deleted: id });
}


// ── Bulk delete posts ───────────────────────────────────────────

async function bulkDeletePosts(db, ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    return jsonResponse(400, { ok: false, error: 'Missing ids array' });
  }

  const deleted = [];
  const errors = [];

  for (const id of ids) {
    try {
      const docRef = db.collection(COLLECTION).doc(id);
      const doc = await docRef.get();
      if (!doc.exists) {
        errors.push({ id, error: 'Not found' });
        continue;
      }

      // Delete analytics subcollection
      const analyticsSnap = await docRef.collection(ANALYTICS_SUB).get();
      if (!analyticsSnap.empty) {
        const batch = db.batch();
        analyticsSnap.forEach(aDoc => batch.delete(aDoc.ref));
        await batch.commit();
      }

      await docRef.delete();
      deleted.push(id);
    } catch (err) {
      errors.push({ id, error: err.message });
    }
  }

  console.log('[social-posts] Bulk deleted:', deleted.length, 'errors:', errors.length);
  return jsonResponse(200, { ok: true, deleted, errors });
}


// ── Bulk update posts ──────────────────────────────────────────

async function bulkUpdatePosts(db, ids, fields) {
  if (!Array.isArray(ids) || ids.length === 0) {
    return jsonResponse(400, { ok: false, error: 'Missing ids array' });
  }
  if (!fields || typeof fields !== 'object') {
    return jsonResponse(400, { ok: false, error: 'Missing fields object' });
  }

  const ALLOWED = ['status', 'scheduledAt', 'platforms', 'approvedBy', 'approvedAt'];
  const updates = {};
  for (const key of Object.keys(fields)) {
    if (ALLOWED.includes(key)) {
      if (key === 'status' && !VALID_STATUSES.includes(fields[key])) continue;
      if (key === 'scheduledAt') { updates[key] = fields[key] ? new Date(fields[key]) : null; continue; }
      updates[key] = fields[key];
    }
  }
  updates.updatedAt = serverTimestamp();

  const updated = [];
  const errors = [];

  for (const id of ids) {
    try {
      const ref = db.collection(COLLECTION).doc(id);
      const doc = await ref.get();
      if (!doc.exists) { errors.push({ id, error: 'Not found' }); continue; }
      await ref.update(updates);
      updated.push(id);
    } catch (err) {
      errors.push({ id, error: err.message });
    }
  }

  console.log('[social-posts] Bulk updated:', updated.length, 'errors:', errors.length);
  return jsonResponse(200, { ok: true, updated, errors });
}


// ── Bulk duplicate posts ───────────────────────────────────────

async function bulkDuplicatePosts(db, ids, user) {
  if (!Array.isArray(ids) || ids.length === 0) {
    return jsonResponse(400, { ok: false, error: 'Missing ids array' });
  }

  const created = [];
  const errors = [];

  for (const id of ids) {
    try {
      const doc = await db.collection(COLLECTION).doc(id).get();
      if (!doc.exists) { errors.push({ id, error: 'Not found' }); continue; }
      const data = doc.data();
      const copy = {
        caption: data.caption || '',
        platforms: data.platforms || [],
        media: data.media || [],
        hashtags: data.hashtags || [],
        hashtagSet: data.hashtagSet || null,
        firstComment: data.firstComment || '',
        location: data.location || '',
        altTexts: data.altTexts || {},
        mediaType: data.mediaType || 'auto',
        status: 'draft',
        scheduledAt: null,
        publishedAt: null,
        publishResults: {},
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: user.email,
        duplicatedFrom: id
      };
      const ref = await db.collection(COLLECTION).add(copy);
      created.push(ref.id);
    } catch (err) {
      errors.push({ id, error: err.message });
    }
  }

  console.log('[social-posts] Bulk duplicated:', created.length, 'errors:', errors.length);
  return jsonResponse(200, { ok: true, created, errors });
}


// ── Import existing posts from Instagram/Facebook ─────────────────

async function importFromPlatform(db, body, user) {
  const { platform } = body;
  if (!platform || !['instagram', 'facebook'].includes(platform)) {
    return jsonResponse(400, { ok: false, error: 'Platform must be instagram or facebook' });
  }

  // Get account credentials
  const accountSnap = await db.collection('social_accounts').where('platform', '==', platform).limit(1).get();
  if (accountSnap.empty) {
    return jsonResponse(400, { ok: false, error: `No ${platform} account connected` });
  }

  const account = accountSnap.docs[0].data();
  const accessToken = account.accessToken;
  if (!accessToken) {
    return jsonResponse(400, { ok: false, error: `No access token for ${platform}` });
  }

  // Get existing imported post IDs to avoid duplicates
  const existingSnap = await db.collection(COLLECTION)
    .where('importedPlatformId', '!=', null)
    .get();
  const existingIds = new Set();
  existingSnap.forEach(doc => {
    const d = doc.data();
    if (d.importedPlatformId) existingIds.add(d.importedPlatformId);
  });

  let posts = [];

  try {
    if (platform === 'instagram') {
      // Fetch recent Instagram media
      const igAccountId = account.igAccountId || account.accountId || account.igBusinessAccountId;
      if (!igAccountId) return jsonResponse(400, { ok: false, error: 'Missing Instagram account ID' });

      // Use permalink for stable image references (media_url expires after ~1h)
      const url = `https://graph.facebook.com/v21.0/${igAccountId}/media?fields=id,caption,media_type,media_url,thumbnail_url,timestamp,permalink,like_count,comments_count&limit=50&access_token=${accessToken}`;
      const res = await fetch(url);
      const data = await res.json();

      if (data.error) {
        console.error('[social-posts] IG API error:', JSON.stringify(data.error));
        return jsonResponse(400, { ok: false, error: data.error.message });
      }

      posts = (data.data || []).map(m => ({
        platformId: m.id,
        caption: m.caption || '',
        media: m.media_type === 'VIDEO'
          ? [m.thumbnail_url || m.media_url || '']
          : [m.media_url || ''],
        mediaType: m.media_type === 'VIDEO' ? 'video' : 'image',
        publishedAt: m.timestamp,
        permalink: m.permalink || '',
        metrics: {
          likes: m.like_count || 0,
          comments: m.comments_count || 0
        }
      }));
    } else if (platform === 'facebook') {
      // Fetch recent Facebook page posts
      const pageId = account.pageId || account.accountId;
      if (!pageId) return jsonResponse(400, { ok: false, error: 'Missing Facebook page ID' });

      const url = `https://graph.facebook.com/v21.0/${pageId}/posts?fields=id,message,created_time,full_picture,permalink_url,shares,reactions.summary(true),comments.summary(true)&limit=50&access_token=${accessToken}`;
      const res = await fetch(url);
      const data = await res.json();

      if (data.error) {
        console.error('[social-posts] FB API error:', JSON.stringify(data.error));
        return jsonResponse(400, { ok: false, error: data.error.message });
      }

      posts = (data.data || []).map(p => ({
        platformId: p.id,
        caption: p.message || '',
        media: p.full_picture ? [p.full_picture] : [],
        mediaType: 'image',
        publishedAt: p.created_time,
        permalink: p.permalink_url || '',
        metrics: {
          likes: p.reactions ? p.reactions.summary.total_count : 0,
          comments: p.comments ? p.comments.summary.total_count : 0,
          shares: p.shares ? p.shares.count : 0
        }
      }));
    }
  } catch (err) {
    console.error(`[social-posts] Import ${platform} error:`, err);
    return jsonResponse(500, { ok: false, error: `Failed to fetch ${platform} posts: ${err.message}` });
  }

  // Filter out already-imported posts
  const newPosts = posts.filter(p => !existingIds.has(p.platformId));

  // Save new posts to Firestore
  let imported = 0;
  for (const p of newPosts) {
    try {
      const pubDate = p.publishedAt ? new Date(p.publishedAt) : new Date();
      await db.collection(COLLECTION).add({
        caption: p.caption,
        platforms: [platform],
        media: p.media,
        mediaType: p.mediaType,
        hashtags: (p.caption.match(/#\w+/g) || []),
        status: 'published',
        scheduledAt: pubDate,
        publishedAt: p.publishedAt,
        importedPlatformId: p.platformId,
        importedPermalink: p.permalink,
        importedMetrics: p.metrics,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: user.email,
        source: 'imported'
      });
      imported++;
    } catch (err) {
      console.error(`[social-posts] Import save error:`, err);
    }
  }

  console.log(`[social-posts] Imported ${imported} posts from ${platform}`);
  return jsonResponse(200, { ok: true, imported, total: posts.length, skipped: posts.length - imported });
}
