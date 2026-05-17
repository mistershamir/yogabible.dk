/**
 * Audit Missing Personal Outreach Enrollments
 *
 * Finds recent YTT leads that should be in the Personal Outreach sequence
 * (9UUm4uK8ggfWbTLeciAO) but aren't — the gap left by the fire-and-forget
 * bug in lead.js that landed before commit a7f8f2bd.
 *
 * GET  /.netlify/functions/audit-missing-enrollments?mode=preview
 *      → { enrolled: { count, samples }, missing: { count, samples } }
 *
 * POST /.netlify/functions/audit-missing-enrollments?mode=enroll
 *      body: { "confirm": "YES" }
 *      → Enrolls each missing lead with trigger: 'new_lead', current_step: 1,
 *        next_send_at = now + steps[0].delay_minutes (same shape as the
 *        auto-trigger in shared/sequence-trigger.js).
 *
 * Auth: X-Internal-Secret header.
 *
 * Scope:
 *   - type === 'ytt'
 *   - created_at >= 2026-05-03 (window where the bug was live)
 *   - status NOT in exit set
 *   - email present
 *
 * Idempotent — deterministic enrollment doc id (`seqId_leadId`) means
 * re-running enroll won't create duplicates.
 */

const { getDb } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');

const SEQUENCE_ID = '9UUm4uK8ggfWbTLeciAO';
const SEQUENCE_NAME = 'Personal Outreach — All Programs';
const LEAD_CUTOFF = new Date('2026-05-03T00:00:00Z');

const SAMPLE_LIMIT = 25;

const EXIT_STATUSES = new Set([
  'Converted',
  'Existing Applicant',
  'Unsubscribed',
  'Lost',
  'Closed',
  'Archived',
  'Not too keen'
]);

function toDate(v) {
  if (!v) return null;
  if (v.toDate) return v.toDate();
  return new Date(v);
}

function leadSummary(doc) {
  const d = doc.data();
  const created = toDate(d.created_at);
  return {
    lead_id: doc.id,
    name: d.name || d.first_name || '',
    email: d.email || '',
    source: d.source || d.utm_source || '',
    ytt_program_type: d.ytt_program_type || d.program_type || '',
    status: d.status || '',
    lang: d.lang || d.meta_lang || '',
    created_at: created ? created.toISOString() : null
  };
}

async function loadSequence(db) {
  const snap = await db.collection('sequences').doc(SEQUENCE_ID).get();
  if (!snap.exists) return null;
  return { id: snap.id, data: snap.data() };
}

async function loadEnrolledLeadIds(db) {
  // Pre-fetch every enrollment for this sequence (regardless of status) so a
  // lead that already completed / exited is still treated as "enrolled" and
  // not re-added. Deterministic enrollment ids are `<seqId>_<leadId>` so this
  // bounds the scan to one sequence's enrollments only.
  const snap = await db.collection('sequence_enrollments')
    .where('sequence_id', '==', SEQUENCE_ID)
    .get();
  const ids = new Set();
  snap.forEach((d) => {
    const lid = d.data().lead_id;
    if (lid) ids.add(lid);
  });
  return ids;
}

async function loadEligibleLeads(db) {
  // Single-field query on created_at — same pattern as enroll-personal-outreach.
  const snap = await db.collection('leads')
    .where('created_at', '>=', LEAD_CUTOFF)
    .get();
  const docs = [];
  snap.forEach((doc) => {
    const d = doc.data();
    if ((d.type || '') !== 'ytt') return;
    if (!d.email) return;
    const status = (d.status || '').trim();
    if (EXIT_STATUSES.has(status)) return;
    docs.push(doc);
  });
  return docs;
}

function partition(docs, enrolledIds) {
  const enrolled = [];
  const missing = [];
  for (const doc of docs) {
    if (enrolledIds.has(doc.id)) enrolled.push(doc);
    else missing.push(doc);
  }
  return { enrolled, missing };
}

