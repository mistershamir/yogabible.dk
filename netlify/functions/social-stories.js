/**
 * Social Stories API — Yoga Bible
 * Story management, templates, scheduling, and highlights for Instagram & Facebook Stories.
 *
 * GET  /.netlify/functions/social-stories?action=list[&status=X]
 * GET  /.netlify/functions/social-stories?action=templates
 * GET  /.netlify/functions/social-stories?action=highlights
 * POST /.netlify/functions/social-stories  { action: 'create', ... }
 * POST /.netlify/functions/social-stories  { action: 'update', id, ... }
 * POST /.netlify/functions/social-stories  { action: 'delete', id }
 * POST /.netlify/functions/social-stories  { action: 'create-template', ... }
 * POST /.netlify/functions/social-stories  { action: 'update-template', id, ... }
 * POST /.netlify/functions/social-stories  { action: 'delete-template', id }
 * POST /.netlify/functions/social-stories  { action: 'create-from-template', templateId, ... }
 * POST /.netlify/functions/social-stories  { action: 'publish', id, platforms }
 * POST /.netlify/functions/social-stories  { action: 'save-highlight', ... }
 * POST /.netlify/functions/social-stories  { action: 'delete-highlight', id }
 */

const { getDb, serverTimestamp } = require('./shared/firestore');
const { requireAuth } = require('./shared/auth');
const { jsonResponse, optionsResponse } = require('./shared/utils');

const STORIES_COLLECTION = 'social_stories';
const TEMPLATES_COLLECTION = 'social_story_templates';
const HIGHLIGHTS_COLLECTION = 'social_story_highlights';

const VALID_STATUSES = ['draft', 'scheduled', 'published', 'expired', 'failed'];
const VALID_PLATFORMS = ['instagram', 'facebook'];

// Sticker types supported
const STICKER_TYPES = ['link', 'poll', 'countdown', 'mention', 'hashtag', 'location', 'question'];

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  const user = await requireAuth(event, ['admin']);
  if (user.error) return user.error;

  const params = event.queryStringParameters || {};
  const db = getDb();

  try {
    if (event.httpMethod === 'GET') {
      const action = params.action || 'list';
      if (action === 'list') return listStories(db, params);
      if (action === 'templates') return listTemplates(db);
      if (action === 'highlights') return listHighlights(db);
      return jsonResponse(400, { ok: false, error: `Unknown action: ${action}` });
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const action = body.action || params.action;

      switch (action) {
        case 'create': return createStory(db, body, user.email);
        case 'update': return updateStory(db, body);
        case 'delete': return deleteStory(db, body);
        case 'create-template': return createTemplate(db, body, user.email);
        case 'update-template': return updateTemplate(db, body);
        case 'delete-template': return deleteTemplate(db, body);
        case 'create-from-template': return createFromTemplate(db, body, user.email);
        case 'publish': return publishStory(db, body);
        case 'save-highlight': return saveHighlight(db, body, user.email);
        case 'delete-highlight': return deleteHighlight(db, body);
        default:
          return jsonResponse(400, { ok: false, error: `Unknown action: ${action}` });
      }
    }

    return jsonResponse(405, { ok: false, error: 'Method not allowed' });
  } catch (err) {
    console.error('[social-stories] Error:', err);
    return jsonResponse(500, { ok: false, error: err.message });
  }
};


// ── List stories ──────────────────────────────────────────────────────

async function listStories(db, params) {
  let query = db.collection(STORIES_COLLECTION).orderBy('createdAt', 'desc').limit(100);

  const snap = await query.get();
  let stories = [];
  snap.forEach(doc => {
    stories.push({ id: doc.id, ...doc.data() });
  });

  if (params.status) {
    stories = stories.filter(s => s.status === params.status);
  }

  // Mark expired stories (Stories last 24h)
  const now = Date.now();
  stories.forEach(s => {
    if (s.status === 'published' && s.publishedAt) {
      const pubTime = s.publishedAt._seconds ? s.publishedAt._seconds * 1000 : new Date(s.publishedAt).getTime();
      if (now - pubTime > 24 * 60 * 60 * 1000) {
        s.status = 'expired';
      }
    }
  });

  return jsonResponse(200, { ok: true, stories });
}


// ── Create story ──────────────────────────────────────────────────────

