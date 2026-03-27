/**
 * Social Canva Integration — Yoga Bible
 * Manages Canva design references, exports, and platform-aware design generation.
 *
 * GET  /.netlify/functions/social-canva?action=designs[&postId=X]
 * GET  /.netlify/functions/social-canva?action=brand-kits
 * POST /.netlify/functions/social-canva  { action: 'save-design', ... }
 * POST /.netlify/functions/social-canva  { action: 'attach-to-post', postId, designId, mediaUrl }
 * POST /.netlify/functions/social-canva  { action: 'save-export', designId, format, url }
 * POST /.netlify/functions/social-canva  { action: 'resize-map', designId, resizes: [...] }
 * POST /.netlify/functions/social-canva  { action: 'delete-design', designId }
 */

const { getDb, serverTimestamp } = require('./shared/firestore');
const { requireAuth } = require('./shared/auth');
const { jsonResponse, optionsResponse } = require('./shared/utils');

const DESIGNS_COLLECTION = 'social_canva_designs';
const POSTS_COLLECTION = 'social_posts';

// Canva brand kit IDs (from Canva MCP list-brand-kits)
const BRAND_KITS = {
  'yoga-bible': { id: 'kAGq6Pn59GQ', name: 'Yoga Bible DK' },
  'hot-yoga-cph': { id: 'kAFY917OcTU', name: 'HYC' },
  'vibro-yoga': { id: 'kAGOngP66vs', name: 'Vibro Yoga' }
};

// Platform → Canva design type mapping
const PLATFORM_DESIGN_TYPES = {
  instagram_post: 'instagram_post',
  instagram_story: 'your_story',
  instagram_reel: 'your_story',
  facebook_post: 'facebook_post',
  facebook_story: 'your_story',
  facebook_cover: 'facebook_cover',
  pinterest: 'pinterest_pin',
  youtube_thumbnail: 'youtube_thumbnail',
  linkedin_post: 'facebook_post',   // Similar dimensions
  tiktok: 'your_story',             // 9:16 vertical
  poster: 'poster',
  flyer: 'flyer'
};

// Platform → recommended export format
const PLATFORM_EXPORT_FORMAT = {
  instagram_post: { type: 'png', width: 1080, height: 1080 },
  instagram_story: { type: 'png', width: 1080, height: 1920 },
  instagram_reel: { type: 'mp4', quality: 'horizontal_1080p' },
  facebook_post: { type: 'png', width: 1200, height: 630 },
  facebook_story: { type: 'png', width: 1080, height: 1920 },
  facebook_cover: { type: 'png', width: 820, height: 312 },
  pinterest: { type: 'png', width: 1000, height: 1500 },
  youtube_thumbnail: { type: 'png', width: 1280, height: 720 },
  linkedin_post: { type: 'png', width: 1200, height: 627 },
  tiktok: { type: 'mp4', quality: 'horizontal_1080p' },
  poster: { type: 'png', width: 1080, height: 1920 },
  flyer: { type: 'png', width: 1080, height: 1080 }
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  const user = await requireAuth(event, ['admin']);
  if (user.error) return user.error;

  const params = event.queryStringParameters || {};
  const db = getDb();

  try {
    if (event.httpMethod === 'GET') {
      const action = params.action || 'designs';

      if (action === 'designs') return listDesigns(db, params);
      if (action === 'brand-kits') return jsonResponse(200, {
        ok: true,
        brandKits: BRAND_KITS,
        platformTypes: PLATFORM_DESIGN_TYPES,
        exportFormats: PLATFORM_EXPORT_FORMAT
      });

      return jsonResponse(400, { ok: false, error: `Unknown action: ${action}` });
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const action = body.action;

      switch (action) {
        case 'save-design': return saveDesign(db, body, user.email);
        case 'attach-to-post': return attachToPost(db, body);
        case 'save-export': return saveExport(db, body);
        case 'resize-map': return saveResizeMap(db, body);
        case 'delete-design': return deleteDesign(db, body);
        default:
          return jsonResponse(400, { ok: false, error: `Unknown action: ${action}` });
      }
    }

    return jsonResponse(405, { ok: false, error: 'Method not allowed' });
  } catch (err) {
    console.error('[social-canva] Error:', err);
    return jsonResponse(500, { ok: false, error: err.message });
  }
};


