/**
 * Lead Welcome Emails — Yoga Bible
 * Auto-reply emails sent to leads when they submit a form.
 * Ported from Apps Script (06 emails.js) to Netlify Functions.
 *
 * Each program type has its own Danish email template with:
 * - Program info, pricing, schedule attachment (if available)
 * - Accommodation section (if needed)
 * - Booking CTA, English note, signature, unsubscribe
 *
 * Schedule PDFs are now hosted on Cloudinary (not Google Drive).
 */

const { CONFIG, COURSE_CONFIG, SCHEDULE_PDFS, getDisplayProgram } = require('./config');
const {
  escapeHtml,
  getCoursePaymentUrl,
  getBundlePaymentUrl,
  buildUnsubscribeUrl
} = require('./utils');
const {
  sendRawEmail,
  getSignatureHtml,
  getSignaturePlain,
  getEnglishNoteHtml,
  getEnglishNotePlain,
  getGermanPsLineHtml,
  getGermanPsLinePlain,
  getUnsubscribeFooterHtml,
  getUnsubscribeFooterPlain,
  getAccommodationSectionHtml,
  getPricingSectionHtml
} = require('./email-service');
const { getDb } = require('./firestore');
const { prepareTrackedEmail } = require('./email-tracking');
const { detectLeadCountry, normalizeCountryName, detectCountryFromPhone } = require('./country-detect');

// Form ID → language map (same as facebook-leads-webhook.js)
const FORM_LANG_MAP = {
  '827004866473769':  'en',     // july-vinyasa-plus-en
  '25716246641411656':'en',     // july-vinyasa-plus-no
  '4318151781759438': 'en',     // july-vinyasa-plus-se
  '2450631555377690': 'de',     // july-vinyasa-plus-de
  '1668412377638315': 'en',     // july-vinyasa-plus-fi
  '960877763097239':  'en',     // july-vinyasa-plus-nl
  '1344364364192542': 'da'      // july-vinyasa-plus-dk
};

// =========================================================================
// Shared HTML helpers
// =========================================================================

function wrapHtml(body, trackingLeadId, trackingSource) {
  var html = '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;line-height:1.65;font-size:16px;">' +
    body + '</div>';
  // Inject email open/click tracking if leadId provided
  if (trackingLeadId) {
    html = prepareTrackedEmail(html, trackingLeadId, trackingSource || 'welcome');
  }
  return html;
}

function bookingCta() {
  return '<p style="margin-top:20px;">Har du lyst til at h\u00f8re mere eller stille sp\u00f8rgsm\u00e5l? Book et gratis og uforpligtende infom\u00f8de:</p>' +
    '<p><a href="' + CONFIG.MEETING_LINK + '" style="display:inline-block;background:#f75c03;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:600;">Book et gratis infom\u00f8de</a></p>';
}

function questionPrompt() {
  return '<p style="margin-top:20px;">Jeg vil ogs\u00e5 gerne h\u00f8re: <strong>Hvad fik dig til at overveje en yogauddannelse?</strong> Du er velkommen til bare at svare p\u00e5 denne mail.</p>' +
    '<p>Gl\u00e6der mig til at h\u00f8re fra dig.</p>';
}

function programHighlightsHtml(extras) {
  let html = '<p style="margin-top:16px;">Kort om uddannelsen:</p>';
  html += '<ul style="margin:8px 0;padding-left:20px;color:#333;">';
  html += '<li>200 timer \u00b7 Yoga Alliance-certificeret</li>';
  html += '<li>Hatha, Vinyasa, Yin, Hot Yoga & Meditation</li>';
  html += '<li>Anatomi, filosofi, sekvensering & undervisningsmetodik</li>';
  if (extras) extras.forEach(e => { html += '<li>' + e + '</li>'; });
  html += '<li>Alle niveauer er velkomne</li>';
  html += '</ul>';
  return html;
}

function programHighlightsPlain(extras) {
  let text = 'Kort om uddannelsen:\n';
  text += '- 200 timer \u00b7 Yoga Alliance-certificeret\n';
  text += '- Hatha, Vinyasa, Yin, Hot Yoga & Meditation\n';
  text += '- Anatomi, filosofi, sekvensering & undervisningsmetodik\n';
  if (extras) extras.forEach(e => { text += '- ' + e + '\n'; });
  text += '- Alle niveauer velkomne\n';
  return text;
}

function alumniNote() {
  return '<p style="margin-top:12px;">Vi har uddannet yogal\u00e6rere siden 2014, og vores dimittender underviser i hele Europa og videre.</p>';
}

function getAccommodationSectionPlain(cityCountry) {
  return '\n\nBolig: Jeg kan se du' + (cityCountry ? ' kommer fra ' + cityCountry + ' og' : '') + ' har brug for bolig i K\u00f8benhavn.\n' +
    'Se muligheder: https://yogabible.dk/accommodation\n' +
    'Har du sp\u00f8rgsm\u00e5l? Svar bare p\u00e5 denne e-mail.\n';
}

function getPricingSectionPlain(fullPrice, deposit, remaining, rateNote) {
  return 'Pris: ' + fullPrice + ' kr. (ingen ekstra gebyrer)\n' +
    'Forberedelsesfasen: ' + deposit + ' kr.\n' +
    'Rest: ' + remaining + ' kr. (' + rateNote + ')\n';
}

// =========================================================================
// Preparation Phase promotion block
// =========================================================================

function getPreparationPhaseHtml(programPageUrl) {
  return '<div style="margin-top:16px;padding:16px;background:#F0FDF4;border-left:3px solid #22C55E;border-radius:4px;">' +
    '<strong style="color:#166534;">\ud83d\udca1 Vidste du?</strong> De fleste studerende starter med forberedelsesfasen allerede nu \u2014 og det er der en god grund til:<br><br>' +
    '\u2705 Du kan begynde at deltage i klasser i studiet med det samme<br>' +
    '\u2705 Du opbygger styrke, fleksibilitet og rutine inden uddannelsesstart<br>' +
    '\u2705 Du m\u00f8der dine kommende medstuderende i et afslappet milj\u00f8<br>' +
    '\u2705 Dine klasser t\u00e6ller med i dine tr\u00e6ningstimer<br><br>' +
    '<a href="' + programPageUrl + '" style="display:inline-block;background:#f75c03;color:#ffffff;padding:10px 20px;text-decoration:none;border-radius:6px;font-weight:600;">Start forberedelsesfasen \u2014 3.750 kr.</a>' +
    '</div>';
}

function getPreparationPhasePlain(programPageUrl) {
  return '\nVidste du? De fleste studerende starter med forberedelsesfasen allerede nu:\n' +
    '- Deltag i klasser i studiet med det samme\n' +
    '- Opbyg styrke, fleksibilitet og rutine inden uddannelsesstart\n' +
    '- M\u00f8d dine kommende medstuderende\n' +
    '- Dine klasser t\u00e6ller med i dine tr\u00e6ningstimer\n' +
    'Start forberedelsesfasen: ' + programPageUrl + '\n';
}

// =========================================================================
// Schedule PDF attachment helper
// =========================================================================

/**
 * Look up schedule PDF URL from config by program type and cohort.
 * Falls back to 'default' if no cohort match.
 */
function getSchedulePdfUrl(programType, program) {
  const urls = SCHEDULE_PDFS[programType];
  if (!urls) return '';

  // Try to match cohort from program string
  const prog = (program || '').toLowerCase();
  for (const cohortKey of Object.keys(urls)) {
    if (cohortKey === 'default') continue;
    if (prog.includes(cohortKey.toLowerCase().split(' ')[0])) {
      return urls[cohortKey] || '';
    }
  }

  // Try keyword matching
  if (prog.includes('aug') || prog.includes('dec')) {
    for (const key of Object.keys(urls)) {
      if (key.toLowerCase().includes('aug') || key.toLowerCase().includes('dec')) return urls[key] || '';
    }
  }
  if (prog.includes('okt') || prog.includes('oct') || prog.includes('nov')) {
    for (const key of Object.keys(urls)) {
      if (key.toLowerCase().includes('okt') || key.toLowerCase().includes('oct')) return urls[key] || '';
    }
  }
  if (prog.includes('jul')) {
    for (const key of Object.keys(urls)) {
      if (key.toLowerCase().includes('jul')) return urls[key] || '';
    }
  }

  return urls['default'] || '';
}

async function fetchSchedulePdfAttachment(programType, program) {
  const url = getSchedulePdfUrl(programType, program);
  if (!url) return null;

  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    const filename = `yoga-bible-schedule-${programType}.pdf`;
    return { filename, content: buffer, contentType: 'application/pdf' };
  } catch (err) {
    console.error(`[lead-emails] Failed to fetch schedule PDF for ${programType}:`, err.message);
    return null;
  }
}

// =========================================================================
// Main router: sendWelcomeEmail
// =========================================================================

async function sendWelcomeEmail(leadData, action, tokenData = {}) {
  if (!leadData.email) {
    console.log('[lead-emails] No email for lead, skipping welcome email');
    return { success: false, reason: 'no_email' };
  }

  // Check if lead is unsubscribed
  if (leadData.unsubscribed) {
    console.log(`[lead-emails] Lead ${leadData.email} is unsubscribed, skipping`);
    return { success: false, reason: 'unsubscribed' };
  }

  try {
    // Waitlist 300h — bilingual, handles lang internally
    if (action === 'lead_waitlist_300h') {
      const result = await sendWaitlist300hEmail(leadData, tokenData);
      if (result && result.success) {
        await logWelcomeEmail(leadData.email, result.subject || 'Waitlist 300h email');
      }
      return result;
    }

    // Determine language — multi-layer detection
    // The old Facebook webhook stamped lang='da' on ALL leads, so lang field
    // and country detection (which uses lang as fallback) are unreliable.
    // Priority: form_id map → country/phone (no lang) → non-da rawLang → default da
    const rawLang = (leadData.lang || leadData.meta_lang || '').toLowerCase().trim();
    const formLang = FORM_LANG_MAP[leadData.meta_form_id];
    const hardCountryField = normalizeCountryName(leadData.country || leadData.city_country);
    const hardCountryPhone = !hardCountryField ? detectCountryFromPhone(leadData.phone) : null;
    const hardCountry = hardCountryField || hardCountryPhone;
    let lang, isDanish, isGerman;

    if (formLang) {
      lang = formLang.substring(0, 2);
      isDanish = ['da', 'dk'].includes(lang);
      isGerman = lang === 'de';
    } else if (hardCountry === 'DK') {
      isDanish = true; isGerman = false; lang = 'da';
    } else if (hardCountry && ['DE', 'AT', 'CH'].includes(hardCountry)) {
      isDanish = false; isGerman = true; lang = 'de';
    } else if (hardCountry && hardCountry !== 'OTHER') {
      isDanish = false; isGerman = false; lang = 'en';
    } else if (rawLang && rawLang !== 'da' && rawLang !== 'dk') {
      lang = rawLang.substring(0, 2);
      isDanish = false;
      isGerman = lang === 'de';
    } else {
      isDanish = true; isGerman = false; lang = 'da';
    }

    // German leads get DE templates (falling back to EN via i18n lookups)
    if (isGerman) {
      let result;
      const programKeyMap = {
        'lead_schedule_4w': '4-week', 'lead_schedule_4w-apr': '4-week',
        'lead_schedule_4w-jul': '4-week-jul', 'lead_schedule_8w': '8-week',
        'lead_schedule_18w': '18-week', 'lead_schedule_18w-mar': '18-week',
        'lead_schedule_18w-aug': '18-week-aug', 'lead_schedule_300h': '300h',
        'lead_schedule_50h': 'specialty', 'lead_schedule_30h': 'specialty'
      };

      // July Vinyasa Plus — use conditional German template
      var isJulyActionDe = action === 'lead_schedule_4w-jul' ||
        (action === 'lead_meta' && leadData.type === 'ytt' && leadData.ytt_program_type === '4-week-jul');
      if (isJulyActionDe) {
        result = await sendJulyVinyasaPlusDeEmail(leadData, tokenData);
      } else if (leadData.multi_format === 'Yes' && leadData.all_formats) {
        result = await sendMultiFormatEmail(leadData, 'de', tokenData);
      } else if (action === 'lead_schedule_multi') {
        result = await sendMultiFormatEmail(leadData, 'de', tokenData);
      } else if (action === 'lead_undecided') {
        result = await sendUndecidedEmail(leadData, 'de', tokenData);
      } else if (action === 'lead_courses') {
        result = await sendCoursesEmail(leadData, 'de', tokenData);
      } else if (action === 'lead_mentorship') {
        result = await sendMentorshipEmail(leadData, 'de', tokenData);
      } else if (programKeyMap[action]) {
        result = await sendProgramEmail(leadData, programKeyMap[action], 'de', tokenData);
      } else if (action === 'lead_meta' && leadData.type === 'ytt') {
        var metaKey = leadData.ytt_program_type || '4-week';
        if (!i18n.PROGRAMS[metaKey]) metaKey = '4-week';
        result = await sendProgramEmail(leadData, metaKey, 'de', tokenData);
      } else {
        result = await sendEmailGenericBilingual(leadData, 'de', tokenData);
      }
      if (result && result.success) {
        await logWelcomeEmail(leadData.email, result.subject || 'Welcome email (DE)');
      }
      return result;
    }

    // English leads get full English email templates matching Danish detail
    if (!isDanish) {
      let result;
      const programKeyMap = {
        'lead_schedule_4w': '4-week', 'lead_schedule_4w-apr': '4-week',
        'lead_schedule_4w-jul': '4-week-jul', 'lead_schedule_8w': '8-week',
        'lead_schedule_18w': '18-week', 'lead_schedule_18w-mar': '18-week',
        'lead_schedule_18w-aug': '18-week-aug', 'lead_schedule_300h': '300h',
        'lead_schedule_50h': 'specialty', 'lead_schedule_30h': 'specialty'
      };

      // July Vinyasa Plus — use conditional template with Q1/Q2/Q3/country blocks
      var isJulyAction = action === 'lead_schedule_4w-jul' ||
        (action === 'lead_meta' && leadData.type === 'ytt' && leadData.ytt_program_type === '4-week-jul');
      if (isJulyAction) {
        result = await sendJulyVinyasaPlusEnEmail(leadData, tokenData);
      } else if (leadData.multi_format === 'Yes' && leadData.all_formats) {
        result = await sendMultiFormatEmail(leadData, 'en', tokenData);
      } else if (action === 'lead_schedule_multi') {
        result = await sendMultiFormatEmail(leadData, 'en', tokenData);
      } else if (action === 'lead_undecided') {
        result = await sendUndecidedEmail(leadData, 'en', tokenData);
      } else if (action === 'lead_courses') {
        result = await sendCoursesEmail(leadData, 'en', tokenData);
      } else if (action === 'lead_mentorship') {
        result = await sendMentorshipEmail(leadData, 'en', tokenData);
      } else if (programKeyMap[action]) {
        result = await sendProgramEmail(leadData, programKeyMap[action], 'en', tokenData);
      } else if (action === 'lead_meta' && leadData.type === 'ytt') {
        // Meta YTT leads: detect program key from ytt_program_type
        var metaKey = leadData.ytt_program_type || '4-week';
        if (!i18n.PROGRAMS[metaKey]) metaKey = '4-week';
        result = await sendProgramEmail(leadData, metaKey, 'en', tokenData);
      } else {
        result = await sendEmailGenericBilingual(leadData, 'en', tokenData);
      }
      if (result && result.success) {
        await logWelcomeEmail(leadData.email, result.subject || 'Welcome email (EN)');
      }
      return result;
    }

    // Danish leads get detailed Danish program-specific emails
    // Multi-format request: user selected 2+ formats in the modal
    if (leadData.multi_format === 'Yes' && leadData.all_formats) {
      const result = await sendEmailMultiYTT(leadData, tokenData);
      if (result && result.success) {
        await logWelcomeEmail(leadData.email, result.subject || 'Multi-format welcome email');
      }
      return result;
    }

    let result;
    switch (action) {
      case 'lead_schedule_4w':
      case 'lead_schedule_4w-apr':
        result = await sendEmail4wYTT(leadData, tokenData);
        break;
      case 'lead_schedule_4w-jul':
        result = await sendJulyVinyasaPlusDaEmail(leadData, tokenData);
        break;
      case 'lead_schedule_8w':
        result = await sendEmail8wYTT(leadData, tokenData);
        break;
      case 'lead_schedule_18w':
      case 'lead_schedule_18w-mar':
        result = await sendEmail18wYTT(leadData, tokenData);
        break;
      case 'lead_schedule_18w-aug':
        result = await sendEmail18wAugYTT(leadData, tokenData);
        break;
      case 'lead_schedule_multi':
        result = await sendEmailMultiYTT(leadData, tokenData);
        break;
      case 'lead_schedule_300h':
        result = await sendEmail300hYTT(leadData, tokenData);
        break;
      case 'lead_waitlist_300h':
        result = await sendWaitlist300hEmail(leadData, tokenData);
        break;
      case 'lead_schedule_50h':
      case 'lead_schedule_30h':
        result = await sendEmailSpecialtyYTT(leadData, tokenData);
        break;
      case 'lead_courses':
        result = await sendEmailCourses(leadData, tokenData);
        break;
      case 'lead_mentorship':
        result = await sendEmailMentorship(leadData, tokenData);
        break;
      case 'lead_undecided':
        result = await sendEmailUndecidedYTT(leadData, tokenData);
        break;
      case 'lead_meta':
        result = await sendEmailGeneric(leadData, tokenData);
        break;
      case 'contact':
        result = await sendEmailGeneric(leadData, tokenData);
        break;
      default:
        result = await sendEmailGeneric(leadData, tokenData);
        break;
    }

    // Log to email_log + record sent timestamp on lead for timing signals
    if (result && result.success) {
      await logWelcomeEmail(leadData.email, result.subject || 'Welcome email');
      if (tokenData && tokenData.leadId) {
        const db = getDb();
        db.collection('leads').doc(tokenData.leadId).update({
          welcome_email_sent_at: new Date(),
          'email_engagement.welcome_sent_at': new Date()
        }).catch(() => {});
      }
    }

    return result;
  } catch (err) {
    console.error('[lead-emails] sendWelcomeEmail error:', err.message);
    return { success: false, error: err.message };
  }
}

async function logWelcomeEmail(to, subject) {
  try {
    const db = getDb();
    await db.collection('email_log').add({
      to,
      subject,
      template_id: 'auto_welcome',
      sent_at: new Date(),
      status: 'sent'
    });
  } catch (err) {
    console.error('[lead-emails] Failed to log welcome email:', err.message);
  }
}

// =========================================================================
// 4-Week YTT Email
// =========================================================================

