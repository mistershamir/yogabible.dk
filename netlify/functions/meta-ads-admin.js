/**
 * Meta Ads Admin API — Yoga Bible
 * Admin-only API for managing Meta (Facebook/Instagram) ad campaigns.
 *
 * Supports both ad accounts:
 *   - Yoga Bible:  act_1137462911884203
 *   - Hot Yoga CPH: act_518096093802228
 *
 * Routes (via ?action= query param):
 *
 *   GET  ?action=accounts                          — list ad accounts
 *   GET  ?action=campaigns&account=act_XXX          — list campaigns
 *   GET  ?action=adsets&campaign_id=XXX              — list ad sets for a campaign
 *   GET  ?action=ads&adset_id=XXX                    — list ads for an ad set
 *   GET  ?action=insights&account=act_XXX&range=7    — account-level insights
 *   GET  ?action=campaign-insights&id=XXX&range=7    — campaign-level insights
 *   GET  ?action=adset-insights&id=XXX&range=7       — ad set-level insights
 *   GET  ?action=ad-insights&id=XXX&range=7          — ad-level insights
 *   GET  ?action=ad-preview&id=XXX                   — ad preview/creative
 *
 *   POST ?action=update-status                       — pause/resume campaign/adset/ad
 *         body: { id, status: "PAUSED"|"ACTIVE" }
 *   POST ?action=update-budget                       — update daily/lifetime budget
 *         body: { id, level: "campaign"|"adset", daily_budget?, lifetime_budget? }
 *   POST ?action=update-bid                          — update ad set bid
 *         body: { id, bid_amount }
 *   POST ?action=duplicate                           — duplicate campaign/adset/ad
 *         body: { id, level: "campaign"|"adset"|"ad" }
 *   POST ?action=update-schedule                     — update ad set schedule
 *         body: { id, start_time?, end_time? }
 *
 * Required env vars:
 *   META_ACCESS_TOKEN — System User access token with ads_management + ads_read
 */

const { requireAuth } = require('./shared/auth');
const { jsonResponse, optionsResponse } = require('./shared/utils');

const GRAPH_API = 'https://graph.facebook.com/v25.0';
const TOKEN = () => process.env.META_ACCESS_TOKEN;

// Known ad accounts
const AD_ACCOUNTS = {
  'act_1137462911884203': 'Yoga Bible',
  'act_518096093802228': 'HYC Ad Account'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  const user = await requireAuth(event, ['admin']);
  if (user.error) return user.error;

  const params = event.queryStringParameters || {};
  const action = params.action;

  if (!action) {
    return jsonResponse(400, { ok: false, error: 'Missing action parameter' });
  }

  if (!TOKEN()) {
    return jsonResponse(500, { ok: false, error: 'META_ACCESS_TOKEN not configured' });
  }

  try {
    switch (event.httpMethod) {
      case 'GET':
        return handleGet(action, params);
      case 'POST':
        return handlePost(action, event);
      default:
        return jsonResponse(405, { ok: false, error: 'Method not allowed' });
    }
  } catch (err) {
    console.error('[meta-ads-admin] Error:', err);
    return jsonResponse(500, { ok: false, error: err.message });
  }
};


// ═══════════════════════════════════════════════════════════════════
// GET Handlers
// ═══════════════════════════════════════════════════════════════════

async function handleGet(action, params) {
  switch (action) {
    case 'accounts':
      return getAccounts();
    case 'campaigns':
      return getCampaigns(params);
    case 'adsets':
      return getAdSets(params);
    case 'ads':
      return getAds(params);
    case 'insights':
      return getAccountInsights(params);
    case 'campaign-insights':
      return getInsights(params.id, 'campaign', params);
    case 'adset-insights':
      return getInsights(params.id, 'adset', params);
    case 'ad-insights':
      return getInsights(params.id, 'ad', params);
    case 'ad-preview':
      return getAdPreview(params.id);
    default:
      return jsonResponse(400, { ok: false, error: 'Unknown GET action: ' + action });
  }
}


// ── Get Ad Accounts ──────────────────────────────────────────────
async function getAccounts() {
  const fields = 'name,account_id,account_status,currency,timezone_name,amount_spent,balance,spend_cap';
  const url = `${GRAPH_API}/me/adaccounts?fields=${fields}&access_token=${TOKEN()}`;
  const data = await graphFetch(url);

  // Filter to known accounts
  const accounts = (data.data || []).filter(a => AD_ACCOUNTS[a.id]);
  return jsonResponse(200, { ok: true, accounts });
}


// ── Get Campaigns ────────────────────────────────────────────────
async function getCampaigns(params) {
  const account = params.account;
  if (!account || !AD_ACCOUNTS[account]) {
    return jsonResponse(400, { ok: false, error: 'Invalid or missing account parameter' });
  }

  const fields = [
    'name', 'status', 'effective_status', 'objective',
    'daily_budget', 'lifetime_budget', 'budget_remaining',
    'start_time', 'stop_time', 'created_time', 'updated_time',
    'buying_type', 'bid_strategy', 'special_ad_categories'
  ].join(',');

  const limit = params.limit || 50;
  const url = `${GRAPH_API}/${account}/campaigns?fields=${fields}&limit=${limit}&access_token=${TOKEN()}`;
  const data = await graphFetch(url);

  return jsonResponse(200, { ok: true, campaigns: data.data || [], paging: data.paging });
}


