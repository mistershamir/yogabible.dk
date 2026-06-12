/**
 * Lead Welcome Emails — Yoga Bible
 *
 * The welcome is now a 3-line ice breaker that lands ~10 minutes after a
 * form submission. Schedule, method, Prep Phase, accommodation, travel
 * etc. all live in the Personal Outreach sequence Step 1, which fires
 * ~60 minutes after submission.
 *
 * Lead experience:
 *   - Form → ~10 min → ice breaker (this file)
 *   - Form → ~70 min → full schedule + details (Personal Outreach Step 1)
 *
 * Style: plain <p> tags, inline orange phone link, nothing else. Resend's
 * wrapHtml auto-appends the standard signature + unsubscribe footer.
 */

const { CONFIG } = require('./config');
const { escapeHtml } = require('./utils');
const { sendSingleViaResend } = require('./resend-service');
const { getDb } = require('./firestore');

// =========================================================================
// Form ID → language map (also used by facebook-leads-webhook.js).
// =========================================================================
const FORM_LANG_MAP = {
  '827004866473769':  'en',     // july-vinyasa-plus-en (UK)
  '25716246641411656':'en',     // july-vinyasa-plus-no
  '4318151781759438': 'en',     // july-vinyasa-plus-se
  '2450631555377690': 'de',     // july-vinyasa-plus-de
  '1668412377638315': 'en',     // july-vinyasa-plus-fi
  '960877763097239':  'en',     // july-vinyasa-plus-nl
  '1344364364192542': 'da',     // july-vinyasa-plus-dk
  '961808297026346':  'da'      // general dk form (multi-program)
};

// =========================================================================
// Program-name lookup. Two paths:
//   1. action-string match (for forms that pick a specific program)
//   2. ytt_program_type match (for Meta forms that capture the program key)
// Falls back to the generic 200-Hour copy when no specific match.
//
// Note: 'lead_schedule_4w' / 'lead_schedule_4w-apr' resolve to the *June*
// cohort copy because April 2026 is sold out — the next live 4-week cohort
// is June.
// =========================================================================

const PROG_4W_JUN = { name_en: '4-Week Complete Program',          name_da: '4-ugers Complete Program',                label_en: 'June 2026',          label_da: 'juni 2026' };
const PROG_4W_JUL = { name_en: '4-Week Vinyasa Plus Training',     name_da: '4-ugers Vinyasa Plus uddannelse',         label_en: 'July 2026',          label_da: 'juli 2026' };
const PROG_8W     = { name_en: '8-Week Semi-Intensive Training',   name_da: '8-ugers semi-intensive yogalæreruddannelse', label_en: 'May–June 2026',   label_da: 'maj–juni 2026' };
const PROG_18W_SP = { name_en: '18-Week Flexible Training',        name_da: '18-ugers fleksible yogalæreruddannelse',  label_en: 'Spring 2026',        label_da: 'forår 2026' };
const PROG_18W_AU = { name_en: '18-Week Flexible Training',        name_da: '18-ugers fleksible yogalæreruddannelse',  label_en: 'August–December 2026', label_da: 'august–december 2026' };
const PROG_300H   = { name_en: '300-Hour Advanced Yoga Teacher Training', name_da: '300-timers avancerede yogalæreruddannelse', label_en: 'May–December 2026', label_da: 'maj–december 2026' };
const PROG_SPEC   = { name_en: 'Specialty Teacher Training',       name_da: 'specialmodulerne',                        label_en: '2026',               label_da: '2026' };
const PROG_COURSE = { name_en: 'Yoga Bible courses',               name_da: 'vores kurser',                            label_en: '',                   label_da: '' };
const PROG_MENTOR = { name_en: 'Yoga Bible Mentorship program',    name_da: 'vores mentorship-program',                label_en: '',                   label_da: '' };
const PROG_GENERIC = { name_en: '200-Hour Yoga Teacher Training',  name_da: '200-timers yogalæreruddannelse',          label_en: '2026',               label_da: '2026' };

const ACTION_PROGRAM = {
  'lead_schedule_4w':       PROG_4W_JUN,
  'lead_schedule_4w-apr':   PROG_4W_JUN,
  'lead_schedule_4w-jun':   PROG_4W_JUN,
  'lead_schedule_4w-jul':   PROG_4W_JUL,
  'lead_schedule_8w':       PROG_8W,
  'lead_schedule_18w':      PROG_18W_SP,
  'lead_schedule_18w-mar':  PROG_18W_SP,
  'lead_schedule_18w-aug':  PROG_18W_AU,
  'lead_schedule_300h':     PROG_300H,
  'lead_schedule_50h':      PROG_SPEC,
  'lead_schedule_30h':      PROG_SPEC,
  'lead_schedule_multi':    PROG_GENERIC,
  'lead_undecided':         PROG_GENERIC,
  'lead_courses':           PROG_COURSE,
  'lead_mentorship':        PROG_MENTOR
};