async function sendEmail4wYTT(leadData, tokenData = {}) {
  const firstName = leadData.first_name || '';
  const program = leadData.program || '4-Week Intensive YTT';
  const needsHousing = (leadData.accommodation || '').toLowerCase() === 'yes';
  const cityCountry = leadData.city_country || '';
  const subject = firstName + ', her er alle datoer til 4-ugers yogauddannelsen';

  const isFebruary = program.toLowerCase().includes('feb');
  const fullPrice = isFebruary ? '20.750' : '23.750';
  const remaining = isFebruary ? '17.000' : '20.000';
  const discountNote = isFebruary ? ' (inkl. 3.000 kr. early bird-rabat)' : '';
  const rateNote = 'fleksibel ratebetaling';

  const scheduleUrl = tokenData.leadId && tokenData.token
    ? 'https://www.yogabible.dk/skema/4-uger/?tid=' + encodeURIComponent(tokenData.leadId) + '&tok=' + encodeURIComponent(tokenData.token)
    : 'https://www.yogabible.dk/skema/4-uger/';

  let bodyHtml = '<p>Hej ' + escapeHtml(firstName) + ',</p>';
  bodyHtml += '<p>Tak fordi du viste interesse for vores <strong>4-ugers intensive 200-timers yogal\u00e6reruddannelse</strong>.</p>';
  bodyHtml += '<p>Her finder du alle tr\u00e6ningsdage og tidspunkter for uddannelsen:</p>';
  bodyHtml += '<p style="margin:20px 0;"><a href="' + scheduleUrl + '" style="display:inline-block;background:#f75c03;color:#ffffff;padding:14px 28px;text-decoration:none;border-radius:50px;font-weight:600;font-size:16px;">Se skemaet \u2192</a></p>';
  bodyHtml += '<p style="font-size:14px;color:#666;">Du kan tilf\u00f8je alle datoer direkte til din kalender \u2014 og se pr\u00e6cis, hvad der sker hver dag i de 4 uger.</p>';

  bodyHtml += '<p style="margin-top:16px;">Det intensive format er til dig, der vil fordybe dig fuldt ud. P\u00e5 4 uger gennemf\u00f8rer du hele certificeringen med daglig tr\u00e6ning og teori \u2014 mange af vores dimittender fort\u00e6ller, at det intensive format hjalp dem med at l\u00e6re mere, fordi de var 100% dedikerede.</p>';
  bodyHtml += programHighlightsHtml();
  bodyHtml += '<p style="margin-top:12px;">Vi har uddannet yogal\u00e6rere siden 2014, og vores dimittender underviser i hele Europa og videre. Kan du ikke m\u00f8de op en dag, tilbyder vi online backup p\u00e5 udvalgte workshops.</p>';

  if (needsHousing) bodyHtml += getAccommodationSectionHtml(cityCountry);

  bodyHtml += '<div style="margin-top:20px;padding:14px;background:#FFFCF9;border-left:3px solid #f75c03;border-radius:4px;">';
  bodyHtml += '<strong>Pris:</strong> ' + fullPrice + ' kr.' + discountNote + '<br>';
  bodyHtml += '<strong>Forberedelsesfasen:</strong> 3.750 kr. sikrer din plads<br>';
  bodyHtml += '<strong>Rest:</strong> ' + remaining + ' kr. (' + rateNote + ')';
  bodyHtml += '</div>';

  bodyHtml += getPreparationPhaseHtml('https://www.yogabible.dk/200-hours-4-weeks-intensive-programs');

  bodyHtml += '<p style="margin-top:20px;"><a href="https://www.yogabible.dk/200-hours-4-weeks-intensive-programs" style="color:#f75c03;">L\u00e6s mere om 4-ugers programmet</a>';
  bodyHtml += ' \u00b7 <a href="https://www.yogabible.dk/om-200hrs-yogalaereruddannelser" style="color:#f75c03;">Om vores 200-timers uddannelse</a></p>';
  bodyHtml += bookingCta() + questionPrompt();
  bodyHtml += getEnglishNoteHtml() + getSignatureHtml() + getUnsubscribeFooterHtml(leadData.email);

  // Plain text
  let bodyPlain = 'Hej ' + firstName + ',\n\n';
  bodyPlain += 'Tak fordi du viste interesse for vores 4-ugers intensive 200-timers yogal\u00e6reruddannelse.\n\n';
  bodyPlain += 'Uddannelsesskema og datoer:\n' + scheduleUrl + '\n\n';
  bodyPlain += programHighlightsPlain();
  if (needsHousing) bodyPlain += getAccommodationSectionPlain(cityCountry);
  bodyPlain += '\nPris: ' + fullPrice + ' kr.' + discountNote + '\nForberedelsesfasen: 3.750 kr.\nRest: ' + remaining + ' kr. (' + rateNote + ')\n\n';
  bodyPlain += getPreparationPhasePlain('https://www.yogabible.dk/200-hours-4-weeks-intensive-programs');
  bodyPlain += '\nL\u00e6s mere: https://www.yogabible.dk/200-hours-4-weeks-intensive-programs\n';
  bodyPlain += 'Book infom\u00f8de: ' + CONFIG.MEETING_LINK + '\n';
  bodyPlain += getEnglishNotePlain() + getSignaturePlain() + getUnsubscribeFooterPlain(leadData.email);

  const result = await sendRawEmail({
    to: leadData.email,
    subject,
    html: wrapHtml(bodyHtml, (tokenData || {}).leadId, 'welcome'),
    text: bodyPlain
  });
  return { ...result, subject };
}

// =========================================================================
// 4-Week July (Vinyasa Plus) YTT Email
// =========================================================================

async function sendEmail4wJulyYTT(leadData, tokenData = {}) {
  const firstName = leadData.first_name || '';
  const needsHousing = (leadData.accommodation || '').toLowerCase() === 'yes';
  const cityCountry = leadData.city_country || '';
  const subject = firstName + ', her er alle datoer til 4-ugers Vinyasa Plus yogauddannelsen (juli)';

  const fullPrice = '23.750';
  const remaining = '20.000';
  const rateNote = 'fleksibel ratebetaling';

  // Non-CPH Danish leads get the enhanced EN schedule page (includes accommodation info)
  const isCph = i18n.isCopenhagenLead(leadData);
  const schedPath = isCph ? '/skema/4-uger-juli/' : '/en/schedule/4-weeks-july-plan/';
  const scheduleUrl = tokenData.leadId && tokenData.token
    ? 'https://www.yogabible.dk' + schedPath + '?tid=' + encodeURIComponent(tokenData.leadId) + '&tok=' + encodeURIComponent(tokenData.token)
    : 'https://www.yogabible.dk' + schedPath;

  let bodyHtml = '<p>Hej ' + escapeHtml(firstName) + ',</p>';
  bodyHtml += '<p>Tak fordi du viste interesse for vores <strong>4-ugers Vinyasa Plus yogal\u00e6reruddannelse</strong> (juli 2026).</p>';
  bodyHtml += '<p>Her finder du alle tr\u00e6ningsdage og tidspunkter for uddannelsen:</p>';
  bodyHtml += '<p style="margin:20px 0;"><a href="' + scheduleUrl + '" style="display:inline-block;background:#f75c03;color:#ffffff;padding:14px 28px;text-decoration:none;border-radius:50px;font-weight:600;font-size:16px;">Se skemaet \u2192</a></p>';
  bodyHtml += '<p style="font-size:14px;color:#666;">Du kan tilf\u00f8je alle datoer direkte til din kalender \u2014 og se pr\u00e6cis, hvad der sker hver dag i de 4 uger.</p>';

  bodyHtml += '<div style="margin:16px 0;padding:14px;background:#FFF7ED;border-left:3px solid #f75c03;border-radius:6px;">';
  bodyHtml += '<strong style="color:#c2410c;">Vinyasa Plus \u2014 hvad g\u00f8r dette hold s\u00e6rligt?</strong><br><br>';
  bodyHtml += '<strong>70% Vinyasa Flow:</strong> Kreativ sekvensering, klasseledelse og avancerede undervisningsteknikker<br>';
  bodyHtml += '<strong>30% Yin Yoga + Hot Yoga:</strong> Restitution, dybe stræk og undervisning i opvarmet milj\u00f8<br><br>';
  bodyHtml += 'Du bliver certificeret til at undervise b\u00e5de opvarmede og ikke-opvarmede Vinyasa-klasser samt Yin Yoga.';
  bodyHtml += '</div>';

  bodyHtml += programHighlightsHtml();

  if (needsHousing) bodyHtml += getAccommodationSectionHtml(cityCountry);

  bodyHtml += '<div style="margin-top:20px;padding:14px;background:#FFFCF9;border-left:3px solid #f75c03;border-radius:4px;">';
  bodyHtml += '<strong>Pris:</strong> ' + fullPrice + ' kr.<br>';
  bodyHtml += '<strong>Forberedelsesfasen:</strong> 3.750 kr. sikrer din plads<br>';
  bodyHtml += '<strong>Rest:</strong> ' + remaining + ' kr. (' + rateNote + ')';
  bodyHtml += '</div>';

  bodyHtml += getPreparationPhaseHtml('https://www.yogabible.dk/200-hours-4-weeks-intensive-programs');

  bodyHtml += '<p style="margin-top:20px;"><a href="https://www.yogabible.dk/200-hours-4-weeks-intensive-programs" style="color:#f75c03;">L\u00e6s mere om 4-ugers programmet</a>';
  bodyHtml += ' \u00b7 <a href="https://www.yogabible.dk/om-200hrs-yogalaereruddannelser" style="color:#f75c03;">Om vores 200-timers uddannelse</a></p>';
  bodyHtml += bookingCta() + questionPrompt();
  bodyHtml += getEnglishNoteHtml() + getSignatureHtml() + getUnsubscribeFooterHtml(leadData.email);

  // Plain text
  let bodyPlain = 'Hej ' + firstName + ',\n\n';
  bodyPlain += 'Tak fordi du viste interesse for vores 4-ugers Vinyasa Plus yogal\u00e6reruddannelse (juli 2026).\n\n';
  bodyPlain += 'Uddannelsesskema og datoer:\n' + scheduleUrl + '\n\n';
  bodyPlain += 'VINYASA PLUS \u2014 hvad g\u00f8r dette hold s\u00e6rligt?\n';
  bodyPlain += '70% Vinyasa Flow: Kreativ sekvensering, klasseledelse og undervisningsteknikker\n';
  bodyPlain += '30% Yin Yoga + Hot Yoga: Restitution og undervisning i opvarmet milj\u00f8\n\n';
  bodyPlain += programHighlightsPlain();
  if (needsHousing) bodyPlain += getAccommodationSectionPlain(cityCountry);
  bodyPlain += '\nPris: ' + fullPrice + ' kr.\nForberedelsesfasen: 3.750 kr.\nRest: ' + remaining + ' kr. (' + rateNote + ')\n\n';
  bodyPlain += getPreparationPhasePlain('https://www.yogabible.dk/200-hours-4-weeks-intensive-programs');
  bodyPlain += '\nL\u00e6s mere: https://www.yogabible.dk/200-hours-4-weeks-intensive-programs\n';
  bodyPlain += 'Book infom\u00f8de: ' + CONFIG.MEETING_LINK + '\n';
  bodyPlain += getEnglishNotePlain() + getSignaturePlain() + getUnsubscribeFooterPlain(leadData.email);

  const result = await sendRawEmail({
    to: leadData.email,
    subject,
    html: wrapHtml(bodyHtml, (tokenData || {}).leadId, 'welcome'),
    text: bodyPlain
  });
  return { ...result, subject };
}

// =========================================================================
// July Vinyasa Plus — Conditional Welcome Email (EN/DE/DA)
// New template with conditional blocks based on form answers (Q1–Q3),
// country-based travel/price blocks, and accommodation variants.
// =========================================================================

/**
 * Get localized Preparation Phase price string based on country code.
 */
function getLocalizedPrepPrice(country) {
  switch (country) {
    case 'NO': return '3,750 DKK (approx. 5,400 NOK)';
    case 'SE': return '3,750 DKK (approx. 5,600 SEK)';
    case 'DE': case 'AT': case 'CH': return '3.750 DKK (ca. 500 EUR)';
    case 'FI': return '3,750 DKK (approx. 500 EUR)';
    case 'NL': return '3,750 DKK (approx. 500 EUR)';
    case 'UK': return '3,750 DKK (approx. £425)';
    case 'DK': return '3.750 kr.';
    default:   return '3,750 DKK (approx. 500 EUR)';
  }
}

/**
 * Travel block — country-specific paragraph + "Discover Copenhagen" link.
 */
function julyTravelBlockHtml(country) {
  var text = '';
  switch (country) {
    case 'NO':
      text = 'Copenhagen is just a short flight from most Norwegian cities — many of our students fly in from Oslo, Bergen and Trondheim.';
      break;
    case 'SE':
      text = 'Copenhagen is right next door — a quick flight from Stockholm, or just 30 minutes by train from Malmö.';
      break;
    case 'DE': case 'AT':
      text = 'Copenhagen is well connected from all major German-speaking airports, with frequent direct flights.';
      break;
    case 'FI':
      text = 'Direct flights from Helsinki to Copenhagen take under two hours.';
      break;
    case 'NL':
      text = 'Copenhagen is just a short direct flight from Amsterdam and other Dutch airports.';
      break;
    case 'UK':
      text = 'Copenhagen is just a short direct flight from most UK airports — many of our students fly in from London, Manchester and Edinburgh.';
      break;
    case 'DK':
      return ''; // No travel block for Danish leads
    default:
      text = 'Copenhagen has direct flight connections from most major European cities.';
      break;
  }
  return '<p style="margin-top:16px;">' + text + '</p>' +
    '<p><a href="https://yogabible.dk/en/about-copenhagen/" style="color:#f75c03;">Discover Copenhagen →</a></p>';
}

/**
 * Accommodation block — conditional on Q2 answer.
 */
function julyAccommodationBlockHtml(accommodation) {
  if (accommodation === 'accommodation') {
    return '<div style="margin-top:16px;padding:14px;background:#E8F5E9;border-left:3px solid #4CAF50;border-radius:6px;">' +
      '<strong style="color:#2E7D32;">🏠 Accommodation</strong><br><br>' +
      'We can see you\'d like help with accommodation — great, we\'ve got you. Once you secure your spot through the Preparation Phase, we\'ll help you reserve accommodation in Copenhagen.<br><br>' +
      '<strong><a href="https://yogabible.dk/en/accommodation/" style="color:#f75c03;">See accommodation options →</a></strong><br>' +
      '<span style="color:#666;">Questions about housing? Just reply to this email.</span>' +
      '</div>';
  }
  if (accommodation === 'accommodation_plus') {
    return '<div style="margin-top:16px;padding:14px;background:#E8F5E9;border-left:3px solid #4CAF50;border-radius:6px;">' +
      '<strong style="color:#2E7D32;">🏠 Accommodation & Logistics</strong><br><br>' +
      'We can see you\'d like help with accommodation and logistics — great, we\'ve got you covered. Once you secure your spot through the Preparation Phase, we\'ll help you with accommodation, getting around Copenhagen, and everything else you need for your stay.<br><br>' +
      '<strong><a href="https://yogabible.dk/en/accommodation/" style="color:#f75c03;">See accommodation options →</a></strong><br>' +
      '<span style="color:#666;">Questions? Just reply to this email.</span>' +
      '</div>';
  }
  if (accommodation === 'self_arranged') {
    return '<p style="margin-top:16px;color:#666;">If you change your mind about accommodation, we\'re always happy to help. <a href="https://yogabible.dk/en/accommodation/" style="color:#f75c03;">See accommodation options →</a></p>';
  }
  // lives_in_denmark, lives_in_copenhagen → no accommodation block
  return '';
}

/**
 * Preparation Phase block — conditional on Q2 answer + localized price.
 */
function julyPrepPhaseBlockHtml(accommodation, localizedPrice) {
  var html = '<div style="margin-top:16px;padding:16px;background:#F0FDF4;border-left:3px solid #22C55E;border-radius:6px;">';
  html += '<strong style="color:#166534;">💡 Secure your spot</strong><br><br>';

  if (accommodation === 'accommodation' || accommodation === 'accommodation_plus' || accommodation === 'self_arranged') {
    html += 'The Preparation Phase (' + localizedPrice + ') reserves your place in the July cohort. You\'ll get access to the member area with optional study materials to help you prepare. Once paid, we can also help you reserve accommodation in Copenhagen. The Preparation Phase is fully refundable if the course is cancelled.<br><br>';
    html += '✅ Secures your place in the July cohort<br>';
    html += '✅ Access to member area with preparation materials<br>';
    html += '✅ We help you reserve accommodation once enrolled<br>';
    html += '✅ Fully refundable if the course is cancelled<br>';
  } else if (accommodation === 'lives_in_denmark') {
    html += 'The Preparation Phase (' + localizedPrice + ') reserves your place in the July cohort. You\'ll get access to the member area with optional study materials to help you prepare. The Preparation Phase is fully refundable if the course is cancelled.<br><br>';
    html += '✅ Secures your place in the July cohort<br>';
    html += '✅ Access to member area with preparation materials<br>';
    html += '✅ Fully refundable if the course is cancelled<br>';
  } else if (accommodation === 'lives_in_copenhagen') {
    html += 'The Preparation Phase (' + localizedPrice + ') reserves your place in the July cohort. You\'ll get access to the member area with optional study materials to help you prepare. You can also start practising at our studio in Christianshavn right away — the more hours you complete before July, the stronger your foundation will be. The Preparation Phase is fully refundable if the course is cancelled.<br><br>';
    html += '✅ Secures your place in the July cohort<br>';
    html += '✅ Start practising at the studio straight away<br>';
    html += '✅ Access to member area with preparation materials<br>';
    html += '✅ Fully refundable if the course is cancelled<br>';
  } else {
    // Fallback — no Q2 answer (generic international)
    html += 'The Preparation Phase (' + localizedPrice + ') reserves your place in the July cohort. You\'ll get access to the member area with optional study materials to help you prepare. The Preparation Phase is fully refundable if the course is cancelled.<br><br>';
    html += '✅ Secures your place in the July cohort<br>';
    html += '✅ Access to member area with preparation materials<br>';
    html += '✅ Fully refundable if the course is cancelled<br>';
  }

  html += '<br><a href="https://www.yogabible.dk/en/schedule/4-weeks-july-plan/?product=100211" style="display:inline-block;background:#f75c03;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:50px;font-weight:600;font-size:16px;">Start Preparation Phase →</a>';
  html += '</div>';
  return html;
}

/**
 * Bilingual signature for July emails — "Healthy regards" for all languages.
 */
function julySignatureHtml() {
  var orange = '#f75c03';
  return '<div style="margin-top:18px;padding-top:14px;border-top:1px solid #EBE7E3;font-size:15px;line-height:1.55;color:#1a1a1a;">' +
    '<div style="margin:0 0 2px;">Healthy regards,</div>' +
    '<div style="margin:0 0 2px;"><strong>Shamir</strong> — Course Director</div>' +
    '<div style="margin:0 0 2px;">Yoga Bible</div>' +
    '<div style="margin:0 0 2px;"><a href="https://www.yogabible.dk" style="color:' + orange + ';text-decoration:none;">www.yogabible.dk</a></div>' +
    '<div style="margin:0 0 2px;"><a href="' + CONFIG.STUDIO_MAPS_URL + '" target="_blank" style="color:' + orange + ';text-decoration:none;">Torvegade 66, 1400 København K, Danmark</a></div>' +
    '<div style="margin:0;"><a href="tel:+4553881209" style="color:' + orange + ';text-decoration:none;">+45 53 88 12 09</a></div>' +
    '</div>';
}

/**
 * Bilingual unsubscribe footer for July emails.
 */
function julyUnsubscribeHtml(email, lang) {
  var url = buildUnsubscribeUrl(email);
  var text;
  if (lang === 'de') {
    text = 'Keine weiteren E-Mails erhalten? <a href="' + url + '" style="color:#999;text-decoration:none;">Hier abmelden</a>';
  } else if (lang === 'da') {
    text = 'Ønsker du ikke at modtage flere e-mails? <a href="' + url + '" style="color:#999;text-decoration:none;">Afmeld her</a>';
  } else {
    text = 'Don\'t want to receive more emails? <a href="' + url + '" style="color:#999;text-decoration:none;">Unsubscribe here</a>';
  }
  return '<div style="margin-top:24px;padding-top:12px;border-top:1px solid #EBE7E3;text-align:center;font-size:11px;color:#999;">' + text + '</div>';
}

/**
 * July Vinyasa Plus — English conditional email template.
 * Used for lang = en, no, sv, fi, nl (all non-DE, non-DA leads).
 * Conditional blocks based on Q1 (yoga experience), Q2 (accommodation),
 * Q3 (English comfort), and country (travel + price localization).
 */
