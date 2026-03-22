/**
 * Diagnose & Fix Unenrolled Leads — Netlify Background Function (15-min timeout)
 *
 * POST /.netlify/functions/diagnose-unenrolled-background                    — diagnose only
 * POST /.netlify/functions/diagnose-unenrolled-background?fix=true           — diagnose + enroll
 * POST /.netlify/functions/diagnose-unenrolled-background?fix=true&dry_run=true — preview fix
 *
 * Auth: X-Internal-Secret header
 *
 * Finds all YTT leads with NO active/paused sequence enrollment, categorises
 * why they were missed, and optionally enrolls them into the correct sequences.
 *
 * Results written to Firestore: system/last_unenrolled_diagnosis
 */

const { getDb, serverTimestamp } = require('./shared/firestore');
const { optionsResponse } = require('./shared/utils');

const ENROLLMENTS_COL = 'sequence_enrollments';

// ── Program → Sequence mapping (uses .includes() for multi-format) ──────────

const PROGRAM_SEQUENCES = [
  { match: '4-week-jul', name: 'July Vinyasa Plus — International Nurture' },
  { match: '8-week',     name: '8W Semi-Intensive May–Jun — DK Nurture' },
  { match: '18-week-aug', name: '18W Flexible Aug–Dec — DK Nurture' },
  { match: '18-week',    name: '18W Flexible Aug–Dec — DK Nurture' },
  { match: '4-week',     name: 'April 4W Intensive — Conversion Push' }
];

const ONBOARDING_NAME = 'YTT Onboarding — 2026';

// Older/variant program type aliases that should map to our sequences
const ALIAS_MAP = {
  '4w-apr':    '4-week',
  '4w-april':  '4-week',
  '4w':        '4-week',
  '4w-jul':    '4-week-jul',
  '4w-july':   '4-week-jul',
  '8w':        '8-week',
  '18w':       '18-week',
  '18w-mar':   '18-week',       // March 18w is sold out → nudge to Aug-Dec
  '18w-march': '18-week',
  '18w-aug':   '18-week-aug',
  '18-week-mar': '18-week'
};

/**
 * Given a ytt_program_type string (may contain commas for multi-format),
 * return all matching sequence names.
 */
function getMatchingSequences(programType) {
  if (!programType) return [];

  var matches = [];
  var seen = new Set();

  // Normalise: expand aliases for each comma-separated token
  var tokens = programType.split(',').map(function (t) { return t.trim(); });
  var normalised = [];
  for (var i = 0; i < tokens.length; i++) {
    var t = tokens[i];
    normalised.push(ALIAS_MAP[t] || t);
  }
  var expanded = normalised.join(',');

  // Check each program sequence using .includes()
  for (var j = 0; j < PROGRAM_SEQUENCES.length; j++) {
    var ps = PROGRAM_SEQUENCES[j];
    if (expanded.includes(ps.match) && !seen.has(ps.name)) {
      matches.push(ps.name);
      seen.add(ps.name);
    }
  }

  return matches;
}

// ── Handler ──────────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ ok: false, error: 'POST only' }) };
  }

  var secret = (event.headers || {})['x-internal-secret'] || (event.headers || {})['X-Internal-Secret'] || '';
  if (!secret || secret !== process.env.AI_INTERNAL_SECRET) {
    return { statusCode: 401, body: JSON.stringify({ ok: false, error: 'Unauthorized' }) };
  }

  var params = event.queryStringParameters || {};
  var doFix = params.fix === 'true';
  var dryRun = params.dry_run === 'true';

  // Return 202 immediately, do work async
  doWork(doFix, dryRun).catch(function (err) {
    console.error('[diagnose-unenrolled] Fatal error:', err);
  });

  return {
    statusCode: 202,
    body: JSON.stringify({
      ok: true,
      message: doFix ? (dryRun ? 'Dry-run fix started' : 'Fix started') : 'Diagnosis started',
      check: 'system/last_unenrolled_diagnosis'
    })
  };
};