const META_PROGRAM = {
  '4-week':      PROG_4W_JUN,    // generic 4-week → next live cohort (June)
  '4-week-jun':  PROG_4W_JUN,
  '4-week-jul':  PROG_4W_JUL,
  '8-week':      PROG_8W,
  '18-week':     PROG_18W_SP,
  '18-week-aug': PROG_18W_AU,
  '300h':        PROG_300H,
  'specialty':   PROG_SPEC
};

function resolveProgram(action, leadData) {
  if (ACTION_PROGRAM[action]) return ACTION_PROGRAM[action];
  if (action === 'lead_meta' && (leadData.type === 'ytt' || leadData.ytt_program_type)) {
    var key = leadData.ytt_program_type || '4-week';
    return META_PROGRAM[key] || PROG_GENERIC;
  }
  return PROG_GENERIC;
}

// =========================================================================
// Ice-breaker template — DA + EN. The only variables are firstName,
// programName, cohortLabel.
// =========================================================================

function buildIceBreakerHtml(firstName, programName, cohortLabel, isEn) {
  var parens = cohortLabel ? ' (' + cohortLabel + ')' : '';
  if (isEn) {
    return '<p>Hi ' + escapeHtml(firstName) + ',</p>' +
      '<p>Thanks for your interest in the ' + programName + parens + '. I\'ll send you the full schedule and details shortly.</p>' +
      '<p>In the meantime, feel free to call me at <a href="tel:+4553881209" style="color:#f75c03;">+45 53 88 12 09</a> if you have any questions.</p>';
  }
  return '<p>Hej ' + escapeHtml(firstName) + ',</p>' +
    '<p>Tak for din interesse i ' + programName + parens + '. Jeg sender dig skemaet og alle detaljer lidt senere.</p>' +
    '<p>Ring gerne på <a href="tel:+4553881209" style="color:#f75c03;">53 88 12 09</a> hvis du har spørgsmål.</p>';
}

function buildIceBreakerPlain(firstName, programName, cohortLabel, isEn) {
  var parens = cohortLabel ? ' (' + cohortLabel + ')' : '';
  if (isEn) {
    return 'Hi ' + firstName + ',\n\n' +
      'Thanks for your interest in the ' + programName + parens + '. I\'ll send you the full schedule and details shortly.\n\n' +
      'In the meantime, feel free to call me at +45 53 88 12 09 if you have any questions.\n\n' +
      'Shamir';
  }
  return 'Hej ' + firstName + ',\n\n' +
    'Tak for din interesse i ' + programName + parens + '. Jeg sender dig skemaet og alle detaljer lidt senere.\n\n' +
    'Ring gerne på 53 88 12 09 hvis du har spørgsmål.\n\n' +
    'Shamir';
}

// =========================================================================
// Main entry point — sendWelcomeEmail
// =========================================================================