async function createStory(db, body, email) {
  const { media, caption, platforms, stickers, scheduledAt, linkUrl, linkText } = body;

  if (!media) return jsonResponse(400, { ok: false, error: 'Missing media (image or video URL)' });
  if (!platforms || !platforms.length) {
    return jsonResponse(400, { ok: false, error: 'At least one platform required' });
  }

  const invalidPlatforms = platforms.filter(p => !VALID_PLATFORMS.includes(p));
  if (invalidPlatforms.length) {
    return jsonResponse(400, { ok: false, error: `Invalid story platforms: ${invalidPlatforms.join(', ')}. Stories only supported on: ${VALID_PLATFORMS.join(', ')}` });
  }

  // Validate stickers
  if (stickers && stickers.length) {
    for (const sticker of stickers) {
      if (!STICKER_TYPES.includes(sticker.type)) {
        return jsonResponse(400, { ok: false, error: `Invalid sticker type: ${sticker.type}` });
      }
    }
  }

  const isVideo = /\.(mp4|mov|webm|avi|wmv)$/i.test(media);

  const data = {
    media,
    mediaType: isVideo ? 'VIDEO' : 'IMAGE',
    caption: caption || '',
    platforms,
    stickers: stickers || [],
    linkUrl: linkUrl || '',
    linkText: linkText || '',
    status: scheduledAt ? 'scheduled' : 'draft',
    scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
    publishedAt: null,
    publishResults: {},
    templateId: body.templateId || null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: email
  };

  const ref = await db.collection(STORIES_COLLECTION).add(data);
  return jsonResponse(200, { ok: true, id: ref.id });
}


// ── Update story ──────────────────────────────────────────────────────

async function updateStory(db, body) {
  const { id } = body;
  if (!id) return jsonResponse(400, { ok: false, error: 'Missing id' });

  const allowed = ['media', 'caption', 'platforms', 'stickers', 'scheduledAt', 'status', 'linkUrl', 'linkText'];
  const updates = { updatedAt: serverTimestamp() };

  for (const key of allowed) {
    if (body[key] !== undefined) {
      if (key === 'scheduledAt' && body[key]) {
        updates[key] = new Date(body[key]);
      } else if (key === 'media') {
        updates[key] = body[key];
        updates.mediaType = /\.(mp4|mov|webm|avi|wmv)$/i.test(body[key]) ? 'VIDEO' : 'IMAGE';
      } else {
        updates[key] = body[key];
      }
    }
  }

  await db.collection(STORIES_COLLECTION).doc(id).update(updates);
  return jsonResponse(200, { ok: true });
}


// ── Delete story ──────────────────────────────────────────────────────

async function deleteStory(db, body) {
  const { id } = body;
  if (!id) return jsonResponse(400, { ok: false, error: 'Missing id' });

  await db.collection(STORIES_COLLECTION).doc(id).delete();
  return jsonResponse(200, { ok: true });
}


// ── Publish story (calls social-api helpers) ──────────────────────────

async function publishStory(db, body) {
  const { id, platforms } = body;
  if (!id) return jsonResponse(400, { ok: false, error: 'Missing id' });

  const storyRef = db.collection(STORIES_COLLECTION).doc(id);
  const storyDoc = await storyRef.get();
  if (!storyDoc.exists) return jsonResponse(404, { ok: false, error: 'Story not found' });

  const story = storyDoc.data();
  const targetPlatforms = platforms || story.platforms || [];

  // Load account credentials
  const accountsSnap = await db.collection('social_accounts').get();
  const accounts = {};
  accountsSnap.forEach(doc => { accounts[doc.id] = doc.data(); });

  const results = {};
  const { publishStoryToInstagram, publishStoryToFacebook } = require('./shared/social-api');

  for (const platform of targetPlatforms) {
    const account = accounts[platform];
    if (!account || !account.accessToken) {
      results[platform] = { success: false, error: 'Not connected' };
      continue;
    }

    try {
      if (platform === 'instagram') {
        const result = await publishStoryToInstagram(account, story);
        results[platform] = { success: true, id: result.id };
      } else if (platform === 'facebook') {
        const result = await publishStoryToFacebook(account, story);
        results[platform] = { success: true, id: result.id };
      }
    } catch (err) {
      console.error(`[social-stories] ${platform} publish error:`, err.message);
      results[platform] = { success: false, error: err.message };
    }
  }

  const anySuccess = Object.values(results).some(r => r.success);
  await storyRef.update({
    publishResults: results,
    status: anySuccess ? 'published' : 'failed',
    publishedAt: anySuccess ? serverTimestamp() : null,
    updatedAt: serverTimestamp()
  });

  return jsonResponse(200, { ok: true, results });
}


// ── Templates ─────────────────────────────────────────────────────────

async function listTemplates(db) {
  const snap = await db.collection(TEMPLATES_COLLECTION)
    .orderBy('usageCount', 'desc')
    .limit(50)
    .get();

  const templates = [];
  snap.forEach(doc => {
    templates.push({ id: doc.id, ...doc.data() });
  });

  return jsonResponse(200, { ok: true, templates });
}