// ── Get Ad Sets ──────────────────────────────────────────────────
async function getAdSets(params) {
  const campaignId = params.campaign_id;
  const account = params.account;

  const fields = [
    'name', 'status', 'effective_status', 'campaign_id',
    'daily_budget', 'lifetime_budget', 'budget_remaining',
    'bid_amount', 'bid_strategy', 'billing_event', 'optimization_goal',
    'targeting', 'start_time', 'end_time', 'created_time', 'updated_time'
  ].join(',');

  let url;
  if (campaignId) {
    url = `${GRAPH_API}/${campaignId}/adsets?fields=${fields}&limit=50&access_token=${TOKEN()}`;
  } else if (account && AD_ACCOUNTS[account]) {
    url = `${GRAPH_API}/${account}/adsets?fields=${fields}&limit=50&access_token=${TOKEN()}`;
  } else {
    return jsonResponse(400, { ok: false, error: 'Provide campaign_id or account' });
  }

  const data = await graphFetch(url);
  return jsonResponse(200, { ok: true, adsets: data.data || [], paging: data.paging });
}


// ── Get Ads ──────────────────────────────────────────────────────
async function getAds(params) {
  const adsetId = params.adset_id;
  const account = params.account;

  const fields = [
    'name', 'status', 'effective_status', 'adset_id', 'campaign_id',
    'creative', 'created_time', 'updated_time',
    'tracking_specs', 'conversion_specs'
  ].join(',');

  let url;
  if (adsetId) {
    url = `${GRAPH_API}/${adsetId}/ads?fields=${fields}&limit=50&access_token=${TOKEN()}`;
  } else if (account && AD_ACCOUNTS[account]) {
    url = `${GRAPH_API}/${account}/ads?fields=${fields}&limit=50&access_token=${TOKEN()}`;
  } else {
    return jsonResponse(400, { ok: false, error: 'Provide adset_id or account' });
  }

  const data = await graphFetch(url);
  return jsonResponse(200, { ok: true, ads: data.data || [], paging: data.paging });
}


// ── Get Account-Level Insights ───────────────────────────────────
async function getAccountInsights(params) {
  const account = params.account;
  if (!account || !AD_ACCOUNTS[account]) {
    return jsonResponse(400, { ok: false, error: 'Invalid or missing account parameter' });
  }

  const range = parseInt(params.range) || 7;
  const breakdown = params.breakdown || '';
  const datePreset = rangeToPreset(range);

  const fields = [
    'impressions', 'reach', 'clicks', 'cpc', 'cpm', 'ctr',
    'spend', 'actions', 'cost_per_action_type',
    'conversions', 'cost_per_conversion', 'conversion_rate_ranking',
    'frequency', 'unique_clicks', 'unique_ctr'
  ].join(',');

  let url = `${GRAPH_API}/${account}/insights?fields=${fields}&date_preset=${datePreset}&access_token=${TOKEN()}`;
  if (breakdown) url += `&breakdowns=${breakdown}`;

  const data = await graphFetch(url);
  return jsonResponse(200, { ok: true, insights: data.data || [] });
}


// ── Get Entity-Level Insights ────────────────────────────────────
async function getInsights(id, level, params) {
  if (!id) {
    return jsonResponse(400, { ok: false, error: 'Missing id parameter' });
  }

  const range = parseInt(params.range) || 7;
  const datePreset = rangeToPreset(range);
  const timeIncrement = params.daily === '1' ? '1' : 'all_days';

  const fields = [
    'impressions', 'reach', 'clicks', 'cpc', 'cpm', 'ctr',
    'spend', 'actions', 'cost_per_action_type',
    'conversions', 'cost_per_conversion',
    'frequency', 'unique_clicks', 'unique_ctr',
    'date_start', 'date_stop'
  ].join(',');

  let url = `${GRAPH_API}/${id}/insights?fields=${fields}&date_preset=${datePreset}&time_increment=${timeIncrement}&access_token=${TOKEN()}`;

  const data = await graphFetch(url);
  return jsonResponse(200, { ok: true, insights: data.data || [] });
}


// ── Get Ad Preview / Creative ────────────────────────────────────
async function getAdPreview(adId) {
  if (!adId) {
    return jsonResponse(400, { ok: false, error: 'Missing id parameter' });
  }

  // Fetch ad with creative details
  const fields = 'name,status,creative{title,body,image_url,thumbnail_url,object_story_spec,effective_object_story_id,url_tags}';
  const url = `${GRAPH_API}/${adId}?fields=${fields}&access_token=${TOKEN()}`;
  const data = await graphFetch(url);

  return jsonResponse(200, { ok: true, ad: data });
}