async function sendWelcomeEmail(leadData, action, tokenData = {}) {
  if (!leadData.email) {
    console.log('[lead-emails] No email for lead, skipping welcome email');
    return { success: false, reason: 'no_email' };
  }

  if (leadData.unsubscribed) {
    console.log('[lead-emails] Lead ' + leadData.email + ' is unsubscribed, skipping');
    return { success: false, reason: 'unsubscribed' };
  }

  // Dedup against duplicate sends within 24h (form double-submit, Meta retry).
  try {
    const db = getDb();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentWelcomeSnap = await db.collection('email_log')
      .where('to', '==', leadData.email.toLowerCase().trim())
      .where('template_id', '==', 'auto_welcome')
      .where('sent_at', '>=', twentyFourHoursAgo)
      .where('status', 'in', ['sent', 'pending'])
      .limit(1)
      .get();
    if (!recentWelcomeSnap.empty) {
      console.log('[lead-emails] Welcome already sent to ' + leadData.email + ' within 24h — skipping duplicate');
      return { success: true, reason: 'already_sent' };
    }
  } catch (dedupErr) {
    console.error('[lead-emails] Welcome dedup check failed (PROCEEDING with send):', dedupErr.message);
  }

  // Waitlist 300h is genuinely different — no follow-up coming. Dedicated copy.
  if (action === 'lead_waitlist_300h') {
    return await sendWaitlist300hEmail(leadData, tokenData);
  }

  // Language: form-id map first, then lead.lang/meta_lang. DE folds into EN
  // (we only ship two welcome variants per spec).
  const formLang = FORM_LANG_MAP[leadData.meta_form_id];
  const lang = (formLang || leadData.lang || leadData.meta_lang || 'da').toLowerCase().trim().substring(0, 2);
  const isDanish = ['da', 'dk'].includes(lang);
  const isEn = !isDanish;

  const program = resolveProgram(action, leadData);
  const programName = isEn ? program.name_en : program.name_da;
  const label = isEn ? program.label_en : program.label_da;

  const subject = isEn ? 'Thanks for reaching out' : 'Tak for din henvendelse';
  const bodyHtml = buildIceBreakerHtml(leadData.first_name || '', programName, label, isEn);
  const bodyPlain = buildIceBreakerPlain(leadData.first_name || '', programName, label, isEn);

  try {
    const result = await sendSingleViaResend({
      to: leadData.email,
      subject,
      bodyHtml,
      bodyPlain,
      leadId: (tokenData || {}).leadId,
      campaignId: 'welcome:icebreaker',
      lang: isEn ? 'en' : 'da'
    });

    if (result && result.success) {
      await logWelcomeEmail(leadData.email, subject, (tokenData || {}).leadId);
      if (tokenData && tokenData.leadId) {
        const db = getDb();
        db.collection('leads').doc(tokenData.leadId).update({
          welcome_email_sent_at: new Date(),
          'email_engagement.welcome_sent_at': new Date()
        }).catch(() => {});
      }
    }
    return { ...result, subject };
  } catch (err) {
    console.error('[lead-emails] sendWelcomeEmail error:', err.message);
    return { success: false, error: err.message };
  }
}

async function logWelcomeEmail(to, subject, leadId) {
  try {
    const db = getDb();
    await db.collection('email_log').add({
      to,
      subject,
      template_id: 'auto_welcome',
      lead_id: leadId || null,
      sent_at: new Date(),
      status: 'sent',
      sent_by_uid: 'system',
      sent_by_email: 'automated',
      sent_by_role: 'system'
    });
  } catch (err) {
    console.error('[lead-emails] Failed to log welcome email:', err.message);
  }
}

// =========================================================================
// 300h Waitlist (bilingual) — dedicated because there is NO follow-up.
// Personal Outreach won't enroll a waitlist lead (no matching cohort), so
// this single email has to carry the message on its own.
// =========================================================================

async function sendWaitlist300hEmail(leadData, tokenData = {}) {
  const firstName = leadData.first_name || '';
  const lang = (leadData.lang || 'da').toLowerCase();
  const isEn = lang === 'en';

  const subject = isEn
    ? 'You\'re on the 300-Hour waitlist'
    : 'Du er på ventelisten — 300-timers uddannelsen';

  let html, plain;
  if (isEn) {
    html = '<p>Hi ' + escapeHtml(firstName) + ',</p>' +
      '<p>Thanks for your interest in the 300-Hour Advanced Yoga Teacher Training. You\'re on the waitlist — I\'ll be in touch as soon as it opens for applications.</p>' +
      '<p>If you have any questions in the meantime, call me at <a href="tel:+4553881209" style="color:#f75c03;">+45 53 88 12 09</a> or just reply to this email.</p>';
    plain = 'Hi ' + firstName + ',\n\nThanks for your interest in the 300-Hour Advanced Yoga Teacher Training. You\'re on the waitlist — I\'ll be in touch as soon as it opens for applications.\n\nQuestions in the meantime? Call +45 53 88 12 09 or reply to this email.\n\nShamir';
  } else {
    html = '<p>Hej ' + escapeHtml(firstName) + ',</p>' +
      '<p>Tak for din interesse i vores 300-timers avancerede yogalæreruddannelse. Du er på ventelisten — jeg vender tilbage så snart uddannelsen åbner for ansøgning.</p>' +
      '<p>Har du spørgsmål i mellemtiden? Ring på <a href="tel:+4553881209" style="color:#f75c03;">53 88 12 09</a> eller svar bare på denne mail.</p>';
    plain = 'Hej ' + firstName + ',\n\nTak for din interesse i vores 300-timers avancerede yogalæreruddannelse. Du er på ventelisten — jeg vender tilbage så snart uddannelsen åbner for ansøgning.\n\nSpørgsmål? Ring 53 88 12 09 eller svar på denne mail.\n\nShamir';
  }

  try {
    const result = await sendSingleViaResend({
      to: leadData.email,
      subject,
      bodyHtml: html,
      bodyPlain: plain,
      leadId: (tokenData || {}).leadId,
      campaignId: 'welcome:waitlist-300h',
      lang: isEn ? 'en' : 'da'
    });
    if (result && result.success) {
      await logWelcomeEmail(leadData.email, subject, (tokenData || {}).leadId);
    }
    return { ...result, subject };
  } catch (err) {
    console.error('[lead-emails] sendWaitlist300hEmail error:', err.message);
    return { success: false, error: err.message };
  }
}

