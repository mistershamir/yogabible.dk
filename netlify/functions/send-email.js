/**
 * Send Email Endpoint — Yoga Bible
 * Supports two delivery providers:
 *   provider: 'gmail'  — nodemailer + Gmail SMTP (1:1 personal sends, shows in sent folder)
 *   provider: 'resend' — Resend batch API (bulk campaigns, inbox-optimised, no Gmail clutter)
 *
 * POST /.netlify/functions/send-email
 * Body (template):  { leadId, templateId, [provider] }
 * Body (custom):    { leadId, subject, bodyHtml, [provider] }
 * Body (bulk):      { leadIds: [...], subject, bodyHtml, provider: 'gmail'|'resend', [campaignId] }
 * Body (list):      { listIds: [...], subject, bodyHtml, provider: 'resend', [campaignId] }
 * Body (test):      { test: true, testEmail, subject, bodyHtml }
 */

const { requireAuth } = require('./shared/auth');
const { getDb } = require('./shared/firestore');
const { sendTemplateEmail, sendCustomEmail, substituteVars } = require('./shared/email-service');
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
    const campaignId = payload.campaignId || null;

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

    // ── Bulk send to email list contacts ──────────────────────────────────
    if (payload.listIds && Array.isArray(payload.listIds)) {
      return await handleBulkList(payload, campaignId);
    }

    // ── Bulk send to leads ────────────────────────────────────────────────
    if (payload.leadIds && Array.isArray(payload.leadIds)) {
      return provider === 'resend'
        ? await handleBulkResend(payload, 'lead', campaignId)
        : await handleBulkGmail(payload, 'lead', campaignId);
    }
    if (payload.applicationIds && Array.isArray(payload.applicationIds)) {
      return provider === 'resend'
        ? await handleBulkResend(payload, 'application', campaignId)
        : await handleBulkGmail(payload, 'application', campaignId);
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
      result = await sendSingleViaResend({
        to: record.email,
        subject: substituteVars(payload.subject, vars),
        bodyHtml: substituteVars(payload.bodyHtml, vars),
        bodyPlain: payload.bodyPlain || '',
        leadId: isApp ? null : docId,
        campaignId
      });
    } else if (payload.templateId) {
      result = await sendTemplateEmail({ to: record.email, templateId: payload.templateId, vars, leadId: isApp ? null : docId });
    } else if (payload.subject && payload.bodyHtml) {
      result = await sendCustomEmail({ to: record.email, subject: payload.subject, bodyHtml: payload.bodyHtml, bodyPlain: payload.bodyPlain || '', leadId: isApp ? null : docId, campaignId });
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

// ─── Bulk send to email list contacts ────────────────────────────────────────
// Fetches contacts from email_list_contacts, sends via Resend (always).

async function handleBulkList(payload, campaignId) {
  const db = getDb();

  if (!payload.subject || !payload.bodyHtml) {
    return jsonResponse(400, { ok: false, error: 'subject and bodyHtml required for list send' });
  }

  const results = { sent: 0, failed: 0, skipped: 0, errors: [] };

  // Fetch contacts from all specified lists
  const allContacts = [];
  const seenEmails = new Set();

  for (const listId of payload.listIds) {
    const snap = await db.collection('email_list_contacts')
      .where('list_id', '==', listId)
      .where('status', '==', 'active')
      .get();

    snap.forEach(doc => {
      const data = doc.data();
      const email = (data.email || '').toLowerCase();
      if (!email || seenEmails.has(email)) {
        results.skipped++;
        return;
      }
      seenEmails.add(email);
      allContacts.push({ contactId: doc.id, ...data });
    });
  }

  if (allContacts.length === 0) {
    return jsonResponse(200, { ok: true, results, provider: 'resend' });
  }

  // Build recipients in the same format sendBulkViaResend expects
  const recipients = allContacts.map(c => ({
    id: c.contactId,
    record: {
      email: c.email,
      first_name: c.first_name || '',
      last_name: c.last_name || '',
      program: '',
      cohort_label: ''
    },
    isApp: false,
    isListContact: true
  }));

  const bulkResults = await sendBulkViaResend(recipients, {
    subjectTemplate: payload.subject,
    bodyHtmlTemplate: payload.bodyHtml,
    bodyPlainTemplate: payload.bodyPlain || '',
    campaignId
  });

  // Update engagement stats on contacts (fire-and-forget)
  const now = new Date().toISOString();
  const BATCH_SIZE = 400;
  for (let i = 0; i < allContacts.length; i += BATCH_SIZE) {
    const chunk = allContacts.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const contact of chunk) {
      const ref = db.collection('email_list_contacts').doc(contact.contactId);
      batch.update(ref, {
        'engagement.emails_sent': (contact.engagement ? contact.engagement.emails_sent || 0 : 0) + 1,
        'engagement.last_sent_at': now
      });
    }
    batch.commit().catch(err => console.error('[send-email] Engagement update error:', err.message));
  }

  return jsonResponse(200, { ok: true, results: bulkResults, provider: 'resend', listContactsSent: allContacts.length });
}

// ─── Resend bulk handler ─────────────────────────────────────────────────────
// Fetches all leads in parallel, then sends via Resend batch API (100/call).

async function handleBulkResend(payload, source, campaignId) {
  const db = getDb();
  const isApp = source === 'application';
  const ids = isApp ? payload.applicationIds : payload.leadIds;
  const collection = isApp ? 'applications' : 'leads';

  if (!payload.subject || !payload.bodyHtml) {
    return jsonResponse(400, { ok: false, error: 'subject and bodyHtml required for bulk Resend send' });
  }

  // Fetch all lead docs in parallel (much faster than sequential)
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
    bodyPlainTemplate: payload.bodyPlain || '',
    campaignId
  });

  return jsonResponse(200, { ok: true, results, provider: 'resend' });
}

// ─── Gmail bulk handler ──────────────────────────────────────────────────────

async function handleBulkGmail(payload, source, campaignId) {
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
        await sendCustomEmail({ to: record.email, subject: payload.subject, bodyHtml: payload.bodyHtml, bodyPlain: payload.bodyPlain || '', leadId: isApp ? null : id, campaignId });
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