// ═══════════════════════════════════════════════════════════════════
// POST Handlers
// ═══════════════════════════════════════════════════════════════════

async function handlePost(action, event) {
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return jsonResponse(400, { ok: false, error: 'Invalid JSON body' });
  }

  switch (action) {
    case 'update-status':
      return updateStatus(body);
    case 'update-budget':
      return updateBudget(body);
    case 'update-bid':
      return updateBid(body);
    case 'duplicate':
      return duplicateEntity(body);
    case 'update-schedule':
      return updateSchedule(body);
    default:
      return jsonResponse(400, { ok: false, error: 'Unknown POST action: ' + action });
  }
}


// ── Update Status (Pause / Resume / Archive) ─────────────────────
async function updateStatus(body) {
  const { id, status } = body;
  if (!id || !status) {
    return jsonResponse(400, { ok: false, error: 'Missing id or status' });
  }

  const allowed = ['ACTIVE', 'PAUSED', 'ARCHIVED'];
  if (!allowed.includes(status)) {
    return jsonResponse(400, { ok: false, error: 'Invalid status. Must be: ' + allowed.join(', ') });
  }

  const result = await graphPost(id, { status });
  return jsonResponse(200, { ok: true, result });
}


// ── Update Budget ────────────────────────────────────────────────
async function updateBudget(body) {
  const { id, level, daily_budget, lifetime_budget } = body;
  if (!id) {
    return jsonResponse(400, { ok: false, error: 'Missing id' });
  }

  const updates = {};
  // Meta API expects budget in cents (smallest currency unit)
  if (daily_budget !== undefined) {
    updates.daily_budget = Math.round(parseFloat(daily_budget) * 100);
  }
  if (lifetime_budget !== undefined) {
    updates.lifetime_budget = Math.round(parseFloat(lifetime_budget) * 100);
  }

  if (Object.keys(updates).length === 0) {
    return jsonResponse(400, { ok: false, error: 'Provide daily_budget or lifetime_budget' });
  }

  const result = await graphPost(id, updates);
  return jsonResponse(200, { ok: true, result });
}


// ── Update Bid ───────────────────────────────────────────────────
async function updateBid(body) {
  const { id, bid_amount } = body;
  if (!id || bid_amount === undefined) {
    return jsonResponse(400, { ok: false, error: 'Missing id or bid_amount' });
  }

  const result = await graphPost(id, {
    bid_amount: Math.round(parseFloat(bid_amount) * 100)
  });
  return jsonResponse(200, { ok: true, result });
}


// ── Duplicate Entity ─────────────────────────────────────────────
async function duplicateEntity(body) {
  const { id, level } = body;
  if (!id || !level) {
    return jsonResponse(400, { ok: false, error: 'Missing id or level' });
  }

  // Meta uses the /copies edge for duplication
  const url = `${GRAPH_API}/${id}/copies?access_token=${TOKEN()}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status_option: 'PAUSED' })
  });
  const result = await response.json();

  if (result.error) {
    console.error('[meta-ads-admin] Duplicate error:', result.error);
    return jsonResponse(400, { ok: false, error: result.error.message });
  }

  return jsonResponse(200, { ok: true, copied_id: result.copied_campaign_id || result.copied_adset_id || result.copied_ad_id || result.id });
}


// ── Update Schedule ──────────────────────────────────────────────
async function updateSchedule(body) {
  const { id, start_time, end_time } = body;
  if (!id) {
    return jsonResponse(400, { ok: false, error: 'Missing id' });
  }

  const updates = {};
  if (start_time) updates.start_time = start_time;
  if (end_time) updates.end_time = end_time;

  if (Object.keys(updates).length === 0) {
    return jsonResponse(400, { ok: false, error: 'Provide start_time or end_time' });
  }

  const result = await graphPost(id, updates);
  return jsonResponse(200, { ok: true, result });
}


// ═══════════════════════════════════════════════════════════════════
// Graph API Helpers
// ═══════════════════════════════════════════════════════════════════

/**
 * GET request to Graph API.
 */
async function graphFetch(url) {
  const response = await fetch(url);
  const data = await response.json();

  if (data.error) {
    console.error('[meta-ads-admin] Graph API error:', data.error);
    throw new Error(data.error.message || 'Graph API error');
  }

  return data;
}

/**
 * POST update to Graph API (update an existing object).
 */
async function graphPost(objectId, fields) {
  const url = `${GRAPH_API}/${objectId}?access_token=${TOKEN()}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields)
  });
  const data = await response.json();

  if (data.error) {
    console.error('[meta-ads-admin] Graph API POST error:', data.error);
    throw new Error(data.error.message || 'Graph API error');
  }

  return data;
}

/**
 * Map range (days) → Meta date_preset string.
 */
function rangeToPreset(days) {
  const map = {
    1: 'today',
    7: 'last_7d',
    14: 'last_14d',
    28: 'last_28d',
    30: 'last_30d',
    90: 'last_90d'
  };
  return map[days] || 'last_7d';
}