// =========================================================================
// Application Confirmation (Danish) — fired by apply.js
// =========================================================================
async function sendApplicationConfirmation(email, applicationId, firstName) {
  const subject = 'Tak for din ansøgning';

  const html = '<p>Hej ' + escapeHtml(firstName || '') + ',</p>' +
    '<p>Tak for din ansøgning til Yoga Bible. Dit ansøgnings-ID er ' + escapeHtml(applicationId) + '. Vi kigger din ansøgning igennem og vender tilbage med næste skridt.</p>' +
    '<p>Har du spørgsmål i mellemtiden? Svar bare på denne mail eller ring til <a href="tel:+4553881209" style="color:#f75c03;">+45 53 88 12 09</a>.</p>';

  const plain = 'Hej ' + (firstName || '') + ',\n\nTak for din ansøgning til Yoga Bible. Ansøgnings-ID: ' + applicationId + '. Vi vender tilbage.\n\nSpørgsmål? Svar på denne mail eller ring +45 53 88 12 09.\n\nShamir';

  const result = await sendSingleViaResend({
    to: email, subject, bodyHtml: html, bodyPlain: plain,
    leadId: null, campaignId: 'welcome:application', lang: 'da'
  });
  await logWelcomeEmail(email, subject, null);
  return { ...result, subject };
}

// =========================================================================
// Careers Auto-Reply (Danish) — fired by careers.js
// =========================================================================
async function sendCareersConfirmation(email, firstName, category, role) {
  const subject = 'Tak for din ansøgning — Yoga Bible Careers';

  const html = '<p>Hej ' + escapeHtml(firstName || '') + ',</p>' +
    '<p>Tak for din interesse i at blive en del af Yoga Bible-teamet. Vi har modtaget din ansøgning' +
    (category ? ' inden for ' + escapeHtml(category) : '') +
    (role ? ' som ' + escapeHtml(role) : '') +
    '. Vi gennemgår alle ansøgninger løbende og vender tilbage, hvis der er et match.</p>' +
    '<p>Har du spørgsmål? Svar bare på denne mail.</p>';

  const plain = 'Hej ' + (firstName || '') + ',\n\nTak for din interesse i Yoga Bible-teamet. Vi har modtaget din ansøgning' +
    (category ? ' inden for ' + category : '') +
    (role ? ' som ' + role : '') +
    '. Vi vender tilbage hvis der er et match.\n\nShamir';

  const result = await sendSingleViaResend({
    to: email, subject, bodyHtml: html, bodyPlain: plain,
    leadId: null, campaignId: 'welcome:careers', lang: 'da'
  });
  await logWelcomeEmail(email, subject, null);
  return { ...result, subject };
}

// =========================================================================
// 18-Week Aug–Dec 2026 — Rich welcome email (Step 1 replacement)
// Used by sendImmediateScheduleEmail in lead.js and facebook-leads-webhook.js.
// Returns { subject, html } — caller wraps with wrapHtml via sendSingleViaResend.
// =========================================================================

