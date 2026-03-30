/**
 * Fix SMS Refund Language + Quick Follow-up English
 *
 * POST /.netlify/functions/fix-sms-and-quickfollowup
 * Auth: X-Internal-Secret header
 *
 * 1. Overwrites SMS on Onboarding step 5 (index 4) — clean version, no refund language
 * 2. Overwrites SMS on July step 4 (index 3) — clean version, no refund language
 * 3. Ensures Quick Follow-up has email_subject_en + email_body_en
 * 4. Fixes exit conditions on ALL sequences → approved 6 statuses
 * 5. Fixes channel mismatches → sms→email/both when email content exists
 */

const { getDb } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');

var CORRECT_EXIT_CONDITIONS = [
  'Converted',
  'Existing Applicant',
  'Unsubscribed',
  'Lost',
  'Closed',
  'Archived'
];

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  var secret = process.env.AI_INTERNAL_SECRET;
  var provided = (event.headers['x-internal-secret'] || event.headers['X-Internal-Secret'] || '').trim();
  if (!secret || provided !== secret) {
    return jsonResponse(401, { error: 'Unauthorized' });
  }

  var db = getDb();
  var results = { sms_fixes: [], quickfollowup: null, exit_conditions: [], channel_fixes: [] };

  // ══════════════════════════════════════════════════════════════════════════
  // FIX 1: Onboarding step 5 (index 4) — clean SMS
  // ══════════════════════════════════════════════════════════════════════════

  var onboardingRef = db.collection('sequences').doc('Un1xmmriIpUyy2Kui97N');
  var onboardingSnap = await onboardingRef.get();

  if (onboardingSnap.exists) {
    var onbData = onboardingSnap.data();
    var onbSteps = onbData.steps || [];

    if (onbSteps.length > 4) {
      var oldSms4 = onbSteps[4].sms_message || '';
      onbSteps[4].sms_message = 'Hi {{first_name}}, har du fundet det format der passer dig? Husk vores Forberedelsesfase (3.750 kr) \u2014 bel\u00F8bet tr\u00E6kkes fra den fulde pris. /Shamir';

      results.sms_fixes.push({
        sequence: 'YTT Onboarding \u2014 2026',
        step_index: 4,
        previous_sms: oldSms4,
        new_sms: onbSteps[4].sms_message
      });

      await onboardingRef.update({ steps: onbSteps, updated_at: new Date().toISOString() });
    }
  } else {
    results.sms_fixes.push({ sequence: 'YTT Onboarding', status: 'not_found', id: 'Un1xmmriIpUyy2Kui97N' });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // FIX 2: July Vinyasa Plus step 4 (index 3) — clean SMS
  // ══════════════════════════════════════════════════════════════════════════

  var julyRef = db.collection('sequences').doc('Yoq6RCVqTYlF10OPmkSw');
  var julySnap = await julyRef.get();

  if (julySnap.exists) {
    var julData = julySnap.data();
    var julSteps = julData.steps || [];

    if (julSteps.length > 3) {
      var oldSms3 = julSteps[3].sms_message || '';
      julSteps[3].sms_message = 'Hi {{first_name}}, just a heads up \u2014 July spots are filling up. The Preparation Phase (3,750 DKK) secures your place \u2014 the amount is deducted from the full price. Any questions? /Shamir, Yoga Bible';

      results.sms_fixes.push({
        sequence: 'July Vinyasa Plus \u2014 International Nurture',
        step_index: 3,
        previous_sms: oldSms3,
        new_sms: julSteps[3].sms_message
      });

      await julyRef.update({ steps: julSteps, updated_at: new Date().toISOString() });
    }
  } else {
    results.sms_fixes.push({ sequence: 'July Vinyasa Plus', status: 'not_found', id: 'Yoq6RCVqTYlF10OPmkSw' });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // FIX 3: Quick Follow-up — ensure English + German content exists
  // ══════════════════════════════════════════════════════════════════════════

  var qfSnap = await db.collection('sequences')
    .where('name', '==', 'YTT Quick Follow-up').limit(1).get();

  if (!qfSnap.empty) {
    var qfDoc = qfSnap.docs[0];
    var qfData = qfDoc.data();
    var qfSteps = qfData.steps || [];

    if (qfSteps.length > 0) {
      var oldEnSubject = qfSteps[0].email_subject_en || '';
      var oldEnBody = qfSteps[0].email_body_en || '';
      var oldDeSubject = qfSteps[0].email_subject_de || '';
      var oldDeBody = qfSteps[0].email_body_de || '';

      qfSteps[0].email_subject_en = 'Did you get everything, {{first_name}}?';
      qfSteps[0].email_body_en = '<p>Hi {{first_name}},</p><p>It\u2019s Shamir from Yoga Bible. Just wanted to make sure you received the schedule and information we sent?</p><p>If you have any questions about the education, just reply here \u2014 or call me directly at +45 53 88 12 09.</p>';

      qfSteps[0].email_subject_de = 'Hast du alles bekommen, {{first_name}}?';
      qfSteps[0].email_body_de = '<p>Hi {{first_name}},</p><p>Hier ist Shamir von Yoga Bible. Ich wollte nur kurz sichergehen, dass du den Zeitplan und alle Infos bekommen hast, die wir dir geschickt haben?</p><p>Falls du Fragen zur Ausbildung hast, antworte einfach hier \u2014 oder ruf mich direkt an unter +45 53 88 12 09.</p>';

      await qfDoc.ref.update({ steps: qfSteps, updated_at: new Date().toISOString() });

      results.quickfollowup = {
        id: qfDoc.id,
        status: 'updated',
        previous_en_subject: oldEnSubject || '(empty)',
        previous_en_body: oldEnBody ? oldEnBody.substring(0, 50) + '...' : '(empty)',
        new_en_subject: qfSteps[0].email_subject_en,
        new_en_body_preview: qfSteps[0].email_body_en.substring(0, 60) + '...',
        previous_de_subject: oldDeSubject || '(empty)',
        previous_de_body: oldDeBody ? oldDeBody.substring(0, 50) + '...' : '(empty)',
        new_de_subject: qfSteps[0].email_subject_de,
        new_de_body_preview: qfSteps[0].email_body_de.substring(0, 60) + '...'
      };
    }
  } else {
    results.quickfollowup = { status: 'not_found' };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // FIX 4: Exit conditions on ALL sequences
  // ══════════════════════════════════════════════════════════════════════════

  var allSeqSnap = await db.collection('sequences').get();

  for (var i = 0; i < allSeqSnap.docs.length; i++) {
    var doc = allSeqSnap.docs[i];
    var data = doc.data();
    var needsUpdate = false;
    var updateData = {};

    // Check exit conditions
    var currentExit = data.exit_conditions || [];
    var exitMatch = currentExit.length === CORRECT_EXIT_CONDITIONS.length &&
      CORRECT_EXIT_CONDITIONS.every(function (c) { return currentExit.includes(c); });

    if (!exitMatch) {
      updateData.exit_conditions = CORRECT_EXIT_CONDITIONS;
      needsUpdate = true;
      results.exit_conditions.push({
        id: doc.id,
        name: data.name || doc.id,
        previous: currentExit,
        updated_to: CORRECT_EXIT_CONDITIONS
      });
    }

    // Check channel mismatches
    var steps = data.steps || [];
    var stepsChanged = false;

    for (var s = 0; s < steps.length; s++) {
      var step = steps[s];
      var hasEmailBody = !!(step.email_body || step.email_body_en);
      var hasSms = !!step.sms_message;
      var channel = step.channel || 'email';

      if (hasEmailBody && channel === 'sms') {
        var newChannel = hasSms ? 'both' : 'email';
        results.channel_fixes.push({
          sequence: data.name || doc.id,
          step_index: s,
          previous_channel: channel,
          new_channel: newChannel,
          da_subject: step.email_subject || '(none)'
        });
        steps[s].channel = newChannel;
        stepsChanged = true;
      }
    }

    if (stepsChanged) {
      updateData.steps = steps;
      needsUpdate = true;
    }

    if (needsUpdate) {
      updateData.updated_at = new Date().toISOString();
      await doc.ref.update(updateData);
    }
  }

  return jsonResponse(200, {
    ok: true,
    sms_fixes: results.sms_fixes,
    quickfollowup: results.quickfollowup,
    exit_conditions_updated: results.exit_conditions.length,
    exit_conditions_detail: results.exit_conditions,
    channel_fixes_applied: results.channel_fixes.length,
    channel_fixes_detail: results.channel_fixes
  });
};
