/**
 * One-Time Deploy: Nurture Email Step Content
 *
 * POST /.netlify/functions/deploy-nurture-step
 * Auth: X-Internal-Secret header
 *
 * Updates sequence steps with authored email content.
 * Delete this function after use.
 */

const { getDb } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  // Auth via internal secret
  const secret = process.env.AI_INTERNAL_SECRET;
  if (!secret || event.headers['x-internal-secret'] !== secret) {
    return jsonResponse(401, { error: 'Unauthorized' });
  }

  const db = getDb();

  // ── April 4W Intensive — Conversion Push, Step 1 ──────────────────────────
  const SEQUENCE_ID = 'ZwvSVLsqRZcIv8C0IG0y';

  try {
    const docRef = db.collection('sequences').doc(SEQUENCE_ID);
    const snap = await docRef.get();

    if (!snap.exists) {
      return jsonResponse(404, { error: 'Sequence not found: ' + SEQUENCE_ID });
    }

    const data = snap.data();
    const steps = data.steps || [];

    if (steps.length === 0) {
      return jsonResponse(400, { error: 'Sequence has no steps' });
    }

    // Update step 0 with authored email content
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

      '<p style="margin:24px 0;"><a href="https://yogabible.dk/200-hours-4-weeks-intensive-programs?product=100121" style="display:inline-block;background:#f75c03;color:#ffffff;padding:14px 32px;text-decoration:none;border-radius:999px;font-weight:600;font-size:16px;">Start Forberedelsesfasen \u2192</a></p>' +

      '<p>Ring eller skriv hvis du har sp\u00f8rgsm\u00e5l \u2014 jeg svarer gerne.</p>';

    await docRef.update({
      steps,
      updated_at: new Date().toISOString()
    });

    return jsonResponse(200, {
      ok: true,
      message: 'Step 1 email content deployed for sequence ' + SEQUENCE_ID,
      subject: steps[0].email_subject,
      preview: steps[0].email_body.substring(0, 200) + '...'
    });

  } catch (err) {
    console.error('[deploy-nurture-step] Error:', err);
    return jsonResponse(500, { error: err.message });
  }
};