function build18WAugWelcomeEmail(firstName, scheduleUrl, isDa) {
  var name = escapeHtml(firstName || '');
  var prepPhaseUrl = 'https://www.yogabible.dk/?product=100210';
  var consultUrl = isDa
    ? 'https://www.yogabible.dk/200-hours-18-weeks-flexible-programs/?booking=consultation'
    : 'https://www.yogabible.dk/en/200-hours-18-weeks-flexible-programs/?booking=consultation';

  if (isDa) {
    var subject = (name ? name + ', d' : 'D') + 'it skema til efterårets 18-ugers program er klar';
    var html =
      '<p>Hej ' + name + ',</p>' +
      '<p>Tak for din interesse — her er dit skema til <strong>18-ugers fleksible yogalæreruddannelse, august–december 2026</strong>.</p>' +
      '<p style="text-align:center;margin:24px 0;"><a href="' + scheduleUrl + '" style="display:inline-block;padding:14px 32px;background:#f75c03;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;font-size:16px;">Se skemaet →</a></p>' +
      '<div style="background:#FFF9F0;border-left:3px solid #f75c03;border-radius:6px;padding:16px 20px;margin:0 0 20px;">' +
        '<strong>Om uddannelsen:</strong>' +
        '<ul style="margin:10px 0 0;padding-left:20px;line-height:1.8;">' +
          '<li>200 timer · Yoga Alliance RYT-200 certificeret</li>' +
          '<li>Triangle Method — Hatha, Vinyasa, Yin, Hot Yoga &amp; Meditation</li>' +
          '<li>To spor: hverdagsspor (mandag–fredag) eller weekendspor (lørdag–søndag)</li>' +
          '<li>Vælg frit mellem sporerne undervejs</li>' +
          '<li>Start: 10. august 2026 · Graduation: 13. december 2026</li>' +
          '<li>Små hold · personlig feedback</li>' +
          '<li>60 yogaklasser i studiet inkluderet</li>' +
        '</ul>' +
      '</div>' +
      '<div style="background:#F5F3F0;border-radius:8px;padding:16px 20px;margin:0 0 20px;">' +
        '<strong>💡 Forberedelsesfasen — 3.750 kr.</strong><br>' +
        '<span style="color:#444;font-size:15px;">De fleste studerende starter forberedelsesfasen nu — og det er der en god grund til:</span>' +
        '<ul style="margin:10px 0 0;padding-left:20px;line-height:1.8;color:#444;">' +
          '<li>Sikrer din plads på august-holdet</li>' +
          '<li>Adgang til member-området med forberedelsesmaterialer</li>' +
          '<li>Begynd at deltage i klasser i studiet med det samme</li>' +
          '<li>Klasserne tæller med i dine træningstimer</li>' +
        '</ul>' +
        '<p style="margin:14px 0 0;"><a href="' + prepPhaseUrl + '" style="display:inline-block;padding:12px 24px;background:#0F0F0F;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;">Start forberedelsesfasen — 3.750 kr.</a></p>' +
      '</div>' +
      '<p>Vil du gerne høre mere? Book et gratis infomøde:</p>' +
      '<p style="margin:0 0 20px;"><a href="' + consultUrl + '" style="display:inline-block;padding:12px 24px;background:#fff;color:#0F0F0F;text-decoration:none;border-radius:8px;border:1px solid #E8E4E0;font-weight:bold;">Book et gratis infomøde</a></p>' +
      '<p>Ring gerne direkte på <a href="tel:+4553881209" style="color:#f75c03;">53 88 12 09</a> — det er nemmere end email.</p>';
    return { subject, html };
  }

  // English (all non-DA languages, including Swedish Skåne leads)
  var subject = (name ? name + ', y' : 'Y') + 'our schedule for the autumn 18-week program is ready';
  var html =
    '<p>Hi ' + name + ',</p>' +
    '<p>Thanks for your interest — here is your schedule for the <strong>18-Week Flexible Yoga Teacher Training, August–December 2026</strong>.</p>' +
    '<p style="text-align:center;margin:24px 0;"><a href="' + scheduleUrl + '" style="display:inline-block;padding:14px 32px;background:#f75c03;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;font-size:16px;">View the schedule →</a></p>' +
    '<div style="background:#FFF9F0;border-left:3px solid #f75c03;border-radius:6px;padding:16px 20px;margin:0 0 20px;">' +
      '<strong>About the training:</strong>' +
      '<ul style="margin:10px 0 0;padding-left:20px;line-height:1.8;">' +
        '<li>200 hours · Yoga Alliance RYT-200 certified</li>' +
        '<li>Triangle Method — Hatha, Vinyasa, Yin, Hot Yoga &amp; Meditation</li>' +
        '<li>Two tracks: weekday (Monday–Friday) or weekend (Saturday–Sunday)</li>' +
        '<li>Switch tracks freely throughout</li>' +
        '<li>Starting 10 August 2026 · Graduation 13 December 2026</li>' +
        '<li>Small groups · personal feedback</li>' +
        '<li>60 yoga classes at the studio included</li>' +
      '</ul>' +
    '</div>' +
    '<div style="background:#F5F3F0;border-radius:8px;padding:16px 20px;margin:0 0 20px;">' +
      '<strong>💡 Preparation Phase — 3,750 DKK</strong><br>' +
      '<span style="color:#444;font-size:15px;">Most students start their Preparation Phase early — and for good reason:</span>' +
      '<ul style="margin:10px 0 0;padding-left:20px;line-height:1.8;color:#444;">' +
        '<li>Secures your spot in the August cohort</li>' +
        '<li>Access to the member area with preparation materials</li>' +
        '<li>Start attending classes at the studio right away</li>' +
        '<li>Your classes count towards your training hours</li>' +
      '</ul>' +
      '<p style="margin:14px 0 0;"><a href="' + prepPhaseUrl + '" style="display:inline-block;padding:12px 24px;background:#0F0F0F;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;">Start Preparation Phase — 3,750 DKK</a></p>' +
    '</div>' +
    '<p>Want to learn more or ask questions? Book a free info session:</p>' +
    '<p style="margin:0 0 20px;"><a href="' + consultUrl + '" style="display:inline-block;padding:12px 24px;background:#fff;color:#0F0F0F;text-decoration:none;border-radius:8px;border:1px solid #E8E4E0;font-weight:bold;">Book a Free Info Session</a></p>' +
    '<p>Feel free to call me at <a href="tel:+4553881209" style="color:#f75c03;">+45 53 88 12 09</a> — easier than email.</p>';
  return { subject, html };
}

