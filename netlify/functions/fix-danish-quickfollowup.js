/**
 * Fix Danish Quick Follow-up sent to international leads
 *
 * POST /.netlify/functions/fix-danish-quickfollowup
 * Auth: X-Internal-Secret header
 *
 * 1. Finds email_log entries for Quick Follow-up (sequence Ue0CYOsPJlnj5SF9PtA0)
 *    that were sent in Danish (lang='da' or lang missing)
 * 2. Cross-references each lead's country via detectLeadCountry()
 * 3. For non-DK leads: sends a short apology email in English (or German for DE/AT/CH)
 * 4. Skips leads who already received a correction email
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

  // Pre-fetch all lead IDs that already received a correction email (dedup)
  var correctionSnap = await db.collection('email_log')
    .where('template_id', '==', 'fix:quickfollowup-lang-correction')
    .where('status', '==', 'sent')
    .get();
  var alreadyCorrected = {};
  correctionSnap.docs.forEach(function (d) {
    var data = d.data();
    if (data.lead_id) alreadyCorrected[data.lead_id] = true;
  });

  // Collect unique lead IDs from QF sends (avoid duplicate corrections for same lead)
  var leadIds = {};
  for (var i = 0; i < logSnap.docs.length; i++) {
    var logEntry = logSnap.docs[i].data();
    var lid = logEntry.lead_id;
    if (!lid) continue;

    // Only consider emails sent in Danish (lang='da', lang missing, or lang='dk')
    var logLang = (logEntry.lang || '').toLowerCase().trim();
    if (logLang && logLang !== 'da' && logLang !== 'dk') continue;

    if (alreadyCorrected[lid]) continue; // Already sent correction
    leadIds[lid] = true;
  }

  var uniqueLeadIds = Object.keys(leadIds);

  var affected = [];
  var sent = [];
  var errors = [];
  var skipped = [];

  // Process leads in parallel batches of 5 for speed
  for (var b = 0; b < uniqueLeadIds.length; b += 5) {
    var batch = uniqueLeadIds.slice(b, b + 5);
    var promises = batch.map(async function (leadId) {
      var leadDoc = await db.doc('leads/' + leadId).get();
      if (!leadDoc.exists) return;
      var lead = leadDoc.data();

      // Country detection is the source of truth — NOT the lang field
      var country = detectLeadCountry(lead);
      if (country === 'DK') {
        skipped.push({ lead_id: leadId, reason: 'DK country' });
        return;
      }

      var isGerman = ['DE', 'AT', 'CH'].includes(country);
      var firstName = lead.first_name || lead.name || '';
      var langField = (lead.lang || lead.meta_lang || lead.language || '').toLowerCase().trim();

      affected.push({
        lead_id: leadId,
        email: lead.email,
        name: firstName,
        country: country,
        lang_field: langField || '(empty)',
        will_send: isGerman ? 'de' : 'en'
      });

      if (dry) return;

      var subject, body;

      if (isGerman) {
        subject = 'Kurze Korrektur, ' + (firstName || 'hi') + ' \u2014 hier nochmal auf Deutsch';
        body = '<p>Hallo' + (firstName ? ' ' + firstName : '') + ',</p>'
          + '<p>Wir haben dir vorhin versehentlich eine E-Mail auf D\u00E4nisch geschickt \u2014 Entschuldigung daf\u00FCr!</p>'
          + '<p>Hier nochmal kurz auf Deutsch: Ich wollte nur sichergehen, dass du den Zeitplan und alle Infos bekommen hast, die wir dir geschickt haben.</p>'
          + '<p>Falls du Fragen zur Ausbildung hast, antworte einfach hier \u2014 oder ruf mich direkt an unter <a href="tel:+4553881209" style="color:#f75c03;">+45 53 88 12 09</a>.</p>'
          + '<p style="margin-top:24px;padding-top:16px;border-top:1px solid #E8E4E0;color:#6F6A66;font-size:13px;"><em>P.S. Diese E-Mail wurde f\u00FCr dich auf Deutsch verfasst, damit alles leicht verst\u00E4ndlich ist. Ich selbst spreche Englisch \u2014 bitte antworte mir auf Englisch, damit ich dir am besten helfen kann. Wir haben aber auch deutschsprachige Lehrkr\u00E4fte im Studio \u2014 falls du lieber auf Deutsch sprechen m\u00F6chtest, bringe ich dich gerne mit ihnen in Kontakt!</em></p>'
          + '<br><br>Shamir, Course Director \u00B7 Yoga Bible<br>Torvegade 66, Christianshavn<br>1400 K\u00F8benhavn K';
      } else {
        subject = 'Quick correction, ' + (firstName || 'hi') + ' \u2014 here in English';
        body = '<p>Hi' + (firstName ? ' ' + firstName : '') + ',</p>'
          + '<p>We accidentally sent you an email in Danish earlier \u2014 sorry about that!</p>'
          + '<p>Just wanted to make sure you received the schedule and information we sent. If you have any questions about the training, just reply here \u2014 or call me directly at <a href="tel:+4553881209" style="color:#f75c03;">+45 53 88 12 09</a>.</p>'
          + '<br><br>Shamir, Course Director \u00B7 Yoga Bible<br>Torvegade 66, Christianshavn<br>1400 K\u00F8benhavn K';
      }

      var trackedBody = prepareTrackedEmail(body, leadId, 'fix:quickfollowup-lang');

      try {
        await sendSingleViaResend({
          to: lead.email,
          subject: subject,
          bodyHtml: trackedBody,
          bodyPlain: ''
        });

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
    });

    await Promise.all(promises);
  }

  return jsonResponse(200, {
    ok: true,
    dry_run: dry,
    total_quickfollowup_emails: logSnap.docs.length,
    already_corrected: correctionSnap.docs.length,
    unique_leads_to_check: uniqueLeadIds.length,
    international_affected: affected.length,
    affected: affected,
    sent: dry ? [] : sent,
    skipped: skipped,
    errors: dry ? [] : errors
  });
};
