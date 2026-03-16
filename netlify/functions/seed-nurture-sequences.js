/**
 * Seed Nurture Sequences — Netlify Function
 *
 * POST /.netlify/functions/seed-nurture-sequences
 * Auth: X-Internal-Secret header
 *
 * Creates the 5 YTT nurture sequence definitions in Firestore.
 * Safe to re-run: skips sequences that already exist (matched by name).
 */

const { getDb, serverTimestamp } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');

const SEQUENCES_COL = 'sequences';

// ── Sequence Definitions ────────────────────────────────────────────────────

const SEQUENCES = [
  {
    name: 'YTT Onboarding — 2026',
    description: 'Automated onboarding for new YTT leads. 14-day compressed nurture journey. Step 1 (welcome) is sent by lead.js/facebook-leads-webhook.js — this sequence starts at day 3.',
    active: true,
    trigger: { type: 'new_lead', conditions: { lead_type: 'ytt' } },
    exit_conditions: ['converted', 'unsubscribed', 'lost', 'enrolled'],
    steps: [
      {
        channel: 'email',
        delay_minutes: 4320,
        email_subject: 'Hvorfor blive yogalærer? 🧘',
        email_body: '',
        sms_message: '',
        condition: null
      },
      {
        channel: 'sms',
        delay_minutes: 2880,
        email_subject: '',
        email_body: '',
        sms_message: 'Hi {{first_name}}, fik du set vores email om yogalæreruddannelsen? Du er velkommen til at svare her eller ringe til os med spørgsmål. /Shamir, Yoga Bible',
        condition: null
      },
      {
        channel: 'email',
        delay_minutes: 2880,
        email_subject: 'Sådan ser en dag ud på uddannelsen',
        email_body: '',
        sms_message: '',
        condition: null
      },
      {
        channel: 'email',
        delay_minutes: 4320,
        email_subject: 'Hvilken uddannelse passer til dit liv?',
        email_body: '',
        sms_message: '',
        condition: null
      },
      {
        channel: 'sms',
        delay_minutes: 2880,
        email_subject: '',
        email_body: '',
        sms_message: 'Hi {{first_name}}, har du fundet det format der passer dig? Husk vores Forberedelsesfase (3.750 kr) — beløbet trækkes fra den fulde pris. /Shamir',
        condition: null
      }
    ]
  },
  {
    name: 'April 4W Intensive — Conversion Push',
    description: 'Urgency sequence for April 4-week intensive. Auto-enrolled for 4-week leads.',
    active: true,
    trigger: { type: 'new_lead', conditions: { ytt_program_type: '4-week' } },
    exit_conditions: ['converted', 'unsubscribed', 'lost', 'enrolled'],
    steps: [
      {
        channel: 'both',
        delay_minutes: 0,
        email_subject: '{{first_name}}, kun 3 pladser tilbage i april',
        email_body: '',
        sms_message: 'Hi {{first_name}}, der er kun 3 pladser tilbage på vores april-intensiv. Vil du sikre dig en plads? Svar her eller ring 53 88 12 09. /Shamir',
        condition: null
      },
      {
        channel: 'email',
        delay_minutes: 10080,
        email_subject: 'Sidste chance: April starter om 2 uger',
        email_body: '',
        sms_message: '',
        condition: null
      }
    ]
  },
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
        email_body: '',
        sms_message: '',
        condition: null
      },
      {
        channel: 'email',
        delay_minutes: 7200,
        email_subject: 'Vinyasa Plus: What makes July different',
        email_body: '',
        sms_message: '',
        condition: null
      },
      {
        channel: 'email',
        delay_minutes: 7200,
        email_subject: 'Accommodation sorted — here\'s how it works',
        email_body: '',
        sms_message: '',
        condition: null
      },
      {
        channel: 'both',
        delay_minutes: 10080,
        email_subject: '{{first_name}}, spots are filling for July',
        email_body: '',
        sms_message: 'Hi {{first_name}}, just a heads up — July spots are filling up. The Preparation Phase (3,750 DKK) secures your place — amount is deducted from the full price. Any questions? /Shamir, Yoga Bible',
        condition: null
      }
    ]
  },
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
        email_body: '',
        sms_message: '',
        condition: null
      },
      {
        channel: 'sms',
        delay_minutes: 5760,
        email_subject: '',
        email_body: '',
        sms_message: 'Hi {{first_name}}, vores 8-ugers semi-intensiv starter i maj og kan passes ved siden af dit job. Fuld RYT-200 certificering. Spørgsmål? /Shamir',
        condition: null
      },
      {
        channel: 'email',
        delay_minutes: 7200,
        email_subject: 'Forberedelsesfasen: Start nu, betal kun 3.750 kr',
        email_body: '',
        sms_message: '',
        condition: null
      }
    ]
  },
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
        email_body: '',
        sms_message: '',
        condition: null
      },
      {
        channel: 'email',
        delay_minutes: 10080,
        email_subject: '18 uger ved siden af dit liv: Sådan fungerer det',
        email_body: '',
        sms_message: '',
        condition: null
      },
      {
        channel: 'both',
        delay_minutes: 10080,
        email_subject: '{{first_name}}, start din forberedelse nu',
        email_body: '',
        sms_message: 'Hi {{first_name}}, vidste du at du kan starte din forberedelse til august-holdet allerede nu? 30 yogaklasser for 3.750 kr (trækkes fra den fulde pris). /Shamir',
        condition: null
      }
    ]
  }
];

// ── Handler ──────────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { ok: false, error: 'POST only' });
  }

  // Auth: internal secret
  const secret = (event.headers['x-internal-secret'] || event.headers['X-Internal-Secret'] || '').trim();
  const expected = (process.env.AI_INTERNAL_SECRET || '').trim();

  if (!expected || secret !== expected) {
    return jsonResponse(401, { ok: false, error: 'Unauthorized' });
  }

  const db = getDb();

  try {
    // Check for existing sequences
    const existingSnap = await db.collection(SEQUENCES_COL).get();
    const existingNames = new Set();
    existingSnap.forEach(doc => {
      const data = doc.data();
      if (data.name) existingNames.add(data.name);
    });

    var created = [];
    var skipped = [];

    for (var i = 0; i < SEQUENCES.length; i++) {
      var seq = SEQUENCES[i];

      if (existingNames.has(seq.name)) {
        skipped.push(seq.name);
        continue;
      }

      var now = new Date().toISOString();
      var ref = await db.collection(SEQUENCES_COL).add({
        ...seq,
        created_at: now,
        updated_at: now
      });

      created.push({ name: seq.name, id: ref.id, steps: seq.steps.length });
    }

    return jsonResponse(200, {
      ok: true,
      created: created,
      skipped: skipped,
      summary: created.length + ' created, ' + skipped.length + ' skipped'
    });
  } catch (error) {
    console.error('[seed-nurture-sequences] Error:', error);
    return jsonResponse(500, { ok: false, error: error.message });
  }
};
