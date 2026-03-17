/**
 * Deploy Broadcast Nurture Sequence + Enroll All YTT Leads
 *
 * POST /.netlify/functions/deploy-broadcast-nurture-background
 * Auth: X-Internal-Secret header
 *
 * 1. Creates the "YTT Broadcast Nurture — 2026" sequence in Firestore
 * 2. Enrolls ALL existing YTT leads (type: 'ytt') that aren't in an exit state
 * 3. Writes results to system/last_broadcast_enrollment for retrieval
 *
 * Background function (15-min timeout). Returns 202 immediately.
 */

const { getDb, serverTimestamp } = require('./shared/firestore');
const { optionsResponse } = require('./shared/utils');

// ── Exit conditions ─────────────────────────────────────────────────────────

var EXIT_CONDITIONS = [
  'Converted', 'Existing Applicant', 'On Hold', 'Interested In Next Round',
  'Not too keen', 'Unsubscribed', 'Lost', 'Closed', 'Archived'
];

// ── Broadcast sequence definition ───────────────────────────────────────────

var BROADCAST_SEQUENCE = {
  name: 'YTT Broadcast Nurture — 2026',
  description: 'Universal nurture for ALL YTT leads. Psychological arc: seed → demystify → differentiate → self-select → de-risk → convert. Runs alongside program-specific sequences.',
  active: true,
  trigger: {
    type: 'new_lead',
    conditions: {
      lead_type: 'ytt'
    }
  },
  exit_conditions: EXIT_CONDITIONS,
  steps: [
    {
      channel: 'email',
      delay_minutes: 2880,
      email_subject: '20 mennesker sagde ja',
      email_body:
        '<p>Hej {{first_name}},</p>' +
        '<p>Vores 18-ugers yogalæreruddannelse der startede i marts er udsolgt. 20 pladser — væk.</p>' +
        '<p>Det sjove er, at næsten ingen af dem havde en "plan" da de tilmeldte sig. De vidste bare, at de ville noget mere med deres yogapraksis. Nogle ville forstå kroppen bedre. Nogle ville have modet til at stå foran en gruppe. Nogle ledte efter noget helt nyt.</p>' +
        '<p>Jeg ser det hver gang: de fleste der starter, tror ikke de er "klar." Og så opdager de, at det er der ingen der er. Det er hele pointen.</p>' +
        '<p>Vi har fire hold resten af året:</p>' +
        '<p>\u{1F538} <a href="https://yogabible.dk/200-hours-4-weeks-intensive-programs/" style="color:#f75c03;text-decoration:none;font-weight:600;">4-ugers intensiv i april</a> — fuldtid, for dig der vil dykke helt ned. Kun få pladser tilbage.<br>' +
        '\u{1F538} <a href="https://yogabible.dk/200-hours-8-weeks-semi-intensive-programs/" style="color:#f75c03;text-decoration:none;font-weight:600;">8-ugers semi-intensiv fra maj</a> — weekendformat, ved siden af dit job.<br>' +
        '\u{1F538} <a href="https://yogabible.dk/200-hours-4-weeks-intensive-programs/" style="color:#f75c03;text-decoration:none;font-weight:600;">4-ugers Vinyasa Plus i juli</a> — vores internationale sommerhold, undervises på engelsk.<br>' +
        '\u{1F538} <a href="https://yogabible.dk/200-hours-18-weeks-flexible-programs/" style="color:#f75c03;text-decoration:none;font-weight:600;">18-ugers fleksibel fra august</a> — hverdag eller weekend, du vælger selv.</p>' +
        '<p>Alle giver Yoga Alliance RYT-200 certificering og starter med en Forberedelsesfase, så du kan prøve det af først.</p>' +
        '<p>Skriv endelig tilbage hvis du har spørgsmål — jeg svarer personligt.</p>',
      sms_message: '',
      condition: null
    },
    {
      channel: 'email',
      delay_minutes: 7200,
      email_subject: '',
      email_body: '',
      sms_message: '',
      condition: null
    },
    {
      channel: 'email',
      delay_minutes: 7200,
      email_subject: '',
      email_body: '',
      sms_message: '',
      condition: null
    },
    {
      channel: 'email',
      delay_minutes: 8640,
      email_subject: '',
      email_body: '',
      sms_message: '',
      condition: null
    },
    {
      channel: 'email',
      delay_minutes: 7200,
      email_subject: '',
      email_body: '',
      sms_message: '',
      condition: null
    },
    {
      channel: 'email',
      delay_minutes: 7200,
      email_subject: '',
      email_body: '',
      sms_message: '',
      condition: null
    }
  ],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString()
};

