/**
 * SMS Service — Yoga Bible
 * Sends SMS via GatewayAPI EU (Danish SMS provider)
 *
 * Required env vars:
 *   GATEWAYAPI_TOKEN  — GatewayAPI EU bearer token
 *   SMS_SENDER        — Sender phone (default: +4553881209)
 */

const { AUTO_SMS_CONFIG, getDisplayProgram } = require('./config');
const { getDb } = require('./firestore');
const { formatDate } = require('./utils');

const GATEWAYAPI_ENDPOINT = 'https://gatewayapi.eu/rest/mtsms';

/**
 * Clean and normalize phone number to MSISDN format
 * Default country code: +45 (Denmark)
 */
function normalizePhone(phone) {
  let clean = String(phone || '').replace(/^'/, '').replace(/\s+/g, '').replace(/[^\d+]/g, '');

  if (!clean) return null;

  if (!clean.startsWith('+')) {
    if (clean.startsWith('00')) {
      clean = '+' + clean.substring(2);
    } else if (clean.length <= 8) {
      clean = '+45' + clean;
    } else {
      clean = '+' + clean;
    }
  }

  // Must be at least 10 digits (country code + number)
  if (clean.replace('+', '').length < 8) return null;

  return clean;
}

/**
 * Send a single SMS via GatewayAPI EU
 */
async function sendSMS(phone, message) {
  const token = process.env.GATEWAYAPI_TOKEN;
  if (!token) {
    throw new Error('GATEWAYAPI_TOKEN env var not set');
  }

  const normalized = normalizePhone(phone);
  if (!normalized) {
    return { success: false, error: 'Invalid phone number: ' + phone };
  }

  const msisdn = normalized.replace('+', '');
  const sender = process.env.SMS_SENDER || '+4553881209';

  const payload = {
    sender: sender,
    message: message,
    recipients: [{ msisdn: msisdn }]
  };

  try {
    const response = await fetch(GATEWAYAPI_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Token ' + token
      },
      body: JSON.stringify(payload)
    });

    const responseText = await response.text();
    console.log(`[sms] GatewayAPI response: ${response.status} - ${responseText}`);

    if (response.status === 200) {
      const result = JSON.parse(responseText);
      return {
        success: true,
        messageId: result.ids ? result.ids[0] : null,
        message: 'SMS sent successfully'
      };
    } else {
      let errorMsg = 'SMS send failed: ' + response.status;
      try {
        const errorData = JSON.parse(responseText);
        errorMsg = errorData.message || errorData.error || errorMsg;
      } catch (e) {}
      return { success: false, error: errorMsg };
    }
  } catch (err) {
    console.error('[sms] GatewayAPI error:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Send welcome SMS to a new lead (auto-triggered on form submission)
 */
async function sendWelcomeSMS(leadData, leadDocId) {
  if (!AUTO_SMS_CONFIG.enabled) {
    return { success: false, reason: 'disabled' };
  }

  const phone = normalizePhone(leadData.phone);
  if (!phone) {
    console.log(`[sms] No valid phone for lead ${leadDocId}`);
    await updateLeadSMSStatus(leadDocId, 'no_phone');
    return { success: false, reason: 'no_phone' };
  }

  // Determine language: use lang field (set by website modal or meta_lang from ads)
  // Danish if lang === 'da', German if lang === 'de' or country is AT/CH, otherwise English
  var rawLang = (leadData.lang || leadData.meta_lang || 'en').toLowerCase().substring(0, 2);
  const lang = (rawLang === 'de' || ['at', 'ch'].includes(rawLang)) ? 'de' : rawLang;

  // Select template based on lead type
  const program = String(leadData.program || '').toLowerCase();
  let templateKey = 'default';

  // Multi-format YTT request (user asked for multiple schedules)
  const isMulti = leadData.all_formats && leadData.all_formats.includes(',');

  // Detect if international lead (non-DK country)
  const leadCountry = (leadData.country || '').toUpperCase();
  const isDK = !leadCountry || leadCountry === 'DK' || leadCountry === 'DENMARK' || leadCountry === 'DANMARK';

  if (isMulti) {
    templateKey = 'ytt_multi';
  } else if (program.includes('week') || program.includes('uge') || program.includes('ytt') ||
      program.includes('200') || program.includes('300') || program.includes('teacher training') ||
      program.includes('intensive') || program.includes('flexible') ||
      leadData.type === 'ytt') {
    // International YTT leads get online consultation link instead of physical info meeting
    templateKey = (!isDK && lang !== 'da') ? 'ytt_intl' : 'ytt';
  } else if (program.includes('inversion') || program.includes('backbend') || program.includes('split') ||
             program.includes('bundle') || leadData.type === 'course' || leadData.type === 'bundle') {
    templateKey = 'course';
  } else if (program.includes('mentorship') || program.includes('personlig') || leadData.type === 'mentorship') {
    templateKey = 'mentorship';
  }

  // Select language-appropriate template
  const langTemplates = AUTO_SMS_CONFIG.templates[lang] || AUTO_SMS_CONFIG.templates.en;
  const template = langTemplates[templateKey] || langTemplates['default'];
  const firstName = leadData.first_name || (lang === 'da' ? 'der' : 'there');
  // Use getDisplayProgram for clean, human-readable program name
  const programName = getDisplayProgram(leadData, lang);

  const message = template
    .replace(/\{\{first_name\}\}/gi, firstName)
    .replace(/\{\{program\}\}/gi, programName);

  // ── Dedup: check if welcome SMS was already sent to this phone recently ──
  // Prevents duplicate SMS when lead.js or facebook-leads-webhook.js fires
  // multiple times for the same lead (Meta retries, form resubmits).
  try {
    const db = getDb();
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
    const recentSmsSnap = await db.collection('sms_log')
      .where('to', '==', phone)
      .where('source', '==', 'welcome')
      .where('sent_at', '>=', tenMinAgo)
      .where('status', '==', 'sent')
      .limit(1)
      .get();

    if (!recentSmsSnap.empty) {
      console.log(`[sms] Welcome SMS already sent to ${phone} within 10 min — skipping duplicate`);
      return { success: true, reason: 'already_sent' };
    }
  } catch (dedupErr) {
    console.warn('[sms] Welcome SMS dedup check failed (proceeding):', dedupErr.message);
  }

  // Send
  await updateLeadSMSStatus(leadDocId, 'sending');
  const result = await sendSMS(phone, message);

  // Log to sms_log for dedup and audit trail
  try {
    const db = getDb();
    await db.collection('sms_log').add({
      lead_id: leadDocId,
      to: phone,
      message: message.substring(0, 100),
      sent_at: new Date(),
      status: result.success ? 'sent' : 'failed',
      source: 'welcome',
      created_at: new Date()
    });
  } catch (logErr) {
    console.warn('[sms] Failed to log welcome SMS:', logErr.message);
  }

  if (result.success) {
    await updateLeadSMSStatus(leadDocId, 'sent');
    await logSMSToNotes(leadDocId, message.substring(0, 30) + '...', 'sent');
    await logSMSToConversation(leadDocId, message, phone, 'outbound');
    console.log(`[sms] Welcome SMS sent to ${phone} for lead ${leadDocId}`);
  } else {
    await updateLeadSMSStatus(leadDocId, 'failed: ' + (result.error || 'unknown').substring(0, 50));
    console.log(`[sms] Welcome SMS failed for lead ${leadDocId}: ${result.error}`);
  }

  return result;
}

/**
 * Send SMS to a lead by doc ID (admin action)
 */
async function sendSMSToLead(leadDocId, message) {
  const db = getDb();
  const doc = await db.collection('leads').doc(leadDocId).get();

  if (!doc.exists) {
    return { success: false, error: 'Lead not found' };
  }

  const lead = doc.data();
  const phone = normalizePhone(lead.phone);
  if (!phone) {
    return { success: false, error: 'No valid phone number for this lead' };
  }

  // Substitute variables
  const personalizedMessage = message
    .replace(/\{\{first_name\}\}/gi, lead.first_name || 'there')
    .replace(/\{\{name\}\}/gi, lead.first_name || 'there')
    .replace(/\{\{program\}\}/gi, lead.program || '');

  const result = await sendSMS(phone, personalizedMessage);

  if (result.success) {
    await updateLeadSMSStatus(leadDocId, 'sent');
    await logSMSToNotes(leadDocId, personalizedMessage.substring(0, 30) + '...', 'sent');
    // Also write to sms_messages subcollection for conversation UI
    await logSMSToConversation(leadDocId, personalizedMessage, phone, 'outbound');
  }

  return result;
}

/**
 * Send SMS to an application by doc ID (admin action)
 */
async function sendSMSToApplication(appDocId, message) {
  const db = getDb();
  const doc = await db.collection('applications').doc(appDocId).get();

  if (!doc.exists) {
    return { success: false, error: 'Application not found' };
  }

  const app = doc.data();
  const phone = normalizePhone(app.phone);
  if (!phone) {
    return { success: false, error: 'No valid phone number for this application' };
  }

  // Substitute variables
  const personalizedMessage = message
    .replace(/\{\{first_name\}\}/gi, app.first_name || 'there')
    .replace(/\{\{name\}\}/gi, app.first_name || 'there')
    .replace(/\{\{program\}\}/gi, app.course_name || app.program_type || '');

  const result = await sendSMS(phone, personalizedMessage);

  if (result.success) {
    // Log to sms_messages subcollection for conversation UI
    await logSMSToAppConversation(appDocId, personalizedMessage, phone, 'outbound');
    // Update app timestamp
    await db.collection('applications').doc(appDocId).update({ updated_at: new Date() });
  }

  return result;
}

async function logSMSToAppConversation(appDocId, message, phone, direction) {
  try {
    const db = getDb();
    await db.collection('applications').doc(appDocId)
      .collection('sms_messages').add({
        direction: direction,
        message: message,
        phone: phone,
        timestamp: new Date(),
        read: true
      });
  } catch (err) {
    console.error('[sms] Failed to log SMS to app conversation:', err.message);
  }
}

// =========================================================================
// Firestore Helpers
// =========================================================================

async function updateLeadSMSStatus(leadDocId, status) {
  try {
    const db = getDb();
    await db.collection('leads').doc(leadDocId).update({
      sms_status: status,
      updated_at: new Date()
    });
  } catch (err) {
    console.error('[sms] Failed to update SMS status:', err.message);
  }
}

async function logSMSToNotes(leadDocId, messageSummary, status) {
  try {
    const db = getDb();
    const doc = await db.collection('leads').doc(leadDocId).get();
    if (!doc.exists) return;

    const currentNotes = doc.data().notes || '';
    const now = formatDate(new Date());
    const icon = status === 'sent' ? '\ud83d\udcf1' : '\ud83d\udcf2';
    const newNote = `${icon} SMS: ${messageSummary} (${now})`;

    await db.collection('leads').doc(leadDocId).update({
      notes: newNote + '\n' + currentNotes
    });
  } catch (err) {
    console.error('[sms] Failed to log SMS to notes:', err.message);
  }
}

async function logSMSToConversation(leadDocId, message, phone, direction) {
  try {
    const db = getDb();
    await db.collection('leads').doc(leadDocId)
      .collection('sms_messages').add({
        direction: direction,
        message: message,
        phone: phone,
        timestamp: new Date(),
        read: true
      });
  } catch (err) {
    console.error('[sms] Failed to log SMS to conversation:', err.message);
  }
}

module.exports = {
  sendSMS,
  sendWelcomeSMS,
  sendSMSToLead,
  sendSMSToApplication,
  normalizePhone,
  logSMSToConversation,
  logSMSToAppConversation
};