async function createTemplate(db, body, email) {
  const { name, category, media, caption, stickers, linkUrl, linkText, platforms } = body;
  if (!name) return jsonResponse(400, { ok: false, error: 'Missing name' });

  const ref = await db.collection(TEMPLATES_COLLECTION).add({
    name: name.trim(),
    category: category || 'general',
    media: media || '',
    caption: caption || '',
    stickers: stickers || [],
    linkUrl: linkUrl || '',
    linkText: linkText || '',
    platforms: platforms || ['instagram', 'facebook'],
    usageCount: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: email
  });

  return jsonResponse(200, { ok: true, id: ref.id });
}

async function updateTemplate(db, body) {
  const { id } = body;
  if (!id) return jsonResponse(400, { ok: false, error: 'Missing id' });

  const allowed = ['name', 'category', 'media', 'caption', 'stickers', 'linkUrl', 'linkText', 'platforms'];
  const updates = { updatedAt: serverTimestamp() };

  for (const key of allowed) {
    if (body[key] !== undefined) updates[key] = body[key];
  }

  await db.collection(TEMPLATES_COLLECTION).doc(id).update(updates);
  return jsonResponse(200, { ok: true });
}

async function deleteTemplate(db, body) {
  const { id } = body;
  if (!id) return jsonResponse(400, { ok: false, error: 'Missing id' });

  await db.collection(TEMPLATES_COLLECTION).doc(id).delete();
  return jsonResponse(200, { ok: true });
}

async function createFromTemplate(db, body, email) {
  const { templateId, scheduledAt, platforms, linkUrl, overrides } = body;
  if (!templateId) return jsonResponse(400, { ok: false, error: 'Missing templateId' });

  const tplDoc = await db.collection(TEMPLATES_COLLECTION).doc(templateId).get();
  if (!tplDoc.exists) return jsonResponse(404, { ok: false, error: 'Template not found' });

  const tpl = tplDoc.data();

  // Increment template usage
  await db.collection(TEMPLATES_COLLECTION).doc(templateId).update({
    usageCount: (tpl.usageCount || 0) + 1,
    lastUsedAt: serverTimestamp()
  });

  // Merge overrides
  const storyData = {
    media: (overrides && overrides.media) || tpl.media || '',
    caption: (overrides && overrides.caption) || tpl.caption || '',
    platforms: platforms || tpl.platforms || ['instagram', 'facebook'],
    stickers: (overrides && overrides.stickers) || tpl.stickers || [],
    linkUrl: linkUrl || tpl.linkUrl || '',
    linkText: (overrides && overrides.linkText) || tpl.linkText || '',
    status: scheduledAt ? 'scheduled' : 'draft',
    scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
    publishedAt: null,
    publishResults: {},
    templateId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: email
  };

  storyData.mediaType = /\.(mp4|mov|webm|avi|wmv)$/i.test(storyData.media) ? 'VIDEO' : 'IMAGE';

  const ref = await db.collection(STORIES_COLLECTION).add(storyData);
  return jsonResponse(200, { ok: true, id: ref.id });
}


// ── Highlights ────────────────────────────────────────────────────────

async function listHighlights(db) {
  const snap = await db.collection(HIGHLIGHTS_COLLECTION)
    .orderBy('sortOrder', 'asc')
    .limit(50)
    .get();

  const highlights = [];
  snap.forEach(doc => {
    highlights.push({ id: doc.id, ...doc.data() });
  });

  return jsonResponse(200, { ok: true, highlights });
}

async function saveHighlight(db, body, email) {
  const { id, name, coverImage, storyIds, sortOrder } = body;
  if (!name) return jsonResponse(400, { ok: false, error: 'Missing name' });

  const data = {
    name: name.trim(),
    coverImage: coverImage || '',
    storyIds: storyIds || [],
    sortOrder: sortOrder || 0,
    updatedAt: serverTimestamp()
  };

  if (id) {
    await db.collection(HIGHLIGHTS_COLLECTION).doc(id).update(data);
    return jsonResponse(200, { ok: true, id });
  }

  data.createdAt = serverTimestamp();
  data.createdBy = email;
  const ref = await db.collection(HIGHLIGHTS_COLLECTION).add(data);
  return jsonResponse(200, { ok: true, id: ref.id });
}

async function deleteHighlight(db, body) {
  const { id } = body;
  if (!id) return jsonResponse(400, { ok: false, error: 'Missing id' });

  await db.collection(HIGHLIGHTS_COLLECTION).doc(id).delete();
  return jsonResponse(200, { ok: true });
}
