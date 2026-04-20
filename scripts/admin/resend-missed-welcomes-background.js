/**
 * Resend Missed Welcome Emails — One-time background function
 *
 * Finds leads created since April 8, 2026 that have zero welcome emails
 * in email_log, and re-sends using the same sendWelcomeEmail() function.
 *
 * POST /.netlify/functions/resend-missed-welcomes-background
 * POST /.netlify/functions/resend-missed-welcomes-background?dry_run=true
 *
 * Protected by X-Internal-Secret header.
 */

const crypto = require('crypto');
const { getDb } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');
const { sendWelcomeEmail } = require('./shared/lead-emails');
const { sendWelcomeSMS } = require('./shared/sms-service');

const TOKEN_SECRET = process.env.UNSUBSCRIBE_SECRET || 'yb-appt-secret';

// Cutoff: April 8, 2026 20:31 UTC — when the blocking catch was deployed
var CUTOFF = new Date('2026-04-08T20:31:00Z');

function generateScheduleToken(leadId, email) {
  var hmac = crypto.createHmac('sha256', TOKEN_SECRET);
  hmac.update(leadId + ':' + (email || '').toLowerCase().trim());
  return hmac.digest('hex');
}

function yttTypeToAction(programType) {
  switch (programType) {
    case '18-week':      return 'lead_schedule_18w';
    case '18-week-aug':  return 'lead_schedule_18w-aug';
    case '8-week':       return 'lead_schedule_8w';
    case '4-week':       return 'lead_schedule_4w';
    case '4-week-jul':   return 'lead_schedule_4w-jul';
    case '300h':         return 'lead_schedule_300h';
    case '50h':          return 'lead_schedule_50h';
    case '30h':          return 'lead_schedule_30h';
    case 'undecided':    return 'lead_undecided';
    default:             return 'lead_meta';
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { ok: false, error: 'POST only' });
  }

  var secret = event.headers['x-internal-secret'] || event.headers['X-Internal-Secret'] || '';
  if (!secret || secret !== process.env.AI_INTERNAL_SECRET) {
    return jsonResponse(401, { ok: false, error: 'Unauthorized' });
  }

  var params = event.queryStringParameters || {};
  var dryRun = params.dry_run === 'true';
  var db = getDb();

  console.log('[resend-welcomes] Starting' + (dryRun ? ' (DRY RUN)' : ''));

  try {
    // Find leads created since the cutoff
    var leadsSnap = await db.collection('leads')
      .where('created_at', '>=', CUTOFF)
      .get();

    console.log('[resend-welcomes] Found ' + leadsSnap.size + ' leads since cutoff');

    var candidates = [];

    for (var i = 0; i < leadsSnap.docs.length; i++) {
      var doc = leadsSnap.docs[i];
      var lead = doc.data();
      var leadId = doc.id;

      if (!lead.email) continue;

      // Check if this lead has any welcome email in email_log
      var emailLogSnap = await db.collection('email_log')
        .where('to', '==', lead.email.toLowerCase().trim())
        .where('template_id', '==', 'auto_welcome')
        .limit(1)
        .get();

      if (!emailLogSnap.empty) continue; // Already received welcome email

      // Also check by lead_id in case 'to' doesn't match exactly
      var emailLogByIdSnap = await db.collection('email_log')
        .where('lead_id', '==', leadId)
        .where('template_id', '==', 'auto_welcome')
        .limit(1)
        .get();

      if (!emailLogByIdSnap.empty) continue;

      candidates.push({ id: leadId, lead: lead });
    }

    console.log('[resend-welcomes] ' + candidates.length + ' leads missing welcome emails');

    var results = { sent: 0, failed: 0, skipped: 0, details: [] };

    for (var j = 0; j < candidates.length; j++) {
      var c = candidates[j];
      var leadId = c.id;
      var lead = c.lead;

      // Determine the email action from program type
      var action = yttTypeToAction(lead.ytt_program_type || '');

      // Generate schedule token
      var token = generateScheduleToken(leadId, lead.email);
      var tokenData = { leadId: leadId, token: token };

      var detail = {
        lead_id: leadId,
        email: lead.email,
        name: ((lead.first_name || '') + ' ' + (lead.last_name || '')).trim(),
        program: lead.ytt_program_type || lead.program || '',
        lang: lead.lang || lead.meta_lang || '',
        action: action,
        source: lead.source || ''
      };

      if (dryRun) {
        detail.status = 'would_send';
        results.details.push(detail);
        results.sent++;
        continue;
      }

      try {
        // Save schedule_token if missing
        if (!lead.schedule_token) {
          await db.collection('leads').doc(leadId).update({ schedule_token: token }).catch(function () {});
        }

        // Send welcome email
        var emailResult = await sendWelcomeEmail(lead, action, tokenData);
        detail.email_result = emailResult;

        if (emailResult && emailResult.success) {
          results.sent++;
          detail.status = 'sent';
        } else {
          results.failed++;
          detail.status = 'failed';
          detail.error = (emailResult && emailResult.reason) || 'unknown';
        }

        // Also send welcome SMS if they have a phone and didn't get one
        if (lead.phone && process.env.GATEWAYAPI_TOKEN) {
          var smsLogSnap = await db.collection('sms_log')
            .where('lead_id', '==', leadId)
            .where('source', '==', 'welcome')
            .limit(1)
            .get();

          if (smsLogSnap.empty) {
            var smsResult = await sendWelcomeSMS(lead, leadId).catch(function (e) {
              return { success: false, error: e.message };
            });
            detail.sms_result = smsResult;
          }
        }
      } catch (err) {
        results.failed++;
        detail.status = 'error';
        detail.error = err.message;
      }

      results.details.push(detail);

      // Small delay between sends to avoid rate limiting
      if (j < candidates.length - 1) {
        await new Promise(function (r) { setTimeout(r, 500); });
      }
    }

    console.log('[resend-welcomes] Done. Sent: ' + results.sent + ', Failed: ' + results.failed);
    return jsonResponse(200, { ok: true, dry_run: dryRun, results: results });

  } catch (err) {
    console.error('[resend-welcomes] Fatal error:', err);
    return jsonResponse(500, { ok: false, error: err.message });
  }
};
