/**
 * Patch July DK Step 0 Body — One-time Firestore update
 *
 * Updates the email_body (DA) field on step 0 of the July Vinyasa Plus
 * DK sequence (Yoq6RCVqTYlF10OPmkSw) with proper Danish content.
 *
 * POST /.netlify/functions/patch-july-dk-body
 * POST /.netlify/functions/patch-july-dk-body?dry_run=true
 *
 * Protected by X-Internal-Secret header.
 */

const { getDb, serverTimestamp } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');

const JULY_DK_SEQUENCE_ID = 'Yoq6RCVqTYlF10OPmkSw';

const DA_BODY_STEP_0 = `<p>Hej {{first_name}},</p>

<p>Jeg ville lige skrive til dig, fordi du har vist interesse for vores juli-uddannelse — og fordi jeg synes, du fortjener at vide, hvad det faktisk er, du overvejer.</p>

<p>I juli åbner vi dørene for <strong>Vinyasa Plus</strong> — vores 4-ugers intensive yogalæreruddannelse her i Christianshavn. Studiet ligger ved kanalerne, og juli i København er ærligt talt ret magisk. Lange aftener, vand overalt, og en by der lever udendørs.</p>

<p>Men det er ikke bare en fed location. Det er et seriøst program:</p>

<p>🔸 <strong>Vinyasa Plus-metoden</strong> — 70% Vinyasa Flow + 30% Yin og Hot Yoga. Du bliver ikke bare god til ét stilart. Du får en bredde, de fleste nyuddannede ikke har.<br>
🔸 <strong>RYT-200 certificering</strong> via Yoga Alliance — internationalt anerkendt, gyldig overalt.<br>
🔸 <strong>Triangle Method™</strong> — vores egen undervisningsmetode, der giver dig struktur fra dag ét. Du behøver ikke opfinde alt selv.<br>
🔸 <strong>Max 18 studerende</strong> — det er bevidst. Du skal ikke forsvinde i mængden.</p>

<p>Fuld pris: <strong>23.750 kr.</strong></p>

<p>Du starter med <strong>Forberedelsesfasen</strong> — den koster <strong>3.750 kr.</strong> og trækkes fra den fulde pris. Så snart du er tilmeldt, får du adgang til online forberedelsesmateriale, så du er klar, når juli starter.</p>

<p>Vi har også en boligpartner, der hjælper internationale studerende med at finde et sted at bo i København — men det gælder selvfølgelig også, hvis du kommer fra en anden del af Danmark.</p>

<p>Hvis det her taler til dig, kan du <a href="https://yogabible.dk/200-hours-4-weeks-intensive-programs?product=100211" style="color:#f75c03;text-decoration:underline;font-weight:600;">starte din Forberedelsesfase her</a>.</p>

<p>Og hvis du har spørgsmål — om programmet, om København, om noget som helst — så skriv endelig. Jeg svarer personligt.</p>`;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { ok: false, error: 'POST only' });
  }

  const secret = event.headers['x-internal-secret'] || event.headers['X-Internal-Secret'] || '';
  if (!secret || secret !== process.env.AI_INTERNAL_SECRET) {
    return jsonResponse(401, { ok: false, error: 'Unauthorized' });
  }

  const params = event.queryStringParameters || {};
  const dryRun = params.dry_run === 'true';
  const db = getDb();

  try {
    const seqDoc = await db.collection('sequences').doc(JULY_DK_SEQUENCE_ID).get();
    if (!seqDoc.exists) {
      return jsonResponse(404, { ok: false, error: 'July DK sequence not found' });
    }

    const data = seqDoc.data();
    const steps = data.steps || [];

    if (steps.length === 0) {
      return jsonResponse(400, { ok: false, error: 'Sequence has no steps' });
    }

    const oldSubject = steps[0].email_subject || '';
    const oldBodyPreview = (steps[0].email_body || '').substring(0, 80);
    const oldBodyEnPreview = (steps[0].email_body_en || '').substring(0, 80);

    // Update step 0 with Danish body
    steps[0].email_subject = 'Din sommer i København';
    steps[0].email_body = DA_BODY_STEP_0;

    if (!dryRun) {
      await db.collection('sequences').doc(JULY_DK_SEQUENCE_ID).update({
        steps: steps,
        updated_at: serverTimestamp()
      });
    }

    return jsonResponse(200, {
      ok: true,
      dry_run: dryRun,
      step_0: {
        old_subject: oldSubject,
        new_subject: 'Din sommer i København',
        old_body_preview: oldBodyPreview,
        new_body_preview: DA_BODY_STEP_0.substring(0, 80),
        en_body_preview: oldBodyEnPreview,
        body_updated: !dryRun
      }
    });
  } catch (err) {
    console.error('[patch-july-dk] Error:', err);
    return jsonResponse(500, { ok: false, error: err.message });
  }
};
