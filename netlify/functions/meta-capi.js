/**
 * Netlify Function: POST /.netlify/functions/meta-capi
 * Server-side relay for Meta Conversions API (CAPI).
 *
 * Receives events from the client and forwards them to Meta's Graph API,
 * bypassing ad-blockers and iOS tracking restrictions.
 *
 * Required Netlify environment variables:
 *   META_PIXEL_ID      — Your Meta Pixel ID
 *   META_ACCESS_TOKEN   — System User access token from Events Manager
 *
 * POST body:
 *   event_name (string) — Meta standard event name (e.g. "Lead", "Purchase", "PageView")
 *   event_id (string)   — Deduplication ID (should match fbq event_id on client side)
 *   event_source_url (string) — Page URL where event occurred
 *   user_data (object)  — Hashed user data (email, phone, etc.)
 *   custom_data (object) — Event-specific data (value, currency, content_name, etc.)
 */

let firestoreDb = null;
function getDb() {
  if (!firestoreDb) {
    try {
      const { getFirestore } = require('./shared/firestore');
      firestoreDb = getFirestore();
    } catch (e) { /* Firestore not available — skip storage */ }
  }
  return firestoreDb;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

exports.handler = async function (event) {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  const PIXEL_ID = process.env.META_PIXEL_ID;
  const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;

  if (!PIXEL_ID || !ACCESS_TOKEN) {
    console.warn('Meta CAPI: Missing META_PIXEL_ID or META_ACCESS_TOKEN env vars');
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ ok: true, skipped: true, reason: 'not_configured' })
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Invalid JSON' })
    };
  }

  const {
    event_name,
    event_id,
    event_source_url,
    user_data = {},
    custom_data = {}
  } = body;

  if (!event_name) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'event_name is required' })
    };
  }

  // Build the CAPI event payload
  const eventData = {
    event_name: event_name,
    event_time: Math.floor(Date.now() / 1000),
    action_source: 'website',
    event_source_url: event_source_url || '',
    user_data: {
      // Client IP and user agent are added server-side for accuracy
      client_ip_address: (event.headers['x-forwarded-for'] || event.headers['x-nf-client-connection-ip'] || '').split(',')[0].trim(),
      client_user_agent: event.headers['user-agent'] || '',
      // Pass through any hashed user data from the client
      ...user_data
    },
    custom_data: custom_data
  };

  // Add deduplication event_id if provided
  if (event_id) {
    eventData.event_id = event_id;
  }

  // Forward to Meta Conversions API
  const url = `https://graph.facebook.com/v25.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: [eventData] })
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('Meta CAPI error:', JSON.stringify(result));
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({ ok: false, error: result.error?.message || 'Meta API error' })
      };
    }

    // Store Purchase/Lead events in Firestore for admin dashboard
    if (event_name === 'Purchase' || event_name === 'Lead' || event_name === 'InitiateCheckout') {
      try {
        const db = getDb();
        if (db) {
          await db.collection('ad_conversions').add({
            conversion_action: event_name.toLowerCase(),
            transaction_id: event_id || '',
            value: parseFloat(custom_data.value) || 0,
            currency: custom_data.currency || 'DKK',
            content_name: custom_data.content_name || '',
            content_category: custom_data.content_category || '',
            conversion_time: new Date().toISOString(),
            page_url: event_source_url || '',
            hashed_email: (user_data.em && user_data.em[0]) || '',
            client_ip: eventData.user_data.client_ip_address || '',
            user_agent: eventData.user_data.client_user_agent || '',
            platform: 'meta',
            created_at: new Date().toISOString()
          });
        }
      } catch (storeErr) {
        console.warn('Meta CAPI: Firestore storage error:', storeErr.message);
      }
    }

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ ok: true, events_received: result.events_received })
    };
  } catch (err) {
    console.error('Meta CAPI fetch error:', err.message);
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ ok: false, error: 'Network error' })
    };
  }
};
