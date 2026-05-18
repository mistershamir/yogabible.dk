#!/usr/bin/env node
/**
 * Delete a single lead and all related sequence_enrollments + deferred_welcomes docs.
 *
 * Usage:
 *   node scripts/delete-lead.js              # preview — no writes
 *   node scripts/delete-lead.js --apply      # actually delete
 *
 * Requires firebase-service-account.json in project root or lead-agent/,
 * OR FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY env vars.
 */

const path = require('path');
const admin = require('firebase-admin');

const EMAIL = 'info@vibroyoga.dk';
const LEAD_DOC_ID = EMAIL.toLowerCase().trim().replace(/[\/\.#\[\]]/g, '_');
const APPLY = process.argv.includes('--apply');

// ── Firebase init ─────────────────────────────────────────────────────────────

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
      console.error('No Firebase credentials found. Place firebase-service-account.json in project root, or set FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY env vars.');
      process.exit(1);
    }
  }
}

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${APPLY ? '🗑  APPLY MODE' : '👁  PREVIEW MODE (pass --apply to delete)'}`);
  console.log(`\nTarget email : ${EMAIL}`);
  console.log(`Lead doc ID  : leads/${LEAD_DOC_ID}\n`);

  // 1. Lead doc
  const leadRef = db.collection('leads').doc(LEAD_DOC_ID);
  const leadSnap = await leadRef.get();

  if (!leadSnap.exists) {
    console.log('❌  Lead doc not found — nothing to delete.');
    process.exit(0);
  }

  const lead = leadSnap.data();
  console.log('── Lead ─────────────────────────────────────────────────────');
  console.log(`   leads/${LEAD_DOC_ID}`);
  console.log(`   Name   : ${lead.first_name || ''} ${lead.last_name || ''}`.trim());
  console.log(`   Email  : ${lead.email}`);
  console.log(`   Type   : ${lead.type || ''}  |  Program: ${lead.ytt_program_type || lead.program || ''}`);
  console.log(`   Status : ${lead.status || ''}  |  Created: ${lead.created_at ? lead.created_at.toDate().toISOString().slice(0, 10) : 'unknown'}`);

  // 2. sequence_enrollments
  const enrollSnap = await db.collection('sequence_enrollments')
    .where('lead_id', '==', LEAD_DOC_ID)
    .get();

  console.log(`\n── sequence_enrollments (${enrollSnap.size} doc${enrollSnap.size !== 1 ? 's' : ''}) ───────────────────────`);
  if (enrollSnap.empty) {
    console.log('   (none)');
  } else {
    enrollSnap.docs.forEach(doc => {
      const d = doc.data();
      console.log(`   ${doc.id}  |  seq: ${d.sequence_id || ''}  |  status: ${d.status || ''}`);
    });
  }

  // 3. deferred_welcomes
  const deferSnap = await db.collection('deferred_welcomes')
    .where('lead_id', '==', LEAD_DOC_ID)
    .get();

  console.log(`\n── deferred_welcomes (${deferSnap.size} doc${deferSnap.size !== 1 ? 's' : ''}) ─────────────────────────────`);
  if (deferSnap.empty) {
    console.log('   (none)');
  } else {
    deferSnap.docs.forEach(doc => {
      const d = doc.data();
      console.log(`   ${doc.id}  |  action: ${d.action || ''}  |  send_at: ${d.send_at ? d.send_at.toDate().toISOString() : 'unknown'}`);
    });
  }

  const totalDocs = 1 + enrollSnap.size + deferSnap.size;
  console.log(`\nTotal docs to delete: ${totalDocs}`);

  if (!APPLY) {
    console.log('\n⚠️   Dry run — no changes made. Run with --apply to delete.\n');
    process.exit(0);
  }

  // ── Delete ──────────────────────────────────────────────────────────────────
  console.log('\nDeleting…');

  const batch = db.batch();
  batch.delete(leadRef);
  enrollSnap.docs.forEach(doc => batch.delete(doc.ref));
  deferSnap.docs.forEach(doc => batch.delete(doc.ref));
  await batch.commit();

  console.log(`✅  Deleted ${totalDocs} doc${totalDocs !== 1 ? 's' : ''} in one batch.`);
  console.log(`   - leads/${LEAD_DOC_ID}`);
  enrollSnap.docs.forEach(doc => console.log(`   - sequence_enrollments/${doc.id}`));
  deferSnap.docs.forEach(doc => console.log(`   - deferred_welcomes/${doc.id}`));
  console.log('');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
