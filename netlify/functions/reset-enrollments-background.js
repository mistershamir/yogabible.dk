/**
 * Reset Incorrectly Advanced Enrollments — Netlify Background Function (15-min timeout)
 *
 * POST /.netlify/functions/reset-enrollments-background              — execute
 * POST /.netlify/functions/reset-enrollments-background?dry_run=true — preview only
 *
 * Auth: X-Internal-Secret header
 *
 * Fixes enrollments that were silently advanced past empty steps.
 * Resets current_step to 1, clears step_history, recalculates next_send_at from now.
 *
 * Targets:
 *   1. All batch_migration enrollments (bulk-enrolled existing leads)
 *   2. Any new_lead / status_change enrollments where current_step > 1
 *      but step_history shows no actual email/SMS was delivered
 */

const { getDb, serverTimestamp } = require('./shared/firestore');
const { optionsResponse } = require('./shared/utils');

const ENROLLMENTS_COL = 'sequence_enrollments';
const SEQUENCES_COL = 'sequences';

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ ok: false, error: 'POST only' }) };
  }

  // Auth
  var secret = (event.headers || {})['x-internal-secret'] || (event.headers || {})['X-Internal-Secret'] || '';
  if (!secret || secret !== process.env.AI_INTERNAL_SECRET) {
    return { statusCode: 401, body: JSON.stringify({ ok: false, error: 'Unauthorized' }) };
  }

  var params = event.queryStringParameters || {};
  var dryRun = params.dry_run === 'true';

  // Return 202 immediately, do work async
  doReset(dryRun).catch(function (err) {
    console.error('[reset-enrollments] Fatal error:', err);
  });

  return {
    statusCode: 202,
    body: JSON.stringify({ ok: true, message: dryRun ? 'Dry run started' : 'Reset started', check: 'system/last_enrollment_reset' })
  };
};

