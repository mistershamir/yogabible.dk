/**
 * Netlify Function: POST /.netlify/functions/instagram-icebreakers
 *
 * One-time admin utility to set up Instagram Ice Breakers via the Graph API.
 *
 * Ice Breakers are conversation-starter prompts shown to users the first time
 * they open a DM thread with your Instagram account. When a user taps one,
 * it sends a message to your webhook — triggering the welcome greeting.
 *
 * This is the key to the "welcome new follower" flow:
 *   1. New follower opens DM → sees Ice Breaker prompts
 *   2. Taps a prompt → sends message to webhook
 *   3. Webhook detects first-time sender → sends personalized welcome
 *
 * POST body (optional):
 *   action: "set" (default) | "get" | "delete"
 *
 * Auth: Requires X-Admin-Key header matching INSTAGRAM_ADMIN_KEY env var
 *
 * Usage (run once after deploy):
 *   curl -X POST https://yogabibledk.netlify.app/.netlify/functions/instagram-icebreakers \
 *     -H "Content-Type: application/json" \
 *     -H "X-Admin-Key: YOUR_ADMIN_KEY" \
 *     -d '{"action":"set"}'
 */

const { IG_API_BASE, corsHeaders, jsonResponse } = require('./shared/instagram-api');

// Ice Breaker prompts — bilingual conversation starters
// Instagram shows these in the user's own language if locale is available,
// but we provide them in both DA and EN to cover our audience.
const ICE_BREAKERS = [
  {
    question: "Fortæl mig om jeres yogauddannelser / Tell me about your yoga trainings",
    payload: "ICE_TRAININGS"
  },
  {
    question: "Hvilke kurser tilbyder I? / What courses do you offer?",
    payload: "ICE_COURSES"
  },
  {
    question: "Hvor ligger jeres studie? / Where is your studio?",
    payload: "ICE_LOCATION"
  },
  {
    question: "Hvad koster det? / What are the prices?",
    payload: "ICE_PRICING"
  }
];

exports.handler = async function (event) {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  // Admin auth
  const adminKey = event.headers['x-admin-key'] || event.headers['X-Admin-Key'];
  if (!process.env.INSTAGRAM_ADMIN_KEY || adminKey !== process.env.INSTAGRAM_ADMIN_KEY) {
    return jsonResponse(401, { error: 'Unauthorized — provide X-Admin-Key header' });
  }

  const igAccountId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
  const accessToken = process.env.META_ACCESS_TOKEN;

  if (!igAccountId || !accessToken) {
    return jsonResponse(500, { error: 'Missing INSTAGRAM_BUSINESS_ACCOUNT_ID or META_ACCESS_TOKEN' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (err) {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  const action = body.action || 'set';

  // ----- GET current Ice Breakers -----
  if (action === 'get') {
    try {
      const res = await fetch(
        `${IG_API_BASE}/${igAccountId}/messenger_profile?fields=ice_breakers&access_token=${accessToken}`
      );
      const data = await res.json();

      if (!res.ok) {
        console.error('[ig-icebreakers] GET failed:', res.status, JSON.stringify(data));
        return jsonResponse(res.status, { error: data.error?.message || 'Failed to get ice breakers' });
      }

      console.log('[ig-icebreakers] Current ice breakers:', JSON.stringify(data));
      return jsonResponse(200, { success: true, data });
    } catch (err) {
      console.error('[ig-icebreakers] GET error:', err.message);
      return jsonResponse(500, { error: err.message });
    }
  }

  // ----- DELETE Ice Breakers -----
  if (action === 'delete') {
    try {
      const res = await fetch(
        `${IG_API_BASE}/${igAccountId}/messenger_profile`,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fields: ['ice_breakers'],
            access_token: accessToken
          })
        }
      );
      const data = await res.json();

      if (!res.ok) {
        console.error('[ig-icebreakers] DELETE failed:', res.status, JSON.stringify(data));
        return jsonResponse(res.status, { error: data.error?.message || 'Failed to delete ice breakers' });
      }

      console.log('[ig-icebreakers] Ice breakers deleted');
      return jsonResponse(200, { success: true, message: 'Ice breakers deleted' });
    } catch (err) {
      console.error('[ig-icebreakers] DELETE error:', err.message);
      return jsonResponse(500, { error: err.message });
    }
  }

  // ----- SET Ice Breakers -----
  try {
    const res = await fetch(
      `${IG_API_BASE}/${igAccountId}/messenger_profile`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ice_breakers: ICE_BREAKERS,
          access_token: accessToken
        })
      }
    );
    const data = await res.json();

    if (!res.ok) {
      console.error('[ig-icebreakers] SET failed:', res.status, JSON.stringify(data));
      return jsonResponse(res.status, {
        error: data.error?.message || 'Failed to set ice breakers',
        details: data
      });
    }

    console.log('[ig-icebreakers] Ice breakers set successfully:', JSON.stringify(ICE_BREAKERS.map(ib => ib.question)));
    return jsonResponse(200, {
      success: true,
      message: 'Ice breakers configured',
      iceBreakers: ICE_BREAKERS
    });
  } catch (err) {
    console.error('[ig-icebreakers] SET error:', err.message);
    return jsonResponse(500, { error: err.message });
  }
};
