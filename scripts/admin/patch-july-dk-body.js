/**
 * Patch July DK Step 0 Body — Firestore update
 *
 * Updates BOTH email_body (DA) and email_body_en (EN) on step 0 of the
 * July Vinyasa Plus DK sequence (Yoq6RCVqTYlF10OPmkSw).
 *
 * The previous content incorrectly referenced "Triangle Method" and "Hatha"
 * — the July program uses the Vinyasa Plus method (70% Vinyasa + 30% Yin & Hot Yoga).
 *
 * POST /.netlify/functions/patch-july-dk-body
 * POST /.netlify/functions/patch-july-dk-body?dry_run=true
 *
 * Protected by X-Internal-Secret header.
 */

const { getDb, serverTimestamp } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');

const JULY_DK_SEQUENCE_ID = 'Yoq6RCVqTYlF10OPmkSw';

// ── Danish body (unprefixed field — served to DK leads) ─────────────────────

const DA_BODY = `<p>Hej {{first_name}},</p>

<p>Tak fordi du har vist interesse for vores juli-uddannelse. Jeg ville gerne fortælle dig lidt mere om, hvad det egentlig er.</p>

<p>I juli kører vi <strong>4-ugers Vinyasa Plus</strong> — en intensiv yogalæreruddannelse fra vores studie ved kanalerne i København. Fire uger, fuld tid, og du kommer ud med en <strong>Yoga Alliance RYT-200 certificering</strong>.</p>

<p>Vinyasa Plus er vores egen metode. Den er bygget op omkring tre ben:</p>

<p>🔸 <strong>70% Vinyasa Flow</strong> — dynamisk, kreativ sekventering. Det er kernen i uddannelsen.<br>
🔸 <strong>30% Yin og Hot Yoga</strong> — du lærer at undervise i de langsomme, dybe former også. Plus infraød hot yoga i vores varmestue.<br>
🔸 <strong>Meditation og Vibro Yoga</strong> — vibroakustisk yoga er noget, næsten ingen andre uddannelser tilbyder. Det bliver en del af din værktøjskasse.</p>

<p>Det giver dig en bredde, som de fleste nyuddannede yogalærere ikke har. Du kan undervise i flere stilarter fra dag ét.</p>

<p>Fuld pris: <strong>23.750 kr.</strong></p>

<p>Du starter med <strong>Forberedelsesfasen</strong> — den koster <strong>3.750 kr.</strong> og trækkes fra den fulde pris. Du får adgang til online forberedelsesmateriale med det samme, så du er klar, når uddannelsen begynder.</p>

<p>Har du brug for et sted at bo i København? Vi samarbejder med en lokal boligpartner, der hjælper vores studerende med at finde noget.</p>

<p>👉 <a href="https://yogabible.dk/200-hours-4-weeks-intensive-programs?product=100211" style="color:#f75c03;text-decoration:underline;font-weight:600;">Start din Forberedelsesfase her</a></p>

<p>Skriv endelig, hvis du har spørgsmål. Jeg svarer selv.</p>`;

// ── English body (_en field — served to international leads) ────────────────

const EN_BODY = `<p>Hi {{first_name}},</p>

<p>Thanks for your interest in our July programme. I wanted to tell you a bit more about what we've built.</p>

<p>This July we're running <strong>4-Week Vinyasa Plus</strong> — an intensive yoga teacher training from our studio by the canals in Copenhagen. Four weeks, full-time, and you leave with a <strong>Yoga Alliance RYT-200 certification</strong>.</p>

<p>Vinyasa Plus is our own method, built on three pillars:</p>

<p>🔸 <strong>70% Vinyasa Flow</strong> — dynamic, creative sequencing. This is the core of the training.<br>
🔸 <strong>30% Yin &amp; Hot Yoga</strong> — you'll learn to teach the slow, deep practices too. Including infrared hot yoga in our heated studio.<br>
🔸 <strong>Meditation &amp; Vibro Yoga</strong> — vibroacoustic yoga is something almost no other training offers. It becomes part of your teaching toolkit.</p>

<p>That gives you a range most newly certified teachers simply don't have. You'll be able to teach multiple styles from day one.</p>

<p>And then there's Copenhagen in July. Long evenings by the harbour, the lakes, the canals. It's a pretty good place to spend a month becoming a yoga teacher.</p>

<p>Full price: <strong>23,750 DKK.</strong></p>

<p>You start with the <strong>Preparation Phase</strong> — that's <strong>3,750 DKK</strong>, deducted from the full price. You'll get access to online preparation material straight away, so you're ready when the training begins.</p>

<p>Need a place to stay? We work with a local housing partner who helps our students find accommodation in Copenhagen.</p>

<p>👉 <a href="https://yogabible.dk/en/200-hours-4-weeks-intensive-programs?product=100211" style="color:#f75c03;text-decoration:underline;font-weight:600;">Start your Preparation Phase here</a></p>

<p>If you have questions — about the programme, about Copenhagen, about anything — just write back. I reply personally.</p>`;

// ── Handler ─────────────────────────────────────────────────────────────────

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

    const oldSubjectDa = steps[0].email_subject || '';
    const oldBodyDaPreview = (steps[0].email_body || '').substring(0, 100);
    const oldSubjectEn = steps[0].email_subject_en || '';
    const oldBodyEnPreview = (steps[0].email_body_en || '').substring(0, 100);

    // Update step 0 with corrected content
    steps[0].email_subject = 'Din sommer i København';
    steps[0].email_body = DA_BODY;
    steps[0].email_subject_en = 'Your summer in Copenhagen';
    steps[0].email_body_en = EN_BODY;

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
        da: {
          old_subject: oldSubjectDa,
          new_subject: 'Din sommer i København',
          old_body_preview: oldBodyDaPreview,
          new_body_preview: DA_BODY.substring(0, 100)
        },
        en: {
          old_subject: oldSubjectEn,
          new_subject: 'Your summer in Copenhagen',
          old_body_preview: oldBodyEnPreview,
          new_body_preview: EN_BODY.substring(0, 100)
        }
      }
    });
  } catch (err) {
    console.error('[patch-july-dk] Error:', err);
    return jsonResponse(500, { ok: false, error: err.message });
  }
};