async function sendJulyVinyasaPlusEnEmail(leadData, tokenData) {
  var firstName = leadData.first_name || '';
  var country = (leadData.country || 'OTHER').toUpperCase();
  var yogaExp = leadData.yoga_experience || '';
  var accommodation = leadData.accommodation || '';
  var englishComfort = leadData.english_comfort || '';
  var lang = (leadData.lang || leadData.meta_lang || 'en').toLowerCase().substring(0, 2);

  var subject = firstName + ', here are all the dates for the 4-week Vinyasa Plus training (July)';

  // Schedule URL (tokenized) — points to the international planning page
  var sUrl = tokenData && tokenData.leadId && tokenData.token
    ? 'https://yogabible.dk/en/schedule/4-weeks-july-plan/?tid=' + encodeURIComponent(tokenData.leadId) + '&tok=' + encodeURIComponent(tokenData.token)
    : 'https://yogabible.dk/en/schedule/4-weeks-july-plan/';

  var localizedPrice = getLocalizedPrepPrice(country);

  // ---- HTML ----
  var html = '';

  // Block 1: Greeting
  html += '<p>Hi ' + escapeHtml(firstName) + ',</p>';

  // Block 2: Thank you
  html += '<p>Thank you for your interest in our <strong>4-Week Vinyasa Plus Yoga Teacher Training</strong> (July 2026).</p>';

  // Block 3: Schedule CTA
  html += '<p>Here are all the training days and times:</p>';
  html += '<p style="margin:20px 0;"><a href="' + sUrl + '" style="display:inline-block;background:#f75c03;color:#ffffff;padding:14px 28px;text-decoration:none;border-radius:50px;font-weight:600;font-size:16px;">View your schedule →</a></p>';
  html += '<p style="font-size:14px;color:#666;">You can add all dates directly to your calendar.</p>';

  // Block 4: Vinyasa Plus detail box
  html += '<div style="margin:16px 0;padding:14px;background:#FFF7ED;border-left:3px solid #f75c03;border-radius:6px;">';
  html += '<strong style="color:#c2410c;">What is the Vinyasa Plus format?</strong><br><br>';
  html += '<strong>70% Vinyasa Flow</strong> — creative sequencing, class leadership and advanced teaching techniques<br>';
  html += '<strong>30% Yin Yoga + Hot Yoga</strong> — restoration, deep stretches and teaching in a heated environment<br><br>';
  html += 'You will be certified to teach both non-heated and heated Vinyasa, Yin and Hot Yoga classes.<br><br>';
  html += '<a href="https://yogabible.dk/en/yoga-journal/vinyasa-plus-metoden/" style="color:#f75c03;">Read more about the Vinyasa Plus method →</a>';
  html += '</div>';

  // Block 5: Program highlights
  html += '<p style="margin-top:16px;">About the training:</p>';
  html += '<ul style="margin:8px 0;padding-left:20px;color:#333;">';
  html += '<li>200 hours · Yoga Alliance certified (RYT-200)</li>';
  html += '<li>Vinyasa Flow, Yin Yoga, Hot Yoga & Meditation</li>';
  html += '<li>Anatomy, philosophy, sequencing & teaching methodology</li>';
  html += '<li>Certified to teach both non-heated and hot yoga classes</li>';
  html += '<li>All levels welcome</li>';
  html += '</ul>';

  // Block 6: Yoga experience (conditional on Q1)
  if (yogaExp === 'regular') {
    html += '<p style="margin-top:16px;">Great — your existing practice gives you a strong foundation. The training will deepen your understanding and add teaching methodology, sequencing and anatomy to what you already know.</p>';
  } else if (yogaExp === 'beginner') {
    html += '<p style="margin-top:16px;">You\'re welcome exactly as you are. Many of our graduates started in the same place. The Preparation Phase gives you time to build strength, flexibility and confidence before training starts in July.</p>';
  } else if (yogaExp === 'previous_ytt') {
    html += '<p style="margin-top:16px;">Welcome back to the mat. Vinyasa Plus will add a new dimension to your teaching — especially the 70/30 flow-to-yin ratio and heated teaching techniques.</p>';
  }

  // Block 7: English comfort (only if lang ≠ en, lang ≠ da, and Q3 answer exists)
  if (lang !== 'en' && lang !== 'da' && englishComfort) {
    if (englishComfort === 'needs_patience') {
      html += '<p style="margin-top:16px;">Don\'t worry — the English we use is clear and practical, not academic. Your classmates will be international too, so everyone supports each other. We go at a pace that works for the whole group.</p>';
    } else if (englishComfort === 'unsure') {
      html += '<p style="margin-top:16px;">We completely understand. The English we use is clear and practical, not academic. Many of our graduates had the same concern before starting — and it was never an issue. Your classmates will be international too, so everyone supports each other. If you\'d like to talk about this, just reply to this email.</p>';
    }
    // comfortable → do not show this block
  }

  // Block 8: Alumni note
  html += '<p style="margin-top:12px;">We have trained yoga teachers since 2014, and our graduates teach across Europe and beyond.</p>';

  // Block 9: Travel block (conditional on country)
  html += julyTravelBlockHtml(country);

  // Block 10: Accommodation block (conditional on Q2)
  html += julyAccommodationBlockHtml(accommodation);

  // Block 11: Preparation Phase (conditional on Q2 + localized price)
  html += julyPrepPhaseBlockHtml(accommodation, localizedPrice);

  // Block 12: Booking CTA
  html += '<p style="margin-top:20px;">Want to learn more or ask questions? Book a free online consultation:</p>';
  html += '<p style="margin:16px 0;"><a href="https://yogabible.dk/en/200-hours-4-weeks-intensive-programs/?booking=consultation" style="display:inline-block;background:#f75c03;color:#ffffff;padding:14px 28px;text-decoration:none;border-radius:50px;font-weight:600;font-size:16px;">Book a Free Online Consultation →</a></p>';

  // Block 13: Signature
  html += julySignatureHtml();

  // Block 14: Unsubscribe
  html += julyUnsubscribeHtml(leadData.email, lang);

  // ---- Plain text ----
  var plain = 'Hi ' + firstName + ',\n\n';
  plain += 'Thank you for your interest in our 4-Week Vinyasa Plus Yoga Teacher Training (July 2026).\n\n';
  plain += 'Here are all the training days and times:\n' + sUrl + '\nYou can add all dates directly to your calendar.\n\n';
  plain += 'What is the Vinyasa Plus format?\n';
  plain += '70% Vinyasa Flow — creative sequencing, class leadership and advanced teaching techniques\n';
  plain += '30% Yin Yoga + Hot Yoga — restoration, deep stretches and teaching in a heated environment\n';
  plain += 'You will be certified to teach both non-heated and heated Vinyasa, Yin and Hot Yoga classes.\n\n';
  plain += 'About the training:\n';
  plain += '• 200 hours · Yoga Alliance certified (RYT-200)\n';
  plain += '• Vinyasa Flow, Yin Yoga, Hot Yoga & Meditation\n';
  plain += '• Anatomy, philosophy, sequencing & teaching methodology\n';
  plain += '• Certified to teach both non-heated and hot yoga classes\n';
  plain += '• All levels welcome\n\n';
  if (yogaExp === 'regular') {
    plain += 'Great — your existing practice gives you a strong foundation. The training will deepen your understanding and add teaching methodology, sequencing and anatomy to what you already know.\n\n';
  } else if (yogaExp === 'beginner') {
    plain += 'You\'re welcome exactly as you are. Many of our graduates started in the same place. The Preparation Phase gives you time to build strength, flexibility and confidence before training starts in July.\n\n';
  } else if (yogaExp === 'previous_ytt') {
    plain += 'Welcome back to the mat. Vinyasa Plus will add a new dimension to your teaching — especially the 70/30 flow-to-yin ratio and heated teaching techniques.\n\n';
  }
  if (lang !== 'en' && lang !== 'da' && englishComfort === 'needs_patience') {
    plain += 'Don\'t worry — the English we use is clear and practical, not academic. Your classmates will be international too, so everyone supports each other.\n\n';
  } else if (lang !== 'en' && lang !== 'da' && englishComfort === 'unsure') {
    plain += 'We completely understand. The English we use is clear and practical, not academic. Many of our graduates had the same concern before starting — and it was never an issue.\n\n';
  }
  plain += 'We have trained yoga teachers since 2014, and our graduates teach across Europe and beyond.\n\n';
  plain += 'Secure your spot: The Preparation Phase (' + localizedPrice + ') reserves your place in the July cohort.\n';
  plain += 'Start Preparation Phase: https://www.yogabible.dk/en/schedule/4-weeks-july-plan/?product=100211\n\n';
  plain += 'Book a Free Online Consultation: https://yogabible.dk/en/200-hours-4-weeks-intensive-programs/?booking=consultation\n\n';
  plain += 'Healthy regards,\nShamir — Course Director\nYoga Bible\nwww.yogabible.dk\nTorvegade 66, 1400 København K, Danmark\n+45 53 88 12 09\n';
  plain += '\n---\nUnsubscribe: ' + buildUnsubscribeUrl(leadData.email);

  var result = await sendRawEmail({
    to: leadData.email,
    subject: subject,
    html: wrapHtml(html),
    text: plain
  });
  return { ...result, subject: subject };
}

/**
 * July Vinyasa Plus — German conditional email template.
 * Used for lang = de (and AT/CH leads).
 */
async function sendJulyVinyasaPlusDeEmail(leadData, tokenData) {
  var firstName = leadData.first_name || '';
  var country = (leadData.country || 'OTHER').toUpperCase();
  var yogaExp = leadData.yoga_experience || '';
  var accommodation = leadData.accommodation || '';
  var englishComfort = leadData.english_comfort || '';

  var subject = firstName + ', hier sind alle Termine für die 4-Wochen Vinyasa Plus Ausbildung (Juli)';

  var sUrl = tokenData && tokenData.leadId && tokenData.token
    ? 'https://yogabible.dk/en/schedule/4-weeks-july-plan/?tid=' + encodeURIComponent(tokenData.leadId) + '&tok=' + encodeURIComponent(tokenData.token)
    : 'https://yogabible.dk/en/schedule/4-weeks-july-plan/';

  var localizedPrice = getLocalizedPrepPrice(country);

  var html = '';

  // Block 1: Greeting
  html += '<p>Hej ' + escapeHtml(firstName) + ',</p>';

  // Block 2: Thank you + language note
  html += '<p>Vielen Dank für dein Interesse an unserer <strong>4-wöchigen Vinyasa Plus Yogalehrerausbildung</strong> (Juli 2026).</p>';
  html += '<p>Ich schreibe dir auf Deutsch, damit du dich direkt wohlfühlst — im Alltag spreche ich Englisch, und du kannst mir jederzeit auf Deutsch oder Englisch antworten.</p>';

  // Block 3: Schedule CTA
  html += '<p>Hier sind alle Trainingstage und -zeiten:</p>';
  html += '<p style="margin:20px 0;"><a href="' + sUrl + '" style="display:inline-block;background:#f75c03;color:#ffffff;padding:14px 28px;text-decoration:none;border-radius:50px;font-weight:600;font-size:16px;">Deinen Stundenplan ansehen →</a></p>';
  html += '<p style="font-size:14px;color:#666;">Du kannst alle Termine direkt in deinen Kalender übernehmen.</p>';

  // Block 4: Vinyasa Plus detail box
  html += '<div style="margin:16px 0;padding:14px;background:#FFF7ED;border-left:3px solid #f75c03;border-radius:6px;">';
  html += '<strong style="color:#c2410c;">Was ist das Vinyasa Plus Format?</strong><br><br>';
  html += '<strong>70% Vinyasa Flow</strong> — kreatives Sequencing, Klassenleitung und fortgeschrittene Unterrichtstechniken<br>';
  html += '<strong>30% Yin Yoga + Hot Yoga</strong> — Regeneration, tiefe Dehnungen und Unterrichten in einer beheizten Umgebung<br><br>';
  html += 'Du wirst zertifiziert, um sowohl unbeheizte als auch beheizte Vinyasa-, Yin- und Hot-Yoga-Stunden zu unterrichten.<br><br>';
  html += '<a href="https://yogabible.dk/en/yoga-journal/vinyasa-plus-metoden/" style="color:#f75c03;">Mehr über die Vinyasa Plus Methode erfahren →</a>';
  html += '</div>';

  // Block 5: Program highlights
  html += '<p style="margin-top:16px;">Über die Ausbildung:</p>';
  html += '<ul style="margin:8px 0;padding-left:20px;color:#333;">';
  html += '<li>200 Stunden · Yoga Alliance zertifiziert (RYT-200)</li>';
  html += '<li>Vinyasa Flow, Yin Yoga, Hot Yoga & Meditation</li>';
  html += '<li>Anatomie, Philosophie, Sequencing & Unterrichtsmethodik</li>';
  html += '<li>Zertifiziert für unbeheizten und Hot-Yoga-Unterricht</li>';
  html += '<li>Alle Levels willkommen</li>';
  html += '</ul>';

  // Block 6: Yoga experience (conditional)
  if (yogaExp === 'regular') {
    html += '<p style="margin-top:16px;">Super — deine bestehende Praxis gibt dir eine starke Grundlage. Die Ausbildung vertieft dein Verständnis und fügt Unterrichtsmethodik, Sequencing und Anatomie zu dem hinzu, was du bereits weißt.</p>';
  } else if (yogaExp === 'beginner') {
    html += '<p style="margin-top:16px;">Du bist genau richtig, so wie du bist. Viele unserer Absolventen haben an derselben Stelle angefangen. Die Vorbereitungsphase gibt dir Zeit, Kraft, Flexibilität und Selbstvertrauen aufzubauen, bevor das Training im Juli beginnt.</p>';
  } else if (yogaExp === 'previous_ytt') {
    html += '<p style="margin-top:16px;">Willkommen zurück auf der Matte. Vinyasa Plus wird deinem Unterrichten eine neue Dimension verleihen — besonders das 70/30-Verhältnis von Flow zu Yin und die Techniken für beheizten Unterricht.</p>';
  }

  // Block 7: English comfort (conditional — DE always has Q3)
  if (englishComfort === 'needs_patience') {
    html += '<p style="margin-top:16px;">Keine Sorge — das Englisch, das wir verwenden, ist klar und praktisch, nicht akademisch. Deine Mitschüler werden ebenfalls international sein, sodass sich alle gegenseitig unterstützen. Wir gehen in einem Tempo vor, das für die ganze Gruppe passt.</p>';
  } else if (englishComfort === 'unsure') {
    html += '<p style="margin-top:16px;">Das verstehen wir vollkommen. Das Englisch, das wir verwenden, ist klar und praktisch, nicht akademisch. Viele unserer Absolventen hatten vor dem Start dieselbe Sorge — und es war nie ein Problem. Deine Mitschüler werden ebenfalls international sein, sodass sich alle gegenseitig unterstützen. Wenn du darüber sprechen möchtest, antworte einfach auf diese E-Mail.</p>';
  }
  // comfortable → do not show

  // Block 8: Alumni note
  html += '<p style="margin-top:12px;">Wir bilden seit 2014 Yogalehrer aus, und unsere Absolventen unterrichten in ganz Europa und darüber hinaus.</p>';

  // Block 9: Travel block
  var travelText = '';
  if (country === 'DE') {
    travelText = 'Kopenhagen ist von allen großen deutschen Flughäfen gut erreichbar, mit regelmäßigen Direktflügen.';
  } else if (country === 'AT') {
    travelText = 'Kopenhagen ist von Wien und anderen österreichischen Flughäfen leicht erreichbar, mit regelmäßigen Direktflügen.';
  } else if (country !== 'DK') {
    travelText = 'Kopenhagen hat direkte Flugverbindungen von den meisten großen europäischen Städten.';
  }
  if (travelText) {
    html += '<p style="margin-top:16px;">' + travelText + '</p>';
    html += '<p><a href="https://yogabible.dk/en/about-copenhagen/" style="color:#f75c03;">Kopenhagen entdecken →</a></p>';
  }

  // Block 10: Accommodation block
  if (accommodation === 'accommodation') {
    html += '<div style="margin-top:16px;padding:14px;background:#E8F5E9;border-left:3px solid #4CAF50;border-radius:6px;">';
    html += '<strong style="color:#2E7D32;">🏠 Unterkunft</strong><br><br>';
    html += 'Wir sehen, dass du Hilfe bei der Unterkunft wünschst — super, wir kümmern uns darum. Sobald du deinen Platz über die Vorbereitungsphase gesichert hast, helfen wir dir, eine Unterkunft in Kopenhagen zu reservieren.<br><br>';
    html += '<strong><a href="https://yogabible.dk/en/accommodation/" style="color:#f75c03;">Unterkunftsoptionen ansehen →</a></strong><br>';
    html += '<span style="color:#666;">Fragen zur Unterkunft? Antworte einfach auf diese E-Mail.</span>';
    html += '</div>';
  } else if (accommodation === 'accommodation_plus') {
    html += '<div style="margin-top:16px;padding:14px;background:#E8F5E9;border-left:3px solid #4CAF50;border-radius:6px;">';
    html += '<strong style="color:#2E7D32;">🏠 Unterkunft & Logistik</strong><br><br>';
    html += 'Wir sehen, dass du Hilfe bei Unterkunft und Logistik wünschst — super, wir kümmern uns um alles. Sobald du deinen Platz über die Vorbereitungsphase gesichert hast, helfen wir dir mit Unterkunft, Fortbewegung in Kopenhagen und allem anderen, was du für deinen Aufenthalt brauchst.<br><br>';
    html += '<strong><a href="https://yogabible.dk/en/accommodation/" style="color:#f75c03;">Unterkunftsoptionen ansehen →</a></strong><br>';
    html += '<span style="color:#666;">Fragen? Antworte einfach auf diese E-Mail.</span>';
    html += '</div>';
  } else if (accommodation === 'self_arranged') {
    html += '<p style="margin-top:16px;color:#666;">Falls du es dir mit der Unterkunft anders überlegst, helfen wir dir gerne. <a href="https://yogabible.dk/en/accommodation/" style="color:#f75c03;">Unterkunftsoptionen ansehen →</a></p>';
  }
  // lives_in_denmark, lives_in_copenhagen → no accommodation block

  // Block 11: Preparation Phase
  html += '<div style="margin-top:16px;padding:16px;background:#F0FDF4;border-left:3px solid #22C55E;border-radius:6px;">';
  html += '<strong style="color:#166534;">💡 Sichere deinen Platz</strong><br><br>';

  if (accommodation === 'accommodation' || accommodation === 'accommodation_plus' || accommodation === 'self_arranged') {
    html += 'Die Vorbereitungsphase (' + localizedPrice + ') reserviert deinen Platz im Juli-Kurs. Du erhältst Zugang zum Mitgliederbereich mit optionalen Lernmaterialien zur Vorbereitung. Nach der Zahlung helfen wir dir auch, eine Unterkunft in Kopenhagen zu reservieren. Die Vorbereitungsphase ist vollständig erstattbar, falls der Kurs abgesagt wird.<br><br>';
    html += '✅ Sichert deinen Platz im Juli-Kurs<br>';
    html += '✅ Zugang zum Mitgliederbereich mit Vorbereitungsmaterialien<br>';
    html += '✅ Wir helfen dir, eine Unterkunft zu reservieren<br>';
    html += '✅ Vollständig erstattbar, falls der Kurs abgesagt wird<br>';
  } else if (accommodation === 'lives_in_copenhagen') {
    html += 'Die Vorbereitungsphase (' + localizedPrice + ') reserviert deinen Platz im Juli-Kurs. Du erhältst Zugang zum Mitgliederbereich mit optionalen Lernmaterialien zur Vorbereitung. Du kannst auch sofort in unserem Studio in Christianshavn mit dem Üben beginnen — je mehr Stunden du vor Juli absolvierst, desto stärker ist dein Fundament. Die Vorbereitungsphase ist vollständig erstattbar, falls der Kurs abgesagt wird.<br><br>';
    html += '✅ Sichert deinen Platz im Juli-Kurs<br>';
    html += '✅ Sofort im Studio üben<br>';
    html += '✅ Zugang zum Mitgliederbereich mit Vorbereitungsmaterialien<br>';
    html += '✅ Vollständig erstattbar, falls der Kurs abgesagt wird<br>';
  } else {
    // lives_in_denmark or fallback
    html += 'Die Vorbereitungsphase (' + localizedPrice + ') reserviert deinen Platz im Juli-Kurs. Du erhältst Zugang zum Mitgliederbereich mit optionalen Lernmaterialien zur Vorbereitung. Die Vorbereitungsphase ist vollständig erstattbar, falls der Kurs abgesagt wird.<br><br>';
    html += '✅ Sichert deinen Platz im Juli-Kurs<br>';
    html += '✅ Zugang zum Mitgliederbereich mit Vorbereitungsmaterialien<br>';
    html += '✅ Vollständig erstattbar, falls der Kurs abgesagt wird<br>';
  }

  html += '<br><a href="https://www.yogabible.dk/en/schedule/4-weeks-july-plan/?product=100211" style="display:inline-block;background:#f75c03;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:50px;font-weight:600;font-size:16px;">Vorbereitungsphase starten →</a>';
  html += '</div>';

  // Block 12: Booking CTA
  html += '<p style="margin-top:20px;">Möchtest du mehr erfahren oder Fragen stellen? Buche ein kostenloses Online-Gespräch:</p>';
  html += '<p style="margin:16px 0;"><a href="https://yogabible.dk/en/200-hours-4-weeks-intensive-programs/?booking=consultation" style="display:inline-block;background:#f75c03;color:#ffffff;padding:14px 28px;text-decoration:none;border-radius:50px;font-weight:600;font-size:16px;">Kostenloses Online-Gespräch buchen →</a></p>';

  // Block 13: Signature
  html += julySignatureHtml();

  // Block 14: Unsubscribe
  html += julyUnsubscribeHtml(leadData.email, 'de');

  // ---- Plain text ----
  var plain = 'Hej ' + firstName + ',\n\n';
  plain += 'Vielen Dank für dein Interesse an unserer 4-wöchigen Vinyasa Plus Yogalehrerausbildung (Juli 2026).\n\n';
  plain += 'Ich schreibe dir auf Deutsch, damit du dich direkt wohlfühlst — im Alltag spreche ich Englisch, und du kannst mir jederzeit auf Deutsch oder Englisch antworten.\n\n';
  plain += 'Hier sind alle Trainingstage und -zeiten:\n' + sUrl + '\nDu kannst alle Termine direkt in deinen Kalender übernehmen.\n\n';
  plain += 'Was ist das Vinyasa Plus Format?\n';
  plain += '70% Vinyasa Flow — kreatives Sequencing, Klassenleitung und fortgeschrittene Unterrichtstechniken\n';
  plain += '30% Yin Yoga + Hot Yoga — Regeneration, tiefe Dehnungen und Unterrichten in einer beheizten Umgebung\n\n';
  plain += 'Über die Ausbildung:\n';
  plain += '• 200 Stunden · Yoga Alliance zertifiziert (RYT-200)\n';
  plain += '• Vinyasa Flow, Yin Yoga, Hot Yoga & Meditation\n';
  plain += '• Anatomie, Philosophie, Sequencing & Unterrichtsmethodik\n';
  plain += '• Alle Levels willkommen\n\n';
  plain += 'Wir bilden seit 2014 Yogalehrer aus, und unsere Absolventen unterrichten in ganz Europa und darüber hinaus.\n\n';
  plain += 'Sichere deinen Platz: Vorbereitungsphase (' + localizedPrice + ')\n';
  plain += 'Vorbereitungsphase starten: https://www.yogabible.dk/en/schedule/4-weeks-july-plan/?product=100211\n\n';
  plain += 'Kostenloses Online-Gespräch buchen: https://yogabible.dk/en/200-hours-4-weeks-intensive-programs/?booking=consultation\n\n';
  plain += 'Healthy regards,\nShamir — Course Director\nYoga Bible\nwww.yogabible.dk\nTorvegade 66, 1400 København K, Danmark\n+45 53 88 12 09\n';
  plain += '\n---\nAbmelden: ' + buildUnsubscribeUrl(leadData.email);

  var result = await sendRawEmail({
    to: leadData.email,
    subject: subject,
    html: wrapHtml(html),
    text: plain
  });
  return { ...result, subject: subject };
}

