/**
 * Reverse the Personal Outreach backfill from PR 4.
 *
 * The PR 4 backfill enrolled ~236 pre-existing leads into Personal Outreach,
 * but those leads had already received the one-off June announcement campaign
 * — Personal Outreach was meant for NEW leads going forward only.
 *
 * Backfill enrollments are tagged with `trigger: 'backfill:personal_outreach'`
 * (and `backfill_segment: 'A'|'B'|'C'|'D'`). Auto-trigger enrollments from
 * sequence-trigger.js use `trigger: 'new_lead'` or `'status_change'`. We exit
 * the former and leave the latter alone.
 *
 * GET  /.netlify/functions/reverse-personal-outreach-backfill?mode=preview
 * POST /.netlify/functions/reverse-personal-outreach-backfill?mode=apply
 *
 * Auth: X-Internal-Secret header must equal AI_INTERNAL_SECRET.
 *
 * Idempotent: re-running apply skips already-exited rows.
 */

const { getDb } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');

const SEQUENCES_COL = 'sequences';
const ENROLLMENTS_COL = 'sequence_enrollments';

const PERSONAL_OUTREACH_NAME = 'Personal Outreach — All Programs';
const BACKFILL_TRIGGER = 'backfill:personal_outreach';
const EXIT_REASON = 'backfill_reversed';

const BATCH_SIZE = 400;
const SAMPLE_LIMIT = 5;

async function findPersonalOutreachId(db) {
  const snap = await db.collection(SEQUENCES_COL)
    .where('name', '==', PERSONAL_OUTREACH_NAME)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return snap.docs[0].id;
}

function summarize(enrollDoc) {
  const d = enrollDoc.data();
  return {
    enrollment_id: enrollDoc.id,
    lead_id: d.lead_id,
    lead_email: d.lead_email || '',
    lead_name: d.lead_name || '',
    trigger: d.trigger || '',
    backfill_segment: d.backfill_segment || null,
    current_step: d.current_step || null,
    started_at: d.started_at && d.started_at.toDate ? d.started_at.toDate().toISOString() : (d.started_at || null)
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  const secret = process.env.AI_INTERNAL_SECRET;
  const provided = (event.headers['x-internal-secret'] || event.headers['X-Internal-Secret'] || '').trim();
  if (!secret || provided !== secret) {
    return jsonResponse(401, { error: 'Unauthorized' });
  }

  const mode = ((event.queryStringParameters || {}).mode || 'preview').toLowerCase();
  const isApply = mode === 'apply';
  if (isApply && event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'mode=apply requires POST' });
  }

  const db = getDb();

  const sequenceId = await findPersonalOutreachId(db);
  if (!sequenceId) {
    return jsonResponse(404, { error: 'Personal Outreach sequence not found' });
  }

  // Fetch all active enrollments for Personal Outreach. Partition in-memory
  // by trigger so we can report kept vs reversed without two separate queries
  // (and without needing a composite index on sequence_id + trigger).
  const snap = await db.collection(ENROLLMENTS_COL)
    .where('sequence_id', '==', sequenceId)
    .where('status', '==', 'active')
    .get();

  const reverseTargets = [];
  const keepTargets = [];
  const segmentCounts = { A: 0, B: 0, C: 0, D: 0, _unknown: 0 };
  const keepTriggerCounts = {};

  snap.forEach((doc) => {
    const d = doc.data();
    const trig = d.trigger || '';
    if (trig === BACKFILL_TRIGGER || trig.indexOf('backfill:') === 0) {
      reverseTargets.push(doc);
      const seg = d.backfill_segment || '_unknown';
      segmentCounts[seg] = (segmentCounts[seg] || 0) + 1;
    } else {
      keepTargets.push(doc);
      const k = trig || '_no_trigger';
      keepTriggerCounts[k] = (keepTriggerCounts[k] || 0) + 1;
    }
  });

  const result = {
    mode: isApply ? 'apply' : 'preview',
    sequence_id: sequenceId,
    sequence_name: PERSONAL_OUTREACH_NAME,
    total_active_enrollments: snap.size,
    to_reverse: reverseTargets.length,
    to_keep: keepTargets.length,
    reverse_breakdown_by_segment: segmentCounts,
    keep_breakdown_by_trigger: keepTriggerCounts,
    sample_to_reverse: reverseTargets.slice(0, SAMPLE_LIMIT).map(summarize),
    sample_to_keep: keepTargets.slice(0, SAMPLE_LIMIT).map(summarize)
  };

  if (!isApply) {
    return jsonResponse(200, result);
  }

  // Apply: exit the backfill enrollments in batches.
  const now = new Date();
  let reversed = 0;
  const errors = [];

  for (let i = 0; i < reverseTargets.length; i += BATCH_SIZE) {
    const chunk = reverseTargets.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    chunk.forEach((doc) => {
      batch.update(doc.ref, {
        status: 'exited',
        exit_reason: EXIT_REASON,
        exited_at: now,
        updated_at: now
      });
    });
    try {
      await batch.commit();
      reversed += chunk.length;
    } catch (err) {
      errors.push({ batch_start: i, size: chunk.length, error: err.message });
    }
  }

  result.reversed = reversed;
  result.errors = errors;
  return jsonResponse(200, result);
};
