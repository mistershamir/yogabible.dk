/**
 * Resend Email Service — Yoga Bible
 * Sends emails via Resend's REST API (api.resend.com).
 * Uses the same HTML helpers (signature, unsubscribe, etc.) as email-service.js
 * so both providers produce identical-looking emails.
 *
 * Required env vars:
 *   RESEND_API_KEY   — API key from resend.com (starts with "re_")
 *   RESEND_FROM      — (optional) override from address, default: GMAIL_USER
 *
 * Setup checklist:
 *   1. Create account at resend.com
 *   2. Add & verify your domain (yogabible.dk) — adds SPF/DKIM automatically
 *   3. Copy the API key into Netlify → Site Settings → Env variables as RESEND_API_KEY
 *   4. Set RESEND_FROM to e.g. "Yoga Bible <hej@yogabible.dk>"
 */

const https = require('https');
const { CONFIG } = require('./config');
const { buildUnsubscribeUrl } = require('./utils');
const { getDb } = require('./firestore');
const {
  getSignatureHtml,
  getSignaturePlain,
  getEnglishNoteHtml,
  getEnglishNotePlain,
  getUnsubscribeFooterHtml,
  getUnsubscribeFooterPlain,
  substituteVars
} = require('./email-service');

// ─── Low-level Resend HTTP helper ────────────────────────────────────────────

function resendPost(path, body) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY env var not set. Add it in Netlify → Site settings → Environment variables.');

  const bodyStr = JSON.stringify(body);

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.resend.com',
        path,
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + apiKey,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr)
        }
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(json);
            } else {
              reject(new Error(json.message || json.name || 'Resend API error ' + res.statusCode));
            }
          } catch (e) {
            reject(new Error('Resend response parse error: ' + data.slice(0, 200)));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

// ─── Build a single Resend message payload ───────────────────────────────────

function buildResendMessage({ to, subject, html, text }) {
  const from = process.env.RESEND_FROM ||
    ('"' + CONFIG.FROM_NAME + '" <' + (process.env.GMAIL_USER || CONFIG.EMAIL_FROM) + '>');

  // reply_to = the Gmail inbox so replies land there, not in Resend
  const replyTo = process.env.GMAIL_USER || CONFIG.EMAIL_FROM;

  const unsubUrl = buildUnsubscribeUrl(to);

  return {
    from,
    to: [to],
    subject,
    html,
    text,
    reply_to: replyTo,
    headers: {
      'List-Unsubscribe': '<' + unsubUrl + '>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
    }
  };
}

// ─── Wrap body HTML with standard signature + unsubscribe ────────────────────

function wrapHtml(bodyHtml, recipientEmail) {
  return '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;line-height:1.65;font-size:16px;">' +
    bodyHtml +
    getEnglishNoteHtml() +
    getSignatureHtml() +
    getUnsubscribeFooterHtml(recipientEmail) +
    '</div>';
}

function wrapText(bodyPlain, recipientEmail) {
  return bodyPlain + getEnglishNotePlain() + getSignaturePlain() + getUnsubscribeFooterPlain(recipientEmail);
}

// ─── Send a single email via Resend ──────────────────────────────────────────

async function sendSingleViaResend({ to, subject, bodyHtml, bodyPlain, leadId }) {
  const html = wrapHtml(bodyHtml, to);
  const text = wrapText(bodyPlain || '', to);

  const message = buildResendMessage({ to, subject, html, text });
  const result = await resendPost('/emails', message);

  await logResendEmail({ to, subject, leadId, messageId: result.id });
  return { success: true, messageId: result.id };
}

// ─── Bulk send via Resend batch API ──────────────────────────────────────────
// Sends up to 100 messages per Resend batch call.
// leads = array of { id, collection, record } objects where record is the Firestore doc data.

async function sendBulkViaResend(recipients, { subjectTemplate, bodyHtmlTemplate, bodyPlainTemplate }) {
  const db = getDb();
  const results = { sent: 0, failed: 0, skipped: 0, errors: [] };

  const BATCH_SIZE = 100;

  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    const chunk = recipients.slice(i, i + BATCH_SIZE);
    const messages = [];
    const meta = []; // track which leads correspond to each message for logging

    for (const { id, record, isApp } of chunk) {
      if (!record.email) { results.skipped++; continue; }
      if (!isApp && record.unsubscribed) { results.skipped++; continue; }

      const vars = {
        first_name: record.first_name || '',
        last_name: record.last_name || '',
        program: record.program || record.course_name || record.program_type || '',
        cohort: record.cohort_label || record.cohort || '',
        email: record.email
      };

      const subject = substituteVars(subjectTemplate, vars);
      const bodyHtml = substituteVars(bodyHtmlTemplate, vars);
      const bodyPlain = substituteVars(bodyPlainTemplate || '', vars);

      messages.push(buildResendMessage({
        to: record.email,
        subject,
        html: wrapHtml(bodyHtml, record.email),
        text: wrapText(bodyPlain, record.email)
      }));

      meta.push({ id, isApp, email: record.email, subject });
    }

    if (messages.length === 0) continue;

    try {
      // Send the whole batch in one API call
      await resendPost('/emails/batch', messages);

      // Update Firestore + log — don't let these failures block the count
      for (const { id, isApp, email, subject } of meta) {
        try {
          const collection = isApp ? 'applications' : 'leads';
          const updates = { updated_at: new Date() };
          if (!isApp) updates.last_contact = new Date();
          await db.collection(collection).doc(id).update(updates);
          await logResendEmail({ to: email, subject, leadId: isApp ? null : id, messageId: null });
        } catch (logErr) {
          console.error('[resend] Post-send update error for', id, ':', logErr.message);
        }
        results.sent++;
      }
    } catch (batchErr) {
      console.error('[resend] Batch send error:', batchErr.message);
      for (const { email } of meta) {
        results.failed++;
        results.errors.push({ id: email, error: batchErr.message });
      }
    }
  }

  return results;
}

// ─── Email log ───────────────────────────────────────────────────────────────

async function logResendEmail({ to, subject, leadId, messageId }) {
  try {
    const db = getDb();
    await db.collection('email_log').add({
      to,
      subject,
      lead_id: leadId || null,
      message_id: messageId || null,
      sent_at: new Date(),
      provider: 'resend',
      status: 'sent'
    });
  } catch (err) {
    console.error('[resend] Log error:', err.message);
  }
}

module.exports = { sendSingleViaResend, sendBulkViaResend };