/**
 * July Vinyasa Plus — Danish conditional email template.
 * Used for lang = da. All links use Danish URLs (no /en/ prefix).
 */
async function sendJulyVinyasaPlusDaEmail(leadData, tokenData) {
  var firstName = leadData.first_name || '';
  var yogaExp = leadData.yoga_experience || '';
  var accommodation = leadData.accommodation || '';
  var cityCountry = (leadData.city_country || '').toLowerCase();

  var subject = firstName + ', her er alle datoer til 4-ugers Vinyasa Plus uddannelsen (juli)';

  var sUrl = tokenData && tokenData.leadId && tokenData.token
    ? 'https://yogabible.dk/skema/4-uger-juli/?tid=' + encodeURIComponent(tokenData.leadId) + '&tok=' + encodeURIComponent(tokenData.token)
    : 'https://yogabible.dk/skema/4-uger-juli/';

  var html = '';

  // Block 1: Greeting
  html += '<p>Hej ' + escapeHtml(firstName) + ',</p>';

  // Block 2: Thank you
  html += '<p>Tak for din interesse i vores <strong>4-ugers Vinyasa Plus yogalæreruddannelse</strong> (juli 2026).</p>';

  // Block 3: Schedule CTA
  html += '<p>Her er alle træningsdage og -tidspunkter:</p>';
  html += '<p style="margin:20px 0;"><a href="' + sUrl + '" style="display:inline-block;background:#f75c03;color:#ffffff;padding:14px 28px;text-decoration:none;border-radius:50px;font-weight:600;font-size:16px;">Se din tidsplan →</a></p>';
  html += '<p style="font-size:14px;color:#666;">Du kan tilføje alle datoer direkte i din kalender.</p>';

  // Block 4: Vinyasa Plus detail box
  html += '<div style="margin:16px 0;padding:14px;background:#FFF7ED;border-left:3px solid #f75c03;border-radius:6px;">';
  html += '<strong style="color:#c2410c;">Hvad er Vinyasa Plus-formatet?</strong><br><br>';
  html += '<strong>70% Vinyasa Flow</strong> — kreativ sequencing, klasseledelse og avancerede undervisningsteknikker<br>';
  html += '<strong>30% Yin Yoga + Hot Yoga</strong> — restitution, dybe stræk og undervisning i et opvarmet miljø<br><br>';
  html += 'Du bliver certificeret til at undervise i både uopvarmede og opvarmede Vinyasa-, Yin- og Hot Yoga-klasser.<br><br>';
  html += '<a href="https://yogabible.dk/yoga-journal/vinyasa-plus-metoden/" style="color:#f75c03;">Læs mere om Vinyasa Plus-metoden →</a>';
  html += '</div>';

  // Block 5: Program highlights
  html += '<p style="margin-top:16px;">Om uddannelsen:</p>';
  html += '<ul style="margin:8px 0;padding-left:20px;color:#333;">';
  html += '<li>200 timer · Yoga Alliance-certificeret (RYT-200)</li>';
  html += '<li>Vinyasa Flow, Yin Yoga, Hot Yoga & Meditation</li>';
  html += '<li>Anatomi, filosofi, sequencing & undervisningsmetodik</li>';
  html += '<li>Certificeret til at undervise både uopvarmet og hot yoga</li>';
  html += '<li>Alle niveauer er velkomne</li>';
  html += '</ul>';

  // Block 6: Yoga experience (conditional)
  if (yogaExp === 'regular') {
    html += '<p style="margin-top:16px;">Fedt — din eksisterende praksis giver dig et stærkt fundament. Uddannelsen vil uddybe din forståelse og tilføje undervisningsmetodik, sequencing og anatomi til det, du allerede kan.</p>';
  } else if (yogaExp === 'beginner') {
    html += '<p style="margin-top:16px;">Du er velkommen præcis som du er. Mange af vores dimittender startede det samme sted. Forberedelsesfasen giver dig tid til at opbygge styrke, fleksibilitet og selvtillid inden træningen starter i juli.</p>';
  } else if (yogaExp === 'previous_ytt') {
    html += '<p style="margin-top:16px;">Velkommen tilbage på måtten. Vinyasa Plus vil tilføje en ny dimension til din undervisning — især 70/30-forholdet mellem flow og yin og teknikker til opvarmet undervisning.</p>';
  }

  // Block 7: English comfort — NOT SHOWN for Danish leads

  // Block 8: Alumni note
  html += '<p style="margin-top:12px;">Vi har uddannet yogalærere siden 2014, og vores dimittender underviser i hele Europa og videre.</p>';

  // Block 9: Travel block — studio location for non-CPH Danish leads
  var isCph = accommodation === 'lives_in_copenhagen' ||
    cityCountry.includes('københavn') || cityCountry.includes('copenhagen');
  if (!isCph) {
    html += '<p style="margin-top:16px;">Studiet ligger på Torvegade 66 i Christianshavn — lige ved kanalen og tæt på metroen. Mange af vores studerende pendler eller finder overnatning i København under uddannelsen.</p>';
  }

  // Block 10: Accommodation block
  if (accommodation === 'accommodation') {
    html += '<div style="margin-top:16px;padding:14px;background:#E8F5E9;border-left:3px solid #4CAF50;border-radius:6px;">';
    html += '<strong style="color:#2E7D32;">🏠 Overnatning</strong><br><br>';
    html += 'Vi kan se, at du gerne vil have hjælp med overnatning — det klarer vi. Når du har sikret din plads via Forberedelsesfasen, hjælper vi dig med at finde overnatning i København.<br><br>';
    html += '<strong><a href="https://yogabible.dk/accommodation/" style="color:#f75c03;">Se overnatningsmuligheder →</a></strong><br>';
    html += '<span style="color:#666;">Spørgsmål om bolig? Bare svar på denne e-mail.</span>';
    html += '</div>';
  } else if (accommodation === 'accommodation_plus') {
    html += '<div style="margin-top:16px;padding:14px;background:#E8F5E9;border-left:3px solid #4CAF50;border-radius:6px;">';
    html += '<strong style="color:#2E7D32;">🏠 Overnatning & logistik</strong><br><br>';
    html += 'Vi kan se, at du gerne vil have hjælp med overnatning og praktiske ting — det klarer vi. Når du har sikret din plads via Forberedelsesfasen, hjælper vi dig med overnatning og alt andet, du har brug for under dit ophold i København.<br><br>';
    html += '<strong><a href="https://yogabible.dk/accommodation/" style="color:#f75c03;">Se overnatningsmuligheder →</a></strong><br>';
    html += '<span style="color:#666;">Spørgsmål? Bare svar på denne e-mail.</span>';
    html += '</div>';
  } else if (accommodation === 'self_arranged') {
    html += '<p style="margin-top:16px;color:#666;">Hvis du ombestemmer dig vedrørende overnatning, hjælper vi gerne. <a href="https://yogabible.dk/accommodation/" style="color:#f75c03;">Se overnatningsmuligheder →</a></p>';
  }
  // lives_in_copenhagen → no accommodation block

  // Block 11: Preparation Phase
  html += '<div style="margin-top:16px;padding:16px;background:#F0FDF4;border-left:3px solid #22C55E;border-radius:6px;">';
  html += '<strong style="color:#166534;">💡 Sikr din plads</strong><br><br>';

  if (accommodation === 'accommodation' || accommodation === 'accommodation_plus' || accommodation === 'self_arranged') {
    html += 'Forberedelsesfasen (3.750 kr.) reserverer din plads på juli-holdet. Du får adgang til medlemsområdet med valgfrit studiemateriale til at forberede dig. Når du har betalt, kan vi også hjælpe dig med at finde overnatning i København. Forberedelsesfasen er fuldt refunderbar, hvis kurset aflyses.<br><br>';
    html += '✅ Sikrer din plads på juli-holdet<br>';
    html += '✅ Adgang til medlemsområdet med forberedelsesmaterialer<br>';
    html += '✅ Vi hjælper dig med at finde overnatning<br>';
    html += '✅ Fuldt refunderbar, hvis kurset aflyses<br>';
  } else if (accommodation === 'lives_in_copenhagen') {
    html += 'Forberedelsesfasen (3.750 kr.) reserverer din plads på juli-holdet. Du får adgang til medlemsområdet med valgfrit studiemateriale til at forberede dig. Du kan også begynde at træne i vores studie i Christianshavn med det samme — jo flere timer du når inden juli, desto stærkere er dit fundament. Forberedelsesfasen er fuldt refunderbar, hvis kurset aflyses.<br><br>';
    html += '✅ Sikrer din plads på juli-holdet<br>';
    html += '✅ Begynd at træne i studiet med det samme<br>';
    html += '✅ Adgang til medlemsområdet med forberedelsesmaterialer<br>';
    html += '✅ Fuldt refunderbar, hvis kurset aflyses<br>';
  } else {
    // Fallback
    html += 'Forberedelsesfasen (3.750 kr.) reserverer din plads på juli-holdet. Du får adgang til medlemsområdet med valgfrit studiemateriale til at forberede dig. Forberedelsesfasen er fuldt refunderbar, hvis kurset aflyses.<br><br>';
    html += '✅ Sikrer din plads på juli-holdet<br>';
    html += '✅ Adgang til medlemsområdet med forberedelsesmaterialer<br>';
    html += '✅ Fuldt refunderbar, hvis kurset aflyses<br>';
  }

  html += '<br><a href="https://www.yogabible.dk/200-hours-4-weeks-intensive-programs?product=100211" style="display:inline-block;background:#f75c03;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:50px;font-weight:600;font-size:16px;">Start Forberedelsesfasen →</a>';
  html += '</div>';

  // Block 12: Booking CTA
  html += '<p style="margin-top:20px;">Vil du vide mere eller stille spørgsmål? Book en gratis online samtale:</p>';
  html += '<p style="margin:16px 0;"><a href="https://yogabible.dk/200-hours-4-weeks-intensive-programs/?booking=consultation" style="display:inline-block;background:#f75c03;color:#ffffff;padding:14px 28px;text-decoration:none;border-radius:50px;font-weight:600;font-size:16px;">Book en gratis online samtale →</a></p>';

  // Block 13: Signature
  html += julySignatureHtml();

  // Block 14: Unsubscribe
  html += julyUnsubscribeHtml(leadData.email, 'da');

  // ---- Plain text ----
  var plain = 'Hej ' + firstName + ',\n\n';
  plain += 'Tak for din interesse i vores 4-ugers Vinyasa Plus yogalæreruddannelse (juli 2026).\n\n';
  plain += 'Her er alle træningsdage og -tidspunkter:\n' + sUrl + '\nDu kan tilføje alle datoer direkte i din kalender.\n\n';
  plain += 'Hvad er Vinyasa Plus-formatet?\n';
  plain += '70% Vinyasa Flow — kreativ sequencing, klasseledelse og avancerede undervisningsteknikker\n';
  plain += '30% Yin Yoga + Hot Yoga — restitution, dybe stræk og undervisning i et opvarmet miljø\n\n';
  plain += 'Om uddannelsen:\n';
  plain += '• 200 timer · Yoga Alliance-certificeret (RYT-200)\n';
  plain += '• Vinyasa Flow, Yin Yoga, Hot Yoga & Meditation\n';
  plain += '• Anatomi, filosofi, sequencing & undervisningsmetodik\n';
  plain += '• Alle niveauer er velkomne\n\n';
  plain += 'Vi har uddannet yogalærere siden 2014, og vores dimittender underviser i hele Europa og videre.\n\n';
  plain += 'Sikr din plads: Forberedelsesfasen (3.750 kr.)\n';
  plain += 'Start Forberedelsesfasen: https://www.yogabible.dk/200-hours-4-weeks-intensive-programs?product=100211\n\n';
  plain += 'Book en gratis online samtale: https://yogabible.dk/200-hours-4-weeks-intensive-programs/?booking=consultation\n\n';
  plain += 'Healthy regards,\nShamir — Course Director\nYoga Bible\nwww.yogabible.dk\nTorvegade 66, 1400 København K, Danmark\n+45 53 88 12 09\n';
  plain += '\n---\nAfmeld: ' + buildUnsubscribeUrl(leadData.email);

  var result = await sendRawEmail({
    to: leadData.email,
    subject: subject,
    html: wrapHtml(html),
    text: plain
  });
  return { ...result, subject: subject };
}

// =========================================================================
// 8-Week YTT Email
// =========================================================================

async function sendEmail8wYTT(leadData, tokenData = {}) {
  const firstName = leadData.first_name || '';
  const program = leadData.program || '8-Week Semi-Intensive YTT';
  const needsHousing = (leadData.accommodation || '').toLowerCase() === 'yes';
  const cityCountry = leadData.city_country || '';
  const subject = firstName + ', her er alle datoer til 8-ugers yogauddannelsen';

  const scheduleUrl8w = tokenData.leadId && tokenData.token
    ? 'https://www.yogabible.dk/skema/8-uger/?tid=' + encodeURIComponent(tokenData.leadId) + '&tok=' + encodeURIComponent(tokenData.token)
    : 'https://www.yogabible.dk/skema/8-uger/';

  let bodyHtml = '<p>Hej ' + escapeHtml(firstName) + ',</p>';
  bodyHtml += '<p>Tak fordi du viste interesse for vores <strong>8-ugers semi-intensive 200-timers yogal\u00e6reruddannelse</strong>.</p>';

  bodyHtml += '<p>Her finder du alle 22 workshopdatoer og tidspunkter:</p>';
  bodyHtml += '<p style="margin:20px 0;"><a href="' + scheduleUrl8w + '" style="display:inline-block;background:#f75c03;color:#ffffff;padding:14px 28px;text-decoration:none;border-radius:50px;font-weight:600;font-size:16px;">Se skemaet \u2192</a></p>';
  bodyHtml += '<p style="font-size:14px;color:#666;">Du kan tilf\u00f8je alle datoer direkte til din kalender \u2014 og se pr\u00e6cis, hvad der sker hver dag i de 8 uger.</p>';

  bodyHtml += '<p style="margin-top:16px;">8-ugers formatet giver en god balance: nok intensitet til at holde fokus og g\u00f8re reelle fremskridt, men stadig plads til arbejde, familie eller andre forpligtelser. Det er et popul\u00e6rt valg for dem, der gerne vil have en dyb oplevelse uden at s\u00e6tte hele livet p\u00e5 pause.</p>';
  bodyHtml += programHighlightsHtml(['Online backup hvis du ikke kan m\u00f8de op en dag']);
  bodyHtml += alumniNote();

  if (needsHousing) bodyHtml += getAccommodationSectionHtml(cityCountry);
  bodyHtml += getPricingSectionHtml('23.750', '3.750', '20.000', 'fleksibel ratebetaling');
  bodyHtml += getPreparationPhaseHtml('https://www.yogabible.dk/200-hours-8-weeks-semi-intensive-programs');

  bodyHtml += '<p style="margin-top:20px;"><a href="https://www.yogabible.dk/200-hours-8-weeks-semi-intensive-programs" style="color:#f75c03;">L\u00e6s mere om 8-ugers programmet</a>';
  bodyHtml += ' \u00b7 <a href="https://www.yogabible.dk/om-200hrs-yogalaereruddannelser" style="color:#f75c03;">Om vores 200-timers uddannelse</a></p>';
  bodyHtml += bookingCta() + questionPrompt();
  bodyHtml += getEnglishNoteHtml() + getSignatureHtml() + getUnsubscribeFooterHtml(leadData.email);

  let bodyPlain = 'Hej ' + firstName + ',\n\n';
  bodyPlain += 'Tak fordi du viste interesse for vores 8-ugers semi-intensive 200-timers yogal\u00e6reruddannelse.\n\n';
  bodyPlain += 'Uddannelsesskema og datoer:\n' + scheduleUrl8w + '\n\n';
  bodyPlain += programHighlightsPlain(['Online backup hvis du ikke kan m\u00f8de op']);
  if (needsHousing) bodyPlain += getAccommodationSectionPlain(cityCountry);
  bodyPlain += '\n' + getPricingSectionPlain('23.750', '3.750', '20.000', 'fleksibel ratebetaling') + '\n';
  bodyPlain += getPreparationPhasePlain('https://www.yogabible.dk/200-hours-8-weeks-semi-intensive-programs');
  bodyPlain += '\nL\u00e6s mere: https://www.yogabible.dk/200-hours-8-weeks-semi-intensive-programs\n';
  bodyPlain += 'Book infom\u00f8de: ' + CONFIG.MEETING_LINK + '\n';
  bodyPlain += getEnglishNotePlain() + getSignaturePlain() + getUnsubscribeFooterPlain(leadData.email);

  const result = await sendRawEmail({
    to: leadData.email,
    subject,
    html: wrapHtml(bodyHtml, (tokenData || {}).leadId, 'welcome'),
    text: bodyPlain,
  });
  return { ...result, subject };
}

// =========================================================================
// 18-Week YTT Email
// =========================================================================

async function sendEmail18wYTT(leadData, tokenData = {}) {
  const firstName = leadData.first_name || '';
  const program = leadData.program || '18-Week Flexible YTT';
  const needsHousing = (leadData.accommodation || '').toLowerCase() === 'yes';
  const cityCountry = leadData.city_country || '';
  const subject = firstName + ', uddannelsen er netop startet \u2014 tilmeld dig stadig denne uge';

  const scheduleUrl18w = tokenData.leadId && tokenData.token
    ? 'https://www.yogabible.dk/skema/18-uger/?tid=' + encodeURIComponent(tokenData.leadId) + '&tok=' + encodeURIComponent(tokenData.token)
    : 'https://www.yogabible.dk/skema/18-uger/';

  // Started + last-minute discount banner
  const startedBannerHtml =
    '<div style="margin-bottom:20px;padding:14px 16px;background:#FFF7ED;border-left:3px solid #f75c03;border-radius:6px;">' +
    '<p style="margin:0 0 8px;"><strong style="color:#c2410c;">\ud83c\udf1f Uddannelsen er netop g\u00e5et i gang \u2014 og du kan stadig n\u00e5 med denne uge.</strong></p>' +
    '<p style="margin:0;color:#444;">Intromodulerne er allerede afholdt, men vi har dem p\u00e5 optagelse \u2014 s\u00e5 du nemt kan indhente det p\u00e5 ingen tid. Som tak for din hurtige beslutning f\u00e5r du <strong style="color:#c2410c;">1.000 kr. i last-minute-rabat</strong>.</p>' +
    '</div>';

  let bodyHtml = '<p>Hej ' + escapeHtml(firstName) + ',</p>';
  bodyHtml += '<p>Tak fordi du viste interesse for vores <strong>18-ugers fleksible yogal\u00e6reruddannelse</strong>.</p>';
  bodyHtml += startedBannerHtml;

  bodyHtml += '<p>Her finder du alle datoer og tidspunkter for uddannelsen:</p>';
  bodyHtml += '<p style="margin:20px 0;"><a href="' + scheduleUrl18w + '" style="display:inline-block;background:#f75c03;color:#ffffff;padding:14px 28px;text-decoration:none;border-radius:50px;font-weight:600;font-size:16px;">Se skemaet \u2192</a></p>';
  bodyHtml += '<p style="font-size:14px;color:#666;">Du kan tilf\u00f8je alle datoer direkte til din kalender \u2014 og se pr\u00e6cis hvilke dage der er hverdagshold og weekendhold.</p>';

  bodyHtml += programHighlightsHtml([
    'V\u00e6lg hverdags- eller weekendspor \u2014 og skift frit undervejs',
    'Online backup hvis du ikke kan m\u00f8de op en dag',
    '60 yogaklasser i studiet inkluderet'
  ]);

  bodyHtml += '<p style="margin-top:12px;">Det, der g\u00f8r dette program unikt, er fleksibiliteten. Hver workshop k\u00f8rer to gange \u2014 \u00e9n p\u00e5 en hverdag og \u00e9n i weekenden \u2014 s\u00e5 du altid kan f\u00f8lge med, uanset hvad din uge ser ud.</p>';
  bodyHtml += '<p style="margin-top:12px;">Holdet er <strong>netop g\u00e5et i gang</strong>, og vi holder holdene sm\u00e5 for at sikre personlig feedback. <strong>Der er kun f\u00e5 pladser tilbage</strong> \u2014 og last-minute-rabatten g\u00e6lder kun denne uge.</p>';

  if (needsHousing) bodyHtml += getAccommodationSectionHtml(cityCountry);
  bodyHtml += '<div style="margin-top:20px;padding:14px;background:#FFFCF9;border-left:3px solid #f75c03;border-radius:4px;">' +
    '<strong>Normalpris:</strong> <span style="text-decoration:line-through;color:#999;">23.750 kr.</span> &rarr; <strong style="color:#166534;">22.750 kr.</strong> med last-minute-rabat<br>' +
    '<strong>Forberedelsesfasen:</strong> 3.750 kr. sikrer din plads<br>' +
    '<strong>Rest:</strong> 19.000 kr. (fleksibel ratebetaling)' +
    '</div>';
  bodyHtml += getPreparationPhaseHtml('https://www.yogabible.dk/200-hours-18-weeks-flexible-programs');

  bodyHtml += '<p style="margin-top:20px;"><a href="https://www.yogabible.dk/200-hours-18-weeks-flexible-programs" style="color:#f75c03;">L\u00e6s mere om 18-ugers programmet</a>';
  bodyHtml += ' \u00b7 <a href="https://www.yogabible.dk/om-200hrs-yogalaereruddannelser" style="color:#f75c03;">Om vores 200-timers uddannelse</a></p>';
  bodyHtml += bookingCta() + questionPrompt();
  bodyHtml += getEnglishNoteHtml() + getSignatureHtml() + getUnsubscribeFooterHtml(leadData.email);

  let bodyPlain = 'Hej ' + firstName + ',\n\n';
  bodyPlain += 'Tak fordi du viste interesse for vores 18-ugers fleksible yogal\u00e6reruddannelse.\n\n';
  bodyPlain += '\ud83c\udf1f UDDANNELSEN ER NETOP G\u00c5ET I GANG \u2014 DU KAN STADIG N\u00c5 MED DENNE UGE\n\n';
  bodyPlain += 'Intromodulerne er allerede afholdt, men vi har dem p\u00e5 optagelse \u2014 s\u00e5 du nemt kan indhente det.\n';
  bodyPlain += 'Som tak for din hurtige beslutning f\u00e5r du 1.000 kr. i last-minute-rabat.\n\n';
  bodyPlain += 'Uddannelsesskema og datoer:\n' + scheduleUrl18w + '\n\n';
  bodyPlain += programHighlightsPlain([
    'V\u00e6lg hverdags- eller weekendspor \u2014 skift frit undervejs',
    'Online backup hvis du ikke kan m\u00f8de op',
    '60 yogaklasser inkluderet'
  ]);
  bodyPlain += '\nDet unikke er fleksibiliteten: hver workshop k\u00f8rer to gange, \u00e9n hverdag og \u00e9n weekend.\n\n';
  bodyPlain += 'Holdet er netop g\u00e5et i gang. Kun f\u00e5 pladser tilbage \u2014 last-minute-rabatten g\u00e6lder kun denne uge.\n\n';
  if (needsHousing) bodyPlain += getAccommodationSectionPlain(cityCountry);
  bodyPlain += 'Normalpris: 23.750 kr. \u2014 din pris med last-minute-rabat: 22.750 kr.\n';
  bodyPlain += 'Forberedelsesfasen: 3.750 kr. \u00b7 Rest: 19.000 kr. (fleksibel ratebetaling)\n';
  bodyPlain += getPreparationPhasePlain('https://www.yogabible.dk/200-hours-18-weeks-flexible-programs');
  bodyPlain += '\nL\u00e6s mere: https://www.yogabible.dk/200-hours-18-weeks-flexible-programs\n';
  bodyPlain += 'Book infom\u00f8de: ' + CONFIG.MEETING_LINK + '\n';
  bodyPlain += getEnglishNotePlain() + getSignaturePlain() + getUnsubscribeFooterPlain(leadData.email);

  const result = await sendRawEmail({
    to: leadData.email,
    subject,
    html: wrapHtml(bodyHtml, (tokenData || {}).leadId, 'welcome'),
    text: bodyPlain,
  });
  return { ...result, subject };
}

