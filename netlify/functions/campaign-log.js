/**
 * Campaign Log Endpoint — Yoga Bible
 * Stores and retrieves campaign send history with engagement tracking.
 *
 * POST /.netlify/functions/campaign-log — Save a campaign record
 * GET  /.netlify/functions/campaign-log — List past campaigns (paginated)
 * GET  /.netlify/functions/campaign-log?id=X — Get single campaign + tracking stats
 */

const { requireAuth } = require('./shared/auth');
const { getDb } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  // Auth check — admin or marketing
  const authResult = await requireAuth(event, ['admin', 'marketing']);
  if (authResult.error) return authResult.error;

  const db = getDb();

  try {
    if (event.httpMethod === 'POST') {
      return await handleCreate(db, event);
    }

    if (event.httpMethod === 'GET') {
      return await handleGet(db, event);
    }

    return jsonResponse(405, { ok: false, error: 'Method not allowed' });
  } catch (err) {
    console.error('[campaign-log] Error:', err);
    return jsonResponse(500, { ok: false, error: err.message });
  }
};

async function handleCreate(db, event) {
  const payload = JSON.parse(event.body || '{}');

  if (!payload.type) {
    return jsonResponse(400, { ok: false, error: 'type is required (sms or email)' });
  }

  const record = {
    type: payload.type,                          // 'sms' or 'email'
    templateId: payload.templateId || null,
    subject: payload.subject || '',
    recipientCount: payload.recipientCount || 0,
    results: payload.results || {},              // { sent, failed, skipped, scheduled }
    schedule: payload.schedule || 'now',
    sentAt: payload.sentAt || new Date().toISOString(),
    createdAt: new Date().toISOString(),
    sentBy: event.headers['x-user-email'] || 'unknown',
    // New fields for list + tracking support
    listIds: payload.listIds || [],
    includesListContacts: payload.includesListContacts || false,
    listContactCount: payload.listContactCount || 0
  };

  const ref = await db.collection('campaigns').add(record);

  return jsonResponse(200, {
    ok: true,
    campaignId: ref.id,
    record
  });
}

async function handleGet(db, event) {
  const params = event.queryStringParameters || {};

  // Single campaign with tracking stats
  if (params.id) {
    const doc = await db.collection('campaigns').doc(params.id).get();
    if (!doc.exists) return jsonResponse(404, { ok: false, error: 'Campaign not found' });

    const campaign = { id: doc.id, ...doc.data() };

    // Fetch tracking stats
    const trackSnap = await db.collection('email_tracking')
      .where('campaign_id', '==', params.id)
      .get();

    const uniqueOpens = new Set();
    const uniqueClicks = new Set();
    let totalOpens = 0;
    let totalClicks = 0;
    const clickUrls = {};
    const openTimeline = {};
    const clickTimeline = {};

    trackSnap.forEach(tdoc => {
      const data = tdoc.data();
      const day = (data.timestamp || '').slice(0, 10);
      if (data.type === 'open') {
        totalOpens++;
        uniqueOpens.add(data.email_hash);
        if (day) openTimeline[day] = (openTimeline[day] || 0) + 1;
      } else if (data.type === 'click') {
        totalClicks++;
        uniqueClicks.add(data.email_hash);
        if (data.url) clickUrls[data.url] = (clickUrls[data.url] || 0) + 1;
        if (day) clickTimeline[day] = (clickTimeline[day] || 0) + 1;
      }
    });

    const sent = (campaign.results && campaign.results.sent) || campaign.recipientCount || 0;

    campaign.tracking = {
      unique_opens: uniqueOpens.size,
      total_opens: totalOpens,
      unique_clicks: uniqueClicks.size,
      total_clicks: totalClicks,
      open_rate: sent > 0 ? Math.round((uniqueOpens.size / sent) * 100) : 0,
      click_rate: sent > 0 ? Math.round((uniqueClicks.size / sent) * 100) : 0,
      click_urls: clickUrls,
      open_timeline: openTimeline,
      click_timeline: clickTimeline
    };

    return jsonResponse(200, { ok: true, campaign });
  }

  // List campaigns
  const limit = Math.min(parseInt(params.limit) || 20, 100);
  const offset = parseInt(params.offset) || 0;

  let query = db.collection('campaigns')
    .orderBy('createdAt', 'desc')
    .limit(limit);

  if (offset > 0) {
    const skipSnap = await db.collection('campaigns')
      .orderBy('createdAt', 'desc')
      .limit(offset)
      .get();

    if (!skipSnap.empty) {
      const lastDoc = skipSnap.docs[skipSnap.docs.length - 1];
      query = query.startAfter(lastDoc);
    }
  }

  const snap = await query.get();
  const campaigns = [];

  snap.forEach(doc => {
    campaigns.push({
      id: doc.id,
      ...doc.data()
    });
  });

  // Fetch basic tracking stats for each campaign (for list view)
  if (params.tracking === '1' && campaigns.length > 0) {
    // Batch-fetch all tracking events for these campaign IDs
    const campaignIds = campaigns.map(c => c.id);
    // Firestore 'in' queries support max 30 values
    const trackingMap = {};
    for (let i = 0; i < campaignIds.length; i += 30) {
      const chunk = campaignIds.slice(i, i + 30);
      const trackSnap = await db.collection('email_tracking')
        .where('campaign_id', 'in', chunk)
        .get();
      trackSnap.forEach(tdoc => {
        const data = tdoc.data();
        const cid = data.campaign_id;
        if (!trackingMap[cid]) trackingMap[cid] = { opens: new Set(), clicks: new Set(), totalOpens: 0, totalClicks: 0 };
        if (data.type === 'open') {
          trackingMap[cid].totalOpens++;
          trackingMap[cid].opens.add(data.email_hash);
        } else if (data.type === 'click') {
          trackingMap[cid].totalClicks++;
          trackingMap[cid].clicks.add(data.email_hash);
        }
      });
    }

    campaigns.forEach(c => {
      const t = trackingMap[c.id];
      const sent = (c.results && c.results.sent) || c.recipientCount || 0;
      if (t) {
        c.tracking = {
          unique_opens: t.opens.size,
          total_opens: t.totalOpens,
          unique_clicks: t.clicks.size,
          total_clicks: t.totalClicks,
          open_rate: sent > 0 ? Math.round((t.opens.size / sent) * 100) : 0,
          click_rate: sent > 0 ? Math.round((t.clicks.size / sent) * 100) : 0
        };
      } else {
        c.tracking = { unique_opens: 0, total_opens: 0, unique_clicks: 0, total_clicks: 0, open_rate: 0, click_rate: 0 };
      }
    });
  }

  return jsonResponse(200, {
    ok: true,
    campaigns,
    count: campaigns.length,
    hasMore: campaigns.length === limit
  });
}
