/**
 * Fix Stuck Enrollments — One-time cleanup for pre-fix duplicate sends
 *
 * Background function (15-min timeout) that:
 * 1. Audits ALL active enrollments across all sequences
 * 2. For each, checks email_log to determine the actual last step sent
 * 3. Resets current_step to the correct next step
 * 4. Recalculates next_send_at
 * 5. Marks enrollments as completed if all steps were sent
 * 6. Fixes July DK sequence step 0 missing DA content (subject only)
 *
 * POST /.netlify/functions/fix-stuck-enrollments-background
 * POST /.netlify/functions/fix-stuck-enrollments-background?dry_run=true  — preview only
 *
 * Protected by X-Internal-Secret header.
 */

const { getDb, serverTimestamp } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');

const JULY_DK_SEQUENCE_ID = 'Yoq6RCVqTYlF10OPmkSw';

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { ok: false, error: 'POST only' });
  }

  const secret = event.headers['x-internal-secret'] || event.headers['X-Internal-Secret'] || '';
  if (!secret || secret !== process.env.AI_INTERNAL_SECRET) {
    return jsonResponse(401, { ok: false, error: 'Unauthorized' });
  }

  // Return 202 immediately — background function continues processing
  // (Netlify background functions with -background suffix get 15 min timeout)

  const params = event.queryStringParameters || {};
  const dryRun = params.dry_run === 'true';
  const db = getDb();

  console.log('[fix-stuck] Starting enrollment audit' + (dryRun ? ' (DRY RUN)' : ''));

  try {
    // ── Phase 1: Fix stuck enrollments ──────────────────────────────────

    // Load all active enrollments
    const enrollSnap = await db.collection('sequence_enrollments')
      .where('status', '==', 'active')
      .get();

    console.log('[fix-stuck] Found ' + enrollSnap.size + ' active enrollments');

    // Load all sequences (cached)
    const seqSnap = await db.collection('sequences').get();
    var seqCache = {};
    seqSnap.docs.forEach(function (doc) {
      seqCache[doc.id] = doc.data();
    });

    var fixed = 0;
    var completed = 0;
    var skipped = 0;
    var errors = [];
    var changes = [];

    for (var i = 0; i < enrollSnap.docs.length; i++) {
      var enrollDoc = enrollSnap.docs[i];
      var enrollment = enrollDoc.data();
      var enrollId = enrollDoc.id;
      var seqId = enrollment.sequence_id;

      try {
        var sequence = seqCache[seqId];
        if (!sequence || !sequence.steps) {
          skipped++;
          continue;
        }

        var totalSteps = sequence.steps.length;

        // Query email_log for all emails sent for this enrollment
        var logSnap = await db.collection('email_log')
          .where('lead_id', '==', enrollment.lead_id)
          .where('source', '==', 'sequence')
          .where('sequence_id', '==', seqId)
          .where('status', 'in', ['sent', 'pending'])
          .get();

        if (logSnap.empty) {
          // No emails sent — check if enrollment should have started
          // Leave as-is (step 1, waiting for next_send_at)
          skipped++;
          continue;
        }

        // Parse step numbers from template_id (format: 'sequence:SEQID:stepN')
        var sentSteps = {};
        var maxSentStep = 0;
        var lastSentAt = null;

        logSnap.docs.forEach(function (logDoc) {
          var data = logDoc.data();
          var templateId = data.template_id || '';
          var match = templateId.match(/step(\d+)/);
          if (match) {
            var stepNum = parseInt(match[1], 10);
            sentSteps[stepNum] = (sentSteps[stepNum] || 0) + 1;
            if (stepNum > maxSentStep) maxSentStep = stepNum;
          }
          // Track latest send time
          var sentAt = data.sent_at;
          if (sentAt && sentAt.toDate) sentAt = sentAt.toDate();
          else if (typeof sentAt === 'string') sentAt = new Date(sentAt);
          if (sentAt && (!lastSentAt || sentAt > lastSentAt)) {
            lastSentAt = sentAt;
          }
        });

        // Determine the correct next step
        var correctNextStep = maxSentStep + 1;
        var currentStep = enrollment.current_step || 1;

        // Check if any step was sent more than once (stuck/duplicate)
        var hasDuplicates = false;
        for (var step in sentSteps) {
          if (sentSteps[step] > 1) {
            hasDuplicates = true;
            break;
          }
        }

        // Check if current_step needs correction
        var needsFix = false;
        var reason = '';

        if (correctNextStep > totalSteps) {
          // All steps have been sent — should be completed, not active
          if (enrollment.status === 'active') {
            needsFix = true;
            reason = 'all_steps_sent_but_still_active';
          }
        } else if (currentStep !== correctNextStep) {
          needsFix = true;
          reason = 'step_mismatch (current=' + currentStep + ', should=' + correctNextStep + ')';
        } else if (hasDuplicates && currentStep === maxSentStep) {
          // Step was sent but counter wasn't advanced
          needsFix = true;
          reason = 'stuck_on_sent_step (step ' + maxSentStep + ' sent ' + sentSteps[maxSentStep] + 'x)';
        }

        if (!needsFix) {
          skipped++;
          continue;
        }

        // Calculate the fix
        var updateData = {
          updated_at: new Date().toISOString(),
          processing_lock: null
        };

        if (correctNextStep > totalSteps) {
          // Mark as completed
          updateData.status = 'completed';
          updateData.current_step = totalSteps + 1;
          updateData.next_send_at = null;

          if (!dryRun) {
            await db.collection('sequence_enrollments').doc(enrollId).update(updateData);
          }
          completed++;
        } else {
          // Reset to correct step with proper next_send_at
          var nextStep = sequence.steps[correctNextStep - 1];
          var delayMs = 0;
          if (nextStep) {
            var delayMinutes = nextStep.delay_minutes || 0;
            var delayDays = nextStep.delay_days || 0;
            var delayHours = nextStep.delay_hours || 0;
            if (delayMinutes > 0 && delayDays === 0 && delayHours === 0) {
              delayMs = delayMinutes * 60 * 1000;
            } else {
              delayMs = (delayDays * 24 * 60 + delayHours * 60) * 60 * 1000;
            }
          }
          var nextSendAt = new Date(Date.now() + delayMs);

          updateData.current_step = correctNextStep;
          updateData.next_send_at = nextSendAt;

          if (!dryRun) {
            await db.collection('sequence_enrollments').doc(enrollId).update(updateData);
          }
          fixed++;
        }

        changes.push({
          enrollment_id: enrollId,
          lead_email: enrollment.lead_email,
          sequence: enrollment.sequence_name || seqId,
          reason: reason,
          old_step: currentStep,
          new_step: updateData.current_step || correctNextStep,
          new_status: updateData.status || 'active',
          duplicates: sentSteps
        });

      } catch (err) {
        errors.push({ enrollment_id: enrollId, error: err.message });
      }
    }

    console.log('[fix-stuck] Enrollment results: fixed=' + fixed + ', completed=' + completed + ', skipped=' + skipped + ', errors=' + errors.length);

    // ── Phase 2: Fix July DK sequence step 0 DA content ────────────────

    var julyFix = null;
    try {
      var julyDoc = await db.collection('sequences').doc(JULY_DK_SEQUENCE_ID).get();
      if (julyDoc.exists) {
        var julyData = julyDoc.data();
        var steps = julyData.steps || [];

        if (steps.length > 0) {
          var step0 = steps[0];
          var step0Subject = step0.email_subject || '';
          var step0SubjectEn = step0.email_subject_en || '';

          // Check if unprefixed field has English content (bug)
          if (step0Subject === step0SubjectEn || step0Subject === 'Your summer in Copenhagen') {
            // Fix: set DA subject based on CLAUDE.md specification
            steps[0].email_subject = 'Din sommer i København';

            // The DA body needs to be written — check if body is also English
            var step0Body = step0.email_body || '';
            var step0BodyEn = step0.email_body_en || '';
            var bodyIsEnglish = step0Body === step0BodyEn || step0Body.includes('I wanted to reach out');

            julyFix = {
              step0_old_subject: step0Subject,
              step0_new_subject: 'Din sommer i København',
              body_needs_danish: bodyIsEnglish,
              body_note: bodyIsEnglish
                ? 'Step 0 body is English — needs Danish content written manually'
                : 'Step 0 body appears to already have DA content'
            };

            if (!dryRun) {
              await db.collection('sequences').doc(JULY_DK_SEQUENCE_ID).update({
                steps: steps,
                updated_at: serverTimestamp()
              });
            }

            console.log('[fix-stuck] July DK step 0: subject fixed to "Din sommer i København"');
            if (bodyIsEnglish) {
              console.log('[fix-stuck] WARNING: July DK step 0 body is still English — needs Danish content');
            }
          } else {
            julyFix = { status: 'already_correct', subject: step0Subject };
            console.log('[fix-stuck] July DK step 0 subject already correct: "' + step0Subject + '"');
          }
        }
      }
    } catch (julyErr) {
      console.error('[fix-stuck] July DK fix error:', julyErr.message);
      julyFix = { error: julyErr.message };
    }

    var result = {
      ok: true,
      dry_run: dryRun,
      enrollments: {
        total_active: enrollSnap.size,
        fixed: fixed,
        completed: completed,
        skipped: skipped,
        errors: errors.length
      },
      july_dk_fix: julyFix,
      changes: changes.slice(0, 100), // cap output
      errors: errors.slice(0, 50)
    };

    console.log('[fix-stuck] Done. Result:', JSON.stringify(result, null, 2));
    return jsonResponse(200, result);

  } catch (err) {
    console.error('[fix-stuck] Fatal error:', err);
    return jsonResponse(500, { ok: false, error: err.message });
  }
};
