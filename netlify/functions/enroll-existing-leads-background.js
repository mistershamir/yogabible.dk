/**
 * Batch Enroll Existing Leads — Netlify Background Function (15-min timeout)
 *
 * POST /.netlify/functions/enroll-existing-leads-background              — execute
 * POST /.netlify/functions/enroll-existing-leads-background?dry_run=true — preview
 *
 * Auth: X-Internal-Secret header
 *
 * Returns 202 immediately. Does all Firestore work asynchronously.
 * Writes results to Firestore doc system/last_enrollment_run when done.
 */

const { getDb, serverTimestamp } = require('./shared/firestore');
const { optionsResponse } = require('./shared/utils');

// ── Sequence matching logic ─────────────────────────────────────────────────

function getSequenceForLead(lead, priorEmailCount) {
  var program = lead.ytt_program_type || '';
  var cohort = (lead.cohort_label || '').toLowerCase();

  var skipOnboarding = priorEmailCount >= 2;

  if (program === '4-week' && (cohort.includes('apr') || cohort.includes('april') || !cohort)) {
    return 'April 4W Intensive — Conversion Push';
  }
  if (program === '4-week-jul' || cohort.includes('jul') || cohort.includes('vinyasa')) {
    return 'July Vinyasa Plus — International Nurture';
  }
  if (program === '8-week' || cohort.includes('8') || cohort.includes('maj') || cohort.includes('may')) {
    return '8W Semi-Intensive May–Jun — DK Nurture';
  }
  if (program === '18-week-aug' || program === '18-week' || cohort.includes('aug') || cohort.includes('18')) {
    return '18W Flexible Aug–Dec — DK Nurture';
  }
  if (skipOnboarding) {
    return null;
  }
  return 'YTT Onboarding — 2026';
}

