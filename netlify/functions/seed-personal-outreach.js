/**
 * Seed Personal Outreach Sequence — Netlify Function
 *
 * GET  /.netlify/functions/seed-personal-outreach?mode=preview
 *      → returns the sequence doc that would be written, plus the action
 *        (CREATE | UPDATE) and the matched existing doc id when one exists.
 * POST /.netlify/functions/seed-personal-outreach?mode=apply
 *      → upserts the sequence doc. Idempotent. Match key is the `name`
 *        field; if a doc with that name exists it is updated, otherwise a
 *        new doc is created.
 *
 * Auth: X-Internal-Secret header must equal AI_INTERNAL_SECRET.
 *
 * Pre-requisites:
 *   - PR 1 deployed (cohort-resolver, dynamic_email + schedule_view_aware
 *     handling in sequences.js).
 *   - cohort_registry seeded (4 docs).
 *
 * After this seeds, new YTT leads auto-enroll because the sequence-trigger
 * matcher already picks up any active sequence whose trigger conditions
 * match the lead. No code change needed in trigger.js for activation.
 *
 * Example:
 *   curl -H "x-internal-secret: $AI_INTERNAL_SECRET" \
 *     "https://yogabible.dk/.netlify/functions/seed-personal-outreach?mode=preview"
 *   curl -X POST -H "x-internal-secret: $AI_INTERNAL_SECRET" \
 *     "https://yogabible.dk/.netlify/functions/seed-personal-outreach?mode=apply"
 */

const admin = require('firebase-admin');
const { getDb } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');

const COL = 'sequences';
const NAME = 'Personal Outreach — All Programs';

// =========================================================================
// Sequence document — Personal Outreach
// =========================================================================
//
// Steps are content_type: 'dynamic' so the processor resolves a cohort for
// each lead at send-time and substitutes:
//   {{first_name}}, {{cohort_name}}, {{cohort_label}}, {{method}},
//   {{schedule_url}}, {{checkout_url}}, {{prep_phase_price}},
//   {{full_price}}, {{start_date}}
//
// Content rules (CLAUDE.md):
//   - Never mention the language of instruction.
//   - Never mention refunds.
//   - Plain <p> tags only; orange inline links; no boxes or buttons.
//   - The standard signature + unsubscribe footer is auto-appended by
//     Resend's wrapHtml.
// =========================================================================

