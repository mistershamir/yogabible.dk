/**
 * Enroll into Personal Outreach — Selective Backfill
 *
 * One-shot backfill of existing leads into the new Personal Outreach
 * sequence (PR 4 of the migration plan). New leads from this point forward
 * already auto-enroll via triggerNewLeadSequences; this function exists for
 * the lead-base that pre-dates the sequence.
 *
 * Segments enrolled:
 *   A. status === 'Interested In Next Round'
 *      — they've been waiting; next_send_at = now + jitter (0–30 min)
 *   B. Orphaned: ytt lead with no welcome_email_sent_at, created within
 *      the last 60 days, status not in cold/converted/exit set
 *      — normal: now + 60 min + jitter (0–2h)
 *   C. status in ('New', 'Strongly Interested') AND created < 30 days ago
 *      — normal
 *   D. status === 'Follow-up'
 *      — normal
 *
 * Cold leads (status in ('Contacted','No Answer') AND last_contact older
 * than 14d AND created older than 30d) are excluded everywhere — they need
 * a re-engagement campaign, not a drip.
 *
 * Per-lead skip filters (applied in both preview and apply):
 *   - leadData.unsubscribed === true
 *   - leadData.email_bounced === true
 *   - empty email
 *   - resolveCohortForLead(lead) returns null (no open cohort to promote)
 *   - lead already has an active enrollment for Personal Outreach
 *     (deterministic enrollment id `seqId_leadId` makes this a single read)
 *
 * GET  /.netlify/functions/enroll-personal-outreach?mode=preview
 * POST /.netlify/functions/enroll-personal-outreach?mode=apply
 *
 * Auth: X-Internal-Secret. Preview reports per-segment counts + 5 sample
 * leads each. Apply also reports per-segment "enrolled" + "skipped" tallies.
 *
 * Idempotent: re-running apply skips leads already enrolled, so a partial
 * run that's interrupted can be safely resumed.
 */

const { getDb } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');
const { resolveCohortForLead } = require('./shared/cohort-resolver');

const SEQUENCES_COL = 'sequences';
const ENROLLMENTS_COL = 'sequence_enrollments';
const LEADS_COL = 'leads';

const PERSONAL_OUTREACH_NAME = 'Personal Outreach — All Programs';

const SAMPLE_LIMIT = 5;
const ORPHAN_LOOKBACK_DAYS = 60;
const RECENT_LOOKBACK_DAYS = 30;
const COLD_INACTIVITY_DAYS = 14;
const COLD_AGE_DAYS = 30;
const COLD_STATUSES = new Set(['Contacted', 'No Answer']);
const EXIT_STATUSES = new Set([
  'Converted', 'Existing Applicant', 'Unsubscribed', 'Lost',
  'Closed', 'Archived', 'Not too keen'
]);

// Per-segment send-time policy
function nextSendForSegment(segment, baseDelayMinutes) {
  const now = Date.now();
  if (segment === 'A') {
    // Interested In Next Round — they've been waiting. 0–30 min jitter.
    return new Date(now + Math.floor(Math.random() * 30 * 60 * 1000));
  }
  // Normal: base step-1 delay + 0–2h jitter to avoid burst
  const base = baseDelayMinutes * 60 * 1000;
  const jitter = Math.floor(Math.random() * 2 * 60 * 60 * 1000);
  return new Date(now + base + jitter);
}

function toDate(v) {
  if (!v) return null;
  if (v.toDate) return v.toDate();
  return new Date(v);
}

function isCold(lead, now) {
  const status = (lead.status || '').trim();
  if (!COLD_STATUSES.has(status)) return false;
  const created = toDate(lead.created_at);
  const lastContact = toDate(lead.last_contact);
  const ageOk = !created || (now - created) > COLD_AGE_DAYS * 24 * 60 * 60 * 1000;
  const inactivityOk = !lastContact || (now - lastContact) > COLD_INACTIVITY_DAYS * 24 * 60 * 60 * 1000;
  return ageOk && inactivityOk;
}

