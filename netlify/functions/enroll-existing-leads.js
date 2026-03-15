/**
 * Batch Enroll Existing Leads — Netlify Function
 *
 * POST /.netlify/functions/enroll-existing-leads              — execute enrollment
 * POST /.netlify/functions/enroll-existing-leads?dry_run=true — preview only
 *
 * Auth: X-Internal-Secret header
 *
 * Finds unconverted YTT leads and enrolls them into the appropriate
 * nurture sequence based on ytt_program_type / cohort_label.
 * Skips leads already enrolled or mid-agent-drip.
 */

const { getDb, serverTimestamp } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');

// ── Sequence matching logic ─────────────────────────────────────────────────

function getSequenceForLead(lead, priorEmailCount) {
  var program = lead.ytt_program_type || '';
  var cohort = (lead.cohort_label || '').toLowerCase();

  var skipOnboarding = priorEmailCount >= 2;

  // April 4-week intensive
  if (program === '4-week' && (cohort.includes('apr') || cohort.includes('april') || !cohort)) {
    return 'April 4W Intensive — Conversion Push';
  }

  // July Vinyasa Plus
  if (program === '4-week-jul' || cohort.includes('jul') || cohort.includes('vinyasa')) {
    return 'July Vinyasa Plus — International Nurture';
  }

  // 8-week semi-intensive
  if (program === '8-week' || cohort.includes('8') || cohort.includes('maj') || cohort.includes('may')) {
    return '8W Semi-Intensive May–Jun — DK Nurture';
  }

  // 18-week flexible (August-December)
  if (program === '18-week-aug' || program === '18-week' || cohort.includes('aug') || cohort.includes('18')) {
    return '18W Flexible Aug–Dec — DK Nurture';
  }

  // General / undecided leads
  if (skipOnboarding) {
    return null; // Already received campaign content — skip
  }
  return 'YTT Onboarding — 2026';
}

// ── Handler ──────────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { ok: false, error: 'POST only' });
  }

  // Auth: internal secret
  var secret = (event.headers['x-internal-secret'] || event.headers['X-Internal-Secret'] || '').trim();
  var expected = (process.env.AI_INTERNAL_SECRET || '').trim();

  if (!expected || secret !== expected) {
    return jsonResponse(401, { ok: false, error: 'Unauthorized' });
  }

  var params = event.queryStringParameters || {};
  var dryRun = params.dry_run === 'true';

  var db = getDb();

  try {
    // 1. Load all active sequence definitions
    var seqSnap = await db.collection('sequences').where('active', '==', true).get();
    var sequenceMap = {}; // name -> { id, name, steps }
    seqSnap.forEach(function (doc) {
      var data = doc.data();
      sequenceMap[data.name] = { id: doc.id, name: data.name, steps: data.steps || [] };
    });

    // 2. Load all YTT leads
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

    // 3. Check existing enrollments
    var enrollSnap = await db.collection('sequence_enrollments')
      .where('status', 'in', ['active', 'paused'])
      .get();

    var enrolledLeadIds = new Set();
    enrollSnap.forEach(function (doc) {
      enrolledLeadIds.add(doc.data().lead_id);
    });

    // 4. Check active agent drips
    var dripSnap = await db.collection('lead_drip_sequences').get();
    var activeDripLeadIds = new Set();
    dripSnap.forEach(function (doc) {
      var data = doc.data();
      if (!data.completed && !data.paused) {
        activeDripLeadIds.add(doc.id);
      }
    });

    // 5. Process each candidate
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

      // Check prior campaign emails
      var priorEmailCount = 0;
      try {
        var emailLogSnap = await db.collection('email_log')
          .where('to', '==', lead.email)
          .where('status', '==', 'sent')
          .get();
        priorEmailCount = emailLogSnap.size;
      } catch (e) {
        // Index might not exist — default to 0
      }

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

      // Track result
      if (!results.enrolled[sequenceName]) results.enrolled[sequenceName] = [];
      results.enrolled[sequenceName].push({
        id: lead.id,
        email: lead.email,
        name: lead.first_name || lead.name || 'Unknown',
        program: lead.ytt_program_type || 'unknown',
        prior_emails: priorEmailCount
      });

      // Execute enrollment (unless dry run)
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
          console.error('[enroll-existing] Error enrolling ' + lead.email + ':', e.message);
          results.errors++;
        }
      }
    }

    // Build summary
    var totalEnrolled = 0;
    var breakdown = {};
    for (var seqName in results.enrolled) {
      var count = results.enrolled[seqName].length;
      totalEnrolled += count;
      breakdown[seqName] = count;
    }

    return jsonResponse(200, {
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
      active_agent_drips: activeDripLeadIds.size
    });

  } catch (error) {
    console.error('[enroll-existing] Error:', error);
    return jsonResponse(500, { ok: false, error: error.message });
  }
};
