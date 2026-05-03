/**
 * Seed Cohort Registry — Netlify Function
 *
 * GET  /.netlify/functions/seed-cohort-registry?mode=preview
 *      → returns the 4 cohort docs that would be written, plus per-doc
 *        action (CREATE | UPDATE) based on what's already in Firestore.
 * POST /.netlify/functions/seed-cohort-registry?mode=apply
 *      → upserts (merge) all 4 cohorts in cohort_registry. Idempotent.
 *
 * Auth: X-Internal-Secret header must equal AI_INTERNAL_SECRET.
 *
 * Example:
 *   curl -H "x-internal-secret: $AI_INTERNAL_SECRET" \
 *     "https://yogabible.dk/.netlify/functions/seed-cohort-registry?mode=preview"
 *   curl -X POST -H "x-internal-secret: $AI_INTERNAL_SECRET" \
 *     "https://yogabible.dk/.netlify/functions/seed-cohort-registry?mode=apply"
 */

const admin = require('firebase-admin');
const { getDb } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');

const COL = 'cohort_registry';

// ── Cohort definitions ──────────────────────────────────────────────────────
// enrollment_closes defaults to start_date - 3 days. Pricing is identical
// across all four cohorts (23.750 kr full / 3.750 kr Preparation Phase).
const COHORTS = [
  {
    id: '4-week-jun-2026',
    program_type: '4-week-jun',
    also_matches: ['4-week'],
    name_da: '4-ugers Complete Program',
    name_en: '4-Week Complete Program',
    cohort_label_da: 'Juni 2026',
    cohort_label_en: 'June 2026',
    method_da: 'Triangle Method — Hatha, Vinyasa, Yin, Hot Yoga og Meditation',
    method_en: 'Triangle Method — Hatha, Vinyasa, Yin, Hot Yoga, and Meditation',
    start_date: '2026-06-01',
    end_date: '2026-06-28',
    enrollment_closes: '2026-05-29',
    schedule_path_da: '/skema/4-uger-juni/',
    schedule_path_en: '/en/schedule/4-weeks-june/',
    checkout_url: 'https://yogabible.dk/200-hours-4-weeks-intensive-programs/?product=100213',
    prep_phase_price_da: '3.750 kr.',
    prep_phase_price_en: '3,750 DKK',
    full_price_da: '23.750 kr.',
    full_price_en: '23,750 DKK',
    start_date_formatted_da: '1. juni',
    start_date_formatted_en: 'June 1',
    active: true,
    sort_order: 1
  },
  {
    id: '4-week-jul-2026',
    program_type: '4-week-jul',
    also_matches: ['4-week'],
    name_da: '4-ugers Vinyasa Plus',
    name_en: '4-Week Vinyasa Plus',
    cohort_label_da: 'Juli 2026',
    cohort_label_en: 'July 2026',
    method_da: 'Vinyasa Plus — 70% Vinyasa Flow + 30% Yin & Hot Yoga',
    method_en: 'Vinyasa Plus — 70% Vinyasa Flow + 30% Yin & Hot Yoga',
    start_date: '2026-07-06',
    end_date: '2026-07-31',
    enrollment_closes: '2026-07-03',
    schedule_path_da: '/skema/4-uger-juli/',
    schedule_path_en: '/en/schedule/4-weeks-july-plan/',
    checkout_url: 'https://yogabible.dk/200-hours-4-weeks-intensive-programs/?product=100211',
    prep_phase_price_da: '3.750 kr.',
    prep_phase_price_en: '3,750 DKK',
    full_price_da: '23.750 kr.',
    full_price_en: '23,750 DKK',
    start_date_formatted_da: '6. juli',
    start_date_formatted_en: 'July 6',
    active: true,
    sort_order: 2
  },
  {
    id: '8-week-may-2026',
    program_type: '8-week',
    also_matches: [],
    name_da: '8-ugers Semi-Intensive Program',
    name_en: '8-Week Semi-Intensive Program',
    cohort_label_da: 'Maj–Juni 2026',
    cohort_label_en: 'May–June 2026',
    method_da: 'Triangle Method — Hatha, Vinyasa, Yin, Hot Yoga og Meditation',
    method_en: 'Triangle Method — Hatha, Vinyasa, Yin, Hot Yoga, and Meditation',
    start_date: '2026-05-02',
    end_date: '2026-06-28',
    enrollment_closes: '2026-04-29',
    schedule_path_da: '/skema/8-uger/',
    schedule_path_en: '/en/schedule/8-weeks/',
    checkout_url: 'https://yogabible.dk/200-hours-8-weeks-semi-intensive-programs/?product=100209',
    prep_phase_price_da: '3.750 kr.',
    prep_phase_price_en: '3,750 DKK',
    full_price_da: '23.750 kr.',
    full_price_en: '23,750 DKK',
    start_date_formatted_da: '2. maj',
    start_date_formatted_en: 'May 2',
    active: true,
    sort_order: 3
  },
  {
    id: '18-week-aug-2026',
    program_type: '18-week-aug',
    also_matches: ['18-week'],
    name_da: '18-ugers Fleksible Program',
    name_en: '18-Week Flexible Program',
    cohort_label_da: 'August–December 2026',
    cohort_label_en: 'August–December 2026',
    method_da: 'Triangle Method — Hatha, Vinyasa, Yin, Hot Yoga og Meditation',
    method_en: 'Triangle Method — Hatha, Vinyasa, Yin, Hot Yoga, and Meditation',
    start_date: '2026-08-10',
    end_date: '2026-12-13',
    enrollment_closes: '2026-08-07',
    schedule_path_da: '/skema/18-uger-august/',
    schedule_path_en: '/en/schedule/18-weeks-august/',
    checkout_url: 'https://yogabible.dk/200-hours-18-weeks-flexible-programs/?product=100210',
    prep_phase_price_da: '3.750 kr.',
    prep_phase_price_en: '3,750 DKK',
    full_price_da: '23.750 kr.',
    full_price_en: '23,750 DKK',
    start_date_formatted_da: '10. august',
    start_date_formatted_en: 'August 10',
    active: true,
    sort_order: 4
  }
];

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
  const results = [];

  for (const cohort of COHORTS) {
    const ref = db.collection(COL).doc(cohort.id);
    const existing = await ref.get();
    const action = existing.exists ? 'UPDATE' : 'CREATE';

    const entry = {
      id: cohort.id,
      action,
      summary: cohort.name_en + ' · starts ' + cohort.start_date + ' · enrollment_closes ' + cohort.enrollment_closes,
      doc: cohort
    };

    if (isApply) {
      const payload = Object.assign({}, cohort, {
        updated_at: admin.firestore.FieldValue.serverTimestamp()
      });
      if (!existing.exists) {
        payload.created_at = admin.firestore.FieldValue.serverTimestamp();
      }
      await ref.set(payload, { merge: true });
      entry.written = true;
    }

    results.push(entry);
  }

  return jsonResponse(200, {
    ok: true,
    mode: isApply ? 'apply' : 'preview',
    collection: COL,
    count: results.length,
    cohorts: results
  });
};
