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

  // Order by scheduledAt first, fallback to createdAt
  query = query.orderBy('scheduledAt', 'desc').limit(100);

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
    contentPillar
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
    'contentPillar', 'evergreenCandidate'
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