// =========================================================================
// 18-Week Flexible YTT — August–December 2026
// =========================================================================

async function sendEmail18wAugYTT(leadData, tokenData = {}) {
  const firstName = leadData.first_name || '';
  const needsHousing = (leadData.accommodation || '').toLowerCase() === 'yes';
  const cityCountry = leadData.city_country || '';
  const subject = firstName + ', dit skema til efter\u00e5rets 18-ugers program er klar';

  const scheduleUrl18wAug = tokenData.leadId && tokenData.token
    ? 'https://www.yogabible.dk/skema/18-uger-august/?tid=' + encodeURIComponent(tokenData.leadId) + '&tok=' + encodeURIComponent(tokenData.token)
    : 'https://www.yogabible.dk/skema/18-uger-august/';

  let bodyHtml = '<p>Hej ' + escapeHtml(firstName) + ',</p>';
  bodyHtml += '<p>Tak fordi du viste interesse for vores <strong>18-ugers fleksible yogal\u00e6reruddannelse</strong> \u2014 efter\u00e5rsholdet august\u2013december 2026.</p>';

  bodyHtml += '<p>Her finder du alle datoer og tidspunkter for uddannelsen:</p>';
  bodyHtml += '<p style="margin:20px 0;"><a href="' + scheduleUrl18wAug + '" style="display:inline-block;background:#f75c03;color:#ffffff;padding:14px 28px;text-decoration:none;border-radius:50px;font-weight:600;font-size:16px;">Se skemaet \u2192</a></p>';
  bodyHtml += '<p style="font-size:14px;color:#666;">Du kan tilf\u00f8je alle datoer direkte til din kalender \u2014 og se pr\u00e6cis hvilke dage der er hverdagshold og weekendhold.</p>';

  bodyHtml += programHighlightsHtml([
    'V\u00e6lg hverdags- eller weekendspor \u2014 og skift frit undervejs',
    'Online backup hvis du ikke kan m\u00f8de op en dag',
    '60 yogaklasser i studiet inkluderet',
    'Start: 10. august 2026 \u00b7 Graduation: 13. december 2026'
  ]);

  bodyHtml += '<p style="margin-top:12px;">Det, der g\u00f8r dette program unikt, er fleksibiliteten. Hver workshop k\u00f8rer to gange \u2014 \u00e9n p\u00e5 en hverdag og \u00e9n i weekenden \u2014 s\u00e5 du altid kan f\u00f8lge med, uanset hvad din uge ser ud.</p>';
  bodyHtml += '<p style="margin-top:12px;">Holdene er sm\u00e5 (max 12 studerende) for at sikre personlig feedback og n\u00e6rv\u00e6rende undervisning. <strong>Tilmeld dig tidligt</strong> \u2014 pladser fyldes.</p>';

  if (needsHousing) bodyHtml += getAccommodationSectionHtml(cityCountry);
  bodyHtml += '<div style="margin-top:20px;padding:14px;background:#FFFCF9;border-left:3px solid #f75c03;border-radius:4px;">' +
    '<strong>Pris:</strong> 23.750 kr.<br>' +
    '<strong>Forberedelsesfasen:</strong> 3.750 kr. sikrer din plads<br>' +
    '<strong>Rest:</strong> 20.000 kr. (fleksibel ratebetaling)' +
    '</div>';
  bodyHtml += getPreparationPhaseHtml('https://www.yogabible.dk/200-hours-18-weeks-flexible-programs');

  bodyHtml += '<p style="margin-top:20px;"><a href="https://www.yogabible.dk/200-hours-18-weeks-flexible-programs" style="color:#f75c03;">L\u00e6s mere om 18-ugers programmet</a>';
  bodyHtml += ' \u00b7 <a href="https://www.yogabible.dk/om-200hrs-yogalaereruddannelser" style="color:#f75c03;">Om vores 200-timers uddannelse</a></p>';
  bodyHtml += bookingCta() + questionPrompt();
  bodyHtml += getEnglishNoteHtml() + getSignatureHtml() + getUnsubscribeFooterHtml(leadData.email);

  let bodyPlain = 'Hej ' + firstName + ',\n\n';
  bodyPlain += 'Tak fordi du viste interesse for vores 18-ugers fleksible yogal\u00e6reruddannelse \u2014 efter\u00e5rsholdet august\u2013december 2026.\n\n';
  bodyPlain += 'Uddannelsesskema og datoer:\n' + scheduleUrl18wAug + '\n\n';
  bodyPlain += programHighlightsPlain([
    'V\u00e6lg hverdags- eller weekendspor \u2014 skift frit undervejs',
    'Online backup hvis du ikke kan m\u00f8de op',
    '60 yogaklasser inkluderet',
    'Start: 10. august 2026 \u00b7 Graduation: 13. december 2026'
  ]);
  bodyPlain += '\nDet unikke er fleksibiliteten: hver workshop k\u00f8rer to gange, \u00e9n hverdag og \u00e9n weekend.\n\n';
  bodyPlain += 'Max 12 studerende pr. hold. Tilmeld dig tidligt.\n\n';
  if (needsHousing) bodyPlain += getAccommodationSectionPlain(cityCountry);
  bodyPlain += 'Pris: 23.750 kr.\n';
  bodyPlain += 'Forberedelsesfasen: 3.750 kr. \u00b7 Rest: 20.000 kr. (fleksibel ratebetaling)\n';
  bodyPlain += getPreparationPhasePlain('https://www.yogabible.dk/200-hours-18-weeks-flexible-programs');
  bodyPlain += '\nL\u00e6s mere: https://www.yogabible.dk/200-hours-18-weeks-flexible-programs\n';
  bodyPlain += 'Book infom\u00f8de: ' + CONFIG.MEETING_LINK + '\n';
  bodyPlain += getEnglishNotePlain() + getSignaturePlain() + getUnsubscribeFooterPlain(leadData.email);

  const result = await sendRawEmail({
    to: leadData.email,
    subject,
    html: wrapHtml(bodyHtml, (tokenData || {}).leadId, 'welcome'),
    text: bodyPlain,
  });
  return { ...result, subject };
}

// =========================================================================
// Multi-Format YTT Email (user requested 2–3 formats at once)
// =========================================================================

async function sendEmailMultiYTT(leadData, tokenData = {}) {
  const firstName = leadData.first_name || '';
  const needsHousing = (leadData.accommodation || '').toLowerCase() === 'yes';
  const cityCountry = leadData.city_country || '';
  const formats = (leadData.all_formats || '').split(',').filter(f => f);

  const scheduleBase = tokenData.leadId && tokenData.token
    ? '?tid=' + encodeURIComponent(tokenData.leadId) + '&tok=' + encodeURIComponent(tokenData.token)
    : '';

  const FORMAT_INFO = {
    '18w': {
      name: '18-ugers fleksible program (for\u00e5r)',
      period: 'marts\u2013juni 2026',
      desc: 'Det mest fleksible format \u2014 v\u00e6lg hverdags- eller weekendspor og skift frit undervejs. Perfekt hvis du har arbejde, studie eller familie ved siden af.',
      url: 'https://www.yogabible.dk/200-hours-18-weeks-flexible-programs',
      scheduleUrl: 'https://www.yogabible.dk/skema/18-uger/' + scheduleBase,
      programType: '18-week'
    },
    '18w-mar': {
      name: '18-ugers fleksible program (for\u00e5r)',
      period: 'marts\u2013juni 2026',
      desc: 'For\u00e5rsholdet \u2014 v\u00e6lg hverdags- eller weekendspor og skift frit undervejs. Perfekt hvis du har arbejde, studie eller familie ved siden af.',
      url: 'https://www.yogabible.dk/200-hours-18-weeks-flexible-programs',
      scheduleUrl: 'https://www.yogabible.dk/skema/18-uger/' + scheduleBase,
      programType: '18-week'
    },
    '18w-aug': {
      name: '18-ugers fleksible program (efter\u00e5r)',
      period: 'august\u2013december 2026',
      desc: 'Efter\u00e5rsholdet \u2014 v\u00e6lg hverdags- eller weekendspor og skift frit undervejs. Start 10. august, graduation 13. december.',
      url: 'https://www.yogabible.dk/200-hours-18-weeks-flexible-programs',
      scheduleUrl: 'https://www.yogabible.dk/skema/18-uger-august/' + scheduleBase,
      programType: '18-week'
    },
    '8w': {
      name: '8-ugers semi-intensive program',
      period: 'maj\u2013juni 2026',
      desc: 'En god balance mellem intensitet og hverdagsliv. Nok fokus til reelle fremskridt, men stadig plads til andre forpligtelser.',
      url: 'https://www.yogabible.dk/200-hours-8-weeks-semi-intensive-programs',
      scheduleUrl: 'https://www.yogabible.dk/skema/8-uger/' + scheduleBase,
      programType: '8-week'
    },
    '4w': {
      name: '4-ugers intensive program (april)',
      period: 'april 2026',
      desc: 'Fuldt fordybende \u2014 daglig tr\u00e6ning og teori i 4 uger. Complete Program: Hatha, Vinyasa, Yin, Hot Yoga og Meditation.',
      url: 'https://www.yogabible.dk/200-hours-4-weeks-intensive-programs',
      scheduleUrl: 'https://www.yogabible.dk/skema/4-uger/' + scheduleBase,
      programType: '4-week'
    },
    '4w-apr': {
      name: '4-ugers Complete Program (april)',
      period: 'april 2026',
      desc: 'Fuldt fordybende \u2014 daglig tr\u00e6ning og teori i 4 uger. Hatha, Vinyasa, Yin, Hot Yoga og Meditation.',
      url: 'https://www.yogabible.dk/200-hours-4-weeks-intensive-programs',
      scheduleUrl: 'https://www.yogabible.dk/skema/4-uger/' + scheduleBase,
      programType: '4-week'
    },
    '4w-jul': {
      name: '4-ugers Vinyasa Plus (juli)',
      period: 'juli 2026',
      desc: '70% Vinyasa Flow \u2014 kreativ sekvensering, klasseledelse og undervisningsteknikker. Plus 30% Yin Yoga + Hot Yoga. Underviser opvarmede og ikke-opvarmede klasser.',
      url: 'https://www.yogabible.dk/200-hours-4-weeks-intensive-programs',
      scheduleUrl: 'https://www.yogabible.dk/skema/4-uger-juli/' + scheduleBase,
      programType: '4-week'
    }
  };

  // Build Danish format list with "og" before last item
  const formatNames = formats.map(f => (FORMAT_INFO[f] || {}).name || f);
  let formatList;
  if (formatNames.length > 1) {
    formatList = formatNames.slice(0, -1).join(', ') + ' og ' + formatNames[formatNames.length - 1];
  } else {
    formatList = formatNames[0] || '';
  }

  const subject = firstName + ', dine YTT-skemaer er klar';

  // ---- HTML ----
  let bodyHtml = '<p>Hej ' + escapeHtml(firstName) + ',</p>';
  bodyHtml += '<p>Tak fordi du viste interesse for vores <strong>200-timers yogal\u00e6reruddannelse</strong>!</p>';

  bodyHtml += '<p>Jeg kan se, at du gerne vil sammenligne vores <strong>' + escapeHtml(formatList) + '</strong>. ';
  bodyHtml += 'Godt t\u00e6nkt \u2014 herunder finder du skemaer og datoer for hvert format.</p>';

  // Comparison prompt box
  bodyHtml += '<div style="margin:20px 0;padding:14px;background:#E3F2FD;border-radius:6px;border-left:3px solid #1976D2;">';
  bodyHtml += '<strong style="color:#1565C0;">\ud83d\udcad Et hurtigt sp\u00f8rgsm\u00e5l:</strong><br>';
  bodyHtml += 'Jeg kan se du sammenligner flere formater. Er det fordi du har arbejde, studie eller andre forpligtelser, der p\u00e5virker hvilken form der passer bedst?<br><br>';
  bodyHtml += '<span style="color:#666;">Svar gerne p\u00e5 denne e-mail \u2014 s\u00e5 hj\u00e6lper jeg dig med at finde det perfekte match!</span>';
  bodyHtml += '</div>';

  // Format descriptions
  bodyHtml += '<p style="margin-top:20px;"><strong>Her er en oversigt over de formater du valgte:</strong></p>';
  formats.forEach(f => {
    const info = FORMAT_INFO[f];
    if (!info) return;
    bodyHtml += '<div style="margin:12px 0;padding:12px;background:#FFFCF9;border-left:3px solid #f75c03;border-radius:4px;">';
    bodyHtml += '<strong>' + escapeHtml(info.name) + '</strong> <span style="color:#888;">(' + escapeHtml(info.period) + ')</span><br>';
    bodyHtml += '<span style="color:#555;">' + info.desc + '</span><br>';
    if (info.scheduleUrl) {
      bodyHtml += '<p style="margin:10px 0 4px;"><a href="' + info.scheduleUrl + '" style="display:inline-block;background:#f75c03;color:#fff;padding:8px 18px;text-decoration:none;border-radius:50px;font-weight:600;font-size:14px;">Se dit skema \u2192</a></p>';
    }
    bodyHtml += '<a href="' + info.url + '" style="color:#f75c03;font-size:13px;">L\u00e6s mere om programmet \u2192</a>';
    bodyHtml += '</div>';
  });

  bodyHtml += programHighlightsHtml();
  bodyHtml += alumniNote();

  if (needsHousing) bodyHtml += getAccommodationSectionHtml(cityCountry);
  bodyHtml += getPricingSectionHtml('23.750', '3.750', '20.000', 'samme pris for alle formater \u2014 fleksibel ratebetaling');

  // Preparation Phase — single block that covers all formats
  bodyHtml += '<div style="margin-top:20px;padding:16px;background:#F0FDF4;border-left:3px solid #22C55E;border-radius:4px;">';
  bodyHtml += '<strong style="color:#166534;">\ud83d\udca1 Smart tr\u00e6k: Start forberedelsesfasen nu</strong><br><br>';
  bodyHtml += 'De fleste studerende starter med forberedelsesfasen allerede nu \u2014 og det er der en god grund til:<br><br>';
  bodyHtml += '\u2705 \u00d8jeblikkelig adgang til alle yogaklasser i studiet<br>';
  bodyHtml += '\u2705 Opbyg styrke, fleksibilitet og rutine inden uddannelsesstart<br>';
  bodyHtml += '\u2705 M\u00f8d dine kommende medstuderende i et afslappet milj\u00f8<br>';
  bodyHtml += '\u2705 Dine klasser t\u00e6ller med i dine tr\u00e6ningstimer<br><br>';
  bodyHtml += '<a href="https://www.yogabible.dk/om-200hrs-yogalaereruddannelser" style="display:inline-block;background:#f75c03;color:#ffffff;padding:10px 20px;text-decoration:none;border-radius:6px;font-weight:600;">Start forberedelsesfasen \u2014 3.750 kr.</a>';
  bodyHtml += '</div>';

  // Links + compare
  bodyHtml += '<p style="margin-top:20px;">';
  formats.forEach(f => {
    const info = FORMAT_INFO[f];
    if (info) bodyHtml += '<a href="' + info.url + '" style="color:#f75c03;">' + escapeHtml(info.name.replace('program', 'detaljer')) + '</a> \u00b7 ';
  });
  bodyHtml += '<a href="https://www.yogabible.dk/om-200hrs-yogalaereruddannelser" style="color:#f75c03;">Sammenlign alle formater</a>';
  bodyHtml += '</p>';

  bodyHtml += '<p style="margin-top:20px;">Har du lyst til at se studiet eller f\u00e5 hj\u00e6lp til at v\u00e6lge det rigtige format?</p>';
  bodyHtml += '<p><a href="' + CONFIG.MEETING_LINK + '" style="display:inline-block;background:#f75c03;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:600;">Book infom\u00f8de eller samtale</a></p>';
  bodyHtml += '<p>Gl\u00e6der mig til at h\u00f8re fra dig!</p>';
  bodyHtml += getEnglishNoteHtml() + getSignatureHtml() + getUnsubscribeFooterHtml(leadData.email);

  // ---- Plain text ----
  let bodyPlain = 'Hej ' + firstName + ',\n\n';
  bodyPlain += 'Tak fordi du viste interesse for vores 200-timers yogal\u00e6reruddannelse!\n\n';
  bodyPlain += 'Jeg kan se du gerne vil sammenligne vores ' + formatList + '. ';
  bodyPlain += 'Herunder finder du skemaer og datoer for hvert format.\n\n';
  bodyPlain += 'Et hurtigt sp\u00f8rgsm\u00e5l: Er det fordi du har andre forpligtelser der p\u00e5virker dit valg? Svar gerne s\u00e5 jeg kan hj\u00e6lpe!\n\n';
  formats.forEach(f => {
    const info = FORMAT_INFO[f];
    if (info) {
      bodyPlain += '--- ' + info.name + ' (' + info.period + ') ---\n';
      bodyPlain += info.desc + '\n';
      if (info.scheduleUrl) bodyPlain += 'Skema og datoer: ' + info.scheduleUrl + '\n';
      bodyPlain += 'L\u00e6s mere: ' + info.url + '\n\n';
    }
  });
  bodyPlain += programHighlightsPlain();
  if (needsHousing) bodyPlain += getAccommodationSectionPlain(cityCountry);
  bodyPlain += '\n' + getPricingSectionPlain('23.750', '3.750', '20.000', 'samme pris for alle formater \u2014 fleksibel ratebetaling') + '\n';
  bodyPlain += '\nSmart tr\u00e6k: Start forberedelsesfasen nu (3.750 kr.)\n';
  bodyPlain += '- \u00d8jeblikkelig adgang til alle yogaklasser i studiet\n';
  bodyPlain += '- Opbyg styrke og rutine inden uddannelsesstart\n';
  bodyPlain += '- M\u00f8d dine kommende medstuderende\n';
  bodyPlain += '- Dine klasser t\u00e6ller med i dine tr\u00e6ningstimer\n';
  bodyPlain += 'Start her: https://www.yogabible.dk/om-200hrs-yogalaereruddannelser\n\n';
  bodyPlain += 'Book infom\u00f8de eller samtale: ' + CONFIG.MEETING_LINK + '\n';
  bodyPlain += 'Gl\u00e6der mig til at h\u00f8re fra dig!';
  bodyPlain += getEnglishNotePlain() + getSignaturePlain() + getUnsubscribeFooterPlain(leadData.email);

  const result = await sendRawEmail({
    to: leadData.email,
    subject,
    html: wrapHtml(bodyHtml, (tokenData || {}).leadId, 'welcome'),
    text: bodyPlain
  });
  return { ...result, subject };
}

