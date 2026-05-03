#!/usr/bin/env node
/**
 * Seed Cohort Registry — Standalone Script
 *
 * Idempotently upserts the four 2026 YTT cohort docs into the
 * `cohort_registry` Firestore collection. Safe to re-run.
 *
 * Usage:
 *   node scripts/admin/seed-cohort-registry.js              # Dry run (prints diff)
 *   node scripts/admin/seed-cohort-registry.js --apply      # Write to Firestore
 *
 * Requires firebase-service-account.json in project root or lead-agent/ dir,
 * or FIREBASE_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY env vars.
 */

const path = require('path');
const admin = require('firebase-admin');

// ── Firebase setup (matches scripts/audit-and-fix-sequences.js) ─────────────
let serviceAccount;
try {
  serviceAccount = require(path.join(__dirname, '..', '..', 'firebase-service-account.json'));
} catch (_) {
  try {
    serviceAccount = require(path.join(__dirname, '..', '..', 'lead-agent', 'firebase-service-account.json'));
  } catch (__) {
    if (process.env.FIREBASE_PROJECT_ID) {
      serviceAccount = {
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n')
      };
    } else {
      console.error('No Firebase credentials. Place firebase-service-account.json in project root or lead-agent/ dir, or set FIREBASE_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY.');
      process.exit(1);
    }
  }
}

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

const COL = 'cohort_registry';
const APPLY = process.argv.includes('--apply');

// ── Cohort definitions ──────────────────────────────────────────────────────
// enrollment_closes defaults to start_date - 3 days.
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

async function main() {
  console.log((APPLY ? '[APPLY]' : '[DRY RUN]') + ' Seeding ' + COHORTS.length + ' cohorts to ' + COL);
  console.log('---');

  for (const cohort of COHORTS) {
    const ref = db.collection(COL).doc(cohort.id);
    const existing = await ref.get();
    const action = existing.exists ? 'UPDATE' : 'CREATE';

    const payload = Object.assign({}, cohort, {
      updated_at: admin.firestore.FieldValue.serverTimestamp()
    });
    if (!existing.exists) {
      payload.created_at = admin.firestore.FieldValue.serverTimestamp();
    }

    console.log('[' + action + '] ' + cohort.id + '  (' + cohort.name_en + ' · starts ' + cohort.start_date + ')');

    if (APPLY) {
      await ref.set(payload, { merge: true });
    }
  }

  console.log('---');
  console.log(APPLY ? 'Done.' : 'Dry run complete. Re-run with --apply to write.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
