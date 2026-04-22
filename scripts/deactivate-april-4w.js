#!/usr/bin/env node
/**
 * Deactivate April 4W Intensive Sequence — one-shot
 *
 * - Sets active: false + deactivatedAt + deactivatedReason on sequences/ZwvSVLsqRZcIv8C0IG0y
 * - Exits any active enrollments (sequence_enrollments where sequence_id == that ID, status == 'active')
 *
 * Usage:
 *   node scripts/deactivate-april-4w.js          # dry run — reports counts, no writes
 *   node scripts/deactivate-april-4w.js --apply  # writes changes
 *
 * Requires firebase-service-account.json in project root or lead-agent/, or FIREBASE_* env vars.
 */

const path = require('path');
const admin = require('firebase-admin');

const SEQUENCE_ID = 'ZwvSVLsqRZcIv8C0IG0y';
const REASON = 'April 2026 cohort sold out';
const APPLY = process.argv.includes('--apply');

let serviceAccount;
try {
  serviceAccount = require(path.join(__dirname, '..', 'firebase-service-account.json'));
} catch (_) {
  try {
    serviceAccount = require(path.join(__dirname, '..', 'lead-agent', 'firebase-service-account.json'));
  } catch (__) {
    if (process.env.FIREBASE_PROJECT_ID) {
      serviceAccount = {
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n')
      };
    } else {
      console.error('No Firebase credentials found. Place firebase-service-account.json in project root or lead-agent/, or set FIREBASE_* env vars.');
      process.exit(1);
    }
  }
}

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

(async () => {
  console.log(APPLY ? '— APPLY mode (writing changes) —' : '— DRY RUN (no writes) —');
  console.log('Sequence:', SEQUENCE_ID);

  const seqRef = db.collection('sequences').doc(SEQUENCE_ID);
  const seqSnap = await seqRef.get();
  if (!seqSnap.exists) {
    console.error('Sequence not found:', SEQUENCE_ID);
    process.exit(1);
  }
  const seq = seqSnap.data();
  console.log('Name:', seq.name, '| currently active:', seq.active);

  const enrollSnap = await db.collection('sequence_enrollments')
    .where('sequence_id', '==', SEQUENCE_ID)
    .where('status', '==', 'active')
    .get();

  console.log('Active enrollments:', enrollSnap.size);
  enrollSnap.docs.forEach((d) => {
    const e = d.data();
    console.log('  -', d.id, '| lead:', e.lead_email || e.lead_id, '| step:', e.current_step);
  });

  if (!APPLY) {
    console.log('\nDry run complete. Re-run with --apply to write changes.');
    process.exit(0);
  }

  await seqRef.update({
    active: false,
    deactivatedAt: admin.firestore.FieldValue.serverTimestamp(),
    deactivatedReason: REASON,
    updated_at: admin.firestore.FieldValue.serverTimestamp()
  });
  console.log('Sequence deactivated.');

  const nowIso = new Date().toISOString();
  let exited = 0;
  for (const doc of enrollSnap.docs) {
    await doc.ref.update({
      status: 'exited',
      exit_reason: 'Sequence deactivated — ' + REASON,
      updated_at: nowIso
    });
    exited++;
  }
  console.log('Enrollments exited:', exited);
  process.exit(0);
})().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
