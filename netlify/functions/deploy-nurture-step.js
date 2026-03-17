/**
 * Deploy Nurture Email Steps — Yoga Bible
 *
 * POST /.netlify/functions/deploy-nurture-step
 * Auth: X-Internal-Secret header
 *
 * Pushes authored email content to sequence steps in Firestore.
 * Also creates new sequences and updates delays.
 */

const { getDb, serverTimestamp } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');

// ── Exit conditions (shared) ────────────────────────────────────────────────

var EXIT_CONDITIONS = [
  'Converted', 'Existing Applicant', 'On Hold', 'Interested In Next Round',
  'Not too keen', 'Unsubscribed', 'Lost', 'Closed', 'Archived'
];

// ── Step content updates ────────────────────────────────────────────────────

var STEP_UPDATES = [
  {
    name: 'April 4W Intensive',
    id: 'ZwvSVLsqRZcIv8C0IG0y',
    stepIndex: 0,
    delay_minutes: 7200,
    email_subject: 'Hej {{first_name}} \u2014 stadig interesseret?',
    email_body:
      '<p>Hej {{first_name}},</p>' +
      '<p>Jeg ville lige skrive personligt.</p>' +
      '<p>April-holdet starter om 3 uger, og vi har kun f\u00e5 pladser tilbage. Maks 12 elever \u2014 og vi er t\u00e6t p\u00e5.</p>' +
      '<p>Kort om uddannelsen:<br>' +
      '4 ugers fuldtids-intensiv i vores studio i Christianshavn<br>' +
      'Yoga Alliance RYT-200 certificering<br>' +
      'The Triangle Method \u2014 Hatha, Vinyasa, Yin + Hot Yoga + Meditation<br>' +
      'Maks 12 elever pr. hold</p>' +
      '<p>Du kan starte med <strong>Forberedelsesfasen</strong> \u2014 3.750 kr., som giver dig 30 yogaklasser i studiet med det samme. Bel\u00f8bet tr\u00e6kkes fra den fulde pris.</p>' +
      '<p style="margin:24px 0;"><a href="https://yogabible.dk/200-hours-4-weeks-intensive-programs?product=100121" style="display:inline-block;background:#f75c03;color:#ffffff;padding:14px 32px;text-decoration:none;border-radius:999px;font-weight:600;font-size:16px;">Start Forberedelsesfasen \u2192</a></p>' +
      '<p>Ring eller skriv hvis du har sp\u00f8rgsm\u00e5l \u2014 jeg svarer gerne.</p>'
  },
  {
    name: '18W Flexible Aug\u2013Dec',
    id: 'ab2dSOrmaQnneUyRojCf',
    stepIndex: 0,
    delay_minutes: 7200,
    email_subject: 'Marts-holdet er udsolgt',
    email_body:
      '<p>Hej {{first_name}},</p>' +
      '<p>Kort nyt: Vores 18-ugers marts\u2013juni-hold er officielt <strong>udsolgt</strong>. Det gik hurtigere end vi regnede med.</p>' +
      '<p>Den gode nyhed \u2014 august\u2013december-holdet er nu \u00e5bent. Samme format, samme Yoga Alliance RYT-200 certificering, samme Triangle Method.</p>' +
      '<p>Hvad g\u00f8r 18-ugersformatet unikt:<br>' +
      'Uddannelse ved siden af dit hverdagsliv \u2014 ingen grund til at sige dit job op<br>' +
      'Hverdagshold ELLER weekendhold (du kan skifte mellem dem undervejs)<br>' +
      'Hatha, Vinyasa, Yin + Hot Yoga + Meditation<br>' +
      'Maks 24 elever fordelt p\u00e5 begge hold</p>' +
      '<p>Du kan starte med <strong>Forberedelsesfasen</strong> \u2014 3.750 kr., som giver dig 30 yogaklasser med det samme. Bel\u00f8bet tr\u00e6kkes fra den fulde pris.</p>' +
      '<p style="margin:24px 0;"><a href="https://yogabible.dk/200-hours-18-weeks-flexible-programs?product=100210" style="display:inline-block;background:#f75c03;color:#ffffff;padding:14px 32px;text-decoration:none;border-radius:999px;font-weight:600;font-size:16px;">Start Forberedelsesfasen \u2192</a></p>' +
      '<p>Skriv eller ring hvis du har sp\u00f8rgsm\u00e5l \u2014 jeg svarer gerne.</p>'
  },
  {
    name: 'YTT Onboarding',
    id: 'Un1xmmriIpUyy2Kui97N',
    stepIndex: 0,
    delay_minutes: null,
    email_subject: '{{first_name}}, der er sket en del',
    email_body:
      '<p>Hej {{first_name}},</p>' +
      '<p>Der sker en del sp\u00e6ndende lige nu.</p>' +
      '<p>Vores marts\u2013juni 18-ugershold er <strong>udsolgt</strong> \u2014 og april-intensivet har kun f\u00e5 pladser tilbage. S\u00e5 jeg t\u00e6nkte det var et godt tidspunkt at give dig et overblik over, hvad der stadig er \u00e5bent.</p>' +
      '<p><strong>4 programmer med plads lige nu:</strong><br>' +
      '4-ugers intensiv (april) \u2014 fuldtid, f\u00e6rdig p\u00e5 \u00e9n m\u00e5ned<br>' +
      '8-ugers semi-intensiv (maj\u2013juni) \u2014 weekender, ved siden af dit job<br>' +
      '4-ugers Vinyasa Plus (juli) \u2014 70% Vinyasa, sommer i K\u00f8benhavn<br>' +
      '18-ugers fleksibelt (august\u2013december) \u2014 hverdag eller weekend, du v\u00e6lger</p>' +
      '<p>Alle er Yoga Alliance RYT-200. Alle starter med <strong>Forberedelsesfasen</strong> (3.750 kr., 30 yogaklasser).</p>' +
      '<p>Ikke sikker p\u00e5 hvilken der passer dig? Vi har lavet en side der sammenligner dem:</p>' +
      '<p style="margin:24px 0;"><a href="https://yogabible.dk/sammenlign-yogalreruddannelser" style="display:inline-block;background:#f75c03;color:#ffffff;padding:14px 32px;text-decoration:none;border-radius:999px;font-weight:600;font-size:16px;">Sammenlign programmer \u2192</a></p>' +
      '<p>Ring eller skriv hvis du vil snakke det igennem \u2014 jeg hj\u00e6lper gerne.</p>'
  },
  {
    name: '8W Semi-Intensive May\u2013Jun',
    id: 'uDST1Haj1dMyQy0Qifhu',
    stepIndex: 0,
    delay_minutes: 7200,
    email_subject: 'Samme certificering, halv tid',
    email_body:
      '<p>Hej {{first_name}},</p>' +
      '<p>Tak for din interesse i vores 8-ugers yogal\u00e6reruddannelse.</p>' +
      '<p>Holdet starter i maj og k\u00f8rer over 8 weekender frem til juni. Fuld Yoga Alliance RYT-200 \u2014 samme certificering som vores intensive formater, bare spredt ud s\u00e5 du kan passe det ved siden af dit job.</p>' +
      '<p>Kort om formatet:<br>' +
      '8 weekender i vores studio i Christianshavn<br>' +
      'Yoga Alliance RYT-200 certificering<br>' +
      'The Triangle Method \u2014 Hatha, Vinyasa, Yin + Hot Yoga + Meditation<br>' +
      'Maks 12 elever</p>' +
      '<p>Du kan starte med <strong>Forberedelsesfasen</strong> \u2014 3.750 kr., som giver dig 30 yogaklasser med det samme. Bel\u00f8bet tr\u00e6kkes fra den fulde pris.</p>' +
      '<p style="margin:24px 0;"><a href="https://yogabible.dk/200-hours-8-weeks-semi-intensive-programs?product=100209" style="display:inline-block;background:#f75c03;color:#ffffff;padding:14px 32px;text-decoration:none;border-radius:999px;font-weight:600;font-size:16px;">Start Forberedelsesfasen \u2192</a></p>' +
      '<p>Skriv eller ring hvis du har sp\u00f8rgsm\u00e5l.</p>'
  },
  {
    name: 'July Vinyasa Plus',
    id: 'Yoq6RCVqTYlF10OPmkSw',
    stepIndex: 0,
    delay_minutes: 7200,
    email_subject: 'Your summer in Copenhagen',
    email_body:
      '<p>Hi {{first_name}},</p>' +
      '<p>I wanted to reach out \u2014 if you\u2019ve been thinking about combining yoga teacher training with a summer abroad, Copenhagen in July is hard to beat.</p>' +
      '<p>Long light evenings, harbour baths, canals, bikes everywhere \u2014 it\u2019s one of the safest, most liveable cities in the world. And our studio is in Christianshavn, right in the heart of it.</p>' +
      '<p>The program:<br>' +
      '4-week Vinyasa Plus \u2014 70% Vinyasa Flow, 30% Yin & Hot Yoga<br>' +
      'Yoga Alliance RYT-200 certification<br>' +
      'The Triangle Method \u2014 Hatha, Vinyasa, Yin + Hot Yoga + Meditation<br>' +
      'Max 18 students</p>' +
      '<p>We also work with a local partner to help you find housing close to the studio \u2014 so you don\u2019t have to figure that out on your own.</p>' +
      '<p>You can start with the <strong>Preparation Phase</strong> \u2014 3,750 DKK for 30 yoga classes at the studio. The amount is deducted from the full program price.</p>' +
      '<p style="margin:24px 0;"><a href="https://yogabible.dk/200-hours-4-weeks-intensive-programs?product=100211" style="display:inline-block;background:#f75c03;color:#ffffff;padding:14px 32px;text-decoration:none;border-radius:999px;font-weight:600;font-size:16px;">Start the Preparation Phase \u2192</a></p>' +
      '<p>Reply to this email or call if you have any questions.</p>'
  }
];

