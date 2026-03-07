/**
 * Send Email Endpoint — Yoga Bible
 * Supports two delivery providers:
 *   provider: 'gmail'  — nodemailer + Gmail SMTP (1:1 personal sends, shows in sent folder)
 *   provider: 'resend' — Resend batch API (bulk campaigns, inbox-optimised, no Gmail clutter)
 *
 * POST /.netlify/functions/send-email
 * Body (template):  { leadId, templateId, [provider] }
 * Body (custom):    { leadId, subject, bodyHtml, [provider] }
 * Body (bulk):      { leadIds: [...], subject, bodyHtml, provider: 'gmail'|'resend' }
 * Body (test):      { test: true, testEmail, subject, bodyHtml }
 */

const { requireAuth } = require('./shared/auth');
const { getDb } = require('./shared/firestore');
const { sendTemplateEmail, sendCustomEmail } = require('./shared/email-service');
const { sendSingleViaResend, sendBulkViaResend } = require('./shared/resend-service');
const { jsonResponse, optionsResponse } = require('./shared/utils');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();
  if (event.httpMethod !== 'POST') return jsonResponse(405, { ok: false, error: 'Method not allowed' });

  const authResult = await requireAuth(event, ['admin', 'marketing']);
  if (authResult.error) return authResult.error;

  try {
    const payload = JSON.parse(event.body || '{}');
    const provider = payload.provider || 'gmail'; // default: gmail for backwards-compat

    // ── Test mode — always uses Gmail (no Resend logging) ──────────────────
    if (payload.test && payload.testEmail) {
      const testResult = await sendCustomEmail({
        to: payload.testEmail,
        subject: payload.subject || '[TEST] Campaign Test',
        bodyHtml: payload.bodyHtml || '<p>Test email content</p>',
        bodyPlain: payload.bodyPlain || 'Test email content'
      });
      return jsonResponse(200, { ok: true, test: true, ...testResult });
    }

    // ── Bulk send ───────────────────────────────────────────────────────────
    if (payload.leadIds && Array.isArray(payload.leadIds)) {
      return provider === 'resend'
        ? await handleBulkResend(payload, 'lead')
        : await handleBulkGmail(payload, 'lead');
    }
    if (payload.applicationIds && Array.isArray(payload.applicationIds)) {
      return provider === 'resend'
        ? await handleBulkResend(payload, 'application')
        : await handleBulkGmail(payload, 'application');
    }

    // ── Single send ─────────────────────────────────────────────────────────
    const db = getDb();
    const isApp = !!payload.applicationId;
    const docId = payload.applicationId || payload.leadId;

    if (!docId) return jsonResponse(400, { ok: false, error: 'leadId or applicationId is required' });

    const collection = isApp ? 'applications' : 'leads';
    const doc = await db.collection(collection).doc(docId).get();
    if (!doc.exists) return jsonResponse(404, { ok: false, error: (isApp ? 'Application' : 'Lead') + ' not found' });

    const record = doc.data();
    if (!record.email) return jsonResponse(400, { ok: false, error: (isApp ? 'Application' : 'Lead') + ' has no email' });
    if (!isApp && record.unsubscribed) return jsonResponse(400, { ok: false, error: 'Lead is unsubscribed' });

    const vars = {
      first_name: record.first_name || '',
      last_name: record.last_name || '',
      program: record.program || record.course_name || record.program_type || '',
      cohort: record.cohort_label || '',
      email: record.email,
      ...payload.vars
    };

    let result;
    if (provider === 'resend') {
      if (!payload.subject || !payload.bodyHtml) {
        return jsonResponse(400, { ok: false, error: 'subject and bodyHtml required for Resend single send' });
      }
      // Apply variable substitution the same way Gmail path does
      const { substituteVars } = require('./shared/email-service');
      result = await sendSingleViaResend({
        to: record.email,
        subject: substituteVars(payload.subject, vars),
        bodyHtml: substituteVars(payload.bodyHtml, vars),
        bodyPlain: payload.bodyPlain || '',
        leadId: isApp ? null : docId
      });
    } else if (payload.templateId) {
      result = await sendTemplateEmail({ to: record.email, templateId: payload.templateId, vars, leadId: isApp ? null : docId });
    } else if (payload.subject && payload.bodyHtml) {
      result = await sendCustomEmail({ to: record.email, subject: payload.subject, bodyHtml: payload.bodyHtml, bodyPlain: payload.bodyPlain || '', leadId: isApp ? null : docId });
    } else {
      return jsonResponse(400, { ok: false, error: 'Provide templateId or (subject + bodyHtml)' });
    }

    const updateFields = { updated_at: new Date() };
    if (!isApp) updateFields.last_contact = new Date();
    await db.collection(collection).doc(docId).update(updateFields);

    return jsonResponse(200, { ok: true, ...result });
  } catch (err) {
    console.error('[send-email] Error:', err);
    return jsonResponse(500, { ok: false, error: err.message });
  }
};

// ─── Resend bulk handler ─────────────────────────────────────────────────────
// Fetches all leads in parallel, then sends via Resend batch API (100/call).

async function handleBulkResend(payload, source) {
  const db = getDb();
  const isApp = source === 'application';
  const ids = isApp ? payload.applicationIds : payload.leadIds;
  const collection = isApp ? 'applications' : 'leads';

  if (!payload.subject || !payload.bodyHtml) {
    return jsonResponse(400, { ok: false, error: 'subject and bodyHtml required for bulk Resend send' });
  }

  // Fetch all lead docs in parallel (much faster than sequential)
  const FETCH_BATCH = 30; // Firestore supports up to 30 in `in` queries, but parallel individual gets is simpler
  const snapshots = await Promise.all(ids.map((id) => db.collection(collection).doc(id).get()));

  const recipients = snapshots
    .map((snap, idx) => ({
      id: ids[idx],
      record: snap.exists ? snap.data() : null,
      isApp
    }))
    .filter((r) => r.record !== null);

  const results = await sendBulkViaResend(recipients, {
    subjectTemplate: payload.subject,
    bodyHtmlTemplate: payload.bodyHtml,
    bodyPlainTemplate: payload.bodyPlain || ''
  });

  return jsonResponse(200, { ok: true, results, provider: 'resend' });
}

// ─── Gmail bulk handler (unchanged from original) ───────────────────────────

async function handleBulkGmail(payload, source) {
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

  return jsonResponse(200, { ok: true, results, provider: 'gmail' });
}
