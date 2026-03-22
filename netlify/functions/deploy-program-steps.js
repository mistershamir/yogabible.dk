/**
 * Deploy Program Sequence Step Content
 *
 * POST /.netlify/functions/deploy-program-steps
 * Auth: X-Internal-Secret header
 *
 * Updates specific steps on program-specific sequences.
 * Only touches the steps listed — leaves all other fields unchanged.
 */

const { getDb } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');

// ── Step updates per sequence ───────────────────────────────────────────────

var SEQUENCE_UPDATES = [
  {
    id: 'ZwvSVLsqRZcIv8C0IG0y',
    name: 'April 4W Intensive — Conversion Push',
    steps: [
      {
        stepIndex: 1,
        label: 'Step 2 — April-holdet de sidste pladser',
        email_subject: 'April-holdet \u2014 de sidste pladser',
        email_body:
          '<p>Hej {{first_name}},</p>' +
          '<p>Kort besked: april-holdet er n\u00E6sten fuldt. Vi tager maks 12 elever, og der er kun et par pladser tilbage.</p>' +
          '<p>Hvis du har g\u00E5et og t\u00E6nkt over det \u2014 det her er det bedste tidspunkt at beslutte dig. Start Forberedelsesfasen nu, og du kan allerede tage klasser i studiet inden uddannelsen begynder den 13. april.</p>' +
          '<p>3.750 kr. Bel\u00F8bet tr\u00E6kkes fra den fulde pris.</p>' +
          '<p>\u{1F538} <a href="https://yogabible.dk/200-hours-4-weeks-intensive-programs/?product=100078" style="color:#f75c03;text-decoration:none;font-weight:600;">Start Forberedelsesfasen</a></p>' +
          '<p>Eller ring mig p\u00E5 53 88 12 09 hvis du har sp\u00F8rgsm\u00E5l. Jeg hj\u00E6lper gerne.</p>',
        email_subject_en: 'April cohort \u2014 last spots',
        email_body_en:
          '<p>Hi {{first_name}},</p>' +
          '<p>Quick note: the April cohort is nearly full. We take a maximum of 12 students, and there are only a couple of spots left.</p>' +
          '<p>If you\u2019ve been thinking about it \u2014 now is the best time to decide. Start the Preparation Phase now and you can already take classes at the studio before the education begins on April 13.</p>' +
          '<p>3,750 DKK. The amount is deducted from the full price.</p>' +
          '<p>\u{1F538} <a href="https://yogabible.dk/200-hours-4-weeks-intensive-programs/?product=100078" style="color:#f75c03;text-decoration:none;font-weight:600;">Start the Preparation Phase</a></p>' +
          '<p>Or call me at +45 53 88 12 09 if you have questions. Happy to help.</p>'
      }
    ]
  },
  {
    id: 'ab2dSOrmaQnneUyRojCf',
    name: '18W Flexible Aug\u2013Dec \u2014 DK Nurture',
    steps: [
      {
        stepIndex: 1,
        label: 'Step 2 — Hverdag eller weekend',
        email_subject: 'Hverdag eller weekend \u2014 du bestemmer',
        email_body:
          '<p>Hej {{first_name}},</p>' +
          '<p>Det der g\u00F8r 18-ugers uddannelsen speciel er fleksibiliteten. Du v\u00E6lger selv om du vil f\u00F8lge hverdagsholdet eller weekendholdet \u2014 og du kan skifte mellem dem undervejs.</p>' +
          '<p>Det betyder, at hvis din kalender \u00E6ndrer sig i l\u00F8bet af de 18 uger, tilpasser uddannelsen sig til dig. Ikke omvendt.</p>' +
          '<p>Vi har maks 24 elever fordelt p\u00E5 begge hold. Det giver plads nok til at alle f\u00E5r personlig feedback, men ogs\u00E5 et f\u00E6llesskab der b\u00E6rer dig igennem.</p>' +
          '<p>Se hele skemaet her: <a href="https://yogabible.dk/skema/18-uger-august/" style="color:#f75c03;text-decoration:none;font-weight:600;">18-ugers skema (august\u2013december)</a></p>' +
          '<p>Start Forberedelsesfasen og begynd at tage klasser allerede nu \u2014 s\u00E5 har du et forspring inden august.</p>' +
          '<p>\u{1F538} <a href="https://yogabible.dk/200-hours-18-weeks-flexible-programs/" style="color:#f75c03;text-decoration:none;font-weight:600;">Start Forberedelsesfasen</a></p>' +
          '<p>Skriv hvis du har sp\u00F8rgsm\u00E5l.</p>',
        email_subject_en: 'Weekday or weekend \u2014 you decide',
        email_body_en:
          '<p>Hi {{first_name}},</p>' +
          '<p>What makes the 18-week education special is the flexibility. You choose whether to follow the weekday or weekend track \u2014 and you can switch between them along the way.</p>' +
          '<p>That means if your calendar changes during the 18 weeks, the education adapts to you. Not the other way around.</p>' +
          '<p>We take a maximum of 24 students across both tracks. Enough room for personal feedback, but also a community that carries you through.</p>' +
          '<p>See the full schedule here: <a href="https://yogabible.dk/en/schedule/18-weeks-august/" style="color:#f75c03;text-decoration:none;font-weight:600;">18-week schedule (August\u2013December)</a></p>' +
          '<p>Start the Preparation Phase and begin taking classes now \u2014 so you\u2019ll have a head start before August.</p>' +
          '<p>\u{1F538} <a href="https://yogabible.dk/200-hours-18-weeks-flexible-programs/" style="color:#f75c03;text-decoration:none;font-weight:600;">Start the Preparation Phase</a></p>' +
          '<p>Write me if you have questions.</p>'
      }
    ]
  },
  {
    id: 'uDST1Haj1dMyQy0Qifhu',
    name: '8W Semi-Intensive May\u2013Jun \u2014 DK Nurture',
    steps: [
      {
        stepIndex: 1,
        label: 'Step 2 — Din hverdag beh\u00F8ver ikke stoppe',
        email_subject: 'Din hverdag beh\u00F8ver ikke stoppe',
        email_body:
          '<p>Hej {{first_name}},</p>' +
          '<p>Den st\u00F8rste bekymring vi h\u00F8rer om 8-ugers uddannelsen er: \u201CKan jeg n\u00E5 det ved siden af mit job?\u201D</p>' +
          '<p>Svaret er ja. Uddannelsen er bygget til det. Du m\u00F8der op i weekenderne, og din hverdag k\u00F8rer videre som normalt.</p>' +
          '<p>Det kr\u00E6ver noget af dig \u2014 men det er 8 uger, ikke 8 m\u00E5neder. Og du kommer ud med pr\u00E6cis den samme Yoga Alliance RYT-200 certificering som dem der tager den intensive.</p>' +
          '<p>Se hele skemaet her: <a href="https://yogabible.dk/skema/8-uger/" style="color:#f75c03;text-decoration:none;font-weight:600;">8-ugers skema (maj\u2013juni)</a></p>' +
          '<p>Start Forberedelsesfasen og begynd at tage klasser i studiet allerede nu. S\u00E5 er du klar n\u00E5r maj kommer.</p>' +
          '<p>\u{1F538} <a href="https://yogabible.dk/200-hours-8-weeks-semi-intensive-programs/" style="color:#f75c03;text-decoration:none;font-weight:600;">Start Forberedelsesfasen</a></p>' +
          '<p>Ring eller skriv hvis du vil vide mere.</p>',
        email_subject_en: 'Your daily life doesn\u2019t need to stop',
        email_body_en:
          '<p>Hi {{first_name}},</p>' +
          '<p>The biggest concern we hear about the 8-week education is: \u201CCan I manage it alongside my job?\u201D</p>' +
          '<p>The answer is yes. The education is built for it. You show up on weekends, and your weekday life continues as normal.</p>' +
          '<p>It takes commitment \u2014 but it\u2019s 8 weeks, not 8 months. And you come out with exactly the same Yoga Alliance RYT-200 certification as those who take the intensive.</p>' +
          '<p>See the full schedule here: <a href="https://yogabible.dk/en/schedule/8-weeks/" style="color:#f75c03;text-decoration:none;font-weight:600;">8-week schedule (May\u2013June)</a></p>' +
          '<p>Start the Preparation Phase and begin taking classes at the studio now. So you\u2019re ready when May comes.</p>' +
          '<p>\u{1F538} <a href="https://yogabible.dk/200-hours-8-weeks-semi-intensive-programs/" style="color:#f75c03;text-decoration:none;font-weight:600;">Start the Preparation Phase</a></p>' +
          '<p>Call or write if you want to know more.</p>'
      }
    ]
  },
  {
    id: 'Yoq6RCVqTYlF10OPmkSw',
    name: 'July Vinyasa Plus \u2014 International Nurture',
    steps: [
      {
        stepIndex: 1,
        label: 'Step 2 — Vinyasa Plus det der g\u00F8r juli anderledes',
        email_subject: 'Vinyasa Plus \u2014 det der g\u00F8r juli anderledes',
        email_body:
          '<p>Hej {{first_name}},</p>' +
          '<p>Juli er ikke bare endnu en yogauddannelse. Vinyasa Plus-metoden er det der g\u00F8r den speciel.</p>' +
          '<p>70% af programmet er Vinyasa Flow \u2014 dynamisk, kreativ sekvensering der l\u00E6rer dig at bygge klasser der bev\u00E6ger sig og \u00E5nder. De resterende 30% er Yin Yoga og Hot Yoga \u2014 den langsommere, dybere side der g\u00F8r dig til en komplet underviser, ikke bare en flow-instrukt\u00F8r.</p>' +
          '<p>Du tr\u00E6ner i vores eget studio i Christianshavn \u2014 et af K\u00F8benhavns smukkeste kvarterer. Kanaler, havnebad, cykler, lange sommeraftener.</p>' +
          '<p>Vi hj\u00E6lper med bolig gennem en lokal partner, s\u00E5 du ikke skal finde ud af det alene.</p>' +
          '<p>\u{1F538} <a href="https://yogabible.dk/yoga-journal/vinyasa-plus-metoden/" style="color:#f75c03;text-decoration:none;font-weight:600;">L\u00E6s mere om Vinyasa Plus-metoden</a></p>' +
          '<p>Start Forberedelsesfasen nu og tag klasser i studiet inden juli begynder.</p>' +
          '<p>\u{1F538} <a href="https://yogabible.dk/200-hours-4-weeks-intensive-programs/?product=100211" style="color:#f75c03;text-decoration:none;font-weight:600;">Start Forberedelsesfasen</a></p>' +
          '<p>Skriv hvis du har sp\u00F8rgsm\u00E5l \u2014 jeg hj\u00E6lper gerne.</p>',
        email_subject_en: 'Vinyasa Plus \u2014 what makes July different',
        email_body_en:
          '<p>Hi {{first_name}},</p>' +
          '<p>July isn\u2019t just another teacher training. The Vinyasa Plus method is what sets it apart.</p>' +
          '<p>70% of the program is Vinyasa Flow \u2014 dynamic, creative sequencing that teaches you to build classes that move and breathe. The other 30% is Yin Yoga and Hot Yoga \u2014 the slower, deeper side that makes you a complete teacher, not just a flow instructor.</p>' +
          '<p>You\u2019ll train in our own studio in Christianshavn \u2014 one of Copenhagen\u2019s most beautiful neighbourhoods. Canals, harbour baths, bikes, long summer evenings. It\u2019s the kind of place that makes four weeks of hard work feel like an adventure.</p>' +
          '<p>We help with accommodation through a local partner, so you don\u2019t have to figure that out alone.</p>' +
          '<p>\u{1F538} <a href="https://yogabible.dk/en/yoga-journal/vinyasa-plus-metoden/" style="color:#f75c03;text-decoration:none;font-weight:600;">Read more about the Vinyasa Plus method</a></p>' +
          '<p>Start the Preparation Phase now and take classes at the studio before July begins.</p>' +
          '<p>\u{1F538} <a href="https://yogabible.dk/200-hours-4-weeks-intensive-programs/?product=100211" style="color:#f75c03;text-decoration:none;font-weight:600;">Start the Preparation Phase</a></p>' +
          '<p>Reply with any questions \u2014 I\u2019m here to help.</p>'
      }
    ]
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

  for (var s = 0; s < SEQUENCE_UPDATES.length; s++) {
    var seqUpdate = SEQUENCE_UPDATES[s];
    var docRef = db.collection('sequences').doc(seqUpdate.id);
    var doc = await docRef.get();

    if (!doc.exists) {
      results.push({ id: seqUpdate.id, name: seqUpdate.name, status: 'not_found' });
      continue;
    }

    var data = doc.data();
    var steps = data.steps || [];
    var stepResults = [];

    for (var i = 0; i < seqUpdate.steps.length; i++) {
      var update = seqUpdate.steps[i];
      var idx = update.stepIndex;

      if (idx >= steps.length) {
        stepResults.push({ label: update.label, index: idx, status: 'step_missing' });
        continue;
      }

      if (update.email_subject) steps[idx].email_subject = update.email_subject;
      if (update.email_body) steps[idx].email_body = update.email_body;
      if (update.email_subject_en !== undefined) steps[idx].email_subject_en = update.email_subject_en;
      if (update.email_body_en !== undefined) steps[idx].email_body_en = update.email_body_en;

      stepResults.push({
        label: update.label,
        index: idx,
        status: 'updated',
        da_subject: steps[idx].email_subject,
        en_subject: steps[idx].email_subject_en || null,
        has_da_body: !!steps[idx].email_body,
        has_en_body: !!steps[idx].email_body_en
      });
    }

    await docRef.update({ steps: steps, updated_at: new Date().toISOString() });

    // Verify
    var verified = await docRef.get();
    var verifiedSteps = verified.data().steps;
    var verification = {};
    for (var v = 0; v < verifiedSteps.length; v++) {
      verification['step_' + v] = {
        da_subject: verifiedSteps[v].email_subject || null,
        en_subject: verifiedSteps[v].email_subject_en || null,
        has_da_body: !!verifiedSteps[v].email_body,
        has_en_body: !!verifiedSteps[v].email_body_en
      };
    }

    results.push({
      id: seqUpdate.id,
      name: data.name,
      steps_updated: stepResults,
      verification: verification
    });
  }

  return jsonResponse(200, { ok: true, results: results });
};