// ── New sequence to create ──────────────────────────────────────────────────

var NEW_SEQUENCE = {
  name: 'YTT Quick Follow-up',
  description: 'Same-day personal check-in 2.5 hours after signup. Plain text, feels human.',
  active: true,
  trigger: { type: 'new_lead', conditions: { lead_type: 'ytt' } },
  exit_conditions: EXIT_CONDITIONS,
  steps: [{
    channel: 'email',
    delay_minutes: 150,
    email_subject: 'Fik du det hele, {{first_name}}?',
    email_body: '<p>Hej {{first_name}},</p><p>Det er Shamir fra Yoga Bible. Jeg ville lige sikre mig at du modtog skemaet og informationen vi sendte?</p><p>Hvis du har sp\u00f8rgsm\u00e5l om uddannelsen, s\u00e5 skriv endelig tilbage her \u2014 eller ring mig direkte p\u00e5 53 88 12 09.</p>',
    sms_message: '',
    condition: null
  }],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString()
};

// ── Handler ─────────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  var secret = process.env.AI_INTERNAL_SECRET;
  if (!secret || event.headers['x-internal-secret'] !== secret) {
    return jsonResponse(401, { error: 'Unauthorized' });
  }

  var db = getDb();
  var results = { steps: [], new_sequence: null };

  // ── Task 1: Update step content + delays ────────────────────────────────

  for (var i = 0; i < STEP_UPDATES.length; i++) {
    var update = STEP_UPDATES[i];
    try {
      var docRef = db.collection('sequences').doc(update.id);
      var snap = await docRef.get();

      if (!snap.exists) {
        results.steps.push({ name: update.name, id: update.id, status: 'not_found' });
        continue;
      }

      var data = snap.data();
      var steps = data.steps || [];

      if (steps.length <= update.stepIndex) {
        results.steps.push({ name: update.name, id: update.id, status: 'step_missing' });
        continue;
      }

      steps[update.stepIndex].email_subject = update.email_subject;
      steps[update.stepIndex].email_body = update.email_body;
      if (update.delay_minutes !== null) {
        steps[update.stepIndex].delay_minutes = update.delay_minutes;
      }
      // English version (optional — for international leads)
      if (update.email_subject_en !== undefined) {
        steps[update.stepIndex].email_subject_en = update.email_subject_en;
      }
      if (update.email_body_en !== undefined) {
        steps[update.stepIndex].email_body_en = update.email_body_en;
      }

      await docRef.update({
        steps: steps,
        updated_at: new Date().toISOString()
      });

      results.steps.push({
        name: update.name,
        id: update.id,
        step: update.stepIndex,
        delay: update.delay_minutes,
        status: 'updated',
        subject: update.email_subject
      });
    } catch (err) {
      results.steps.push({ name: update.name, id: update.id, status: 'error', error: err.message });
    }
  }

  // ── Task 2: Create YTT Quick Follow-up sequence ─────────────────────────

  try {
    // Check if it already exists
    var existing = await db.collection('sequences')
      .where('name', '==', NEW_SEQUENCE.name).limit(1).get();

    if (!existing.empty) {
      var existingId = existing.docs[0].id;
      results.new_sequence = { name: NEW_SEQUENCE.name, id: existingId, status: 'already_exists' };
    } else {
      var newDoc = await db.collection('sequences').add(NEW_SEQUENCE);
      results.new_sequence = { name: NEW_SEQUENCE.name, id: newDoc.id, status: 'created' };
    }
  } catch (err) {
    results.new_sequence = { name: NEW_SEQUENCE.name, status: 'error', error: err.message };
  }

  return jsonResponse(200, { ok: true, results: results });
};
