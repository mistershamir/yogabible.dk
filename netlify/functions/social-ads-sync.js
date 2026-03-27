/**
 * Social ↔ Meta Ads Sync API — Yoga Bible
 * Bidirectional integration between organic social posts and Meta ad campaigns.
 *
 * GET  /.netlify/functions/social-ads-sync?action=top-organic   — Top posts suitable as ad creative
 * GET  /.netlify/functions/social-ads-sync?action=ad-insights   — Ad performance to inform content
 * POST /.netlify/functions/social-ads-sync  { action: 'suggest-ad', postId }
 * POST /.netlify/functions/social-ads-sync  { action: 'sync-learnings' }
 */

const { getDb, serverTimestamp } = require('./shared/firestore');
const { requireAuth } = require('./shared/auth');
const { jsonResponse, optionsResponse } = require('./shared/utils');

const POSTS_COLLECTION = 'social_posts';
const ADS_COLLECTION = 'social_ad_suggestions';

// Meta Ads account (Yoga Bible)
const META_AD_ACCOUNT = 'act_1137462911884203';
const META_API = 'https://graph.facebook.com/v21.0';

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  const user = await requireAuth(event, ['admin']);
  if (user.error) return user.error;

  const params = event.queryStringParameters || {};
  const db = getDb();

  try {
    if (event.httpMethod === 'GET') {
      const action = params.action || 'top-organic';
      if (action === 'top-organic') return getTopOrganic(db, params);
      if (action === 'ad-insights') return getAdInsights(db);
      if (action === 'suggestions') return getSuggestions(db);
      return jsonResponse(400, { ok: false, error: `Unknown action: ${action}` });
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const action = body.action || params.action;

      switch (action) {
        case 'suggest-ad': return suggestAd(db, body);
        case 'sync-learnings': return syncLearnings(db);
        case 'dismiss': return dismissSuggestion(db, body);
        default:
          return jsonResponse(400, { ok: false, error: `Unknown action: ${action}` });
      }
    }

    return jsonResponse(405, { ok: false, error: 'Method not allowed' });
  } catch (err) {
    console.error('[social-ads-sync] Error:', err);
    return jsonResponse(500, { ok: false, error: err.message });
  }
};


// ── Top organic posts suitable as ad creative ─────────────────

async function getTopOrganic(db, params) {
  const days = parseInt(params.days) || 30;
  const since = new Date();
  since.setDate(since.getDate() - days);

  // Find published posts with high engagement
  let snap;
  try {
    snap = await db.collection(POSTS_COLLECTION)
      .where('status', '==', 'published')
      .where('publishedAt', '>=', since)
      .orderBy('publishedAt', 'desc')
      .limit(50)
      .get();
  } catch (err) {
    snap = await db.collection(POSTS_COLLECTION)
      .where('status', '==', 'published')
      .orderBy('publishedAt', 'desc')
      .limit(50)
      .get();
  }

  const posts = [];
  snap.forEach(doc => {
    const d = doc.data();
    const results = d.publishResults || {};

    // Calculate total engagement across platforms
    let totalEngagement = 0;
    const platformMetrics = {};

    for (const [platform, result] of Object.entries(results)) {
      if (!result.success) continue;
      const metrics = result.metrics || {};
      const engagement = (metrics.likes || 0) + (metrics.comments || 0) + (metrics.shares || 0) + (metrics.saved || 0);
      totalEngagement += engagement;
      platformMetrics[platform] = { ...metrics, engagement };
    }

    posts.push({
      id: doc.id,
      caption: (d.caption || '').substring(0, 200),
      media: d.media || [],
      platforms: d.platforms || [],
      hashtags: d.hashtags || [],
      contentPillar: d.contentPillar || '',
      totalEngagement,
      platformMetrics,
      publishedAt: d.publishedAt?.toDate?.() || d.publishedAt,
      // Flag if already suggested as ad
      adSuggestion: d.adSuggestion || null
    });
  });

  // Sort by engagement, top performers first
  posts.sort((a, b) => b.totalEngagement - a.totalEngagement);

  // Tag top 20% as ad-worthy
  const threshold = posts.length > 0 ? posts[Math.floor(posts.length * 0.2)]?.totalEngagement || 0 : 0;

  return jsonResponse(200, {
    ok: true,
    posts: posts.slice(0, 20),
    adThreshold: threshold,
    total: posts.length
  });
}


// ── Suggest a post as ad creative ─────────────────────────────

