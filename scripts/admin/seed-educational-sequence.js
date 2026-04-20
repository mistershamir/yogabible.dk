/**
 * Seed Educational Nurture Sequence — One-time setup
 *
 * POST /.netlify/functions/seed-educational-sequence
 * Auth: X-Internal-Secret header
 *
 * Creates the "YTT Educational Nurture — 2026" sequence in Firestore
 * with 12 placeholder steps. Run once, then populate real content via admin UI.
 *
 * Query param: ?dry_run=true — preview the document without creating it
 */

const { getDb, serverTimestamp } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');

const SEQUENCE_NAME = 'YTT Educational Nurture — 2026';

const STEP_SUBJECTS = [
  { da: 'Hvad tjener en yogalærer i Danmark?',                          en: 'The yoga economy is bigger than you think' },
  { da: '3 måder at tjene penge som yogalærer',                         en: 'How to build a yoga career that actually pays' },
  { da: '"Jeg vidste bare, at jeg ikke kunne blive ved"',               en: '"I booked a flight to Copenhagen and everything changed"' },
  { da: 'Døren er åben når du er klar',                                 en: 'Your Copenhagen chapter is waiting' },
  { da: 'Hot yoga er ikke en trend — det er en forretningsmodel',       en: 'The certification most yoga teachers wish they had' },
  { da: 'Sådan åbner du dit eget yogastudie',                           en: 'From student to studio owner — the path nobody shows you' },
  { da: 'En tirsdag som yogalærer i København',                         en: '24 hours in Copenhagen as a yoga teacher in training' },
  { da: 'Start når du er klar',                                         en: 'This summer could be the one' },
  { da: 'Det ændrede mere end min undervisning',                        en: 'The transformation nobody warns you about' },
  { da: 'Det skandinaviske yogamarked eksploderer',                     en: 'Why Copenhagen is becoming Europe\'s yoga capital' },
  { da: 'Hvad RYT-200 rent faktisk betyder for din karriere',           en: 'A certification that works anywhere in the world' },
  { da: 'Din plads er her',                                             en: 'See you in Copenhagen' }
];

function buildSteps() {
  return STEP_SUBJECTS.map(function (subj, i) {
    return {
      step_number: i + 1,
      delay_minutes: 10080, // 7 days
      channel: 'email',
      email_subject: subj.da,
      email_body: '<p>[PLACEHOLDER — DA body for step ' + (i + 1) + ']</p>',
      email_subject_en: subj.en,
      email_body_en: '<p>[PLACEHOLDER — EN body for step ' + (i + 1) + ']</p>\n\n{{country_block}}',
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
    description: '12-week lifestyle nurture for leads who completed broadcast. Weekly emails about yoga careers, income, lifestyle. DA/EN with country-specific blocks for international leads.',
    active: true,
    trigger: { type: 'manual', conditions: {} },
    exit_conditions: ['Converted', 'Existing Applicant', 'Unsubscribed', 'Lost', 'Closed', 'Archived'],
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
    message: 'Educational sequence created successfully. Steps have placeholder content — populate via admin UI or update script.'
  });
};