// =========================================================================
// Undecided YTT Email — lead chose "Ved ikke endnu" on the program question
// Showcases all available program formats with descriptions + comparison links
// =========================================================================

async function sendEmailUndecidedYTT(leadData, tokenData = {}) {
  const firstName = leadData.first_name || '';
  const needsHousing = (leadData.accommodation || '').toLowerCase() === 'yes';
  const cityCountry = leadData.city_country || '';

  const scheduleBase = tokenData.leadId && tokenData.token
    ? '?tid=' + encodeURIComponent(tokenData.leadId) + '&tok=' + encodeURIComponent(tokenData.token)
    : '';

  const subject = firstName + ', find dit perfekte yogauddannelsesformat';

  // ---- HTML ----
  let bodyHtml = '<p>Hej ' + escapeHtml(firstName) + ',</p>';
  bodyHtml += '<p>Tak for din interesse i vores <strong>200-timers yogalæreruddannelse</strong>!</p>';
  bodyHtml += '<p>Det er helt normalt ikke at vide, hvilket format der passer bedst \u2014 det afhænger af din hverdag, dine mål og din læringsstil. Lad mig give dig et overblik, så du lettere kan vælge.</p>';

  // Intro box
  bodyHtml += '<div style="margin:20px 0;padding:14px;background:#E3F2FD;border-radius:6px;border-left:3px solid #1976D2;">';
  bodyHtml += '<strong style="color:#1565C0;">💡 Alle formater giver dig det samme certifikat</strong><br>';
  bodyHtml += 'Uanset hvilket format du vælger, får du en <strong>200-timers Yoga Alliance-certificering</strong> med samme pensum: Hatha, Vinyasa, Yin, Hot Yoga, Meditation, anatomi, filosofi og undervisningsmetodik. Max 12 studerende pr. hold.';
  bodyHtml += '</div>';

  // Format cards
  const formats = [
    {
      name: '4-ugers intensiv',
      period: 'April 2026',
      emoji: '🔥',
      desc: 'Fuldt fordybende daglig træning i 4 uger. Det mest intense format \u2014 perfekt hvis du kan sætte alt andet på pause og vil have den dybeste oplevelse.',
      goodFor: 'Dig der vil have en komplet immersion og kan dedikere 4 uger fuld tid.',
      scheduleUrl: 'https://www.yogabible.dk/skema/4-uger/' + scheduleBase,
      pageUrl: 'https://www.yogabible.dk/200-hours-4-weeks-intensive-programs'
    },
    {
      name: '8-ugers semi-intensiv',
      period: 'Maj\u2013Juni 2026',
      emoji: '⚡',
      desc: 'En god balance mellem intensitet og hverdagsliv. Nok fokus til reelle fremskridt, men stadig plads til arbejde eller studie ved siden af.',
      goodFor: 'Dig der vil have fokuseret uddannelse men har brug for lidt mere tid end 4 uger.',
      scheduleUrl: 'https://www.yogabible.dk/skema/8-uger/' + scheduleBase,
      pageUrl: 'https://www.yogabible.dk/200-hours-8-weeks-semi-intensive-programs'
    },
    {
      name: '4-ugers Vinyasa Plus',
      period: 'Juli 2026',
      emoji: '🌊',
      desc: '70% Vinyasa Flow \u2014 kreativ sekvensering, klasseledelse og avancerede undervisningsteknikker. Plus 30% Yin Yoga + Hot Yoga. For dig der brænder for Vinyasa.',
      goodFor: 'Dig der allerede ved du vil specialisere dig i Vinyasa Flow.',
      scheduleUrl: 'https://www.yogabible.dk/skema/4-uger-juli/' + scheduleBase,
      pageUrl: 'https://www.yogabible.dk/200-hours-4-weeks-intensive-programs'
    },
    {
      name: '18-ugers fleksibel',
      period: 'August\u2013December 2026',
      emoji: '🧘',
      desc: 'Det mest fleksible format \u2014 vælg hverdags- eller weekendspor og skift frit undervejs. Perfekt hvis du har arbejde, studie eller familie ved siden af. 60 yogaklasser inkluderet.',
      goodFor: 'Dig der vil tage uddannelsen uden at sætte hverdagen på pause.',
      scheduleUrl: 'https://www.yogabible.dk/skema/18-uger-august/' + scheduleBase,
      pageUrl: 'https://www.yogabible.dk/200-hours-18-weeks-flexible-programs'
    }
  ];

  bodyHtml += '<p style="margin-top:24px;"><strong>Her er dine muligheder:</strong></p>';

  formats.forEach(f => {
    bodyHtml += '<div style="margin:16px 0;padding:16px;background:#FFFCF9;border-left:3px solid #f75c03;border-radius:4px;">';
    bodyHtml += '<strong style="font-size:17px;">' + f.emoji + ' ' + escapeHtml(f.name) + '</strong> <span style="color:#888;">(' + escapeHtml(f.period) + ')</span><br>';
    bodyHtml += '<span style="color:#555;">' + f.desc + '</span><br><br>';
    bodyHtml += '<span style="color:#166534;font-size:14px;"><strong>God til:</strong> ' + f.goodFor + '</span><br>';
    bodyHtml += '<p style="margin:10px 0 4px;">';
    bodyHtml += '<a href="' + f.scheduleUrl + '" style="display:inline-block;background:#f75c03;color:#fff;padding:8px 18px;text-decoration:none;border-radius:50px;font-weight:600;font-size:14px;">Se skema og datoer \u2192</a>';
    bodyHtml += ' <a href="' + f.pageUrl + '" style="color:#f75c03;font-size:13px;margin-left:12px;">Læs mere \u2192</a>';
    bodyHtml += '</p></div>';
  });

  // Compare link
  bodyHtml += '<div style="margin:24px 0;padding:16px;background:#F5F3F0;border-radius:6px;text-align:center;">';
  bodyHtml += '<p style="margin:0 0 10px;"><strong>Stadig i tvivl?</strong></p>';
  bodyHtml += '<a href="https://www.yogabible.dk/om-200hrs-yogalaereruddannelser" style="display:inline-block;background:#1a1a1a;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:600;">Sammenlign alle formater side om side \u2192</a>';
  bodyHtml += '</div>';

  // Pricing — same for all formats
  bodyHtml += programHighlightsHtml();
  bodyHtml += alumniNote();

  if (needsHousing) bodyHtml += getAccommodationSectionHtml(cityCountry);
  bodyHtml += getPricingSectionHtml('23.750', '3.750', '20.000', 'samme pris for alle formater \u2014 fleksibel ratebetaling');
  bodyHtml += getPreparationPhaseHtml('https://www.yogabible.dk/om-200hrs-yogalaereruddannelser');

  // Meeting CTA
  bodyHtml += '<p style="margin-top:24px;">Det bedste du kan gøre nu? <strong>Book et gratis infomøde</strong> \u2014 så hjælper jeg dig personligt med at finde det rigtige format:</p>';
  bodyHtml += '<p><a href="' + CONFIG.MEETING_LINK + '" style="display:inline-block;background:#f75c03;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:600;">Book et gratis infomøde</a></p>';
  bodyHtml += '<p>Du er også velkommen til bare at svare på denne e-mail med dine spørgsmål.</p>';
  bodyHtml += '<p>Glæder mig til at høre fra dig!</p>';
  bodyHtml += getEnglishNoteHtml() + getSignatureHtml() + getUnsubscribeFooterHtml(leadData.email);

  // ---- Plain text ----
  let bodyPlain = 'Hej ' + firstName + ',\n\n';
  bodyPlain += 'Tak for din interesse i vores 200-timers yogalæreruddannelse!\n\n';
  bodyPlain += 'Det er helt normalt ikke at vide, hvilket format der passer bedst. Her er et overblik:\n\n';
  bodyPlain += 'Alle formater giver dig det samme 200-timers Yoga Alliance-certifikat med samme pensum. Max 12 studerende pr. hold.\n\n';

  formats.forEach(f => {
    bodyPlain += '--- ' + f.name + ' (' + f.period + ') ---\n';
    bodyPlain += f.desc + '\n';
    bodyPlain += 'God til: ' + f.goodFor + '\n';
    bodyPlain += 'Skema: ' + f.scheduleUrl + '\n';
    bodyPlain += 'Læs mere: ' + f.pageUrl + '\n\n';
  });

  bodyPlain += 'Sammenlign alle formater: https://www.yogabible.dk/om-200hrs-yogalaereruddannelser\n\n';
  bodyPlain += programHighlightsPlain();
  if (needsHousing) bodyPlain += getAccommodationSectionPlain(cityCountry);
  bodyPlain += '\n' + getPricingSectionPlain('23.750', '3.750', '20.000', 'samme pris for alle formater — fleksibel ratebetaling') + '\n';
  bodyPlain += getPreparationPhasePlain('https://www.yogabible.dk/om-200hrs-yogalaereruddannelser');
  bodyPlain += '\nBook et gratis infomøde: ' + CONFIG.MEETING_LINK + '\n';
  bodyPlain += 'Du kan også svare på denne e-mail med dine spørgsmål.\n\nGlæder mig til at høre fra dig!';
  bodyPlain += getEnglishNotePlain() + getSignaturePlain() + getUnsubscribeFooterPlain(leadData.email);

  const result = await sendRawEmail({
    to: leadData.email,
    subject,
    html: wrapHtml(bodyHtml, (tokenData || {}).leadId, 'welcome'),
    text: bodyPlain
  });
  return { ...result, subject };
}

// =========================================================================
// 300h Advanced YTT Email
// =========================================================================

async function sendEmail300hYTT(leadData, tokenData = {}) {
  const firstName = leadData.first_name || '';
  const program = leadData.program || '300-Hour Advanced YTT';
  const subject = 'Din foresp\u00f8rgsel \u2014 300-timers avanceret yogal\u00e6reruddannelse';

  const attachment = await fetchSchedulePdfAttachment('300h', program);
  const hasSchedule = !!attachment;

  let bodyHtml = '<p>Hej ' + escapeHtml(firstName) + ',</p>';
  bodyHtml += '<p>Tak for din interesse i vores <strong>300-timers avancerede yogal\u00e6reruddannelse</strong> (24 uger, maj\u2013december 2026)!</p>';
  bodyHtml += '<p>Dette program er designet til certificerede yogal\u00e6rere, der \u00f8nsker at fordybe deres praksis og undervisning p\u00e5 h\u00f8jeste niveau.</p>';

  if (hasSchedule) {
    bodyHtml += '<p>Jeg har vedh\u00e6ftet det fulde skema, s\u00e5 du kan se hvordan programmet er bygget op.</p>';
  } else {
    bodyHtml += '<p>Vi er ved at l\u00e6gge sidste h\u00e5nd p\u00e5 det detaljerede skema \u2014 jeg sender det til dig, s\u00e5 snart det er klar.</p>';
  }

  bodyHtml += '<p><a href="' + CONFIG.MEETING_LINK + '" style="display:inline-block;background:#f75c03;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:600;">Book en uforpligtende samtale</a></p>';
  bodyHtml += '<p>Du er ogs\u00e5 velkommen til at svare p\u00e5 denne e-mail med dine sp\u00f8rgsm\u00e5l.</p>';
  bodyHtml += getEnglishNoteHtml() + getSignatureHtml() + getUnsubscribeFooterHtml(leadData.email);

  let bodyPlain = 'Hej ' + firstName + ',\n\nTak for din interesse i vores 300-timers avancerede yogal\u00e6reruddannelse (24 uger, maj\u2013december 2026)!\n\n';
  bodyPlain += hasSchedule ? 'Jeg har vedh\u00e6ftet det fulde skema.\n\n' : 'Det detaljerede skema er snart klar \u2014 jeg sender det til dig.\n\n';
  bodyPlain += 'Book en samtale: ' + CONFIG.MEETING_LINK + getEnglishNotePlain() + getSignaturePlain() + getUnsubscribeFooterPlain(leadData.email);

  const result = await sendRawEmail({
    to: leadData.email,
    subject,
    html: wrapHtml(bodyHtml, (tokenData || {}).leadId, 'welcome'),
    text: bodyPlain,
    attachments: attachment ? [attachment] : []
  });
  return { ...result, subject };
}

// =========================================================================
// 300h Waitlist Confirmation Email (Bilingual)
// =========================================================================

async function sendWaitlist300hEmail(leadData, tokenData = {}) {
  const firstName = leadData.first_name || '';
  const lang = (leadData.lang || 'da').toLowerCase();
  const isEn = lang === 'en';

  const subject = isEn
    ? 'You\'re on the waitlist — 300-Hour Advanced Yoga Teacher Training'
    : 'Du er på ventelisten — 300-timers avanceret yogalæreruddannelse';

  let bodyHtml, bodyPlain;

  if (isEn) {
    bodyHtml = '<p>Hi ' + escapeHtml(firstName) + ',</p>';
    bodyHtml += '<p>Thank you for your interest in our <strong>300-Hour Advanced Yoga Teacher Training</strong> — we\'re thrilled to have you on the waitlist.</p>';
    bodyHtml += '<p>We are currently designing the most comprehensive 300-hour program in Scandinavia. As soon as the program opens for applications, you will be <strong>among the first to know</strong>.</p>';
    bodyHtml += '<p>Here\'s what you can expect:</p>';
    bodyHtml += '<ul style="margin:10px 0;padding-left:20px;">';
    bodyHtml += '<li><strong>24 weeks</strong> of advanced training in Copenhagen</li>';
    bodyHtml += '<li><strong>RYT-500 certification</strong> through Yoga Alliance</li>';
    bodyHtml += '<li>Specializations in Yin Yoga, Yoga Therapy, Pre/Postnatal, Ayurveda &amp; more</li>';
    bodyHtml += '<li>Max <strong>12 participants</strong> for close mentoring</li>';
    bodyHtml += '</ul>';
    bodyHtml += '<p>In the meantime, feel free to reply to this email if you have any questions — I\'m happy to chat.</p>';
    bodyHtml += '<p><a href="' + CONFIG.MEETING_LINK + '" style="display:inline-block;background:#f75c03;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:600;">Book a free info session</a></p>';
    bodyHtml += getSignatureHtml() + getUnsubscribeFooterHtml(leadData.email);

    bodyPlain = 'Hi ' + firstName + ',\n\n';
    bodyPlain += 'Thank you for your interest in our 300-Hour Advanced Yoga Teacher Training — we\'re thrilled to have you on the waitlist.\n\n';
    bodyPlain += 'We are currently designing the most comprehensive 300-hour program in Scandinavia. As soon as the program opens for applications, you will be among the first to know.\n\n';
    bodyPlain += 'In the meantime, feel free to reply to this email if you have any questions.\n\n';
    bodyPlain += 'Book a free info session: ' + CONFIG.MEETING_LINK;
    bodyPlain += getSignaturePlain() + getUnsubscribeFooterPlain(leadData.email);
  } else {
    bodyHtml = '<p>Hej ' + escapeHtml(firstName) + ',</p>';
    bodyHtml += '<p>Tak for din interesse i vores <strong>300-timers avancerede yogalæreruddannelse</strong> — vi er glade for at have dig på ventelisten.</p>';
    bodyHtml += '<p>Vi er i gang med at designe det mest ambitiøse 300-timers program i Skandinavien. Så snart uddannelsen åbner for ansøgning, vil du være <strong>blandt de første til at høre det</strong>.</p>';
    bodyHtml += '<p>Her er hvad du kan forvente:</p>';
    bodyHtml += '<ul style="margin:10px 0;padding-left:20px;">';
    bodyHtml += '<li><strong>24 ugers</strong> avanceret uddannelse i København</li>';
    bodyHtml += '<li><strong>RYT-500 certificering</strong> gennem Yoga Alliance</li>';
    bodyHtml += '<li>Specialiseringer i Yin Yoga, Yoga Terapi, Pre/Postnatal, Ayurveda og mere</li>';
    bodyHtml += '<li>Max <strong>12 deltagere</strong> for tæt mentoring</li>';
    bodyHtml += '</ul>';
    bodyHtml += '<p>I mellemtiden er du meget velkommen til at svare på denne e-mail, hvis du har spørgsmål — jeg svarer gerne.</p>';
    bodyHtml += '<p><a href="' + CONFIG.MEETING_LINK + '" style="display:inline-block;background:#f75c03;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:600;">Book et gratis infomøde</a></p>';
    bodyHtml += getSignatureHtml() + getUnsubscribeFooterHtml(leadData.email);

    bodyPlain = 'Hej ' + firstName + ',\n\n';
    bodyPlain += 'Tak for din interesse i vores 300-timers avancerede yogalæreruddannelse — vi er glade for at have dig på ventelisten.\n\n';
    bodyPlain += 'Vi er i gang med at designe det mest ambitiøse 300-timers program i Skandinavien. Så snart uddannelsen åbner for ansøgning, vil du være blandt de første til at høre det.\n\n';
    bodyPlain += 'I mellemtiden er du meget velkommen til at svare på denne e-mail.\n\n';
    bodyPlain += 'Book et gratis infomøde: ' + CONFIG.MEETING_LINK;
    bodyPlain += getSignaturePlain() + getUnsubscribeFooterPlain(leadData.email);
  }

  const result = await sendRawEmail({
    to: leadData.email,
    subject,
    html: wrapHtml(bodyHtml, (tokenData || {}).leadId, 'welcome'),
    text: bodyPlain
  });
  return { ...result, subject };
}

// =========================================================================
// Specialty YTT Email (50h, 30h)
// =========================================================================

async function sendEmailSpecialtyYTT(leadData, tokenData = {}) {
  const firstName = leadData.first_name || '';
  const program = leadData.program || 'Specialty Teacher Training';
  const specialty = leadData.subcategories || '';
  const subject = 'Din foresp\u00f8rgsel \u2014 ' + program;

  let bodyHtml = '<p>Hej ' + escapeHtml(firstName) + ',</p>';
  bodyHtml += '<p>Tak for din interesse i vores <strong>' + escapeHtml(program) + '</strong>!</p>';
  if (specialty) bodyHtml += '<p>Du n\u00e6vnte interesse for: <strong>' + escapeHtml(specialty) + '</strong></p>';
  bodyHtml += '<p>Vores specialmoduler er perfekte for l\u00e6rere, der vil fordybe sig inden for specifikke omr\u00e5der.</p>';
  bodyHtml += '<p>Vi er ved at finalisere 2026-skemaet. Vil du vide mere?</p>';
  bodyHtml += '<p><a href="' + CONFIG.MEETING_LINK + '" style="display:inline-block;background:#f75c03;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:600;">Book en uforpligtende samtale</a></p>';
  bodyHtml += '<p>Svar ogs\u00e5 gerne p\u00e5 denne e-mail med dine sp\u00f8rgsm\u00e5l.</p>';
  bodyHtml += getEnglishNoteHtml() + getSignatureHtml() + getUnsubscribeFooterHtml(leadData.email);

  const bodyPlain = 'Hej ' + firstName + ',\n\nTak for din interesse i vores ' + program + '!\n\nBook en samtale: ' + CONFIG.MEETING_LINK + getEnglishNotePlain() + getSignaturePlain() + getUnsubscribeFooterPlain(leadData.email);

  const result = await sendRawEmail({
    to: leadData.email,
    subject,
    html: wrapHtml(bodyHtml, (tokenData || {}).leadId, 'welcome'),
    text: bodyPlain
  });
  return { ...result, subject };
}

// =========================================================================
// Courses Email
// =========================================================================