function buildReport(enrolledDocs, missingDocs) {
  // Sort missing newest-first so the freshest leads (most time-sensitive) sit
  // at the top of the sample.
  const sortedMissing = missingDocs.slice().sort((a, b) => {
    const ad = toDate(a.data().created_at);
    const bd = toDate(b.data().created_at);
    return (bd ? bd.getTime() : 0) - (ad ? ad.getTime() : 0);
  });
  return {
    sequence_id: SEQUENCE_ID,
    sequence_name: SEQUENCE_NAME,
    cutoff: LEAD_CUTOFF.toISOString(),
    exit_statuses: Array.from(EXIT_STATUSES),
    enrolled: {
      count: enrolledDocs.length,
      samples: enrolledDocs.slice(0, SAMPLE_LIMIT).map(leadSummary)
    },
    missing: {
      count: missingDocs.length,
      samples: sortedMissing.slice(0, SAMPLE_LIMIT).map(leadSummary)
    }
  };
}

async function enrollMissing(db, sequence, missingDocs) {
  const baseDelayMinutes = (sequence.data.steps && sequence.data.steps[0] && sequence.data.steps[0].delay_minutes) || 60;
  const now = new Date();
  const nextSendAt = new Date(now.getTime() + baseDelayMinutes * 60 * 1000);

  const writes = missingDocs.map((doc) => {
    const d = doc.data();
    return {
      ref: db.collection('sequence_enrollments').doc(SEQUENCE_ID + '_' + doc.id),
      data: {
        sequence_id: SEQUENCE_ID,
        sequence_name: SEQUENCE_NAME,
        lead_id: doc.id,
        lead_email: d.email || '',
        lead_name: d.name || d.first_name || '',
        current_step: 1,
        status: 'active',
        exit_reason: null,
        next_send_at: nextSendAt,
        started_at: now,
        updated_at: now,
        step_history: [],
        trigger: 'new_lead'
      },
      lead_id: doc.id
    };
  });

  const BATCH_SIZE = 400;
  const errors = [];
  let written = 0;

  for (let i = 0; i < writes.length; i += BATCH_SIZE) {
    const chunk = writes.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    chunk.forEach((w) => batch.set(w.ref, w.data));
    try {
      await batch.commit();
      written += chunk.length;
    } catch (err) {
      chunk.forEach((w) => errors.push({ lead_id: w.lead_id, error: err.message }));
    }
  }

  return {
    base_delay_minutes: baseDelayMinutes,
    next_send_at: nextSendAt.toISOString(),
    attempted: writes.length,
    written,
    errors
  };
}

function parseBody(event) {
  if (!event.body) return {};
  try {
    return JSON.parse(event.body);
  } catch (_) {
    return {};
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  const secret = process.env.AI_INTERNAL_SECRET;
  const provided = (event.headers['x-internal-secret'] || event.headers['X-Internal-Secret'] || '').trim();
  if (!secret || provided !== secret) {
    return jsonResponse(401, { error: 'Unauthorized' });
  }

  const params = event.queryStringParameters || {};
  const mode = (params.mode || 'preview').toLowerCase();
  const isEnroll = mode === 'enroll';

  if (isEnroll && event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'mode=enroll requires POST' });
  }

  if (isEnroll) {
    const body = parseBody(event);
    if (body.confirm !== 'YES') {
      return jsonResponse(400, { error: 'mode=enroll requires body { "confirm": "YES" }' });
    }
  }

  try {
    const db = getDb();

    const sequence = await loadSequence(db);
    if (!sequence) {
      return jsonResponse(404, { error: 'sequence_not_found', sequence_id: SEQUENCE_ID });
    }
    if (!sequence.data.active) {
      return jsonResponse(409, { error: 'sequence_inactive', sequence_id: SEQUENCE_ID, hint: 'Personal Outreach is not active=true; refusing to enroll.' });
    }

    const [enrolledIds, eligibleDocs] = await Promise.all([
      loadEnrolledLeadIds(db),
      loadEligibleLeads(db)
    ]);

    const { enrolled, missing } = partition(eligibleDocs, enrolledIds);
    const report = buildReport(enrolled, missing);

    if (!isEnroll) {
      return jsonResponse(200, { mode: 'preview', ...report });
    }

    const result = await enrollMissing(db, sequence, missing);
    return jsonResponse(200, { mode: 'enroll', ...report, write_result: result });
  } catch (err) {
    console.error('[audit-missing-enrollments] error:', err && err.stack);
    return jsonResponse(500, { error: 'server_error', message: err.message });
  }
};