async function doWork(doFix, dryRun) {
  var db = getDb();

  try {
    // ── 1. Load all data in parallel ──────────────────────────────────────

    var [leadsSnap, enrollSnap, dripSnap, seqSnap] = await Promise.all([
      db.collection('leads').where('type', '==', 'ytt').get(),
      db.collection(ENROLLMENTS_COL).where('status', 'in', ['active', 'paused']).get(),
      db.collection('lead_drip_sequences').get(),
      db.collection('sequences').where('active', '==', true).get()
    ]);

    // Build sequence name → {id, steps} map
    var sequenceMap = {};
    seqSnap.forEach(function (doc) {
      var data = doc.data();
      sequenceMap[data.name] = { id: doc.id, name: data.name, steps: data.steps || [] };
    });

    // Build enrolled lead IDs set
    var enrolledLeadIds = new Set();
    enrollSnap.forEach(function (doc) {
      enrolledLeadIds.add(doc.data().lead_id);
    });

    // Build active drip lead IDs + drip info
    var activeDripLeadIds = new Set();
    var dripInfo = {};
    dripSnap.forEach(function (doc) {
      var data = doc.data();
      if (!data.completed && !data.paused) {
        activeDripLeadIds.add(doc.id);
        dripInfo[doc.id] = {
          current_step: data.current_step || 0,
          next_send_at: data.next_send_at || null,
          completed: !!data.completed,
          paused: !!data.paused
        };
      }
    });

    // Filter to unenrolled YTT leads (same logic as nurture dashboard)
    var unenrolled = [];
    leadsSnap.forEach(function (doc) {
      var lead = doc.data();
      if (lead.converted === true || lead.converted === 'true') return;
      if (lead.unsubscribed === true) return;
      if (enrolledLeadIds.has(doc.id)) return;
      unenrolled.push({ id: doc.id, ...lead });
    });

    // ── 2. Bulk email counts ──────────────────────────────────────────────

    var emailAddrs = unenrolled.map(function (l) { return l.email; }).filter(Boolean);
    var emailCountByAddr = {};

    for (var batch = 0; batch < emailAddrs.length; batch += 30) {
      var chunk = emailAddrs.slice(batch, batch + 30);
      try {
        var logSnap = await db.collection('email_log')
          .where('to', 'in', chunk)
          .where('status', '==', 'sent')
          .get();
        logSnap.forEach(function (doc) {
          var to = doc.data().to;
          emailCountByAddr[to] = (emailCountByAddr[to] || 0) + 1;
        });
      } catch (e) {
        console.log('[diagnose] email_log batch query failed:', e.message);
      }
    }

    // ── 3. Categorise each unenrolled lead ────────────────────────────────

    var categories = {
      multi_format: [],
      mid_agent_drip: [],
      prior_emails_no_match: [],
      unknown: []
    };

    for (var i = 0; i < unenrolled.length; i++) {
      var lead = unenrolled[i];
      var program = lead.ytt_program_type || '';
      var priorEmails = emailCountByAddr[lead.email] || 0;
      var isMultiFormat = program.includes(',');
      var inDrip = activeDripLeadIds.has(lead.id);

      var entry = {
        lead_id: lead.id,
        name: lead.first_name || lead.name || 'Unknown',
        email: lead.email || '',
        phone: lead.phone || '',
        ytt_program_type: program,
        cohort_label: lead.cohort_label || '',
        prior_emails: priorEmails,
        created_at: lead.created_at || null
      };

      if (inDrip) {
        // Mid-agent drip — leave them alone
        entry.reason = 'mid_agent_drip';
        entry.drip_step = (dripInfo[lead.id] || {}).current_step || 0;
        entry.drip_next_send = (dripInfo[lead.id] || {}).next_send_at || null;
        categories.mid_agent_drip.push(entry);
        continue;
      }

      if (isMultiFormat) {
        // Multi-format lead — batch script used === so it couldn't match
        var matchingSeqs = getMatchingSequences(program);
        entry.reason = 'multi_format';
        entry.matching_sequences = matchingSeqs;
        entry.should_get_onboarding = priorEmails < 2;
        categories.multi_format.push(entry);
        continue;
      }

      // Single-format lead: check if the original getSequenceForLead would have matched
      var matchesStandard = getMatchingSequences(program);

      if (matchesStandard.length === 0 && priorEmails >= 2) {
        // Program type wasn't recognised by the batch script AND had 2+ prior emails
        // so onboarding was skipped too → completely fell through
        var aliasedSeqs = getMatchingSequences(program);
        entry.reason = 'prior_emails_no_match';
        entry.matching_sequences_via_alias = aliasedSeqs;
        entry.should_get_onboarding = false;
        categories.prior_emails_no_match.push(entry);
        continue;
      }

      if (matchesStandard.length === 0 && priorEmails < 2) {
        // Program type not recognised, but should have gotten onboarding at least
        entry.reason = 'unknown';
        entry.note = 'Program type unrecognised and < 2 prior emails — should have been enrolled in Onboarding';
        entry.matching_sequences_via_alias = getMatchingSequences(program);
        entry.should_get_onboarding = true;
        categories.unknown.push(entry);
        continue;
      }

      if (matchesStandard.length > 0) {
        // Has a program match but still unenrolled — likely mid-drip or timing issue
        entry.reason = 'unknown';
        entry.note = 'Program matched ' + matchesStandard.join(', ') + ' but not enrolled — may have been skipped by batch script timing';
        entry.matching_sequences = matchesStandard;
        entry.should_get_onboarding = priorEmails < 2;
        categories.unknown.push(entry);
        continue;
      }

      // Catch-all
      entry.reason = 'unknown';
      entry.note = 'No clear categorisation';
      categories.unknown.push(entry);
    }

    // ── 4. Fix: Enroll leads into matching sequences ──────────────────────

    var fixResults = { enrolled: 0, enrollments_created: 0, skipped_mid_drip: categories.mid_agent_drip.length, errors: [] };

    if (doFix) {
      // Combine multi_format + prior_emails_no_match + unknown (where matching sequences exist)
      var toEnroll = [];

      // Multi-format leads → all matching sequences + onboarding if eligible
      for (var m = 0; m < categories.multi_format.length; m++) {
        var mf = categories.multi_format[m];
        var seqs = (mf.matching_sequences || []).slice();
        if (mf.should_get_onboarding) seqs.push(ONBOARDING_NAME);
        if (seqs.length > 0) toEnroll.push({ lead: mf, sequences: seqs });
      }

      // Prior-emails-no-match → alias-resolved sequences (no onboarding since 2+ emails)
      for (var p = 0; p < categories.prior_emails_no_match.length; p++) {
        var pe = categories.prior_emails_no_match[p];
        var peSeqs = (pe.matching_sequences_via_alias || []).slice();
        if (peSeqs.length > 0) toEnroll.push({ lead: pe, sequences: peSeqs });
      }

      // Unknown with matching sequences
      for (var u = 0; u < categories.unknown.length; u++) {
        var uk = categories.unknown[u];
        var ukSeqs = (uk.matching_sequences || uk.matching_sequences_via_alias || []).slice();
        if (uk.should_get_onboarding) ukSeqs.push(ONBOARDING_NAME);
        if (ukSeqs.length > 0) toEnroll.push({ lead: uk, sequences: ukSeqs });
      }

      for (var e = 0; e < toEnroll.length; e++) {
        var item = toEnroll[e];
        var lead = item.lead;

        for (var s = 0; s < item.sequences.length; s++) {
          var seqName = item.sequences[s];
          var sequence = sequenceMap[seqName];

          if (!sequence) {
            fixResults.errors.push({ lead_id: lead.lead_id, email: lead.email, error: 'Sequence not found: ' + seqName });
            continue;
          }

          if (!dryRun) {
            try {
              var now = new Date();
              var firstStepDelay = (sequence.steps[0] && sequence.steps[0].delay_minutes) || 0;
              var nextSendAt = new Date(now.getTime() + firstStepDelay * 60 * 1000);

              await db.collection(ENROLLMENTS_COL).add({
                sequence_id: sequence.id,
                sequence_name: sequence.name,
                lead_id: lead.lead_id,
                lead_email: lead.email || '',
                lead_name: lead.name || '',
                current_step: 1,
                status: 'active',
                exit_reason: null,
                next_send_at: nextSendAt.toISOString(),
                started_at: now.toISOString(),
                updated_at: now.toISOString(),
                step_history: [],
                trigger: 'backfill_fix',
                created_at: serverTimestamp()
              });

              fixResults.enrollments_created++;
            } catch (err) {
              fixResults.errors.push({ lead_id: lead.lead_id, email: lead.email, sequence: seqName, error: err.message });
            }
          } else {
            fixResults.enrollments_created++;
          }
        }

        fixResults.enrolled++;
      }
    }

    // ── 5. Write results ──────────────────────────────────────────────────

    var diagnosis = {
      ok: true,
      ran_at: serverTimestamp(),
      mode: doFix ? (dryRun ? 'dry_run_fix' : 'fix') : 'diagnose_only',
      total_unenrolled: unenrolled.length,
      breakdown: {
        multi_format: categories.multi_format.length,
        mid_agent_drip: categories.mid_agent_drip.length,
        prior_emails_no_match: categories.prior_emails_no_match.length,
        unknown: categories.unknown.length
      },
      multi_format: categories.multi_format,
      mid_agent_drip: categories.mid_agent_drip,
      prior_emails_no_match: categories.prior_emails_no_match,
      unknown: categories.unknown,
      fix_results: doFix ? fixResults : null,
      available_sequences: Object.keys(sequenceMap),
      completed_at: new Date().toISOString()
    };

    await db.collection('system').doc('last_unenrolled_diagnosis').set(diagnosis);

    console.log('[diagnose-unenrolled] ===== DIAGNOSIS COMPLETE =====');
    console.log('[diagnose-unenrolled] Total unenrolled:', unenrolled.length);
    console.log('[diagnose-unenrolled] Multi-format:', categories.multi_format.length);
    console.log('[diagnose-unenrolled] Mid-agent-drip:', categories.mid_agent_drip.length);
    console.log('[diagnose-unenrolled] Prior-emails-no-match:', categories.prior_emails_no_match.length);
    console.log('[diagnose-unenrolled] Unknown:', categories.unknown.length);
    if (doFix) {
      console.log('[diagnose-unenrolled] Fix:', dryRun ? 'DRY RUN' : 'EXECUTED');
      console.log('[diagnose-unenrolled] Leads enrolled:', fixResults.enrolled);
      console.log('[diagnose-unenrolled] Enrollments created:', fixResults.enrollments_created);
      console.log('[diagnose-unenrolled] Errors:', fixResults.errors.length);
    }

  } catch (err) {
    console.error('[diagnose-unenrolled] Fatal:', err);
    await db.collection('system').doc('last_unenrolled_diagnosis').set({
      ok: false,
      error: err.message,
      ran_at: serverTimestamp()
    });
  }
}
