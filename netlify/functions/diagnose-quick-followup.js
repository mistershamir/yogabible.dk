/**
 * Diagnose Quick Follow-up sequence — why aren't leads enrolling?
 *
 * GET /.netlify/functions/diagnose-quick-followup
 * Auth: X-Internal-Secret header
 */

const { getDb } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');

var QUICK_FOLLOWUP_ID = 'Ue0CYOsPJlnj5SF9PtA0';
var BROADCAST_ID = 'Ma2caW2hiQqtkPFesK27';

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  var secret = process.env.AI_INTERNAL_SECRET;
  var provided = (event.headers['x-internal-secret'] || event.headers['X-Internal-Secret'] || '').trim();
  if (!secret || provided !== secret) {
    return jsonResponse(401, { error: 'Unauthorized' });
  }

  var db = getDb();

  // 1. Get the Quick Follow-up sequence definition
  var seqDoc = await db.collection('sequences').doc(QUICK_FOLLOWUP_ID).get();
  var seqData = seqDoc.exists ? seqDoc.data() : null;

  // 2. Get ALL enrollments for Quick Follow-up
  var qfEnrollSnap = await db.collection('sequence_enrollments')
    .where('sequence_id', '==', QUICK_FOLLOWUP_ID)
    .get();

  var qfEnrollments = [];
  qfEnrollSnap.forEach(function (doc) {
    var d = doc.data();
    qfEnrollments.push({
      enrollment_id: doc.id,
      lead_id: d.lead_id,
      lead_email: d.lead_email,
      lead_name: d.lead_name,
      status: d.status,
      current_step: d.current_step,
      exit_reason: d.exit_reason || null,
      trigger: d.trigger,
      started_at: d.started_at ? (d.started_at.toDate ? d.started_at.toDate().toISOString() : String(d.started_at)) : null,
      next_send_at: d.next_send_at ? (typeof d.next_send_at === 'string' ? d.next_send_at : (d.next_send_at.toDate ? d.next_send_at.toDate().toISOString() : String(d.next_send_at))) : null,
      updated_at: d.updated_at ? (d.updated_at.toDate ? d.updated_at.toDate().toISOString() : String(d.updated_at)) : null,
      step_history: d.step_history || []
    });
  });

  // 3. Get recent YTT leads — simple query (no composite index needed)
  var recentLeadsSnap = await db.collection('leads')
    .where('type', '==', 'ytt')
    .limit(200)
    .get();

  var recentLeads = [];
  recentLeadsSnap.forEach(function (doc) {
    var d = doc.data();
    recentLeads.push({
      lead_id: doc.id,
      email: d.email,
      name: d.name || d.first_name || '',
      type: d.type,
      status: d.status,
      created_at: d.created_at ? (d.created_at.toDate ? d.created_at.toDate().toISOString() : String(d.created_at)) : null,
      source: d.source || ''
    });
  });

  // 4. For each recent lead, check if they have a Quick Follow-up enrollment
  var qfLeadIds = new Set(qfEnrollments.map(function (e) { return e.lead_id; }));

  // Also get broadcast enrollments for comparison
  var broadcastEnrollSnap = await db.collection('sequence_enrollments')
    .where('sequence_id', '==', BROADCAST_ID)
    .get();
  var broadcastLeadIds = new Set();
  broadcastEnrollSnap.forEach(function (doc) {
    broadcastLeadIds.add(doc.data().lead_id);
  });

  var leadAnalysis = recentLeads.map(function (lead) {
    return {
      lead_id: lead.lead_id,
      email: lead.email,
      name: lead.name,
      status: lead.status,
      created_at: lead.created_at,
      source: lead.source,
      in_quick_followup: qfLeadIds.has(lead.lead_id),
      in_broadcast: broadcastLeadIds.has(lead.lead_id)
    };
  });

  // 5. Check email_log for Quick Follow-up emails
  var emailLogSnap = await db.collection('email_log')
    .where('source', '==', 'sequence')
    .where('sequence_id', '==', QUICK_FOLLOWUP_ID)
    .get();

  var qfEmails = [];
  emailLogSnap.forEach(function (doc) {
    var d = doc.data();
    qfEmails.push({
      to: d.to,
      subject: d.subject,
      status: d.status,
      sent_at: d.sent_at ? (d.sent_at.toDate ? d.sent_at.toDate().toISOString() : String(d.sent_at)) : null,
      lead_id: d.lead_id
    });
  });

  // 6. Check the sequence definition for potential issues
  var issues = [];
  if (!seqData) {
    issues.push('CRITICAL: Sequence document not found');
  } else {
    if (!seqData.active) issues.push('CRITICAL: Sequence is NOT active (active=false)');
    if (!seqData.trigger) issues.push('CRITICAL: No trigger defined');
    if (seqData.trigger && seqData.trigger.type !== 'new_lead') issues.push('WARNING: Trigger type is "' + seqData.trigger.type + '", not "new_lead"');
    if (seqData.enrollment_closes) {
      var closes = new Date(seqData.enrollment_closes);
      if (closes < new Date()) issues.push('CRITICAL: Enrollment closed on ' + seqData.enrollment_closes);
    }
    if (!seqData.steps || seqData.steps.length === 0) issues.push('CRITICAL: No steps defined');
    if (seqData.steps && seqData.steps[0]) {
      if (!seqData.steps[0].email_body) issues.push('WARNING: Step 1 email_body is empty');
      if (!seqData.steps[0].email_subject) issues.push('WARNING: Step 1 email_subject is empty');
    }
  }

  // 7. Leads in broadcast but NOT in quick follow-up (the gap)
  var inBroadcastNotQF = leadAnalysis.filter(function (l) {
    return l.in_broadcast && !l.in_quick_followup;
  });

  return jsonResponse(200, {
    ok: true,
    sequence_definition: seqData ? {
      name: seqData.name,
      active: seqData.active,
      trigger: seqData.trigger,
      enrollment_closes: seqData.enrollment_closes || null,
      total_steps: (seqData.steps || []).length,
      step_1_delay_minutes: seqData.steps && seqData.steps[0] ? seqData.steps[0].delay_minutes : null,
      step_1_subject: seqData.steps && seqData.steps[0] ? seqData.steps[0].email_subject : null,
      step_1_has_body: seqData.steps && seqData.steps[0] ? !!seqData.steps[0].email_body : false,
      exit_conditions: seqData.exit_conditions
    } : null,
    issues_detected: issues,
    enrollments: {
      total: qfEnrollments.length,
      details: qfEnrollments
    },
    emails_sent: {
      total: qfEmails.length,
      details: qfEmails
    },
    recent_leads_analysis: {
      total_recent_ytt_leads: recentLeads.length,
      in_broadcast: leadAnalysis.filter(function (l) { return l.in_broadcast; }).length,
      in_quick_followup: leadAnalysis.filter(function (l) { return l.in_quick_followup; }).length,
      in_broadcast_but_not_qf: inBroadcastNotQF.length,
      gap_leads: inBroadcastNotQF.slice(0, 20),
      all_leads: leadAnalysis
    },
    timestamp: new Date().toISOString()
  });
};
