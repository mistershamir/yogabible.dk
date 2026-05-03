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
      '<p>In the meantime, feel free to call me at <a href="tel:+4553881209" style="color:#f75c03;">+45 53 88 12 09</a> if you have any questions.</p>' +
      '<p>Shamir</p>';
  }
  return '<p>Hej ' + escapeHtml(firstName) + ',</p>' +
    '<p>Tak for din interesse i ' + programName + parens + '. Jeg sender dig skemaet og alle detaljer lidt senere.</p>' +
    '<p>Ring gerne på <a href="tel:+4553881209" style="color:#f75c03;">53 88 12 09</a> hvis du har spørgsmål.</p>' +
    '<p>Shamir</p>';
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
      status: 'sent'
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
      '<p>If you have any questions in the meantime, call me at <a href="tel:+4553881209" style="color:#f75c03;">+45 53 88 12 09</a> or just reply to this email.</p>' +
      '<p>Shamir</p>';
    plain = 'Hi ' + firstName + ',\n\nThanks for your interest in the 300-Hour Advanced Yoga Teacher Training. You\'re on the waitlist — I\'ll be in touch as soon as it opens for applications.\n\nQuestions in the meantime? Call +45 53 88 12 09 or reply to this email.\n\nShamir';
  } else {
    html = '<p>Hej ' + escapeHtml(firstName) + ',</p>' +
      '<p>Tak for din interesse i vores 300-timers avancerede yogalæreruddannelse. Du er på ventelisten — jeg vender tilbage så snart uddannelsen åbner for ansøgning.</p>' +
      '<p>Har du spørgsmål i mellemtiden? Ring på <a href="tel:+4553881209" style="color:#f75c03;">53 88 12 09</a> eller svar bare på denne mail.</p>' +
      '<p>Shamir</p>';
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
    '<p>Har du spørgsmål i mellemtiden? Svar bare på denne mail eller ring til <a href="tel:+4553881209" style="color:#f75c03;">+45 53 88 12 09</a>.</p>' +
    '<p>Shamir</p>';

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
    '<p>Har du spørgsmål? Svar bare på denne mail.</p>' +
    '<p>Shamir</p>';

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

module.exports = {
  sendWelcomeEmail,
  sendApplicationConfirmation,
  sendCareersConfirmation
};
