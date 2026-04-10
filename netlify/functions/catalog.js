/**
 * Course Catalog Endpoint — Yoga Bible
 * Public endpoint returning active courses from Firestore.
 *
 * GET /.netlify/functions/catalog
 *
 * Caching strategy (catalog data is near-static — cohorts change rarely):
 *   1. In-memory cache per warm Lambda instance (10 min TTL + stale fallback)
 *   2. HTTP Cache-Control so Netlify's CDN serves most traffic without
 *      hitting the function at all
 *   3. Stale-while-revalidate on Firestore errors — if Firestore is
 *      rate-limited or unreachable, return the last good snapshot
 *      instead of a 500. This keeps the apply wizard working during
 *      Firestore quota hiccups.
 */

const { getDb } = require('./shared/firestore');
const { optionsResponse } = require('./shared/utils');

const CACHE_TTL_MS = 10 * 60 * 1000;   // 10 minutes fresh
const STALE_TTL_MS = 24 * 60 * 60 * 1000; // 24h stale-if-error fallback

let cache = null; // { catalog, fetchedAt }

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS'
};

function cachedResponse(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      // CDN: cache 5 min, revalidate for 10 min
      // Browser: cache 1 min so navigating back is instant
      'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
      ...corsHeaders,
      ...extraHeaders
    },
    body: JSON.stringify(body)
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
      body: JSON.stringify({ ok: false, error: 'Method not allowed' })
    };
  }

  const now = Date.now();

  // 1. Serve fresh in-memory cache — zero Firestore reads
  if (cache && (now - cache.fetchedAt) < CACHE_TTL_MS) {
    return cachedResponse(200, {
      ok: true,
      catalog: cache.catalog,
      count: cache.catalog.length,
      cached: true
    });
  }

  // 2. Fetch from Firestore
  try {
    const db = getDb();
    const snap = await db.collection('course_catalog')
      .where('active', '==', true)
      .get();

    const catalog = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    cache = { catalog, fetchedAt: now };

    return cachedResponse(200, { ok: true, catalog, count: catalog.length });
  } catch (error) {
    console.error('Catalog error:', error);

    // 3. Stale-if-error fallback — keep the apply wizard working when
    // Firestore is quota-limited or unreachable
    if (cache && (now - cache.fetchedAt) < STALE_TTL_MS) {
      console.warn('Catalog: serving stale cache due to Firestore error:', error.message);
      return cachedResponse(200, {
        ok: true,
        catalog: cache.catalog,
        count: cache.catalog.length,
        cached: true,
        stale: true
      });
    }

    return {
      statusCode: 503,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
      body: JSON.stringify({ ok: false, error: 'Catalog temporarily unavailable' })
    };
  }
};
