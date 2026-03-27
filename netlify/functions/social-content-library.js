/**
 * Social Content Library API — Yoga Bible
 * Asset metadata, tagging, search, and collections for the social media content library.
 *
 * GET  /.netlify/functions/social-content-library?action=list[&tag=X&collection=Y&search=Z]
 * GET  /.netlify/functions/social-content-library?action=collections
 * POST /.netlify/functions/social-content-library  { action: 'tag', url, tags, alt, notes }
 * POST /.netlify/functions/social-content-library  { action: 'create-collection', name, description }
 * POST /.netlify/functions/social-content-library  { action: 'add-to-collection', collectionId, urls }
 * POST /.netlify/functions/social-content-library  { action: 'remove-from-collection', collectionId, url }
 * POST /.netlify/functions/social-content-library  { action: 'delete-collection', id }
 */

const { getDb, serverTimestamp } = require('./shared/firestore');
const { requireAuth } = require('./shared/auth');
const { jsonResponse, optionsResponse } = require('./shared/utils');

const ASSETS_COLLECTION = 'social_assets';
const COLLECTIONS_COLLECTION = 'social_collections';

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  const user = await requireAuth(event, ['admin']);
  if (user.error) return user.error;

  const params = event.queryStringParameters || {};
  const db = getDb();

  try {
    if (event.httpMethod === 'GET') {
      const action = params.action || 'list';
      if (action === 'list') return listAssets(db, params);
      if (action === 'collections') return listCollections(db);
      return jsonResponse(400, { ok: false, error: `Unknown action: ${action}` });
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const action = body.action || params.action;

      switch (action) {
        case 'tag': return tagAsset(db, body);
        case 'create-collection': return createCollection(db, body);
        case 'add-to-collection': return addToCollection(db, body);
        case 'remove-from-collection': return removeFromCollection(db, body);
        case 'delete-collection': return deleteCollection(db, body);
        default:
          return jsonResponse(400, { ok: false, error: `Unknown action: ${action}` });
      }
    }

    return jsonResponse(405, { ok: false, error: 'Method not allowed' });
  } catch (err) {
    console.error('[social-content-library] Error:', err);
    return jsonResponse(500, { ok: false, error: err.message });
  }
};


// ── List assets with optional filters ──────────────────────────────

async function listAssets(db, params) {
  let query = db.collection(ASSETS_COLLECTION).orderBy('updatedAt', 'desc').limit(100);

  const snap = await query.get();
  let assets = [];
  snap.forEach(doc => {
    assets.push({ id: doc.id, ...doc.data() });
  });

  // Client-side filtering (Firestore doesn't support full-text search)
  if (params.tag) {
    const tag = params.tag.toLowerCase();
    assets = assets.filter(a => (a.tags || []).some(t => t.toLowerCase() === tag));
  }
  if (params.collection) {
    assets = assets.filter(a => (a.collections || []).includes(params.collection));
  }
  if (params.search) {
    const q = params.search.toLowerCase();
    assets = assets.filter(a =>
      (a.alt || '').toLowerCase().includes(q) ||
      (a.notes || '').toLowerCase().includes(q) ||
      (a.tags || []).some(t => t.toLowerCase().includes(q)) ||
      (a.url || '').toLowerCase().includes(q)
    );
  }

  // Gather all unique tags for the tag cloud
  const tagCounts = {};
  assets.forEach(a => {
    (a.tags || []).forEach(t => {
      tagCounts[t] = (tagCounts[t] || 0) + 1;
    });
  });

  return jsonResponse(200, {
    ok: true,
    assets,
    tags: Object.entries(tagCounts)
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
  });
}


// ── Tag/update asset metadata ──────────────────────────────────────