// =========================================================================
// July 4-Week Vinyasa Plus 2026 — Rich welcome email with urgency messaging.
// Used by sendImmediateScheduleEmail in lead.js and facebook-leads-webhook.js.
// Returns { subject, html } — caller wraps with wrapHtml via sendSingleViaResend.
// CONTENT RULES: no group size, no refunds, no language-of-instruction,
// "Forberedelsesfasen"/"Preparation Phase" — never "deposit".
// =========================================================================

function build4WJulWelcomeEmail(firstName, scheduleUrl, isDa) {
  var name = escapeHtml(firstName || '');
  var prepPhaseUrl = 'https://www.yogabible.dk/?product=100211';
  var consultUrl = isDa
    ? 'https://www.yogabible.dk/200-hours-4-weeks-intensive-programs/?booking=consultation'
    : 'https://www.yogabible.dk/en/200-hours-4-weeks-intensive-programs/?booking=consultation';

  if (isDa) {
    var subject = (name ? name + ', d' : 'D') + 'it skema til juli-holdet er klar';
    var html =
      '<p>Hej ' + name + ',</p>' +
      '<p>Tak for din interesse — her er dit skema til <strong>Vinyasa Plus, 4-ugers yogalæreruddannelse i juli 2026</strong>.</p>' +
      '<div style="background:#f75c03;color:#fff;border-radius:8px;padding:14px 20px;margin:0 0 20px;font-weight:bold;">' +
        '⏳ Få pladser tilbage — tilmeldingen lukker snart. Juli-holdet starter den 6. juli.' +
      '</div>' +
      '<p style="text-align:center;margin:24px 0;"><a href="' + scheduleUrl + '" style="display:inline-block;padding:14px 32px;background:#f75c03;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;font-size:16px;">Se skemaet →</a></p>' +
      '<div style="background:#FFF9F0;border-left:3px solid #f75c03;border-radius:6px;padding:16px 20px;margin:0 0 20px;">' +
        '<strong>Vinyasa Plus — 70% Vinyasa Flow + 30% Yin &amp; Hot Yoga</strong>' +
        '<ul style="margin:10px 0 0;padding-left:20px;line-height:1.8;">' +
          '<li>200 timer · Yoga Alliance RYT-200</li>' +
          '<li>Vinyasa Flow, Yin Yoga, Hot Yoga &amp; Meditation</li>' +
          '<li>Anatomi, filosofi, sekvensering &amp; undervisningsmetodik</li>' +
          '<li>Certificeret til at undervise både opvarmede og ikke-opvarmede klasser</li>' +
          '<li>Starter 6. juli 2026</li>' +
        '</ul>' +
      '</div>' +
      '<div style="background:#F5F3F0;border-left:3px solid #16a34a;border-radius:6px;padding:16px 20px;margin:0 0 20px;">' +
        '<strong>💡 Forberedelsesfasen (3.750 kr.) sikrer din plads</strong>' +
        '<ul style="margin:10px 0 0;padding-left:20px;line-height:1.8;color:#444;">' +
          '<li>Adgang til medlemsområdet med forberedelsesmateriale</li>' +
          '<li>Start med at praktisere i studiet med det samme</li>' +
        '</ul>' +
        '<p style="margin:14px 0 0;"><a href="' + prepPhaseUrl + '" style="display:inline-block;padding:12px 24px;background:#0F0F0F;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;">Start forberedelsesfasen — 3.750 kr.</a></p>' +
      '</div>' +
      '<p>Har du spørgsmål inden du beslutter dig?</p>' +
      '<p style="margin:0 0 20px;"><a href="' + consultUrl + '" style="display:inline-block;padding:12px 24px;background:#fff;color:#0F0F0F;text-decoration:none;border-radius:8px;border:1px solid #E8E4E0;font-weight:bold;">Book en gratis konsultation</a></p>' +
      '<p>Ring gerne direkte på <a href="tel:+4553881209" style="color:#f75c03;">53 88 12 09</a> — det er nemmere end email.</p>';
    return { subject, html };
  }

  // English (all non-DA languages)
  var subject = (name ? name + ', y' : 'Y') + 'our July schedule is ready';
  var html =
    '<p>Hi ' + name + ',</p>' +
    '<p>Thanks for your interest — here is your schedule for the <strong>Vinyasa Plus 4-Week Yoga Teacher Training, July 2026</strong>.</p>' +
    '<div style="background:#f75c03;color:#fff;border-radius:8px;padding:14px 20px;margin:0 0 20px;font-weight:bold;">' +
      '⏳ Limited spots remaining — registration closes soon. The July cohort starts July 6.' +
    '</div>' +
    '<p style="text-align:center;margin:24px 0;"><a href="' + scheduleUrl + '" style="display:inline-block;padding:14px 32px;background:#f75c03;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;font-size:16px;">View the schedule →</a></p>' +
    '<div style="background:#FFF9F0;border-left:3px solid #f75c03;border-radius:6px;padding:16px 20px;margin:0 0 20px;">' +
      '<strong>Vinyasa Plus — 70% Vinyasa Flow + 30% Yin &amp; Hot Yoga</strong>' +
      '<ul style="margin:10px 0 0;padding-left:20px;line-height:1.8;">' +
        '<li>200 hours · Yoga Alliance RYT-200</li>' +
        '<li>Vinyasa Flow, Yin Yoga, Hot Yoga &amp; Meditation</li>' +
        '<li>Anatomy, philosophy, sequencing &amp; teaching methodology</li>' +
        '<li>Certified to teach both heated and non-heated classes</li>' +
        '<li>Starts 6 July 2026</li>' +
      '</ul>' +
    '</div>' +
    '<div style="background:#F5F3F0;border-left:3px solid #16a34a;border-radius:6px;padding:16px 20px;margin:0 0 20px;">' +
      '<strong>💡 The Preparation Phase (3,750 DKK) secures your spot</strong>' +
      '<ul style="margin:10px 0 0;padding-left:20px;line-height:1.8;color:#444;">' +
        '<li>Access to the member area with preparation materials</li>' +
        '<li>Start practicing at the studio right away</li>' +
      '</ul>' +
      '<p style="margin:14px 0 0;"><a href="' + prepPhaseUrl + '" style="display:inline-block;padding:12px 24px;background:#0F0F0F;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;">Start Preparation Phase — 3,750 DKK</a></p>' +
    '</div>' +
    '<p>Questions before you decide?</p>' +
    '<p style="margin:0 0 20px;"><a href="' + consultUrl + '" style="display:inline-block;padding:12px 24px;background:#fff;color:#0F0F0F;text-decoration:none;border-radius:8px;border:1px solid #E8E4E0;font-weight:bold;">Book a Free Consultation</a></p>' +
    '<p>Feel free to call me at <a href="tel:+4553881209" style="color:#f75c03;">+45 53 88 12 09</a> — easier than email.</p>';
  return { subject, html };
}

