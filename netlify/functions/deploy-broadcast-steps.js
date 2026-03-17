/**
 * Deploy Broadcast Nurture Step Content
 *
 * POST /.netlify/functions/deploy-broadcast-steps
 * Auth: X-Internal-Secret header
 *
 * Finds the "YTT Broadcast Nurture — 2026" sequence and updates specific steps
 * with authored content. Only touches the steps listed in STEP_UPDATES.
 */

const { getDb } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');

var SEQUENCE_NAME = 'YTT Broadcast Nurture \u2014 2026';

// ── Step content to deploy ──────────────────────────────────────────────────

var STEP_UPDATES = [
  {
    stepIndex: 0,
    label: 'Step 1 — 20 mennesker sagde ja',
    // Danish already exists — only adding English
    email_subject_en: '20 people said yes',
    email_body_en:
      '<p>Hi {{first_name}},</p>' +
      '<p>Our 18-week yoga teacher education that started in March is sold out. 20 spots \u2014 gone.</p>' +
      '<p>The funny thing is, almost none of them had a \u201Cplan\u201D when they signed up. They just knew they wanted something more from their yoga practice. Some wanted to understand their body better. Some wanted the courage to stand in front of a group. Some were looking for something completely new.</p>' +
      '<p>I see it every time: most people who start don\u2019t think they\u2019re \u201Cready.\u201D And then they discover that nobody is. That\u2019s the whole point.</p>' +
      '<p>We have four cohorts for the rest of the year:</p>' +
      '<p>\u{1F538} <a href="https://yogabible.dk/200-hours-4-weeks-intensive-programs/" style="color:#f75c03;text-decoration:none;font-weight:600;">4-week intensive \u2014 April</a> \u2014 full-time, for those who want to dive all the way in. Only a few spots left.<br>' +
      '\u{1F538} <a href="https://yogabible.dk/200-hours-8-weeks-semi-intensive-programs/" style="color:#f75c03;text-decoration:none;font-weight:600;">8-week semi-intensive \u2014 May</a> \u2014 weekend format, alongside your job.<br>' +
      '\u{1F538} <a href="https://yogabible.dk/200-hours-4-weeks-intensive-programs/" style="color:#f75c03;text-decoration:none;font-weight:600;">4-week Vinyasa Plus \u2014 July</a> \u2014 our international summer cohort, taught in English.<br>' +
      '\u{1F538} <a href="https://yogabible.dk/200-hours-18-weeks-flexible-programs/" style="color:#f75c03;text-decoration:none;font-weight:600;">18-week flexible \u2014 August</a> \u2014 weekday or weekend, you choose.</p>' +
      '<p>All programs lead to Yoga Alliance RYT-200 certification and start with a Preparation Phase so you can try it out first.</p>' +
      '<p>Write me back if you have questions \u2014 I reply personally.</p>'
  },
  {
    stepIndex: 1,
    label: 'Step 2 — Du behøver ikke kunne stå på hovedet',
    // Full Danish + English content
    email_subject: 'Du beh\u00F8ver ikke kunne st\u00E5 p\u00E5 hovedet',
    email_body:
      '<p>Hej {{first_name}},</p>' +
      '<p>Den st\u00F8rste misforst\u00E5else om yogal\u00E6reruddannelsen? At man skal v\u00E6re god til yoga f\u00F8rst.</p>' +
      '<p>Vi har haft elever der ikke kunne r\u00F8re deres t\u00E6er da de startede. Elever der aldrig havde pr\u00F8vet en vinyasa-klasse. Elever der var nerv\u00F8se for at sige noget h\u00F8jt foran andre.</p>' +
      '<p>Det er derfor vi har Forberedelsesfasen. Du starter n\u00E5r du vil \u2014 og det forbereder dig b\u00E5de mentalt og fysisk, og du bliver en del af f\u00E6llesskabet allerede inden uddannelsen begynder. Bel\u00F8bet tr\u00E6kkes fra den fulde pris, s\u00E5 det er ikke en ekstra udgift \u2014 bare et tidligt skridt.</p>' +
      '<p>Jo tidligere du starter, jo mere klar f\u00F8ler du dig.</p>' +
      '<p style="margin:20px 0;"><a href="https://www.instagram.com/reel/DUq2R1BDXXP/?igsh=MW9pYW94Z2trYWR5Zg==" style="display:block;text-decoration:none;"><img src="https://yogabible.dk/assets/images/og/video-thumbnail-email.png" alt="Se video om yogal\u00E6reruddannelsen" style="width:100%;max-width:500px;border-radius:12px;display:block;" /></a></p>' +
      '<p>\u{1F538} <a href="https://yogabible.dk/200-hours-4-weeks-intensive-programs/" style="color:#f75c03;text-decoration:none;font-weight:600;">4-ugers intensiv \u2014 april</a><br>' +
      '\u{1F538} <a href="https://yogabible.dk/200-hours-8-weeks-semi-intensive-programs/" style="color:#f75c03;text-decoration:none;font-weight:600;">8-ugers semi-intensiv \u2014 maj</a><br>' +
      '\u{1F538} <a href="https://yogabible.dk/200-hours-4-weeks-intensive-programs/" style="color:#f75c03;text-decoration:none;font-weight:600;">4-ugers Vinyasa Plus \u2014 juli</a><br>' +
      '\u{1F538} <a href="https://yogabible.dk/200-hours-18-weeks-flexible-programs/" style="color:#f75c03;text-decoration:none;font-weight:600;">18-ugers fleksibel \u2014 august</a></p>' +
      '<p>Skriv til mig hvis du har sp\u00F8rgsm\u00E5l \u2014 jeg svarer personligt.</p>',
    email_subject_en: 'You don\u2019t need to touch your toes',
    email_body_en:
      '<p>Hi {{first_name}},</p>' +
      '<p>The biggest misconception about yoga teacher education? That you need to be good at yoga first.</p>' +
      '<p>We\u2019ve had students who couldn\u2019t touch their toes when they started. Students who had never tried a vinyasa class. Students who were terrified of speaking in front of others.</p>' +
      '<p>That\u2019s why we have the Preparation Phase. You start whenever you want \u2014 it prepares you mentally and physically, and you become part of the community before the education even begins. The cost is deducted from the full program price, so it\u2019s not an extra expense \u2014 just an early step.</p>' +
      '<p>The earlier you start, the more ready you\u2019ll feel.</p>' +
      '<p style="margin:20px 0;"><a href="https://www.instagram.com/reel/DUq2R1BDXXP/?igsh=MW9pYW94Z2trYWR5Zg==" style="display:block;text-decoration:none;"><img src="https://yogabible.dk/assets/images/og/video-thumbnail-email.png" alt="Watch our yoga teacher training video" style="width:100%;max-width:500px;border-radius:12px;display:block;" /></a></p>' +
      '<p>\u{1F538} <a href="https://yogabible.dk/200-hours-4-weeks-intensive-programs/" style="color:#f75c03;text-decoration:none;font-weight:600;">4-week intensive \u2014 April</a><br>' +
      '\u{1F538} <a href="https://yogabible.dk/200-hours-8-weeks-semi-intensive-programs/" style="color:#f75c03;text-decoration:none;font-weight:600;">8-week semi-intensive \u2014 May</a><br>' +
      '\u{1F538} <a href="https://yogabible.dk/200-hours-4-weeks-intensive-programs/" style="color:#f75c03;text-decoration:none;font-weight:600;">4-week Vinyasa Plus \u2014 July</a><br>' +
      '\u{1F538} <a href="https://yogabible.dk/200-hours-18-weeks-flexible-programs/" style="color:#f75c03;text-decoration:none;font-weight:600;">18-week flexible \u2014 August</a></p>' +
      '<p>Write me back if you have questions \u2014 I reply personally.</p>'
  }
];