async function tagAsset(db, body) {
  const { url, tags, alt, notes } = body;
  if (!url) return jsonResponse(400, { ok: false, error: 'Missing url' });

  // Use URL hash as document ID for dedup
  const docId = Buffer.from(url).toString('base64').replace(/[/+=]/g, '_').substring(0, 100);
  const docRef = db.collection(ASSETS_COLLECTION).doc(docId);
  const existing = await docRef.get();

  const isVideo = /\.(mp4|mov|webm)$/i.test(url);
  const type = isVideo ? 'video' : 'image';

  const data = {
    url,
    type,
    tags: tags || [],
    alt: alt || '',
    notes: notes || '',
    updatedAt: serverTimestamp()
  };

  if (!existing.exists) {
    data.createdAt = serverTimestamp();
    data.usageCount = 0;
    data.collections = [];
  }

  await docRef.set(data, { merge: true });
  return jsonResponse(200, { ok: true, id: docId });
}


// ── Collections CRUD ───────────────────────────────────────────────

async function listCollections(db) {
  const snap = await db.collection(COLLECTIONS_COLLECTION)
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get();

  const collections = [];
  snap.forEach(doc => {
    collections.push({ id: doc.id, ...doc.data() });
  });

  return jsonResponse(200, { ok: true, collections });
}

async function createCollection(db, body) {
  const { name, description } = body;
  if (!name) return jsonResponse(400, { ok: false, error: 'Missing name' });

  const ref = await db.collection(COLLECTIONS_COLLECTION).add({
    name: name.trim(),
    description: description || '',
    assetCount: 0,
    createdAt: serverTimestamp()
  });

  return jsonResponse(200, { ok: true, id: ref.id });
}

async function addToCollection(db, body) {
  const { collectionId, urls } = body;
  if (!collectionId || !urls || !urls.length) {
    return jsonResponse(400, { ok: false, error: 'Missing collectionId or urls' });
  }

  // Update each asset's collections array
  for (const url of urls) {
    const docId = Buffer.from(url).toString('base64').replace(/[/+=]/g, '_').substring(0, 100);
    const docRef = db.collection(ASSETS_COLLECTION).doc(docId);
    const doc = await docRef.get();

    if (doc.exists) {
      const collections = doc.data().collections || [];
      if (!collections.includes(collectionId)) {
        collections.push(collectionId);
        await docRef.update({ collections, updatedAt: serverTimestamp() });
      }
    } else {
      // Auto-create asset entry
      await docRef.set({
        url,
        type: /\.(mp4|mov|webm)$/i.test(url) ? 'video' : 'image',
        tags: [],
        alt: '',
        notes: '',
        collections: [collectionId],
        usageCount: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    }
  }

  // Update collection asset count
  const collRef = db.collection(COLLECTIONS_COLLECTION).doc(collectionId);
  const assetsSnap = await db.collection(ASSETS_COLLECTION)
    .where('collections', 'array-contains', collectionId)
    .get();
  await collRef.update({ assetCount: assetsSnap.size });

  return jsonResponse(200, { ok: true, added: urls.length });
}

async function removeFromCollection(db, body) {
  const { collectionId, url } = body;
  if (!collectionId || !url) {
    return jsonResponse(400, { ok: false, error: 'Missing collectionId or url' });
  }

  const docId = Buffer.from(url).toString('base64').replace(/[/+=]/g, '_').substring(0, 100);
  const docRef = db.collection(ASSETS_COLLECTION).doc(docId);
  const doc = await docRef.get();

  if (doc.exists) {
    const collections = (doc.data().collections || []).filter(c => c !== collectionId);
    await docRef.update({ collections, updatedAt: serverTimestamp() });
  }

  return jsonResponse(200, { ok: true });
}

async function deleteCollection(db, body) {
  const { id } = body;
  if (!id) return jsonResponse(400, { ok: false, error: 'Missing id' });

  // Remove collection reference from all assets
  const assetsSnap = await db.collection(ASSETS_COLLECTION)
    .where('collections', 'array-contains', id)
    .get();

  const batch = db.batch();
  assetsSnap.forEach(doc => {
    const collections = (doc.data().collections || []).filter(c => c !== id);
    batch.update(doc.ref, { collections });
  });
  batch.delete(db.collection(COLLECTIONS_COLLECTION).doc(id));
  await batch.commit();

  return jsonResponse(200, { ok: true });
}
