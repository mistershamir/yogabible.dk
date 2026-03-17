/**
 * Audit Sequences — Live Firestore Read
 *
 * GET /.netlify/functions/audit-sequences
 * Auth: X-Internal-Secret header
 *
 * Reads ALL sequences and enrollments from Firestore and returns a full report.
 * Also scans all email content for refund language.
 */

const { getDb } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');

var REFUND_TERMS = [
  'fuld refusion',
  'fully refundable',
  'refund',
  'refusion',
  'money back',
  'pengene tilbage'
];

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  var secret = process.env.AI_INTERNAL_SECRET;
  var provided = (event.headers['x-internal-secret'] || event.headers['X-Internal-Secret'] || '').trim();
  if (!secret || provided !== secret) {
    return jsonResponse(401, { error: 'Unauthorized' });
  }

  var db = getDb();

  // ── Load all sequences ──────────────────────────────────────────────────
  var seqSnap = await db.collection('sequences').get();
  var sequences = [];
  var seqIds = [];

  seqSnap.forEach(function (doc) {
    seqIds.push(doc.id);
    sequences.push({ id: doc.id, data: doc.data() });
  });

  // ── Load all enrollments in one query ───────────────────────────────────
  var enrollSnap = await db.collection('sequence_enrollments').get();
  var enrollmentsBySeq = {};
  var totalEnrollments = 0;

  enrollSnap.forEach(function (doc) {
    var d = doc.data();
    var sid = d.sequence_id;
    if (!sid) return;
    totalEnrollments++;
    if (!enrollmentsBySeq[sid]) {
      enrollmentsBySeq[sid] = { total: 0, active: 0, paused: 0, completed: 0, exited: 0, at_step_1: 0, at_step_2_plus: 0 };
    }
    enrollmentsBySeq[sid].total++;
    var status = d.status || 'active';
    if (enrollmentsBySeq[sid][status] !== undefined) enrollmentsBySeq[sid][status]++;
    var step = d.current_step || 1;
    if (step <= 1) enrollmentsBySeq[sid].at_step_1++;
    else enrollmentsBySeq[sid].at_step_2_plus++;
  });

  // ── Build report ────────────────────────────────────────────────────────
  var refundAudit = { matches_found: 0, details: [] };
  var report = [];

  for (var i = 0; i < sequences.length; i++) {
    var seq = sequences[i];
    var d = seq.data;
    var steps = d.steps || [];
    var stepsReport = [];

    for (var s = 0; s < steps.length; s++) {
      var step = steps[s];
      var daSubject = step.email_subject || '';
      var daBody = step.email_body || '';
      var enSubject = step.email_subject_en || '';
      var enBody = step.email_body_en || '';
      var smsMsg = step.sms_message || '';

      // Refund scan
      var refundFound = false;
      var textsToScan = [daBody, enBody, daSubject, enSubject, smsMsg];
      for (var t = 0; t < textsToScan.length; t++) {
        var text = textsToScan[t].toLowerCase();
        for (var r = 0; r < REFUND_TERMS.length; r++) {
          if (text.includes(REFUND_TERMS[r])) {
            refundFound = true;
            refundAudit.matches_found++;
            refundAudit.details.push({
              sequence: d.name || seq.id,
              step_index: s,
              term: REFUND_TERMS[r],
              field: t === 0 ? 'email_body' : t === 1 ? 'email_body_en' : t === 2 ? 'email_subject' : t === 3 ? 'email_subject_en' : 'sms_message'
            });
          }
        }
      }

      stepsReport.push({
        index: s,
        channel: step.channel || 'email',
        delay_minutes: step.delay_minutes || 0,
        condition: step.condition || null,
        has_da_subject: !!daSubject,
        da_subject: daSubject || null,
        has_da_body: !!daBody,
        da_body_preview: daBody ? daBody.replace(/<[^>]+>/g, '').substring(0, 80) : null,
        has_en_subject: !!enSubject,
        en_subject: enSubject || null,
        has_en_body: !!enBody,
        en_body_preview: enBody ? enBody.replace(/<[^>]+>/g, '').substring(0, 80) : null,
        has_sms: !!smsMsg,
        sms_preview: smsMsg ? smsMsg.substring(0, 80) : null,
        refund_language_found: refundFound
      });
    }

    var stats = enrollmentsBySeq[seq.id] || { total: 0, active: 0, paused: 0, completed: 0, exited: 0, at_step_1: 0, at_step_2_plus: 0 };

    report.push({
      id: seq.id,
      name: d.name || null,
      active: d.active === true,
      trigger: d.trigger || null,
      exit_conditions: d.exit_conditions || [],
      enrollment_closes: d.enrollment_closes || null,
      total_steps: steps.length,
      enrollment_stats: stats,
      steps: stepsReport
    });
  }

  return jsonResponse(200, {
    ok: true,
    sequences: report,
    refund_audit: refundAudit,
    total_sequences: report.length,
    total_enrollments: totalEnrollments,
    timestamp: new Date().toISOString()
  });
};
