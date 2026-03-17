/**
 * Enroll Test Lead — One-time deploy function
 *
 * POST /.netlify/functions/enroll-test-lead
 * Auth: X-Internal-Secret header
 *
 * Creates (or finds) a test lead for shamir@hotyogacph.dk
 * and enrolls it into ALL active sequences.
 */

const { getDb, serverTimestamp } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');

var TEST_LEAD = {
  email: 'shamir@hotyogacph.dk',
  first_name: 'Shamir',
  last_name: '(Test)',
  phone: '4553622923',
  lead_type: 'ytt',
  ytt_program_type: 'undecided',
  status: 'New',
  source: 'test',
  lang: 'da',
  is_test: true,
  created_at: new Date().toISOString()
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  var secret = process.env.AI_INTERNAL_SECRET;
  if (!secret || event.headers['x-internal-secret'] !== secret) {
    return jsonResponse(401, { error: 'Unauthorized' });
  }

  var db = getDb();
  var results = { lead: null, enrollments: [] };

  // ── Step 1: Find or create test lead ────────────────────────────────────

  var leadId;
  var existingLead = await db.collection('leads')
    .where('email', '==', TEST_LEAD.email)
    .where('is_test', '==', true)
    .limit(1).get();

  if (!existingLead.empty) {
    leadId = existingLead.docs[0].id;
    // Ensure phone is up to date
    await db.collection('leads').doc(leadId).update({ phone: TEST_LEAD.phone });
    results.lead = { id: leadId, status: 'found_existing', phone_updated: true };
  } else {
    var newLead = await db.collection('leads').add(TEST_LEAD);
    leadId = newLead.id;
    results.lead = { id: leadId, status: 'created' };
  }

  // ── Step 2: Get all active sequences ────────────────────────────────────

  var seqSnap = await db.collection('sequences')
    .where('active', '==', true).get();

  if (seqSnap.empty) {
    return jsonResponse(200, { ok: true, results: results, message: 'No active sequences found' });
  }

  // ── Step 3: Enroll into each sequence ───────────────────────────────────

  var now = new Date().toISOString();

  for (var i = 0; i < seqSnap.docs.length; i++) {
    var seqDoc = seqSnap.docs[i];
    var seq = seqDoc.data();
    var seqId = seqDoc.id;

    try {
      // Check if already enrolled (active or paused)
      var existing = await db.collection('sequence_enrollments')
        .where('sequence_id', '==', seqId)
        .where('lead_id', '==', leadId)
        .where('status', 'in', ['active', 'paused'])
        .get();

      if (!existing.empty) {
        results.enrollments.push({
          sequence: seq.name,
          id: seqId,
          status: 'already_enrolled'
        });
        continue;
      }

      // Calculate first step send time
      var firstStep = seq.steps && seq.steps[0];
      var delayMinutes = (firstStep && firstStep.delay_minutes) || 0;
      var delayDays = (firstStep && firstStep.delay_days) || 0;
      var delayHours = (firstStep && firstStep.delay_hours) || 0;
      var nextDate = new Date(now);

      if (delayMinutes > 0 && delayDays === 0 && delayHours === 0) {
        nextDate = new Date(nextDate.getTime() + delayMinutes * 60 * 1000);
      } else {
        nextDate.setDate(nextDate.getDate() + delayDays);
        nextDate.setHours(nextDate.getHours() + delayHours);
      }

      var enrollData = {
        sequence_id: seqId,
        sequence_name: seq.name || '',
        lead_id: leadId,
        lead_email: TEST_LEAD.email,
        lead_name: TEST_LEAD.first_name + ' ' + TEST_LEAD.last_name,
        current_step: 1,
        status: 'active',
        exit_reason: null,
        next_send_at: nextDate.toISOString(),
        started_at: now,
        updated_at: now,
        step_history: [],
        trigger: 'manual_test',
        created_at: serverTimestamp()
      };

      var ref = await db.collection('sequence_enrollments').add(enrollData);
      results.enrollments.push({
        sequence: seq.name,
        id: seqId,
        enrollment_id: ref.id,
        next_send_at: nextDate.toISOString(),
        status: 'enrolled'
      });
    } catch (err) {
      results.enrollments.push({
        sequence: seq.name || seqId,
        status: 'error',
        error: err.message
      });
    }
  }

  return jsonResponse(200, { ok: true, results: results });
};
