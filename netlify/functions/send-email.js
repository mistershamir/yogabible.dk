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

    // Test mode — send to test email without logging to any lead
    if (payload.test && payload.testEmail) {
      const { sendCustomEmail: sendCustom } = require('./shared/email-service');
      const testResult = await sendCustom({
        to: payload.testEmail,
        subject: payload.subject || '[TEST] Campaign Test',
        bodyHtml: payload.bodyHtml || '<p>Test email content</p>',
        bodyPlain: payload.bodyPlain || 'Test email content'
      });
      return jsonResponse(200, { ok: true, test: true, ...testResult });
    }

    // Bulk send (leads)
    if (payload.leadIds && Array.isArray(payload.leadIds)) {
      return await handleBulkSend(payload, 'lead');
    }

    // Bulk send (applications)
    if (payload.applicationIds && Array.isArray(payload.applicationIds)) {
      return await handleBulkSend(payload, 'application');
    }

    // Determine source: lead or application
    const db = getDb();
    const isApp = !!payload.applicationId;
    const docId = payload.applicationId || payload.leadId;

    if (!docId) {
      return jsonResponse(400, { ok: false, error: 'leadId or applicationId is required' });
    }

    const collection = isApp ? 'applications' : 'leads';
    const doc = await db.collection(collection).doc(docId).get();
    if (!doc.exists) {
      return jsonResponse(404, { ok: false, error: (isApp ? 'Application' : 'Lead') + ' not found' });
    }

    const record = doc.data();
    if (!record.email) {
      return jsonResponse(400, { ok: false, error: (isApp ? 'Application' : 'Lead') + ' has no email address' });
    }

    // Check unsubscribed (leads only — applications don't have this field)
    if (!isApp && record.unsubscribed) {
      return jsonResponse(400, { ok: false, error: 'Lead is unsubscribed — cannot send email' });
    }

    let result;
    const vars = {
      first_name: record.first_name || '',
      last_name: record.last_name || '',
      program: record.program || record.course_name || record.program_type || '',
      cohort: record.cohort_label || '',
      email: record.email,
      ...payload.vars
    };

    if (payload.templateId) {
      result = await sendTemplateEmail({
        to: record.email,
        templateId: payload.templateId,
        vars,
        leadId: isApp ? null : docId
      });
    } else if (payload.subject && payload.bodyHtml) {
      result = await sendCustomEmail({
        to: record.email,
        subject: payload.subject,
        bodyHtml: payload.bodyHtml,
        bodyPlain: payload.bodyPlain || '',
        leadId: isApp ? null : docId
      });
    } else {
      return jsonResponse(400, { ok: false, error: 'Provide templateId or (subject + bodyHtml)' });
    }

    // Update record timestamp
    const updateFields = { updated_at: new Date() };
    if (!isApp) updateFields.last_contact = new Date();
    await db.collection(collection).doc(docId).update(updateFields);

    return jsonResponse(200, { ok: true, ...result });
  } catch (err) {
    console.error('[send-email] Error:', err);
    return jsonResponse(500, { ok: false, error: err.message });
  }
};

async function handleBulkSend(payload, source) {
  const db = getDb();
  const results = { sent: 0, failed: 0, skipped: 0, errors: [] };
  const isApp = source === 'application';
  const ids = isApp ? payload.applicationIds : payload.leadIds;
  const collection = isApp ? 'applications' : 'leads';

  for (const id of ids) {
    try {
      const doc = await db.collection(collection).doc(id).get();
      if (!doc.exists) { results.skipped++; continue; }

      const record = doc.data();
      if (!record.email) { results.skipped++; continue; }
      if (!isApp && record.unsubscribed) { results.skipped++; continue; }

      const vars = {
        first_name: record.first_name || '',
        last_name: record.last_name || '',
        program: record.program || record.course_name || record.program_type || '',
        cohort: record.cohort_label || '',
        email: record.email
      };

      if (payload.templateId) {
        await sendTemplateEmail({ to: record.email, templateId: payload.templateId, vars, leadId: isApp ? null : id });
      } else if (payload.subject && payload.bodyHtml) {
        await sendCustomEmail({ to: record.email, subject: payload.subject, bodyHtml: payload.bodyHtml, bodyPlain: payload.bodyPlain || '', leadId: isApp ? null : id });
      }

      const updateFields = { updated_at: new Date() };
      if (!isApp) updateFields.last_contact = new Date();
      await db.collection(collection).doc(id).update(updateFields);
      results.sent++;
    } catch (err) {
      results.failed++;
      results.errors.push({ id, error: err.message });
    }
  }

  return jsonResponse(200, { ok: true, results });
}