function leadSummary(leadDoc) {
  const d = leadDoc.data();
  return {
    lead_id: leadDoc.id,
    email: d.email || '',
    first_name: d.first_name || '',
    status: d.status || '',
    ytt_program_type: d.ytt_program_type || d.program_type || '',
    lang: d.lang || d.meta_lang || '',
    created_at: toDate(d.created_at) ? toDate(d.created_at).toISOString() : null
  };
}

async function findPersonalOutreach(db) {
  const snap = await db.collection(SEQUENCES_COL)
    .where('name', '==', PERSONAL_OUTREACH_NAME)
    .where('active', '==', true)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, data: doc.data() };
}

// ── Segment fetchers ────────────────────────────────────────────────────────

async function fetchSegmentA(db) {
  const snap = await db.collection(LEADS_COL)
    .where('status', '==', 'Interested In Next Round')
    .get();
  return snap.docs;
}

async function fetchSegmentB(db, now) {
  // Ytt leads, created within ORPHAN_LOOKBACK_DAYS, never received a welcome.
  // We post-filter for missing welcome_email_sent_at + status sanity to keep
  // the Firestore query simple (no composite index required).
  const cutoff = new Date(now.getTime() - ORPHAN_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const snap = await db.collection(LEADS_COL)
    .where('lead_type', '==', 'ytt')
    .where('created_at', '>=', cutoff)
    .get();
  return snap.docs.filter((doc) => {
    const d = doc.data();
    if (d.welcome_email_sent_at) return false;
    const status = (d.status || '').trim();
    if (EXIT_STATUSES.has(status)) return false;
    if (isCold(d, now)) return false;
    return true;
  });
}

async function fetchSegmentC(db, now) {
  const cutoff = new Date(now.getTime() - RECENT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const snap = await db.collection(LEADS_COL)
    .where('status', 'in', ['New', 'Strongly Interested'])
    .where('created_at', '>=', cutoff)
    .get();
  // Limit to ytt leads (some 'New' leads may not be YTT — courses, mentorship etc.)
  return snap.docs.filter((doc) => {
    const d = doc.data();
    return (d.lead_type || '') === 'ytt' || !!d.ytt_program_type;
  });
}

async function fetchSegmentD(db) {
  const snap = await db.collection(LEADS_COL)
    .where('status', '==', 'Follow-up')
    .get();
  // Same ytt filter as C — Follow-up may include non-YTT inquiries
  return snap.docs.filter((doc) => {
    const d = doc.data();
    return (d.lead_type || '') === 'ytt' || !!d.ytt_program_type;
  });
}

// ── Per-lead enrollment guard ───────────────────────────────────────────────

async function evaluateLead(db, leadDoc, sequenceId) {
  const data = leadDoc.data();
  const reasons = [];

  if (!data.email) reasons.push('no_email');
  if (data.unsubscribed === true) reasons.push('unsubscribed');
  if (data.email_bounced === true) reasons.push('bounced');

  let cohortHint = null;
  if (reasons.length === 0) {
    const cohortCtx = await resolveCohortForLead(data);
    if (!cohortCtx) reasons.push('no_active_cohort');
    else cohortHint = cohortCtx.cohort.id || cohortCtx.cohort._docId;
  }

  if (reasons.length === 0) {
    const enrollId = sequenceId + '_' + leadDoc.id;
    const existing = await db.collection(ENROLLMENTS_COL).doc(enrollId).get();
    if (existing.exists && existing.data().status === 'active') {
      reasons.push('already_enrolled');
    }
  }

  return { skip: reasons.length > 0, reasons, cohort_hint: cohortHint };
}

// ── Handler ────────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  const secret = process.env.AI_INTERNAL_SECRET;
  const provided = (event.headers['x-internal-secret'] || event.headers['X-Internal-Secret'] || '').trim();
  if (!secret || provided !== secret) {
    return jsonResponse(401, { error: 'Unauthorized' });
  }

  const params = event.queryStringParameters || {};
  const mode = (params.mode || 'preview').toLowerCase();
  const isApply = mode === 'apply';
  if (isApply && event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'mode=apply requires POST' });
  }

  const db = getDb();
  const personal = await findPersonalOutreach(db);
  if (!personal) {
    return jsonResponse(412, { error: 'Personal Outreach sequence not found or inactive. Run seed-personal-outreach first.' });
  }
  const sequenceId = personal.id;
  const baseDelayMinutes = (personal.data.steps && personal.data.steps[0] && personal.data.steps[0].delay_minutes) || 60;

  const now = new Date();

  const segments = {
    A: { label: 'Interested In Next Round (immediate-ish)', fetch: () => fetchSegmentA(db) },
    B: { label: 'Orphaned (no welcome_email_sent_at, created within ' + ORPHAN_LOOKBACK_DAYS + 'd)', fetch: () => fetchSegmentB(db, now) },
    C: { label: 'Recent New / Strongly Interested (created within ' + RECENT_LOOKBACK_DAYS + 'd)', fetch: () => fetchSegmentC(db, now) },
    D: { label: 'Follow-up status', fetch: () => fetchSegmentD(db) }
  };

  const report = {};
  let totalEligible = 0, totalEnrolled = 0;
  const skipReasonTally = {};

  for (const [segId, segDef] of Object.entries(segments)) {
    const docs = await segDef.fetch();

    const eligible = [];
    const skipped = [];

    for (const doc of docs) {
      const ev = await evaluateLead(db, doc, sequenceId);
      if (ev.skip) {
        skipped.push({ lead: leadSummary(doc), reasons: ev.reasons });
        ev.reasons.forEach((r) => { skipReasonTally[r] = (skipReasonTally[r] || 0) + 1; });
      } else {
        eligible.push({ lead: leadSummary(doc), cohort_hint: ev.cohort_hint, doc });
      }
    }

    let enrolledThisSeg = 0;
    let writeErrors = [];

    if (isApply) {
      for (const e of eligible) {
        try {
          const enrollId = sequenceId + '_' + e.doc.id;
          const nextSendAt = nextSendForSegment(segId, baseDelayMinutes);
          await db.collection(ENROLLMENTS_COL).doc(enrollId).set({
            sequence_id: sequenceId,
            sequence_name: PERSONAL_OUTREACH_NAME,
            lead_id: e.doc.id,
            lead_email: e.lead.email,
            lead_name: e.lead.first_name,
            current_step: 1,
            status: 'active',
            exit_reason: null,
            next_send_at: nextSendAt,
            started_at: now,
            updated_at: now,
            step_history: [],
            trigger: 'backfill:personal_outreach',
            backfill_segment: segId
          });
          enrolledThisSeg++;
        } catch (err) {
          writeErrors.push({ lead_id: e.doc.id, error: err.message });
        }
      }
    }

    totalEligible += eligible.length;
    totalEnrolled += enrolledThisSeg;

    report[segId] = {
      label: segDef.label,
      raw_count: docs.length,
      eligible_count: eligible.length,
      skipped_count: skipped.length,
      enrolled_count: isApply ? enrolledThisSeg : null,
      sample_eligible: eligible.slice(0, SAMPLE_LIMIT).map((e) => ({
        lead_id: e.doc.id,
        email: e.lead.email,
        first_name: e.lead.first_name,
        status: e.lead.status,
        ytt_program_type: e.lead.ytt_program_type,
        lang: e.lead.lang,
        cohort_hint: e.cohort_hint
      })),
      sample_skipped: skipped.slice(0, SAMPLE_LIMIT),
      send_policy: segId === 'A'
        ? 'now + 0–30min jitter'
        : 'now + ' + baseDelayMinutes + 'min + 0–2h jitter',
      write_errors: writeErrors
    };
  }

  return jsonResponse(200, {
    ok: true,
    mode: isApply ? 'apply' : 'preview',
    sequence_id: sequenceId,
    sequence_name: PERSONAL_OUTREACH_NAME,
    base_delay_minutes: baseDelayMinutes,
    totals: {
      eligible: totalEligible,
      enrolled: isApply ? totalEnrolled : null,
      skip_reasons: skipReasonTally
    },
    segments: report,
    notes: [
      'Cold leads (Contacted/No Answer + 14d inactive + 30d old) are excluded — they need a re-engagement campaign, not a drip.',
      'Idempotent: re-running apply skips leads already enrolled in Personal Outreach.',
      'Send-time jitter spreads bursts across 0–2 hours to stay polite to Resend and the inbox.'
    ]
  });
};
