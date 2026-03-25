/**
 * Fix Danish Quick Follow-up sent to international leads
 *
 * POST /.netlify/functions/fix-danish-quickfollowup
 * Auth: X-Internal-Secret header
 *
 * 1. Finds email_log entries for Quick Follow-up (sequence Ue0CYOsPJlnj5SF9PtA0)
 *    where lang='da' was logged
 * 2. Cross-references each lead's country via detectLeadCountry()
 * 3. For non-DK leads: sends a short apology email in English (or German for DE/AT/CH)
 *
 * Query param: ?dry=1 to preview without sending
 */

const { getDb } = require('./shared/firestore');
const { detectLeadCountry } = require('./shared/country-detect');
const { sendSingleViaResend } = require('./shared/resend-service');
const { prepareTrackedEmail } = require('./shared/email-tracking');
const { jsonResponse, optionsResponse } = require('./shared/utils');

var QUICK_FOLLOWUP_SEQ_ID = 'Ue0CYOsPJlnj5SF9PtA0';

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  var secret = process.env.AI_INTERNAL_SECRET;
  var provided = (event.headers['x-internal-secret'] || event.headers['X-Internal-Secret'] || '').trim();
  if (!secret || provided !== secret) {
    return jsonResponse(401, { error: 'Unauthorized' });
  }

  var dry = (event.queryStringParameters || {}).dry === '1';
  var db = getDb();

  // Find all email_log entries for Quick Follow-up sequence
  var logSnap = await db.collection('email_log')
    .where('sequence_id', '==', QUICK_FOLLOWUP_SEQ_ID)
    .where('status', '==', 'sent')
    .get();

  if (logSnap.empty) {
    return jsonResponse(200, { ok: true, message: 'No Quick Follow-up emails found in log', affected: 0 });
  }

  var affected = [];
  var sent = [];
  var errors = [];

  for (var i = 0; i < logSnap.docs.length; i++) {
    var logEntry = logSnap.docs[i].data();
    var leadId = logEntry.lead_id;
    if (!leadId) continue;

    // Load lead
    var leadDoc = await db.doc('leads/' + leadId).get();
    if (!leadDoc.exists) continue;
    var lead = leadDoc.data();

    // Check country
    var country = detectLeadCountry(lead);
    if (country === 'DK') continue; // Correctly received Danish — skip

    // Check explicit lang — if they explicitly set DA, it was intentional
    var explicitLang = (lead.lang || lead.meta_lang || lead.language || '').toLowerCase().trim();
    if (['da', 'dk'].includes(explicitLang)) continue;

    // This lead is international but got Danish Quick Follow-up
    var isGerman = ['DE', 'AT', 'CH'].includes(country);
    var firstName = lead.first_name || lead.name || '';

    affected.push({
      lead_id: leadId,
      email: lead.email,
      name: firstName,
      country: country,
      lang_field: explicitLang || '(empty)',
      will_send: isGerman ? 'de' : 'en'
    });

    if (dry) continue;

    // Build corrective email
    var subject, body;

    if (isGerman) {
      subject = 'Kurze Korrektur, ' + (firstName || 'hi') + ' \u2014 hier nochmal auf Deutsch';
      body = '<p>Hallo' + (firstName ? ' ' + firstName : '') + ',</p>'
        + '<p>Wir haben dir vorhin versehentlich eine E-Mail auf D\u00E4nisch geschickt \u2014 Entschuldigung daf\u00FCr!</p>'
        + '<p>Hier nochmal kurz auf Deutsch: Ich wollte nur sichergehen, dass du den Zeitplan und alle Infos bekommen hast, die wir dir geschickt haben.</p>'
        + '<p>Falls du Fragen zur Ausbildung hast, antworte einfach hier \u2014 oder ruf mich direkt an unter <a href="tel:+4553881209" style="color:#f75c03;">+45 53 88 12 09</a>.</p>'
        + '<br><br>Shamir, Course Director \u00B7 Yoga Bible<br>Torvegade 66, Christianshavn<br>1400 K\u00F8benhavn K';
    } else {
      subject = 'Quick correction, ' + (firstName || 'hi') + ' \u2014 here in English';
      body = '<p>Hi' + (firstName ? ' ' + firstName : '') + ',</p>'
        + '<p>We accidentally sent you an email in Danish earlier \u2014 sorry about that!</p>'
        + '<p>Just wanted to make sure you received the schedule and information we sent. If you have any questions about the training, just reply here \u2014 or call me directly at <a href="tel:+4553881209" style="color:#f75c03;">+45 53 88 12 09</a>.</p>'
        + '<br><br>Shamir, Course Director \u00B7 Yoga Bible<br>Torvegade 66, Christianshavn<br>1400 K\u00F8benhavn K';
    }

    // Add tracking
    var trackedBody = prepareTrackedEmail(body, leadId, 'fix:quickfollowup-lang');

    try {
      await sendSingleViaResend({
        to: lead.email,
        subject: subject,
        bodyHtml: trackedBody,
        bodyPlain: ''
      });

      // Log it
      await db.collection('email_log').add({
        lead_id: leadId,
        to: lead.email,
        subject: subject,
        template_id: 'fix:quickfollowup-lang-correction',
        sent_at: new Date(),
        status: 'sent',
        source: 'fix',
        lang: isGerman ? 'de' : 'en'
      });

      sent.push(lead.email);
    } catch (err) {
      errors.push({ email: lead.email, error: err.message });
    }
  }

  return jsonResponse(200, {
    ok: true,
    dry_run: dry,
    total_quickfollowup_emails: logSnap.docs.length,
    international_affected: affected.length,
    affected: affected,
    sent: dry ? [] : sent,
    errors: dry ? [] : errors
  });
};