async function doReset(dryRun) {
  var db = getDb();
  var now = new Date();
  var results = { batch_migration: { total: 0, reset: 0, skipped: 0 }, auto_enrolled: { total: 0, reset: 0, skipped: 0 }, errors: [] };

  // Cache sequence definitions for step delay lookup
  var seqCache = {};

  async function getSequence(seqId) {
    if (seqCache[seqId]) return seqCache[seqId];
    var doc = await db.collection(SEQUENCES_COL).doc(seqId).get();
    if (!doc.exists) return null;
    seqCache[seqId] = doc.data();
    return seqCache[seqId];
  }

  function calcNextSendAt(sequence) {
    var firstStep = sequence.steps && sequence.steps[0];
    var delayMin = (firstStep && firstStep.delay_minutes) || 0;
    var delayDays = (firstStep && firstStep.delay_days) || 0;
    var delayHours = (firstStep && firstStep.delay_hours) || 0;

    var date = new Date(now.getTime());
    if (delayMin > 0 && delayDays === 0 && delayHours === 0) {
      date = new Date(date.getTime() + delayMin * 60 * 1000);
    } else {
      date.setDate(date.getDate() + delayDays);
      date.setHours(date.getHours() + delayHours);
    }
    return date.toISOString();
  }

  // Helper: check if step_history has any real sends
  function hasRealSends(stepHistory) {
    if (!stepHistory || !Array.isArray(stepHistory) || stepHistory.length === 0) return false;
    for (var i = 0; i < stepHistory.length; i++) {
      var h = stepHistory[i];
      // A real send would have been logged to email_log/sms_log with a success result
      // The bug recorded result:'sent' even when nothing was sent, so we can't trust that.
      // Instead, check if the step_history entry has an error — if no error, it was the
      // silent advancement bug. But more reliably: if email_body was empty, no email_log
      // entry exists. We can't query email_log here efficiently, so we rely on the fact
      // that ALL seed sequences had empty email_body — any advancement was false.
      // For safety, we still check: if result is 'email_failed' or 'sms_failed', something
      // was actually attempted.
      if (h.result === 'email_failed' || h.result === 'sms_failed') return true;
    }
    return false;
  }

  try {
    // ── 1. Reset all batch_migration enrollments ──────────────────────────
    console.log('[reset-enrollments] Fetching batch_migration enrollments...');
    var batchSnap = await db.collection(ENROLLMENTS_COL)
      .where('trigger', '==', 'batch_migration')
      .get();

    results.batch_migration.total = batchSnap.size;
    console.log('[reset-enrollments] Found ' + batchSnap.size + ' batch_migration enrollments');

    for (var i = 0; i < batchSnap.docs.length; i++) {
      var doc = batchSnap.docs[i];
      var data = doc.data();

      try {
        var sequence = await getSequence(data.sequence_id);
        if (!sequence) {
          results.errors.push({ id: doc.id, error: 'Sequence not found: ' + data.sequence_id });
          results.batch_migration.skipped++;
          continue;
        }

        // Skip if already completed/exited — don't resurrect
        if (data.status === 'completed' || data.status === 'exited') {
          results.batch_migration.skipped++;
          continue;
        }

        // Skip if still on step 1 with empty history — nothing to fix
        if (data.current_step === 1 && (!data.step_history || data.step_history.length === 0)) {
          results.batch_migration.skipped++;
          continue;
        }

        var newNextSendAt = calcNextSendAt(sequence);

        if (!dryRun) {
          await db.collection(ENROLLMENTS_COL).doc(doc.id).update({
            current_step: 1,
            step_history: [],
            status: 'active',
            next_send_at: newNextSendAt,
            updated_at: now.toISOString()
          });
        }

        results.batch_migration.reset++;
        if (results.batch_migration.reset <= 5) {
          console.log('[reset-enrollments] ' + (dryRun ? '[DRY] ' : '') + 'Reset batch enrollment ' + doc.id + ' (was step ' + data.current_step + ')');
        }
      } catch (err) {
        results.errors.push({ id: doc.id, error: err.message });
      }
    }

    // ── 2. Reset auto-enrolled leads that were falsely advanced ───────────
    console.log('[reset-enrollments] Fetching auto-enrolled enrollments (new_lead, status_change)...');
    var autoSnap1 = await db.collection(ENROLLMENTS_COL)
      .where('trigger', '==', 'new_lead')
      .get();

    var autoSnap2 = await db.collection(ENROLLMENTS_COL)
      .where('trigger', '==', 'status_change')
      .get();

    var autoDocs = autoSnap1.docs.concat(autoSnap2.docs);
    results.auto_enrolled.total = autoDocs.length;
    console.log('[reset-enrollments] Found ' + autoDocs.length + ' auto-enrolled enrollments');

    for (var j = 0; j < autoDocs.length; j++) {
      var aDoc = autoDocs[j];
      var aData = aDoc.data();

      try {
        // Only fix enrollments that were advanced past step 1
        if (aData.current_step <= 1) {
          results.auto_enrolled.skipped++;
          continue;
        }

        // Skip completed/exited
        if (aData.status === 'completed' || aData.status === 'exited') {
          results.auto_enrolled.skipped++;
          continue;
        }

        // Check if any real sends happened
        if (hasRealSends(aData.step_history)) {
          results.auto_enrolled.skipped++;
          continue;
        }

        var aSeq = await getSequence(aData.sequence_id);
        if (!aSeq) {
          results.errors.push({ id: aDoc.id, error: 'Sequence not found: ' + aData.sequence_id });
          results.auto_enrolled.skipped++;
          continue;
        }

        var aNextSendAt = calcNextSendAt(aSeq);

        if (!dryRun) {
          await db.collection(ENROLLMENTS_COL).doc(aDoc.id).update({
            current_step: 1,
            step_history: [],
            status: 'active',
            next_send_at: aNextSendAt,
            updated_at: now.toISOString()
          });
        }

        results.auto_enrolled.reset++;
        if (results.auto_enrolled.reset <= 5) {
          console.log('[reset-enrollments] ' + (dryRun ? '[DRY] ' : '') + 'Reset auto enrollment ' + aDoc.id + ' (trigger: ' + aData.trigger + ', was step ' + aData.current_step + ')');
        }
      } catch (err) {
        results.errors.push({ id: aDoc.id, error: err.message });
      }
    }

    // ── Write results to Firestore ───────────────────────────────────────
    var summary = {
      dry_run: dryRun,
      ran_at: serverTimestamp(),
      batch_migration: results.batch_migration,
      auto_enrolled: results.auto_enrolled,
      total_reset: results.batch_migration.reset + results.auto_enrolled.reset,
      errors: results.errors.slice(0, 50)
    };

    await db.collection('system').doc('last_enrollment_reset').set(summary);
    console.log('[reset-enrollments] Done. ' + (dryRun ? '[DRY RUN] ' : '') +
      'Batch reset: ' + results.batch_migration.reset + '/' + results.batch_migration.total +
      ', Auto reset: ' + results.auto_enrolled.reset + '/' + results.auto_enrolled.total +
      ', Errors: ' + results.errors.length);

  } catch (err) {
    console.error('[reset-enrollments] Fatal:', err);
    await db.collection('system').doc('last_enrollment_reset').set({
      dry_run: dryRun,
      ran_at: serverTimestamp(),
      error: err.message
    });
  }
}