// ── Handler ─────────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  var secret = process.env.AI_INTERNAL_SECRET;
  if (!secret || event.headers['x-internal-secret'] !== secret) {
    return jsonResponse(401, { error: 'Unauthorized' });
  }

  var db = getDb();
  var results = { sequence_id: null, steps: [] };

  // Find the broadcast sequence by name
  var snap = await db.collection('sequences')
    .where('name', '==', SEQUENCE_NAME).limit(1).get();

  if (snap.empty) {
    return jsonResponse(404, { error: 'Sequence not found: ' + SEQUENCE_NAME });
  }

  var docRef = snap.docs[0].ref;
  var data = snap.docs[0].data();
  var steps = data.steps || [];
  results.sequence_id = snap.docs[0].id;

  // Apply each step update
  for (var i = 0; i < STEP_UPDATES.length; i++) {
    var update = STEP_UPDATES[i];
    var idx = update.stepIndex;

    if (idx >= steps.length) {
      results.steps.push({ label: update.label, status: 'step_missing', index: idx });
      continue;
    }

    // Update Danish fields only if provided (don't overwrite existing with undefined)
    if (update.email_subject) steps[idx].email_subject = update.email_subject;
    if (update.email_body) steps[idx].email_body = update.email_body;

    // Always set English fields when provided
    if (update.email_subject_en !== undefined) steps[idx].email_subject_en = update.email_subject_en;
    if (update.email_body_en !== undefined) steps[idx].email_body_en = update.email_body_en;

    results.steps.push({
      label: update.label,
      index: idx,
      status: 'updated',
      has_da: !!(steps[idx].email_subject && steps[idx].email_body),
      has_en: !!(steps[idx].email_subject_en && steps[idx].email_body_en),
      da_subject: steps[idx].email_subject,
      en_subject: steps[idx].email_subject_en || null
    });
  }

  // Write updated steps back
  await docRef.update({
    steps: steps,
    updated_at: new Date().toISOString()
  });

  // Verify by re-reading
  var verify = await docRef.get();
  var verifiedSteps = verify.data().steps;
  results.verification = {
    total_steps: verifiedSteps.length,
    step_0: {
      da_subject: verifiedSteps[0].email_subject,
      en_subject: verifiedSteps[0].email_subject_en || null,
      has_da_body: !!verifiedSteps[0].email_body,
      has_en_body: !!verifiedSteps[0].email_body_en
    },
    step_1: {
      da_subject: verifiedSteps[1].email_subject,
      en_subject: verifiedSteps[1].email_subject_en || null,
      has_da_body: !!verifiedSteps[1].email_body,
      has_en_body: !!verifiedSteps[1].email_body_en
    },
    steps_2_5_still_empty: verifiedSteps.slice(2).every(function (s) { return !s.email_body; })
  };

  return jsonResponse(200, { ok: true, results: results });
};
