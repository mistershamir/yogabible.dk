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
const { sendSMSToLead, sendSMSToApplication, sendSMS, normalizePhone } = require('./shared/sms-service');
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

    // Test mode — send to test phone without logging to any lead
    if (payload.test && payload.testPhone) {
      const normalized = normalizePhone(payload.testPhone);
      if (!normalized) {
        return jsonResponse(400, { ok: false, error: 'Invalid test phone number' });
      }
      const testResult = await sendSMS(normalized, payload.message);
      return jsonResponse(200, { ok: true, test: true, ...testResult });
    }

    // Bulk send (leads)
    if (payload.leadIds && Array.isArray(payload.leadIds)) {
      return await handleBulkSMS(payload, 'lead');
    }

    // Bulk send (applications)
    if (payload.applicationIds && Array.isArray(payload.applicationIds)) {
      return await handleBulkSMS(payload, 'application');
    }

    // Single send (application)
    if (payload.applicationId) {
      const result = await sendSMSToApplication(payload.applicationId, payload.message);
      if (result.success) {
        return jsonResponse(200, { ok: true, ...result });
      } else {
        return jsonResponse(400, { ok: false, error: result.error });
      }
    }

    // Single send (lead)
    if (!payload.leadId) {
      return jsonResponse(400, { ok: false, error: 'leadId, leadIds, applicationId, or applicationIds is required' });
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

async function handleBulkSMS(payload, source) {
  const results = { sent: 0, failed: 0, skipped: 0, errors: [] };
  const ids = source === 'application' ? payload.applicationIds : payload.leadIds;
  const sendFn = source === 'application' ? sendSMSToApplication : sendSMSToLead;

  for (const id of ids) {
    try {
      const result = await sendFn(id, payload.message);

      if (result.success) {
        results.sent++;
      } else {
        results.failed++;
        results.errors.push({ id, error: result.error });
      }

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (err) {
      results.failed++;
      results.errors.push({ id, error: err.message });
    }
  }

  return jsonResponse(200, { ok: true, results });
}
