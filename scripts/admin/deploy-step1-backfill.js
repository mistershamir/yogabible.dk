/**
 * Deploy Step 1 Backfill — Add English to Program Sequence Step 0
 *
 * POST /.netlify/functions/deploy-step1-backfill
 * Auth: X-Internal-Secret header
 *
 * Backfills email_subject_en / email_body_en on steps[0] for the 4
 * program-specific sequences that were deployed before language branching.
 *
 * For the July Vinyasa Plus sequence (already in English), it also adds
 * a Danish version to the default fields and copies the English to _en fields.
 */

const { getDb } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');

// ── Step 0 backfill content ─────────────────────────────────────────────────

var BACKFILL = [
  // ── 1. April 4W Intensive — add EN ──────────────────────────────────────
  {
    id: 'ZwvSVLsqRZcIv8C0IG0y',
    name: 'April 4W Intensive — Conversion Push',
    stepIndex: 0,
    email_subject_en: 'Hi {{first_name}} \u2014 still interested?',
    email_body_en:
      '<p>Hi {{first_name}},</p>' +
      '<p>I just wanted to write you personally.</p>' +
      '<p>The April cohort starts in 3 weeks, and we only have a few spots left. Max 12 students \u2014 and we\u2019re close.</p>' +
      '<p>About the program:<br>' +
      '4-week full-time intensive at our studio in Christianshavn<br>' +
      'Yoga Alliance RYT-200 certification<br>' +
      'The Triangle Method \u2014 Hatha, Vinyasa, Yin + Hot Yoga + Meditation<br>' +
      'Max 12 students per cohort</p>' +
      '<p>You can start with the <strong>Preparation Phase</strong> \u2014 3,750 DKK, which gives you 30 yoga classes at the studio right away. The amount is deducted from the full price.</p>' +
      '<p style="margin:24px 0;"><a href="https://yogabible.dk/200-hours-4-weeks-intensive-programs?product=100121" style="display:inline-block;background:#f75c03;color:#ffffff;padding:14px 32px;text-decoration:none;border-radius:999px;font-weight:600;font-size:16px;">Start the Preparation Phase \u2192</a></p>' +
      '<p>Call or write if you have any questions \u2014 happy to help.</p>'
  },

  // ── 2. 18W Flexible Aug\u2013Dec — add EN ──────────────────────────────────
  {
    id: 'ab2dSOrmaQnneUyRojCf',
    name: '18W Flexible Aug\u2013Dec \u2014 DK Nurture',
    stepIndex: 0,
    email_subject_en: 'The March cohort is sold out',
    email_body_en:
      '<p>Hi {{first_name}},</p>' +
      '<p>Quick update: Our 18-week March\u2013June cohort is officially <strong>sold out</strong>. It went faster than we expected.</p>' +
      '<p>The good news \u2014 the August\u2013December cohort is now open. Same format, same Yoga Alliance RYT-200 certification, same Triangle Method.</p>' +
      '<p>What makes the 18-week format unique:<br>' +
      'Train alongside your daily life \u2014 no need to quit your job<br>' +
      'Weekday OR weekend track (you can switch between them)<br>' +
      'Hatha, Vinyasa, Yin + Hot Yoga + Meditation<br>' +
      'Max 24 students across both tracks</p>' +
      '<p>You can start with the <strong>Preparation Phase</strong> \u2014 3,750 DKK, which gives you 30 yoga classes right away. The amount is deducted from the full price.</p>' +
      '<p style="margin:24px 0;"><a href="https://yogabible.dk/200-hours-18-weeks-flexible-programs?product=100210" style="display:inline-block;background:#f75c03;color:#ffffff;padding:14px 32px;text-decoration:none;border-radius:999px;font-weight:600;font-size:16px;">Start the Preparation Phase \u2192</a></p>' +
      '<p>Write or call if you have any questions \u2014 happy to help.</p>'
  },

  // ── 3. 8W Semi-Intensive May\u2013Jun — add EN ────────────────────────────
  {
    id: 'uDST1Haj1dMyQy0Qifhu',
    name: '8W Semi-Intensive May\u2013Jun \u2014 DK Nurture',
    stepIndex: 0,
    email_subject_en: 'Same certification, half the time',
    email_body_en:
      '<p>Hi {{first_name}},</p>' +
      '<p>Thanks for your interest in our 8-week yoga teacher education.</p>' +
      '<p>The cohort starts in May and runs over 8 weekends through June. Full Yoga Alliance RYT-200 \u2014 the same certification as our intensive formats, just spread out so you can fit it around your job.</p>' +
      '<p>About the format:<br>' +
      '8 weekends at our studio in Christianshavn<br>' +
      'Yoga Alliance RYT-200 certification<br>' +
      'The Triangle Method \u2014 Hatha, Vinyasa, Yin + Hot Yoga + Meditation<br>' +
      'Max 12 students</p>' +
      '<p>You can start with the <strong>Preparation Phase</strong> \u2014 3,750 DKK, which gives you 30 yoga classes right away. The amount is deducted from the full price.</p>' +
      '<p style="margin:24px 0;"><a href="https://yogabible.dk/200-hours-8-weeks-semi-intensive-programs?product=100209" style="display:inline-block;background:#f75c03;color:#ffffff;padding:14px 32px;text-decoration:none;border-radius:999px;font-weight:600;font-size:16px;">Start the Preparation Phase \u2192</a></p>' +
      '<p>Write or call if you have any questions.</p>'
  },

  // ── 4. July Vinyasa Plus — add DA + copy EN to _en fields ─────────────
  {
    id: 'Yoq6RCVqTYlF10OPmkSw',
    name: 'July Vinyasa Plus \u2014 International Nurture',
    stepIndex: 0,
    // Overwrite default fields with Danish
    email_subject: 'Din sommer i K\u00F8benhavn',
    email_body:
      '<p>Hej {{first_name}},</p>' +
      '<p>Jeg ville lige r\u00E6kke ud \u2014 hvis du har overvejet at kombinere yogal\u00E6reruddannelse med en sommer i udlandet, er K\u00F8benhavn i juli sv\u00E6r at sl\u00E5.</p>' +
      '<p>Lange lyse aftener, havnebade, kanaler, cykler overalt \u2014 det er en af verdens sikreste og mest livlige byer. Og vores studio ligger i Christianshavn, midt i det hele.</p>' +
      '<p>Programmet:<br>' +
      '4-ugers Vinyasa Plus \u2014 70 % Vinyasa Flow, 30 % Yin & Hot Yoga<br>' +
      'Yoga Alliance RYT-200 certificering<br>' +
      'The Triangle Method \u2014 Hatha, Vinyasa, Yin + Hot Yoga + Meditation<br>' +
      'Maks 18 elever</p>' +
      '<p>Vi samarbejder ogs\u00E5 med en lokal partner, der kan hj\u00E6lpe dig med at finde bolig t\u00E6t p\u00E5 studiet \u2014 s\u00E5 du ikke selv skal st\u00E5 for det.</p>' +
      '<p>Du kan starte med <strong>Forberedelsesfasen</strong> \u2014 3.750 kr. for 30 yogaklasser i studiet. Bel\u00F8bet tr\u00E6kkes fra den fulde pris.</p>' +
      '<p style="margin:24px 0;"><a href="https://yogabible.dk/200-hours-4-weeks-intensive-programs?product=100211" style="display:inline-block;background:#f75c03;color:#ffffff;padding:14px 32px;text-decoration:none;border-radius:999px;font-weight:600;font-size:16px;">Start Forberedelsesfasen \u2192</a></p>' +
      '<p>Svar p\u00E5 denne mail eller ring, hvis du har sp\u00F8rgsm\u00E5l.</p>',
    // Copy existing English to _en fields
    email_subject_en: 'Your summer in Copenhagen',
    email_body_en:
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

// ── Handler ─────────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  var secret = process.env.AI_INTERNAL_SECRET;
  if (!secret || event.headers['x-internal-secret'] !== secret) {
    return jsonResponse(401, { error: 'Unauthorized' });
  }

  var db = getDb();
  var results = [];

  for (var i = 0; i < BACKFILL.length; i++) {
    var update = BACKFILL[i];
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

      var step = steps[update.stepIndex];

      // Add EN fields
      step.email_subject_en = update.email_subject_en;
      step.email_body_en = update.email_body_en;

      // Overwrite DA fields only if provided (July Vinyasa Plus)
      if (update.email_subject) step.email_subject = update.email_subject;
      if (update.email_body) step.email_body = update.email_body;

      await docRef.update({ steps: steps, updated_at: new Date().toISOString() });

      // Verify
      var verified = await docRef.get();
      var vStep = verified.data().steps[update.stepIndex];

      results.push({
        name: update.name,
        id: update.id,
        status: 'updated',
        da_subject: vStep.email_subject,
        en_subject: vStep.email_subject_en,
        has_da_body: !!vStep.email_body,
        has_en_body: !!vStep.email_body_en
      });
    } catch (err) {
      results.push({ name: update.name, id: update.id, status: 'error', error: err.message });
    }
  }

  return jsonResponse(200, { ok: true, results: results });
};
