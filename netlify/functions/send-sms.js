/**
 * Send SMS Endpoint — Yoga Bible
 * Admin endpoint for sending SMS to leads via GatewayAPI EU.
 *
 * POST /.netlify/functions/send-sms
 * Body (single): { leadId, message }
 * Body (bulk):   { leadIds: [...], message }
 */

const { requireAuth } = require('./shared/auth');
const { getDb } = require('./shared/firestore');
const { sendSMSToLead, sendSMS, normalizePhone } = require('./shared/sms-service');
const { jsonResponse, optionsResponse, formatDate } = require('./shared/utils');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();
  if (event.httpMethod !== 'POST') return jsonResponse(405, { ok: false, error: 'Method not allowed' });

  // Auth check — admin or marketing
  const authResult = await requireAuth(event, ['admin', 'marketing']);
  if (authResult.error) return authResult.error;

  try {
    const payload = JSON.parse(event.body || '{}');

    if (!payload.message) {
      return jsonResponse(400, { ok: false, error: 'message is required' });
    }

    // Bulk send
    if (payload.leadIds && Array.isArray(payload.leadIds)) {
      return await handleBulkSMS(payload);
    }

    // Single send
    if (!payload.leadId) {
      return jsonResponse(400, { ok: false, error: 'leadId or leadIds is required' });
    }

    const result = await sendSMSToLead(payload.leadId, payload.message);

    if (result.success) {
      return jsonResponse(200, { ok: true, ...result });
    } else {
      return jsonResponse(400, { ok: false, error: result.error });
    }
  } catch (err) {
    console.error('[send-sms] Error:', err);
    return jsonResponse(500, { ok: false, error: err.message });
  }
};

async function handleBulkSMS(payload) {
  const db = getDb();
  const results = { sent: 0, failed: 0, skipped: 0, errors: [] };

  for (const leadId of payload.leadIds) {
    try {
      const result = await sendSMSToLead(leadId, payload.message);

      if (result.success) {
        results.sent++;
      } else {
        results.failed++;
        results.errors.push({ leadId, error: result.error });
      }

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (err) {
      results.failed++;
      results.errors.push({ leadId, error: err.message });
    }
  }

  return jsonResponse(200, { ok: true, results });
}
