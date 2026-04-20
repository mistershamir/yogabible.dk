/**
 * Deploy Final Empty Steps — July 3-4, 18W Step 3, 8W Step 3
 *
 * POST /.netlify/functions/deploy-final-empty-steps
 * Auth: X-Internal-Secret header
 *
 * Fills the last 4 empty steps in the sequence system.
 * Also fixes DA subjects that were accidentally in English.
 */

const { getDb } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');

var UPDATES = [
  // 1. July Vinyasa Plus — Step 3 (index 2)
  {
    sequenceId: 'Yoq6RCVqTYlF10OPmkSw',
    stepIndex: 2,
    label: 'July Vinyasa Plus — Step 3 (index 2)',
    fields: {
      email_subject: 'Vi hjælper dig med det praktiske',
      email_body: '<p>Hej {{first_name}},</p> <p>En af de største bekymringer ved at tage en uddannelse er det praktiske. Hvor skal jeg bo? Hvordan kommer jeg rundt? Er det besværligt?</p> <p>Det korte svar: nej. Og vi hjælper med resten.</p> <p>Vi samarbejder med en lokal boligpartner der hjælper vores elever med at finde et sted tæt på studiet — typisk et privat værelse eller en delt lejlighed i Christianshavn eller tæt på. Du behøver ikke finde ud af det selv.</p> <p>Studiet ligger 5 minutters gang fra metroen, og de fleste cykler. København i juli er ret fantastisk — 18 timers dagslys, havnebad, udendørs spisning overalt.</p> <p>Hvis du har spørgsmål om det praktiske, så skriv. Jeg hjælper gerne personligt.</p>',
      email_subject_en: 'We\'ll help you sort out Copenhagen',
      email_body_en: '<p>Hi {{first_name}},</p> <p>One of the biggest worries about training abroad is the practical stuff. Where do I stay? How do I get around? Is it complicated?</p> <p>The short answer: no. Copenhagen is one of the easiest cities in Europe to navigate, and we\'ll help with the rest.</p> <p>We work with a local accommodation partner who helps our international students find housing close to the studio — usually a private room or shared apartment in Christianshavn or nearby. You don\'t have to figure that out alone.</p> <p>Getting around is simple. Most people bike — the city is flat and has bike lanes everywhere. The studio is a 5-minute walk from the Metro, and the airport is 15 minutes away.</p> <p>As for daily life: everything is walkable, everyone speaks English, tap water is great, and Copenhagen in July is genuinely magical — 18 hours of daylight, harbour swimming, outdoor dining everywhere.</p> <p>If you have questions about logistics, just reply. I help every international student personally with the practical details.</p>'
    }
  },
  // 2. July Vinyasa Plus — Step 4 (index 3)
  {
    sequenceId: 'Yoq6RCVqTYlF10OPmkSw',
    stepIndex: 3,
    label: 'July Vinyasa Plus — Step 4 (index 3)',
    fields: {
      email_subject: 'Juli-holdet fylder op',
      email_body: '<p>Hej {{first_name}},</p> <p>Bare en kort besked — juli Vinyasa Plus-holdet er begyndt at fylde op. Vi tager maks 18 elever, og der er mere interesse end normalt i år.</p> <p>Hvis du har tænkt over det, er det smarteste at starte Forberedelsesfasen nu. Du betaler 3.750 kr., får adgang til klasser i studiet, og beløbet trækkes fra den fulde pris. Det er ikke en ekstra udgift — bare en tidlig start.</p> <p>På den måde har du allerede en praksis og kender studiet når juli kommer.</p> <p>\u{1F538} <a href="https://yogabible.dk/200-hours-4-weeks-intensive-programs/?product=100211" style="color:#f75c03;text-decoration:none;font-weight:600;">Start Forberedelsesfasen</a></p> <p>Eller book et gratis intromøde hvis du vil snakke det igennem først:</p> <p>\u{1F538} <a href="https://yogabible.dk/?booking=info-session" style="color:#f75c03;text-decoration:none;font-weight:600;">Book et gratis intromøde</a></p> <p>Uanset hvad — skriv hvis du har brug for noget. Jeg er her.</p>',
      email_subject_en: 'July spots are filling up',
      email_body_en: '<p>Hi {{first_name}},</p> <p>Just a heads up — the July Vinyasa Plus cohort is starting to fill. We take a maximum of 18 students, and we\'ve been getting more interest than usual this year.</p> <p>If you\'ve been thinking about it, the smartest move is to start the Preparation Phase now. You pay 3,750 DKK, get access to yoga classes at the studio, and the amount is deducted from the full program price. It\'s not an extra cost — just an early start.</p> <p>That way, by the time July comes around, you\'ll already have a practice and know the studio.</p> <p>\u{1F538} <a href="https://yogabible.dk/en/200-hours-4-weeks-intensive-programs/?product=100211" style="color:#f75c03;text-decoration:none;font-weight:600;">Start the Preparation Phase</a></p> <p>Or book a free intro meeting if you want to talk it through first:</p> <p>\u{1F538} <a href="https://yogabible.dk/en/?booking=info-session" style="color:#f75c03;text-decoration:none;font-weight:600;">Book a free intro meeting</a></p> <p>Either way — write me if you need anything. I\'m here.</p>'
    }
  },
  // 3. 18W Flexible Aug–Dec — Step 3 (index 2)
  {
    sequenceId: 'ab2dSOrmaQnneUyRojCf',
    stepIndex: 2,
    label: '18W Flexible Aug–Dec — Step 3 (index 2)',
    fields: {
      email_subject: 'Start din forberedelse allerede nu',
      email_body: '<p>Hej {{first_name}},</p> <p>August føles måske langt væk, men der er en god grund til at starte nu.</p> <p>Forberedelsesfasen giver dig adgang til klasser i studiet med det samme. Du bygger din praksis op i dit eget tempo, møder os, og finder ud af om det er det rigtige — længe inden uddannelsen begynder.</p> <p>3.750 kr. Beløbet trækkes fra den fulde pris.</p> <p>Jo tidligere du starter, jo stærkere et fundament har du i august.</p> <p>\u{1F538} <a href="https://yogabible.dk/200-hours-18-weeks-flexible-programs/" style="color:#f75c03;text-decoration:none;font-weight:600;">Start Forberedelsesfasen</a></p> <p>Eller book et gratis intromøde hvis du vil snakke det igennem:</p> <p>\u{1F538} <a href="https://yogabible.dk/?booking=info-session" style="color:#f75c03;text-decoration:none;font-weight:600;">Book et gratis intromøde</a></p> <p>Skriv hvis du har spørgsmål.</p>',
      email_subject_en: 'Start your preparation now',
      email_body_en: '<p>Hi {{first_name}},</p> <p>August might feel far away, but there\'s a good reason to start now.</p> <p>The Preparation Phase gives you access to classes at the studio right away. You build your practice at your own pace, meet us, and figure out if it\'s the right fit — long before the education begins.</p> <p>3,750 DKK. The amount is deducted from the full price.</p> <p>The earlier you start, the stronger your foundation will be in August.</p> <p>\u{1F538} <a href="https://yogabible.dk/en/200-hours-18-weeks-flexible-programs/" style="color:#f75c03;text-decoration:none;font-weight:600;">Start the Preparation Phase</a></p> <p>Or book a free intro meeting if you want to talk it through:</p> <p>\u{1F538} <a href="https://yogabible.dk/en/?booking=info-session" style="color:#f75c03;text-decoration:none;font-weight:600;">Book a free intro meeting</a></p> <p>Write me if you have questions.</p>'
    }
  },
  // 4. 8W Semi-Intensive May–Jun — Step 3 (index 2)
  {
    sequenceId: 'uDST1Haj1dMyQy0Qifhu',
    stepIndex: 2,
    label: '8W Semi-Intensive — Step 3 (index 2)',
    fields: {
      email_subject: 'Maj nærmer sig — er du klar?',
      email_body: '<p>Hej {{first_name}},</p> <p>8-ugers uddannelsen starter snart, og det bedste du kan gøre lige nu er at starte Forberedelsesfasen.</p> <p>Du får adgang til klasser i studiet med det samme, bygger din praksis op, og er klar når maj kommer. Beløbet (3.750 kr.) trækkes fra den fulde pris — så du betaler ikke mere, du starter bare tidligere.</p> <p>\u{1F538} <a href="https://yogabible.dk/200-hours-8-weeks-semi-intensive-programs/" style="color:#f75c03;text-decoration:none;font-weight:600;">Start Forberedelsesfasen</a></p> <p>Eller book et gratis intromøde hvis du vil snakke med mig først:</p> <p>\u{1F538} <a href="https://yogabible.dk/?booking=info-session" style="color:#f75c03;text-decoration:none;font-weight:600;">Book et gratis intromøde</a></p> <p>Ring eller skriv — 53 88 12 09.</p>',
      email_subject_en: 'May is coming — are you ready?',
      email_body_en: '<p>Hi {{first_name}},</p> <p>The 8-week education starts soon, and the best thing you can do right now is start the Preparation Phase.</p> <p>You get access to classes at the studio right away, build your practice, and you\'ll be ready when May comes. The cost (3,750 DKK) is deducted from the full price — so you don\'t pay more, you just start earlier.</p> <p>\u{1F538} <a href="https://yogabible.dk/en/200-hours-8-weeks-semi-intensive-programs/" style="color:#f75c03;text-decoration:none;font-weight:600;">Start the Preparation Phase</a></p> <p>Or book a free intro meeting if you want to talk to me first:</p> <p>\u{1F538} <a href="https://yogabible.dk/en/?booking=info-session" style="color:#f75c03;text-decoration:none;font-weight:600;">Book a free intro meeting</a></p> <p>Call or write — +45 53 88 12 09.</p>'
    }
  }
];

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  var secret = process.env.AI_INTERNAL_SECRET;
  var provided = (event.headers['x-internal-secret'] || event.headers['X-Internal-Secret'] || '').trim();
  if (!secret || provided !== secret) {
    return jsonResponse(401, { error: 'Unauthorized' });
  }

  var db = getDb();
  var results = [];

  for (var i = 0; i < UPDATES.length; i++) {
    var upd = UPDATES[i];
    var docRef = db.collection('sequences').doc(upd.sequenceId);
    var docSnap = await docRef.get();

    if (!docSnap.exists) {
      results.push({ label: upd.label, status: 'ERROR', error: 'Sequence not found: ' + upd.sequenceId });
      continue;
    }

    var data = docSnap.data();
    var steps = data.steps || [];

    if (steps.length <= upd.stepIndex) {
      results.push({ label: upd.label, status: 'ERROR', error: 'Step index ' + upd.stepIndex + ' out of range (steps: ' + steps.length + ')' });
      continue;
    }

    var step = steps[upd.stepIndex];
    var previousSubject = step.email_subject || '(empty)';
    var previousBodyEmpty = !step.email_body;
    var previousEnSubject = step.email_subject_en || '(empty)';
    var previousEnBodyEmpty = !step.email_body_en;

    // Only update the 4 content fields — preserve delay_minutes, channel, sms_message, etc.
    steps[upd.stepIndex].email_subject = upd.fields.email_subject;
    steps[upd.stepIndex].email_body = upd.fields.email_body;
    steps[upd.stepIndex].email_subject_en = upd.fields.email_subject_en;
    steps[upd.stepIndex].email_body_en = upd.fields.email_body_en;

    await docRef.update({ steps: steps, updated_at: new Date().toISOString() });

    results.push({
      label: upd.label,
      status: 'DEPLOYED',
      previous_da_subject: previousSubject,
      new_da_subject: upd.fields.email_subject,
      da_subject_changed: previousSubject !== upd.fields.email_subject,
      previous_da_body_empty: previousBodyEmpty,
      previous_en_subject: previousEnSubject,
      new_en_subject: upd.fields.email_subject_en,
      previous_en_body_empty: previousEnBodyEmpty
    });
  }

  return jsonResponse(200, {
    ok: true,
    deployed: results.filter(function (r) { return r.status === 'DEPLOYED'; }).length,
    errors: results.filter(function (r) { return r.status === 'ERROR'; }).length,
    results: results,
    timestamp: new Date().toISOString()
  });
};
