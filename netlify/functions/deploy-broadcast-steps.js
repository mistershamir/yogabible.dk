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
  },
  {
    stepIndex: 2,
    label: 'Step 3 — Det her er ikke et yoga retreat',
    email_subject: 'Det her er ikke et yoga retreat',
    email_body:
      '<p>Hej {{first_name}},</p>' +
      '<p>Der findes yogauddannelser hvor du bor i en jungle i fire uger og kommer hjem med et certifikat og en solbr\u00E6ndt n\u00E6se. Det er ikke det vi laver.</p>' +
      '<p>Yoga Bible er en uddannelse. Du l\u00E6rer anatomi, filosofi, undervisningsteknik og hvordan du bygger en klasse op fra bunden. Du bliver filmet, du f\u00E5r feedback, du \u00F8ver dig igen.</p>' +
      '<p>Vores metode hedder The Triangle Method \u2014 den kombinerer Hatha, Vinyasa og Yin med Hot Yoga og Meditation. Det betyder, at du ikke bare l\u00E6rer \u00E9n stil. Du l\u00E6rer at forst\u00E5 yoga som et helt system og kan undervise bredt fra dag \u00E9t.</p>' +
      '<p style="margin:20px 0;"><a href="https://www.instagram.com/reel/DUTlDIljTp6/?igsh=cXcybTZpZGZ4cmc=" style="display:block;text-decoration:none;"><img src="https://yogabible.dk/assets/images/og/video-thumbnail-studio.png" alt="Se video fra uddannelsen" style="width:100%;max-width:500px;border-radius:12px;display:block;" /></a></p>' +
      '<p>Alt foreg\u00E5r i vores eget studio i Christianshavn med maks 12\u201324 elever afh\u00E6ngig af format. Ikke i en lejet sal, ikke online, ikke som et sideprojekt.</p>' +
      '<p>Det er derfor vores hold er udsolgt hvert \u00E5r.</p>' +
      '<p>Skriv til mig hvis du vil vide mere om hvad der g\u00F8r os anderledes \u2014 jeg fort\u00E6ller gerne.</p>',
    email_subject_en: 'This isn\u2019t a yoga retreat',
    email_body_en:
      '<p>Hi {{first_name}},</p>' +
      '<p>There are yoga teacher trainings where you live in a jungle for four weeks and come home with a certificate and a sunburn. That\u2019s not what we do.</p>' +
      '<p>Yoga Bible is an education. You learn anatomy, philosophy, teaching methodology and how to build a class from scratch. You get filmed, you get feedback, you practise again.</p>' +
      '<p>Our method is called The Triangle Method \u2014 it combines Hatha, Vinyasa and Yin with Hot Yoga and Meditation. That means you don\u2019t just learn one style. You learn to understand yoga as a complete system and can teach broadly from day one.</p>' +
      '<p style="margin:20px 0;"><a href="https://www.instagram.com/reel/DUTlDIljTp6/?igsh=cXcybTZpZGZ4cmc=" style="display:block;text-decoration:none;"><img src="https://yogabible.dk/assets/images/og/video-thumbnail-studio.png" alt="Watch a video from the training" style="width:100%;max-width:500px;border-radius:12px;display:block;" /></a></p>' +
      '<p>Everything takes place in our own studio in Christianshavn with a maximum of 12\u201324 students depending on the format. Not in a rented hall, not online, not as a side project.</p>' +
      '<p>That\u2019s why our cohorts sell out every year.</p>' +
      '<p>Write me if you want to know more about what makes us different \u2014 I\u2019m happy to tell you.</p>'
  },
  {
    stepIndex: 3,
    label: 'Step 4 — Hvilken passer til dit liv?',
    email_subject: 'Hvilken passer til dit liv?',
    email_body:
      '<p>Hej {{first_name}},</p>' +
      '<p>Vi tilbyder fire forskellige formater \u2014 alle giver den samme Yoga Alliance RYT-200 certificering, men de passer til meget forskellige livssituationer.</p>' +
      '<p>\u{1F538} <strong><a href="https://yogabible.dk/200-hours-4-weeks-intensive-programs/" style="color:#f75c03;text-decoration:none;">4-ugers intensiv</a></strong> \u2014 Du tager fire uger ud af kalenderen og dykker helt ned. Perfekt hvis du vil have det overstået i \u00E9t str\u00E6k, eller hvis du har en pause mellem jobs, studier eller rejser.</p>' +
      '<p>\u{1F538} <strong><a href="https://yogabible.dk/200-hours-8-weeks-semi-intensive-programs/" style="color:#f75c03;text-decoration:none;">8-ugers semi-intensiv</a></strong> \u2014 Weekendformat. Du beholder dit job og din hverdag, og uddanner dig ved siden af. Godt hvis du vil have struktur uden at s\u00E6tte livet p\u00E5 pause.</p>' +
      '<p>\u{1F538} <strong><a href="https://yogabible.dk/200-hours-4-weeks-intensive-programs/" style="color:#f75c03;text-decoration:none;">4-ugers Vinyasa Plus</a></strong> \u2014 Vores internationale sommerhold, undervises p\u00E5 engelsk. Kombinerer 70% Vinyasa Flow med Yin og Hot Yoga. Perfekt hvis du vil opleve K\u00F8benhavn om sommeren og tr\u00E6ne i en international gruppe.</p>' +
      '<p>\u{1F538} <strong><a href="https://yogabible.dk/200-hours-18-weeks-flexible-programs/" style="color:#f75c03;text-decoration:none;">18-ugers fleksibel</a></strong> \u2014 Vores mest popul\u00E6re format. Hverdags- eller weekendhold, og du kan skifte mellem dem. 18 uger giver tid til at ford\u00F8je stoffet og integrere det i din praksis.</p>' +
      '<p>Der er ikke \u00E9t rigtigt svar. Det handler om hvad der passer til dit liv lige nu.</p>' +
      '<p>Skriv til mig med din situation, s\u00E5 hj\u00E6lper jeg dig med at finde det rigtige format.</p>',
    email_subject_en: 'Which one fits your life?',
    email_body_en:
      '<p>Hi {{first_name}},</p>' +
      '<p>We offer four different formats \u2014 all lead to the same Yoga Alliance RYT-200 certification, but they suit very different life situations.</p>' +
      '<p>\u{1F538} <strong><a href="https://yogabible.dk/200-hours-4-weeks-intensive-programs/" style="color:#f75c03;text-decoration:none;">4-week intensive</a></strong> \u2014 You take four weeks out of your calendar and dive all the way in. Perfect if you want it done in one stretch, or if you have a gap between jobs, studies or travels.</p>' +
      '<p>\u{1F538} <strong><a href="https://yogabible.dk/200-hours-8-weeks-semi-intensive-programs/" style="color:#f75c03;text-decoration:none;">8-week semi-intensive</a></strong> \u2014 Weekend format. You keep your job and your daily life, and train alongside it. Great if you want structure without putting life on pause.</p>' +
      '<p>\u{1F538} <strong><a href="https://yogabible.dk/200-hours-4-weeks-intensive-programs/" style="color:#f75c03;text-decoration:none;">4-week Vinyasa Plus</a></strong> \u2014 Our international summer cohort, taught in English. Combines 70% Vinyasa Flow with Yin and Hot Yoga. Perfect if you want to experience Copenhagen in summer and train in an international group.</p>' +
      '<p>\u{1F538} <strong><a href="https://yogabible.dk/200-hours-18-weeks-flexible-programs/" style="color:#f75c03;text-decoration:none;">18-week flexible</a></strong> \u2014 Our most popular format. Weekday or weekend track, and you can switch between them. 18 weeks gives you time to absorb the material and integrate it into your practice.</p>' +
      '<p>There\u2019s no single right answer. It\u2019s about what fits your life right now.</p>' +
      '<p>Write me with your situation and I\u2019ll help you find the right format.</p>'
  },
  {
    stepIndex: 4,
    label: 'Step 5 — Det smarteste f\u00F8rste skridt',
    email_subject: 'Det smarteste f\u00F8rste skridt',
    email_body:
      '<p>Hej {{first_name}},</p>' +
      '<p>De fleste af vores elever starter ikke med at tilmelde sig hele uddannelsen. De starter med Forberedelsesfasen.</p>' +
      '<p>Det er ret simpelt: du betaler 3.750 kr. og f\u00E5r adgang til yogaklasser i vores studio i Christianshavn. Du kommer n\u00E5r det passer dig, og du bygger din praksis op inden uddannelsen starter. Bel\u00F8bet tr\u00E6kkes fra den fulde pris \u2014 s\u00E5 du betaler ikke mere, du starter bare tidligere.</p>' +
      '<p>Det gode ved det er, at du m\u00E6rker studiet, m\u00F8der os, og finder ud af om det er det rigtige for dig \u2014 uden at binde dig til noget.</p>' +
      '<p>De fleste der starter Forberedelsesfasen ender med at forts\u00E6tte. Ikke fordi de skal, men fordi de vil.</p>' +
      '<p>\u{1F538} <a href="https://yogabible.dk/200-hours-4-weeks-intensive-programs/" style="color:#f75c03;text-decoration:none;font-weight:600;">4-ugers intensiv</a><br>' +
      '\u{1F538} <a href="https://yogabible.dk/200-hours-8-weeks-semi-intensive-programs/" style="color:#f75c03;text-decoration:none;font-weight:600;">8-ugers semi-intensiv</a><br>' +
      '\u{1F538} <a href="https://yogabible.dk/200-hours-4-weeks-intensive-programs/" style="color:#f75c03;text-decoration:none;font-weight:600;">4-ugers Vinyasa Plus</a><br>' +
      '\u{1F538} <a href="https://yogabible.dk/200-hours-18-weeks-flexible-programs/" style="color:#f75c03;text-decoration:none;font-weight:600;">18-ugers fleksibel</a></p>' +
      '<p>Skriv til mig hvis du har sp\u00F8rgsm\u00E5l om hvordan det fungerer.</p>',
    email_subject_en: 'The smartest first step',
    email_body_en:
      '<p>Hi {{first_name}},</p>' +
      '<p>Most of our students don\u2019t start by signing up for the full education. They start with the Preparation Phase.</p>' +
      '<p>It\u2019s quite simple: you pay 3,750 DKK and get access to yoga classes at our studio in Christianshavn. You come whenever it suits you and build your practice before the education starts. The amount is deducted from the full price \u2014 so you don\u2019t pay more, you just start earlier.</p>' +
      '<p>The beauty of it is that you get to feel the studio, meet us, and figure out if it\u2019s the right fit \u2014 without committing to anything.</p>' +
      '<p>Most people who start the Preparation Phase end up continuing. Not because they have to, but because they want to.</p>' +
      '<p>\u{1F538} <a href="https://yogabible.dk/200-hours-4-weeks-intensive-programs/" style="color:#f75c03;text-decoration:none;font-weight:600;">4-week intensive</a><br>' +
      '\u{1F538} <a href="https://yogabible.dk/200-hours-8-weeks-semi-intensive-programs/" style="color:#f75c03;text-decoration:none;font-weight:600;">8-week semi-intensive</a><br>' +
      '\u{1F538} <a href="https://yogabible.dk/200-hours-4-weeks-intensive-programs/" style="color:#f75c03;text-decoration:none;font-weight:600;">4-week Vinyasa Plus</a><br>' +
      '\u{1F538} <a href="https://yogabible.dk/200-hours-18-weeks-flexible-programs/" style="color:#f75c03;text-decoration:none;font-weight:600;">18-week flexible</a></p>' +
      '<p>Write me if you have questions about how it works.</p>'
  },
  {
    stepIndex: 5,
    label: 'Step 6 — Din plads venter',
    email_subject: 'Din plads venter',
    email_body:
      '<p>Hej {{first_name}},</p>' +
      '<p>Jeg har skrevet til dig et par gange nu, og jeg h\u00E5ber det har givet dig et billede af hvad vi laver her p\u00E5 Yoga Bible.</p>' +
      '<p>Hvis du stadig overvejer det \u2014 pladserne fylder op l\u00F8bende. Vi har maks 12\u201324 elever pr. hold, og n\u00E5r de er v\u00E6k, er de v\u00E6k.</p>' +
      '<p>Du beh\u00F8ver ikke have alle svarene. Du beh\u00F8ver ikke f\u00F8le dig klar. Du skal bare tage det f\u00F8rste skridt.</p>' +
      '<p>Start Forberedelsesfasen, m\u00E6rk studiet, og tag det derfra.</p>' +
      '<p>\u{1F538} <a href="https://yogabible.dk/200-hours-4-weeks-intensive-programs/" style="color:#f75c03;text-decoration:none;font-weight:600;">4-ugers intensiv</a><br>' +
      '\u{1F538} <a href="https://yogabible.dk/200-hours-8-weeks-semi-intensive-programs/" style="color:#f75c03;text-decoration:none;font-weight:600;">8-ugers semi-intensiv</a><br>' +
      '\u{1F538} <a href="https://yogabible.dk/200-hours-4-weeks-intensive-programs/" style="color:#f75c03;text-decoration:none;font-weight:600;">4-ugers Vinyasa Plus</a><br>' +
      '\u{1F538} <a href="https://yogabible.dk/200-hours-18-weeks-flexible-programs/" style="color:#f75c03;text-decoration:none;font-weight:600;">18-ugers fleksibel</a></p>' +
      '<p>Eller ring mig direkte p\u00E5 53 88 12 09 \u2014 jeg hj\u00E6lper dig gerne videre.</p>',
    email_subject_en: 'Your spot is waiting',
    email_body_en:
      '<p>Hi {{first_name}},</p>' +
      '<p>I\u2019ve written to you a few times now, and I hope it\u2019s given you a picture of what we do here at Yoga Bible.</p>' +
      '<p>If you\u2019re still considering it \u2014 spots fill up as we go. We take a maximum of 12\u201324 students per cohort, and once they\u2019re gone, they\u2019re gone.</p>' +
      '<p>You don\u2019t need to have all the answers. You don\u2019t need to feel ready. You just need to take the first step.</p>' +
      '<p>Start the Preparation Phase, feel the studio, and take it from there.</p>' +
      '<p>\u{1F538} <a href="https://yogabible.dk/200-hours-4-weeks-intensive-programs/" style="color:#f75c03;text-decoration:none;font-weight:600;">4-week intensive</a><br>' +
      '\u{1F538} <a href="https://yogabible.dk/200-hours-8-weeks-semi-intensive-programs/" style="color:#f75c03;text-decoration:none;font-weight:600;">8-week semi-intensive</a><br>' +
      '\u{1F538} <a href="https://yogabible.dk/200-hours-4-weeks-intensive-programs/" style="color:#f75c03;text-decoration:none;font-weight:600;">4-week Vinyasa Plus</a><br>' +
      '\u{1F538} <a href="https://yogabible.dk/200-hours-18-weeks-flexible-programs/" style="color:#f75c03;text-decoration:none;font-weight:600;">18-week flexible</a></p>' +
      '<p>Or call me directly at +45 53 88 12 09 \u2014 I\u2019m happy to help you move forward.</p>'
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
  var stepVerification = {};
  for (var v = 0; v < verifiedSteps.length; v++) {
    stepVerification['step_' + v] = {
      da_subject: verifiedSteps[v].email_subject || null,
      en_subject: verifiedSteps[v].email_subject_en || null,
      has_da_body: !!verifiedSteps[v].email_body,
      has_en_body: !!verifiedSteps[v].email_body_en
    };
  }
  results.verification = {
    total_steps: verifiedSteps.length,
    steps: stepVerification,
    all_steps_have_content: verifiedSteps.every(function (s) {
      return !!(s.email_subject && s.email_body && s.email_subject_en && s.email_body_en);
    })
  };

  return jsonResponse(200, { ok: true, results: results });
};
