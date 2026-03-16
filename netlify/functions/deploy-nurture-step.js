/**
 * Deploy Nurture Email Steps — Yoga Bible
 *
 * POST /.netlify/functions/deploy-nurture-step
 * Auth: X-Internal-Secret header
 *
 * Pushes authored email content to sequence steps in Firestore.
 */

const { getDb } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');

// ── Step content to deploy ──────────────────────────────────────────────────

var STEP_UPDATES = [
  {
    name: 'April 4W Intensive (fix refund)',
    id: 'ZwvSVLsqRZcIv8C0IG0y',
    stepIndex: 0,
    email_subject: 'Hej {{first_name}} \u2014 stadig interesseret?',
    email_body:
      '<p>Hej {{first_name}},</p>' +
      '<p>Du kiggede p\u00e5 vores 4-ugers yogal\u00e6reruddannelse for et stykke tid siden, og jeg ville lige f\u00f8lge op.</p>' +
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
    name: '18W Flexible Aug–Dec',
    id: 'ab2dSOrmaQnneUyRojCf',
    stepIndex: 0,
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
    email_subject: '{{first_name}}, der er sket en del',
    email_body:
      '<p>Hej {{first_name}},</p>' +
      '<p>Du skrev til os om vores yogal\u00e6reruddannelse for et stykke tid siden, og der er sket en del siden da.</p>' +
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
    email_subject: 'Samme certificering, halv tid',
    email_body:
      '<p>Hej {{first_name}},</p>' +
      '<p>Du kiggede p\u00e5 vores 8-ugers yogal\u00e6reruddannelse, og jeg ville lige f\u00f8lge op.</p>' +
      '<p>Holdet starter i maj og k\u00f8rer over 8 weekender frem til juni. Fuld Yoga Alliance RYT-200 \u2014 samme certificering som vores intensive formater, bare spredt ud s\u00e5 du kan passe det ved siden af dit job.</p>' +
      '<p>Kort om formatet:<br>' +
      '8 weekender i vores studio i Christianshavn<br>' +
      'Yoga Alliance RYT-200 certificering<br>' +
      'The Triangle Method \u2014 Hatha, Vinyasa, Yin + Hot Yoga + Meditation<br>' +
      'Maks 12 elever</p>' +
      '<p>Du kan starte med <strong>Forberedelsesfasen</strong> \u2014 3.750 kr., som giver dig 30 yogaklasser med det samme. Bel\u00f8bet tr\u00e6kkes fra den fulde pris.</p>' +
      '<p style="margin:24px 0;"><a href="https://yogabible.dk/200-hours-8-weeks-semi-intensive-programs?product=100209" style="display:inline-block;background:#f75c03;color:#ffffff;padding:14px 32px;text-decoration:none;border-radius:999px;font-weight:600;font-size:16px;">Start Forberedelsesfasen \u2192</a></p>' +
      '<p>Skriv eller ring hvis du har sp\u00f8rgsm\u00e5l.</p>'
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
  var results = [];

  for (var i = 0; i < STEP_UPDATES.length; i++) {
    var update = STEP_UPDATES[i];
    try {
      var docRef = db.collection('sequences').doc(update.id);
      var snap = await docRef.get();

      if (!snap.exists) {
        results.push({ name: update.name, id: update.id, status: 'not_found' });
        continue;
      }

      var data = snap.data();
      var steps = data.steps || [];

      if (steps.length <= update.stepIndex) {
        results.push({ name: update.name, id: update.id, status: 'step_missing' });
        continue;
      }

      steps[update.stepIndex].email_subject = update.email_subject;
      steps[update.stepIndex].email_body = update.email_body;

      await docRef.update({
        steps: steps,
        updated_at: new Date().toISOString()
      });

      results.push({
        name: update.name,
        id: update.id,
        step: update.stepIndex,
        status: 'updated',
        subject: update.email_subject
      });
    } catch (err) {
      results.push({ name: update.name, id: update.id, status: 'error', error: err.message });
    }
  }

  return jsonResponse(200, { ok: true, results: results });
};
