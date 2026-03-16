#!/usr/bin/env node
/**
 * Batch Enroll Existing Unconverted Leads — Yoga Bible
 *
 * Finds YTT leads who are NOT enrolled in any sequence and enrolls them
 * into the appropriate nurture sequence based on their program interest.
 *
 * Usage:
 *   node scripts/enroll-existing-leads.js              # Dry-run (preview)
 *   node scripts/enroll-existing-leads.js --execute     # Actually enroll
 */

const path = require('path');
const admin = require('firebase-admin');

// ── Firebase setup ──────────────────────────────────────────────────────────
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
      console.error('No Firebase credentials found.');
      process.exit(1);
    }
  }
}

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

const db = admin.firestore();

// ── Sequence matching logic ─────────────────────────────────────────────────

function getSequenceForLead(lead, priorEmailCount) {
  const program = lead.ytt_program_type || '';
  const cohort = (lead.cohort_label || '').toLowerCase();

  // If lead has received 2+ prior campaign emails, skip onboarding
  // and go straight to program-specific sequence
  const skipOnboarding = priorEmailCount >= 2;

  // April 4-week intensive
  if (program === '4-week' && (cohort.includes('apr') || cohort.includes('april') || !cohort)) {
    return 'April 4W Intensive — Conversion Push';
  }

  // July Vinyasa Plus
  if (program === '4-week-jul' || cohort.includes('jul') || cohort.includes('vinyasa')) {
    return 'July Vinyasa Plus — International Nurture';
  }

  // 8-week semi-intensive
  if (program === '8-week' || cohort.includes('8') || cohort.includes('maj') || cohort.includes('may')) {
    return '8W Semi-Intensive May–Jun — DK Nurture';
  }

  // 18-week flexible (August-December)
  if (program === '18-week-aug' || program === '18-week' || cohort.includes('aug') || cohort.includes('18')) {
    return '18W Flexible Aug–Dec — DK Nurture';
  }

  // General / undecided leads
  if (skipOnboarding) {
    // They've already received campaign content — don't send basic onboarding
    return null; // Skip enrollment
  }
  return 'YTT Onboarding — 2026';
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const execute = process.argv.includes('--execute');

  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║        Batch Enroll Existing Leads — Yoga Bible              ║');
  console.log('║' + (execute ? '                     🟢 EXECUTE MODE                        ' : '                     🔵 DRY-RUN MODE                         ') + '║');
  console.log('╚═══════════════════════════════════════════════════════════════╝');
  console.log('');

  // 1. Load all sequence definitions to get their IDs
  const seqSnap = await db.collection('sequences').where('active', '==', true).get();
  const sequenceMap = {}; // name -> { id, name, steps }
  seqSnap.forEach(doc => {
    const data = doc.data();
    sequenceMap[data.name] = { id: doc.id, name: data.name, steps: data.steps || [] };
  });

  console.log(`Found ${Object.keys(sequenceMap).length} active sequences:`);
  Object.keys(sequenceMap).forEach(name => console.log(`  • ${name}`));
  console.log('');

  // 2. Load all YTT leads that haven't converted
  const leadsSnap = await db.collection('leads')
    .where('type', '==', 'ytt')
    .get();

  const candidates = [];
  leadsSnap.forEach(doc => {
    const lead = doc.data();
    if (lead.converted === true || lead.converted === 'true') return;
    if (lead.unsubscribed === true) return;
    candidates.push({ id: doc.id, ...lead });
  });

  console.log(`Found ${candidates.length} unconverted YTT leads.`);
  console.log('');

  // 3. Check existing enrollments and agent drips
  const enrollSnap = await db.collection('sequence_enrollments')
    .where('status', 'in', ['active', 'paused'])
    .get();

  const enrolledLeadIds = new Set();
  enrollSnap.forEach(doc => {
    enrolledLeadIds.add(doc.data().lead_id);
  });

  const dripSnap = await db.collection('lead_drip_sequences').get();
  const activeDripLeadIds = new Set();
  dripSnap.forEach(doc => {
    const data = doc.data();
    if (!data.completed && !data.paused) {
      activeDripLeadIds.add(doc.id);
    }
  });

  console.log(`Active sequence enrollments: ${enrolledLeadIds.size}`);
  console.log(`Active agent drips: ${activeDripLeadIds.size}`);
  console.log('');

  // 4. Process each candidate
  const results = {
    enrolled: {},
    skippedAlreadyEnrolled: 0,
    skippedMidDrip: 0,
    skippedNoSequence: 0,
    skippedNoMatchingSequence: 0,
    errors: 0
  };

  for (const lead of candidates) {
    // Skip if already enrolled in a Netlify sequence
    if (enrolledLeadIds.has(lead.id)) {
      results.skippedAlreadyEnrolled++;
      continue;
    }

    // Skip if in active agent drip (let it finish)
    if (activeDripLeadIds.has(lead.id)) {
      results.skippedMidDrip++;
      continue;
    }

    // Check prior campaign emails (Task 7c)
    let priorEmailCount = 0;
    try {
      const emailLogSnap = await db.collection('email_log')
        .where('to', '==', lead.email)
        .where('status', '==', 'sent')
        .get();
      priorEmailCount = emailLogSnap.size;
    } catch (e) {
      // email_log query might fail if index doesn't exist — default to 0
    }

    const sequenceName = getSequenceForLead(lead, priorEmailCount);

    if (!sequenceName) {
      results.skippedNoSequence++;
      continue;
    }

    const sequence = sequenceMap[sequenceName];
    if (!sequence) {
      results.skippedNoMatchingSequence++;
      continue;
    }

    // Track result
    if (!results.enrolled[sequenceName]) results.enrolled[sequenceName] = [];
    results.enrolled[sequenceName].push({
      id: lead.id,
      email: lead.email,
      name: lead.first_name || lead.name || 'Unknown',
      program: lead.ytt_program_type || 'unknown',
      priorEmails: priorEmailCount
    });

    // Execute enrollment
    if (execute) {
      try {
        const now = new Date();
        const firstStepDelay = (sequence.steps[0] && sequence.steps[0].delay_minutes) || 0;
        const nextSendAt = new Date(now.getTime() + firstStepDelay * 60 * 1000);

        await db.collection('sequence_enrollments').add({
          sequence_id: sequence.id,
          sequence_name: sequence.name,
          lead_id: lead.id,
          lead_email: lead.email || '',
          lead_name: lead.first_name || lead.name || '',
          current_step: 1,
          status: 'active',
          exit_reason: null,
          next_send_at: nextSendAt,
          started_at: now,
          updated_at: now,
          step_history: [],
          trigger: 'batch_migration'
        });
      } catch (e) {
        console.error(`  ❌ Error enrolling ${lead.email}: ${e.message}`);
        results.errors++;
      }
    }
  }

  // 5. Print results
  console.log('─'.repeat(60));
  console.log(`${execute ? 'ENROLLED' : 'WOULD ENROLL'}:`);
  let totalEnrolled = 0;
  for (const [seqName, leads] of Object.entries(results.enrolled)) {
    console.log(`  📋 ${seqName}: ${leads.length} leads`);
    leads.forEach(l => {
      console.log(`     • ${l.name} <${l.email}> (${l.program}, ${l.priorEmails} prior emails)`);
    });
    totalEnrolled += leads.length;
  }
  console.log('');
  console.log(`Total to enroll: ${totalEnrolled}`);
  console.log(`Skipped (already enrolled): ${results.skippedAlreadyEnrolled}`);
  console.log(`Skipped (mid-drip): ${results.skippedMidDrip}`);
  console.log(`Skipped (no matching sequence): ${results.skippedNoMatchingSequence}`);
  console.log(`Skipped (2+ prior emails, no program): ${results.skippedNoSequence}`);
  if (results.errors > 0) console.log(`Errors: ${results.errors}`);
  console.log('');

  if (!execute && totalEnrolled > 0) {
    console.log('Run with --execute to enroll these leads:');
    console.log('  node scripts/enroll-existing-leads.js --execute');
    console.log('');
  }

  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