// ── List Canva designs ────────────────────────────────────────────────

async function listDesigns(db, params) {
  let query = db.collection(DESIGNS_COLLECTION).orderBy('createdAt', 'desc').limit(50);

  const snap = await query.get();
  const designs = [];
  snap.forEach(doc => {
    designs.push({ id: doc.id, ...doc.data() });
  });

  // Filter by postId if provided
  if (params.postId) {
    return jsonResponse(200, {
      ok: true,
      designs: designs.filter(d => d.postId === params.postId)
    });
  }

  return jsonResponse(200, { ok: true, designs });
}


// ── Save Canva design reference ───────────────────────────────────────

async function saveDesign(db, body, email) {
  const { canvaDesignId, designUrl, thumbnail, title, designType, brand, platformTarget, caption, postId } = body;

  if (!canvaDesignId) return jsonResponse(400, { ok: false, error: 'Missing canvaDesignId' });

  const data = {
    canvaDesignId,
    designUrl: designUrl || '',
    thumbnail: thumbnail || '',
    title: title || 'Untitled',
    designType: designType || 'instagram_post',
    brand: brand || 'yoga-bible',
    platformTarget: platformTarget || 'instagram_post',
    caption: caption || '',
    postId: postId || null,
    exports: [],
    resizes: {},
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: email
  };

  const ref = await db.collection(DESIGNS_COLLECTION).add(data);
  return jsonResponse(200, { ok: true, id: ref.id });
}


// ── Attach exported design to a social post ───────────────────────────

async function attachToPost(db, body) {
  const { postId, mediaUrl } = body;

  if (!postId || !mediaUrl) {
    return jsonResponse(400, { ok: false, error: 'Missing postId or mediaUrl' });
  }

  // Get current post media
  const postRef = db.collection(POSTS_COLLECTION).doc(postId);
  const postDoc = await postRef.get();
  if (!postDoc.exists) return jsonResponse(404, { ok: false, error: 'Post not found' });

  const post = postDoc.data();
  const media = post.media || [];

  // Add the exported design URL to post media
  if (!media.includes(mediaUrl)) {
    media.push(mediaUrl);
  }

  await postRef.update({
    media,
    updatedAt: serverTimestamp()
  });

  return jsonResponse(200, { ok: true, media });
}


// ── Save export URL for a design ──────────────────────────────────────

async function saveExport(db, body) {
  const { designId, format, url, width, height, platform } = body;

  if (!designId) return jsonResponse(400, { ok: false, error: 'Missing designId' });

  const ref = db.collection(DESIGNS_COLLECTION).doc(designId);
  const doc = await ref.get();
  if (!doc.exists) return jsonResponse(404, { ok: false, error: 'Design not found' });

  const exports = doc.data().exports || [];
  exports.push({
    format: format || 'png',
    url: url || '',
    width: width || null,
    height: height || null,
    platform: platform || null,
    exportedAt: new Date().toISOString()
  });

  await ref.update({ exports, updatedAt: serverTimestamp() });
  return jsonResponse(200, { ok: true });
}


// ── Save resize variants ──────────────────────────────────────────────

async function saveResizeMap(db, body) {
  const { designId, resizes } = body;

  if (!designId) return jsonResponse(400, { ok: false, error: 'Missing designId' });

  const ref = db.collection(DESIGNS_COLLECTION).doc(designId);
  await ref.update({
    resizes: resizes || {},
    updatedAt: serverTimestamp()
  });

  return jsonResponse(200, { ok: true });
}


// ── Delete design reference ───────────────────────────────────────────

async function deleteDesign(db, body) {
  const { designId } = body;
  if (!designId) return jsonResponse(400, { ok: false, error: 'Missing designId' });

  await db.collection(DESIGNS_COLLECTION).doc(designId).delete();
  return jsonResponse(200, { ok: true });
}
