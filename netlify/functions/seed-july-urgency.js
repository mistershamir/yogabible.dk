/**
 * Seed July Vinyasa Plus Urgency Sequence — Netlify Function
 *
 * GET  /.netlify/functions/seed-july-urgency?mode=preview
 *      → returns the sequence doc that would be written, plus the action
 *        (CREATE | UPDATE) and the matched existing doc id when one exists.
 * POST /.netlify/functions/seed-july-urgency?mode=apply
 *      → upserts the sequence doc. Idempotent. Match key is the `name`
 *        field; if a doc with that name exists it is updated, otherwise a
 *        new doc is created.
 *
 * Auth: X-Internal-Secret header must equal AI_INTERNAL_SECRET.
 *
 * Fast 4-step urgency sequence for July 4-week Vinyasa Plus leads
 * (cohort starts July 6, enrollment closes July 3). Replaces Personal
 * Outreach for these leads (see sequence-trigger.js) — Broadcast Nurture
 * still applies. Step 0 (welcome + schedule) is sent immediately by
 * sendImmediateScheduleEmail, so this sequence starts at the day-after
 * follow-up.
 *
 * Example:
 *   curl -H "x-internal-secret: $AI_INTERNAL_SECRET" \
 *     "https://yogabible.dk/.netlify/functions/seed-july-urgency?mode=preview"
 *   curl -X POST -H "x-internal-secret: $AI_INTERNAL_SECRET" \
 *     "https://yogabible.dk/.netlify/functions/seed-july-urgency?mode=apply"
 */

const admin = require('firebase-admin');
const { getDb } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');

const COL = 'sequences';
const NAME = 'July Vinyasa Plus — Urgency 2026';

// =========================================================================
// Sequence document — July Urgency
// =========================================================================
//
// Steps 1–3 are content_type: 'dynamic' so the processor resolves the open
// July cohort per-lead at send-time and substitutes {{schedule_url}} (which
// injectScheduleTokens then tokenises per-lead). Once the cohort's
// enrollment_closes passes, dynamic steps stop sending automatically.
// Step 4 is static — it redirects to the autumn programs instead.
//
// Content rules (CLAUDE.md):
//   - Never mention the language of instruction.
//   - Never mention group size.
//   - Never mention refunds.
//   - Plain <p> tags only; orange inline links (#f75c03).
//   - The standard signature + unsubscribe footer is auto-appended.
// =========================================================================