// =========================================================================
// Generic Schedule Email — works for any cohort_registry doc.
// Called by send-schedule.js (manual "Send Schedule" from admin panel).
// Returns { subject, html } — caller MUST call prepareTrackedEmail last.
// CONTENT RULES: no group size, no refunds, no language-of-instruction.
// =========================================================================

function buildScheduleEmail(firstName, cohort, scheduleUrl, isDa) {
  var name = escapeHtml(firstName || '');

  if (isDa) {
    var subject = (name ? name + ', d' : 'D') + 'it skema er klar — ' + (cohort.cohort_label_da || '');
    var html =
      '<p>Hej ' + name + ',</p>' +
      '<p>Her er dit skema til <strong>' + escapeHtml(cohort.name_da || '') + ' · ' + escapeHtml(cohort.cohort_label_da || '') + '</strong>.</p>' +
      '<p style="text-align:center;margin:24px 0;">' +
        '<a href="' + scheduleUrl + '" style="display:inline-block;padding:14px 32px;background:#f75c03;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;font-size:16px;">Se skemaet →</a>' +
      '</p>' +
      '<div style="background:#FFF9F0;border-left:3px solid #f75c03;border-radius:6px;padding:16px 20px;margin:0 0 20px;">' +
        '<strong>Om uddannelsen:</strong>' +
        '<ul style="margin:10px 0 0;padding-left:20px;line-height:1.8;">' +
          '<li>200 timer · Yoga Alliance RYT-200 certificeret</li>' +
          '<li>' + escapeHtml(cohort.method_da || '') + '</li>' +
          '<li>Start: ' + escapeHtml(cohort.start_date_formatted_da || cohort.start_date || '') + ' · Afslutning: ' + escapeHtml(cohort.end_date || '') + '</li>' +
        '</ul>' +
      '</div>' +
      '<div style="background:#F5F3F0;border-radius:8px;padding:16px 20px;margin:0 0 20px;">' +
        '<strong>💡 Forberedelsesfasen — ' + escapeHtml(cohort.prep_phase_price_da || '3.750 kr.') + '</strong><br>' +
        '<span style="color:#444;font-size:15px;">Sikrer din plads og giver adgang til forberedelsesmaterialer med det samme.</span>' +
        '<ul style="margin:10px 0 0;padding-left:20px;line-height:1.8;color:#444;">' +
          '<li>Sikrer din plads på holdet</li>' +
          '<li>Adgang til member-området med forberedelsesmaterialer</li>' +
          '<li>Begynd at deltage i klasser i studiet med det samme</li>' +
          '<li>Klasserne tæller med i dine træningstimer</li>' +
        '</ul>' +
        '<p style="margin:14px 0 0;">' +
          '<a href="' + escapeHtml(cohort.checkout_url || 'https://yogabible.dk') + '" style="display:inline-block;padding:12px 24px;background:#0F0F0F;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;">Start forberedelsesfasen — ' + escapeHtml(cohort.prep_phase_price_da || '3.750 kr.') + '</a>' +
        '</p>' +
      '</div>' +
      '<p>Ring gerne direkte på <a href="tel:+4553881209" style="color:#f75c03;">53 88 12 09</a> — det er nemmere end email.</p>';
    return { subject, html };
  }

  // English
  var subject = (name ? name + ', y' : 'Y') + 'our schedule is ready — ' + (cohort.cohort_label_en || '');
  var html =
    '<p>Hi ' + name + ',</p>' +
    '<p>Here is your schedule for the <strong>' + escapeHtml(cohort.name_en || '') + ' · ' + escapeHtml(cohort.cohort_label_en || '') + '</strong>.</p>' +
    '<p style="text-align:center;margin:24px 0;">' +
      '<a href="' + scheduleUrl + '" style="display:inline-block;padding:14px 32px;background:#f75c03;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;font-size:16px;">View the schedule →</a>' +
    '</p>' +
    '<div style="background:#FFF9F0;border-left:3px solid #f75c03;border-radius:6px;padding:16px 20px;margin:0 0 20px;">' +
      '<strong>About the training:</strong>' +
      '<ul style="margin:10px 0 0;padding-left:20px;line-height:1.8;">' +
        '<li>200 hours · Yoga Alliance RYT-200 certified</li>' +
        '<li>' + escapeHtml(cohort.method_en || '') + '</li>' +
        '<li>Starting ' + escapeHtml(cohort.start_date_formatted_en || cohort.start_date || '') + ' · Graduation ' + escapeHtml(cohort.end_date || '') + '</li>' +
      '</ul>' +
    '</div>' +
    '<div style="background:#F5F3F0;border-radius:8px;padding:16px 20px;margin:0 0 20px;">' +
      '<strong>💡 Preparation Phase — ' + escapeHtml(cohort.prep_phase_price_en || '3,750 DKK') + '</strong><br>' +
      '<span style="color:#444;font-size:15px;">Secures your spot and gives you immediate access to preparation materials.</span>' +
      '<ul style="margin:10px 0 0;padding-left:20px;line-height:1.8;color:#444;">' +
        '<li>Secures your spot in the cohort</li>' +
        '<li>Access to the member area with preparation materials</li>' +
        '<li>Start attending classes at the studio right away</li>' +
        '<li>Your classes count towards your training hours</li>' +
      '</ul>' +
      '<p style="margin:14px 0 0;">' +
        '<a href="' + escapeHtml(cohort.checkout_url || 'https://yogabible.dk') + '" style="display:inline-block;padding:12px 24px;background:#0F0F0F;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;">Start Preparation Phase — ' + escapeHtml(cohort.prep_phase_price_en || '3,750 DKK') + '</a>' +
      '</p>' +
    '</div>' +
    '<p>Feel free to call me at <a href="tel:+4553881209" style="color:#f75c03;">+45 53 88 12 09</a> — easier than email.</p>';
  return { subject, html };
}

module.exports = {
  sendWelcomeEmail,
  sendApplicationConfirmation,
  sendCareersConfirmation,
  build18WAugWelcomeEmail,
  build4WJulWelcomeEmail,
  buildScheduleEmail
};
