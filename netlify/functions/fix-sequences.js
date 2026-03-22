/**
 * Fix Sequences — Update exit conditions + channel fields
 *
 * POST /.netlify/functions/fix-sequences
 * Auth: X-Internal-Secret header
 *
 * 1. Updates exit_conditions on ALL sequences to the approved 6 statuses
 * 2. Fixes channel mismatches: if a step has email_body content but channel is "sms",
 *    changes channel to "both" (preserves SMS if sms_message also exists) or "email"
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
  var results = { exit_conditions: [], channel_fixes: [] };

  // ── Load all sequences ──────────────────────────────────────────────────
  var seqSnap = await db.collection('sequences').get();

  for (var i = 0; i < seqSnap.docs.length; i++) {
    var doc = seqSnap.docs[i];
    var data = doc.data();
    var docRef = doc.ref;
    var needsUpdate = false;
    var updateData = {};

    // ── Fix 1: Exit conditions ──────────────────────────────────────────
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

    // ── Fix 2: Channel mismatches ───────────────────────────────────────
    var steps = data.steps || [];
    var stepsChanged = false;

    for (var s = 0; s < steps.length; s++) {
      var step = steps[s];
      var hasEmailBody = !!(step.email_body || step.email_body_en);
      var hasSms = !!step.sms_message;
      var channel = step.channel || 'email';

      // If step has email content but channel is "sms", fix it
      if (hasEmailBody && channel === 'sms') {
        var newChannel = hasSms ? 'both' : 'email';
        results.channel_fixes.push({
          sequence: data.name || doc.id,
          step_index: s,
          previous_channel: channel,
          new_channel: newChannel,
          has_email_body: true,
          has_sms: hasSms,
          da_subject: step.email_subject || '(none)',
          en_subject: step.email_subject_en || '(none)'
        });
        steps[s].channel = newChannel;
        stepsChanged = true;
      }
    }

    if (stepsChanged) {
      updateData.steps = steps;
      needsUpdate = true;
    }

    // ── Write changes ───────────────────────────────────────────────────
    if (needsUpdate) {
      updateData.updated_at = new Date().toISOString();
      await docRef.update(updateData);
    }
  }

  return jsonResponse(200, {
    ok: true,
    exit_conditions_updated: results.exit_conditions.length,
    channel_fixes_applied: results.channel_fixes.length,
    exit_conditions_detail: results.exit_conditions,
    channel_fixes_detail: results.channel_fixes
  });
};