const SEQUENCE_DOC = {
  name: NAME,
  description: 'Fast 7-day urgency sequence for July 4-week Vinyasa Plus leads. Replaces Personal Outreach for 4-week-jul leads (Broadcast Nurture still runs). Welcome + schedule is sent immediately on signup, so Step 1 here is the day-after follow-up.',
  active: true,
  trigger: {
    type: 'new_lead',
    // matchesTriggerConditions uses .includes() for ytt_program_type, so
    // multi-format leads ("4-week-jun,4-week-jul") enroll too.
    conditions: { ytt_program_type: '4-week-jul' }
  },
  enrollment_closes: '2026-07-03',
  exit_conditions: [
    'Converted',
    'Existing Applicant',
    'Unsubscribed',
    'Lost',
    'Closed',
    'Archived',
    'Not too keen'
  ],
  skip_throttle: false,
  steps: [
    // ---- Step 1 (day 1): Did you see the schedule? -------------------------
    {
      channel: 'email',
      delay_minutes: 1440, // 1 day after enrollment
      content_type: 'dynamic',
      condition: null,
      email_subject: 'Fik du set skemaet?',
      email_body:
        '<p>Hej {{first_name}},</p>' +
        '<p>Jeg ville lige høre om du nåede at kigge på skemaet for juli-holdet?</p>' +
        '<p><a href="{{schedule_url}}" style="color:#f75c03;">Se skemaet her</a></p>' +
        '<p>Hvis du har spørgsmål eller vil høre mere, kan du booke et gratis møde — enten på studiet eller over telefon.</p>' +
        '<p><a href="https://yogabible.dk/200-hours-4-weeks-intensive-programs/?booking=consultation" style="color:#f75c03;">Book et møde</a></p>',
      email_subject_en: 'Did you see the schedule?',
      email_body_en:
        '<p>Hi {{first_name}},</p>' +
        '<p>Just checking — did you get a chance to look at the schedule for the July cohort?</p>' +
        '<p><a href="{{schedule_url}}" style="color:#f75c03;">See the schedule here</a></p>' +
        '<p>If you have questions or want to learn more, you can book a free meeting — at the studio or over the phone.</p>' +
        '<p><a href="https://yogabible.dk/en/200-hours-4-weeks-intensive-programs/?booking=consultation" style="color:#f75c03;">Book a meeting</a></p>'
    },

    // ---- Step 2 (day 3): Have you had a chance? -----------------------------
    {
      channel: 'email',
      delay_minutes: 2880, // 2 days after Step 1
      content_type: 'dynamic',
      condition: null,
      email_subject: 'Har du haft tid til at kigge?',
      email_body:
        '<p>Hej {{first_name}},</p>' +
        '<p>Jeg skriver kort igen — vi er ved at lukke tilmeldingen til juli-holdet og vil gerne vide om du stadig overvejer det.</p>' +
        '<p>Et kort ja eller nej er helt fint.</p>' +
        '<p><a href="{{schedule_url}}" style="color:#f75c03;">Se skemaet</a></p>',
      email_subject_en: 'Have you had a chance to look?',
      email_body_en:
        '<p>Hi {{first_name}},</p>' +
        '<p>Quick follow-up — we\'re closing registration for the July cohort soon and would love to know if you\'re still considering it.</p>' +
        '<p>A simple yes or no is completely fine.</p>' +
        '<p><a href="{{schedule_url}}" style="color:#f75c03;">See the schedule</a></p>'
    },

    // ---- Step 3 (day 5): Last chance ----------------------------------------
    {
      channel: 'email',
      delay_minutes: 2880, // 2 days after Step 2
      content_type: 'dynamic',
      condition: null,
      email_subject: 'Sidste chance — juli-holdet',
      email_body:
        '<p>Hej {{first_name}},</p>' +
        '<p>Tilmeldingen til vores 4-ugers Vinyasa Plus i juli lukker om få dage. Hvis du er klar, er det nu.</p>' +
        '<p><a href="{{schedule_url}}" style="color:#f75c03;">Se skemaet</a></p>' +
        '<p><a href="https://yogabible.dk/200-hours-4-weeks-intensive-programs/" style="color:#f75c03;">Læs mere om programmet</a></p>' +
        '<p><a href="https://yogabible.dk/200-hours-4-weeks-intensive-programs/?booking=consultation" style="color:#f75c03;">Book et møde</a></p>',
      email_subject_en: 'Last chance — July cohort',
      email_body_en:
        '<p>Hi {{first_name}},</p>' +
        '<p>Registration for our 4-week Vinyasa Plus in July closes in a few days. If you\'re ready, now is the time.</p>' +
        '<p><a href="{{schedule_url}}" style="color:#f75c03;">See the schedule</a></p>' +
        '<p><a href="https://yogabible.dk/en/200-hours-4-weeks-intensive-programs/" style="color:#f75c03;">Read more about the program</a></p>' +
        '<p><a href="https://yogabible.dk/en/200-hours-4-weeks-intensive-programs/?booking=consultation" style="color:#f75c03;">Book a meeting</a></p>'
    },

    // ---- Step 4 (day 7): Redirect to autumn programs (static) ---------------
    {
      channel: 'email',
      delay_minutes: 2880, // 2 days after Step 3
      condition: null,
      email_subject: 'Vi håber at se dig en anden gang',
      email_body:
        '<p>Hej {{first_name}},</p>' +
        '<p>Det ser ud til at juli-holdet ikke passer dig lige nu — det er helt okay.</p>' +
        '<p>Vi har to andre hold resten af året som måske passer bedre:</p>' +
        '<p><a href="https://yogabible.dk/200-hours-18-weeks-flexible-programs/" style="color:#f75c03;">18-ugers Fleksible Program (August–December 2026)</a> — hverdags- eller weekendhold, vores mest populære format.</p>' +
        '<p><a href="https://yogabible.dk/200-hours-8-weeks-semi-intensive-programs/" style="color:#f75c03;">8-ugers Semi-Intensivt Program (Oktober–November 2026)</a> — weekendformat, ved siden af dit job.</p>' +
        '<p>Du er altid velkommen til at skrive eller ringe.</p>',
      email_subject_en: 'We hope to see you another time',
      email_body_en:
        '<p>Hi {{first_name}},</p>' +
        '<p>It looks like the July cohort isn\'t the right fit for you right now — that\'s completely fine.</p>' +
        '<p>We have two other cohorts later this year that might work better:</p>' +
        '<p><a href="https://yogabible.dk/en/200-hours-18-weeks-flexible-programs/" style="color:#f75c03;">18-Week Flexible Program (August–December 2026)</a> — weekday or weekend track, our most popular format.</p>' +
        '<p><a href="https://yogabible.dk/en/200-hours-8-weeks-semi-intensive-programs/" style="color:#f75c03;">8-Week Semi-Intensive Program (October–November 2026)</a> — weekend format, alongside your job.</p>' +
        '<p>You\'re always welcome to write or call.</p>'
    }
  ]
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  const secret = process.env.AI_INTERNAL_SECRET;
  const provided = (event.headers['x-internal-secret'] || event.headers['X-Internal-Secret'] || '').trim();
  if (!secret || provided !== secret) {
    return jsonResponse(401, { error: 'Unauthorized' });
  }

  const params = event.queryStringParameters || {};
  const mode = (params.mode || 'preview').toLowerCase();
  const isApply = mode === 'apply';

  if (isApply && event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'mode=apply requires POST' });
  }

  const db = getDb();

  // Match by name. If multiple docs share the name (shouldn't happen but
  // be defensive), pick the most recently created.
  const matchSnap = await db.collection(COL).where('name', '==', NAME).get();
  let existingId = null;
  if (!matchSnap.empty) {
    let mostRecent = null;
    matchSnap.forEach((d) => {
      const data = d.data();
      const createdAt = data.created_at && data.created_at.toDate ? data.created_at.toDate() : (data.created_at ? new Date(data.created_at) : new Date(0));
      if (!mostRecent || createdAt > mostRecent.createdAt) {
        mostRecent = { id: d.id, createdAt };
      }
    });
    existingId = mostRecent ? mostRecent.id : null;
  }

  const action = existingId ? 'UPDATE' : 'CREATE';
  const stepSummary = SEQUENCE_DOC.steps.map((s, idx) => ({
    step: idx + 1,
    delay_minutes: s.delay_minutes,
    delay_human: humanizeDelay(s.delay_minutes),
    content_type: s.content_type || 'static',
    subject_da: s.email_subject,
    subject_en: s.email_subject_en
  }));

  if (!isApply) {
    return jsonResponse(200, {
      ok: true,
      mode: 'preview',
      action,
      existing_id: existingId,
      collection: COL,
      sequence_name: NAME,
      step_count: SEQUENCE_DOC.steps.length,
      steps: stepSummary,
      doc: SEQUENCE_DOC
    });
  }

  // Apply
  const ref = existingId ? db.collection(COL).doc(existingId) : db.collection(COL).doc();
  const payload = Object.assign({}, SEQUENCE_DOC, {
    updated_at: admin.firestore.FieldValue.serverTimestamp()
  });
  if (!existingId) {
    payload.created_at = admin.firestore.FieldValue.serverTimestamp();
  }
  await ref.set(payload, { merge: true });

  return jsonResponse(200, {
    ok: true,
    mode: 'apply',
    action,
    sequence_id: ref.id,
    sequence_name: NAME,
    step_count: SEQUENCE_DOC.steps.length,
    steps: stepSummary
  });
};

function humanizeDelay(minutes) {
  if (!minutes) return '0';
  if (minutes < 60) return minutes + ' min';
  if (minutes < 1440) return (minutes / 60).toFixed(1).replace(/\.0$/, '') + ' h';
  return (minutes / 1440).toFixed(1).replace(/\.0$/, '') + ' d';
}