async function sendEmailCourses(leadData, tokenData = {}) {
  const firstName = leadData.first_name || '';
  const courses = leadData.program || '';
  const preferredMonth = leadData.preferred_month || leadData.cohort_label || '';
  const needsHousing = (leadData.accommodation || '').toLowerCase() === 'yes';
  const cityCountry = leadData.city_country || '';

  const courseList = courses.split(/[,+]/).map(c => c.trim()).filter(c => c);
  const isBundle = courseList.length > 1;
  const subject = isBundle ? 'Dine kursus-detaljer \u2014 Yoga Bible' : 'Dit kursus \u2014 Yoga Bible';

  // Try to attach course schedule for preferred month
  const attachment = preferredMonth ? await fetchSchedulePdfAttachment('courses', preferredMonth) : null;
  const hasSchedule = !!attachment;

  let bodyHtml = '<p>Hej ' + escapeHtml(firstName) + ',</p>';

  if (isBundle) {
    bodyHtml += '<p>Tak for din interesse i vores kursusbundle! Du valgte:</p><ul style="margin:10px 0;padding-left:20px;">';
    courseList.forEach(course => {
      const config = COURSE_CONFIG[course] || {};
      bodyHtml += '<li><strong>' + escapeHtml(course) + '</strong>' + (config.description ? ' \u2014 ' + config.description : '') + '</li>';
    });
    bodyHtml += '</ul>';
    if (courseList.length === 2) bodyHtml += '<p><strong>Bundle-pris (2 kurser):</strong> 4.140 kr. (spar 10%!)</p>';
    else if (courseList.length === 3) bodyHtml += '<p><strong>All-In Bundle:</strong> 5.865 kr. (spar 15% + GRATIS 1-m\u00e5neds yogapas!)</p>';
  } else {
    bodyHtml += '<p>Tak for din interesse i vores <strong>' + escapeHtml(courses) + '</strong>-kursus!</p>';
    bodyHtml += '<p><strong>Pris:</strong> 2.300 kr.</p>';
  }

  if (preferredMonth) bodyHtml += '<p><strong>Foretrukken m\u00e5ned:</strong> ' + escapeHtml(preferredMonth) + '</p>';

  if (hasSchedule) {
    bodyHtml += '<p>Jeg har vedh\u00e6ftet kursusskemaet for <strong>' + escapeHtml(preferredMonth) + '</strong>, s\u00e5 du kan se datoer og tidspunkter.</p>';
  } else if (preferredMonth) {
    bodyHtml += '<p>Vi er ved at l\u00e6gge sidste h\u00e5nd p\u00e5 kursusskemaet for ' + escapeHtml(preferredMonth) + '. Jeg sender det til dig, s\u00e5 snart det er klar.</p>';
  }

  if (needsHousing) bodyHtml += getAccommodationSectionHtml(cityCountry);

  bodyHtml += '<p style="margin-top:16px;">Du kan tilmelde dig direkte p\u00e5 vores hjemmeside, eller book en kort samtale hvis du har sp\u00f8rgsm\u00e5l:</p>';
  bodyHtml += '<p><a href="' + CONFIG.MEETING_LINK + '" style="display:inline-block;background:#f75c03;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:600;">Book en samtale</a></p>';

  if (!isBundle && courseList.length === 1 && preferredMonth) {
    const paymentUrl = getCoursePaymentUrl(courseList[0], preferredMonth);
    if (paymentUrl) bodyHtml += '<p>Klar til at tilmelde dig? <a href="' + paymentUrl + '" style="color:#f75c03;font-weight:600;">Tilmeld dig her \u2192</a></p>';
  } else if (isBundle && preferredMonth) {
    const bundleUrl = getBundlePaymentUrl(courseList, preferredMonth);
    if (bundleUrl) bodyHtml += '<p>Klar til at tilmelde dig? <a href="' + bundleUrl + '" style="color:#f75c03;font-weight:600;">F\u00e5 din bundle her \u2192</a></p>';
  }

  bodyHtml += '<p>Svar gerne p\u00e5 denne e-mail hvis du har sp\u00f8rgsm\u00e5l!</p>';
  bodyHtml += getEnglishNoteHtml() + getSignatureHtml() + getUnsubscribeFooterHtml(leadData.email);

  let bodyPlain = 'Hej ' + firstName + ',\n\nTak for din interesse i vores kurser!\n\n';
  if (isBundle) {
    bodyPlain += 'Du valgte: ' + courseList.join(', ') + '\n';
    if (courseList.length === 2) bodyPlain += 'Bundle-pris (2 kurser): 4.140 kr. (spar 10%!)\n\n';
    else if (courseList.length === 3) bodyPlain += 'All-In Bundle: 5.865 kr. (spar 15% + GRATIS 1-måneds yogapas!)\n\n';
  } else {
    bodyPlain += 'Kursus: ' + courses + '\nPris: 2.300 kr.\n\n';
  }
  if (preferredMonth) bodyPlain += 'Foretrukken måned: ' + preferredMonth + '\n';
  if (hasSchedule) bodyPlain += 'Jeg har vedhæftet kursusskemaet for ' + preferredMonth + '.\n\n';
  else if (preferredMonth) bodyPlain += 'Kursusskemaet for ' + preferredMonth + ' er snart klar.\n\n';
  if (needsHousing) bodyPlain += getAccommodationSectionPlain(cityCountry);
  bodyPlain += 'Book en samtale: ' + CONFIG.MEETING_LINK;
  bodyPlain += getEnglishNotePlain() + getSignaturePlain() + getUnsubscribeFooterPlain(leadData.email);

  const result = await sendRawEmail({
    to: leadData.email,
    subject,
    html: wrapHtml(bodyHtml, (tokenData || {}).leadId, 'welcome'),
    text: bodyPlain,
    attachments: attachment ? [attachment] : []
  });
  return { ...result, subject };
}

// =========================================================================
// Mentorship Email
// =========================================================================

async function sendEmailMentorship(leadData, tokenData = {}) {
  const firstName = leadData.first_name || '';
  const service = leadData.service || 'Mentorship';
  const subcategories = leadData.subcategories || '';
  const message = leadData.message || '';
  const subject = 'Din mentorship-foresp\u00f8rgsel \u2014 Yoga Bible';

  let bodyHtml = '<p>Hej ' + escapeHtml(firstName) + ',</p>';
  bodyHtml += '<p>Tak for din interesse i vores <strong>' + escapeHtml(service) + '</strong>-program!</p>';
  if (subcategories) bodyHtml += '<p><strong>Interesseomr\u00e5der:</strong> ' + escapeHtml(subcategories) + '</p>';
  if (message) bodyHtml += '<p><strong>Din besked:</strong> ' + escapeHtml(message) + '</p>';
  bodyHtml += '<p>Jeg vil gerne h\u00f8re mere om dine m\u00e5l. Lad os booke en kort samtale:</p>';
  bodyHtml += '<p><a href="' + CONFIG.MEETING_LINK + '" style="display:inline-block;background:#f75c03;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:600;">Book en gratis samtale</a></p>';
  bodyHtml += '<p>Du er ogs\u00e5 velkommen til at svare direkte p\u00e5 denne e-mail.</p>';
  bodyHtml += getEnglishNoteHtml() + getSignatureHtml() + getUnsubscribeFooterHtml(leadData.email);

  const bodyPlain = 'Hej ' + firstName + ',\n\nTak for din interesse i vores ' + service + '-program!\n\nBook en gratis samtale: ' + CONFIG.MEETING_LINK + getEnglishNotePlain() + getSignaturePlain() + getUnsubscribeFooterPlain(leadData.email);

  const result = await sendRawEmail({
    to: leadData.email,
    subject,
    html: wrapHtml(bodyHtml, (tokenData || {}).leadId, 'welcome'),
    text: bodyPlain
  });
  return { ...result, subject };
}

// =========================================================================
// Generic / Contact Email (Danish)
// =========================================================================

// =========================================================================
// Bilingual Email Builder — uses lead-email-i18n.js translations
// Builds program-specific emails in both DA and EN with matching structure
// =========================================================================

const i18n = require('./lead-email-i18n');

function i18nBookingCta(lang) {
  const t = i18n.SHARED[lang] || i18n.SHARED.en;
  return '<p style="margin-top:20px;">' + t.bookingCta + '</p>' +
    '<p><a href="' + CONFIG.MEETING_LINK + '" style="display:inline-block;background:#f75c03;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:600;">' + t.bookingBtn + '</a></p>';
}

function i18nQuestionPrompt(lang) {
  const t = i18n.SHARED[lang] || i18n.SHARED.en;
  return '<p style="margin-top:20px;">' + t.questionPrompt + '</p>' +
    '<p>' + t.lookingForward + '</p>';
}

function i18nHighlightsHtml(lang, extras) {
  const t = i18n.SHARED[lang] || i18n.SHARED.en;
  let html = '<p style="margin-top:16px;">' + t.highlightsIntro + '</p>';
  html += '<ul style="margin:8px 0;padding-left:20px;color:#333;">';
  t.highlights.forEach(function (h) { html += '<li>' + h + '</li>'; });
  if (extras) extras.forEach(function (e) { html += '<li>' + e + '</li>'; });
  html += '</ul>';
  return html;
}

function i18nHighlightsPlain(lang, extras) {
  const t = i18n.SHARED[lang] || i18n.SHARED.en;
  let text = t.highlightsIntro + '\n';
  t.highlights.forEach(function (h) { text += '- ' + h + '\n'; });
  if (extras) extras.forEach(function (e) { text += '- ' + e + '\n'; });
  return text;
}

function i18nAlumniNote(lang) {
  const t = i18n.SHARED[lang] || i18n.SHARED.en;
  return '<p style="margin-top:12px;">' + t.alumniNote + '</p>';
}

function i18nPricingHtml(lang, fullPrice, deposit, remaining, rateNote) {
  const t = i18n.SHARED[lang] || i18n.SHARED.en;
  var currency = lang === 'da' ? ' kr.' : ' DKK';
  return '<div style="margin-top:20px;padding:14px;background:#FFFCF9;border-left:3px solid #f75c03;border-radius:4px;">' +
    '<strong>' + t.priceLabel + ':</strong> ' + fullPrice + currency + ' (' + t.noFees + ')<br>' +
    '<strong>' + t.prepLabel + ':</strong> ' + deposit + currency + '<br>' +
    '<strong>' + t.remainLabel + ':</strong> ' + remaining + currency + ' (' + rateNote + ')' +
    '</div>';
}

function i18nPrepPhaseHtml(lang, programPageUrl) {
  const t = i18n.SHARED[lang] || i18n.SHARED.en;
  var html = '<div style="margin-top:16px;padding:16px;background:#F0FDF4;border-left:3px solid #22C55E;border-radius:4px;">';
  html += '<strong style="color:#166534;">' + t.prepPhaseTitle + '</strong> ' + t.prepPhaseIntro + '<br><br>';
  t.prepPhaseBullets.forEach(function (b) { html += '\u2705 ' + b + '<br>'; });
  html += '<br><a href="' + programPageUrl + '" style="display:inline-block;background:#f75c03;color:#ffffff;padding:10px 20px;text-decoration:none;border-radius:6px;font-weight:600;">' + t.prepPhaseBtn + '</a>';
  html += '</div>';
  return html;
}

function i18nAccommodationHtml(lang, cityCountry) {
  const t = i18n.SHARED[lang] || i18n.SHARED.en;
  var html = '<div style="margin-top:16px;padding:14px;background:#E8F5E9;border-radius:6px;border-left:3px solid #4CAF50;">';
  html += '<strong style="color:#2E7D32;">' + t.accommodationTitle + '</strong> ';
  html += t.accommodationIntro;
  var accommodationConnector = lang === 'da' ? ' og' : lang === 'de' ? '' : ' and';
  if (cityCountry) html += t.accommodationFromCity + escapeHtml(cityCountry) + accommodationConnector;
  html += t.accommodationNeedHousing + '<br><br>';
  html += '<strong><a href="' + t.accommodationLinkUrl + '" style="color:#f75c03;">' + t.accommodationLink + '</a></strong><br>';
  html += '<span style="color:#666;">' + t.accommodationQuestion + '</span>';
  html += '</div>';
  return html;
}

/**
 * Build a full YTT program email in any language.
 * Used for: 4w, 4w-jul, 8w, 18w, 18w-aug, 300h, specialty programs.
 */
async function sendProgramEmail(leadData, programKey, lang, tokenData) {
  const firstName = leadData.first_name || '';
  const t = i18n.SHARED[lang] || i18n.SHARED.en;
  const p = (i18n.PROGRAMS[programKey] || {})[lang] || (i18n.PROGRAMS[programKey] || {}).en;
  if (!p) return sendEmailGenericBilingual(leadData, lang);

  const needsHousing = (leadData.accommodation || '').toLowerCase() === 'yes';
  const cityCountry = leadData.city_country || '';
  const subject = (p.subject || '').replace('{{name}}', firstName).replace('{{program}}', leadData.program || '');

  // Schedule URL
  // Non-CPH Danish leads for July get the enhanced EN schedule page (includes accommodation info)
  var schedLang = lang;
  if (programKey === '4-week-jul' && lang === 'da' && !i18n.isCopenhagenLead(leadData)) {
    schedLang = 'en';
  }
  var schedPath = (i18n.SCHEDULE_PATHS[schedLang] || i18n.SCHEDULE_PATHS.en)[programKey] || '';
  var sUrl = schedPath ? i18n.scheduleUrl(schedPath, schedLang, tokenData) : '';

  // Program page URL
  var pages = i18n.PROGRAM_PAGES[lang] || i18n.PROGRAM_PAGES.en;
  var programPageUrl = pages[programKey] || pages['about200h'];
  var about200hUrl = pages['about200h'];

  // ---- HTML ----
  var bodyHtml = '<p>' + t.greeting + ' ' + escapeHtml(firstName) + ',</p>';
  bodyHtml += '<p>' + p.intro + '</p>';

  if (sUrl) {
    var schedIntro = lang === 'da' ? 'Her finder du alle tr\u00e6ningsdage og tidspunkter:' : lang === 'de' ? 'Hier findest du alle Trainingstage und Zeiten:' : 'Here are all the training days and times:';
    var calNote = lang === 'da' ? 'Du kan tilf\u00f8je alle datoer direkte til din kalender.' : lang === 'de' ? 'Du kannst alle Termine direkt in deinen Kalender eintragen.' : 'You can add all dates directly to your calendar.';
    bodyHtml += '<p>' + schedIntro + '</p>';
    bodyHtml += '<p style="margin:20px 0;"><a href="' + sUrl + '" style="display:inline-block;background:#f75c03;color:#ffffff;padding:14px 28px;text-decoration:none;border-radius:50px;font-weight:600;font-size:16px;">' + t.viewScheduleBtn + '</a></p>';
    bodyHtml += '<p style="font-size:14px;color:#666;">' + calNote + '</p>';
  }

  bodyHtml += '<p style="margin-top:16px;">' + p.description + '</p>';

  // Vinyasa Plus special box
  if (p.vinyasaDetail) {
    bodyHtml += '<div style="margin:16px 0;padding:14px;background:#FFF7ED;border-left:3px solid #f75c03;border-radius:6px;">';
    bodyHtml += '<strong style="color:#c2410c;">' + p.vinyasaTitle + '</strong><br><br>';
    bodyHtml += p.vinyasaFlow + '<br>';
    bodyHtml += p.vinyasaYin + '<br><br>';
    bodyHtml += p.vinyasaCert;
    bodyHtml += '</div>';
  }

  bodyHtml += i18nHighlightsHtml(lang, p.extras);
  bodyHtml += i18nAlumniNote(lang);

  if (needsHousing) bodyHtml += i18nAccommodationHtml(lang, cityCountry);
  bodyHtml += i18nPricingHtml(lang, lang === 'da' ? '23.750' : '23,750', lang === 'da' ? '3.750' : '3,750', lang === 'da' ? '20.000' : '20,000', p.rateNote || t.noFees);
  bodyHtml += i18nPrepPhaseHtml(lang, programPageUrl);

  bodyHtml += '<p style="margin-top:20px;"><a href="' + programPageUrl + '" style="color:#f75c03;">' + t.readMore + '</a>';
  bodyHtml += ' \u00b7 <a href="' + about200hUrl + '" style="color:#f75c03;">' + t.compareFormats + '</a></p>';
  bodyHtml += i18nBookingCta(lang) + i18nQuestionPrompt(lang);
  if (lang === 'da') bodyHtml += getEnglishNoteHtml();
  else if (lang === 'de') bodyHtml += getGermanPsLineHtml();
  bodyHtml += getSignatureHtml(lang) + getUnsubscribeFooterHtml(leadData.email, lang);

  // ---- Plain text ----
  var bodyPlain = t.greeting + ' ' + firstName + ',\n\n';
  bodyPlain += p.intro.replace(/<[^>]+>/g, '') + '\n\n';
  var schedLabel = lang === 'da' ? 'Skema og datoer: ' : lang === 'de' ? 'Stundenplan und Termine: ' : 'Schedule and dates: ';
  if (sUrl) bodyPlain += schedLabel + sUrl + '\n\n';
  bodyPlain += p.description + '\n\n';
  bodyPlain += i18nHighlightsPlain(lang, p.extras);
  bodyPlain += '\n' + t.priceLabel + ': ' + (lang === 'da' ? '23.750 kr.' : '23,750 DKK') + '\n';
  bodyPlain += t.prepLabel + ': ' + (lang === 'da' ? '3.750 kr.' : '3,750 DKK') + '\n';
  bodyPlain += t.remainLabel + ': ' + (lang === 'da' ? '20.000 kr.' : '20,000 DKK') + ' (' + (p.rateNote || '') + ')\n\n';
  bodyPlain += t.bookingCta.replace(/<[^>]+>/g, '') + ' ' + CONFIG.MEETING_LINK + '\n';
  bodyPlain += t.lookingForward;
  if (lang === 'da') bodyPlain += getEnglishNotePlain();
  else if (lang === 'de') bodyPlain += getGermanPsLinePlain();
  bodyPlain += getSignaturePlain(lang) + getUnsubscribeFooterPlain(leadData.email, lang);

  var result = await sendRawEmail({
    to: leadData.email,
    subject: subject,
    html: wrapHtml(bodyHtml, (tokenData || {}).leadId, 'welcome'),
    text: bodyPlain
  });
  return { ...result, subject: subject };
}

/**
 * Multi-format comparison email — bilingual
 */
async function sendMultiFormatEmail(leadData, lang, tokenData) {
  const firstName = leadData.first_name || '';
  const t = i18n.SHARED[lang] || i18n.SHARED.en;
  const m = i18n.MULTI_FORMAT_INFO[lang] || i18n.MULTI_FORMAT_INFO.en;
  const formats = (leadData.all_formats || '').split(',').filter(function (f) { return f; });
  const needsHousing = (leadData.accommodation || '').toLowerCase() === 'yes';
  const cityCountry = leadData.city_country || '';

  // Build format list with proper joiner
  var formatNames = formats.map(function (f) { return (m.formats[f] || {}).name || f; });
  var formatList;
  if (formatNames.length > 1) {
    formatList = formatNames.slice(0, -1).join(', ') + m.joiner + formatNames[formatNames.length - 1];
  } else {
    formatList = formatNames[0] || '';
  }

  var subject = m.subject.replace('{{name}}', firstName);
  var pages = i18n.PROGRAM_PAGES[lang] || i18n.PROGRAM_PAGES.en;
  var schedPaths = i18n.SCHEDULE_PATHS[lang] || i18n.SCHEDULE_PATHS.en;

  // ---- HTML ----
  var bodyHtml = '<p>' + t.greeting + ' ' + escapeHtml(firstName) + ',</p>';
  bodyHtml += '<p>' + m.intro + '</p>';
  bodyHtml += '<p>' + m.compareIntro.replace('{{formats}}', escapeHtml(formatList)) + '</p>';

  // Comparison prompt
  bodyHtml += '<div style="margin:20px 0;padding:14px;background:#E3F2FD;border-radius:6px;border-left:3px solid #1976D2;">';
  bodyHtml += '<strong style="color:#1565C0;">' + m.comparisonPromptTitle + '</strong><br>';
  bodyHtml += m.comparisonPromptBody + '<br><br>';
  bodyHtml += '<span style="color:#666;">' + m.comparisonPromptReply + '</span>';
  bodyHtml += '</div>';

  // Format cards
  bodyHtml += '<p style="margin-top:20px;"><strong>' + m.overviewTitle + '</strong></p>';
  formats.forEach(function (f) {
    var info = m.formats[f];
    if (!info) return;
    var sPath = schedPaths[info.programType] || '';
    var sUrl = sPath ? i18n.scheduleUrl(sPath, lang, tokenData) : '';
    var pUrl = pages[info.programType] || pages['about200h'];
    bodyHtml += '<div style="margin:12px 0;padding:12px;background:#FFFCF9;border-left:3px solid #f75c03;border-radius:4px;">';
    bodyHtml += '<strong>' + escapeHtml(info.name) + '</strong> <span style="color:#888;">(' + escapeHtml(info.period) + ')</span><br>';
    bodyHtml += '<span style="color:#555;">' + info.desc + '</span><br>';
    if (sUrl) {
      bodyHtml += '<p style="margin:10px 0 4px;"><a href="' + sUrl + '" style="display:inline-block;background:#f75c03;color:#fff;padding:8px 18px;text-decoration:none;border-radius:50px;font-weight:600;font-size:14px;">' + t.viewScheduleBtn + '</a></p>';
    }
    bodyHtml += '<a href="' + pUrl + '" style="color:#f75c03;font-size:13px;">' + t.readMore + '</a>';
    bodyHtml += '</div>';
  });

  bodyHtml += i18nHighlightsHtml(lang);
  bodyHtml += i18nAlumniNote(lang);
  if (needsHousing) bodyHtml += i18nAccommodationHtml(lang, cityCountry);
  bodyHtml += i18nPricingHtml(lang, lang === 'da' ? '23.750' : '23,750', lang === 'da' ? '3.750' : '3,750', lang === 'da' ? '20.000' : '20,000', m.samePriceNote);

  // Prep phase CTA
  bodyHtml += '<div style="margin-top:20px;padding:16px;background:#F0FDF4;border-left:3px solid #22C55E;border-radius:4px;">';
  bodyHtml += '<strong style="color:#166534;">' + t.prepPhaseSmart + '</strong><br><br>';
  bodyHtml += t.prepPhaseIntro + '<br><br>';
  t.prepPhaseBullets.forEach(function (b) { bodyHtml += '\u2705 ' + b + '<br>'; });
  bodyHtml += '<br><a href="' + pages['about200h'] + '" style="display:inline-block;background:#f75c03;color:#ffffff;padding:10px 20px;text-decoration:none;border-radius:6px;font-weight:600;">' + t.prepPhaseBtn + '</a>';
  bodyHtml += '</div>';

  bodyHtml += '<p style="margin-top:20px;">' + m.seeStudio + '</p>';
  bodyHtml += i18nBookingCta(lang);
  bodyHtml += '<p>' + t.lookingForward + '</p>';
  if (lang === 'da') bodyHtml += getEnglishNoteHtml();
  else if (lang === 'de') bodyHtml += getGermanPsLineHtml();
  bodyHtml += getSignatureHtml(lang) + getUnsubscribeFooterHtml(leadData.email, lang);

  // ---- Plain text ----
  var bodyPlain = t.greeting + ' ' + firstName + ',\n\n';
  bodyPlain += m.intro.replace(/<[^>]+>/g, '') + '\n\n';
  bodyPlain += m.compareIntro.replace(/<[^>]+>/g, '').replace('{{formats}}', formatList) + '\n\n';
  formats.forEach(function (f) {
    var info = m.formats[f];
    if (!info) return;
    var sPath = schedPaths[info.programType] || '';
    var sUrl = sPath ? i18n.scheduleUrl(sPath, lang, tokenData) : '';
    bodyPlain += '--- ' + info.name + ' (' + info.period + ') ---\n';
    bodyPlain += info.desc + '\n';
    if (sUrl) bodyPlain += (lang === 'da' ? 'Skema: ' : lang === 'de' ? 'Stundenplan: ' : 'Schedule: ') + sUrl + '\n';
    bodyPlain += '\n';
  });
  bodyPlain += i18nHighlightsPlain(lang);
  bodyPlain += '\n' + t.bookingCta.replace(/<[^>]+>/g, '') + ' ' + CONFIG.MEETING_LINK + '\n';
  bodyPlain += t.lookingForward;
  if (lang === 'da') bodyPlain += getEnglishNotePlain();
  else if (lang === 'de') bodyPlain += getGermanPsLinePlain();
  bodyPlain += getSignaturePlain(lang) + getUnsubscribeFooterPlain(leadData.email, lang);

  var result = await sendRawEmail({
    to: leadData.email,
    subject: subject,
    html: wrapHtml(bodyHtml, (tokenData || {}).leadId, 'welcome'),
    text: bodyPlain
  });
  return { ...result, subject: subject };
}

