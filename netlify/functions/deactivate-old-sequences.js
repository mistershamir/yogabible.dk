/**
 * Deactivate Old Sequences — Netlify Function
 *
 * Replaces all program-specific YTT sequences with the new Personal Outreach
 * sequence (PR 3 of the migration plan). For each target sequence:
 *   1. Counts enrollments where status === 'active'
 *   2. (apply mode only) Updates each active enrollment to:
 *        { status: 'exited',
 *          exit_reason: 'sequence_replaced_by_personal_outreach',
 *          exited_at: <now> }
 *   3. (apply mode only) Sets the sequence doc:
 *        { active: false,
 *          deactivated_at: <now>,
 *          deactivated_reason: 'replaced_by_personal_outreach' }
 *
 * NOT TOUCHED:
 *   - Quick Follow-up (Ue0CYOsPJlnj5SF9PtA0)
 *   - Broadcast Nurture  (Ma2caW2hiQqtkPFesK27)
 *   - Personal Outreach (any sequence with a different name — match by id only)
 *
 * GET  /.netlify/functions/deactivate-old-sequences?mode=preview
 * POST /.netlify/functions/deactivate-old-sequences?mode=apply
 *
 * Auth: X-Internal-Secret header must equal AI_INTERNAL_SECRET.
 *
 * Idempotent: re-running apply is a no-op once enrollments are exited and
 * the sequence is inactive (active:false → no enrollments query yields
 * status:active rows).
 */

const admin = require('firebase-admin');
const { getDb } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');

const SEQUENCES_COL = 'sequences';
const ENROLLMENTS_COL = 'sequence_enrollments';

// Per Firestore docs, batch limit is 500. Use 400 for safety.
const BATCH_SIZE = 400;

// Sample enrollments to surface in the preview (so user can spot-check).
const SAMPLE_LIMIT = 5;

const TARGETS = [
  { id: 'Un1xmmriIpUyy2Kui97N', label: 'YTT Onboarding — 2026' },
  { id: 'uDST1Haj1dMyQy0Qifhu', label: '8W Semi-Intensive May–Jun' },
  { id: 'ab2dSOrmaQnneUyRojCf', label: '18W Flexible Aug–Dec' },
  { id: 'Yoq6RCVqTYlF10OPmkSw', label: 'July Vinyasa Plus DK' },
  { id: '4cpebQzFrhK3OFNVXFt0', label: 'July Vinyasa Plus International' },
  { id: 'UbKlkxQiAHff6B7zgVzQ', label: 'Educational/Lifestyle Nurture' },
  { id: 'ZwvSVLsqRZcIv8C0IG0y', label: 'April 4W Intensive (already inactive — verify only)' }
];

const EXIT_REASON = 'sequence_replaced_by_personal_outreach';
const DEACTIVATED_REASON = 'replaced_by_personal_outreach';

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
  const now = new Date();
  const results = [];

  for (const target of TARGETS) {
    const seqRef = db.collection(SEQUENCES_COL).doc(target.id);
    const seqSnap = await seqRef.get();

    const entry = {
      sequence_id: target.id,
      label: target.label,
      sequence_exists: seqSnap.exists,
      currently_active: seqSnap.exists ? !!seqSnap.data().active : null,
      active_enrollments: 0,
      sample_enrollment_ids: [],
      action: null
    };

    if (!seqSnap.exists) {
      entry.action = 'skip:sequence_not_found';
      results.push(entry);
      continue;
    }

    // Count active enrollments
    const activeSnap = await db.collection(ENROLLMENTS_COL)
      .where('sequence_id', '==', target.id)
      .where('status', '==', 'active')
      .get();
    entry.active_enrollments = activeSnap.size;
    entry.sample_enrollment_ids = activeSnap.docs.slice(0, SAMPLE_LIMIT).map((d) => ({
      enrollment_id: d.id,
      lead_id: d.data().lead_id || null,
      lead_email: d.data().lead_email || null,
      current_step: d.data().current_step || null
    }));

    if (!isApply) {
      // Preview: describe the action without writing
      if (entry.currently_active === false && entry.active_enrollments === 0) {
        entry.action = 'noop:already_deactivated_no_active_enrollments';
      } else if (entry.currently_active === false) {
        entry.action = 'exit_enrollments_only:sequence_already_inactive';
      } else {
        entry.action = 'exit_enrollments_and_deactivate_sequence';
      }
      results.push(entry);
      continue;
    }

    // Apply mode — exit enrollments in batches of 400
    let exited = 0;
    if (activeSnap.size > 0) {
      const docs = activeSnap.docs;
      for (let i = 0; i < docs.length; i += BATCH_SIZE) {
        const batch = db.batch();
        const chunk = docs.slice(i, i + BATCH_SIZE);
        for (const d of chunk) {
          batch.update(d.ref, {
            status: 'exited',
            exit_reason: EXIT_REASON,
            exited_at: now,
            updated_at: now,
            processing_lock: null
          });
        }
        await batch.commit();
        exited += chunk.length;
      }
    }

    // Flip the sequence inactive (idempotent — even if already inactive)
    await seqRef.update({
      active: false,
      deactivated_at: admin.firestore.FieldValue.serverTimestamp(),
      deactivated_reason: DEACTIVATED_REASON,
      updated_at: admin.firestore.FieldValue.serverTimestamp()
    });

    entry.action = 'applied';
    entry.enrollments_exited = exited;
    entry.sequence_deactivated = true;
    results.push(entry);
  }

  // Totals across all targets
  const totals = {
    sequences_targeted: TARGETS.length,
    sequences_found: results.filter((r) => r.sequence_exists).length,
    sequences_currently_active: results.filter((r) => r.currently_active === true).length,
    active_enrollments_total: results.reduce((s, r) => s + (r.active_enrollments || 0), 0),
    enrollments_exited_total: isApply ? results.reduce((s, r) => s + (r.enrollments_exited || 0), 0) : null
  };

  return jsonResponse(200, {
    ok: true,
    mode: isApply ? 'apply' : 'preview',
    exit_reason: EXIT_REASON,
    deactivated_reason: DEACTIVATED_REASON,
    totals,
    sequences: results,
    kept_active: [
      { id: 'Ue0CYOsPJlnj5SF9PtA0', label: 'Quick Follow-up' },
      { id: 'Ma2caW2hiQqtkPFesK27', label: 'Broadcast Nurture' },
      { note: 'Personal Outreach — All Programs (matched by name in seed-personal-outreach)' }
    ]
  });
};