// ── Handler ─────────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ ok: false, error: 'POST only' }) };
  }

  var secret = (event.headers['x-internal-secret'] || event.headers['X-Internal-Secret'] || '').trim();
  var expected = (process.env.AI_INTERNAL_SECRET || '').trim();

  if (!expected || secret !== expected) {
    return { statusCode: 401, body: JSON.stringify({ ok: false, error: 'Unauthorized' }) };
  }

  var db = getDb();

  try {
    var results = {
      sequence: null,
      enrollment: {
        total_candidates: 0,
        enrolled: 0,
        skipped_exit_status: 0,
        skipped_already_enrolled: 0,
        skipped_unsubscribed: 0,
        skipped_bounced: 0,
        skipped_no_email: 0,
        errors: 0
      },
      first_emails_at: null
    };

    // ── Task 1: Create or find the broadcast sequence ─────────────────────

    var sequenceId;
    var existing = await db.collection('sequences')
      .where('name', '==', BROADCAST_SEQUENCE.name).limit(1).get();

    if (!existing.empty) {
      sequenceId = existing.docs[0].id;
      results.sequence = { id: sequenceId, name: BROADCAST_SEQUENCE.name, status: 'already_exists' };
      console.log('[broadcast] Sequence already exists: ' + sequenceId);
    } else {
      var newDoc = await db.collection('sequences').add(BROADCAST_SEQUENCE);
      sequenceId = newDoc.id;
      results.sequence = { id: sequenceId, name: BROADCAST_SEQUENCE.name, status: 'created' };
      console.log('[broadcast] Created sequence: ' + sequenceId);
    }

    // ── Task 2: Load all YTT leads ────────────────────────────────────────

    var leadsSnap = await db.collection('leads')
      .where('type', '==', 'ytt')
      .get();

    // Also check leads with lead_type field (some may use that)
    var leadsSnap2 = await db.collection('leads')
      .where('lead_type', '==', 'ytt')
      .get();

    // Merge both, deduplicate by doc ID
    var leadMap = {};
    leadsSnap.forEach(function (doc) { leadMap[doc.id] = doc; });
    leadsSnap2.forEach(function (doc) { leadMap[doc.id] = doc; });

    var allLeads = Object.values(leadMap);
    results.enrollment.total_candidates = allLeads.length;
    console.log('[broadcast] Total YTT leads found: ' + allLeads.length);

    // ── Task 3: Load existing enrollments for THIS sequence ───────────────

    var existingEnrollSnap = await db.collection('sequence_enrollments')
      .where('sequence_id', '==', sequenceId)
      .get();

    var alreadyEnrolledLeadIds = new Set();
    existingEnrollSnap.forEach(function (doc) {
      var data = doc.data();
      if (data.status === 'active' || data.status === 'paused') {
        alreadyEnrolledLeadIds.add(data.lead_id);
      }
    });

    // ── Task 4: Enroll each eligible lead ─────────────────────────────────

    var exitConditionsLower = EXIT_CONDITIONS.map(function (c) { return c.toLowerCase(); });
    var now = new Date();
    var firstStepDelay = BROADCAST_SEQUENCE.steps[0].delay_minutes;
    var nextSendAt = new Date(now.getTime() + firstStepDelay * 60 * 1000);
    results.first_emails_at = nextSendAt.toISOString();

    for (var i = 0; i < allLeads.length; i++) {
      var leadDoc = allLeads[i];
      var lead = leadDoc.data();
      var leadId = leadDoc.id;

      // Skip if already enrolled in this broadcast sequence
      if (alreadyEnrolledLeadIds.has(leadId)) {
        results.enrollment.skipped_already_enrolled++;
        continue;
      }

      // Skip if no email
      if (!lead.email) {
        results.enrollment.skipped_no_email++;
        continue;
      }

      // Skip if unsubscribed
      if (lead.unsubscribed === true) {
        results.enrollment.skipped_unsubscribed++;
        continue;
      }

      // Skip if email bounced
      if (lead.email_bounced === true) {
        results.enrollment.skipped_bounced++;
        continue;
      }

      // Skip if lead status matches any exit condition
      var leadStatus = (lead.status || '').toLowerCase();
      var isConverted = lead.converted === true || lead.converted === 'true';
      var shouldSkip = false;

      if (isConverted) {
        shouldSkip = true;
      } else {
        for (var e = 0; e < exitConditionsLower.length; e++) {
          if (leadStatus === exitConditionsLower[e]) {
            shouldSkip = true;
            break;
          }
        }
      }

      if (shouldSkip) {
        results.enrollment.skipped_exit_status++;
        continue;
      }

      // Enroll
      try {
        await db.collection('sequence_enrollments').add({
          sequence_id: sequenceId,
          sequence_name: BROADCAST_SEQUENCE.name,
          lead_id: leadId,
          lead_email: lead.email || '',
          lead_name: ((lead.first_name || lead.name || '') + ' ' + (lead.last_name || '')).trim(),
          current_step: 1,
          status: 'active',
          exit_reason: null,
          next_send_at: nextSendAt.toISOString(),
          started_at: now.toISOString(),
          updated_at: now.toISOString(),
          step_history: [],
          trigger: 'batch_broadcast',
          created_at: serverTimestamp()
        });
        results.enrollment.enrolled++;
      } catch (err) {
        console.error('[broadcast] Error enrolling ' + lead.email + ':', err.message);
        results.enrollment.errors++;
      }
    }

    // ── Task 5: Verify & log ──────────────────────────────────────────────

    // Re-read the sequence to confirm step content
    var verifyDoc = await db.collection('sequences').doc(sequenceId).get();
    var verifyData = verifyDoc.data();
    results.verification = {
      sequence_id: sequenceId,
      sequence_name: verifyData.name,
      active: verifyData.active,
      trigger: verifyData.trigger,
      total_steps: verifyData.steps.length,
      step_1_has_content: !!(verifyData.steps[0].email_subject && verifyData.steps[0].email_body),
      step_1_subject: verifyData.steps[0].email_subject,
      steps_2_6_empty: verifyData.steps.slice(1).every(function (s) { return !s.email_body; }),
      step_delays: verifyData.steps.map(function (s, idx) {
        return 'Step ' + (idx + 1) + ': ' + s.delay_minutes + ' min (' + Math.round(s.delay_minutes / 60 / 24 * 10) / 10 + ' days)';
      })
    };

    console.log('[broadcast] ===== BROADCAST ENROLLMENT COMPLETE =====');
    console.log('[broadcast] Sequence ID: ' + sequenceId);
    console.log('[broadcast] Enrolled: ' + results.enrollment.enrolled);
    console.log('[broadcast] Skipped (exit status): ' + results.enrollment.skipped_exit_status);
    console.log('[broadcast] Skipped (already enrolled): ' + results.enrollment.skipped_already_enrolled);
    console.log('[broadcast] Skipped (unsubscribed): ' + results.enrollment.skipped_unsubscribed);
    console.log('[broadcast] Skipped (bounced): ' + results.enrollment.skipped_bounced);
    console.log('[broadcast] Skipped (no email): ' + results.enrollment.skipped_no_email);
    console.log('[broadcast] Errors: ' + results.enrollment.errors);
    console.log('[broadcast] First emails at: ' + results.first_emails_at);

    // Write results to Firestore
    await db.collection('system').doc('last_broadcast_enrollment').set({
      ok: true,
      results: results,
      completed_at: new Date().toISOString()
    });

  } catch (error) {
    console.error('[broadcast] Fatal error:', error);

    try {
      await db.collection('system').doc('last_broadcast_enrollment').set({
        ok: false,
        error: error.message,
        completed_at: new Date().toISOString()
      });
    } catch (writeErr) {
      console.error('[broadcast] Could not write error to Firestore:', writeErr.message);
    }
  }
};
