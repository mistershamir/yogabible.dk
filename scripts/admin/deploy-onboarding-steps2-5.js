/**
 * Deploy Onboarding Steps 2–5 — Bilingual content for YTT Onboarding 2026
 *
 * POST /.netlify/functions/deploy-onboarding-steps2-5
 * Auth: X-Internal-Secret header
 *
 * Updates steps at indexes 1, 2, 3, 4 on sequence Un1xmmriIpUyy2Kui97N.
 * Leaves step 0 unchanged. Sets delay_minutes if missing.
 */

const { getDb } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');

var SEQUENCE_ID = 'Un1xmmriIpUyy2Kui97N';

var STEPS = [
  // ── Step 2 (index 1) — "Hvilken uddannelse passer til dig?" ───────────
  {
    stepIndex: 1,
    delay_minutes: 7200,
    email_subject: 'Hvilken uddannelse passer til dig?',
    email_body:
      '<p>Hej {{first_name}},</p>' +
      '<p>Vi har fire formater, og de passer til meget forskellige liv. Jeg vil gerne hj\u00E6lpe dig med at finde det rigtige \u2014 men jeg har brug for at vide lidt om din situation.</p>' +
      '<p>Er du i job? Har du ferie du kan bruge? Foretr\u00E6kker du weekender? G\u00E5r du allerede til yoga?</p>' +
      '<p>Skriv mig et par linjer om hvor du er i livet lige nu, s\u00E5 vender jeg tilbage med en anbefaling. Intet salg \u2014 bare \u00E6rlig r\u00E5dgivning.</p>' +
      '<p>Du kan ogs\u00E5 booke en gratis introm\u00F8de, s\u00E5 tager vi snakken ansigt til ansigt:</p>' +
      '<p>\uD83D\uDD38 <a href="https://yogabible.dk/?booking=info-session" style="color:#f75c03;text-decoration:none;font-weight:600;">Book et gratis introm\u00F8de</a></p>' +
      '<p>Eller ring mig direkte p\u00E5 53 88 12 09.</p>',
    email_subject_en: 'Which education fits you?',
    email_body_en:
      '<p>Hi {{first_name}},</p>' +
      '<p>We have four formats, and they suit very different lives. I\u2019d love to help you find the right one \u2014 but I need to know a little about your situation.</p>' +
      '<p>Are you working? Do you have time off you can use? Do you prefer weekends? Do you already practise yoga?</p>' +
      '<p>Write me a few lines about where you are in life right now, and I\u2019ll come back with a recommendation. No sales pitch \u2014 just honest guidance.</p>' +
      '<p>You can also book a free intro meeting so we can talk face to face:</p>' +
      '<p>\uD83D\uDD38 <a href="https://yogabible.dk/?booking=info-session" style="color:#f75c03;text-decoration:none;font-weight:600;">Book a free intro meeting</a></p>' +
      '<p>Or call me directly at +45 53 88 12 09.</p>'
  },

  // ── Step 3 (index 2) — "Jeg troede ikke det var noget for mig" ────────
  {
    stepIndex: 2,
    delay_minutes: 7200,
    email_subject: '"Jeg troede ikke det var noget for mig"',
    email_body:
      '<p>Hej {{first_name}},</p>' +
      '<p>De fleste der starter hos os havde pr\u00E6cis de samme tvivl som du m\u00E5ske har lige nu.</p>' +
      '<p>\u201CJeg er ikke fleksibel nok.\u201D \u201CJeg har ikke tid.\u201D \u201CHvad hvis jeg ikke er god nok?\u201D</p>' +
      '<p>Og alligevel sagde de ja. Nogle af dem underviser i dag. Andre har f\u00E5et en helt ny retning i livet. Og alle sammen siger det samme bagefter: \u201CJeg ville \u00F8nske, jeg havde gjort det tidligere.\u201D</p>' +
      '<p>Det er ikke et l\u00F8fte om at uddannelsen \u00E6ndrer dit liv. Det er bare virkeligheden \u2014 n\u00E5r mennesker giver sig selv lov til noget nyt, sker der noget.</p>' +
      '<p>Hvis du er nysgerrig, s\u00E5 kig forbi til en klasse i studiet. Ingen forpligtelser. Bare m\u00E6rk stemningen.</p>' +
      '<p>\uD83D\uDD38 <a href="https://yogabible.dk/200-hours-4-weeks-intensive-programs/" style="color:#f75c03;text-decoration:none;font-weight:600;">Se vores uddannelser</a></p>' +
      '<p>Skriv til mig hvis du har sp\u00F8rgsm\u00E5l.</p>',
    email_subject_en: '"I didn\'t think it was for me"',
    email_body_en:
      '<p>Hi {{first_name}},</p>' +
      '<p>Most people who start with us had exactly the same doubts you might be having right now.</p>' +
      '<p>\u201CI\u2019m not flexible enough.\u201D \u201CI don\u2019t have time.\u201D \u201CWhat if I\u2019m not good enough?\u201D</p>' +
      '<p>And yet they said yes. Some of them teach today. Others found a completely new direction in life. And all of them say the same thing afterwards: \u201CI wish I\u2019d done it sooner.\u201D</p>' +
      '<p>This isn\u2019t a promise that the education will change your life. It\u2019s just reality \u2014 when people give themselves permission to try something new, something happens.</p>' +
      '<p>If you\u2019re curious, come by for a class at the studio. No commitments. Just feel the vibe.</p>' +
      '<p>\uD83D\uDD38 <a href="https://yogabible.dk/200-hours-4-weeks-intensive-programs/" style="color:#f75c03;text-decoration:none;font-weight:600;">See our programs</a></p>' +
      '<p>Write me if you have questions.</p>'
  },

  // ── Step 4 (index 3) — "Hvad holder dig tilbage?" ─────────────────────
  {
    stepIndex: 3,
    delay_minutes: 7200,
    email_subject: 'Hvad holder dig tilbage?',
    email_body:
      '<p>Hej {{first_name}},</p>' +
      '<p>Jeg sp\u00F8rger direkte \u2014 fordi jeg har l\u00E6rt at de fleste bare har brug for at sige det h\u00F8jt.</p>' +
      '<p>Er det pengene? Er det tiden? Er det usikkerheden om du er klar?</p>' +
      '<p>Uanset hvad det er, har jeg sandsynligvis h\u00F8rt det f\u00F8r. Og jeg kan m\u00E5ske hj\u00E6lpe.</p>' +
      '<p>Forberedelsesfasen er lavet pr\u00E6cis til det her \u00F8jeblik. 3.750 kr., du starter n\u00E5r du vil, bel\u00F8bet tr\u00E6kkes fra den fulde pris. Det er en m\u00E5de at pr\u00F8ve det af uden at binde dig til noget stort.</p>' +
      '<p>Eller kom forbi til et gratis introm\u00F8de \u2014 s\u00E5 kan vi snakke om det i stedet for at skrive:</p>' +
      '<p>\uD83D\uDD38 <a href="https://yogabible.dk/?booking=info-session" style="color:#f75c03;text-decoration:none;font-weight:600;">Book et gratis introm\u00F8de</a></p>' +
      '<p>Du kan ogs\u00E5 bare skrive tilbage og fort\u00E6lle mig hvad du t\u00E6nker. Jeg svarer personligt.</p>',
    email_subject_en: 'What\'s holding you back?',
    email_body_en:
      '<p>Hi {{first_name}},</p>' +
      '<p>I\u2019m asking directly \u2014 because I\u2019ve learned that most people just need to say it out loud.</p>' +
      '<p>Is it the money? Is it the time? Is it the uncertainty about whether you\u2019re ready?</p>' +
      '<p>Whatever it is, I\u2019ve probably heard it before. And I might be able to help.</p>' +
      '<p>The Preparation Phase is made for exactly this moment. 3,750 DKK, you start whenever you want, the amount is deducted from the full price. It\u2019s a way to try it out without committing to anything big.</p>' +
      '<p>Or come by for a free intro meeting \u2014 so we can talk about it instead of typing:</p>' +
      '<p>\uD83D\uDD38 <a href="https://yogabible.dk/?booking=info-session" style="color:#f75c03;text-decoration:none;font-weight:600;">Book a free intro meeting</a></p>' +
      '<p>Or just write back and tell me what you\u2019re thinking. I reply personally.</p>'
  },

  // ── Step 5 (index 4) — "Stadig her hvis du har brug for mig" ──────────
  {
    stepIndex: 4,
    delay_minutes: 7200,
    email_subject: 'Stadig her hvis du har brug for mig',
    email_body:
      '<p>Hej {{first_name}},</p>' +
      '<p>Det her er min sidste mail i denne omgang. Jeg vil ikke fylde din indbakke.</p>' +
      '<p>Men jeg vil gerne have du ved, at d\u00F8ren er \u00E5ben. Hvis du en dag er klar \u2014 om en uge, en m\u00E5ned, eller til n\u00E6ste \u00E5r \u2014 s\u00E5 er vi her.</p>' +
      '<p>Du kan altid starte med Forberedelsesfasen og m\u00E6rke om det er det rigtige for dig. Ingen tidsfrist, ingen pres.</p>' +
      '<p>Eller bare kom forbi til en snak:</p>' +
      '<p>\uD83D\uDD38 <a href="https://yogabible.dk/?booking=info-session" style="color:#f75c03;text-decoration:none;font-weight:600;">Book et gratis introm\u00F8de</a></p>' +
      '<p>Tak fordi du overvejer os. Skriv eller ring n\u00E5r som helst \u2014 53 88 12 09.</p>',
    email_subject_en: 'Still here if you need me',
    email_body_en:
      '<p>Hi {{first_name}},</p>' +
      '<p>This is my last email in this round. I don\u2019t want to fill your inbox.</p>' +
      '<p>But I want you to know the door is open. If you\u2019re ready one day \u2014 in a week, a month, or next year \u2014 we\u2019re here.</p>' +
      '<p>You can always start with the Preparation Phase and feel out if it\u2019s right for you. No deadline, no pressure.</p>' +
      '<p>Or just come by for a chat:</p>' +
      '<p>\uD83D\uDD38 <a href="https://yogabible.dk/?booking=info-session" style="color:#f75c03;text-decoration:none;font-weight:600;">Book a free intro meeting</a></p>' +
      '<p>Thank you for considering us. Write or call any time \u2014 +45 53 88 12 09.</p>'
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
  var docRef = db.collection('sequences').doc(SEQUENCE_ID);
  var snap = await docRef.get();

  if (!snap.exists) {
    return jsonResponse(404, { error: 'Sequence not found', id: SEQUENCE_ID });
  }

  var data = snap.data();
  var steps = data.steps || [];

  if (steps.length < 5) {
    return jsonResponse(400, {
      error: 'Sequence has fewer than 5 steps',
      step_count: steps.length
    });
  }

  var results = [];

  for (var i = 0; i < STEPS.length; i++) {
    var update = STEPS[i];
    var step = steps[update.stepIndex];

    // Set content fields
    step.email_subject = update.email_subject;
    step.email_body = update.email_body;
    step.email_subject_en = update.email_subject_en;
    step.email_body_en = update.email_body_en;

    // Set delay_minutes if missing
    if (!step.delay_minutes) {
      step.delay_minutes = update.delay_minutes;
    }

    results.push({
      index: update.stepIndex,
      da_subject: step.email_subject,
      en_subject: step.email_subject_en,
      delay_minutes: step.delay_minutes
    });
  }

  await docRef.update({ steps: steps, updated_at: new Date().toISOString() });

  // Verify — read back and report all 5 steps
  var verified = await docRef.get();
  var vSteps = verified.data().steps;
  var verification = [];

  for (var j = 0; j < vSteps.length; j++) {
    var s = vSteps[j];
    verification.push({
      index: j,
      da_subject: s.email_subject || '(empty)',
      en_subject: s.email_subject_en || '(empty)',
      has_da_body: !!s.email_body,
      has_en_body: !!s.email_body_en,
      delay_minutes: s.delay_minutes || 0
    });
  }

  return jsonResponse(200, {
    ok: true,
    sequence: data.name || SEQUENCE_ID,
    updated_steps: results,
    all_steps_verification: verification
  });
};
