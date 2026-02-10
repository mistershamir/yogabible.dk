/**
 * Netlify Function: POST /.netlify/functions/instagram-send
 *
 * Utility endpoint for sending Instagram DMs programmatically.
 * Use cases:
 *   - Manual DM sending from admin tools
 *   - Triggered campaigns (e.g., event reminders)
 *   - Testing the DM system
 *
 * POST body:
 *   recipientId (string)  - Instagram-scoped user ID
 *   message (string)      - Text message to send
 *   keyword (string)      - Optional: send the pre-configured keyword response
 *   language (string)     - Optional: 'da' or 'en' (default: 'da')
 *   ctaText (string)      - Optional: CTA button label
 *   ctaUrl (string)       - Optional: CTA button URL
 *
 * Auth: Requires X-Admin-Key header matching INSTAGRAM_ADMIN_KEY env var
 */

const { sendTextThenCta, logInteraction, corsHeaders, jsonResponse } = require('./shared/instagram-api');
const dmKeywords = require('../../src/_data/dm-keywords.json');
const dmTemplates = require('../../src/_data/dm-templates.json');

exports.handler = async function (event) {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  // Simple admin auth
  const adminKey = event.headers['x-admin-key'] || event.headers['X-Admin-Key'];
  if (!process.env.INSTAGRAM_ADMIN_KEY || adminKey !== process.env.INSTAGRAM_ADMIN_KEY) {
    return jsonResponse(401, { error: 'Unauthorized — provide X-Admin-Key header' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (err) {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  const { recipientId, message, keyword, language, ctaText, ctaUrl } = body;

  if (!recipientId) {
    return jsonResponse(400, { error: 'recipientId is required' });
  }

  const lang = language || 'da';

  // If keyword is specified, use the pre-configured response
  if (keyword) {
    const keywordUpper = keyword.toUpperCase();
    const keywordConfig = dmKeywords.keywords[keywordUpper];

    if (!keywordConfig) {
      return jsonResponse(400, {
        error: `Unknown keyword: ${keyword}`,
        availableKeywords: Object.keys(dmKeywords.keywords)
      });
    }

    const response = keywordConfig[lang] || keywordConfig.da;
    const result = await sendTextThenCta(recipientId, response.text, response.cta_text, response.cta_url);

    await logInteraction({
      type: 'admin_keyword_send',
      senderId: recipientId,
      keyword: keywordUpper,
      language: lang,
      response: result.success ? 'sent' : 'failed',
      source: 'admin_api'
    });

    if (result.error) {
      return jsonResponse(result.status || 500, { error: result.error });
    }

    return jsonResponse(200, { success: true, keyword: keywordUpper, language: lang });
  }

  // Send custom message
  if (!message) {
    return jsonResponse(400, { error: 'Either message or keyword is required' });
  }

  const result = await sendTextThenCta(recipientId, message, ctaText, ctaUrl);

  await logInteraction({
    type: 'admin_custom_send',
    senderId: recipientId,
    keyword: '',
    language: lang,
    response: result.success ? 'sent' : 'failed',
    source: 'admin_api'
  });

  if (result.error) {
    return jsonResponse(result.status || 500, { error: result.error });
  }

  return jsonResponse(200, { success: true, message: 'Message sent' });
};
