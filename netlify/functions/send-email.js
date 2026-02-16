/**
 * Send Email Endpoint — Yoga Bible
 * Admin endpoint for sending emails to leads.
 * Supports template-based and custom emails.
 *
 * POST /.netlify/functions/send-email
 * Body (template):  { leadId, templateId }
 * Body (custom):    { leadId, subject, bodyHtml, bodyPlain }
 * Body (bulk):      { leadIds: [...], templateId } or { leadIds: [...], subject, bodyHtml }
 */

const { requireAuth } = require('./shared/auth');
const { getDb } = require('./shared/firestore');
const { sendTemplateEmail, sendCustomEmail } = require('./shared/email-service');
const { jsonResponse, optionsResponse } = require('./shared/utils');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();
  if (event.httpMethod !== 'POST') return jsonResponse(405, { ok: false, error: 'Method not allowed' });

  // Auth check — admin or marketing
  const authResult = await requireAuth(event, ['admin', 'marketing']);
  if (authResult.error) return authResult.error;

  try {
    const payload = JSON.parse(event.body || '{}');

    // Bulk send
    if (payload.leadIds && Array.isArray(payload.leadIds)) {
      return await handleBulkSend(payload);
    }

    // Single send
    if (!payload.leadId) {
      return jsonResponse(400, { ok: false, error: 'leadId is required' });
    }

    // Look up lead
    const db = getDb();
    const leadDoc = await db.collection('leads').doc(payload.leadId).get();
    if (!leadDoc.exists) {
      return jsonResponse(404, { ok: false, error: 'Lead not found' });
    }

    const lead = leadDoc.data();
    if (!lead.email) {
      return jsonResponse(400, { ok: false, error: 'Lead has no email address' });
    }

    // Check unsubscribed
    if (lead.unsubscribed) {
      return jsonResponse(400, { ok: false, error: 'Lead is unsubscribed — cannot send email' });
    }

    let result;

    if (payload.templateId) {
      // Template-based send
      const vars = {
        first_name: lead.first_name || '',
        last_name: lead.last_name || '',
        program: lead.program || '',
        cohort: lead.cohort_label || '',
        email: lead.email,
        ...payload.vars  // allow overrides
      };

      result = await sendTemplateEmail({
        to: lead.email,
        templateId: payload.templateId,
        vars,
        leadId: payload.leadId
      });
    } else if (payload.subject && payload.bodyHtml) {
      // Custom email
      result = await sendCustomEmail({
        to: lead.email,
        subject: payload.subject,
        bodyHtml: payload.bodyHtml,
        bodyPlain: payload.bodyPlain || '',
        leadId: payload.leadId
      });
    } else {
      return jsonResponse(400, { ok: false, error: 'Provide templateId or (subject + bodyHtml)' });
    }

    // Update lead's last_contact
    await db.collection('leads').doc(payload.leadId).update({
      last_contact: new Date(),
      updated_at: new Date()
    });

    return jsonResponse(200, { ok: true, ...result });
  } catch (err) {
    console.error('[send-email] Error:', err);
    return jsonResponse(500, { ok: false, error: err.message });
  }
};

async function handleBulkSend(payload) {
  const db = getDb();
  const results = { sent: 0, failed: 0, skipped: 0, errors: [] };

  for (const leadId of payload.leadIds) {
    try {
      const leadDoc = await db.collection('leads').doc(leadId).get();
      if (!leadDoc.exists) { results.skipped++; continue; }

      const lead = leadDoc.data();
      if (!lead.email || lead.unsubscribed) { results.skipped++; continue; }

      const vars = {
        first_name: lead.first_name || '',
        last_name: lead.last_name || '',
        program: lead.program || '',
        cohort: lead.cohort_label || '',
        email: lead.email
      };

      if (payload.templateId) {
        await sendTemplateEmail({ to: lead.email, templateId: payload.templateId, vars, leadId });
      } else if (payload.subject && payload.bodyHtml) {
        await sendCustomEmail({ to: lead.email, subject: payload.subject, bodyHtml: payload.bodyHtml, bodyPlain: payload.bodyPlain || '', leadId });
      }

      await db.collection('leads').doc(leadId).update({ last_contact: new Date(), updated_at: new Date() });
      results.sent++;
    } catch (err) {
      results.failed++;
      results.errors.push({ leadId, error: err.message });
    }
  }

  return jsonResponse(200, { ok: true, results });
}
