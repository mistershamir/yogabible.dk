/**
 * Server-side Meta Events — CAPI + Offline Conversions
 *
 * Shared utility for sending conversion events to Meta from Netlify functions.
 * Used by facebook-leads-webhook.js (Lead events) and leads.js (status change events).
 *
 * Supports two destinations:
 *   1. Conversions API (CAPI) — via the Pixel endpoint (website + CRM events)
 *   2. Offline Event Set — for leads captured/converted outside the website
 *
 * Required env vars:
 *   META_PIXEL_ID         — Pixel ID (1186827080033883)
 *   META_ACCESS_TOKEN     — System User access token
 *   META_OFFLINE_EVENT_SET_ID — Offline event set ID (optional)
 */

const crypto = require('crypto');

const GRAPH_API_VERSION = 'v21.0';

/**
 * SHA-256 hash a string (for PII normalization).
 * Meta requires lowercase + trimmed + SHA-256 hashed PII.
 */
function sha256(value) {
  if (!value) return '';
  return crypto
    .createHash('sha256')
    .update(String(value).trim().toLowerCase())
    .digest('hex');
}

/**
 * Send a Lead event to Meta CAPI when a Facebook Lead Ad is captured.
 * action_source = 'system_generated' because this originates from Meta's webhook, not a website visit.
 *
 * @param {Object} lead — The lead object saved to Firestore
 * @param {string} leadId — Firestore document ID (used as event_id for dedup)
 */
async function sendLeadEvent(lead, leadId) {
  const pixelId = process.env.META_PIXEL_ID;
  const accessToken = process.env.META_ACCESS_TOKEN;
  if (!pixelId || !accessToken) {
    console.log('[meta-events] Skipping Lead event — META_PIXEL_ID or META_ACCESS_TOKEN not set');
    return;
  }

  const eventData = {
    event_name: 'Lead',
    event_time: Math.floor(Date.now() / 1000),
    event_id: `lead_${leadId}`,
    action_source: 'system_generated',
    user_data: buildUserData(lead),
    custom_data: {
      lead_event_source: 'facebook_lead_ad',
      content_name: lead.ytt_program_type || 'ytt',
      content_category: lead.type || 'ytt',
      value: 0,
      currency: 'DKK'
    }
  };

  // Add Meta ad attribution if available
  if (lead.meta_ad_id) eventData.custom_data.ad_id = lead.meta_ad_id;
  if (lead.meta_campaign) eventData.custom_data.campaign_name = lead.meta_campaign;
  if (lead.meta_form_id) eventData.custom_data.form_id = lead.meta_form_id;

  await sendToPixel(pixelId, accessToken, eventData);

  // Also send to offline event set if configured
  await sendToOfflineEventSet(accessToken, eventData);
}

/**
 * Send a conversion/status-change event to Meta CAPI.
 * Called when a lead's status is updated in the admin panel.
 *
 * Maps lead statuses to Meta custom events:
 *   - "Qualified" → QualifiedLead
 *   - "Converted" / converted:true → Lead converted (Purchase-like)
 *   - "Application Sent" → ApplicationSubmitted
 *   - "Booked" → Schedule (appointment booked)
 *
 * @param {Object} lead — Full lead document from Firestore
 * @param {string} leadId — Firestore document ID
 * @param {Object} updates — The fields being updated
 */
async function sendLeadStatusEvent(lead, leadId, updates) {
  const pixelId = process.env.META_PIXEL_ID;
  const accessToken = process.env.META_ACCESS_TOKEN;
  if (!pixelId || !accessToken) return;

  const eventName = resolveStatusEventName(updates, lead);
  if (!eventName) return; // Not a trackable status change

  const eventData = {
    event_name: eventName,
    event_time: Math.floor(Date.now() / 1000),
    event_id: `${eventName.toLowerCase()}_${leadId}_${Date.now()}`,
    action_source: 'system_generated',
    user_data: buildUserData(lead),
    custom_data: {
      lead_event_source: lead.source || 'unknown',
      content_name: lead.ytt_program_type || lead.program || '',
      content_category: lead.type || 'ytt',
      status: updates.status || lead.status || '',
      value: 0,
      currency: 'DKK'
    }
  };

  if (lead.meta_ad_id) eventData.custom_data.ad_id = lead.meta_ad_id;
  if (lead.meta_campaign) eventData.custom_data.campaign_name = lead.meta_campaign;

  await sendToPixel(pixelId, accessToken, eventData);
  await sendToOfflineEventSet(accessToken, eventData);
}

/**
 * Map lead status updates to Meta event names.
 */
function resolveStatusEventName(updates, lead) {
  // Conversion takes priority
  if (updates.converted === true) return 'Purchase';
  if (updates.status === 'Qualified') return 'QualifiedLead';
  if (updates.status === 'Application Sent') return 'SubmitApplication';
  if (updates.status === 'Booked') return 'Schedule';
  if (updates.status === 'Contacted') return 'Contact';
  return null;
}

/**
 * Build hashed user_data object for Meta CAPI.
 */
function buildUserData(lead) {
  const data = {};
  if (lead.email) data.em = [sha256(lead.email)];
  if (lead.phone) data.ph = [sha256(normalizePhone(lead.phone))];
  if (lead.first_name) data.fn = [sha256(lead.first_name)];
  if (lead.last_name) data.ln = [sha256(lead.last_name)];
  if (lead.city_country) data.ct = [sha256(lead.city_country.split(',')[0])];
  data.country = [sha256('dk')]; // Default country
  return data;
}

/**
 * Normalize phone for Meta hashing (digits only, no spaces/dashes/plus).
 */
function normalizePhone(phone) {
  if (!phone) return '';
  return phone.replace(/[\s\-\+\(\)]/g, '');
}

/**
 * Send event to Meta Conversions API via the Pixel endpoint.
 */
async function sendToPixel(pixelId, accessToken, eventData) {
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${pixelId}/events?access_token=${accessToken}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: [eventData] })
    });
    const result = await response.json();

    if (!response.ok) {
      console.error('[meta-events] CAPI error:', JSON.stringify(result));
    } else {
      console.log(`[meta-events] CAPI ${eventData.event_name} sent — events_received: ${result.events_received}`);
    }
  } catch (err) {
    console.error(`[meta-events] CAPI ${eventData.event_name} failed:`, err.message);
  }
}

/**
 * Send event to Meta Offline Event Set (if configured).
 * Uses the same Graph API but targets the offline event set ID.
 */
async function sendToOfflineEventSet(accessToken, eventData) {
  const offlineSetId = process.env.META_OFFLINE_EVENT_SET_ID;
  if (!offlineSetId) return;

  // Offline events use upload_tag for grouping
  const offlineEvent = {
    ...eventData,
    match_keys: eventData.user_data, // Offline API uses match_keys instead of user_data
    event_time: eventData.event_time
  };
  delete offlineEvent.user_data;
  delete offlineEvent.action_source;

  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${offlineSetId}/events?access_token=${accessToken}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        upload_tag: `yogabible_leads_${new Date().toISOString().slice(0, 10)}`,
        data: [offlineEvent]
      })
    });
    const result = await response.json();

    if (!response.ok) {
      console.error('[meta-events] Offline event error:', JSON.stringify(result));
    } else {
      console.log(`[meta-events] Offline ${eventData.event_name} sent — events_received: ${result.events_received}`);
    }
  } catch (err) {
    console.error(`[meta-events] Offline ${eventData.event_name} failed:`, err.message);
  }
}

module.exports = { sendLeadEvent, sendLeadStatusEvent, sha256 };
