/**
 * Seed July International Conversion Sequence — One-time setup
 *
 * POST /.netlify/functions/seed-july-international-sequence
 * Auth: X-Internal-Secret header
 *
 * Creates the "July Vinyasa Plus — International Conversion 2026" sequence
 * in Firestore with 8 placeholder steps. Run once, then populate real content
 * via populate-july-international-content.js.
 *
 * This sequence is for INTERNATIONAL leads (country ≠ DK) interested in the
 * July 4-week Vinyasa Plus cohort. Danish leads follow the standard flow
 * (Broadcast + Onboarding + existing July sequence).
 *
 * Query param: ?dry_run=true — preview the document without creating it
 */

const { getDb, serverTimestamp } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');

var SEQUENCE_NAME = 'July Vinyasa Plus — International Conversion 2026';

var STEP_SUBJECTS = [
  { en: '12 people from 6 countries — and one open spot could be yours',       de: '12 Teilnehmer aus 6 Ländern — und ein Platz könnte deiner sein' },
  { en: 'You don\'t need to be "good enough" for this',                        de: 'Du musst nicht "gut genug" dafür sein' },
  { en: '70% flow, 30% fire — the Vinyasa Plus method',                        de: '70 % Flow, 30 % Feuer — die Vinyasa Plus Methode' },
  { en: 'This isn\'t a yoga retreat — it\'s a professional certification',      de: 'Das hier ist kein Yoga-Retreat — es ist eine professionelle Zertifizierung' },
  { en: 'Flights, accommodation, Copenhagen — let\'s sort it out',             de: 'Flüge, Unterkunft, Kopenhagen — lass uns das klären' },
  { en: 'The smartest first step costs 3,750 DKK',                             de: 'Der klügste erste Schritt kostet 3.750 DKK' },
  { en: '{{first_name}}, what\'s the real hesitation?',                         de: '{{first_name}}, was hält dich wirklich zurück?' },
  { en: 'July 6 is closer than you think',                                     de: 'Der 6. Juli ist näher als du denkst' }
];

var STEP_DELAYS = [2880, 4320, 5760, 4320, 5760, 4320, 5760, 4320];

function buildSteps() {
  return STEP_SUBJECTS.map(function (subj, i) {
    return {
      step_number: i + 1,
      delay_minutes: STEP_DELAYS[i],
      channel: 'email',
      email_subject: null,
      email_body: null,
      email_subject_en: subj.en,
      email_body_en: '<p>[PLACEHOLDER — EN body for step ' + (i + 1) + ']</p>\n\n{{country_block}}',
      email_subject_de: subj.de,
      email_body_de: '<p>[PLACEHOLDER — DE body for step ' + (i + 1) + ']</p>',
      country_blocks: {
        NO: '[PLACEHOLDER — Norway block for step ' + (i + 1) + ']',
        SE: '[PLACEHOLDER — Sweden block for step ' + (i + 1) + ']',
        DE: '[PLACEHOLDER — Germany block for step ' + (i + 1) + ']',
        FI: '[PLACEHOLDER — Finland block for step ' + (i + 1) + ']',
        NL: '[PLACEHOLDER — Netherlands block for step ' + (i + 1) + ']',
        UK: '[PLACEHOLDER — UK block for step ' + (i + 1) + ']'
      }
    };
  });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'POST only' });

  var secret = process.env.AI_INTERNAL_SECRET;
  var provided = (event.headers['x-internal-secret'] || event.headers['X-Internal-Secret'] || '').trim();
  if (!secret || provided !== secret) {
    return jsonResponse(401, { error: 'Unauthorized' });
  }

  var dryRun = (event.queryStringParameters || {}).dry_run === 'true';
  var db = getDb();

  // Check if sequence already exists
  var existingSnap = await db.collection('sequences')
    .where('name', '==', SEQUENCE_NAME)
    .limit(1)
    .get();

  if (!existingSnap.empty) {
    var existingId = existingSnap.docs[0].id;
    return jsonResponse(409, {
      ok: false,
      error: 'Sequence already exists',
      id: existingId,
      name: SEQUENCE_NAME
    });
  }

  var steps = buildSteps();

  var sequenceDoc = {
    name: SEQUENCE_NAME,
    description: '8-email international conversion sequence for July Vinyasa Plus cohort. EN + DE with country-specific blocks (NO, SE, DE, FI, NL, UK). No Danish — international leads only. Replaces broadcast + onboarding + existing July for non-DK leads.',
    active: true,
    trigger: { type: 'manual', conditions: {} },
    exit_conditions: ['Converted', 'Existing Applicant', 'Unsubscribed', 'Lost', 'Closed', 'Archived'],
    enrollment_closes: '2026-07-04',
    steps: steps,
    created_at: serverTimestamp(),
    updated_at: serverTimestamp()
  };

  if (dryRun) {
    return jsonResponse(200, {
      ok: true,
      dry_run: true,
      document: sequenceDoc,
      step_count: steps.length,
      step_subjects: STEP_SUBJECTS
    });
  }

  var ref = await db.collection('sequences').add(sequenceDoc);

  return jsonResponse(201, {
    ok: true,
    id: ref.id,
    name: SEQUENCE_NAME,
    step_count: steps.length,
    message: 'July International Conversion sequence created. Steps have placeholder content — populate via populate-july-international-content.js.'
  });
};