// ── Handler ──────────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ ok: false, error: 'POST only' }) };
  }

  // Auth: internal secret
  var secret = (event.headers['x-internal-secret'] || event.headers['X-Internal-Secret'] || '').trim();
  var expected = (process.env.AI_INTERNAL_SECRET || '').trim();

  if (!expected || secret !== expected) {
    return { statusCode: 401, body: JSON.stringify({ ok: false, error: 'Unauthorized' }) };
  }

  var params = event.queryStringParameters || {};
  var dryRun = params.dry_run === 'true';

  var db = getDb();

  try {
    // 1. Load all active sequence definitions
    var seqSnap = await db.collection('sequences').where('active', '==', true).get();
    var sequenceMap = {};
    seqSnap.forEach(function (doc) {
      var data = doc.data();
      sequenceMap[data.name] = { id: doc.id, name: data.name, steps: data.steps || [] };
    });

    // 2. Load all YTT leads (single bulk read)
    var leadsSnap = await db.collection('leads')
      .where('type', '==', 'ytt')
      .get();

    var candidates = [];
    leadsSnap.forEach(function (doc) {
      var lead = doc.data();
      if (lead.converted === true || lead.converted === 'true') return;
      if (lead.unsubscribed === true) return;
      candidates.push({ id: doc.id, ...lead });
    });

    // 3. Bulk-load existing enrollments (single read)
    var enrollSnap = await db.collection('sequence_enrollments')
      .where('status', 'in', ['active', 'paused'])
      .get();

    var enrolledLeadIds = new Set();
    enrollSnap.forEach(function (doc) {
      enrolledLeadIds.add(doc.data().lead_id);
    });

    // 4. Bulk-load active agent drips (single read)
    var dripSnap = await db.collection('lead_drip_sequences').get();
    var activeDripLeadIds = new Set();
    dripSnap.forEach(function (doc) {
      var data = doc.data();
      if (!data.completed && !data.paused) {
        activeDripLeadIds.add(doc.id);
      }
    });

    // 5. Bulk-load email_log for all candidate emails (single read instead of N reads)
    var candidateEmails = new Set(candidates.map(function (l) { return l.email; }).filter(Boolean));
    var emailCountByAddress = {};

    // Firestore 'in' queries are limited to 30 values, so batch them
    var emailArray = Array.from(candidateEmails);
    for (var batch = 0; batch < emailArray.length; batch += 30) {
      var chunk = emailArray.slice(batch, batch + 30);
      try {
        var logSnap = await db.collection('email_log')
          .where('to', 'in', chunk)
          .where('status', '==', 'sent')
          .get();
        logSnap.forEach(function (doc) {
          var to = doc.data().to;
          emailCountByAddress[to] = (emailCountByAddress[to] || 0) + 1;
        });
      } catch (e) {
        console.log('[enroll-bg] email_log batch query failed:', e.message);
      }
    }

    // 6. Process each candidate
    var results = {
      enrolled: {},
      skipped_already_enrolled: 0,
      skipped_mid_drip: 0,
      skipped_no_sequence: 0,
      skipped_no_matching_sequence: 0,
      errors: 0
    };

    for (var i = 0; i < candidates.length; i++) {
      var lead = candidates[i];

      if (enrolledLeadIds.has(lead.id)) {
        results.skipped_already_enrolled++;
        continue;
      }

      if (activeDripLeadIds.has(lead.id)) {
        results.skipped_mid_drip++;
        continue;
      }

      var priorEmailCount = emailCountByAddress[lead.email] || 0;
      var sequenceName = getSequenceForLead(lead, priorEmailCount);

      if (!sequenceName) {
        results.skipped_no_sequence++;
        continue;
      }

      var sequence = sequenceMap[sequenceName];
      if (!sequence) {
        results.skipped_no_matching_sequence++;
        continue;
      }

      if (!results.enrolled[sequenceName]) results.enrolled[sequenceName] = [];
      results.enrolled[sequenceName].push({
        id: lead.id,
        email: lead.email,
        name: lead.first_name || lead.name || 'Unknown',
        program: lead.ytt_program_type || 'unknown',
        prior_emails: priorEmailCount
      });

      if (!dryRun) {
        try {
          var now = new Date();
          var firstStepDelay = (sequence.steps[0] && sequence.steps[0].delay_minutes) || 0;
          var nextSendAt = new Date(now.getTime() + firstStepDelay * 60 * 1000);

          await db.collection('sequence_enrollments').add({
            sequence_id: sequence.id,
            sequence_name: sequence.name,
            lead_id: lead.id,
            lead_email: lead.email || '',
            lead_name: lead.first_name || lead.name || '',
            current_step: 1,
            status: 'active',
            exit_reason: null,
            next_send_at: nextSendAt.toISOString(),
            started_at: now.toISOString(),
            updated_at: now.toISOString(),
            step_history: [],
            trigger: 'batch_migration',
            created_at: serverTimestamp()
          });
        } catch (e) {
          console.error('[enroll-bg] Error enrolling ' + lead.email + ':', e.message);
          results.errors++;
        }
      }
    }

    // 7. Build summary
    var totalEnrolled = 0;
    var breakdown = {};
    for (var seqName in results.enrolled) {
      var count = results.enrolled[seqName].length;
      totalEnrolled += count;
      breakdown[seqName] = count;
    }

    var summary = {
      ok: true,
      dry_run: dryRun,
      total_candidates: candidates.length,
      total_to_enroll: totalEnrolled,
      breakdown: breakdown,
      enrolled_details: results.enrolled,
      skipped: {
        already_enrolled: results.skipped_already_enrolled,
        mid_agent_drip: results.skipped_mid_drip,
        no_sequence_match: results.skipped_no_matching_sequence,
        prior_emails_skip_onboarding: results.skipped_no_sequence
      },
      errors: results.errors,
      available_sequences: Object.keys(sequenceMap),
      active_enrollments: enrolledLeadIds.size,
      active_agent_drips: activeDripLeadIds.size,
      completed_at: new Date().toISOString()
    };

    // 8. Log to console (visible in Netlify function logs)
    console.log('[enroll-bg] ===== ENROLLMENT RUN COMPLETE =====');
    console.log('[enroll-bg] Mode:', dryRun ? 'DRY RUN' : 'EXECUTE');
    console.log('[enroll-bg] Candidates:', candidates.length);
    console.log('[enroll-bg] To enroll:', totalEnrolled);
    console.log('[enroll-bg] Breakdown:', JSON.stringify(breakdown));
    console.log('[enroll-bg] Skipped:', JSON.stringify(summary.skipped));
    console.log('[enroll-bg] Errors:', results.errors);

    // 9. Write results to Firestore for retrieval
    await db.collection('system').doc('last_enrollment_run').set(summary);
    console.log('[enroll-bg] Results written to system/last_enrollment_run');

  } catch (error) {
    console.error('[enroll-bg] Fatal error:', error);

    // Write error to Firestore so caller can see what happened
    try {
      await db.collection('system').doc('last_enrollment_run').set({
        ok: false,
        error: error.message,
        completed_at: new Date().toISOString(),
        dry_run: dryRun
      });
    } catch (writeErr) {
      console.error('[enroll-bg] Could not write error to Firestore:', writeErr.message);
    }
  }
};
