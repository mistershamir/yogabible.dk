#!/usr/bin/env node
/**
 * Seed Nurture Sequences — Yoga Bible
 *
 * Creates the 5 YTT nurture sequence definitions in Firestore.
 * Safe to re-run: skips sequences that already exist (matched by name).
 *
 * Usage:
 *   node scripts/seed-nurture-sequences.js              # Dry-run (preview)
 *   node scripts/seed-nurture-sequences.js --execute     # Create in Firestore
 */

const path = require('path');

// ── Firebase setup ──────────────────────────────────────────────────────────
const admin = require('firebase-admin');

// Try multiple credential paths
let serviceAccount;
try {
  serviceAccount = require(path.join(__dirname, '..', 'firebase-service-account.json'));
} catch (_) {
  try {
    serviceAccount = require(path.join(__dirname, '..', 'lead-agent', 'firebase-service-account.json'));
  } catch (__) {
    // Fallback to env vars (Netlify-style)
    if (process.env.FIREBASE_PROJECT_ID) {
      serviceAccount = {
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n')
      };
    } else {
      console.error('No Firebase credentials found. Place firebase-service-account.json in project root or lead-agent/ dir.');
      process.exit(1);
    }
  }
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();
const SEQUENCES_COL = 'sequences';

// ── Sequence Definitions ────────────────────────────────────────────────────

const SEQUENCES = [
  // ── 1. YTT Onboarding (auto-enrolled on new YTT lead) ──────────────────
  {
    name: 'YTT Onboarding — 2026',
    description: 'Automated onboarding for new YTT leads. 14-day compressed nurture journey. Step 1 (welcome) is sent by lead.js/facebook-leads-webhook.js — this sequence starts at day 3.',
    active: true,
    trigger: { type: 'new_lead', conditions: { lead_type: 'ytt' } },
    exit_conditions: ['converted', 'unsubscribed', 'lost', 'enrolled'],
    steps: [
      {
        channel: 'email',
        delay_minutes: 4320, // 3 days
        email_subject: 'Hvorfor blive yogalærer? 🧘',
        email_body: '', // Placeholder — "Why become a yoga teacher" angle
        sms_message: '',
        condition: null
      },
      {
        channel: 'sms',
        delay_minutes: 2880, // +2 days (day 5)
        email_subject: '',
        email_body: '',
        sms_message: 'Hi {{first_name}}, fik du set vores email om yogalæreruddannelsen? Du er velkommen til at svare her eller ringe til os med spørgsmål. /Shamir, Yoga Bible',
        condition: null
      },
      {
        channel: 'email',
        delay_minutes: 2880, // +2 days (day 7)
        email_subject: 'Sådan ser en dag ud på uddannelsen',
        email_body: '', // Placeholder — "What actually happens in a training" demystification
        sms_message: '',
        condition: null
      },
      {
        channel: 'email',
        delay_minutes: 4320, // +3 days (day 10)
        email_subject: 'Hvilken uddannelse passer til dit liv?',
        email_body: '', // Placeholder — Format self-selection + Prep Phase intro
        sms_message: '',
        condition: null
      },
      {
        channel: 'sms',
        delay_minutes: 2880, // +2 days (day 12)
        email_subject: '',
        email_body: '',
        sms_message: 'Hi {{first_name}}, har du fundet det format der passer dig? Husk vores Forberedelsesfase (3.750 kr) — beløbet trækkes fra den fulde pris. /Shamir',
        condition: null
      }
    ]
  },

  // ── 2. April 4W Intensive — Conversion Push ─────────────────────────────
  {
    name: 'April 4W Intensive — Conversion Push',
    description: 'Urgency sequence for April 4-week intensive. Auto-enrolled for 4-week leads.',
    active: true,
    trigger: { type: 'new_lead', conditions: { ytt_program_type: '4-week' } },
    exit_conditions: ['converted', 'unsubscribed', 'lost', 'enrolled'],
    steps: [
      {
        channel: 'both',
        delay_minutes: 0, // Send immediately
        email_subject: '{{first_name}}, kun 3 pladser tilbage i april',
        email_body: '', // Placeholder — "3 spots left" urgency
        sms_message: 'Hi {{first_name}}, der er kun 3 pladser tilbage på vores april-intensiv. Vil du sikre dig en plads? Svar her eller ring 53 88 12 09. /Shamir',
        condition: null
      },
      {
        channel: 'email',
        delay_minutes: 10080, // +7 days
        email_subject: 'Sidste chance: April starter om 2 uger',
        email_body: '', // Placeholder — Final push, Prep Phase CTA
        sms_message: '',
        condition: null
      }
    ]
  },

  // ── 3. July Vinyasa Plus — International Nurture ────────────────────────
  {
    name: 'July Vinyasa Plus — International Nurture',
    description: 'Summer lifestyle + logistics nurture for July Vinyasa Plus international leads.',
    active: true,
    trigger: { type: 'new_lead', conditions: { ytt_program_type: '4-week-jul' } },
    exit_conditions: ['converted', 'unsubscribed', 'lost', 'enrolled'],
    steps: [
      {
        channel: 'email',
        delay_minutes: 0,
        email_subject: 'Your summer in Copenhagen starts here ☀️',
        email_body: '', // Placeholder — Copenhagen summer fantasy
        sms_message: '',
        condition: null
      },
      {
        channel: 'email',
        delay_minutes: 7200, // +5 days
        email_subject: 'Vinyasa Plus: What makes July different',
        email_body: '', // Placeholder — 70% Vinyasa / 30% Yin+Hot Yoga
        sms_message: '',
        condition: null
      },
      {
        channel: 'email',
        delay_minutes: 7200, // +5 days
        email_subject: 'Accommodation sorted — here\'s how it works',
        email_body: '', // Placeholder — Practical logistics
        sms_message: '',
        condition: null
      },
      {
        channel: 'both',
        delay_minutes: 10080, // +7 days
        email_subject: '{{first_name}}, spots are filling for July',
        email_body: '', // Placeholder — Urgency + Prep Phase CTA
        sms_message: 'Hi {{first_name}}, just a heads up — July spots are filling up. The Preparation Phase (3,750 DKK) secures your place — amount is deducted from the full price. Any questions? /Shamir, Yoga Bible',
        condition: null
      }
    ]
  },

  // ── 4. 8W Semi-Intensive — DK Nurture ──────────────────────────────────
  {
    name: '8W Semi-Intensive May–Jun — DK Nurture',
    description: 'Denmark-focused nurture for 8-week semi-intensive. Auto-enrolled for 8-week leads.',
    active: true,
    trigger: { type: 'new_lead', conditions: { ytt_program_type: '8-week' } },
    exit_conditions: ['converted', 'unsubscribed', 'lost', 'enrolled'],
    steps: [
      {
        channel: 'email',
        delay_minutes: 0,
        email_subject: '{{first_name}}, kan du ikke tage 4 uger fri? Det behøver du heller ikke',
        email_body: '', // Placeholder — Same cert, half the time
        sms_message: '',
        condition: null
      },
      {
        channel: 'sms',
        delay_minutes: 5760, // +4 days
        email_subject: '',
        email_body: '',
        sms_message: 'Hi {{first_name}}, vores 8-ugers semi-intensiv starter i maj og kan passes ved siden af dit job. Fuld RYT-200 certificering. Spørgsmål? /Shamir',
        condition: null
      },
      {
        channel: 'email',
        delay_minutes: 7200, // +5 days
        email_subject: 'Forberedelsesfasen: Start nu, betal kun 3.750 kr',
        email_body: '', // Placeholder — Prep Phase zero-risk CTA
        sms_message: '',
        condition: null
      }
    ]
  },

  // ── 5. 18W Flexible Aug–Dec — DK Nurture ───────────────────────────────
  {
    name: '18W Flexible Aug–Dec — DK Nurture',
    description: 'Denmark-focused nurture for 18-week flexible. Auto-enrolled for 18-week-aug leads.',
    active: true,
    trigger: { type: 'new_lead', conditions: { ytt_program_type: '18-week-aug' } },
    exit_conditions: ['converted', 'unsubscribed', 'lost', 'enrolled'],
    steps: [
      {
        channel: 'email',
        delay_minutes: 0,
        email_subject: 'Marts-holdet er UDSOLGT — august har stadig plads',
        email_body: '', // Placeholder — Social proof from sold-out March cohort
        sms_message: '',
        condition: null
      },
      {
        channel: 'email',
        delay_minutes: 10080, // +7 days
        email_subject: '18 uger ved siden af dit liv: Sådan fungerer det',
        email_body: '', // Placeholder — Weekday/weekend tracks
        sms_message: '',
        condition: null
      },
      {
        channel: 'both',
        delay_minutes: 10080, // +7 days
        email_subject: '{{first_name}}, start din forberedelse nu',
        email_body: '', // Placeholder — Prep Phase CTA
        sms_message: 'Hi {{first_name}}, vidste du at du kan starte din forberedelse til august-holdet allerede nu? 30 yogaklasser for 3.750 kr (trækkes fra den fulde pris). /Shamir',
        condition: null
      }
    ]
  }
];

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const execute = process.argv.includes('--execute');

  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║            Seed Nurture Sequences — Yoga Bible               ║');
  console.log('║' + (execute ? '                     🟢 EXECUTE MODE                        ' : '                     🔵 DRY-RUN MODE                         ') + '║');
  console.log('╚═══════════════════════════════════════════════════════════════╝');
  console.log('');

  // Check for existing sequences
  const existingSnap = await db.collection(SEQUENCES_COL).get();
  const existingNames = new Set();
  existingSnap.forEach(doc => {
    const data = doc.data();
    if (data.name) existingNames.add(data.name);
  });

  console.log(`Found ${existingNames.size} existing sequence(s) in Firestore.`);
  console.log('');

  let created = 0;
  let skipped = 0;

  for (const seq of SEQUENCES) {
    if (existingNames.has(seq.name)) {
      console.log(`  ⏭  SKIP: "${seq.name}" — already exists`);
      skipped++;
      continue;
    }

    const stepSummary = seq.steps.map((s, i) =>
      `    Step ${i + 1}: ${s.channel} @ +${s.delay_minutes}min` +
      (s.email_subject ? ` — "${s.email_subject}"` : '') +
      (s.sms_message ? ` — SMS: "${s.sms_message.substring(0, 50)}..."` : '')
    ).join('\n');

    console.log(`  📋 ${execute ? 'CREATE' : 'WOULD CREATE'}: "${seq.name}"`);
    console.log(`     Trigger: ${seq.trigger.type}${seq.trigger.conditions?.lead_type ? ` (${seq.trigger.conditions.lead_type})` : ''}`);
    console.log(`     Steps: ${seq.steps.length}`);
    console.log(`     Exit: ${seq.exit_conditions.join(', ')}`);
    console.log(stepSummary);
    console.log('');

    if (execute) {
      const now = new Date().toISOString();
      await db.collection(SEQUENCES_COL).add({
        ...seq,
        created_at: now,
        updated_at: now
      });
      console.log(`     ✅ Created in Firestore`);
      console.log('');
    }

    created++;
  }

  console.log('─'.repeat(60));
  console.log(`${execute ? 'Created' : 'Would create'}: ${created} | Skipped: ${skipped}`);
  console.log('');

  if (!execute && created > 0) {
    console.log('Run with --execute to create these sequences:');
    console.log('  node scripts/seed-nurture-sequences.js --execute');
    console.log('');
  }

  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
