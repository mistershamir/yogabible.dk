/**
 * One-Time Deploy: Update nurture sequences
 *
 * POST /.netlify/functions/deploy-nurture-step
 * Auth: X-Internal-Secret header
 *
 * Task 1: Update exit_conditions on all 5 nurture sequences.
 * Task 2: Push email content to April 4W step 1.
 *
 * Delete this function after use.
 */

const { getDb } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');

const EXIT_CONDITIONS = [
  'Converted',
  'Existing Applicant',
  'On Hold',
  'Interested In Next Round',
  'Not too keen',
  'Unsubscribed',
  'Lost',
  'Closed',
  'Archived'
];

const SEQUENCE_NAMES = [
  'YTT Onboarding — 2026',
  'April 4W Intensive — Conversion Push',
  'July Vinyasa Plus — International Nurture',
  '8W Semi-Intensive May–Jun — DK Nurture',
  '18W Flexible Aug–Dec — DK Nurture'
];

const APRIL_4W_ID = 'ZwvSVLsqRZcIv8C0IG0y';

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  const secret = process.env.AI_INTERNAL_SECRET;
  if (!secret || event.headers['x-internal-secret'] !== secret) {
    return jsonResponse(401, { error: 'Unauthorized' });
  }

  const db = getDb();
  const results = { exit_conditions: [], email_step: null };

  // ── Task 1: Update exit_conditions on all 5 sequences ────────────────────

  try {
    const snap = await db.collection('sequences').get();
    const allDocs = [];
    snap.forEach(function (doc) { allDocs.push({ id: doc.id, data: doc.data() }); });

    for (var i = 0; i < SEQUENCE_NAMES.length; i++) {
      var name = SEQUENCE_NAMES[i];
      var found = allDocs.find(function (d) { return d.data.name === name; });

      if (!found) {
        results.exit_conditions.push({ name: name, status: 'not_found' });
        continue;
      }

      await db.collection('sequences').doc(found.id).update({
        exit_conditions: EXIT_CONDITIONS,
        updated_at: new Date().toISOString()
      });

      results.exit_conditions.push({ name: name, id: found.id, status: 'updated' });
    }
  } catch (err) {
    return jsonResponse(500, { error: 'Task 1 failed: ' + err.message });
  }

  // ── Task 2: Push April 4W step 1 email content ───────────────────────────

  try {
    var docRef = db.collection('sequences').doc(APRIL_4W_ID);
    var docSnap = await docRef.get();

    if (!docSnap.exists) {
      results.email_step = { status: 'not_found', id: APRIL_4W_ID };
    } else {
      var data = docSnap.data();
      var steps = data.steps || [];

      if (steps.length === 0) {
        results.email_step = { status: 'no_steps', id: APRIL_4W_ID };
      } else {
        steps[0].email_subject = 'Hej {{first_name}} \u2014 stadig interesseret?';

        steps[0].email_body =
          '<p>Hej {{first_name}},</p>' +
          '<p>Du kiggede p\u00e5 vores 4-ugers yogal\u00e6reruddannelse for et stykke tid siden, og jeg ville lige f\u00f8lge op.</p>' +
          '<p>April-holdet starter om 3 uger, og vi har kun f\u00e5 pladser tilbage. Maks 12 elever \u2014 og vi er t\u00e6t p\u00e5.</p>' +
          '<p>Kort om uddannelsen:<br>' +
          '4 ugers fuldtids-intensiv i vores studio i Christianshavn<br>' +
          'Yoga Alliance RYT-200 certificering<br>' +
          'The Triangle Method \u2014 Hatha, Vinyasa, Yin + Hot Yoga + Meditation<br>' +
          'Maks 12 elever pr. hold</p>' +
          '<p>Hvis du stadig overvejer det, kan du starte med <strong>Forberedelsesfasen</strong> \u2014 3.750 kr., som giver dig 30 yogaklasser i studiet med det samme. Bel\u00f8bet tr\u00e6kkes fra den fulde pris, og du f\u00e5r fuld refusion hvis du ombestemmer dig.</p>' +
          '<p style="margin:24px 0;"><a href="https://yogabible.dk/200-hours-4-weeks-intensive-programs?product=100078" style="display:inline-block;background:#f75c03;color:#ffffff;padding:14px 32px;text-decoration:none;border-radius:999px;font-weight:600;font-size:16px;">Start Forberedelsesfasen \u2192</a></p>' +
          '<p>Ring eller skriv hvis du har sp\u00f8rgsm\u00e5l \u2014 jeg svarer gerne.</p>';

        await docRef.update({
          steps: steps,
          updated_at: new Date().toISOString()
        });

        results.email_step = {
          status: 'updated',
          id: APRIL_4W_ID,
          subject: steps[0].email_subject,
          body_preview: steps[0].email_body.substring(0, 120) + '...'
        };
      }
    }
  } catch (err) {
    return jsonResponse(500, { error: 'Task 2 failed: ' + err.message });
  }

  return jsonResponse(200, { ok: true, results: results });
};