/**
 * Undecided YTT email — bilingual
 */
async function sendUndecidedEmail(leadData, lang, tokenData) {
  const firstName = leadData.first_name || '';
  const t = i18n.SHARED[lang] || i18n.SHARED.en;
  const u = i18n.UNDECIDED_INFO[lang] || i18n.UNDECIDED_INFO.en;
  const needsHousing = (leadData.accommodation || '').toLowerCase() === 'yes';
  const cityCountry = leadData.city_country || '';
  var schedPaths = i18n.SCHEDULE_PATHS[lang] || i18n.SCHEDULE_PATHS.en;
  var pages = i18n.PROGRAM_PAGES[lang] || i18n.PROGRAM_PAGES.en;

  var subject = u.subject.replace('{{name}}', firstName);

  var bodyHtml = '<p>' + t.greeting + ' ' + escapeHtml(firstName) + ',</p>';
  bodyHtml += '<p>' + u.intro + '</p>';
  bodyHtml += '<p>' + u.normalText + '</p>';

  // Same cert info box
  bodyHtml += '<div style="margin:20px 0;padding:14px;background:#E3F2FD;border-radius:6px;border-left:3px solid #1976D2;">';
  bodyHtml += '<strong style="color:#1565C0;">' + u.sameCertTitle + '</strong><br>';
  bodyHtml += u.sameCertBody;
  bodyHtml += '</div>';

  // Format cards
  bodyHtml += '<p style="margin-top:24px;"><strong>' + u.optionsTitle + '</strong></p>';
  u.formats.forEach(function (f) {
    var sPath = schedPaths[f.programType] || '';
    var sUrl = sPath ? i18n.scheduleUrl(sPath, lang, tokenData) : '';
    var pUrl = pages[f.programType] || pages['about200h'];
    bodyHtml += '<div style="margin:16px 0;padding:16px;background:#FFFCF9;border-left:3px solid #f75c03;border-radius:4px;">';
    bodyHtml += '<strong style="font-size:17px;">' + f.emoji + ' ' + escapeHtml(f.name) + '</strong> <span style="color:#888;">(' + escapeHtml(f.period) + ')</span><br>';
    bodyHtml += '<span style="color:#555;">' + f.desc + '</span><br><br>';
    bodyHtml += '<span style="color:#166534;font-size:14px;"><strong>' + u.goodFor + '</strong> ' + f.goodFor + '</span><br>';
    bodyHtml += '<p style="margin:10px 0 4px;">';
    if (sUrl) bodyHtml += '<a href="' + sUrl + '" style="display:inline-block;background:#f75c03;color:#fff;padding:8px 18px;text-decoration:none;border-radius:50px;font-weight:600;font-size:14px;">' + t.viewScheduleBtn + '</a> ';
    bodyHtml += '<a href="' + pUrl + '" style="color:#f75c03;font-size:13px;margin-left:12px;">' + t.readMore + '</a>';
    bodyHtml += '</p></div>';
  });

  // Compare CTA
  bodyHtml += '<div style="margin:24px 0;padding:16px;background:#F5F3F0;border-radius:6px;text-align:center;">';
  bodyHtml += '<p style="margin:0 0 10px;"><strong>' + u.stillUndecided + '</strong></p>';
  bodyHtml += '<a href="' + pages['about200h'] + '" style="display:inline-block;background:#1a1a1a;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:600;">' + u.compareBtn + '</a>';
  bodyHtml += '</div>';

  bodyHtml += i18nHighlightsHtml(lang);
  bodyHtml += i18nAlumniNote(lang);
  if (needsHousing) bodyHtml += i18nAccommodationHtml(lang, cityCountry);
  bodyHtml += i18nPricingHtml(lang, lang === 'da' ? '23.750' : '23,750', lang === 'da' ? '3.750' : '3,750', lang === 'da' ? '20.000' : '20,000', u.samePriceNote);
  bodyHtml += i18nPrepPhaseHtml(lang, pages['about200h']);

  bodyHtml += '<p style="margin-top:24px;">' + u.meetingCta + '</p>';
  bodyHtml += i18nBookingCta(lang);
  bodyHtml += '<p>' + u.replyOk + '</p>';
  if (lang === 'da') bodyHtml += getEnglishNoteHtml();
  else if (lang === 'de') bodyHtml += getGermanPsLineHtml();
  bodyHtml += getSignatureHtml(lang) + getUnsubscribeFooterHtml(leadData.email, lang);

  // Plain text
  var bodyPlain = t.greeting + ' ' + firstName + ',\n\n';
  bodyPlain += u.intro.replace(/<[^>]+>/g, '') + '\n\n';
  u.formats.forEach(function (f) {
    bodyPlain += f.emoji + ' ' + f.name + ' (' + f.period + ')\n';
    bodyPlain += f.desc + '\n';
    bodyPlain += u.goodFor + ' ' + f.goodFor + '\n\n';
  });
  bodyPlain += t.bookingCta.replace(/<[^>]+>/g, '') + ' ' + CONFIG.MEETING_LINK + '\n';
  if (lang === 'da') bodyPlain += getEnglishNotePlain();
  else if (lang === 'de') bodyPlain += getGermanPsLinePlain();
  bodyPlain += getSignaturePlain(lang) + getUnsubscribeFooterPlain(leadData.email, lang);

  var result = await sendRawEmail({ to: leadData.email, subject: subject, html: wrapHtml(bodyHtml, (tokenData || {}).leadId, 'welcome'), text: bodyPlain });
  return { ...result, subject: subject };
}

/**
 * Generic / Contact email — bilingual
 */
async function sendEmailGenericBilingual(leadData, lang, tokenData = {}) {
  const firstName = leadData.first_name || '';
  const t = i18n.SHARED[lang] || i18n.SHARED.en;
  const g = (i18n.PROGRAMS['generic'] || {})[lang] || i18n.PROGRAMS['generic'].en;

  var subject = g.subject;
  var bodyHtml = '<p>' + t.greeting + ' ' + escapeHtml(firstName) + ',</p>';
  bodyHtml += '<p>' + g.intro + '</p>';
  bodyHtml += '<p>' + g.body + '</p>';
  bodyHtml += '<p>' + g.meanwhile + '</p>';
  bodyHtml += '<ul style="margin:10px 0;padding-left:20px;">';
  bodyHtml += '<li>' + g.bookLink + ': <a href="' + CONFIG.MEETING_LINK + '" style="color:#f75c03;">' + (lang === 'da' ? 'Klik her' : lang === 'de' ? 'Hier klicken' : 'Click here') + '</a></li>';
  bodyHtml += '<li>' + g.visitLink + ': <a href="' + g.visitUrl + '" style="color:#f75c03;">yogabible.dk</a></li>';
  bodyHtml += '</ul>';
  bodyHtml += '<p>' + t.replyInvite + '</p>';
  if (lang === 'da') bodyHtml += getEnglishNoteHtml();
  else if (lang === 'de') bodyHtml += getGermanPsLineHtml();
  bodyHtml += getSignatureHtml(lang) + getUnsubscribeFooterHtml(leadData.email, lang);

  var bodyPlain = t.greeting + ' ' + firstName + ',\n\n' + g.intro.replace(/<[^>]+>/g, '') + '\n\n' +
    g.body + '\n\n' + g.bookLink + ': ' + CONFIG.MEETING_LINK + '\n' + g.visitLink + ': ' + g.visitUrl;
  if (lang === 'da') bodyPlain += getEnglishNotePlain();
  else if (lang === 'de') bodyPlain += getGermanPsLinePlain();
  bodyPlain += getSignaturePlain(lang) + getUnsubscribeFooterPlain(leadData.email, lang);

  var result = await sendRawEmail({ to: leadData.email, subject: subject, html: wrapHtml(bodyHtml, (tokenData || {}).leadId, 'welcome'), text: bodyPlain });
  return { ...result, subject: subject };
}

/**
 * Mentorship email — bilingual
 */
async function sendMentorshipEmail(leadData, lang, tokenData = {}) {
  const firstName = leadData.first_name || '';
  const t = i18n.SHARED[lang] || i18n.SHARED.en;
  const p = (i18n.PROGRAMS['mentorship'] || {})[lang] || i18n.PROGRAMS['mentorship'].en;
  var service = leadData.service || leadData.program || 'Mentorship';

  var subject = p.subject.replace('{{service}}', service);
  var bodyHtml = '<p>' + t.greeting + ' ' + escapeHtml(firstName) + ',</p>';
  bodyHtml += '<p>' + p.intro.replace('{{service}}', escapeHtml(service)) + '</p>';
  bodyHtml += '<p>' + p.description + '</p>';
  bodyHtml += i18nBookingCta(lang);
  bodyHtml += '<p>' + t.replyInvite + '</p>';
  if (lang === 'da') bodyHtml += getEnglishNoteHtml();
  else if (lang === 'de') bodyHtml += getGermanPsLineHtml();
  bodyHtml += getSignatureHtml(lang) + getUnsubscribeFooterHtml(leadData.email, lang);

  var bodyPlain = t.greeting + ' ' + firstName + ',\n\n' + p.intro.replace(/<[^>]+>/g, '').replace('{{service}}', service) + '\n\n' +
    p.description + '\n\n' + t.bookingCta.replace(/<[^>]+>/g, '') + ' ' + CONFIG.MEETING_LINK;
  if (lang === 'da') bodyPlain += getEnglishNotePlain();
  else if (lang === 'de') bodyPlain += getGermanPsLinePlain();
  bodyPlain += getSignaturePlain(lang) + getUnsubscribeFooterPlain(leadData.email, lang);

  var result = await sendRawEmail({ to: leadData.email, subject: subject, html: wrapHtml(bodyHtml, (tokenData || {}).leadId, 'welcome'), text: bodyPlain });
  return { ...result, subject: subject };
}

/**
 * Courses email — bilingual
 */
async function sendCoursesEmail(leadData, lang, tokenData = {}) {
  const firstName = leadData.first_name || '';
  const t = i18n.SHARED[lang] || i18n.SHARED.en;
  const c = (i18n.PROGRAMS['courses'] || {})[lang] || i18n.PROGRAMS['courses'].en;
  var courses = leadData.program || '';
  var courseList = courses.split(/[,+]/).map(function (s) { return s.trim(); }).filter(function (s) { return s; });
  var isBundle = courseList.length > 1;

  var subject = isBundle ? c.subjectBundle : c.subjectSingle;
  var bodyHtml = '<p>' + t.greeting + ' ' + escapeHtml(firstName) + ',</p>';
  bodyHtml += '<p>' + (isBundle ? c.introBundle : c.introSingle).replace('{{courses}}', escapeHtml(courses)) + '</p>';

  courseList.forEach(function (course) {
    var config = COURSE_CONFIG[course];
    if (config) {
      bodyHtml += '<div style="margin:10px 0;padding:12px;background:#FFFCF9;border-left:3px solid #f75c03;border-radius:4px;">';
      bodyHtml += '<strong>' + escapeHtml(config.label) + '</strong> \u2014 ' + config.description + '<br>';
      bodyHtml += '<span style="color:#666;">' + c.sessions + ' \u00b7 ' + c.pricePer + '</span>';
      bodyHtml += '</div>';
    }
  });

  if (courseList.length === 2) {
    bodyHtml += '<p style="color:#166534;font-weight:bold;">\u2705 ' + c.bundle2Discount + '</p>';
  } else if (courseList.length >= 3) {
    bodyHtml += '<p style="color:#166534;font-weight:bold;">\u2705 ' + c.bundle3Discount + '</p>';
  }

  bodyHtml += i18nBookingCta(lang);
  bodyHtml += '<p>' + t.replyInvite + '</p>';
  if (lang === 'da') bodyHtml += getEnglishNoteHtml();
  else if (lang === 'de') bodyHtml += getGermanPsLineHtml();
  bodyHtml += getSignatureHtml(lang) + getUnsubscribeFooterHtml(leadData.email, lang);

  var bodyPlain = t.greeting + ' ' + firstName + ',\n\n' + (isBundle ? c.introBundle : c.introSingle).replace(/<[^>]+>/g, '').replace('{{courses}}', courses) + '\n\n';
  bodyPlain += t.bookingCta.replace(/<[^>]+>/g, '') + ' ' + CONFIG.MEETING_LINK;
  if (lang === 'da') bodyPlain += getEnglishNotePlain();
  else if (lang === 'de') bodyPlain += getGermanPsLinePlain();
  bodyPlain += getSignaturePlain(lang) + getUnsubscribeFooterPlain(leadData.email, lang);

  var result = await sendRawEmail({ to: leadData.email, subject: subject, html: wrapHtml(bodyHtml, (tokenData || {}).leadId, 'welcome'), text: bodyPlain });
  return { ...result, subject: subject };
}

async function sendEmailGeneric(leadData, tokenData = {}) {
  const firstName = leadData.first_name || '';
  const subject = 'Tak for din henvendelse \u2014 Yoga Bible';

  let bodyHtml = '<p>Hej ' + escapeHtml(firstName) + ',</p>';
  bodyHtml += '<p>Tak fordi du tog kontakt til <strong>Yoga Bible</strong>!</p>';
  bodyHtml += '<p>Vi har modtaget din foresp\u00f8rgsel og vender tilbage snarest.</p>';
  bodyHtml += '<p>I mellemtiden:</p>';
  bodyHtml += '<ul style="margin:10px 0;padding-left:20px;">';
  bodyHtml += '<li>Book en samtale: <a href="' + CONFIG.MEETING_LINK + '" style="color:#f75c03;">Klik her</a></li>';
  bodyHtml += '<li>Bes\u00f8g vores hjemmeside: <a href="https://www.yogabible.dk" style="color:#f75c03;">yogabible.dk</a></li>';
  bodyHtml += '</ul>';
  bodyHtml += '<p>Du er velkommen til at svare p\u00e5 denne e-mail med sp\u00f8rgsm\u00e5l.</p>';
  bodyHtml += getEnglishNoteHtml() + getSignatureHtml() + getUnsubscribeFooterHtml(leadData.email);

  const bodyPlain = 'Hej ' + firstName + ',\n\nTak fordi du tog kontakt til Yoga Bible!\n\nVi vender tilbage snarest.\n\nBook en samtale: ' + CONFIG.MEETING_LINK + '\nBes\u00f8g: https://www.yogabible.dk' + getEnglishNotePlain() + getSignaturePlain() + getUnsubscribeFooterPlain(leadData.email);

  const result = await sendRawEmail({
    to: leadData.email,
    subject,
    html: wrapHtml(bodyHtml, (tokenData || {}).leadId, 'welcome'),
    text: bodyPlain
  });
  return { ...result, subject };
}

// =========================================================================
// Application Confirmation Email
// =========================================================================

async function sendApplicationConfirmation(email, applicationId, firstName) {
  const subject = 'Tak for din ansøgning — Yoga Bible';

  let bodyHtml = '<p>Hej ' + escapeHtml(firstName || '') + ',</p>';
  bodyHtml += '<p>Tak for din ansøgning til <strong>Yoga Bible</strong>!</p>';
  bodyHtml += '<p>Dit ansøgnings-ID er: <strong>' + escapeHtml(applicationId) + '</strong></p>';
  bodyHtml += '<p>Vi kigger din ansøgning igennem og vender tilbage med næste skridt.</p>';
  bodyHtml += '<p>Har du spørgsmål i mellemtiden? Svar bare på denne e-mail eller ring til os på <a href="tel:+4553881209" style="color:#f75c03;">+45 53 88 12 09</a>.</p>';
  bodyHtml += getEnglishNoteHtml() + getSignatureHtml() + getUnsubscribeFooterHtml(email);

  const bodyPlain = 'Hej ' + (firstName || '') + ',\n\nTak for din ansøgning til Yoga Bible!\n\nDit ansøgnings-ID er: ' + applicationId + '\n\nVi kigger din ansøgning igennem og vender tilbage.\n\nHar du spørgsmål? Svar på denne e-mail eller ring +45 53 88 12 09.' + getEnglishNotePlain() + getSignaturePlain() + getUnsubscribeFooterPlain(email);

  const result = await sendRawEmail({
    to: email,
    subject,
    html: wrapHtml(bodyHtml, (tokenData || {}).leadId, 'welcome'),
    text: bodyPlain
  });

  await logWelcomeEmail(email, subject);
  return { ...result, subject };
}

// =========================================================================
// Careers Auto-Reply Email
// =========================================================================

async function sendCareersConfirmation(email, firstName, category, role) {
  const subject = 'Tak for din ansøgning — Yoga Bible Careers';

  let bodyHtml = '<p>Hej ' + escapeHtml(firstName || '') + ',</p>';
  bodyHtml += '<p>Tak for din interesse i at blive en del af <strong>Yoga Bible</strong>-teamet!</p>';
  bodyHtml += '<p>Vi har modtaget din ansøgning' + (category ? ' inden for <strong>' + escapeHtml(category) + '</strong>' : '') + (role ? ' som <strong>' + escapeHtml(role) + '</strong>' : '') + '.</p>';
  bodyHtml += '<p>Vi gennemgår alle ansøgninger løbende og vender tilbage, hvis der er et match.</p>';
  bodyHtml += '<p>Har du spørgsmål? Svar bare på denne e-mail.</p>';
  bodyHtml += getEnglishNoteHtml() + getSignatureHtml() + getUnsubscribeFooterHtml(email);

  const bodyPlain = 'Hej ' + (firstName || '') + ',\n\nTak for din interesse i at blive en del af Yoga Bible-teamet!\n\nVi har modtaget din ansøgning' + (category ? ' inden for ' + category : '') + (role ? ' som ' + role : '') + '.\n\nVi gennemgår alle ansøgninger løbende og vender tilbage, hvis der er et match.\n\nHar du spørgsmål? Svar bare på denne e-mail.' + getEnglishNotePlain() + getSignaturePlain() + getUnsubscribeFooterPlain(email);

  const result = await sendRawEmail({
    to: email,
    subject,
    html: wrapHtml(bodyHtml, (tokenData || {}).leadId, 'welcome'),
    text: bodyPlain
  });

  await logWelcomeEmail(email, subject);
  return { ...result, subject };
}

module.exports = {
  sendWelcomeEmail,
  sendApplicationConfirmation,
  sendCareersConfirmation
};