const SEQUENCE_DOC = {
  name: NAME,
  description: 'Five-step plain-text personal outreach for all new YTT leads. Replaces all prior program-specific conversion sequences. Cohort and schedule URL are resolved per-lead at send-time from cohort_registry.',
  active: true,
  trigger: {
    type: 'new_lead',
    conditions: { lead_type: 'ytt' }
  },
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
    // ---- Step 1: Schedule + basic info ------------------------------------
    {
      channel: 'email',
      delay_minutes: 150, // 2.5 hours (overridden to 0 by processor when cohort is urgent)
      content_type: 'dynamic',
      condition: null,
      email_subject: 'Dit skema er klar',
      email_body:
        '<p>Hej {{first_name}},</p>' +
        '<p>Tak for din interesse — jeg sender dig lige skemaet for vores {{cohort_name}} ({{cohort_label}}) her:</p>' +
        '<p><a href="{{schedule_url}}" style="color:#f75c03;">Se skemaet her</a></p>' +
        '<p>Uddannelsen er {{method}}, og den starter {{start_date}}. Yoga Alliance RYT-200 certificering.</p>' +
        '<p>Hvis du har spørgsmål om hvad det indebærer, så ring mig gerne på <a href="tel:+4553881209" style="color:#f75c03;">53 88 12 09</a> — det er nemmere end email.</p>' +
        '<p>Shamir</p>',
      email_subject_en: 'Your schedule is ready',
      email_body_en:
        '<p>Hi {{first_name}},</p>' +
        '<p>Thanks for your interest — here\'s the schedule for our {{cohort_name}} ({{cohort_label}}):</p>' +
        '<p><a href="{{schedule_url}}" style="color:#f75c03;">See the schedule here</a></p>' +
        '<p>The training is {{method}}, starting {{start_date}}. Yoga Alliance RYT-200 certification.</p>' +
        '<p>If you have any questions about what it involves, feel free to call me at <a href="tel:+4553881209" style="color:#f75c03;">+45 53 88 12 09</a> — easier than email.</p>' +
        '<p>Shamir</p>'
    },

    // ---- Step 2: Schedule-view-aware check-in -----------------------------
    // The processor reads lead.schedule_engagement and picks the _viewed
    // variant when any page entry has last_visit > step 1's send time.
    {
      channel: 'email',
      delay_minutes: 2880, // 2 days (halved on urgent cohort)
      content_type: 'dynamic',
      schedule_view_aware: true,
      condition: null,
      // Variant A — lead viewed the schedule
      email_subject_viewed: 'Har du nogen spørgsmål?',
      email_body_viewed:
        '<p>Hej {{first_name}},</p>' +
        '<p>Jeg kan se du har kigget på skemaet for {{cohort_label}}-holdet — fedt.</p>' +
        '<p>Har du nogen spørgsmål til indholdet eller det praktiske? Jeg sidder klar på <a href="tel:+4553881209" style="color:#f75c03;">53 88 12 09</a> hvis du vil snakke det igennem.</p>' +
        '<p>Her er skemaet igen hvis du vil kigge en gang mere: <a href="{{schedule_url}}" style="color:#f75c03;">Se skemaet</a></p>' +
        '<p>Shamir</p>',
      email_subject_viewed_en: 'Any questions?',
      email_body_viewed_en:
        '<p>Hi {{first_name}},</p>' +
        '<p>I can see you\'ve looked at the schedule for the {{cohort_label}} cohort — great.</p>' +
        '<p>Do you have any questions about the content or practicalities? I\'m available at <a href="tel:+4553881209" style="color:#f75c03;">+45 53 88 12 09</a> if you\'d like to talk it through.</p>' +
        '<p>Here\'s the schedule again if you want another look: <a href="{{schedule_url}}" style="color:#f75c03;">See the schedule</a></p>' +
        '<p>Shamir</p>',
      // Variant B — lead did NOT view the schedule
      email_subject: 'Fik du set skemaet?',
      email_body:
        '<p>Hej {{first_name}},</p>' +
        '<p>Jeg sendte dig skemaet for {{cohort_label}}-holdet for et par dage siden. Hvis det forsvandt i indbakken, er det her igen:</p>' +
        '<p><a href="{{schedule_url}}" style="color:#f75c03;">Se skemaet her</a></p>' +
        '<p>Det er en {{cohort_name}} — {{method}}. Starter {{start_date}}.</p>' +
        '<p>Sig til hvis du har spørgsmål.</p>' +
        '<p>Shamir</p>',
      email_subject_en: 'Did you get a chance to look?',
      email_body_en:
        '<p>Hi {{first_name}},</p>' +
        '<p>I sent you the schedule for the {{cohort_label}} cohort a couple of days ago. In case it got lost in your inbox, here it is again:</p>' +
        '<p><a href="{{schedule_url}}" style="color:#f75c03;">See the schedule here</a></p>' +
        '<p>It\'s a {{cohort_name}} — {{method}}. Starts {{start_date}}.</p>' +
        '<p>Let me know if you have any questions.</p>' +
        '<p>Shamir</p>'
    },

    // ---- Step 3: Value-add ------------------------------------------------
    {
      channel: 'email',
      delay_minutes: 7200, // 5 days (halved on urgent cohort)
      content_type: 'dynamic',
      condition: null,
      email_subject: 'Det spørgsmål alle stiller',
      email_body:
        '<p>Hej {{first_name}},</p>' +
        '<p>Det vi hører oftest er: "Skal man være god til yoga for at tage uddannelsen?"</p>' +
        '<p>Nej. De fleste der starter har praktiseret i 1-2 år. Nogle kortere. Uddannelsen møder dig der hvor du er — du behøver ikke kunne stå på hovedet for at blive en god underviser.</p>' +
        '<p>Det der betyder noget er at du har lyst til at lære. Resten tager vi os af.</p>' +
        '<p>Her er skemaet for {{cohort_label}}-holdet igen: <a href="{{schedule_url}}" style="color:#f75c03;">Se skemaet</a></p>' +
        '<p>Hvis du vil snakke om det, så book en uforpligtende samtale her: <a href="https://yogabible.dk/?booking=info-session" style="color:#f75c03;">Book en samtale</a></p>' +
        '<p>Shamir</p>',
      email_subject_en: 'The question everyone asks',
      email_body_en:
        '<p>Hi {{first_name}},</p>' +
        '<p>The question we hear most is: "Do I need to be good at yoga to do the training?"</p>' +
        '<p>No. Most people who start have been practicing for 1-2 years. Some less. The training meets you where you are — you don\'t need to be able to do a headstand to become a great teacher.</p>' +
        '<p>What matters is that you want to learn. We take care of the rest.</p>' +
        '<p>Here\'s the schedule for the {{cohort_label}} cohort again: <a href="{{schedule_url}}" style="color:#f75c03;">See the schedule</a></p>' +
        '<p>If you\'d like to talk about it, book a free call here: <a href="https://yogabible.dk/en/?booking=info-session" style="color:#f75c03;">Book a call</a></p>' +
        '<p>Shamir</p>'
    },

    // ---- Step 4: Soft close with Prep Phase -------------------------------
    {
      channel: 'email',
      delay_minutes: 4320, // 3 days (halved on urgent cohort)
      content_type: 'dynamic',
      condition: null,
      email_subject: 'En sidste ting',
      email_body:
        '<p>Hej {{first_name}},</p>' +
        '<p>Jeg vil ikke fylde din indbakke, så bare en kort besked.</p>' +
        '<p>Hvis {{cohort_label}}-holdet er noget for dig, kan du starte Forberedelsesfasen for {{prep_phase_price}} — beløbet trækkes fra den fulde pris på {{full_price}}.</p>' +
        '<p><a href="{{checkout_url}}" style="color:#f75c03;">Start Forberedelsesfasen</a></p>' +
        '<p>Og hvis timingen ikke passer lige nu, er det helt fint. Vi kører hold flere gange om året.</p>' +
        '<p>Shamir</p>',
      email_subject_en: 'One last thing',
      email_body_en:
        '<p>Hi {{first_name}},</p>' +
        '<p>I don\'t want to fill your inbox, so just a quick note.</p>' +
        '<p>If the {{cohort_label}} cohort is right for you, you can start the Preparation Phase for {{prep_phase_price}} — the amount is deducted from the full price of {{full_price}}.</p>' +
        '<p><a href="{{checkout_url}}" style="color:#f75c03;">Start the Preparation Phase</a></p>' +
        '<p>And if the timing doesn\'t work right now, that\'s completely fine. We run cohorts several times a year.</p>' +
        '<p>Shamir</p>'
    },

    // ---- Step 5: Still interested? (pipeline cleanup) ---------------------
    // Final delay is intentionally NOT compressed by the urgency override —
    // see sequences.js: the cleanup ask keeps its full window.
    {
      channel: 'email',
      delay_minutes: 14400, // 10 days
      content_type: 'dynamic',
      condition: null,
      email_subject: 'Er du stadig interesseret?',
      email_body:
        '<p>Hej {{first_name}},</p>' +
        '<p>Helt kort — er yogalæreruddannelsen stadig noget du overvejer, eller er det ikke aktuelt lige nu?</p>' +
        '<p>Du behøver ikke forklare dig. Et "ja" eller "nej" er helt fint, så ved jeg hvor vi står.</p>' +
        '<p>Shamir</p>',
      email_subject_en: 'Still interested?',
      email_body_en:
        '<p>Hi {{first_name}},</p>' +
        '<p>Quick question — is the yoga teacher training still something you\'re considering, or is it not the right time?</p>' +
        '<p>No need to explain. A simple "yes" or "no" is completely fine, just so I know where things stand.</p>' +
        '<p>Shamir</p>'
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
    schedule_view_aware: !!s.schedule_view_aware,
    subject_da: s.email_subject || s.email_subject_viewed || '(variant)',
    subject_en: s.email_subject_en || s.email_subject_viewed_en || '(variant)'
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
