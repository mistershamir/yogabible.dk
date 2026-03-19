/**
 * Lead Journey Audit — comprehensive enrollment & delivery snapshot
 *
 * GET /.netlify/functions/lead-journey-audit
 * Auth: X-Internal-Secret header
 *
 * Returns: enrollment states, email delivery report, overlap analysis,
 * timeline forecast, throttle impact, and gap analysis.
 */

const { getDb } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  var secret = process.env.AI_INTERNAL_SECRET;
  var provided = (event.headers['x-internal-secret'] || event.headers['X-Internal-Secret'] || '').trim();
  if (!secret || provided !== secret) {
    return jsonResponse(401, { error: 'Unauthorized' });
  }

  var db = getDb();
  var now = new Date();

  // ─── Load all data in parallel ───────────────────────────────────
  var [sequencesSnap, enrollmentsSnap, emailLogSnap] = await Promise.all([
    db.collection('sequences').where('active', '==', true).get(),
    db.collection('sequence_enrollments').get(),
    db.collection('email_log').where('source', '==', 'sequence').get()
  ]);

  // Build lookup maps
  var sequences = {};
  sequencesSnap.forEach(function (doc) {
    sequences[doc.id] = Object.assign({ id: doc.id }, doc.data());
  });

  var enrollments = [];
  enrollmentsSnap.forEach(function (doc) {
    enrollments.push(Object.assign({ id: doc.id }, doc.data()));
  });

  var emailLogs = [];
  emailLogSnap.forEach(function (doc) {
    emailLogs.push(Object.assign({ id: doc.id }, doc.data()));
  });

  // ─── TASK 1: Enrollment State Snapshot ───────────────────────────
  var task1 = {};
  Object.keys(sequences).forEach(function (seqId) {
    var seq = sequences[seqId];
    var seqEnrollments = enrollments.filter(function (e) { return e.sequence_id === seqId; });
    var active = seqEnrollments.filter(function (e) { return e.status === 'active'; });
    var paused = seqEnrollments.filter(function (e) { return e.status === 'paused'; });
    var completed = seqEnrollments.filter(function (e) { return e.status === 'completed'; });
    var exited = seqEnrollments.filter(function (e) { return e.status === 'exited'; });

    // Step distribution (current_step is 1-indexed)
    var stepDist = {};
    var totalSteps = (seq.steps || []).length;
    for (var s = 1; s <= totalSteps; s++) stepDist['step_' + s] = 0;
    active.forEach(function (e) {
      var key = 'step_' + e.current_step;
      stepDist[key] = (stepDist[key] || 0) + 1;
    });

    // Next send timestamps
    var nextSendTimes = active
      .map(function (e) { return e.next_send_at; })
      .filter(Boolean)
      .map(function (t) { return typeof t === 'string' ? new Date(t) : (t.toDate ? t.toDate() : new Date(t)); })
      .sort(function (a, b) { return a - b; });

    task1[seqId] = {
      name: seq.name,
      total_steps: totalSteps,
      total_enrolled: seqEnrollments.length,
      active: active.length,
      paused: paused.length,
      completed: completed.length,
      exited: exited.length,
      exit_reasons: exited.reduce(function (acc, e) {
        var r = e.exit_reason || 'unknown';
        acc[r] = (acc[r] || 0) + 1;
        return acc;
      }, {}),
      step_distribution: stepDist,
      next_send_earliest: nextSendTimes.length ? nextSendTimes[0].toISOString() : null,
      next_send_latest: nextSendTimes.length ? nextSendTimes[nextSendTimes.length - 1].toISOString() : null,
      next_48h_due: nextSendTimes.filter(function (t) { return t <= new Date(now.getTime() + 48 * 3600000); }).length
    };
  });

  // ─── TASK 2: Email Delivery Report ───────────────────────────────
  var totalSent = emailLogs.length;
  var sentOk = emailLogs.filter(function (e) { return e.status === 'sent'; }).length;
  var failed = emailLogs.filter(function (e) { return e.status === 'failed'; }).length;

  // By sequence
  var bySequence = {};
  emailLogs.forEach(function (log) {
    var seqId = log.sequence_id || 'unknown';
    var seqName = sequences[seqId] ? sequences[seqId].name : seqId;
    if (!bySequence[seqName]) bySequence[seqName] = { sent: 0, failed: 0 };
    if (log.status === 'sent') bySequence[seqName].sent++;
    else bySequence[seqName].failed++;
  });

  // By day (since Mar 17)
  var byDay = {};
  emailLogs.forEach(function (log) {
    var sentAt = log.sent_at;
    if (!sentAt) return;
    var d = sentAt.toDate ? sentAt.toDate() : new Date(sentAt);
    var dayKey = d.toISOString().slice(0, 10);
    if (!byDay[dayKey]) byDay[dayKey] = { sent: 0, failed: 0 };
    if (log.status === 'sent') byDay[dayKey].sent++;
    else byDay[dayKey].failed++;
  });

  // Sort by day
  var byDaySorted = {};
  Object.keys(byDay).sort().forEach(function (k) { byDaySorted[k] = byDay[k]; });

  var task2 = {
    total_sequence_emails: totalSent,
    sent_ok: sentOk,
    failed: failed,
    by_sequence: bySequence,
    by_day: byDaySorted
  };

  // ─── TASK 3: Lead Overlap Analysis ──────────────────────────────
  var leadSequences = {}; // lead_id -> [{ sequence_id, sequence_name, status }]
  enrollments.forEach(function (e) {
    if (e.status !== 'active' && e.status !== 'paused') return;
    var lid = e.lead_id;
    if (!leadSequences[lid]) leadSequences[lid] = [];
    leadSequences[lid].push({
      sequence_id: e.sequence_id,
      sequence_name: e.sequence_name || (sequences[e.sequence_id] ? sequences[e.sequence_id].name : e.sequence_id),
      current_step: e.current_step,
      status: e.status
    });
  });

  var overlapCounts = { '1': 0, '2': 0, '3': 0, '4+': 0 };
  var highOverlapExamples = [];
  Object.keys(leadSequences).forEach(function (lid) {
    var count = leadSequences[lid].length;
    if (count === 1) overlapCounts['1']++;
    else if (count === 2) overlapCounts['2']++;
    else if (count === 3) overlapCounts['3']++;
    else overlapCounts['4+']++;

    if (count >= 3 && highOverlapExamples.length < 10) {
      highOverlapExamples.push({
        lead_id: lid,
        sequence_count: count,
        sequences: leadSequences[lid].map(function (s) {
          return s.sequence_name + ' (step ' + s.current_step + ')';
        })
      });
    }
  });

  var task3 = {
    total_leads_in_sequences: Object.keys(leadSequences).length,
    in_1_sequence: overlapCounts['1'],
    in_2_sequences: overlapCounts['2'],
    in_3_sequences: overlapCounts['3'],
    in_4_plus_sequences: overlapCounts['4+'],
    high_overlap_examples: highOverlapExamples
  };

  // ─── TASK 4: Timeline Forecast ──────────────────────────────────

  // Broadcast sequence forecast (180 leads)
  var broadcastId = Object.keys(sequences).find(function (id) {
    return sequences[id].name && sequences[id].name.indexOf('Broadcast') !== -1;
  });

  var broadcastForecast = null;
  if (broadcastId) {
    var bSeq = sequences[broadcastId];
    var bEnrollments = enrollments.filter(function (e) {
      return e.sequence_id === broadcastId && e.status === 'active';
    });

    // Group by current_step
    var stepGroups = {};
    bEnrollments.forEach(function (e) {
      if (!stepGroups[e.current_step]) stepGroups[e.current_step] = [];
      stepGroups[e.current_step].push(e);
    });

    // For each step group, find the next_send_at range
    var stepForecasts = {};
    Object.keys(stepGroups).forEach(function (step) {
      var group = stepGroups[step];
      var times = group
        .map(function (e) { return e.next_send_at; })
        .filter(Boolean)
        .map(function (t) { return typeof t === 'string' ? new Date(t) : (t.toDate ? t.toDate() : new Date(t)); })
        .sort(function (a, b) { return a - b; });

      stepForecasts['step_' + step] = {
        leads: group.length,
        earliest_send: times.length ? times[0].toISOString() : null,
        latest_send: times.length ? times[times.length - 1].toISOString() : null,
        due_next_48h: times.filter(function (t) { return t <= new Date(now.getTime() + 48 * 3600000); }).length
      };
    });

    // Cumulative calendar: when will leads reach each step?
    // Steps have delay_minutes — accumulate to build a calendar
    var cumulativeDelays = [];
    var cumDelay = 0;
    (bSeq.steps || []).forEach(function (step, idx) {
      cumDelay += (step.delay_minutes || 0);
      cumulativeDelays.push({ step: idx + 1, cumulative_minutes: cumDelay });
    });

    // Already sent = completed step history entries
    var alreadySentStep1 = bEnrollments.filter(function (e) { return e.current_step > 1; }).length;
    var completedEnrollments = enrollments.filter(function (e) {
      return e.sequence_id === broadcastId && e.status === 'completed';
    }).length;

    // Project when the earliest enrolled leads will hit each future step
    // Use the earliest enrollment started_at
    var earliestStart = bEnrollments
      .map(function (e) { return e.started_at; })
      .filter(Boolean)
      .map(function (t) { return typeof t === 'string' ? new Date(t) : (t.toDate ? t.toDate() : new Date(t)); })
      .sort(function (a, b) { return a - b; })[0];

    var latestStart = bEnrollments
      .map(function (e) { return e.started_at; })
      .filter(Boolean)
      .map(function (t) { return typeof t === 'string' ? new Date(t) : (t.toDate ? t.toDate() : new Date(t)); })
      .sort(function (a, b) { return b - a; })[0];

    var calendar = cumulativeDelays.map(function (cd) {
      var earliestHit = earliestStart ? new Date(earliestStart.getTime() + cd.cumulative_minutes * 60000) : null;
      var latestHit = latestStart ? new Date(latestStart.getTime() + cd.cumulative_minutes * 60000) : null;
      var stepData = bSeq.steps[cd.step - 1];
      return {
        step: cd.step,
        subject: stepData ? stepData.email_subject : '?',
        delay_days_from_enrollment: Math.round(cd.cumulative_minutes / 1440 * 10) / 10,
        earliest_lead_receives: earliestHit ? earliestHit.toISOString() : null,
        latest_lead_receives: latestHit ? latestHit.toISOString() : null
      };
    });

    broadcastForecast = {
      sequence_name: bSeq.name,
      total_active: bEnrollments.length,
      already_past_step_1: alreadySentStep1,
      completed: completedEnrollments,
      current_step_distribution: stepForecasts,
      projected_calendar: calendar,
      note: 'Calendar shows when earliest/latest enrolled leads receive each step. Throttle delays may push actual delivery later.'
    };
  }

  // Program-specific: leads at step 1 who haven't received step 2
  var programForecasts = [];
  var programSeqIds = Object.keys(sequences).filter(function (id) {
    return sequences[id].name && sequences[id].name.indexOf('Broadcast') === -1 &&
      sequences[id].name.indexOf('Quick Follow') === -1;
  });

  programSeqIds.forEach(function (seqId) {
    var seq = sequences[seqId];
    var seqEnrolls = enrollments.filter(function (e) {
      return e.sequence_id === seqId && e.status === 'active';
    });

    var atStep1 = seqEnrolls.filter(function (e) { return e.current_step === 1; });
    var atStep2Plus = seqEnrolls.filter(function (e) { return e.current_step > 1; });

    var step1NextSends = atStep1
      .map(function (e) { return e.next_send_at; })
      .filter(Boolean)
      .map(function (t) { return typeof t === 'string' ? new Date(t) : (t.toDate ? t.toDate() : new Date(t)); })
      .sort(function (a, b) { return a - b; });

    // Leads who received step 1 (current_step >= 2) but not yet step 2 (current_step == 2 waiting)
    var waitingForStep2 = seqEnrolls.filter(function (e) { return e.current_step === 2; });
    var step2NextSends = waitingForStep2
      .map(function (e) { return e.next_send_at; })
      .filter(Boolean)
      .map(function (t) { return typeof t === 'string' ? new Date(t) : (t.toDate ? t.toDate() : new Date(t)); })
      .sort(function (a, b) { return a - b; });

    programForecasts.push({
      sequence_name: seq.name,
      total_active: seqEnrolls.length,
      at_step_1_waiting: atStep1.length,
      step_1_next_send_earliest: step1NextSends.length ? step1NextSends[0].toISOString() : null,
      step_1_next_send_latest: step1NextSends.length ? step1NextSends[step1NextSends.length - 1].toISOString() : null,
      received_step_1_waiting_for_step_2: waitingForStep2.length,
      step_2_fires_earliest: step2NextSends.length ? step2NextSends[0].toISOString() : null,
      step_2_fires_latest: step2NextSends.length ? step2NextSends[step2NextSends.length - 1].toISOString() : null,
      at_step_2_plus: atStep2Plus.length
    });
  });

  var task4 = {
    broadcast_forecast: broadcastForecast,
    program_forecasts: programForecasts
  };

  // ─── TASK 5: Throttle Impact ────────────────────────────────────

  // Find leads with 2+ active enrollments where next_send_at is within 48h of each other
  var throttleConflicts = 0;
  var throttleExamples = [];
  Object.keys(leadSequences).forEach(function (lid) {
    if (leadSequences[lid].length < 2) return;

    // Get all next_send_at for this lead's active enrollments
    var leadEnrolls = enrollments.filter(function (e) {
      return e.lead_id === lid && e.status === 'active' && e.next_send_at;
    });
    if (leadEnrolls.length < 2) return;

    var sendTimes = leadEnrolls.map(function (e) {
      var t = e.next_send_at;
      return {
        sequence_name: e.sequence_name || (sequences[e.sequence_id] ? sequences[e.sequence_id].name : e.sequence_id),
        time: typeof t === 'string' ? new Date(t) : (t.toDate ? t.toDate() : new Date(t))
      };
    }).sort(function (a, b) { return a.time - b.time; });

    // Check if any pair is within 48h
    for (var i = 0; i < sendTimes.length - 1; i++) {
      var diff = sendTimes[i + 1].time - sendTimes[i].time;
      if (diff < 48 * 3600000) {
        throttleConflicts++;
        if (throttleExamples.length < 10) {
          throttleExamples.push({
            lead_id: lid,
            pair: [
              { seq: sendTimes[i].sequence_name, send_at: sendTimes[i].time.toISOString() },
              { seq: sendTimes[i + 1].sequence_name, send_at: sendTimes[i + 1].time.toISOString() }
            ],
            gap_hours: Math.round(diff / 3600000 * 10) / 10
          });
        }
        break; // Count lead once
      }
    }
  });

  // Simulate adding educational sequence with delay_minutes 4320 (3 days)
  // How many leads would conflict in the first week?
  var educationalConflicts = 0;
  var activeLeadIds = Object.keys(leadSequences);
  activeLeadIds.forEach(function (lid) {
    // Simulate enrollment now with first step at now + 3 days
    var eduSendAt = new Date(now.getTime() + 4320 * 60000);

    var leadEnrolls = enrollments.filter(function (e) {
      return e.lead_id === lid && e.status === 'active' && e.next_send_at;
    });

    var wouldConflict = leadEnrolls.some(function (e) {
      var t = e.next_send_at;
      var sendTime = typeof t === 'string' ? new Date(t) : (t.toDate ? t.toDate() : new Date(t));
      var diff = Math.abs(sendTime - eduSendAt);
      return diff < 48 * 3600000;
    });

    if (wouldConflict) educationalConflicts++;
  });

  var task5 = {
    leads_with_48h_overlap: throttleConflicts,
    throttle_examples: throttleExamples,
    educational_sequence_simulation: {
      scenario: 'New sequence with delay_minutes=4320 (3 days), enrolled today',
      leads_that_would_hit_throttle: educationalConflicts,
      total_active_leads: activeLeadIds.length,
      conflict_percentage: activeLeadIds.length ? Math.round(educationalConflicts / activeLeadIds.length * 1000) / 10 : 0
    }
  };

  // ─── TASK 6: Gap Analysis — leads in silence ────────────────────
  // Find leads that have completed or been exited from ALL sequences
  var allLeadIds = new Set();
  enrollments.forEach(function (e) { allLeadIds.add(e.lead_id); });

  var silentLeads = [];
  allLeadIds.forEach(function (lid) {
    var leadEnrolls = enrollments.filter(function (e) { return e.lead_id === lid; });
    var hasActive = leadEnrolls.some(function (e) { return e.status === 'active' || e.status === 'paused'; });
    if (!hasActive && leadEnrolls.length > 0) {
      var lastAction = leadEnrolls
        .map(function (e) { return e.updated_at; })
        .filter(Boolean)
        .map(function (t) { return typeof t === 'string' ? new Date(t) : (t.toDate ? t.toDate() : new Date(t)); })
        .sort(function (a, b) { return b - a; })[0];

      silentLeads.push({
        lead_id: lid,
        lead_name: leadEnrolls[0].lead_name || '(unknown)',
        lead_email: leadEnrolls[0].lead_email || '(unknown)',
        total_enrollments: leadEnrolls.length,
        statuses: leadEnrolls.map(function (e) {
          return (e.sequence_name || e.sequence_id) + ': ' + e.status + (e.exit_reason ? ' (' + e.exit_reason + ')' : '');
        }),
        last_activity: lastAction ? lastAction.toISOString() : null
      });
    }
  });

  // Sort by last activity (most recent first)
  silentLeads.sort(function (a, b) {
    if (!a.last_activity) return 1;
    if (!b.last_activity) return -1;
    return new Date(b.last_activity) - new Date(a.last_activity);
  });

  var task6 = {
    leads_in_silence: silentLeads.length,
    note: 'These leads have completed or been exited from all their sequences. They receive nothing.',
    leads: silentLeads.slice(0, 30), // Cap at 30 examples
    total_capped: silentLeads.length > 30
  };

  // ─── Recommendation ─────────────────────────────────────────────
  var recommendation = {
    parallel_vs_wait: null,
    reasoning: []
  };

  // If most broadcast leads are still at step 1, running in parallel means heavy throttle
  var broadcastAtStep1 = broadcastForecast ? broadcastForecast.current_step_distribution['step_1'] : null;
  var broadcastTotal = broadcastForecast ? broadcastForecast.total_active : 0;

  if (broadcastAtStep1 && broadcastAtStep1.leads > broadcastTotal * 0.7) {
    recommendation.parallel_vs_wait = 'WAIT';
    recommendation.reasoning.push(
      broadcastAtStep1.leads + ' of ' + broadcastTotal + ' broadcast leads are still at step 1. Running educational in parallel would create massive throttle pile-ups.'
    );
  } else if (broadcastAtStep1 && broadcastAtStep1.leads > broadcastTotal * 0.3) {
    recommendation.parallel_vs_wait = 'STAGGER';
    recommendation.reasoning.push(
      'Significant portion still early in broadcast. Stagger educational start by 1-2 weeks after broadcast completes for each lead.'
    );
  } else {
    recommendation.parallel_vs_wait = 'PARALLEL_OK';
    recommendation.reasoning.push(
      'Most broadcast leads have progressed past early steps. Educational sequence can run in parallel with manageable throttle impact.'
    );
  }

  recommendation.reasoning.push(
    'Throttle simulation: ' + educationalConflicts + '/' + activeLeadIds.length + ' leads (' + (activeLeadIds.length ? Math.round(educationalConflicts / activeLeadIds.length * 100) : 0) + '%) would hit throttle on day 1.'
  );
  recommendation.reasoning.push(
    'Silent leads: ' + silentLeads.length + ' leads receive nothing — highest priority for educational content.'
  );

  return jsonResponse(200, {
    ok: true,
    audit_timestamp: now.toISOString(),
    task1_enrollment_snapshot: task1,
    task2_email_delivery: task2,
    task3_overlap_analysis: task3,
    task4_timeline_forecast: task4,
    task5_throttle_impact: task5,
    task6_gap_analysis: task6,
    recommendation: recommendation
  });
};