async function suggestAd(db, body) {
  const { postId, notes, targetAudience, budget } = body;
  if (!postId) return jsonResponse(400, { ok: false, error: 'Missing postId' });

  const postDoc = await db.collection(POSTS_COLLECTION).doc(postId).get();
  if (!postDoc.exists) return jsonResponse(404, { ok: false, error: 'Post not found' });

  const post = postDoc.data();

  // Create ad suggestion record
  const suggestion = {
    postId,
    caption: post.caption || '',
    media: post.media || [],
    platforms: post.platforms || [],
    hashtags: post.hashtags || [],
    organicEngagement: 0,
    status: 'suggested', // suggested → approved → created → active
    notes: notes || '',
    targetAudience: targetAudience || '',
    suggestedBudget: budget || null,
    createdAt: serverTimestamp()
  };

  // Calculate organic engagement
  const results = post.publishResults || {};
  for (const result of Object.values(results)) {
    if (!result.success || !result.metrics) continue;
    const m = result.metrics;
    suggestion.organicEngagement += (m.likes || 0) + (m.comments || 0) + (m.shares || 0);
  }

  const ref = await db.collection(ADS_COLLECTION).add(suggestion);

  // Mark the post as suggested for ads
  await postDoc.ref.update({
    adSuggestion: {
      suggestionId: ref.id,
      suggestedAt: new Date().toISOString(),
      status: 'suggested'
    }
  });

  return jsonResponse(200, { ok: true, id: ref.id });
}


// ── Get ad suggestions ─────────────────────────────────────────

async function getSuggestions(db) {
  const snap = await db.collection(ADS_COLLECTION)
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get();

  const suggestions = [];
  snap.forEach(doc => {
    const d = doc.data();
    suggestions.push({
      id: doc.id,
      postId: d.postId,
      caption: (d.caption || '').substring(0, 150),
      media: d.media || [],
      organicEngagement: d.organicEngagement || 0,
      status: d.status,
      notes: d.notes || '',
      targetAudience: d.targetAudience || '',
      suggestedBudget: d.suggestedBudget,
      createdAt: d.createdAt?.toDate?.() || d.createdAt
    });
  });

  return jsonResponse(200, { ok: true, suggestions });
}


// ── Dismiss a suggestion ────────────────────────────────────────

async function dismissSuggestion(db, body) {
  const { id } = body;
  if (!id) return jsonResponse(400, { ok: false, error: 'Missing id' });

  await db.collection(ADS_COLLECTION).doc(id).update({
    status: 'dismissed',
    dismissedAt: serverTimestamp()
  });

  return jsonResponse(200, { ok: true });
}


// ── Sync ad learnings back to content strategy ─────────────────
// Pulls Meta Ads performance data and stores insights about
// what content types perform best as paid content.

async function syncLearnings(db) {
  // Load Meta access token from social accounts
  const fbDoc = await db.collection('social_accounts').doc('facebook').get();
  if (!fbDoc.exists || !fbDoc.data().accessToken) {
    return jsonResponse(200, { ok: true, message: 'No Facebook account connected', learnings: [] });
  }

  const accessToken = fbDoc.data().accessToken;
  const learnings = [];

  try {
    // Fetch recent ad campaigns with performance data
    const campaignsRes = await fetch(
      `${META_API}/${META_AD_ACCOUNT}/campaigns?fields=name,status,objective,insights.date_preset(last_30d){spend,impressions,reach,clicks,actions,cost_per_action_type,ctr}&limit=10&access_token=${accessToken}`
    );
    const campaignsData = await campaignsRes.json();

    if (campaignsData.error) {
      console.warn('[social-ads-sync] Meta API error:', campaignsData.error.message);
      return jsonResponse(200, { ok: true, learnings: [], error: campaignsData.error.message });
    }

    for (const campaign of (campaignsData.data || [])) {
      if (campaign.status !== 'ACTIVE') continue;

      const insights = campaign.insights?.data?.[0];
      if (!insights) continue;

      // Extract lead cost if available
      const leadAction = (insights.cost_per_action_type || []).find(a => a.action_type === 'lead');
      const leads = (insights.actions || []).find(a => a.action_type === 'lead');

      learnings.push({
        campaignName: campaign.name,
        objective: campaign.objective,
        spend: parseFloat(insights.spend || 0),
        impressions: parseInt(insights.impressions || 0),
        reach: parseInt(insights.reach || 0),
        clicks: parseInt(insights.clicks || 0),
        ctr: parseFloat(insights.ctr || 0),
        leads: leads ? parseInt(leads.value || 0) : 0,
        costPerLead: leadAction ? parseFloat(leadAction.value || 0) : null
      });
    }

    // Store learnings snapshot
    if (learnings.length > 0) {
      await db.collection('social_ad_learnings').add({
        learnings,
        syncedAt: serverTimestamp(),
        period: 'last_30d'
      });
    }

    // Identify content themes from best-performing ads
    const bestCampaign = learnings.sort((a, b) => (a.costPerLead || 999) - (b.costPerLead || 999))[0];

    return jsonResponse(200, {
      ok: true,
      learnings,
      insight: bestCampaign
        ? `Best performing: "${bestCampaign.campaignName}" with ${bestCampaign.leads} leads at ${bestCampaign.costPerLead ? bestCampaign.costPerLead.toFixed(2) + ' DKK/lead' : 'N/A'}. CTR: ${bestCampaign.ctr.toFixed(2)}%`
        : 'No active campaigns with data'
    });
  } catch (err) {
    console.error('[social-ads-sync] Sync error:', err);
    return jsonResponse(200, { ok: true, learnings: [], error: err.message });
  }
}
